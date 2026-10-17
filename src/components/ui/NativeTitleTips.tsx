import { useEffect } from "react";

/**
 * 原生 `title` 提示 → 自绘 `.ln-tip`（261006 Phase 2.2）。
 *
 * 为什么需要：全仓有 **168 处** `title="…"`。原生提示由系统绘制：约 1s 延迟、字体/颜色/圆角
 * 一律不受主题控制，是最后一类「不属于设计系统」的面。逐处改成 hook 不现实（168 处、且每处都要
 * 在组件里调用），所以这里做**一处实现覆盖全部**：
 *
 *   指针进入带 `title` 的元素时 —— 先把 `title` 摘下来（原生气泡就再也不会出现），
 *   延时 350ms 后用 `.ln-tip` 在锚点下方（放不下则翻上方）显示同一段文字；离开/点击/滚动即还原。
 *
 * 边界：
 *  · 只在桌面外壳内挂载（移动端不渲染本组件）；
 *  · 跳过 `.lake-editor-mount` / `.ne-*`（内核正文里的 title 不属于外壳）；
 *  · 不改任何业务 TSX，也不改 `aria-label`（无障碍名不受影响）。
 */
const TIP_ID = "lake-native-title-tip";
const DELAY_MS = 350;
const GAP = 6;
const MARGIN = 8;

export function NativeTitleTips() {
  useEffect(() => {
    const tip = document.createElement("span");
    tip.id = TIP_ID;
    tip.className = "ln-tip native-title-tip";
    tip.setAttribute("role", "tooltip");
    tip.style.display = "none";
    document.body.appendChild(tip);

    const saved = new WeakMap<Element, string>();
    let current: Element | null = null;
    let timer: number | undefined;

    const hide = () => {
      if (timer) window.clearTimeout(timer);
      timer = undefined;
      if (current) {
        const text = saved.get(current);
        if (text != null && !current.hasAttribute("title")) current.setAttribute("title", text);
        saved.delete(current);
        current = null;
      }
      tip.style.display = "none";
    };

    const show = (anchor: Element, text: string) => {
      tip.textContent = text;
      // 261017：长内容（Markdown/AI 字段/长文本的 title 预览）用宽版表面（同材质，只加宽 + 内部滚动）。
      tip.classList.toggle("ln-tip--wide", text.length > 80 || text.includes("\n"));
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
    };

    const onOver = (e: Event) => {
      const target = e.target as Element | null;
      if (!target || target === tip || tip.contains(target)) return;
      if (target.closest("#" + TIP_ID)) return;
      if (target.closest(".lake-editor-mount, .ne-engine, .ne-ui")) return;
      const el = target.closest("[title]");
      if (!el || el === current) return;
      if (current) hide();
      const text = el.getAttribute("title");
      if (!text || !text.trim()) return;
      current = el;
      saved.set(el, text);
      el.removeAttribute("title"); // 原生气泡从此刻起不会再出现
      const anchor = el;
      timer = window.setTimeout(() => show(anchor, text), DELAY_MS);
    };

    const onLeave = (e: Event) => {
      if (!current) return;
      const to = e instanceof PointerEvent ? (e.relatedTarget as Element | null) : null;
      if (to && current.contains(to)) return;
      hide();
    };

    document.addEventListener("pointerover", onOver, true);
    document.addEventListener("pointerout", onLeave, true);
    document.addEventListener("pointerdown", hide, true);
    document.addEventListener("keydown", hide, true);
    window.addEventListener("scroll", hide, true);
    window.addEventListener("blur", hide);

    return () => {
      document.removeEventListener("pointerover", onOver, true);
      document.removeEventListener("pointerout", onLeave, true);
      document.removeEventListener("pointerdown", hide, true);
      document.removeEventListener("keydown", hide, true);
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("blur", hide);
      hide();
      tip.remove();
    };
  }, []);

  return null;
}
