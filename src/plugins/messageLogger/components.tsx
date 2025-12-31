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

import { Settings } from "@api/Settings";
import ErrorBoundary from "@components/ErrorBoundary";
import { getIntlMessage } from "@utils/discord";
import { classes } from "@utils/misc";
import { Message } from "@vencord/discord-types";
import { findByPropsLazy } from "@webpack";
import { MessageStore, Timestamp, useStateFromStores } from "@webpack/common";

import { openHistoryModal } from "./HistoryModal";
import { MLMessage } from "./types";
import { parseEditContent } from "./utils";

const styles = findByPropsLazy("edited", "communicationDisabled", "isSystemMessage");

/**
 * Renders the edit history for a message inline
 */
export const renderEdits = ErrorBoundary.wrap(
  ({ message: { id: messageId, channel_id: channelId } }: { message: Message; }) => {
    const message = useStateFromStores(
      [MessageStore],
      () => MessageStore.getMessage(channelId, messageId) as MLMessage,
      null,
      (oldMsg, newMsg) => oldMsg?.editHistory === newMsg?.editHistory
    );

    if (!Settings.plugins.MessageLogger.inlineEdits) return null;

    return (
      <>
        {message.editHistory?.map((edit, idx) => (
          <div key={idx} className="messagelogger-edited">
            {parseEditContent(edit.content, message)}
            <Timestamp
              timestamp={edit.timestamp}
              isEdited={true}
              isInline={false}
            >
              <span className={styles.edited}>
                {" "}({getIntlMessage("MESSAGE_EDITED")})
              </span>
            </Timestamp>
          </div>
        ))}
      </>
    );
  },
  { noop: true }
);

interface EditMarkerProps {
  message: Message;
  className?: string;
  children?: React.ReactNode;
  [key: string]: any;
}

/**
 * Clickable edit marker component that opens the history modal
 */
export function EditMarker({ message, className, children, ...props }: EditMarkerProps) {
  return (
    <span
      {...props}
      className={classes("messagelogger-edit-marker", className)}
      onClick={() => openHistoryModal(message)}
      role="button"
    >
      {children}
    </span>
  );
}

/**
 * Generates the deleted message count intl message format
 * Format: "{count, plural, =0 {No deleted messages} one {{count} deleted message} other {{count} deleted messages}}"
 */
export function getDeletedMessageCountFormat() {
  return {
    ast: [[
      6,
      "count",
      {
        "=0": ["No deleted messages"],
        one: [
          [1, "count"],
          " deleted message"
        ],
        other: [
          [1, "count"],
          " deleted messages"
        ]
      },
      0,
      "cardinal"
    ]]
  };
}
