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

import { findGroupChildrenByChildId, NavContextMenuPatchCallback } from "@api/ContextMenu";
import { updateMessage } from "@api/MessageUpdater";
import { FluxDispatcher, Menu, MessageStore } from "@webpack/common";

import { deleteMessageFromDB } from "./database";
import { getMonitoringValue, setMonitoring } from "./monitoring";
import { MLMessage } from "./types";

const MENU_IDS = {
  REMOVE_HISTORY: "ml-remove-history",
  TOGGLE_DELETE_STYLE: "ml-toggle-style",
  MONITOR_GUILD: "ml-monitor-guild",
  MONITOR_CHANNEL: "ml-monitor-channel",
  MONITOR_CHANNEL_ENABLE: "ml-monitor-channel-enable",
  MONITOR_CHANNEL_DISABLE: "ml-monitor-channel-disable",
  MONITOR_CHANNEL_RESET: "ml-monitor-channel-reset",
  CLEAR_CHANNEL: "vc-ml-clear-channel",
} as const;

/**
 * Context menu patch for individual messages
 */
export const patchMessageContextMenu: NavContextMenuPatchCallback = (children, props) => {
  const { message } = props;
  const { deleted, editHistory, id, channel_id } = message;

  if (!deleted && !editHistory?.length) return;

  // Add toggle delete style option for deleted messages
  if (deleted) {
    const domElement = document.getElementById(`chat-messages-${channel_id}-${id}`);
    if (domElement) {
      children.push((
        <Menu.MenuItem
          id={MENU_IDS.TOGGLE_DELETE_STYLE}
          key={MENU_IDS.TOGGLE_DELETE_STYLE}
          label="Toggle Deleted Highlight"
          action={() => domElement.classList.toggle("messagelogger-deleted")}
        />
      ));
    }
  }

  // Add remove history option
  children.push((
    <Menu.MenuItem
      id={MENU_IDS.REMOVE_HISTORY}
      key={MENU_IDS.REMOVE_HISTORY}
      label="Remove Message History"
      color="danger"
      action={() => {
        if (deleted) {
          FluxDispatcher.dispatch({
            type: "MESSAGE_DELETE",
            channelId: channel_id,
            id,
            mlDeleted: true
          });
        } else {
          message.editHistory = [];
          deleteMessageFromDB(id);
        }
      }}
    />
  ));
};

/**
 * Context menu patch for clearing channel log
 */
export const patchChannelContextMenu: NavContextMenuPatchCallback = (children, { channel }) => {
  const messages = MessageStore.getMessages(channel?.id) as MLMessage[];
  if (!messages?.some(msg => msg.deleted || msg.editHistory?.length)) return;

  const group = findGroupChildrenByChildId("mark-channel-read", children) ?? children;
  group.push(
    <Menu.MenuItem
      id={MENU_IDS.CLEAR_CHANNEL}
      label="Clear Message Log"
      color="danger"
      action={() => {
        messages.forEach(msg => {
          if (msg.deleted) {
            FluxDispatcher.dispatch({
              type: "MESSAGE_DELETE",
              channelId: channel.id,
              id: msg.id,
              mlDeleted: true
            });
          } else {
            updateMessage(channel.id, msg.id, {
              editHistory: []
            });
            deleteMessageFromDB(msg.id);
          }
        });
      }}
    />
  );
};

/**
 * Context menu patch for guild monitoring
 */
export const patchGuildContextMenu: NavContextMenuPatchCallback = (children, { guild }) => {
  if (!guild) return;
  const monitored = getMonitoringValue(`guild:${guild.id}`);

  children.push(
    <Menu.MenuItem
      id={MENU_IDS.MONITOR_GUILD}
      label={monitored ? "Stop Logging this Server" : "Log this Server"}
      action={() => setMonitoring("guild", guild.id, !monitored)}
    />
  );
};

/**
 * Context menu patch for channel monitoring
 */
export const patchChannelMonitoringContextMenu: NavContextMenuPatchCallback = (children, { channel }) => {
  if (!channel) return;
  const monitored = getMonitoringValue(`channel:${channel.id}`);
  const inherited = getMonitoringValue(`guild:${channel.guild_id}`);

  children.push(
    <Menu.MenuItem
      id={MENU_IDS.MONITOR_CHANNEL}
      label="Message Logger"
    >
      <Menu.MenuItem
        id={MENU_IDS.MONITOR_CHANNEL_ENABLE}
        label="Enable Logging"
        disabled={monitored === true}
        action={() => setMonitoring("channel", channel.id, true)}
      />
      <Menu.MenuItem
        id={MENU_IDS.MONITOR_CHANNEL_DISABLE}
        label="Disable Logging"
        disabled={monitored === false}
        action={() => setMonitoring("channel", channel.id, false)}
      />
      <Menu.MenuItem
        id={MENU_IDS.MONITOR_CHANNEL_RESET}
        label={`Reset to Server Default (${inherited ? "Logging" : "Not Logging"})`}
        disabled={monitored === undefined}
        action={() => setMonitoring("channel", channel.id, null)}
      />
    </Menu.MenuItem>
  );
};
