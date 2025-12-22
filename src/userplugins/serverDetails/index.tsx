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

import { definePluginSettings } from "@api/Settings";
import definePlugin, { OptionType } from "@utils/types";
import { findStoreLazy } from "@webpack";
import { UserStore, GuildRoleStore, GuildChannelStore, IconUtils, SnowflakeUtils, useStateFromStores, UserUtils, moment, React, useEffect } from "@webpack/common";
import { Guild, FluxStore } from "@vencord/discord-types";
import ErrorBoundary from "@components/ErrorBoundary";
import { getGuildAcronym } from "@utils/discord";

import "./style.css";

const GuildMemberCountStore = findStoreLazy("GuildMemberCountStore") as FluxStore & { getMemberCount(guildId?: string): number | null; };

const settings = definePluginSettings({
    icon: {
        type: OptionType.BOOLEAN,
        description: "Show Icon",
        default: true
    },
    owner: {
        type: OptionType.BOOLEAN,
        description: "Show Owner",
        default: true
    },
    creationDate: {
        type: OptionType.BOOLEAN,
        description: "Show Creation Date",
        default: true
    },
    joinDate: {
        type: OptionType.BOOLEAN,
        description: "Show Join Date",
        default: true
    },
    members: {
        type: OptionType.BOOLEAN,
        description: "Show Member Count",
        default: true
    },
    boosts: {
        type: OptionType.BOOLEAN,
        description: "Show Boost Count",
        default: true
    },
    channels: {
        type: OptionType.BOOLEAN,
        description: "Show Channel Count",
        default: true
    },
    roles: {
        type: OptionType.BOOLEAN,
        description: "Show Role Count",
        default: true
    },
    language: {
        type: OptionType.BOOLEAN,
        description: "Show Language",
        default: true
    }
});

function ServerDetails({ guild }: { guild: Guild; }) {
    const owner = useStateFromStores([UserStore], () => UserStore.getUser(guild.ownerId));
    const memberCount = useStateFromStores([GuildMemberCountStore], () => GuildMemberCountStore.getMemberCount(guild.id));
    const roles = useStateFromStores([GuildRoleStore], () => GuildRoleStore.getSortedRoles(guild.id));
    const channels = useStateFromStores([GuildChannelStore], () => GuildChannelStore.getChannels(guild.id));

    useEffect(() => {
        if (!owner && guild.ownerId) {
            UserUtils.getUser(guild.ownerId);
        }
    }, [guild.ownerId, owner]);

    const creationDate = SnowflakeUtils.extractTimestamp(guild.id);
    const joinDate = guild.joinedAt;

    const iconUrl = IconUtils.getGuildIconURL({
        id: guild.id,
        icon: guild.icon,
        size: 128
    });

    return (
        <div className="vc-server-details-tooltip">
            {settings.store.icon && (
                iconUrl ? (
                    <img src={iconUrl} className="vc-server-details-icon" />
                ) : (
                    <div className="vc-server-details-icon-fallback">{getGuildAcronym(guild)}</div>
                )
            )}
            {settings.store.owner && (
                <div className="vc-server-details-row">
                    <span className="vc-server-details-label">Owner:</span>
                    <span className="vc-server-details-value">{owner?.username ?? "Unknown"}</span>
                </div>
            )}
            {settings.store.creationDate && (
                <div className="vc-server-details-row">
                    <span className="vc-server-details-label">Created:</span>
                    <span className="vc-server-details-value">{moment(creationDate).format("L")}</span>
                </div>
            )}
            {settings.store.joinDate && joinDate && (
                <div className="vc-server-details-row">
                    <span className="vc-server-details-label">Joined:</span>
                    <span className="vc-server-details-value">{moment(joinDate).format("L")}</span>
                </div>
            )}
            {settings.store.members && (
                <div className="vc-server-details-row">
                    <span className="vc-server-details-label">Members:</span>
                    <span className="vc-server-details-value">{memberCount ?? "Unknown"}</span>
                </div>
            )}
            {settings.store.boosts && (
                <div className="vc-server-details-row">
                    <span className="vc-server-details-label">Boosts:</span>
                    <span className="vc-server-details-value">{guild.premiumSubscriberCount ?? 0}</span>
                </div>
            )}
            {settings.store.channels && (
                <div className="vc-server-details-row">
                    <span className="vc-server-details-label">Channels:</span>
                    <span className="vc-server-details-value">{channels?.count ?? 0}</span>
                </div>
            )}
            {settings.store.roles && (
                <div className="vc-server-details-row">
                    <span className="vc-server-details-label">Roles:</span>
                    <span className="vc-server-details-value">{roles ? roles.length - 1 : 0}</span>
                </div>
            )}
            {settings.store.language && (
                <div className="vc-server-details-row">
                    <span className="vc-server-details-label">Language:</span>
                    <span className="vc-server-details-value">{guild.preferredLocale}</span>
                </div>
            )}
        </div>
    );
}

export default definePlugin({
    name: "ServerDetails",
    description: "Shows server details in the server list tooltip.",
    authors: [{ name: "DevilBro", id: 278543574059057154n }],
    settings,

    patches: [
        {
            find: ".invitesDisabledTooltip",
            replacement: {
                match: /#{intl::VIEW_AS_ROLES_MENTIONS_WARNING}.{0,100}(?=])/,
                replace: "$&,$self.renderTooltip(arguments[0].guild)"
            }
        }
    ],

    renderTooltip: ErrorBoundary.wrap(guild => <ServerDetails guild={guild} />, { noop: true })
});
