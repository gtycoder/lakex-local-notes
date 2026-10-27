import type { PlaitBoard } from "@plait/core";
import { type DrawPointerType } from "@plait/draw";
export type Locale = "zh-CN" | "en-US";
export type CategoryKey = "basic" | "flowchart" | "smart" | "uml" | "er";
export interface ShapeOption {
    pointer: DrawPointerType;
    zh: string;
    en: string;
}
export interface ShapeCategory {
    key: CategoryKey;
    zh: string;
    en: string;
    shapes: ShapeOption[];
}
export declare const categories: ShapeCategory[];
export declare function ShapePreview({ pointer }: {
    pointer: DrawPointerType;
}): import("react/jsx-runtime").JSX.Element;
interface Props {
    board: PlaitBoard | null;
    locale: Locale;
    open: boolean;
    onClose: () => void;
}
export default function LakexShapeCatalog({ board, locale, open, onClose, }: Props): import("react/jsx-runtime").JSX.Element;
export {};
