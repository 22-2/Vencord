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
  ContextMenuApi,
  Forms,
  GuildStore,
  Menu,
  moment,
  ScrollerThin,
  Select,
  TabBar,
  Text,
  useCallback,
  useEffect,
  useMemo,
  UserStore,
  useState
} from "@webpack/common";

import { getChannelIdsWithMessages, getMessageCount, getMessagesPaginated } from "./database";
import { openHistoryModal } from "./HistoryModal";
import { MLMessage } from "./types";

const CodeContainerClasses = findByPropsLazy("markup", "codeContainer");
const MiscClasses = findByPropsLazy("messageContent", "markupRtl");
const NavigationUtils = findByPropsLazy("transitionTo");

const cl = classNameFactory("vc-ml-viewer-");

const PAGE_SIZE = 20;

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
  const [page, setPage] = useState(0);
  const [totalCount, setTotalCount] = useState(0);

  const totalPages = useMemo(() => Math.ceil(totalCount / PAGE_SIZE), [totalCount]);

  // Load channel list on mount
  useEffect(() => {
    (async () => {
      try {
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
      } catch (e) {
        console.error("[MessageLogger] Failed to load channels:", e);
      }
    })();
  }, []);

  // Load messages when filter or page changes
  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const filter = {
          channelId: selectedChannel === "all" ? undefined : selectedChannel,
          deleted: currentTab === "deleted" ? true : undefined,
          hasEditHistory: currentTab === "edited" ? true : undefined,
        };

        const count = await getMessageCount(filter);
        setTotalCount(count);

        const msgs = await getMessagesPaginated(page, PAGE_SIZE, filter);
        setMessages(msgs);
      } catch (e) {
        console.error("[MessageLogger] Failed to load messages:", e);
      }
      setLoading(false);
    })();
  }, [currentTab, selectedChannel, page]);

  // Reset page when filter changes
  useEffect(() => {
    setPage(0);
  }, [currentTab, selectedChannel]);

  const handlePrevPage = useCallback(() => {
    setPage(p => Math.max(0, p - 1));
  }, []);

  const handleNextPage = useCallback(() => {
    setPage(p => Math.min(totalPages - 1, p + 1));
  }, [totalPages]);

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
        ) : messages.length === 0 ? (
          <div style={{ textAlign: "center", padding: "20px" }}>
            <Text variant="text-md/normal">No messages found.</Text>
          </div>
        ) : (
          <ScrollerThin style={{ maxHeight: "350px" }}>
            {messages.map(msg => (
              <MessageCard
                key={msg.id}
                message={msg}
                showEditHistory={currentTab === "edited"}
                onClose={modalProps.onClose}
              />
            ))}
          </ScrollerThin>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div style={{
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            gap: "16px",
            marginTop: "16px"
          }}>
            <Button
              size={Button.Sizes.SMALL}
              disabled={page === 0}
              onClick={handlePrevPage}
            >
              ← Previous
            </Button>
            <Text variant="text-md/normal">
              Page {page + 1} of {totalPages}
            </Text>
            <Button
              size={Button.Sizes.SMALL}
              disabled={page >= totalPages - 1}
              onClick={handleNextPage}
            >
              Next →
            </Button>
          </div>
        )}
      </ModalContent>

      <ModalFooter>
        <Text variant="text-sm/normal" style={{ color: "var(--text-muted)" }}>
          Total: {totalCount} messages | Showing {messages.length} on this page
        </Text>
      </ModalFooter>
    </ModalRoot>
  );
}

function MessageContextMenu({
  message,
  showEditHistory,
  onClose
}: {
  message: MLMessage;
  showEditHistory: boolean;
  onClose: () => void;
}) {
  const channel = ChannelStore.getChannel(message.channel_id);

  const handleJumpToMessage = () => {
    ContextMenuApi.closeContextMenu();
    onClose();

    const guildId = channel?.guild_id || "@me";
    const url = `/channels/${guildId}/${message.channel_id}/${message.id}`;

    if (NavigationUtils?.transitionTo) {
      NavigationUtils.transitionTo(url);
    }
  };

  const handleCopyMessageId = () => {
    navigator.clipboard.writeText(message.id);
    ContextMenuApi.closeContextMenu();
  };

  const handleCopyContent = () => {
    navigator.clipboard.writeText(message.content || "");
    ContextMenuApi.closeContextMenu();
  };

  const handleViewHistory = () => {
    ContextMenuApi.closeContextMenu();
    openHistoryModal(message);
  };

  return (
    <Menu.Menu
      navId="ml-message-context"
      onClose={ContextMenuApi.closeContextMenu}
      aria-label="Message Logger Menu"
    >
      <Menu.MenuItem
        id="ml-jump"
        label="Jump to Message"
        action={handleJumpToMessage}
      />
      <Menu.MenuSeparator />
      <Menu.MenuItem
        id="ml-copy-id"
        label="Copy Message ID"
        action={handleCopyMessageId}
      />
      <Menu.MenuItem
        id="ml-copy-content"
        label="Copy Content"
        action={handleCopyContent}
      />
      {showEditHistory && message.editHistory && message.editHistory.length > 0 && (
        <>
          <Menu.MenuSeparator />
          <Menu.MenuItem
            id="ml-view-history"
            label={`View Edit History (${message.editHistory.length})`}
            action={handleViewHistory}
          />
        </>
      )}
    </Menu.Menu>
  );
}

function MessageCard({
  message,
  showEditHistory,
  onClose
}: {
  message: MLMessage;
  showEditHistory: boolean;
  onClose: () => void;
}) {
  const author = UserStore.getUser(message.author?.id);
  const channel = ChannelStore.getChannel(message.channel_id);
  const guild = channel?.guild_id ? GuildStore.getGuild(channel.guild_id) : null;

  const authorName = author?.username || message.author?.username || "Unknown User";
  const channelName = channel?.name || "Unknown Channel";
  const guildName = guild?.name || "";

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    ContextMenuApi.openContextMenu(e, () => (
      <MessageContextMenu
        message={message}
        showEditHistory={showEditHistory}
        onClose={onClose}
      />
    ));
  }, [message, showEditHistory, onClose]);

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
          : "1px solid rgba(250, 168, 26, 0.3)",
        cursor: "context-menu"
      }}
      onContextMenu={handleContextMenu}
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

      {/* Edit History indicator */}
      {showEditHistory && message.editHistory && message.editHistory.length > 0 && (
        <div style={{ marginTop: "8px" }}>
          <Text variant="text-xs/normal" style={{ color: "var(--text-muted)" }}>
            📝 {message.editHistory.length} edit(s) - Right click for options
          </Text>
        </div>
      )}
    </div>
  );
}
