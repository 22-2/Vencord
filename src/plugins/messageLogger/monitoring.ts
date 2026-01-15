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

import { dbPromise } from "./database";

/** In-memory cache for monitoring settings */
const monitoringCache = new Map<string, boolean>();

/**
 * Loads monitoring settings from the database into memory
 */
export async function loadMonitoringSettings(): Promise<void> {
  const db = await dbPromise;
  const keys = await db.getAllKeys("settings");
  for (const key of keys) {
    const val = await db.get("settings", key);
    if (val !== undefined) {
      monitoringCache.set(key, val);
    }
  }
}

/**
 * Sets the monitoring status for a guild or channel
 * @param type - "guild" or "channel"
 * @param id - The ID of the guild or channel
 * @param enabled - true/false to enable/disable, null to reset to default
 */
export async function setMonitoring(
  type: "guild" | "channel",
  id: string,
  enabled: boolean | null
): Promise<void> {
  const key = `${type}:${id}`;
  const db = await dbPromise;

  if (enabled === null) {
    await db.delete("settings", key);
    monitoringCache.delete(key);
  } else {
    await db.put("settings", enabled, key);
    monitoringCache.set(key, enabled);
  }
}

/**
 * Checks if a channel/guild is being monitored
 * @param guildId - The guild ID (can be undefined for DMs)
 * @param channelId - The channel ID
 * @returns true if monitoring is enabled
 */
export function isMonitored(guildId: string | undefined, channelId: string): boolean {
  const channelKey = `channel:${channelId}`;
  if (monitoringCache.has(channelKey)) {
    return monitoringCache.get(channelKey)!;
  }

  if (guildId) {
    const guildKey = `guild:${guildId}`;
    if (monitoringCache.has(guildKey)) {
      return monitoringCache.get(guildKey)!;
    }
  }

  return false;
}

/**
 * Gets the raw monitoring cache value for a key
 */
export function getMonitoringValue(key: string): boolean | undefined {
  return monitoringCache.get(key);
}
