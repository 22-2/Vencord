/*
 * Vencord, a modification for Discord's desktop app
 * Copyright (c) 2024 Vendicated and contributors
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

import { SettingsManager } from "./settingsManager";
import { ensureCspPermission, Logger, normalizeAudioPath } from "./utils";
import { PUSHOVER_API_URL } from "./constants";

export class NotificationService {
    private static pendingMessages: string[] = [];
    private static timeoutId: number | null = null;

    static queue(message: string): void {
        const trimmed = message?.trim();
        if (!trimmed) return;

        this.pendingMessages.push(trimmed);

        if (this.timeoutId === null) {
            const delay = SettingsManager.getConfig().notificationDelay ?? 3000;
            this.timeoutId = window.setTimeout(() => this.flush(), delay);
        }
    }

    private static async flush(): Promise<void> {
        if (this.pendingMessages.length === 0) return;

        const uniqueMessages = Array.from(new Set(this.pendingMessages));
        const combinedMessage = this.formatCombinedMessage(uniqueMessages);

        this.resetState();

        await Promise.all([
            this.sendDesktop(combinedMessage),
            this.playAudio(),
            this.sendPushover("Discordボイチャ通知", combinedMessage),
        ]);
    }

    private static formatCombinedMessage(messages: string[]): string {
        return messages.length > 1
            ? "複数の入室を確認しました:\n" + messages.join("\n")
            : messages[0];
    }

    private static resetState(): void {
        this.pendingMessages = [];
        this.timeoutId = null;
    }

    private static sendDesktop(body: string): void {
        if (!("Notification" in window)) return;

        const show = () => new Notification("ボイチャ通知", { body });

        if (Notification.permission === "granted") {
            show();
        } else if (Notification.permission !== "denied") {
            Notification.requestPermission().then(
                (p) => p === "granted" && show()
            );
        }
    }

    private static async playAudio(): Promise<void> {
        const { playAudio, audioPath } = SettingsManager.getConfig();
        if (!playAudio || !audioPath) return;

        const normalizedPath = normalizeAudioPath(audioPath);

        if (await ensureCspPermission(normalizedPath, "media-src")) {
            new Audio(normalizedPath)
                .play()
                .catch((e) => Logger.error("Failed to play audio:", e));
        }
    }

    private static async sendPushover(
        title: string,
        message: string
    ): Promise<void> {
        const { userKey, apiToken } = SettingsManager.getConfig();
        if (!userKey || !apiToken) return;

        if (!(await ensureCspPermission(PUSHOVER_API_URL, "connect-src")))
            return;

        try {
            await fetch(PUSHOVER_API_URL, {
                method: "POST",
                headers: {
                    "Content-Type": "application/x-www-form-urlencoded",
                },
                body: new URLSearchParams({
                    token: apiToken,
                    user: userKey,
                    message,
                    title,
                }),
            });
        } catch (error) {
            Logger.error("Error sending Pushover notification:", error);
        }
    }
}
