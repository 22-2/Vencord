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

export interface TargetChannel {
    guildId: string;
    channelId: string;
    name: string;
}

export interface VoiceStateUpdate {
    userId: string;
    guildId: string;
    channelId?: string;
    oldChannelId?: string;
    [key: string]: any;
}

export interface PluginConfig {
    userKey: string;
    apiToken: string;
    channels: string;
    notifySelf: boolean;
    playAudio: boolean;
    audioPath: string;
    ignoredUserIds: string;
    notifyOnEmpty: boolean;
    notificationDelay: number;
}

export interface ChannelDisplayInfo {
    guildName: string;
    channelName: string;
}
