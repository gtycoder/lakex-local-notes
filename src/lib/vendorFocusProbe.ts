/**
 * 开发期「第三方 UI 叠了我们全局焦点环」探针（261023）。
 *
 * 背景：`src/styles/tokens.css` 的全局 `:where(button, input, …):focus-visible` 焦点环服务自有控件；
 * 第三方编辑器（Univer / lakex / Drawnix）的弹窗与工具条里也有 input/textarea/select，
 * 它们自带边框 + 聚焦 ring ⇒ 再叠我们的 2px outline 就是两层/三层边框（历史反复出现：
 * 多维表行内重命名、表格「插入链接」「查找替换」…）。
 *
 * 归属原则与样式落点见 `src/styles/vendor-focus.css`；本探针只做**开发期回归检测**：
 * 在第三方宿主里聚焦控件时，若计算样式仍带着 outline（= 我们的全局环），控制台告警并记录；
 * `window.__vendorFocusProbe()` 返回命中列表（空数组 = 干净）。
 *
 * 判据必须**自证**（261022 踩过「探针静默失效」）：本文件的 `vendorHostAncestor`/`isStackedFocusRing`
 * 由 `vendorFocusProbe.test.ts` 用已知会命中的样本卡住。
 */

/** 第三方**宿主容器**（与 src/styles/vendor-focus.css 的 :is() 列表一一对应；新增第三方编辑器时两处一起补）。 */
export const VENDOR_HOST_SELECTORS = [
  ".usheet-editor",
  "[data-lake-univer-floating]",
  ".lake-editor-mount",
  ".ne-overlay-container",
  ".board-editor",
] as const;

/** 第三方样式前缀：用于兜住宿主内部更深一层的 vendor 组件（univer-* / ne-* / lakex-* / plait-*）。 */
export const VENDOR_CLASS_PREFIXES = ["univer-", "ne-", "lakex-", "plait-"] as const;

/** 往上找最近的一个「第三方宿主」元素；找不到 = 我们自有 DOM。 */
export function vendorHostAncestor(el: Element | null): Element | null {
  const hostSelector = VENDOR_HOST_SELECTORS.join(",");
  for (let node: Element | null = el; node; node = node.parentElement) {
    if (node.matches?.(hostSelector)) return node;
    const className = typeof node.className === "string" ? node.className : "";
    if (className.split(/\s+/).some((cls) => VENDOR_CLASS_PREFIXES.some((prefix) => cls.startsWith(prefix)))) return node;
  }
  return null;
}

/** 该元素是否「在第三方宿主里 + 仍带着可见 outline（= 我们的全局焦点环白叠上去了）」。 */
export function isStackedFocusRing(el: Element, outline: { style: string; width: string }): boolean {
  if (outline.style === "none") return false;
  if (!(Number.parseFloat(outline.width) > 0)) return false;
  return vendorHostAncestor(el) !== null;
}

export interface VendorFocusHit {
  tag: string;
  cls: string;
  outline: string;
  host: string;
}

export function installVendorFocusProbe(): () => void {
  if (typeof window === "undefined") return () => {};
  const hits: VendorFocusHit[] = [];
  const onFocus = (event: FocusEvent) => {
    const el = event.target;
    if (!(el instanceof Element)) return;
    const cs = getComputedStyle(el);
    if (!isStackedFocusRing(el, { style: cs.outlineStyle, width: cs.outlineWidth })) return;
    const host = vendorHostAncestor(el);
    const hit: VendorFocusHit = {
      tag: el.tagName.toLowerCase(),
      cls: String((el as HTMLElement).className ?? "").slice(0, 80),
      outline: cs.outlineWidth + " " + cs.outlineStyle + " " + cs.outlineColor,
      host: host ? String((host as HTMLElement).className ?? host.tagName).slice(0, 60) : "",
    };
    hits.push(hit);
    if (hits.length <= 20) {
      console.warn("[vendor-focus] 第三方控件叠了全局焦点环（把它并入 src/styles/vendor-focus.css 的 :is() 列表）：", hit);
    }
  };
  window.addEventListener("focusin", onFocus, true);
  (window as unknown as { __vendorFocusProbe?: () => VendorFocusHit[] }).__vendorFocusProbe = () => hits.slice();
  return () => {
    window.removeEventListener("focusin", onFocus, true);
    delete (window as unknown as { __vendorFocusProbe?: unknown }).__vendorFocusProbe;
  };
}
