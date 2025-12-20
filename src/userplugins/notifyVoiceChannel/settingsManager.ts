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
import { PLUGIN_NAME } from "./constants";
import { Logger } from "./utils";
import type { PluginConfig, TargetChannel } from "./types";

export class SettingsManager {
    private static get config(): PluginConfig {
        return Settings.plugins[PLUGIN_NAME] as unknown as PluginConfig;
    }

    static getChannels(): TargetChannel[] {
        try {
            return JSON.parse(this.config.channels || "[]");
        } catch (e) {
            Logger.error("Failed to parse channels setting:", e);
            return [];
        }
    }

    static setChannels(channels: TargetChannel[]): void {
        this.config.channels = JSON.stringify(channels);
    }

    static addChannel(guildId: string, channelId: string, name: string): void {
        const channels = this.getChannels();
        const exists = channels.some(
            (c) => c.guildId === guildId && c.channelId === channelId
        );

        if (!exists) {
            channels.push({ guildId, channelId, name });
            this.setChannels(channels);
        }
    }

    static removeChannel(guildId: string, channelId: string): void {
        const channels = this.getChannels().filter(
            (c) => !(c.guildId === guildId && c.channelId === channelId)
        );
        this.setChannels(channels);
    }

    static isIgnoredUser(userId: string): boolean {
        const ignored = (this.config.ignoredUserIds || "").split(",");
        return ignored.map((id) => id.trim()).includes(userId);
    }

    static isTargetChannel(
        guildId: string,
        channelId: string
    ): TargetChannel | undefined {
        return this.getChannels().find(
            (t) => t.guildId === guildId && t.channelId === channelId
        );
    }

    static getConfig(): PluginConfig {
        return this.config;
    }
}
