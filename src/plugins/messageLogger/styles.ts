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
import { disableStyle, enableStyle } from "@api/Styles";

import overlayStyle from "./deleteStyleOverlay.css?managed";
import textStyle from "./deleteStyleText.css?managed";

/**
 * Applies the appropriate delete style based on settings
 */
export function addDeleteStyle(): void {
  if (Settings.plugins.MessageLogger.deleteStyle === "text") {
    enableStyle(textStyle);
    disableStyle(overlayStyle);
  } else {
    disableStyle(textStyle);
    enableStyle(overlayStyle);
  }
}
