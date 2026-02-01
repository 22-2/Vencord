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
import ErrorBoundary from "@components/ErrorBoundary";
import { Devs } from "@utils/constants";
import { ModalCloseButton, ModalContent, ModalHeader, ModalProps, ModalRoot, ModalSize, openModal } from "@utils/modal";
import definePlugin, { makeRange, OptionType } from "@utils/types";
import { findComponentByCodeLazy } from "@webpack";
import { Button, Clickable, Forms, React, Slider, Tooltip } from "@webpack/common";

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
const HeaderBarIcon = findComponentByCodeLazy(".HEADER_BAR_BADGE_TOP:", '"aria-haspopup":');

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

const MASTER_MARKERS = makeRange(0, 2, 0.05);

const settings = definePluginSettings({
    masterVolume: {
        type: OptionType.SLIDER,
        description: "通話マスターボリューム (1.0 = 100%)",
        default: 1,
        markers: MASTER_MARKERS,
        stickToMarkers: false,
        onChange: updateAllStreams
    }
});

function VolumeIcon({ size = 20 }: { size?: number; }) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
            <path
                fill="currentColor"
                d="M3 10v4c0 .55.45 1 1 1h3l4 3.5a1 1 0 0 0 1.6-.8V6.3a1 1 0 0 0-1.6-.8L7 9H4a1 1 0 0 0-1 1Zm13.5 2c0-1.77-1.02-3.3-2.5-4.03v8.06A4.5 4.5 0 0 0 16.5 12Zm-2.5-7v2.06A6.5 6.5 0 0 1 20.5 12a6.5 6.5 0 0 1-6.5 4.94V19a8.5 8.5 0 0 0 0-14Z"
            />
        </svg>
    );
}

function VolumeModal(modalProps: ModalProps) {
    const { masterVolume } = settings.use(["masterVolume"]);
    const markers = MASTER_MARKERS;

    return (
        <ModalRoot {...modalProps} size={ModalSize.SMALL}>
            <ModalHeader>
                <Forms.FormTitle>通話マスターボリューム</Forms.FormTitle>
                <ModalCloseButton onClick={modalProps.onClose} />
            </ModalHeader>
            <ModalContent>
                <Forms.FormText>
                    通話中の全員の音量に共通でかかる倍率です。
                </Forms.FormText>
                <Slider
                    key={masterVolume}
                    markers={markers}
                    minValue={markers[0]}
                    maxValue={markers[markers.length - 1]}
                    initialValue={masterVolume}
                    onValueChange={(v: number) => {
                        settings.store.masterVolume = v;
                        updateAllStreams();
                    }}
                    onValueRender={(v: number) => `${Math.round(v * 100)}%`}
                    stickToMarkers={false}
                />
                <Button
                    size={Button.Sizes.SMALL}
                    look={Button.Looks.LINK}
                    color={Button.Colors.PRIMARY}
                    onClick={() => {
                        settings.store.masterVolume = 1;
                        updateAllStreams();
                    }}
                    style={{ marginTop: "16px", padding: 0 }}
                >
                    100%にリセット
                </Button>
            </ModalContent>
        </ModalRoot>
    );
}

function openMasterVolumeModal() {
    openModal((props: ModalProps) => <VolumeModal {...props} />);
}

function HeaderButton({ className }: { className?: string; }) {
    const { masterVolume } = settings.use(["masterVolume"]);
    return (
        <HeaderBarIcon
            className={className}
            icon={() => <VolumeIcon size={24} />}
            tooltip={`Master Volume: ${Math.round(masterVolume * 100)}%`}
            onClick={openMasterVolumeModal}
        />
    );
}

function RTCButton() {
    return (
        <Tooltip text="Master Volume">
            {(props: any) => (
                <Clickable
                    {...props}
                    onClick={openMasterVolumeModal}
                    style={{ marginLeft: "4px", display: "flex", alignItems: "center" }}
                >
                    <VolumeIcon size={16} />
                </Clickable>
            )}
        </Tooltip>
    );
}

export default definePlugin({
    name: "VoiceMasterVolume",
    description: "通話音声の全員共通マスターボリュームを追加します。",
    authors: [Devs.Nuckyz],
    settings,

    patches: [
        {
            find: '?"BACK_FORWARD_NAVIGATION":',
            replacement: {
                match: /(?<=trailing:.{0,50})\i\.Fragment,\{(?=.+?className:(\i))/,
                replace: "$self.TrailingWrapper,{className:$1,"
            }
        },
        {
            find: "renderConnectionStatus(){",
            replacement: {
                match: /(lineClamp:1,children:)(\i)(?=,|}\))/,
                replace: "$1[$2,$self.RTCButton()]"
            }
        },
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
    },

    TrailingWrapper({ children, className }: any) {
        return (
            <React.Fragment>
                {children}
                <ErrorBoundary noop>
                    <HeaderButton className={className} />
                </ErrorBoundary>
            </React.Fragment>
        );
    },

    RTCButton: () => <ErrorBoundary noop><RTCButton /></ErrorBoundary>
});
