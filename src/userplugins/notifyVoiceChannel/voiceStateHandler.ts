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

import { GuildMemberStore, UserStore, VoiceStateStore } from "@webpack/common";
import { NotificationService } from "./notificationService";
import { SettingsManager } from "./settingsManager";
import { getChannelDisplayName } from "./utils";
import type { VoiceStateUpdate } from "./types";

export class VoiceStateHandler {
    static handleUpdates(voiceStates: VoiceStateUpdate[]): void {
        if (!voiceStates) return;

        const currentUserId = UserStore.getCurrentUser()?.id;
        const { notifyOnEmpty, notifySelf } = SettingsManager.getConfig();

        for (const state of voiceStates) {
            this.handleChannelEmpty(state, notifyOnEmpty);
            this.handleChannelJoin(state, currentUserId, notifySelf);
        }
    }

    private static handleChannelEmpty(
        state: VoiceStateUpdate,
        notifyOnEmpty: boolean
    ): void {
        if (!notifyOnEmpty) return;

        const { guildId, channelId, oldChannelId } = state;

        if (!oldChannelId || oldChannelId === channelId) return;

        const target = SettingsManager.isTargetChannel(guildId, oldChannelId);
        if (!target) return;

        const states = VoiceStateStore.getVoiceStatesForChannel(oldChannelId);
        if (!states || Object.keys(states).length === 0) {
            const { guildName, channelName } = getChannelDisplayName(
                guildId,
                oldChannelId,
                target.name
            );
            NotificationService.queue(
                `${guildName} の「${channelName}」が0人になりました`
            );
        }
    }

    private static handleChannelJoin(
        state: VoiceStateUpdate,
        currentUserId: string,
        notifySelf: boolean
    ): void {
        const { guildId, channelId, userId, oldChannelId } = state;

        if (!channelId || channelId === oldChannelId) return;

        const target = SettingsManager.isTargetChannel(guildId, channelId);
        if (!target) return;

        if (
            this.shouldSkipNotification(
                userId,
                currentUserId,
                guildId,
                channelId,
                notifySelf
            )
        ) {
            return;
        }

        const user = UserStore.getUser(userId);
        const nick = guildId ? GuildMemberStore.getNick(guildId, userId) : null;
        const userName = nick || user?.globalName || user?.username || "Unknown User";
        const { guildName, channelName } = getChannelDisplayName(
            guildId,
            channelId,
            target.name
        );

        NotificationService.queue(
            `${userName} が ${guildName} の「${channelName}」で通話を開始しました！`
        );
    }

    private static shouldSkipNotification(
        userId: string,
        currentUserId: string,
        guildId: string,
        channelId: string,
        notifySelf: boolean
    ): boolean {
        // 自分が既に参加しているチャンネルに誰かが来た場合はスキップ
        const myVoiceState = VoiceStateStore.getVoiceState(
            guildId,
            currentUserId
        );
        const amIInChannel = myVoiceState?.channelId === channelId;
        if (userId !== currentUserId && amIInChannel) return true;

        // 自分自身の通知設定
        if (userId === currentUserId && !notifySelf) return true;

        // 除外ユーザー
        if (SettingsManager.isIgnoredUser(userId)) return true;

        return false;
    }
}
