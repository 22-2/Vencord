/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { Logger } from "@utils/Logger";
import definePlugin, { OptionType, PluginNative } from "@utils/types";
import { sendMessage } from "@utils/discord";
import { ChannelStore, GuildChannelStore, GuildStore } from "@webpack/common";

const Native = VencordNative.pluginHelpers.DMSpeakBridge as PluginNative<typeof import("./native")>;
const logger = new Logger("DMSpeakBridge");

// メッセージ送信可能なテキスト系チャンネルタイプだけ通すっす
// 0: GUILD_TEXT, 5: GUILD_ANNOUNCEMENT, 10/11/12: スレッド, 15: フォーラム
const TEXT_CHANNEL_TYPES = new Set([0, 5, 10, 11, 12, 15]);

const settings = definePluginSettings({
    port: {
        type: OptionType.NUMBER,
        description: "ローカルHTTPサーバーのポート(Python側と一致させる)",
        default: 60315,
    },
});

interface ChannelInfo {
    id: string;
    name: string;
    parent?: string | null;
}

function buildState() {
    const guilds = Object.values(GuildStore.getGuilds())
        .map(g => ({ id: g.id, name: g.name }))
        .sort((a, b) => a.name.localeCompare(b.name));

    const channelsByGuild: Record<string, ChannelInfo[]> = {};
    for (const g of guilds) {
        const list = GuildChannelStore.getChannels(g.id);
        // SELECTABLE: テキスト系の選択可能チャンネル(カテゴリは除外済み)
        const selectable = (list?.SELECTABLE ?? []) as Array<{ channel: any; comparator?: number; }>;
        const channels: ChannelInfo[] = [];
        for (const entry of selectable) {
            const ch = entry.channel;
            if (!TEXT_CHANNEL_TYPES.has(ch.type)) continue;
            const parentId = ch.parent_id ?? null;
            const parentCh = parentId ? ChannelStore.getChannel(parentId) : null;
            channels.push({
                id: ch.id,
                name: ch.name,
                parent: parentCh?.name ?? null,
            });
        }
        channelsByGuild[g.id] = channels;
    }

    // DM/グループDMはChannelStore.getSortedPrivateChannels()で全部取れるっす
    const dmsRaw = (ChannelStore as any).getSortedPrivateChannels?.() ?? [];
    const dms: ChannelInfo[] = dmsRaw.map((ch: any) => ({
        id: ch.id,
        // 個別DMはrecipientの名前、グループDMはname or recipient結合っす
        name:
            ch.name ||
            (ch.rawRecipients ?? ch.recipients ?? [])
                .map((u: any) => u.global_name || u.username || u.id)
                .join(", ") ||
            ch.id,
    }));

    return { guilds, dms, channelsByGuild, updatedAt: Date.now() };
}

let stateInterval: ReturnType<typeof setInterval> | null = null;
let pollRunning = false;

async function pollLoop() {
    pollRunning = true;
    while (pollRunning) {
        try {
            const items = await Native.pollPending(30_000);
            for (const item of items) {
                try {
                    sendMessage(item.channelId, { content: item.content });
                } catch (e) {
                    logger.error("sendMessage失敗:", e);
                }
            }
        } catch (e) {
            logger.error("pollPending失敗:", e);
            // 連続失敗時の暴走防止に少し待つっす
            await new Promise(r => setTimeout(r, 2000));
        }
    }
}

async function pushState() {
    try {
        await Native.updateState(buildState());
    } catch (e) {
        logger.error("updateState失敗:", e);
    }
}

export default definePlugin({
    name: "DMSpeakBridge",
    description: "Pythonからの指示で任意のチャンネル/DMにメッセージを投稿する橋渡しっす",
    authors: [{ name: "dm-speak", id: 0n }],
    settings,

    async start() {
        const port = settings.store.port;
        try {
            await Native.start(port);
            logger.info(`HTTP server listening on 127.0.0.1:${port}`);
        } catch (e) {
            logger.error("start失敗:", e);
            return;
        }
        await pushState();
        // 5秒ごとに状態を更新するっす。サーバー/チャンネル変動を反映するためっす
        stateInterval = setInterval(pushState, 5000);
        pollLoop();
    },

    stop() {
        pollRunning = false;
        if (stateInterval) {
            clearInterval(stateInterval);
            stateInterval = null;
        }
    },
});
