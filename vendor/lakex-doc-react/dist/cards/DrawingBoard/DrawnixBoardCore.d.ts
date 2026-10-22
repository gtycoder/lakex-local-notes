import { type Viewport } from "@plait/core";
import type { DrawingBoardAIConfig } from "../../components/lakex/types";
import type { IDrawingBoardCardValue } from "./types";
type Locale = "zh-CN" | "en-US";
type BoardTheme = "light" | "dark" | "system";
export interface DrawnixBoardCoreProps {
    value?: IDrawingBoardCardValue | null;
    readOnly?: boolean;
    locale: Locale;
    theme: BoardTheme;
    ai?: DrawingBoardAIConfig;
    onChange?: (value: Partial<IDrawingBoardCardValue>) => void;
    /**
     * LOCAL-CHANGE #18：视口（pan/zoom）的**被动**回调 —— 只在调用方要自己记住视口时使用
     * （独立画板文档 kind=board）。与 `onChange` 分离是刻意的：宿主要把视口存进 ref、**不回灌**，
     * 否则每次 pan 都会改 value → 宿主保存（260916 那个"拖一下画布就触发保存"的坑）。
     * 不传 = 与卡片一致：视口不持久化。
     */
    onViewportPersist?: (viewport: Viewport) => void;
    /**
     * LOCAL-CHANGE #19：挂载后若画布已有内容，自动 fit 到内容（只读查看器用，例如移动端画板查看）。
     * 默认 false = 与卡片/桌面独立画板一致（用宿主给的 viewport 或默认视口）。
     */
    fitOnInit?: boolean;
}
export default function DrawnixBoardCore({ value, readOnly, locale, theme, ai, onChange, onViewportPersist, fitOnInit, }: DrawnixBoardCoreProps): import("react/jsx-runtime").JSX.Element;
export {};
