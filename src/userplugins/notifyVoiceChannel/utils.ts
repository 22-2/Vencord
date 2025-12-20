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

import { ChannelStore, GuildStore } from "@webpack/common";
import { PLUGIN_NAME } from "./constants";
import type { ChannelDisplayInfo } from "./types";

export const Logger = {
    log: (...args: any[]) => console.log(`[${PLUGIN_NAME}]`, ...args),
    error: (...args: any[]) => console.error(`[${PLUGIN_NAME}]`, ...args),
};

export async function ensureCspPermission(
    url: string,
    type: "connect-src" | "media-src"
): Promise<boolean> {
    if (
        typeof VencordNative === "undefined" ||
        !VencordNative.csp?.requestAddOverride
    )
        return true;

    try {
        const isAllowed = await VencordNative.csp.isDomainAllowed(url, [type]);
        if (isAllowed) return true;

        const res = await VencordNative.csp.requestAddOverride(
            url,
            [type],
            PLUGIN_NAME
        );
        if (res === "ok") return true;

        Logger.error(`CSP permission denied for ${url} (${type})`);
        return false;
    } catch (e) {
        Logger.error(`Failed to request CSP override:`, e);
        return false;
    }
}

export function getChannelDisplayName(
    guildId: string,
    channelId: string,
    fallbackName?: string
): ChannelDisplayInfo {
    const guild = GuildStore.getGuild(guildId);
    const channel = ChannelStore.getChannel(channelId);

    return {
        guildName: guild?.name || "Unknown Server",
        channelName: fallbackName || channel?.name || "Unknown Channel",
    };
}

export function normalizeAudioPath(path: string): string {
    if (path.startsWith("http") || path.startsWith("file://")) {
        return path;
    }
    return "file:///" + path.replace(/\\/g, "/");
}
