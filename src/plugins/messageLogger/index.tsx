/*
 * Vencord, a modification for Discord's desktop app
 * Copyright (c) 2022 Vendicated and contributors
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

import "./messageLogger.css";

import { ApplicationCommandInputType, sendBotMessage } from "@api/Commands";
import { Settings } from "@api/Settings";
import { Devs, SUPPORT_CATEGORY_ID, VENBOT_USER_ID } from "@utils/constants";
import { Logger } from "@utils/Logger";
import definePlugin from "@utils/types";
import { ChannelStore, SelectedChannelStore, UserStore } from "@webpack/common";

import { EditMarker, getDeletedMessageCountFormat, renderEdits } from "./components";
import {
    patchChannelContextMenu,
    patchChannelMonitoringContextMenu,
    patchGuildContextMenu,
    patchMessageContextMenu,
} from "./contextMenus";
import { deleteMessageFromDB, getMessagesForChannel, saveMessage } from "./database";
import { openLogViewerModal } from "./LogViewerModal";
import { isMonitored, loadMonitoringSettings } from "./monitoring";
import { options } from "./options";
import { patches } from "./patches";
import { addDeleteStyle } from "./styles";
import { MLMessage } from "./types";
import { makeEdit } from "./utils";

// Re-export for external use
export { parseEditContent } from "./utils";

const logger = new Logger("MessageLogger");

/**
 * MessageLogger Plugin - 削除・編集されたメッセージを永続化して表示するプラグイン
 *
 * ## アーキテクチャ概要 (MessageLoggerV2に準拠)
 *
 * このプラグインは Discord 内部の Dispatcher（イベント配信システム）を
 * モンキーパッチすることでメッセージイベントを捕捉します。
 *
 * ### なぜ Dispatcher パッチが必要か？
 *
 * 1. **MESSAGE_DELETE の捕捉タイミング**:
 *    - 元の dispatch が実行されると MessageStore からメッセージが削除される
 *    - そのため、削除イベントは dispatch 処理の「前」に捕捉して保存する必要がある
 *    - FluxDispatcher.subscribe では「後」になるため間に合わない
 *
 * 2. **ジャンプ機能の維持**:
 *    - LOAD_MESSAGES_AROUND_SUCCESS で dispatch.messages 配列を直接書き換える
 *    - 処理後は必ず callDefault() を呼んで Discord に加工済みデータを渡す
 *    - これを忘れると「ジャンプしてもスケルトンのまま」になる
 *
 * 3. **スクロール位置の維持**:
 *    - MessageCache を全削除→再構築すると仮想リストのアンカーが壊れる
 *    - dispatch.messages への splice 挿入なら Discord 標準のソート処理に任せられる
 *
 * ### 主なイベントタイプ
 * - MESSAGE_DELETE: 単一メッセージ削除
 * - MESSAGE_DELETE_BULK: 一括削除（パージ）
 * - MESSAGE_UPDATE: メッセージ編集
 * - LOAD_MESSAGES_SUCCESS: チャンネル履歴読み込み
 * - LOAD_MESSAGES_AROUND_SUCCESS: ジャンプ/検索時の読み込み
 */
export default definePlugin({
    name: "MessageLogger",
    description: "Temporarily logs deleted and edited messages.",
    authors: [Devs.rushii, Devs.Ven, Devs.AutumnVN, Devs.Nickyux, Devs.Kyuuhachi],
    dependencies: ["MessageUpdaterAPI"],

    // Expose database methods for external use
    saveMessage,
    getMessagesForChannel,
    deleteMessageFromDB,

    // Components for patches
    renderEdits,
    EditMarker,
    DELETED_MESSAGE_COUNT: getDeletedMessageCountFormat,
    makeEdit,

    options,
    patches,

    contextMenus: {
        "message": patchMessageContextMenu,
        "channel-context": (children, props) => {
            patchChannelContextMenu(children, props);
            patchChannelMonitoringContextMenu(children, props);
        },
        "thread-context": (children, props) => {
            patchChannelContextMenu(children, props);
            patchChannelMonitoringContextMenu(children, props);
        },
        "user-context": patchChannelContextMenu,
        "gdm-context": patchChannelContextMenu,
        "guild-context": patchGuildContextMenu
    },

    commands: [
        {
            name: "viewlog",
            description: "Open Message Logger Viewer",
            inputType: ApplicationCommandInputType.BUILT_IN,
            execute: async (_, ctx) => {
                openLogViewerModal();
                sendBotMessage(ctx.channel.id, {
                    content: "Opening Message Logger Viewer..."
                });
            }
        }
    ],

    start(): void {
        addDeleteStyle();
        loadMonitoringSettings();
    },

    /**
     * Handles message deletion in the cache
     */
    handleDelete(cache: any, data: { ids?: string[]; id?: string; mlDeleted?: boolean; }, isBulk: boolean): any {
        try {
            if (cache == null || (!isBulk && !cache.has(data.id))) return cache;

            const mutate = (id: string) => {
                const msg = cache.get(id);
                if (!msg) return;

                const EPHEMERAL = 64;
                const shouldIgnore = data.mlDeleted ||
                    (msg.flags & EPHEMERAL) === EPHEMERAL ||
                    this.shouldIgnore(msg);

                if (shouldIgnore) {
                    cache = cache.remove(id);
                    deleteMessageFromDB(id);
                } else {
                    cache = cache.update(id, (m: any) => {
                        const updated = m
                            .set("deleted", true)
                            .set("attachments", m.attachments.map((a: any) => (a.deleted = true, a)));
                        saveMessage(updated.toJS());
                        return updated;
                    });
                }
            };

            if (isBulk) {
                data.ids?.forEach(mutate);
            } else if (data.id) {
                mutate(data.id);
            }
        } catch (e) {
            logger.error("Error during handleDelete", e);
        }
        return cache;
    },

    /**
     * メッセージを無視すべきかどうかを判定
     *
     * 設定に基づいて以下の条件をチェック:
     * - Bot からのメッセージを無視
     * - 自分のメッセージを無視
     * - 特定のユーザー/チャンネル/サーバーを無視
     * - モニタリング対象かどうか
     * - 編集/削除のログ設定
     */
    shouldIgnore(message: any, isEdit = false): boolean {
        try {
            const {
                ignoreBots,
                ignoreSelf,
                ignoreUsers,
                ignoreChannels,
                ignoreGuilds,
                logEdits,
                logDeletes
            } = Settings.plugins.MessageLogger;

            const myId = UserStore.getCurrentUser().id;
            const channel = ChannelStore.getChannel(message.channel_id);

            // Check if channel is monitored
            if (!isMonitored(channel?.guild_id, message.channel_id)) {
                return true;
            }

            return (
                (ignoreBots && message.author?.bot) ||
                (ignoreSelf && message.author?.id === myId) ||
                ignoreUsers.includes(message.author?.id) ||
                ignoreChannels.includes(message.channel_id) ||
                ignoreChannels.includes(channel?.parent_id) ||
                (isEdit ? !logEdits : !logDeletes) ||
                ignoreGuilds.includes(channel?.guild_id) ||
                // Ignore Venbot in the support channels
                (message.author?.id === VENBOT_USER_ID && channel?.parent_id === SUPPORT_CATEGORY_ID)
            );
        } catch {
            return false;
        }
    },
});
