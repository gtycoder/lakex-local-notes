/**
 * 原生 `title` 提示 → 自绘气泡（261115 A04）：两端共用的纯 DOM 逻辑。
 *
 * 桌面 / 移动各自一个薄壳（`components/ui/NativeTitleTips`、`mobile/ui/MobileTitleTips`）只决定
 * 气泡的 id 与 class；样式各端自有（`.ln-tip` / `.mb-tip`）—— 移动端不 import 桌面 UI 组件，
 * 也不共享桌面样式（AGENTS §4 / mobileIndependence）。
 *
 * 行为：
 *  · 桌面（鼠标/笔）：指针进入带 `title` 的元素 → 350ms 后显示；离开/点击/滚动即收起；
 *  · 触屏：`pointerdown` 起 450ms 长按计时，到点显示；`pointerup`/`pointercancel`/
 *    `pointermove` 超过 8px / 点击 / 滚动立即收起；
 *  · `focusin` 同样按 350ms 显示（键盘/读屏场景）；
 *  · 摘 `title` 前先判断元素是否还有别的可访问名（aria-label / aria-labelledby / 自身文本），
 *    没有就保留 title（不让读屏丢描述）；
 *  · 显示期间给锚点补 `aria-describedby` 指向单例 tip，隐藏时恢复锚点原值；
 *  · 跳过内核区域（`.lake-editor-mount` / `.ne-*`），事件在 cleanup 时全部移除。
 */
export const HOVER_DELAY_MS = 350;
export const LONG_PRESS_MS = 450;
export const LONG_PRESS_MOVE_TOLERANCE = 8;
const GAP = 6;
const MARGIN = 8;

export type Point = { x: number; y: number };

export type NativeTitleTipsOptions = {
  /** 单例 tip 的 id（`aria-describedby` 指向它）。 */
  id: string;
  /** 气泡基础类名（桌面 `ln-tip` / 移动 `mb-tip`）。 */
  tipClassName: string;
  /** 额外类名（如桌面的 `native-title-tip`）。 */
  extraClassName?: string;
  /** 长内容宽版附加类名（桌面 `ln-tip--wide` / 移动 `mb-tip--wide`）。 */
  wideClassName?: string;
};

/** 长按指针是否已移出容差（行为与用例共用同一判据）。 */
export function isLongPressMoved(start: Point, point: Point): boolean {
  return Math.hypot(point.x - start.x, point.y - start.y) > LONG_PRESS_MOVE_TOLERANCE;
}

/**
 * `title` 之外是否还有可访问名（A04 缺口 2 的判据）。
 * 三者任一成立即视为「摘掉 title 不会丢描述」：aria-label 非空、aria-labelledby 指向的元素有文本、
 * 元素自身文本内容非空。都不成立 ⇒ 必须保留 title（否则读屏读到的是没有描述的元素）。
 */
export function hasOtherAccessibleName(el: Element): boolean {
  const ariaLabel = el.getAttribute("aria-label");
  if (ariaLabel && ariaLabel.trim()) return true;
  const labelledBy = el.getAttribute("aria-labelledby");
  if (labelledBy) {
    for (const id of labelledBy.split(/\s+/)) {
      if (!id) continue;
      const labelled = el.ownerDocument.getElementById(id);
      if (labelled && (labelled.textContent ?? "").trim()) return true;
    }
  }
  return Boolean((el.textContent ?? "").trim());
}

type Prepared = { anchor: Element; text: string };

/**
 * 安装全仓唯一的 title 拦截器，返回 cleanup（移除监听、复原锚点、删除 tip）。
 * 同一时刻只应挂一个实例（桌面或移动外壳各一次）。
 */
export function installNativeTitleTips(options: NativeTitleTipsOptions): () => void {
  const tip = document.createElement("span");
  tip.id = options.id;
  tip.className = [options.tipClassName, options.extraClassName].filter(Boolean).join(" ");
  tip.setAttribute("role", "tooltip");
  tip.style.display = "none";
  document.body.appendChild(tip);

  /** 被摘掉的 title（只在「有别的可访问名」时才摘；否则保留给读屏）。 */
  const savedTitles = new WeakMap<Element, string>();
  /** 锚点原本的 aria-describedby（null = 原本没有该属性）。 */
  const savedDescribedBy = new WeakMap<Element, string | null>();
  let current: Element | null = null;
  let hoverTimer: number | undefined;
  let pressTimer: number | undefined;
  /** 触屏长按进行中（含已显示、手指还没抬起）。 */
  let press: { anchor: Element; start: Point } | null = null;

  const clearHoverTimer = () => {
    if (hoverTimer !== undefined) window.clearTimeout(hoverTimer);
    hoverTimer = undefined;
  };
  const clearPress = () => {
    if (pressTimer !== undefined) window.clearTimeout(pressTimer);
    pressTimer = undefined;
    press = null;
  };
  /** 只收拾当前锚点（title / aria-describedby），不碰计时器与 tip 表面。 */
  const restoreCurrent = () => {
    if (!current) return;
    const text = savedTitles.get(current);
    if (text != null && !current.hasAttribute("title")) current.setAttribute("title", text);
    savedTitles.delete(current);
    if (savedDescribedBy.has(current)) {
      const original = savedDescribedBy.get(current) ?? null;
      if (original == null) current.removeAttribute("aria-describedby");
      else current.setAttribute("aria-describedby", original);
      savedDescribedBy.delete(current);
    }
    current = null;
  };

  const hide = () => {
    clearHoverTimer();
    clearPress();
    restoreCurrent();
    tip.style.display = "none";
  };

  const show = (anchor: Element, text: string) => {
    tip.textContent = text;
    const wide = text.length > 80 || text.includes("\n");
    if (options.wideClassName) tip.classList.toggle(options.wideClassName, wide);
    tip.style.display = "block";
    tip.style.left = "0px";
    tip.style.top = "0px";
    // 先量真实尺寸再定位（与 usePopoverPosition 同口径：不猜高度）
    const a = anchor.getBoundingClientRect();
    const t = tip.getBoundingClientRect();
    const below = a.bottom + GAP;
    const top = below + t.height + MARGIN <= window.innerHeight ? below : Math.max(MARGIN, a.top - t.height - GAP);
    const left = Math.min(Math.max(MARGIN, a.left), Math.max(MARGIN, window.innerWidth - t.width - MARGIN));
    tip.style.left = `${Math.round(left)}px`;
    tip.style.top = `${Math.round(top)}px`;
    // A04 缺口 3：显示期间把单例 tip 关联到锚点；原值留给 hide 还原。
    if (!savedDescribedBy.has(anchor)) savedDescribedBy.set(anchor, anchor.getAttribute("aria-describedby"));
    anchor.setAttribute("aria-describedby", options.id);
  };

  /** 核准锚点并接管它的 title；返回 null 表示没有可显示的文字。 */
  const prepare = (candidate: Element): Prepared | null => {
    clearHoverTimer();
    if (current) restoreCurrent();
    const text = candidate.getAttribute("title");
    if (!text || !text.trim()) return null;
    current = candidate;
    // A04 缺口 2：有别的可访问名才摘 title；只有 title 一个名字时保留描述，tip 照样显示。
    if (hasOtherAccessibleName(candidate)) {
      savedTitles.set(candidate, text);
      candidate.removeAttribute("title"); // 原生气泡从此刻起不会再出现
    }
    return { anchor: candidate, text };
  };

  const pointerTypeOf = (event: Event): string => (event as PointerEvent).pointerType ?? "";
  const clientPoint = (event: Event): Point => {
    const pe = event as PointerEvent;
    return { x: pe.clientX ?? 0, y: pe.clientY ?? 0 };
  };

  /** 目标是否属于外壳的 title（内核区域、tip 自身不接管）。 */
  const anchorFor = (target: EventTarget | null): Element | null => {
    if (!(target instanceof Element)) return null;
    if (target === tip || tip.contains(target)) return null;
    if (target.closest("#" + options.id)) return null;
    if (target.closest(".lake-editor-mount, .ne-engine, .ne-ui")) return null;
    return target.closest("[title]");
  };

  /** 桌面悬停 + focusin（键盘/读屏）：350ms 后显示。 */
  const onOver = (e: Event) => {
    // 触屏没有 hover：显示走长按；长按进行中的 focusin 也不得提前触发。
    if (pointerTypeOf(e) === "touch" || press) return;
    const anchor = anchorFor(e.target);
    if (!anchor || anchor === current) return;
    const prepared = prepare(anchor);
    if (!prepared) return;
    hoverTimer = window.setTimeout(() => {
      hoverTimer = undefined;
      if (current === prepared.anchor) show(prepared.anchor, prepared.text);
    }, HOVER_DELAY_MS);
  };

  const onLeave = (e: Event) => {
    if (!current) return;
    const related = (e as MouseEvent).relatedTarget;
    const to = related instanceof Element ? related : null;
    if (to && current.contains(to)) return;
    hide();
  };

  /** 任何指针按下都先收起当前提示（桌面既有行为）；触屏另外进入长按计时。 */
  const onPointerDown = (e: Event) => {
    hide();
    if (pointerTypeOf(e) !== "touch") return;
    const anchor = anchorFor(e.target);
    if (!anchor) return;
    press = { anchor, start: clientPoint(e) };
    pressTimer = window.setTimeout(() => {
      pressTimer = undefined;
      const active = press;
      if (!active || active.anchor !== anchor) return;
      const prepared = prepare(anchor);
      if (!prepared) {
        clearPress();
        return;
      }
      show(prepared.anchor, prepared.text);
    }, LONG_PRESS_MS);
  };

  const onPointerMove = (e: Event) => {
    if (!press) return;
    if (isLongPressMoved(press.start, clientPoint(e))) hide();
  };

  const onPointerUp = () => {
    if (press) hide();
  };

  const onPointerCancel = () => {
    if (press) hide();
  };

  /** 点击 / 键盘 / 滚动 / 失焦都立即收起（点击与滚动是移动端主要退出方式）。 */
  const onDismiss = () => hide();

  document.addEventListener("pointerover", onOver, true);
  document.addEventListener("pointerout", onLeave, true);
  document.addEventListener("focusin", onOver, true);
  document.addEventListener("focusout", onLeave, true);
  document.addEventListener("pointerdown", onPointerDown, true);
  document.addEventListener("pointermove", onPointerMove, true);
  document.addEventListener("pointerup", onPointerUp, true);
  document.addEventListener("pointercancel", onPointerCancel, true);
  document.addEventListener("click", onDismiss, true);
  document.addEventListener("keydown", onDismiss, true);
  window.addEventListener("scroll", onDismiss, true);
  window.addEventListener("blur", onDismiss);

  return () => {
    document.removeEventListener("pointerover", onOver, true);
    document.removeEventListener("pointerout", onLeave, true);
    document.removeEventListener("focusin", onOver, true);
    document.removeEventListener("focusout", onLeave, true);
    document.removeEventListener("pointerdown", onPointerDown, true);
    document.removeEventListener("pointermove", onPointerMove, true);
    document.removeEventListener("pointerup", onPointerUp, true);
    document.removeEventListener("pointercancel", onPointerCancel, true);
    document.removeEventListener("click", onDismiss, true);
    document.removeEventListener("keydown", onDismiss, true);
    window.removeEventListener("scroll", onDismiss, true);
    window.removeEventListener("blur", onDismiss);
    hide();
    tip.remove();
  };
}
