import React from "react";
import { type PlaitBoard } from "@plait/core";
type Locale = "zh-CN" | "en-US";
interface Props {
    board: PlaitBoard | null;
    locale: Locale;
    dark: boolean;
    hasContextSelection: boolean;
    position: {
        x: number;
        y: number;
    } | null;
    onClose: () => void;
    onAddText: () => void;
    onAddShape: () => void;
    onAddLine: () => void;
    onFitToCanvas: () => void;
    onActualSize: () => void;
    onAddToMaterialLibrary: () => boolean;
}
export default function LakexBoardContextMenu({ board, locale, dark, hasContextSelection, position, onClose, onAddText, onAddShape, onAddLine, onFitToCanvas, onActualSize, onAddToMaterialLibrary, }: Props): React.ReactPortal;
export {};
