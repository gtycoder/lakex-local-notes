/**
 * 内核原生公式栏（261025 定稿）：本 hook 只做两件事——
 * 1. 打开/关闭内核单元格编辑（原生移动公式栏由 UniverSheetsMobileUIPlugin 渲染）；
 * 2. 把选区地址注入原生栏（CSS ::before 显示 A11）并清掉内核 inline 定位，交给我们的 chrome CSS。
 *
 * 自绘输入条已删除（261025 回滚）：编辑输入面唯一来源 = 内核原生栏。
 * ⚠️ 光标也只归内核：原生 canvas 由 docs 渲染层画 caret（261103 设备实测：读像素抓到文本末尾
 * 1×(18~19)px 的闪烁竖条）。261025 曾误判"canvas 不画 caret"而叠了一个自绘 2px 闪烁条，
 * 结果打字时出现**两个插入点**（用户 gif）。已整条删除，别再补回来 —— 若发现"没有光标"，
 * 先查原生编辑器是否拿到焦点（隐藏 contenteditable "__editor___INTERNAL_EDITOR__DOCS_FORMULA_BAR"）。
 */
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { FUniver } from "@univerjs/presets";

interface UseNativeSheetFormulaBarOptions {
  editing: boolean;
  hostRef: RefObject<HTMLDivElement | null>;
  /** 当前活动格地址（A1 / B7），注入到原生栏左侧。 */
  address: string;
  getUniverAPI: () => FUniver | null;
}

export function useNativeSheetFormulaBar({ editing, hostRef, address, getUniverAPI }: UseNativeSheetFormulaBarOptions) {
  const [nativeEditing, setNativeEditing] = useState(false);
  const [nativeExpanded, setNativeExpanded] = useState(false);
  const addressRef = useRef(address);
  addressRef.current = address;

  /** 打开内核原生编辑（原生公式栏随之挂载；eventType 3 = DeviceInputEventType.Dblclick）。 */
  const openNativeEditor = useCallback(() => {
    const api = getUniverAPI();
    if (!api) return;
    void Promise.resolve(api.executeCommand("sheet.operation.set-cell-edit-visible", { visible: true, eventType: 3 })).catch(() => undefined);
  }, [getUniverAPI]);

  /** 关原生编辑（开 dock 面板时收掉，面板用键盘区，避免原生栏浮在面板上）。 */
  const closeNativeEditor = useCallback(() => {
    const api = getUniverAPI();
    if (!api) return;
    void Promise.resolve(api.executeCommand("sheet.operation.set-cell-edit-visible", { visible: false, eventType: 3 })).catch(() => undefined);
  }, [getUniverAPI]);

  // 原生栏挂载/卸载 + 地址注入 + 隐藏内核自带的「打开表格工具」浮动圆钮。
  useEffect(() => {
    if (!editing) return;
    const host = hostRef.current;
    if (!host) return;
    const apply = () => {
      const bar = host.querySelector<HTMLElement>('[data-u-comp="formula-bar"]');
      if (!bar) {
        setNativeEditing(false);
        setNativeExpanded(false);
        return;
      }
      if (bar.dataset.lakeAddress !== addressRef.current) bar.dataset.lakeAddress = addressRef.current;
      const outer = bar.closest<HTMLElement>('[data-u-comp="mobile-formula-bar"]');
      if (outer) {
        if (outer.style.bottom) outer.style.removeProperty("bottom");
        if (outer.style.position) outer.style.removeProperty("position");
      }
      setNativeEditing((prev) => (prev === !!bar ? prev : !!bar));
      const expanded = bar.getAttribute("data-expanded") === "true";
      setNativeExpanded((prev) => (prev === expanded ? prev : expanded));
      document.querySelectorAll<HTMLElement>('button[aria-label="打开表格工具"]').forEach((button) => {
        if (button.style.display !== "none") button.style.display = "none";
      });
    };
    apply();
    const observer = new MutationObserver(apply);
    observer.observe(host, { childList: true, subtree: true, attributes: true, attributeFilter: ["style", "data-expanded"] });
    return () => observer.disconnect();
  }, [editing, hostRef]);

  return { nativeEditing, nativeExpanded, openNativeEditor, closeNativeEditor };
}
