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

import "./style.css";

const settings = definePluginSettings({
    hideMembers: {
        type: OptionType.BOOLEAN,
        description: "Reveal Members on Hover",
        default: true,
        onChange: (v) => document.body.classList.toggle("vc-hds-hide-members", v)
    }
});

export default definePlugin({
    name: "HideSidebarPro",
    description: "Hides the members list and reveals on hover.",
    authors: [{ name: "atetrax", id: 0n }, { name: "JamesN-dev", id: 0n }],
    settings,

    start() {
        if (settings.store.hideMembers) document.body.classList.add("vc-hds-hide-members");
    },

    stop() {
        document.body.classList.remove("vc-hds-hide-members");
    }
});
