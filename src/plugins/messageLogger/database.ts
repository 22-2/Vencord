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

import { Logger } from "@utils/Logger";
import { openDB } from "idb";

import { MessageLoggerDB, MLMessage } from "./types";

const logger = new Logger("MessageLogger");

/**
 * Database promise for IndexedDB operations
 */
export const dbPromise = openDB<MessageLoggerDB>("MessageLoggerDB", 2, {
  upgrade(db, oldVersion) {
    if (oldVersion < 1) {
      db.createObjectStore("settings");
    }
    if (oldVersion < 2) {
      const messageStore = db.createObjectStore("messages", { keyPath: "id" });
      messageStore.createIndex("by-channel", "channel_id");
    }
  },
});

/**
 * Saves a message to the database
 */
export async function saveMessage(message: MLMessage): Promise<void> {
  try {
    const db = await dbPromise;
    await db.put("messages", message);
  } catch (e) {
    logger.error("Failed to save message", e);
  }
}

/**
 * Retrieves all messages for a specific channel from the database
 */
export async function getMessagesForChannel(channelId: string): Promise<MLMessage[]> {
  try {
    const db = await dbPromise;
    return await db.getAllFromIndex("messages", "by-channel", channelId);
  } catch (e) {
    logger.error("Failed to get messages", e);
    return [];
  }
}

/**
 * Deletes a message from the database by ID
 */
export async function deleteMessageFromDB(messageId: string): Promise<void> {
  try {
    const db = await dbPromise;
    await db.delete("messages", messageId);
  } catch (e) {
    logger.error("Failed to delete message", e);
  }
}

/**
 * Retrieves all messages from the database
 */
export async function getAllMessages(): Promise<MLMessage[]> {
  try {
    const db = await dbPromise;
    return await db.getAll("messages");
  } catch (e) {
    logger.error("Failed to get all messages", e);
    return [];
  }
}

/**
 * Gets a list of unique channel IDs that have stored messages
 */
export async function getChannelIdsWithMessages(): Promise<string[]> {
  try {
    const db = await dbPromise;
    const messages = await db.getAll("messages");
    const channelIds = new Set<string>();
    for (const msg of messages) {
      if (msg.channel_id) {
        channelIds.add(msg.channel_id);
      }
    }
    return Array.from(channelIds);
  } catch (e) {
    logger.error("Failed to get channel IDs", e);
    return [];
  }
}

/**
 * Gets the total count of messages matching the filter criteria
 */
export async function getMessageCount(filter: {
  channelId?: string;
  deleted?: boolean;
  hasEditHistory?: boolean;
}): Promise<number> {
  try {
    const db = await dbPromise;
    let messages: MLMessage[];

    if (filter.channelId) {
      messages = await db.getAllFromIndex("messages", "by-channel", filter.channelId);
    } else {
      messages = await db.getAll("messages");
    }

    return messages.filter(msg => {
      if (filter.deleted !== undefined && msg.deleted !== filter.deleted) return false;
      if (filter.hasEditHistory && (!msg.editHistory || msg.editHistory.length === 0)) return false;
      return true;
    }).length;
  } catch (e) {
    logger.error("Failed to get message count", e);
    return 0;
  }
}

/**
 * Gets messages with pagination support
 */
export async function getMessagesPaginated(
  page: number,
  pageSize: number,
  filter: {
    channelId?: string;
    deleted?: boolean;
    hasEditHistory?: boolean;
  }
): Promise<MLMessage[]> {
  try {
    const db = await dbPromise;
    let messages: MLMessage[];

    if (filter.channelId) {
      messages = await db.getAllFromIndex("messages", "by-channel", filter.channelId);
    } else {
      messages = await db.getAll("messages");
    }

    // Apply filters
    let filtered = messages.filter(msg => {
      if (filter.deleted !== undefined && msg.deleted !== filter.deleted) return false;
      if (filter.hasEditHistory && (!msg.editHistory || msg.editHistory.length === 0)) return false;
      return true;
    });

    // Sort by timestamp (newest first)
    filtered.sort((a, b) => {
      const timeA = new Date(a.timestamp as any).getTime() || 0;
      const timeB = new Date(b.timestamp as any).getTime() || 0;
      return timeB - timeA;
    });

    // Apply pagination
    const start = page * pageSize;
    return filtered.slice(start, start + pageSize);
  } catch (e) {
    logger.error("Failed to get paginated messages", e);
    return [];
  }
}
