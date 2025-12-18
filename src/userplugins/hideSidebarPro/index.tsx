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
import { Devs } from "@utils/constants";
import definePlugin, { OptionType } from "@utils/types";
import { findComponentByCodeLazy } from "@webpack";
import { React } from "@webpack/common";

import "./style.css";

const HeaderBarIcon = findComponentByCodeLazy(".HEADER_BAR_BADGE_TOP:", '.iconBadge,"top"');

const settings = definePluginSettings({
    hideServers: {
        type: OptionType.BOOLEAN,
        description: "Reveal Servers on Hover",
        default: false,
        onChange: (v) => document.body.classList.toggle("vc-hds-hide-servers", v)
    },
    hideMembers: {
        type: OptionType.BOOLEAN,
        description: "Reveal Members on Hover",
        default: false,
        onChange: (v) => document.body.classList.toggle("vc-hds-hide-members", v)
    },
    smallServerList: {
        type: OptionType.BOOLEAN,
        description: "Small Server List",
        default: false,
        onChange: (v) => document.body.classList.toggle("vc-hds-small-server-list", v)
    },
    showButton: {
        type: OptionType.BOOLEAN,
        description: "Show Toggle Button in Header",
        default: true,
        restartNeeded: true
    }
});

export default definePlugin({
    name: "HideSidebarPro",
    description: "Hides the sidebar and reveals on hover.",
    authors: [{ name: "atetrax", id: 0n }, { name: "JamesN-dev", id: 0n }],
    settings,

    patches: [
        {
            find: '?"BACK_FORWARD_NAVIGATION":',
            replacement: {
                match: /(?<=trailing:.{0,50})\i\.Fragment,\{(?=.+?className:(\i))/,
                replace: "$self.TrailingWrapper,{className:$1,"
            },
            predicate: () => settings.store.showButton
        }
    ],

    TrailingWrapper({ children, className }: { children?: any; className: string; }) {
        const { hideServers } = settings.use(["hideServers"]);

        return (
            <>
                {children}
                <HeaderBarIcon
                    className={className}
                    icon={() => (
                        <svg width="24" height="24" viewBox="0 0 24 24">
                            <path fill="currentColor" d="M20 7a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7zM6 7h12v2H6V7zm0 4h12v2H6v-2zm0 4h12v2H6v-2z" />
                            {hideServers && <path fill="currentColor" d="M3.707 2.293a1 1 0 0 0-1.414 1.414l18 18a1 1 0 0 0 1.414-1.414l-18-18z" />}
                        </svg>
                    )}
                    tooltip={hideServers ? "Show Servers" : "Hide Servers"}
                    onClick={() => settings.store.hideServers = !hideServers}
                    selected={hideServers}
                />
            </>
        );
    },

    start() {
        if (settings.store.hideServers) document.body.classList.add("vc-hds-hide-servers");
        if (settings.store.hideMembers) document.body.classList.add("vc-hds-hide-members");
        if (settings.store.smallServerList) document.body.classList.add("vc-hds-small-server-list");
    },

    stop() {
        document.body.classList.remove("vc-hds-hide-servers", "vc-hds-hide-members", "vc-hds-small-server-list");
    }
});
