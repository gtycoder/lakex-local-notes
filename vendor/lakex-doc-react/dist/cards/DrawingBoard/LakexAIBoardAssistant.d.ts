import type { PlaitBoard, PlaitElement } from "@plait/core";
import type { DrawingBoardAIConfig } from "../../components/lakex/types";
type Locale = "zh-CN" | "en-US";
export type AIBoardApplyMode = "replace" | "append";
interface Props {
    ai?: DrawingBoardAIConfig;
    board: PlaitBoard | null;
    locale: Locale;
    dark: boolean;
    toolbarHost: Element | null;
    overlayHost: Element | null;
    onOpen?: () => void;
    onApply: (elements: PlaitElement[], mode: AIBoardApplyMode) => void;
}
export default function LakexAIBoardAssistant({ ai, board, locale, dark, toolbarHost, overlayHost, onOpen, onApply, }: Props): import("react/jsx-runtime").JSX.Element;
export {};
