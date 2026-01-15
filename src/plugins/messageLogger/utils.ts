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

import { Message } from "@vencord/discord-types";
import { moment, Parser, SelectedChannelStore } from "@webpack/common";

import { MLMessage } from "./types";

/** Discord Epoch: 2015-01-01 00:00:00 UTC */
const DISCORD_EPOCH = 1420070400000;

/**
 * Converts a Discord snowflake ID to a Unix timestamp
 */
export function snowflakeTime(id: string): number {
  try {
    return Number((BigInt(id) >> 22n)) + DISCORD_EPOCH;
  } catch {
    // Fallback approximation for older environments
    return Math.floor(Number(id) / 4194304) + DISCORD_EPOCH;
  }
}

/**
 * Gets the timestamp from a message object in milliseconds
 */
export function msgTime(msg: any): number {
  if (!msg) return 0;

  if (msg.timestamp && typeof msg.timestamp === "object" && typeof msg.timestamp.valueOf === "function") {
    return msg.timestamp.valueOf();
  }
  if (typeof msg.timestamp === "string" || typeof msg.timestamp === "number") {
    return new Date(msg.timestamp).valueOf();
  }
  if (msg.id) {
    return snowflakeTime(msg.id);
  }
  return 0;
}

/**
 * Normalizes persisted message data, converting string timestamps to moment objects
 */
export function normalizePersistedMessage(msg: any): void {
  if (!msg) return;

  // Convert string timestamps to moment objects
  if (typeof msg.timestamp === "string") {
    msg.timestamp = moment(msg.timestamp);
  }

  // Handle snake_case edited_timestamp from persisted data
  if (msg.edited_timestamp != null && msg.editedTimestamp == null) {
    msg.editedTimestamp = msg.edited_timestamp;
  }
  if (typeof msg.editedTimestamp === "string") {
    msg.editedTimestamp = moment(msg.editedTimestamp) as any;
  }

  if (typeof msg.firstEditTimestamp === "string") {
    msg.firstEditTimestamp = moment(msg.firstEditTimestamp) as any;
  }

  // Normalize edit history timestamps
  if (Array.isArray(msg.editHistory)) {
    for (const edit of msg.editHistory) {
      if (typeof edit?.timestamp === "string") {
        edit.timestamp = moment(edit.timestamp) as any;
      }
    }
  }
}

/**
 * Parses message content for edit display
 */
export function parseEditContent(content: string, message: Message) {
  return Parser.parse(content, true, {
    channelId: message.channel_id,
    messageId: message.id,
    allowLinks: true,
    allowHeading: true,
    allowList: true,
    allowEmojiLinks: true,
    viewingChannelId: SelectedChannelStore.getChannelId(),
  });
}

/**
 * Creates an edit record from old and new message content
 */
export function makeEdit(newMessage: any, oldMessage: any): { timestamp: Date; content: string; } {
  return {
    timestamp: new Date(newMessage.edited_timestamp),
    content: oldMessage.content
  };
}

/**
 * Helper function to find the last matching index in an array
 */
function findLastIndex<T>(arr: T[], pred: (v: T) => boolean): number {
  let l = arr.length;
  while (l--) {
    if (pred(arr[l])) return l;
  }
  return -1;
}

/**
 * Re-adds deleted messages from saved messages into the current messages array
 * Uses MLV2-like logic to splice persisted messages into the proper positions
 */
export function reAddDeletedMessages(
  messages: any[],
  savedMessages: MLMessage[],
  channelStart: boolean,
  channelEnd: boolean
): void {
  if (!messages.length || !savedMessages.length) return;

  const IDs: { id: string; time: number; }[] = [];
  const savedIDs: { id: string; time: number; }[] = [];

  // Build ID list from current messages
  for (const msg of messages) {
    IDs.push({ id: msg.id, time: msgTime(msg) });
  }

  // Build ID list from saved messages, filtering out hidden ones
  for (const rec of savedMessages) {
    const id = rec.id;
    const candidate = (rec as any).message ? (rec as any).message : rec;
    if (!candidate) continue;
    if (candidate.delete_data?.hidden) continue;
    savedIDs.push({ id, time: msgTime(candidate) });
  }

  if (!savedIDs.length) return;

  // Sort saved by time ascending (oldest -> newest)
  savedIDs.sort((a, b) => a.time - b.time);

  const msgTimes = IDs.map(x => x.time);
  const msgMin = Math.min(...msgTimes);
  const msgMax = Math.max(...msgTimes);

  const lowestIDX = channelEnd ? 0 : savedIDs.findIndex(e => e.time > msgMin);
  if (lowestIDX === -1) {
    // logger.info("[DEBUG] reAddDeletedMessages: lowestIDX is -1 (msgMin:", msgMin, ")");
    return;
  }

  const highestIDX = channelStart ? savedIDs.length - 1 : findLastIndex(savedIDs, e => e.time < msgMax);
  if (highestIDX === -1) {
    // logger.info("[DEBUG] reAddDeletedMessages: highestIDX is -1 (msgMax:", msgMax, ")");
    return;
  }

  const windowSaved = savedIDs.slice(lowestIDX, highestIDX + 1);

  // Determine original message order (newest-first if first >= last)
  const originalNewestFirst = IDs[0].time >= IDs[IDs.length - 1].time;

  // Build merge list and sort to match original ordering
  const merge = [
    ...windowSaved.map(x => ({ id: x.id, time: x.time })),
    ...IDs.map(x => ({ id: x.id, time: x.time }))
  ];
  merge.sort((a, b) => originalNewestFirst ? b.time - a.time : a.time - b.time);

  // Insert missing messages at proper positions
  for (let i = 0; i < merge.length; i++) {
    const { id } = merge[i];
    if (messages.findIndex(m => m.id === id) !== -1) continue;

    const saved = savedMessages.find(m =>
      (m.id || ((m as any).message && (m as any).message.id)) === id
    );
    if (!saved) continue;

    const toInsert = (saved as any).message ? (saved as any).message : saved;
    messages.splice(i, 0, toInsert);
  }
}
