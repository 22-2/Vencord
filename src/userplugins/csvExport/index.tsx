/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { NavContextMenuPatchCallback } from "@api/ContextMenu";
import { definePluginSettings } from "@api/Settings";
import { Devs } from "@utils/constants";
import definePlugin, { OptionType } from "@utils/types";
import { AuthenticationStore, Menu, showToast } from "@webpack/common";

const settings = definePluginSettings({
    token: {
        description: "Your Discord token. If left empty, it will attempt to fetch it automatically.",
        type: OptionType.STRING,
        default: ""
    },
    exePath: {
        description: "Path to DiscordChatExporter.Cli executable (e.g., DiscordChatExporter.Cli or full path)",
        type: OptionType.STRING,
        default: "DiscordChatExporter.Cli"
    },
    outputPath: {
        description: "Default output directory (leave empty to prompt for save location)",
        type: OptionType.STRING,
        default: ""
    }
});

const ChannelContextMenuPatch: NavContextMenuPatchCallback = (children, { channel }) => {
    // Check if we have a valid channel and if VencordNative exists (to avoid issues on web)
    if (!channel?.id || typeof VencordNative === "undefined") return;

    children.push(
        <Menu.MenuItem
            id="vc-export-csv"
            label="Export as CSV"
            action={async () => {
                let token = settings.store.token;
                if (!token) {
                    token = (AuthenticationStore as any).getToken();
                }

                if (!token) {
                    showToast("Token is missing. Please enter your token in the CsvExport settings.", "failure" as any);
                    return;
                }

                const exePath = settings.store.exePath;
                const channelId = channel.id;
                const channelName = channel.name || "channel";

                let outputPath = settings.store.outputPath;
                if (!outputPath) {
                    // Open save dialog via native helper
                    const result = await VencordNative.pluginHelpers.CsvExport.showSaveDialog(`${channelName}.csv`);
                    if (result.canceled || !result.filePath) return;
                    outputPath = result.filePath;
                } else {
                    // Ensure the path ends with a slash and add the filename
                    const separator = outputPath.includes("\\") ? "\\" : "/";
                    outputPath = outputPath.replace(/[\\/]$/, "") + separator + `${channelName}.csv`;
                }

                showToast(`Exporting ${channelName} to CSV...`, "message" as any);

                const args = [
                    "export",
                    "-t", token,
                    "-c", channelId,
                    "-f", "Csv",
                    "-o", outputPath
                ];

                try {
                    const res = await VencordNative.pluginHelpers.CsvExport.runExport(exePath, args);
                    if (res.success) {
                        showToast(`Successfully exported to ${outputPath}`, "success" as any);
                    } else {
                        console.error("[CsvExport] Export failed:", res);
                        showToast(`Export failed: ${res.error}`, "failure" as any);
                    }
                } catch (e) {
                    console.error("[CsvExport] Unexpected error:", e);
                    showToast("An unexpected error occurred during export.", "failure" as any);
                }
            }}
        />
    );
};

export default definePlugin({
    name: "CsvExport",
    authors: [Devs.Ven],
    description: "Adds an 'Export as CSV' option to channel context menus. Requires DiscordChatExporter.Cli to be installed or accessible via PATH.",
    settings,
    contextMenus: {
        "channel-context": ChannelContextMenuPatch,
        "thread-context": ChannelContextMenuPatch,
        "gdm-context": ChannelContextMenuPatch
    }
});
