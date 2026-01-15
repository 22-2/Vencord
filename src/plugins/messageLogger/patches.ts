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

/**
 * All Webpack patches for the MessageLogger plugin
 */
export const patches = [
  {
    // MessageStore
    find: '"MessageStore"',
    replacement: [
      {
        // Add deleted=true to all target messages in the MESSAGE_DELETE event
        match: /function (?=.+?MESSAGE_DELETE:(\i))\1\((\i)\){let.+?((?:\i\.){2})getOrCreate.+?}(?=function)/,
        replace:
          "function $1($2){" +
          "   var cache = $3getOrCreate($2.channelId);" +
          "   cache = $self.handleDelete(cache, $2, false);" +
          "   $3commit(cache);" +
          "}"
      },
      {
        // Add deleted=true to all target messages in the MESSAGE_DELETE_BULK event
        match: /function (?=.+?MESSAGE_DELETE_BULK:(\i))\1\((\i)\){let.+?((?:\i\.){2})getOrCreate.+?}(?=function)/,
        replace:
          "function $1($2){" +
          "   var cache = $3getOrCreate($2.channelId);" +
          "   cache = $self.handleDelete(cache, $2, true);" +
          "   $3commit(cache);" +
          "}"
      },
      {
        // Add current cached content + new edit time to cached message's editHistory
        match: /(function (\i)\((\i)\).+?)\.update\((\i)(?=.*MESSAGE_UPDATE:\2)/,
        replace: "$1" +
          ".update($4,m =>{" +
          "   if ((($3.message.flags & 64) === 64 || $self.shouldIgnore($3.message, true))) return m;" +
          "   if ($3.message.edited_timestamp && $3.message.content !== m.content) {" +
          "       const updated = m.set('editHistory',[...(m.editHistory || []), $self.makeEdit($3.message, m)]);" +
          "       $self.saveMessage(updated.toJS());" +
          "       return updated;" +
          "   }" +
          "   return m;" +
          "})" +
          ".update($4"
      },
      {
        // fix up key (edit last message) attempting to edit a deleted message
        match: /(?<=getLastEditableMessage\(\i\)\{.{0,200}\.find\((\i)=>)/,
        replace: "!$1.deleted &&"
      }
    ]
  },

  {
    // Message domain model
    find: "}addReaction(",
    replacement: [
      {
        match: /this\.customRenderedContent=(\i)\.customRenderedContent,/,
        replace: "this.customRenderedContent = $1.customRenderedContent," +
          "this.deleted = $1.deleted || false," +
          "this.editHistory = $1.editHistory || []," +
          "this.firstEditTimestamp = $1.firstEditTimestamp || this.editedTimestamp || this.timestamp,"
      }
    ]
  },

  {
    // Updated message transformer
    find: "THREAD_STARTER_MESSAGE?null==",
    replacement: [
      {
        // Pass through editHistory & deleted & original attachments to the "edited message" transformer
        match: /(?<=null!=\i\.edited_timestamp\)return )\i\(\i,\{reactions:(\i)\.reactions.{0,50}\}\)/,
        replace:
          "Object.assign($&,{ deleted:$1.deleted, editHistory:$1.editHistory, firstEditTimestamp:$1.firstEditTimestamp })"
      },
      {
        // Construct new edited message and add editHistory & deleted
        // Pass in custom data to attachment parser to mark attachments deleted as well
        match: /attachments:(\i)\((\i)\)/,
        replace:
          "attachments: $1((() =>{" +
          "   if ($self.shouldIgnore($2)) return $2;" +
          "   let old = arguments[1]?.attachments;" +
          "   if (!old) return $2;" +
          "   let new_ = $2.attachments?.map(a => a.id) ?? [];" +
          "   let diff = old.filter(a => !new_.includes(a.id));" +
          "   old.forEach(a => a.deleted = true);" +
          "   $2.attachments = [...diff, ...$2.attachments];" +
          "   return $2;" +
          "})())," +
          "deleted: arguments[1]?.deleted," +
          "editHistory: arguments[1]?.editHistory," +
          "firstEditTimestamp: new Date(arguments[1]?.firstEditTimestamp ?? $2.editedTimestamp ?? $2.timestamp)"
      },
      {
        // Preserve deleted attribute on attachments
        match: /(\((\i)\){return null==\2\.attachments.+?)spoiler:/,
        replace:
          "$1deleted: arguments[0]?.deleted," +
          "spoiler:"
      }
    ]
  },

  {
    // Attachment renderer
    find: ".removeMosaicItemHoverButton",
    replacement: [
      {
        match: /\[\i\.obscured\]:.+?,(?<=item:(\i).+?)/,
        replace: '$&"messagelogger-deleted-attachment":$1.originalItem?.deleted,'
      }
    ]
  },

  {
    // Base message component renderer
    find: "Message must not be a thread starter message",
    replacement: [
      {
        // Append messagelogger-deleted to classNames if deleted
        match: /\)\("li",\{(.+?),className:/,
        replace: ")(\"li\",{$1,className:(arguments[0].message.deleted ? \"messagelogger-deleted \" : \"\")+"
      }
    ]
  },

  {
    // Message content renderer
    find: ".SEND_FAILED,",
    replacement: {
      // Render editHistory behind the message content
      match: /\.isFailed]:.+?children:\[/,
      replace: "$&arguments[0]?.message?.editHistory?.length>0&&$self.renderEdits(arguments[0]),"
    }
  },

  {
    find: "#{intl::MESSAGE_EDITED}",
    replacement: {
      // Make edit marker clickable
      match: /"span",\{(?=className:\i\.edited,)/,
      replace: "$self.EditMarker,{message:arguments[0].message,"
    }
  },

  {
    // ReferencedMessageStore
    find: '"ReferencedMessageStore"',
    replacement: [
      {
        match: /MESSAGE_DELETE:\i,/,
        replace: "MESSAGE_DELETE:()=>{},"
      },
      {
        match: /MESSAGE_DELETE_BULK:\i,/,
        replace: "MESSAGE_DELETE_BULK:()=>{},"
      }
    ]
  },

  {
    // Message context base menu
    find: ".MESSAGE,commandTargetId:",
    replacement: [
      {
        // Remove the first section if message is deleted
        match: /children:(\[""{2}===.+?\])/,
        replace: "children:arguments[0].message.deleted?[]:$1"
      }
    ]
  },
  {
    // Message grouping
    find: "NON_COLLAPSIBLE.has(",
    replacement: {
      match: /if\((\i)\.blocked\)return \i\.\i\.MESSAGE_GROUP_BLOCKED;/,
      replace: '$&else if($1.deleted) return"MESSAGE_GROUP_DELETED";',
    },
    predicate: () => Settings.plugins.MessageLogger.collapseDeleted
  },
  {
    // Message group rendering
    find: "#{intl::NEW_MESSAGES_ESTIMATED_WITH_DATE}",
    replacement: [
      {
        match: /(\i).type===\i\.\i\.MESSAGE_GROUP_BLOCKED\|\|/,
        replace: '$&$1.type==="MESSAGE_GROUP_DELETED"||',
      },
      {
        match: /(\i).type===\i\.\i\.MESSAGE_GROUP_BLOCKED\?.*?:/,
        replace: '$&$1.type==="MESSAGE_GROUP_DELETED"?$self.DELETED_MESSAGE_COUNT:',
      },
    ],
    predicate: () => Settings.plugins.MessageLogger.collapseDeleted
  }
];
