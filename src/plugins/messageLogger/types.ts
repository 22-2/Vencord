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
import { DBSchema } from "idb";

export interface MLMessage extends Message {
  deleted?: boolean;
  editHistory?: { timestamp: Date | any; content: string; }[];
  firstEditTimestamp?: Date | any;
  edited_timestamp?: any;
  delete_data?: { hidden?: boolean; };
}

export interface MessageLoggerDB extends DBSchema {
  settings: {
    key: string;
    value: boolean;
  };
  messages: {
    key: string;
    value: MLMessage;
    indexes: { "by-channel": string; };
  };
}

export interface LoadMessagesAction {
  channelId: string;
  messages: any[];
  hasMoreBefore?: boolean;
  hasMoreAfter?: boolean;
  isBefore?: boolean;
  isAfter?: boolean;
}

export interface DeleteData {
  ids?: string[];
  id?: string;
  mlDeleted?: boolean;
  channelId?: string;
  channel_id?: string;
  message?: any;
  payload?: any;
}
