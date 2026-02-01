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
import definePlugin, { makeRange, OptionType } from "@utils/types";

interface StreamData {
    audioContext: AudioContext;
    audioElement: HTMLAudioElement;
    emitter: any;
    gainNode?: GainNode;
    id: string;
    levelNode: AudioWorkletNode;
    sinkId: string | "default";
    stream: MediaStream;
    streamSourceNode?: MediaStreamAudioSourceNode;
    videoStreamId: string;
    _mute: boolean;
    _speakingFlags: number;
    _volume: number;
}

const activeStreams = new Set<StreamData>();

function getMasterVolume(): number {
    const raw = settings.store.masterVolume ?? 1;
    if (Number.isFinite(raw)) return Math.max(0, raw);
    return 1;
}

function applyMasterVolume(data: StreamData) {
    if (!data.gainNode) return;
    const master = getMasterVolume();
    data.gainNode.gain.value = data._mute ? 0 : (data._volume / 100) * master;
}

function updateAllStreams() {
    for (const data of activeStreams) {
        applyMasterVolume(data);
    }
}

const settings = definePluginSettings({
    masterVolume: {
        type: OptionType.SLIDER,
        description: "通話マスターボリューム (1.0 = 100%)",
        default: 1,
        markers: makeRange(0, 2, 0.05),
        onChange: updateAllStreams
    }
});

export default definePlugin({
    name: "VoiceMasterVolume",
    description: "通話音声の全員共通マスターボリュームを追加します。",
    authors: [Devs.Nuckyz],
    settings,

    patches: [
        {
            find: "streamSourceNode",
            predicate: () => !IS_DISCORD_DESKTOP,
            group: true,
            replacement: [
                {
                    match: /Math\.max.{0,30}\)\)/,
                    replace: "arguments[0]"
                },
                {
                    match: /\}return\"video\"/,
                    replace: "this.updateAudioElement();$&"
                },
                {
                    match: /\.volume=this\._volume\/100;/,
                    replace: ".volume=0.00;$self.patchVolume(this);"
                }
            ]
        }
    ],

    patchVolume(data: StreamData) {
        if (data.stream.getAudioTracks().length === 0) return;

        data.streamSourceNode ??= data.audioContext.createMediaStreamSource(data.stream);

        if (!data.gainNode) {
            const gain = data.gainNode = data.audioContext.createGain();
            data.streamSourceNode.connect(gain);
            gain.connect(data.audioContext.destination);
        }

        // @ts-expect-error
        if (data.sinkId != null && data.sinkId !== data.audioContext.sinkId && "setSinkId" in AudioContext.prototype) {
            // @ts-expect-error https://developer.mozilla.org/en-US/docs/Web/API/AudioContext/setSinkId
            data.audioContext.setSinkId(data.sinkId === "default" ? "" : data.sinkId);
        }

        activeStreams.add(data);
        applyMasterVolume(data);
    }
});
