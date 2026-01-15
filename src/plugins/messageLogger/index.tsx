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

import { Settings } from "@api/Settings";
import { ApplicationCommandInputType, sendBotMessage } from "@api/Commands";
import { SUPPORT_CATEGORY_ID, VENBOT_USER_ID, Devs } from "@utils/constants";
import { Logger } from "@utils/Logger";
import definePlugin from "@utils/types";
import { findByPropsLazy } from "@webpack";
import { ChannelStore, MessageCache, MessageStore, moment, SelectedChannelStore, UserStore } from "@webpack/common";

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
import { DeleteData, LoadMessagesAction, MLMessage } from "./types";
import { makeEdit, normalizePersistedMessage, reAddDeletedMessages } from "./utils";

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
            name: "messagelog",
            description: "Open the Message Logger viewer to browse deleted and edited messages",
            inputType: ApplicationCommandInputType.BUILT_IN,
            execute: async (_args, ctx) => {
                openLogViewerModal();
                sendBotMessage(ctx.channel.id, {
                    content: "Opening Message Logger viewer...",
                });
            },
        }
    ],

    /**
     * 通常のチャンネル読み込み時の処理（FluxDispatcher経由、後方互換用）
     *
     * 注意: この関数はキャッシュを全削除→再構築するため、ジャンプ時には使用しない。
     * ジャンプ時に呼ばれるとスクロールアンカーが壊れて位置が飛ぶ。
     *
     * 現在は onDispatchEvent での処理が主で、この関数は補助的な役割。
     */
    async onLoadMessages({ channelId }: { channelId: string; }): Promise<void> {
        const savedMessages = await getMessagesForChannel(channelId);
        if (!savedMessages.length) return;

        let cache = MessageCache.getOrCreate(channelId);
        const currentMessages = cache.toArray();
        const messageMap = new Map<string, any>();

        for (const msg of currentMessages) {
            messageMap.set(msg.id, msg);
        }

        for (const msg of savedMessages) {
            normalizePersistedMessage(msg);
            messageMap.set(msg.id, msg);
        }

        const sortedMessages = Array.from(messageMap.values()).sort((a, b) => {
            return moment(a.timestamp).valueOf() - moment(b.timestamp).valueOf();
        });

        for (const msg of currentMessages) {
            cache = cache.remove(msg.id);
        }

        for (const msg of sortedMessages) {
            cache = cache.receiveMessage(msg);
        }

        MessageCache.commit(cache);
        MessageStore.emitChange();
    },

    /**
     * ジャンプ/検索時のメッセージ読み込み処理
     *
     * MessageLoggerV2 の reAddDeletedMessages と同様のロジック:
     * - dispatch.messages 配列を直接 splice して削除済みメッセージを挿入
     * - キャッシュの全再構築は行わない（スクロール位置を維持するため）
     * - 挿入位置は元の配列の並び順（newest-first / oldest-first）を自動検出して決定
     *
     * @param action - Dispatcher から渡される LOAD_MESSAGES_AROUND_SUCCESS のペイロード
     */
    async onLoadMessagesAround(action: LoadMessagesAction): Promise<void> {
        const { channelId, messages, hasMoreBefore, hasMoreAfter } = action;
        if (!messages?.length) return;

        const savedMessages = await getMessagesForChannel(channelId);
        if (!savedMessages.length) return;

        const channelStart = !hasMoreAfter && !action.isBefore;
        const channelEnd = !hasMoreBefore && !action.isAfter;

        try {
            reAddDeletedMessages(messages, savedMessages, channelStart, channelEnd);
        } catch (e) {
            logger.error("reAddDeletedMessages failed", e);
        }
    },

    /**
     * Dispatcher レベルでのイベントインターセプト（MessageLoggerV2 方式）
     *
     * ## 重要な設計判断
     *
     * 1. **削除イベントは callDefault の「前」に処理する**:
     *    - MESSAGE_DELETE が dispatch されると MessageStore からメッセージが消える
     *    - 消える前に MessageStore.getMessage() で取得して保存する
     *
     * 2. **LOAD_MESSAGES 系は配列を書き換えてから callDefault を呼ぶ**:
     *    - dispatch.messages に削除済みメッセージを splice で挿入
     *    - その後 callDefault() で Discord に加工済みデータを渡す
     *    - callDefault を呼ばないと「イベントを握りつぶす」ことになりジャンプが動かない
     *
     * 3. **patches.ts の正規表現パッチが壊れた場合の保険**:
     *    - Discord のアップデートで正規表現が一致しなくなることがある
     *    - Dispatcher レベルでの処理は通信プロトコルに依存するため壊れにくい
     */
    async onDispatchEvent(this: any, args: any[], callDefault: (...a: any[]) => any): Promise<any> {
        try {
            const dispatch = args[0];
            if (!dispatch) return callDefault(...args);

            // ★重要: 削除イベントは callDefault の「前」に処理する
            // 理由: callDefault が実行されると MessageStore からメッセージが削除されてしまうため、
            // その前に MessageStore.getMessage() でメッセージを取得して IndexedDB に保存する必要がある
            if (dispatch.type === "MESSAGE_DELETE") {
                this._handleMessageDelete(dispatch);
            }

            if (dispatch.type === "MESSAGE_DELETE_BULK") {
                this._handleMessageDeleteBulk(dispatch);
            }

            if (dispatch.type === "CHANNEL_SELECT") {
                const { channelId } = dispatch;
                if (channelId) {
                    this.onLoadMessages({ channelId }).catch((e: any) => {
                        logger.error("CHANNEL_SELECT onLoadMessages failed", e);
                    });
                }
            }

            if (dispatch.type === "MESSAGE_UPDATE") {
                this._handleMessageUpdate(dispatch);
            }

            // ジャンプ/検索時の処理:
            // dispatch.messages 配列に削除済みメッセージを splice で挿入した後、
            // 必ず callDefault() を呼んで加工済みデータを Discord に渡す。
            // callDefault を呼ばないと「スケルトンのまま」「スクロールが戻る」問題が発生する。
            if (dispatch.type === "LOAD_MESSAGES_AROUND_SUCCESS" || dispatch.type === "LOAD_MESSAGES_AROUND") {
                try {
                    await this.onLoadMessagesAround?.(dispatch);
                } catch (e) {
                    logger.error("onDispatchEvent -> onLoadMessagesAround failed", e);
                }
                // ★重要: 必ず callDefault を呼ぶ（これがないとジャンプが動かない）
                return callDefault(...args);
            }

            // 通常のチャンネル読み込み時の処理:
            // dispatch.messages に保存済みメッセージを挿入してから callDefault を呼ぶ。
            // これにより Discord の標準処理で正しい位置にメッセージが表示される。
            if (dispatch.type === "LOAD_MESSAGES_SUCCESS") {
                await this._handleLoadMessagesSuccess(dispatch);
                return callDefault(...args);
            }

            return callDefault(...args);
        } catch (e) {
            logger.error("onDispatchEvent error", e);
            try { return callDefault(...args); } catch { /* ignore */ }
        }
    },

    /**
     * 単一メッセージ削除の処理
     *
     * callDefault が実行される「前」に呼ばれる。
     * MessageStore からメッセージが削除される前に取得して IndexedDB に保存する。
     *
     * メッセージオブジェクトが Immutable の場合は toJS() で Plain Object に変換する。
     */
    _handleMessageDelete(dispatch: any): void {
        try {
            const id = dispatch.id ?? dispatch.message?.id ?? dispatch.payload?.id;
            const channelId = dispatch.channelId ?? dispatch.channel_id ??
                dispatch.message?.channel_id ?? dispatch.payload?.channelId;

            if (!id || !channelId) return;

            const msg = MessageStore.getMessage(channelId, id) as any;
            if (!msg) return;
            if (this.shouldIgnore?.(msg)) return;

            const plain = typeof msg.toJS === "function" ? msg.toJS() : { ...msg };
            const toSave: MLMessage = {
                ...plain,
                deleted: true,
                attachments: (plain.attachments || []).map((a: any) => ({ ...a, deleted: true }))
            };

            saveMessage(toSave);
        } catch (e) {
            logger.error("MESSAGE_DELETE handling failed", e);
        }
    },

    /**
     * 一括削除（パージ）の処理
     *
     * MESSAGE_DELETE_BULK イベントで複数のメッセージ ID が渡される。
     * 各メッセージを個別に取得して保存する。
     */
    _handleMessageDeleteBulk(dispatch: any): void {
        try {
            const ids = dispatch.ids ?? dispatch.idsToDelete ?? [];
            const channelId = dispatch.channelId ?? dispatch.channel_id ?? dispatch.payload?.channelId;

            for (const id of ids) {
                if (!id || !channelId) continue;

                try {
                    const msg = MessageStore.getMessage(channelId, id) as any;
                    if (!msg || this.shouldIgnore?.(msg)) continue;

                    const plain = typeof msg.toJS === "function" ? msg.toJS() : { ...msg };
                    const toSave: MLMessage = {
                        ...plain,
                        deleted: true,
                        attachments: (plain.attachments || []).map((a: any) => ({ ...a, deleted: true }))
                    };
                    saveMessage(toSave);
                } catch (inner) {
                    logger.error("MESSAGE_DELETE_BULK item failed", inner);
                }
            }
        } catch (e) {
            logger.error("MESSAGE_DELETE_BULK handling failed", e);
        }
    },

    /**
     * メッセージ編集の処理
     *
     * 編集前の内容を editHistory 配列に追加して保存する。
     * これにより編集履歴を追跡できる。
     *
     * 注意: edited_timestamp がない場合は編集ではないのでスキップする。
     */
    _handleMessageUpdate(dispatch: any): void {
        try {
            const updated = dispatch.message ?? dispatch.messageUpdate ?? null;
            if (!updated?.edited_timestamp) return;

            const id = updated.id || dispatch.id;
            const channelId = updated.channel_id || dispatch.channelId || dispatch.channel_id;

            if (!id || !channelId) return;

            const oldMsg = MessageStore.getMessage(channelId, id) as any;
            if (!oldMsg || oldMsg.content === updated.content || this.shouldIgnore?.(oldMsg, true)) return;

            const plainOld = typeof oldMsg.toJS === "function" ? oldMsg.toJS() : { ...oldMsg };
            const editRecord = makeEdit(updated, plainOld);
            const editHistory = [...(plainOld.editHistory || []), editRecord];
            const toSave: MLMessage = { ...plainOld, ...updated, editHistory };
            saveMessage(toSave);
        } catch (e) {
            logger.error("MESSAGE_UPDATE handling failed", e);
        }
    },

    /**
     * 通常のチャンネル読み込み成功時の処理
     *
     * dispatch.messages 配列に保存済みの削除メッセージを splice で挿入する。
     * reAddDeletedMessages は MessageLoggerV2 のロジックを移植したもので、
     * メッセージの時間範囲を計算して適切な位置に挿入する。
     */
    async _handleLoadMessagesSuccess(dispatch: any): Promise<void> {
        try {
            const { channelId } = dispatch as LoadMessagesAction;
            // 配列書き換え方式が不安定なため、実績のある onLoadMessages（キャッシュ直接操作）を使用する
            await this.onLoadMessages({ channelId });
        } catch (e) {
            logger.error("LOAD_MESSAGES_SUCCESS handling failed", e);
        }
    },

    start(): void {
        addDeleteStyle();
        loadMonitoringSettings();
        this._patchDispatcher();

        // 起動時に現在のチャンネルのメッセージを復元
        const triggerInitialLoad = () => {
            const currentChannelId = SelectedChannelStore.getChannelId();
            if (currentChannelId) {
                this.onLoadMessages({ channelId: currentChannelId }).catch(e => {
                    logger.error("Initial onLoadMessages failed", e);
                });
                return true;
            }
            return false;
        };

        if (!triggerInitialLoad()) {
            // Discordの初期化待ち
            setTimeout(() => triggerInitialLoad(), 2000);
        }
    },

    stop(): void {
        this._restoreDispatcher();
    },

    /**
     * Dispatcher のモンキーパッチ
     *
     * Discord 内部の Dispatcher オブジェクトの dispatch メソッドを書き換えて、
     * すべてのイベントを onDispatchEvent でインターセプトできるようにする。
     *
     * MessageLoggerV2 では ZeresPluginLibrary の Patcher.instead を使用しているが、
     * Vencord では直接書き換える方式を採用。
     *
     * フラグ __ml_vencord_patched で二重パッチを防止する。
     */
    _patchDispatcher(): void {
        try {
            const _dispatcher = findByPropsLazy("dispatch", "subscribe") as any;
            if (!_dispatcher?.dispatch || _dispatcher.__ml_vencord_patched) return;

            this.__ml_original_dispatch = _dispatcher.dispatch.bind(_dispatcher);
            _dispatcher.dispatch = (...args: any[]) => {
                try {
                    // 全てのイベントを onDispatchEvent に委譲する。
                    // onDispatchEvent 内で callDefault() を呼ぶことで元の処理を実行する。
                    // これにより、イベントごとに「前処理」「後処理」「データの書き換え」を柔軟に制御できる。
                    if (this.onDispatchEvent) {
                        return this.onDispatchEvent(args, this.__ml_original_dispatch);
                    } else {
                        return this.__ml_original_dispatch(...args);
                    }
                } catch (e) {
                    logger.error("Dispatcher patch error", e);
                    try { return this.__ml_original_dispatch(...args); } catch { return undefined; }
                }
            };
            _dispatcher.__ml_vencord_patched = true;
            this.__ml_dispatcher = _dispatcher;
        } catch (e) {
            logger.error("Failed to patch Dispatcher", e);
        }
    },

    /**
     * Dispatcher の復元
     *
     * プラグイン停止時に元の dispatch メソッドを復元する。
     * これを忘れると Discord の動作に影響が出る可能性がある。
     */
    _restoreDispatcher(): void {
        try {
            if (!this.__ml_dispatcher || !this.__ml_original_dispatch) return;

            this.__ml_dispatcher.dispatch = this.__ml_original_dispatch;
            delete this.__ml_dispatcher.__ml_vencord_patched;
            this.__ml_dispatcher = undefined;
            this.__ml_original_dispatch = undefined;
        } catch (e) {
            logger.error("failed to restore dispatcher", e);
        }
    },

    /**
     * MessageCache 内でのメッセージ削除処理（patches.ts から呼ばれる）
     *
     * patches.ts の正規表現パッチから呼び出される。
     * キャッシュ内のメッセージに deleted: true フラグを設定し、
     * 同時に IndexedDB に保存する。
     *
     * 注意: patches.ts のパッチが Discord のアップデートで壊れることがあるため、
     * onDispatchEvent での処理も併用している（二重保険）。
     */
    handleDelete(cache: any, data: DeleteData, isBulk: boolean): any {
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
