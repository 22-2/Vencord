/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { classNameFactory } from "@api/Styles";
import ErrorBoundary from "@components/ErrorBoundary";
import { Margins } from "@utils/margins";
import { classes } from "@utils/misc";
import {
  ModalCloseButton,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalProps,
  ModalRoot,
  ModalSize,
  openModal
} from "@utils/modal";
import { findByPropsLazy } from "@webpack";
import {
  Button,
  ChannelStore,
  Forms,
  GuildStore,
  moment,
  ScrollerThin,
  Select,
  TabBar,
  Text,
  Timestamp,
  useEffect,
  useMemo,
  UserStore,
  useState
} from "@webpack/common";

import { getAllMessages, getChannelIdsWithMessages } from "./database";
import { openHistoryModal } from "./HistoryModal";
import { MLMessage } from "./types";

const CodeContainerClasses = findByPropsLazy("markup", "codeContainer");
const MiscClasses = findByPropsLazy("messageContent", "markupRtl");

const cl = classNameFactory("vc-ml-viewer-");

export function openLogViewerModal() {
  openModal(props => (
    <ErrorBoundary>
      <LogViewerModal modalProps={props} />
    </ErrorBoundary>
  ));
}

interface ChannelOption {
  value: string;
  label: string;
}

function LogViewerModal({ modalProps }: { modalProps: ModalProps; }) {
  const [currentTab, setCurrentTab] = useState<"deleted" | "edited">("deleted");
  const [selectedChannel, setSelectedChannel] = useState<string>("all");
  const [messages, setMessages] = useState<MLMessage[]>([]);
  const [channelOptions, setChannelOptions] = useState<ChannelOption[]>([]);
  const [loading, setLoading] = useState(true);

  // Load channel list and messages on mount
  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        // Get all channel IDs that have messages
        const channelIds = await getChannelIdsWithMessages();
        const options: ChannelOption[] = [{ value: "all", label: "All Channels" }];

        for (const id of channelIds) {
          const channel = ChannelStore.getChannel(id);
          if (channel) {
            const guild = channel.guild_id ? GuildStore.getGuild(channel.guild_id) : null;
            const label = guild
              ? `${guild.name} > #${channel.name}`
              : channel.name || `DM (${id})`;
            options.push({ value: id, label });
          } else {
            options.push({ value: id, label: `Unknown Channel (${id})` });
          }
        }

        setChannelOptions(options);

        // Load all messages
        const allMessages = await getAllMessages();
        setMessages(allMessages);
      } catch (e) {
        console.error("[MessageLogger] Failed to load messages:", e);
      }
      setLoading(false);
    })();
  }, []);

  // Filter messages based on current tab and selected channel
  const filteredMessages = useMemo(() => {
    let filtered = messages;

    // Filter by channel
    if (selectedChannel !== "all") {
      filtered = filtered.filter(m => m.channel_id === selectedChannel);
    }

    // Filter by type (deleted or edited)
    if (currentTab === "deleted") {
      filtered = filtered.filter(m => m.deleted);
    } else {
      filtered = filtered.filter(m => m.editHistory && m.editHistory.length > 0);
    }

    // Sort by timestamp (newest first)
    filtered = filtered.sort((a, b) => {
      const timeA = moment(a.timestamp).valueOf();
      const timeB = moment(b.timestamp).valueOf();
      return timeB - timeA;
    });

    return filtered;
  }, [messages, selectedChannel, currentTab]);

  return (
    <ModalRoot {...modalProps} size={ModalSize.LARGE}>
      <ModalHeader className={cl("head")}>
        <Text variant="heading-lg/semibold" style={{ flexGrow: 1 }}>
          Message Logger Viewer
        </Text>
        <ModalCloseButton onClick={modalProps.onClose} />
      </ModalHeader>

      <ModalContent className={cl("contents")}>
        {/* Tab Bar */}
        <TabBar
          type="top"
          look="brand"
          className={classes("vc-settings-tab-bar", cl("tab-bar"))}
          selectedItem={currentTab}
          onItemSelect={setCurrentTab}
        >
          <TabBar.Item className="vc-settings-tab-bar-item" id="deleted">
            Deleted Messages
          </TabBar.Item>
          <TabBar.Item className="vc-settings-tab-bar-item" id="edited">
            Edited Messages
          </TabBar.Item>
        </TabBar>

        {/* Channel Filter */}
        <div className={classes(Margins.top16, Margins.bottom16)}>
          <Forms.FormTitle>Filter by Channel</Forms.FormTitle>
          <Select
            options={channelOptions}
            isSelected={v => v === selectedChannel}
            select={v => setSelectedChannel(v)}
            serialize={v => v}
            placeholder="Select a channel..."
          />
        </div>

        {/* Message List */}
        {loading ? (
          <div style={{ textAlign: "center", padding: "20px" }}>
            <Text variant="text-md/normal">Loading messages...</Text>
          </div>
        ) : filteredMessages.length === 0 ? (
          <div style={{ textAlign: "center", padding: "20px" }}>
            <Text variant="text-md/normal">No messages found.</Text>
          </div>
        ) : (
          <ScrollerThin style={{ maxHeight: "400px" }}>
            {filteredMessages.map(msg => (
              <MessageCard
                key={msg.id}
                message={msg}
                showEditHistory={currentTab === "edited"}
              />
            ))}
          </ScrollerThin>
        )}
      </ModalContent>

      <ModalFooter>
        <Text variant="text-sm/normal" style={{ color: "var(--text-muted)" }}>
          Total: {filteredMessages.length} messages
        </Text>
      </ModalFooter>
    </ModalRoot>
  );
}

function MessageCard({ message, showEditHistory }: { message: MLMessage; showEditHistory: boolean; }) {
  const author = UserStore.getUser(message.author?.id);
  const channel = ChannelStore.getChannel(message.channel_id);
  const guild = channel?.guild_id ? GuildStore.getGuild(channel.guild_id) : null;

  const authorName = author?.username || message.author?.username || "Unknown User";
  const channelName = channel?.name || "Unknown Channel";
  const guildName = guild?.name || "";

  return (
    <div
      className={cl("message-card")}
      style={{
        padding: "12px",
        marginBottom: "8px",
        backgroundColor: message.deleted
          ? "rgba(240, 71, 71, 0.1)"
          : "rgba(250, 168, 26, 0.1)",
        borderRadius: "8px",
        border: message.deleted
          ? "1px solid rgba(240, 71, 71, 0.3)"
          : "1px solid rgba(250, 168, 26, 0.3)"
      }}
    >
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "8px" }}>
        <div>
          <Text variant="text-md/semibold">{authorName}</Text>
          <Text variant="text-xs/normal" style={{ color: "var(--text-muted)" }}>
            {guildName ? `${guildName} > #${channelName}` : channelName}
          </Text>
        </div>
        <div style={{ textAlign: "right" }}>
          <Text variant="text-xs/normal" style={{ color: "var(--text-muted)" }}>
            {moment(message.timestamp).format("YYYY-MM-DD HH:mm:ss")}
          </Text>
          {message.deleted && (
            <Text variant="text-xs/semibold" style={{ color: "#f04747" }}>
              DELETED
            </Text>
          )}
        </div>
      </div>

      {/* Content */}
      <div
        className={classes(CodeContainerClasses.markup, MiscClasses.messageContent)}
        style={{ wordBreak: "break-word" }}
      >
        {message.content || <em style={{ color: "var(--text-muted)" }}>No text content</em>}
      </div>

      {/* Attachments */}
      {message.attachments && message.attachments.length > 0 && (
        <div style={{ marginTop: "8px" }}>
          <Text variant="text-xs/semibold" style={{ color: "var(--text-muted)" }}>
            Attachments: {message.attachments.length}
          </Text>
          {message.attachments.map((att: any, i: number) => (
            <div key={i} style={{ fontSize: "12px", color: "var(--text-muted)" }}>
              📎 {att.filename || att.url || "Unknown"}
            </div>
          ))}
        </div>
      )}

      {/* Edit History Button */}
      {showEditHistory && message.editHistory && message.editHistory.length > 0 && (
        <div style={{ marginTop: "8px" }}>
          <Button
            size={Button.Sizes.SMALL}
            onClick={() => openHistoryModal(message)}
          >
            View Edit History ({message.editHistory.length} edits)
          </Button>
        </div>
      )}
    </div>
  );
}
