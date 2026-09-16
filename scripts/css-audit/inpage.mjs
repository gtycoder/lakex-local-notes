/** 注入到渲染进程里执行的纯函数（不能引用外部作用域）。 */

export const call = (fn, ...args) => "(" + fn.toString() + ")(" + args.map((a) => JSON.stringify(a)).join(",") + ")";

export const INHERITED_PROPS = ["color", "font-family", "font-size", "font-style", "font-weight", "line-height",
  "letter-spacing", "text-align", "text-indent", "text-transform", "visibility", "cursor", "white-space",
  "word-break", "list-style-type", "caret-color", "text-shadow", "quotes"];

/**
 * 逐条判定带 !important 的声明是否真的在起作用。
 * 返回 [{ id, file, media, selector, prop, value, matched, verdict, samples }]
 * verdict: dead（本屏无匹配元素）/ redundant（去掉优先级计算值不变）/ load-bearing（去掉就变）/ unsupported
 */
export function classifyImportant(inherited) {
  const results = [];
  const styleRules = [];
  const fileOf = (ss) => {
    const node = ss.ownerNode;
    const devId = node && node.getAttribute ? node.getAttribute("data-vite-dev-id") : null;
    return devId || ss.href || "(inline)";
  };
  const walk = (list, media) => {
    for (const r of list) {
      if (r.cssRules && !r.selectorText) {
        if (r.constructor.name === "CSSKeyframesRule") continue;
        const cond = r.conditionText || (r.media && r.media.mediaText) || "@";
        try { walk(r.cssRules, (media ? media + " " : "") + cond); } catch (e) { /* ignore */ }
      } else if (r.selectorText && r.style) {
        styleRules.push({ rule: r, media: media || null });
      }
    }
  };
  for (const ss of document.styleSheets) {
    let list = null;
    try { list = ss.cssRules; } catch (e) { continue; }
    if (!list) continue;
    const before = styleRules.length;
    walk(list, fileOf(ss));
    for (let i = before; i < styleRules.length; i++) styleRules[i].file = fileOf(ss);
  }
  const counters = new Map();
  for (let gi = 0; gi < styleRules.length; gi++) {
    const sr = styleRules[gi];
    sr.id = sr.file.split("/").slice(-2).join("/") + "#" + gi;
  }
  for (const sr of styleRules) {
    const st = sr.rule.style;
    for (let i = 0; i < st.length; i++) {
      const prop = st.item(i);
      if (st.getPropertyPriority(prop) !== "important") continue;
      const value = st.getPropertyValue(prop);
      const rec = { id: sr.id, di: i, file: sr.file, media: sr.media, selector: sr.rule.selectorText, prop, value, matched: 0, verdict: "dead", changed: 0, samples: [] };
      let els = [];
      try { els = Array.from(document.querySelectorAll(sr.rule.selectorText)); }
      catch (e) { rec.verdict = "unsupported"; results.push(rec); continue; }
      rec.matched = els.length;
      if (els.length === 0) { results.push(rec); continue; }
      const probe = [];
      for (const el of els.slice(0, 40)) {
        probe.push({ el, tag: "self" });
        if (inherited.indexOf(prop) >= 0) {
          const kids = Array.from(el.querySelectorAll("*")).slice(0, 60);
          for (const k of kids) probe.push({ el: k, tag: "desc" });
        }
      }
      const read = (p) => p.map((x) => getComputedStyle(x.el).getPropertyValue(prop));
      const before = read(probe);
      st.setProperty(prop, value, "");
      const after = read(probe);
      st.setProperty(prop, value, "important");
      for (let k = 0; k < probe.length; k++) {
        if (before[k] !== after[k]) {
          rec.changed++;
          if (rec.samples.length < 3) {
            const e = probe[k].el;
            const cls = String(e.className || "").split(/\s+/).slice(0, 2).join(".");
            rec.samples.push({ el: e.tagName.toLowerCase() + (cls ? "." + cls : ""), role: probe[k].tag, before: before[k], after: after[k] });
          }
        }
      }
      rec.verdict = rec.changed > 0 ? "load-bearing" : "redundant";
      results.push(rec);
    }
  }
  return { count: results.length, results };
}

/** 视觉指纹：每个元素的几何 + 绘制 + 字体，存 window.__fpLines 并返回哈希。 */
export function fingerprint(slot) {
  const PROPS = ["color", "background-color", "background-image", "border-top-width", "border-right-width",
    "border-bottom-width", "border-left-width", "border-top-color", "border-bottom-color", "border-radius",
    "box-shadow", "opacity", "font-size", "font-weight", "font-family", "line-height", "letter-spacing",
    "text-align", "text-decoration-line", "white-space", "padding-top", "padding-right", "padding-bottom",
    "padding-left", "margin-top", "margin-bottom", "margin-left", "margin-right", "gap", "row-gap",
    "column-gap", "display", "position", "z-index", "overflow-x", "overflow-y", "flex-direction",
    "justify-content", "align-items", "grid-template-columns", "order", "top", "left", "right", "bottom",
    "transition-duration", "transition-property", "cursor", "visibility", "outline-width", "outline-color",
    "text-overflow", "transform"];
  const els = Array.from(document.querySelectorAll("*"));
  const lines = [];
  for (let i = 0; i < els.length; i++) {
    const el = els[i];
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    const parts = [];
    for (const p of PROPS) parts.push(cs.getPropertyValue(p));
    const cls = String(el.className || "").slice(0, 80);
    lines.push(i + "|" + el.tagName + "|" + cls + "|" + [r.x, r.y, r.width, r.height].map((v) => Math.round(v * 10) / 10).join(",") + "|" + parts.join(";"));
  }
  const all = lines.join("\n");
  let h = 2166136261;
  for (let i = 0; i < all.length; i++) { h ^= all.charCodeAt(i); h = Math.imul(h, 16777619); }
  window["__fp_" + slot] = lines;
  return { hash: (h >>> 0).toString(16), elements: els.length, chars: all.length };
}

/** 比较两次指纹，返回逐元素差异（最多 40 条）。 */
export function fingerprintDiff() {
  const a = window.__fp_base || [];
  const b = window.__fp_after || [];
  const out = { baseCount: a.length, afterCount: b.length, diffs: [] };
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    if (a[i] !== b[i]) {
      if (out.diffs.length < 40) out.diffs.push({ i, base: a[i], after: b[i] });
      out.changed = (out.changed || 0) + 1;
    }
  }
  return out;
}
