import React from "react";
import type { DrawPointerType } from "@plait/draw";
import { type Locale } from "./LakexShapeCatalog";
/**
 * LOCAL-CHANGE #20：蓝点快创（auto-complete）之后的**图形选择面板**。
 *
 * 背景：plait 的 `withArrowLineAutoComplete` 在蓝点处提交时用
 * `createDefaultGeometry(board, points, originElement.shape)` ⇒ 新形状**复制源形状类型**，
 * 画流程图时每次都要再手动改形状。云端语雀的做法是提交后弹一个「最近使用 / 基础图形」面板让用户选。
 *
 * 本组件只负责 UI（portal 浮层 + 网格），选择结果由宿主 `DrawnixBoardCore` 应用
 * （选中刚创建的元素 → `DrawTransforms.switchGeometryShape` —— 同一条 `Transforms.setNode({shape})` 路径，
 * 仍会自动重排已绑定的连线）。
 */
export interface QuickShapePickerProps {
    locale: Locale;
    /** 锚点（clientX / clientY）：蓝点快创提交时的指针位置。 */
    anchor: {
        x: number;
        y: number;
    };
    /** 最近使用的形状（最新在前）。 */
    recent: DrawPointerType[];
    /** 源形状（快创来源那个形状的类型）：永远排在「最近使用」第一位，一键"和自己一样"。 */
    sourceShape?: DrawPointerType;
    onPick: (pointer: DrawPointerType) => void;
    onClose: () => void;
}
export default function LakexQuickShapePicker({ locale, anchor, recent, sourceShape, onPick, onClose, }: QuickShapePickerProps): React.ReactPortal;
