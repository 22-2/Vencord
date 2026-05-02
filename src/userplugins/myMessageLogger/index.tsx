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

import "./myMessageLogger.css";

import { ApplicationCommandInputType, sendBotMessage } from "@api/Commands";
import { Settings } from "@api/Settings";
import { Devs, SUPPORT_CATEGORY_ID, VENBOT_USER_ID } from "@utils/constants";
import { Logger } from "@utils/Logger";
import definePlugin from "@utils/types";
import { Message } from "@vencord/discord-types";
import { findByPropsLazy } from "@webpack";
import {
    ChannelStore,
    FluxDispatcher,
    MessageStore,
    SelectedChannelStore,
    UserStore,
} from "@webpack/common";

import { EditMarker, getDeletedMessageCountFormat, renderEdits } from "./components";
import {
    patchChannelContextMenu,
    patchChannelMonitoringContextMenu,
    patchGuildContextMenu,
    patchMessageContextMenu,
} from "./contextMenus";
import {
    deleteMessageFromDB,
    getAllMessages,
    getMessagesForChannel,
    saveMessage,
} from "./database";
import { openLogViewerModal } from "./LogViewerModal";
import { isMonitored, loadMonitoringSettings } from "./monitoring";
import { options } from "./options";
import { patches } from "./patches";
import { addDeleteStyle } from "./styles";
import {
    makeEdit,
    normalizePersistedMessage,
    parseEditContent,
    reAddDeletedMessages,
} from "./utils";
import { DeleteData, LoadMessagesAction, MyMLMessage } from "./types";

// Re-export for external use
export { parseEditContent } from "./utils";

const logger = new Logger("MyMessageLogger");

type ChannelSelectEvent = { channelId?: string };
type DispatchFunction = (...args: readonly unknown[]) => unknown;
type DispatchEvent = LoadMessagesAction | { type?: string };
type IgnorableMessage = Pick<Partial<Message>, "author" | "channel_id" | "flags">;

interface DispatcherLike {
    dispatch: DispatchFunction;
}

interface DispatcherOwner {
    _dispatcher?: DispatcherLike;
}

interface CachedAttachment {
    deleted?: boolean;
}

interface CachedMessageRecord {
    channel_id: string;
    flags: number;
    attachments: CachedAttachment[];
    set(key: "deleted", value: boolean): CachedMessageRecord;
    set(key: "attachments", value: CachedAttachment[]): CachedMessageRecord;
    toJS(): MyMLMessage;
}

interface MessageCacheLike {
    has(id: string | undefined): boolean;
    get(id: string): CachedMessageRecord | undefined;
    remove(id: string): MessageCacheLike;
    update(id: string, updater: (message: CachedMessageRecord) => CachedMessageRecord): MessageCacheLike;
}

function isLoadMessagesAction(dispatch: DispatchEvent): dispatch is LoadMessagesAction {
    return typeof (dispatch as LoadMessagesAction).channelId === "string" && Array.isArray((dispatch as LoadMessagesAction).messages);
}

/**
 * MyMessageLogger Plugin - 削除・編集されたメッセージを永続化して表示するプラグイン
 *
 * ## アーキテクチャ概要 (MyMessageLoggerV2に準拠)
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
    name: "MyMessageLogger",
    description: "Temporarily logs deleted and edited messages.",
    tags: ["Chat", "Utility"],
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

    // 復元は dispatch の同期タイミングで差し込む必要があるため、永続化済みメッセージを
    // 先にメモリへ載せておき、以後はそのキャッシュだけを更新して追従する。
    _persistedMessagesByChannel: new Map<string, MyMLMessage[]>(),
    _dispatcher: null as DispatcherLike | null,
    _originalDispatch: null as DispatchFunction | null,
    _onChannelSelect: null as ((event: ChannelSelectEvent) => void) | null,

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

        // Discord がロード payload を MessageStore へ流し込む前に差し込みたいので、
        // 後追いで store を触るのではなく dispatch 自体を先にフックする。
        this.patchDispatcher();
        void this.hydratePersistedMessages();

        // 一部のチャンネル切替では Discord 内部タイミング次第で load patch を踏まないため、
        // 現在見えている配列へ軽く再差し込みする保険を残す。重い再構築は表示ジャンプを起こすので避ける。
        this._onChannelSelect = (event) => {
            const selectedChannelId = event?.channelId ?? SelectedChannelStore.getChannelId();
            if (!selectedChannelId) return;

            const replaySelectedChannel = () => {
                if (SelectedChannelStore.getChannelId() !== selectedChannelId) return;
                this.restoreSelectedChannelMessages();
            };

            queueMicrotask(replaySelectedChannel);
            requestAnimationFrame(replaySelectedChannel);
        };
        FluxDispatcher.subscribe("CHANNEL_SELECT", this._onChannelSelect);
    },

    stop(): void {
        if (this._onChannelSelect) {
            FluxDispatcher.unsubscribe("CHANNEL_SELECT", this._onChannelSelect);
            this._onChannelSelect = null;
        }
        this.restoreDispatcher();
    },

    /**
     * IndexedDB は非同期だが、復元差し込みは同期で走らせたい。
     * そのため起動時に全件をメモリへ積み、以後の復元経路を同期化する。
     */
    async hydratePersistedMessages(): Promise<void> {
        try {
            const allMessages = await getAllMessages();
            const next = new Map<string, MyMLMessage[]>();

            for (const message of allMessages) {
                normalizePersistedMessage(message);
                const channelMessages = next.get(message.channel_id) ?? [];
                channelMessages.push(message);
                next.set(message.channel_id, channelMessages);
            }

            this._persistedMessagesByChannel = next;

            // 起動直後は IDB 読み込み完了より先に最初のチャンネル描画が走ることがある。
            // 読み込み完了後に現在チャンネルへ一度だけ軽く再差し込みして、
            // 削除済み表示が次のチャンネル移動まで消えたままになるのを防ぐ。
            this.restoreSelectedChannelMessages();
        } catch (e) {
            logger.error("Failed to hydrate persisted messages", e);
        }
    },

    /**
     * 現在表示中のメッセージ配列に対して、永続化済みメッセージだけを差し込む軽量復元経路。
     * store 全体を組み直さないので、スクロール位置や仮想リストのアンカーを壊しにくい。
     */
    restoreSelectedChannelMessages(): void {
        try {
            const channelId = SelectedChannelStore.getChannelId();
            if (!channelId) return;

            const messages = MessageStore.getMessages(channelId)?._array;
            if (!messages?.length) return;

            const beforeLength = messages.length;
            this.injectPersistedMessages({
                channelId,
                messages,
                // いま見えている範囲だけを対象にして、同じ window に属する履歴だけ差し戻す。
                hasMoreBefore: true,
                hasMoreAfter: true,
                isBefore: false,
                isAfter: false,
            });

            if (messages.length !== beforeLength) {
                MessageStore.emitChange();
            }
        } catch (e) {
            logger.error("Failed to restore selected channel messages", e);
        }
    },

    /**
     * ライブ削除で保存内容が変わったら、IDB だけでなくメモリ側の復元キャッシュも即更新する。
     * これをしないと、次の読み込みまで古い内容を差し戻してしまう。
     */
    upsertPersistedMessage(message: MyMLMessage): void {
        if (!message?.channel_id) return;

        normalizePersistedMessage(message);

        const channelMessages = this._persistedMessagesByChannel.get(message.channel_id) ?? [];
        const existingIndex = channelMessages.findIndex(existing => existing.id === message.id);

        if (existingIndex === -1) {
            channelMessages.push(message);
        } else {
            channelMessages[existingIndex] = message;
        }

        this._persistedMessagesByChannel.set(message.channel_id, channelMessages);
    },

    removePersistedMessage(messageId: string, channelId?: string): void {
        if (!messageId) return;

        if (channelId) {
            const channelMessages = this._persistedMessagesByChannel.get(channelId);
            if (!channelMessages) return;

            this._persistedMessagesByChannel.set(
                channelId,
                channelMessages.filter(message => message.id !== messageId),
            );
            return;
        }

        for (const [persistedChannelId, channelMessages] of this._persistedMessagesByChannel) {
            const nextMessages = channelMessages.filter(message => message.id !== messageId);
            if (nextMessages.length !== channelMessages.length) {
                this._persistedMessagesByChannel.set(persistedChannelId, nextMessages);
                return;
            }
        }
    },

    /**
     * MLV2 と同様に、Discord がこれから commit する配列そのものへ差し込む。
     * 後段で store 全体を書き換えるより、並び順とスクロール位置が安定する。
     */
    injectPersistedMessages(action: LoadMessagesAction): void {
        const channelId = action.channelId;
        const { messages } = action;
        if (!channelId || !messages?.length) return;

        const savedMessages = this._persistedMessagesByChannel.get(channelId) ?? [];
        if (!savedMessages.length) return;

        reAddDeletedMessages(
            messages,
            savedMessages,
            !action.hasMoreAfter && !action.isBefore,
            !action.hasMoreBefore && !action.isAfter,
        );
    },

    /**
     * 差し込みは元の dispatch より前でないと MessageStore が削除済みメッセージを見失う。
     * ここを後ろにすると、復元はできても表示位置が不安定になりやすい。
     */
    patchDispatcher(): void {
        if (this._originalDispatch) return;

        try {
            const dispatcherOwner = findByPropsLazy("_dispatcher") as DispatcherOwner | undefined;
            const dispatcher = dispatcherOwner?._dispatcher ?? findByPropsLazy("dispatch", "subscribe");

            if (!dispatcher?.dispatch) return;

            this._dispatcher = dispatcher;
            this._originalDispatch = dispatcher.dispatch.bind(dispatcher);
            dispatcher.dispatch = (...args) => this.onDispatchEvent(args, this._originalDispatch!);
        } catch (e) {
            logger.error("Failed to patch dispatcher", e);
        }
    },

    restoreDispatcher(): void {
        if (!this._dispatcher || !this._originalDispatch) return;

        this._dispatcher.dispatch = this._originalDispatch;
        this._dispatcher = null;
        this._originalDispatch = null;
    },

    onDispatchEvent(args: readonly unknown[], callDefault: DispatchFunction) {
        const dispatch = args[0] as DispatchEvent | undefined;
        if (!dispatch) return callDefault(...args);

        try {
            if (
                dispatch.type === "LOAD_MESSAGES_SUCCESS"
                || dispatch.type === "LOAD_MESSAGES_AROUND_SUCCESS"
            ) {
                if (!isLoadMessagesAction(dispatch)) return callDefault(...args);
                this.injectPersistedMessages(dispatch);
            }
        } catch (e) {
            logger.error("Failed to inject persisted messages", e);
        }

        return callDefault(...args);
    },

    /**
     * 削除イベントを MessageStore のキャッシュへ反映する。
     * ここで DB 保存とメモリキャッシュ更新も同時に済ませ、復元経路の状態を一箇所に揃える。
     */
    handleDelete(cache: MessageCacheLike | null | undefined, data: DeleteData, isBulk: boolean): MessageCacheLike | null | undefined {
        try {
            if (cache == null || (!isBulk && !cache.has(data.id))) return cache;

            const mutate = (id: string) => {
                const currentCache = cache;
                if (!currentCache) return;

                const msg = currentCache.get(id);
                if (!msg) return;

                const EPHEMERAL = 64;
                const shouldIgnore = data.mlDeleted ||
                    (msg.flags & EPHEMERAL) === EPHEMERAL ||
                    this.shouldIgnore(msg);

                if (shouldIgnore) {
                    cache = currentCache.remove(id);
                    deleteMessageFromDB(id);
                    // 手動削除や ignore 対象は復元キャッシュからも即座に消し、
                    // 後続の jump / channel load で復活しないようにする。
                    this.removePersistedMessage(id, msg.channel_id);
                } else {
                    cache = currentCache.update(id, (m) => {
                        const updated = m
                            .set("deleted", true)
                            .set("attachments", m.attachments.map((attachment) => (attachment.deleted = true, attachment)));
                        const persistedMessage = updated.toJS();
                        saveMessage(persistedMessage);
                        this.upsertPersistedMessage(persistedMessage);
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
    shouldIgnore(message: IgnorableMessage, isEdit = false): boolean {
        try {
            const {
                ignoreBots,
                ignoreSelf,
                ignoreUsers,
                ignoreChannels,
                ignoreGuilds,
                logEdits,
                logDeletes
            } = Settings.plugins.MyMessageLogger;

            const channelId = message.channel_id;
            if (!channelId) return false;

            const myId = UserStore.getCurrentUser().id;
            const channel = ChannelStore.getChannel(channelId);

            // Check if channel is monitored
            if (!isMonitored(channel?.guild_id, channelId)) {
                return true;
            }

            return (
                (ignoreBots && message.author?.bot) ||
                (ignoreSelf && message.author?.id === myId) ||
                ignoreUsers.includes(message.author?.id) ||
                ignoreChannels.includes(channelId) ||
                ignoreChannels.includes(channel?.parent_id ?? "") ||
                (isEdit ? !logEdits : !logDeletes) ||
                ignoreGuilds.includes(channel?.guild_id ?? "") ||
                // Ignore Venbot in the support channels
                (message.author?.id === VENBOT_USER_ID && channel?.parent_id === SUPPORT_CATEGORY_ID)
            );
        } catch {
            return false;
        }
    },
});
