/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { exec } from "child_process";
import { dialog, IpcMainInvokeEvent } from "electron";

export async function runExport(_: IpcMainInvokeEvent, exePath: string, args: string[]) {
    return new Promise((resolve) => {
        // Construct command. We quote the executable and all arguments.
        const command = `"${exePath}" ${args.map(arg => `"${arg}"`).join(" ")}`;

        exec(command, (error, stdout, stderr) => {
            if (error) {
                resolve({
                    success: false,
                    error: error.message,
                    stderr: stderr.toString(),
                    stdout: stdout.toString()
                });
            } else {
                resolve({
                    success: true,
                    stdout: stdout.toString(),
                    stderr: stderr.toString()
                });
            }
        });
    });
}

export async function showSaveDialog(_: IpcMainInvokeEvent, defaultPath: string) {
    const result = await dialog.showSaveDialog({
        defaultPath,
        filters: [
            { name: "CSV", extensions: ["csv"] }
        ]
    });
    return result;
}

export async function checkCli(_: IpcMainInvokeEvent, exePath: string) {
    return new Promise((resolve) => {
        exec(`"${exePath}" --version`, (error, stdout) => {
            if (error) {
                resolve({ success: false, error: error.message });
            } else {
                resolve({ success: true, version: stdout.toString().trim() });
            }
        });
    });
}
