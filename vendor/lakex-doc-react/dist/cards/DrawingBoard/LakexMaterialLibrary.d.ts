import React from "react";
import { PlaitBoard } from "@plait/core";
type Locale = "zh-CN" | "en-US";
interface Props {
    board: PlaitBoard | null;
    locale: Locale;
    dark: boolean;
    toolbarHost: HTMLElement | null;
    onOpen?: () => void;
}
export interface LakexMaterialLibraryHandle {
    /** Opens the naming dialog for the current Drawnix selection. */
    addSelectionToLibrary: () => boolean;
    /** Keeps the current selection stable while a board context menu is open. */
    captureSelection: () => boolean;
}
declare const LakexMaterialLibrary: React.ForwardRefExoticComponent<Props & React.RefAttributes<LakexMaterialLibraryHandle>>;
export default LakexMaterialLibrary;
