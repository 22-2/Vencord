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
import { findByPropsLazy } from "@webpack";
import {
    ChannelStore,
    FluxDispatcher,
    MessageCache,
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

    // Intent: restore on message loads must be synchronous at dispatch time, so
    // we hydrate persisted records into memory once and keep that cache updated.
    _persistedMessagesByChannel: new Map<string, MyMLMessage[]>(),
    _dispatcher: null as any,
    _originalDispatch: null as ((...args: any[]) => any) | null,
    _onChannelSelect: null as ((event: { channelId?: string }) => void) | null,

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

        // Intent: dispatcher restoration must run before MessageStore consumes the
        // load payload, so we patch dispatch itself instead of rebuilding caches later.
        this.patchDispatcher();
        void this.hydratePersistedMessages();

        // Intent: some channel switches still miss the patched load path depending
        // on Discord's internal timing. Use a lightweight replay against the current
        // store window instead of rebuilding MessageCache, which causes list jumps.
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
     * Intent: IndexedDB is async, but dispatch injection must be sync.
     * Hydrate everything into memory up front so restore paths can stay synchronous.
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

            // Intent: IDB hydration is async, so the first channel load after a
            // Discord restart can happen before persisted messages are ready.
            // Re-apply restore logic to the currently selected channel once the
            // cache is hydrated so deleted styling does not disappear until the
            // user manually changes channels.
            this.restoreSelectedChannelMessages();

            // Intent: on cold start, also rebuild the current channel cache from IDB
            // to ensure deleted flags are visible even if early load events were missed.
            const currentChannelId = SelectedChannelStore.getChannelId();
            if (currentChannelId) {
                void this.restoreChannelCacheFromDB(currentChannelId);
            }
        } catch (e) {
            logger.error("Failed to hydrate persisted messages", e);
        }
    },

    /**
     * Fallback restore path for startup/channel-switch timing issues.
     * Rebuild the channel MessageCache from current cache + IDB persisted records.
     */
    async restoreChannelCacheFromDB(channelId: string): Promise<void> {
        try {
            const persisted = await getMessagesForChannel(channelId);
            if (!persisted.length) return;

            let cache = MessageCache.getOrCreate(channelId);
            const currentMessages = cache.toArray();
            const mergedById = new Map<string, any>();

            for (const message of currentMessages) {
                mergedById.set(message.id, message);
            }

            for (const message of persisted) {
                normalizePersistedMessage(message);
                mergedById.set(message.id, message);
                this.upsertPersistedMessage(message);
            }

            const sortedMessages = Array.from(mergedById.values()).sort((a, b) => {
                const timeA = typeof a?.timestamp?.valueOf === "function"
                    ? a.timestamp.valueOf()
                    : new Date(a?.timestamp ?? 0).valueOf();
                const timeB = typeof b?.timestamp?.valueOf === "function"
                    ? b.timestamp.valueOf()
                    : new Date(b?.timestamp ?? 0).valueOf();
                return timeA - timeB;
            });

            for (const message of currentMessages) {
                cache = cache.remove(message.id);
            }

            for (const message of sortedMessages) {
                cache = cache.receiveMessage(message);
            }

            MessageCache.commit(cache);
            MessageStore.emitChange();
        } catch (e) {
            logger.error("Failed to restore channel cache from DB", e);
        }
    },

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
                // Treat the current store contents as a bounded window so we only
                // reinsert persisted messages that belong inside the visible slice.
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
     * Intent: keep the in-memory restore cache aligned with writes performed by
     * live delete handling so restored messages are available without another reload.
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
     * Intent: MLV2's stable behavior comes from mutating the exact load window
     * Discord is about to commit, instead of rebuilding MessageCache afterwards.
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
     * Intent: injection must happen before the original dispatch so MessageStore
     * consumes the augmented payload and keeps the virtual list anchor stable.
     */
    patchDispatcher(): void {
        if (this._originalDispatch) return;

        try {
            const dispatcherOwner = findByPropsLazy("_dispatcher") as any;
            const dispatcher = dispatcherOwner?._dispatcher ?? findByPropsLazy("dispatch", "subscribe");

            if (!dispatcher?.dispatch) return;

            this._dispatcher = dispatcher;
            this._originalDispatch = dispatcher.dispatch.bind(dispatcher);
            dispatcher.dispatch = (...args: any[]) => this.onDispatchEvent(args, this._originalDispatch!);
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

    onDispatchEvent(args: any[], callDefault: (...dispatchArgs: any[]) => any) {
        const dispatch = args[0];
        if (!dispatch) return callDefault(...args);

        try {
            if (
                dispatch.type === "LOAD_MESSAGES_SUCCESS"
                || dispatch.type === "LOAD_MESSAGES_AROUND_SUCCESS"
            ) {
                this.injectPersistedMessages(dispatch);
            }
        } catch (e) {
            logger.error("Failed to inject persisted messages", e);
        }

        return callDefault(...args);
    },

    /**
     * Handles message deletion in the cache
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
                    // Intent: manual removal or ignored messages should disappear from
                    // the restore cache immediately so later jumps do not resurrect them.
                    this.removePersistedMessage(id, msg.channel_id);
                } else {
                    cache = cache.update(id, (m: any) => {
                        const updated = m
                            .set("deleted", true)
                            .set("attachments", m.attachments.map((a: any) => (a.deleted = true, a)));
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
            } = Settings.plugins.MyMessageLogger;

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
