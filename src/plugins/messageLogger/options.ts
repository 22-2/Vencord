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

import { OptionType } from "@utils/types";

import { addDeleteStyle } from "./styles";

/**
 * Plugin options configuration
 */
export const options = {
  deleteStyle: {
    type: OptionType.SELECT as const,
    description: "The style of deleted messages",
    options: [
      { label: "Red text", value: "text", default: true },
      { label: "Red overlay", value: "overlay" }
    ],
    onChange: () => addDeleteStyle()
  },
  logDeletes: {
    type: OptionType.BOOLEAN as const,
    description: "Whether to log deleted messages",
    default: true,
  },
  collapseDeleted: {
    type: OptionType.BOOLEAN as const,
    description: "Whether to collapse deleted messages, similar to blocked messages",
    default: false,
    restartNeeded: true,
  },
  logEdits: {
    type: OptionType.BOOLEAN as const,
    description: "Whether to log edited messages",
    default: true,
  },
  inlineEdits: {
    type: OptionType.BOOLEAN as const,
    description: "Whether to display edit history as part of message content",
    default: true
  },
  ignoreBots: {
    type: OptionType.BOOLEAN as const,
    description: "Whether to ignore messages by bots",
    default: false
  },
  ignoreSelf: {
    type: OptionType.BOOLEAN as const,
    description: "Whether to ignore messages by yourself",
    default: false
  },
  ignoreUsers: {
    type: OptionType.STRING as const,
    description: "Comma-separated list of user IDs to ignore",
    default: ""
  },
  ignoreChannels: {
    type: OptionType.STRING as const,
    description: "Comma-separated list of channel IDs to ignore",
    default: ""
  },
  ignoreGuilds: {
    type: OptionType.STRING as const,
    description: "Comma-separated list of guild IDs to ignore",
    default: ""
  },
};
