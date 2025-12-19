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

import { Settings } from "@api/Settings";
import { Devs } from "@utils/constants";
import definePlugin, { OptionType } from "@utils/types";
import { ChannelStore, GuildStore, Menu, React, UserStore, VoiceStateStore } from "@webpack/common";
import { NavContextMenuPatchCallback } from "@api/ContextMenu";

const PLUGIN_NAME = "NotifyVoiceChannel";

interface TargetChannel {
    guildId: string;
    channelId: string;
    name: string;
}

function getTargets(): TargetChannel[] {
    try {
        return JSON.parse(Settings.plugins[PLUGIN_NAME].channels || "[]");
    } catch (e) {
        console.error(`[${PLUGIN_NAME}] Failed to parse channels:`, e);
        return [];
    }
}

function setTargets(targets: TargetChannel[]) {
    Settings.plugins[PLUGIN_NAME].channels = JSON.stringify(targets);
}

async function sendPushoverNotification(title: string, message: string) {
    const { userKey, apiToken } = Settings.plugins[PLUGIN_NAME];
    if (!userKey || !apiToken) return;

    const url = "https://api.pushover.net/1/messages.json";

    // Bypass CSP if possible
    if (typeof VencordNative !== "undefined" && VencordNative.csp?.requestAddOverride) {
        const isAllowed = await VencordNative.csp.isDomainAllowed(url, ["connect-src"]);
        if (!isAllowed) {
            const res = await VencordNative.csp.requestAddOverride(url, ["connect-src"], PLUGIN_NAME);
            if (res !== "ok") {
                console.error(`[${PLUGIN_NAME}] CSP permission denied for Pushover API`);
                return;
            }
        }
    }

    try {
        await fetch(url, {
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
        console.error(`[${PLUGIN_NAME}] Error sending Pushover notification:`, error);
    }
}

let pendingNotifications: Array<string | undefined | null> = [];
let notificationTimeout: number | null = null;

async function flushNotifications() {
    if (pendingNotifications.length === 0) return;

    const notifications = pendingNotifications
        .map(v => typeof v === "string" ? v : v == null ? "" : String(v))
        .map(v => v.trim())
        .filter(Boolean);

    pendingNotifications = [];
    notificationTimeout = null;

    if (notifications.length === 0) return;

    const message = notifications.length > 1
        ? "複数の入室を確認しました:\n" + notifications.join("\n")
        : notifications[0];

    // Native Notification
    if ("Notification" in window) {
        if (Notification.permission === "granted") {
            new Notification("ボイチャ通知", { body: message });
        } else if (Notification.permission !== "denied") {
            Notification.requestPermission().then(permission => {
                if (permission === "granted") {
                    new Notification("ボイチャ通知", { body: message });
                }
            });
        }
    }

    // Audio Playback
    const { playAudio, audioPath } = Settings.plugins[PLUGIN_NAME];
    if (playAudio && audioPath) {
        let path = audioPath;
        if (!path.startsWith("http") && !path.startsWith("file://")) {
            path = "file:///" + path.replace(/\\/g, "/");
        }

        // Request CSP override for media-src
        if (typeof VencordNative !== "undefined" && VencordNative.csp?.requestAddOverride) {
            try {
                const isAllowed = await VencordNative.csp.isDomainAllowed(path, ["media-src"]);
                if (!isAllowed) {
                    await VencordNative.csp.requestAddOverride(path, ["media-src"], PLUGIN_NAME);
                }
            } catch (error) {
                console.error(`[${PLUGIN_NAME}] Failed to request CSP override:`, error);
            }
        }

        new Audio(path).play().catch(e => console.error(`[${PLUGIN_NAME}] Failed to play audio:`, e));
    }

    // Pushover
    sendPushoverNotification("Discordボイチャ通知", message);
}

function queueNotification(message: unknown) {
    const normalized = typeof message === "string" ? message : message == null ? "" : String(message);
    const trimmed = normalized.trim();
    if (!trimmed) return;

    pendingNotifications.push(trimmed);
    if (notificationTimeout === null) {
        const delay = Settings.plugins[PLUGIN_NAME].notificationDelay ?? 3000;
        notificationTimeout = window.setTimeout(flushNotifications, delay);
    }
}

function getChannelInfo(guildId: string, channelId: string, targetName?: string) {
    const guild = GuildStore.getGuild(guildId);
    const guildName = guild?.name || "Unknown Server";
    const channel = ChannelStore.getChannel(channelId);
    const channelName = targetName || channel?.name || "Unknown Channel";
    return { guildName, channelName };
}

const patchChannelContextMenu: NavContextMenuPatchCallback = (children, { channel }) => {
    if (!channel || channel.type !== 2) return; // 2 is GUILD_VOICE

    const guildId = channel.guild_id;
    const channelId = channel.id;
    const channelName = channel.name;

    const targets = getTargets();
    const isTarget = targets.some(t => t.guildId === guildId && t.channelId === channelId);

    children.push(React.createElement(Menu.MenuItem, {
        id: "notify-voice-channel-toggle",
        label: isTarget ? "ボイチャ通知を解除" : "ボイチャ通知を登録",
        action: () => {
            if (isTarget) {
                setTargets(targets.filter(t => !(t.guildId === guildId && t.channelId === channelId)));
            } else {
                targets.push({ guildId, channelId, name: channelName });
                setTargets(targets);
            }
        }
    }));
};

export default definePlugin({
    name: PLUGIN_NAME,
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
        },
        notifySelf: {
            type: OptionType.BOOLEAN,
            description: "自分自身の入室も通知する",
            default: false
        },
        playAudio: {
            type: OptionType.BOOLEAN,
            description: "通知時に音声を再生する",
            default: false
        },
        audioPath: {
            type: OptionType.STRING,
            description: "再生する音声のURLまたはパス (https://.../file.mp3)",
            default: ""
        },
        ignoredUserIds: {
            type: OptionType.STRING,
            description: "除外するユーザーID (カンマ区切り)",
            default: ""
        },
        notifyOnEmpty: {
            type: OptionType.BOOLEAN,
            description: "0人になったら通知する",
            default: false
        },
        notificationDelay: {
            type: OptionType.NUMBER,
            description: "通知をまとめる待機時間 (ミリ秒)",
            default: 3000
        }
    },

    contextMenus: {
        "channel-context": patchChannelContextMenu
    },

    flux: {
        VOICE_STATE_UPDATES({ voiceStates }) {
            if (!voiceStates) return;

            const targets = getTargets();
            const settings = Settings.plugins[PLUGIN_NAME];
            const myId = UserStore.getCurrentUser()?.id;
            const ignoredIds = settings.ignoredUserIds.split(",").map(id => id.trim()).filter(id => id);

            for (const state of voiceStates) {
                const { guildId, channelId, userId, oldChannelId } = state;

                // Handle Channel Empty
                if (oldChannelId && settings.notifyOnEmpty) {
                    const target = targets.find(t => t.guildId === guildId && t.channelId === oldChannelId);
                    if (target) {
                        const currentVoiceStates = VoiceStateStore.getVoiceStatesForChannel(oldChannelId);
                        if (!currentVoiceStates || Object.keys(currentVoiceStates).length === 0) {
                            const { guildName, channelName } = getChannelInfo(guildId!, oldChannelId, target.name);
                            queueNotification(`${guildName} の「${channelName}」が0人になりました`);
                        }
                    }
                }

                // Handle User Join/Move
                if (!channelId || channelId === oldChannelId) continue;

                const target = targets.find(t => t.guildId === guildId && t.channelId === channelId);
                if (!target) continue;

                // Don't notify if I'm already in the channel
                if (userId !== myId && VoiceStateStore.getVoiceState(guildId, myId)?.channelId === channelId) continue;

                if (userId === myId && !settings.notifySelf) continue;
                if (ignoredIds.includes(userId)) continue;

                const user = UserStore.getUser(userId);
                const userName = user?.globalName || user?.username || "Unknown User";
                const { guildName, channelName } = getChannelInfo(guildId!, channelId, target.name);

                queueNotification(`${userName} が ${guildName} の「${channelName}」で通話を開始しました！`);
            }
        }
    }
});
