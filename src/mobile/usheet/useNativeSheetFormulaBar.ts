/**
 * 内核原生公式栏（261025 定稿）：本 hook 只做三件事——
 * 1. 打开/关闭内核单元格编辑（原生移动公式栏由 UniverSheetsMobileUIPlugin 渲染）；
 * 2. 把选区地址注入原生栏（CSS ::before 显示 A11）并清掉内核 inline 定位，交给我们的 chrome CSS；
 * 3. 给原生 canvas 输入区画一个 2px 闪烁光标（内核 canvas 自己不画 caret）。
 *
 * 自绘输入条已删除（261025 回滚）：编辑输入面唯一来源 = 内核原生栏。
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
  const caretRef = useRef<HTMLSpanElement | null>(null);
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

  // 原生 canvas 不画 caret：读 formula-editor canvas 最右暗像素 = 文本末尾，贴一个 2px 闪烁条。
  useEffect(() => {
    if (!editing) return;
    const host = hostRef.current;
    if (!host) return;
    const update = () => {
      const el = caretRef.current;
      if (!el) return;
      const nativeBar = host.querySelector<HTMLElement>('[data-u-comp="mobile-formula-bar"]');
      const canvas = nativeBar?.querySelector<HTMLCanvasElement>('[data-u-comp="formula-editor"] canvas') ?? null;
      if (!canvas || nativeBar?.getAttribute("data-expanded") === "true") { el.style.display = "none"; return; }
      const rect = canvas.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) { el.style.display = "none"; return; }
      let right = -1;
      try {
        const ctx = canvas.getContext("2d");
        if (ctx && canvas.width > 0 && canvas.height > 0) {
          const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
          for (let y = 0; y < canvas.height; y += 1) {
            for (let x = canvas.width - 1; x >= 0; x -= 1) {
              const i = (y * canvas.width + x) * 4;
              if (data[i + 3] > 20 && data[i] < 200) { if (x > right) right = x; break; }
            }
          }
        }
      } catch { /* 忽略像素读取失败 */ }
      const ratio = canvas.width > 0 ? rect.width / canvas.width : 1;
      const left = rect.x + (right >= 0 ? (right + 2) * ratio : 2);
      const height = Math.max(14, Math.min(22, rect.height));
      const top = rect.y + (rect.height - height) / 2;
      el.style.display = "block";
      el.style.transform = "translate(" + Math.round(left) + "px, " + Math.round(top) + "px)";
      el.style.height = Math.round(height) + "px";
    };
    update();
    const timer = window.setInterval(update, 300);
    return () => window.clearInterval(timer);
  }, [editing, hostRef]);

  return { nativeEditing, nativeExpanded, caretRef, openNativeEditor, closeNativeEditor };
}
