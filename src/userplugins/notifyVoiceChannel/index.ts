/*
 * Vencord, a modification for Discord's desktop app
 * Copyright (c) 2024 Vendicated and contributors
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

import { showNotification } from "@api/Notifications";
import { Settings } from "@api/Settings";
import { Devs } from "@utils/constants";
import definePlugin, { OptionType } from "@utils/types";
import { ChannelStore, GuildStore, UserStore, VoiceStateStore } from "@webpack/common";

interface TargetChannel {
    guildId: string;
    channelId: string;
    name: string;
}

async function sendPushoverNotification(title: string, message: string) {
    const { userKey, apiToken } = Settings.plugins.NotifyVoiceChannel;
    if (!userKey || !apiToken) return;

    try {
        await fetch("https://api.pushover.net/1/messages.json", {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
                token: apiToken,
                user: userKey,
                message,
                title,
            }),
        });
    } catch (error) {
        console.error("Error sending Pushover notification:", error);
    }
}

export default definePlugin({
    name: "NotifyVoiceChannel",
    description: "通話開始時に通知を送信します。",
    authors: [{ name: "Mondego", id: 0n }],

    options: {
        userKey: {
            type: OptionType.STRING,
            description: "Pushover User Key",
            default: ""
        },
        apiToken: {
            type: OptionType.STRING,
            description: "Pushover API Token",
            default: ""
        },
        channels: {
            type: OptionType.STRING,
            description: "監視対象チャンネル (JSON: [{\"guildId\":\"...\",\"channelId\":\"...\",\"name\":\"...\"}])",
            default: "[]"
        }
    },

    flux: {
        VOICE_STATE_UPDATES({ voiceStates }) {
            if (!voiceStates) return;

            let targets: TargetChannel[] = [];
            try {
                targets = JSON.parse(Settings.plugins.NotifyVoiceChannel.channels || "[]");
            } catch (e) {
                console.error("Failed to parse NotifyVoiceChannel channels:", e);
                return;
            }

            const myId = UserStore.getCurrentUser()?.id;

            for (const state of voiceStates) {
                const { guildId, channelId, userId, oldChannelId } = state;

                // チャンネルに入った（または移動した）場合のみ処理
                if (!channelId || channelId === oldChannelId) continue;

                // ターゲットチャンネルかチェック
                const target = targets.find(t => t.guildId === guildId && t.channelId === channelId);
                if (!target) continue;

                // 自分の場合はスキップ
                if (userId === myId) continue;

                const user = UserStore.getUser(userId);
                const userName = user?.globalName || user?.username || "Unknown User";
                const guild = GuildStore.getGuild(guildId!);
                const guildName = guild?.name || "Unknown Server";

                const channel = ChannelStore.getChannel(channelId);
                const channelName = target.name || channel?.name || "Unknown Channel";

                const message = `${userName} が ${guildName} の「${channelName}」で通話を開始しました！`;

                showNotification({
                    title: "ボイチャ通知",
                    body: message
                });

                sendPushoverNotification("Discordボイチャ通知", message);
            }
        }
    }
});
