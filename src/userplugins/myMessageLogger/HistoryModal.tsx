/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import ErrorBoundary from "@components/ErrorBoundary";
import { TooltipContainer } from "@components/TooltipContainer";
import { classNameFactory } from "@utils/css";
import { Margins } from "@utils/margins";
import { classes } from "@utils/misc";
import { ModalCloseButton, ModalContent, ModalHeader, ModalProps, ModalRoot, ModalSize, openModal } from "@utils/modal";
import { findCssClassesLazy } from "@webpack";
import { TabBar, Text, Timestamp, useState } from "@webpack/common";

import { parseEditContent } from ".";
import { MyMLMessage } from "./types";

const CodeContainerClasses = findCssClassesLazy("markup", "codeContainer");
const MiscClasses = findCssClassesLazy("messageContent", "markupRtl");

const cl = classNameFactory("vc-ml-modal-");

export function openHistoryModal(message: MyMLMessage) {
    openModal(props =>
        <ErrorBoundary>
            <HistoryModal
                modalProps={props}
                message={message}
            />
        </ErrorBoundary>
    );
}

export function HistoryModal({ modalProps, message }: { modalProps: ModalProps; message: MyMLMessage; }) {
    const editHistory = message.editHistory ?? [];
    const [currentTab, setCurrentTab] = useState(editHistory.length);
    const timestamps = [message.firstEditTimestamp ?? message.timestamp, ...editHistory.map(edit => edit.timestamp)];
    const contents = [...editHistory.map(edit => edit.content), message.content ?? ""];
    const firstEditTime = new Date(message.firstEditTimestamp ?? message.timestamp).getTime();
    const originalTime = new Date(message.timestamp).getTime();

    return (
        <ModalRoot {...modalProps} size={ModalSize.LARGE}>
            <ModalHeader className={cl("head")}>
                <Text variant="heading-lg/semibold" style={{ flexGrow: 1 }}>Message Edit History</Text>
                <ModalCloseButton onClick={modalProps.onClose} />
            </ModalHeader>

            <ModalContent className={cl("contents")}>
                <TabBar
                    type="top"
                    look="brand"
                    className={classes("vc-settings-tab-bar", cl("tab-bar"))}
                    selectedItem={currentTab}
                    onItemSelect={setCurrentTab}
                >
                    {firstEditTime !== originalTime && (
                        <TooltipContainer text="This edit state was not logged so it can't be displayed.">
                            <TabBar.Item
                                className="vc-settings-tab-bar-item"
                                id={-1}
                                disabled
                            >
                                <Timestamp
                                    className={cl("timestamp")}
                                    timestamp={message.timestamp}
                                    isEdited={true}
                                    isInline={false}
                                />
                            </TabBar.Item>
                        </TooltipContainer>
                    )}

                    {timestamps.map((timestamp, index) => (
                        <TabBar.Item
                            key={index}
                            className="vc-settings-tab-bar-item"
                            id={index}
                        >
                            <Timestamp
                                className={cl("timestamp")}
                                timestamp={timestamp}
                                isEdited={true}
                                isInline={false}
                            />
                        </TabBar.Item>
                    ))}
                </TabBar>

                <div className={classes(CodeContainerClasses.markup, MiscClasses.messageContent, Margins.top20)}>
                    {parseEditContent(contents[currentTab], message)}
                </div>
            </ModalContent>
        </ModalRoot>
    );
}
