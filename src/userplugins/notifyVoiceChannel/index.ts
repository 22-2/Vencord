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

import { NavContextMenuPatchCallback } from "@api/ContextMenu";
import definePlugin, { OptionType } from "@utils/types";
import { Menu, React } from "@webpack/common";

import { GUILD_VOICE_CHANNEL_TYPE, PLUGIN_NAME } from "./constants";
import { SettingsManager } from "./settingsManager";
import { VoiceStateHandler } from "./voiceStateHandler";
import type { VoiceStateUpdate } from "./types";

const patchChannelContextMenu: NavContextMenuPatchCallback = (
    children,
    { channel }
) => {
    if (!channel || channel.type !== GUILD_VOICE_CHANNEL_TYPE) return;

    const { guild_id: guildId, id: channelId, name: channelName } = channel;
    const isTarget = SettingsManager.isTargetChannel(guildId, channelId);

    children.push(
        React.createElement(Menu.MenuItem, {
            id: "notify-voice-channel-toggle",
            label: isTarget ? "ボイチャ通知を解除" : "ボイチャ通知を登録",
            action: () => {
                if (isTarget) {
                    SettingsManager.removeChannel(guildId, channelId);
                } else {
                    SettingsManager.addChannel(guildId, channelId, channelName);
                }
            },
        })
    );
};

export default definePlugin({
    name: PLUGIN_NAME,
    description:
        "指定したチャンネルの通話開始時や0人になった時に通知を送信します。",
    authors: [{ name: "Mondego", id: 0n }],

    options: {
        userKey: {
            type: OptionType.STRING,
            description: "Pushover User Key",
            default: "",
        },
        apiToken: {
            type: OptionType.STRING,
            description: "Pushover API Token",
            default: "",
        },
        channels: {
            type: OptionType.STRING,
            description: "監視対象チャンネル (内部データ)",
            default: "[]",
        },
        notifySelf: {
            type: OptionType.BOOLEAN,
            description: "自分自身の入室も通知する",
            default: false,
        },
        playAudio: {
            type: OptionType.BOOLEAN,
            description: "通知時に音声を再生する",
            default: false,
        },
        audioPath: {
            type: OptionType.STRING,
            description:
                "再生する音声のURLまたはパス (https://... または file:///...)",
            default: "",
        },
        ignoredUserIds: {
            type: OptionType.STRING,
            description: "通知を除外するユーザーID (カンマ区切り)",
            default: "",
        },
        notifyOnEmpty: {
            type: OptionType.BOOLEAN,
            description: "チャンネルが0人になったら通知する",
            default: false,
        },
        notificationDelay: {
            type: OptionType.NUMBER,
            description: "通知をまとめる待機時間 (ミリ秒)",
            default: 3000,
        },
    },

    contextMenus: {
        "channel-context": patchChannelContextMenu,
    },

    flux: {
        VOICE_STATE_UPDATES({
            voiceStates,
        }: {
            voiceStates: VoiceStateUpdate[];
        }) {
            VoiceStateHandler.handleUpdates(voiceStates);
        },
    },
});
