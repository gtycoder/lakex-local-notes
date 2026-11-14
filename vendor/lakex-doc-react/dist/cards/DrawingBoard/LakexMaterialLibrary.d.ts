import React from "react";
import { PlaitBoard, type PlaitElement } from "@plait/core";
type Locale = "zh-CN" | "en-US";
/** 自定义素材条目（261114：可由宿主存到**可打开的文件夹**；字段与旧 localStorage 结构兼容）。 */
export interface BoardMaterialLibraryEntry {
    id: string;
    name: string;
    createdAt: number;
    elements: PlaitElement[];
    width?: number;
    height?: number;
}
/**
 * 素材持久化端口（LOCAL-CHANGE #27）。
 * 不传 = 沿用 localStorage（旧行为；移动端暂用）；桌面传「素材文件夹」实现。
 */
export interface MaterialLibraryStorage {
    load(): Promise<BoardMaterialLibraryEntry[]>;
    save(input: {
        name: string;
        elements: PlaitElement[];
        width?: number;
        height?: number;
    }): Promise<BoardMaterialLibraryEntry>;
    remove(id: string): Promise<void>;
    /** 打开素材文件夹（桌面文件夹模式）；不传 = 不显示该入口。 */
    openFolder?(): void;
}
interface Props {
    board: PlaitBoard | null;
    locale: Locale;
    dark: boolean;
    toolbarHost: HTMLElement | null;
    onOpen?: () => void;
    /** 素材持久化端口；缺省 = localStorage（移动端/旧行为）。 */
    materialStorage?: MaterialLibraryStorage;
}
export interface LakexMaterialLibraryHandle {
    /** Opens the naming dialog for the current Drawnix selection. */
    addSelectionToLibrary: () => boolean;
    /** Keeps the current selection stable while a board context menu is open. */
    captureSelection: () => boolean;
}
declare const LakexMaterialLibrary: React.ForwardRefExoticComponent<Props & React.RefAttributes<LakexMaterialLibraryHandle>>;
export default LakexMaterialLibrary;
