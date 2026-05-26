/*
 * Vencord, a modification for Discord's desktop app
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./styles.css";

import { NavContextMenuPatchCallback } from "@api/ContextMenu";
import { classNameFactory } from "@utils/css";
import { getTheme, Theme } from "@utils/discord";
import { Margins } from "@utils/margins";
import definePlugin from "@utils/types";
import { Channel } from "@vencord/discord-types";
import { Forms, Menu, MessageActions, Modal, openModal, RestAPI, Toasts, useState } from "@webpack/common";

const cl = classNameFactory("vc-jtd-");

// Discord snowflake epoch (2015-01-01)
const DISCORD_EPOCH = 1420070400000n;

function dateToSnowflake(ms: number): string {
    return ((BigInt(ms) - DISCORD_EPOCH) << 22n).toString();
}

// "YYYY-MM-DD" を、ユーザーのローカルタイムゾーンでのその日の0:00として解釈する
// (ブラウザのDateコンストラクタは "YYYY-MM-DD" をUTC解釈してしまうため手動でパース)
function parseLocalDate(value: string): Date | null {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!m) return null;
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    if (isNaN(d.getTime())) return null;
    return d;
}

interface SearchResponse {
    body?: {
        messages?: Array<Array<{ id: string; }>>;
        total_results?: number;
    };
}

async function findFirstMessageIdOnDate(channel: Channel, date: Date): Promise<string | null> {
    const startMs = date.getTime();
    const endMs = startMs + 86_400_000;
    // max_id は inclusive な上限なので、その日の終わり (= 翌日0:00) のsnowflakeから1を引く
    const minId = dateToSnowflake(startMs);
    const maxId = (BigInt(dateToSnowflake(endMs)) - 1n).toString();

    // ギルドチャンネルとDM/GroupDMでエンドポイントが異なる
    const url = channel.guild_id
        ? `/guilds/${channel.guild_id}/messages/search`
        : `/channels/${channel.id}/messages/search`;

    const query: Record<string, string> = {
        min_id: minId,
        max_id: maxId,
        sort_by: "timestamp",
        sort_order: "asc",
        include_nsfw: "true",
    };
    if (channel.guild_id) query.channel_id = channel.id;

    const res: SearchResponse = await RestAPI.get({ url, query }).catch(() => ({}));
    const hit = res.body?.messages?.[0]?.[0];
    return hit?.id ?? null;
}

function PickerModal({ channel, modalProps }: { channel: Channel; modalProps: any; }) {
    const today = new Date();
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

    const [value, setValue] = useState<string>(todayStr);
    const [loading, setLoading] = useState(false);

    async function onJump() {
        const date = parseLocalDate(value);
        if (!date) {
            Toasts.show({ message: "日付の形式が正しくありません", type: Toasts.Type.FAILURE, id: Toasts.genId() });
            return;
        }

        setLoading(true);
        try {
            const messageId = await findFirstMessageIdOnDate(channel, date);
            if (!messageId) {
                Toasts.show({
                    message: "その日付のメッセージは見つかりませんでした",
                    type: Toasts.Type.MESSAGE,
                    id: Toasts.genId(),
                });
                return;
            }
            MessageActions.jumpToMessage({
                channelId: channel.id,
                messageId,
                flash: true,
                jumpType: "ANIMATED",
            });
            modalProps.onClose();
        } catch (e) {
            console.error("[JumpToDate] search failed", e);
            Toasts.show({ message: "検索に失敗しました", type: Toasts.Type.FAILURE, id: Toasts.genId() });
        } finally {
            setLoading(false);
        }
    }

    return (
        <Modal
            {...modalProps}
            title="指定日にジャンプ"
            actions={[{
                text: loading ? "検索中..." : "ジャンプ",
                variant: "primary",
                disabled: loading,
                onClick: onJump,
            }]}
        >
            <Forms.FormTitle>日付</Forms.FormTitle>
            <input
                className={cl("date-picker")}
                type="date"
                value={value}
                max={todayStr}
                onChange={e => setValue(e.currentTarget.value)}
                style={{
                    colorScheme: getTheme() === Theme.Light ? "light" : "dark",
                }}
            />
            <Forms.FormText className={cl("hint") + " " + Margins.bottom8}>
                #{(channel as any).name ?? "チャンネル"} 内で、その日の最初のメッセージにジャンプします
            </Forms.FormText>
        </Modal>
    );
}

function openPicker(channel: Channel) {
    openModal(modalProps => <PickerModal channel={channel} modalProps={modalProps} />);
}

const ChannelIcon = () => (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
        <path fill="currentColor" d="M19 3h-1V1h-2v2H8V1H6v2H5c-1.11 0-1.99.9-1.99 2L3 19a2 2 0 0 0 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V8h14v11zM7 10h5v5H7v-5z" />
    </svg>
);

const patch: NavContextMenuPatchCallback = (children, { channel }: { channel?: Channel; }) => {
    if (!channel) return;
    children.push(
        <Menu.MenuItem
            id="vc-jump-to-date"
            label="指定日にジャンプ..."
            icon={ChannelIcon}
            action={() => openPicker(channel)}
        />
    );
};

export default definePlugin({
    name: "JumpToDate",
    description: "チャンネル右クリックから、指定した日付の最初のメッセージにジャンプできます",
    authors: [{ name: "Mondego", id: 0n }],

    contextMenus: {
        "channel-context": patch,
        "thread-context": patch,
        "gdm-context": patch,
    },
});
