import { sniffImageFormat } from "./imageFormat";
import { assetToken, LOCAL_ASSET_PREFIX } from "../../lib/assetPort";
import { rlog } from "../../lib/log";

const BLOCK_TAGS = new Set(["P", "DIV", "H1", "H2", "H3", "H4", "H5", "H6", "UL", "OL", "LI", "BLOCKQUOTE", "PRE", "TABLE", "THEAD", "TBODY", "TR", "TH", "TD"]);
const INLINE_TAGS = new Set(["SPAN", "STRONG", "B", "EM", "I", "U", "S", "DEL", "CODE", "A", "BR"]);
const HIDDEN_SELECTORS = ".ne-card-toolbar, .ne-card-resizer, ne-l-ph, ne-r-ph, [contenteditable='false'][aria-hidden='true']";

export function normalizeClipboardHtml(fragment: DocumentFragment, document: Document): string {
  const output = document.createElement("div");
  for (const child of Array.from(fragment.childNodes)) {
    const normalized = normalizeNode(child, document);
    if (normalized) output.append(normalized);
  }
  let html = output.innerHTML;
  // Strip zero-width characters that Lake uses for cursor positioning
  html = html.replace(/[\u200B\u200C\u200D\uFEFF]/g, "");
  // Remove <span> elements that only contain <br> or are empty
  html = html.replace(/<span[^>]*>\s*<br\s*\/?>\s*<\/span>/gi, "");
  html = html.replace(/<span[^>]*>\s*<\/span>/gi, "");
  // Remove empty block elements left behind
  html = html.replace(/<(p|div)[^>]*>\s*<\/\1>/gi, "");
  return html;
}

export interface ClipboardPayload {
  html: string;
  plain: string;
}

/**
 * 把 DOM Range 转成写入剪贴板的两段内容（HTML + 纯文本）。
 *
 * **单一来源**：正文 ⌘C/剪切 的 copy/cut 捕获处理器与块菜单「复制」桥（blockCopyBridge）
 * 都从这里取，保证「块级多选 → 点复制」和 ⌘C 产出**逐字节一致**的剪贴板内容
 * （图片物化/空块清理/零宽字符都只在 normalizeClipboardHtml 里做一次）。
 */
/**
 * Range → 纯文本（保留块级换行）。
 *
 * 为什么不用 `range.toString()`：它对块元素不做分隔，多段/标题/列表会粘成一行
 * （用户 261107 报「纯文字复制换行没了」）。这里按块级标签补 `\n`、`<br>` 转换行，
 * 隐藏节点同样跳过；单段内选区不会多出换行。
 */
/** 代码块内部纯文本：保留原有空行（该段不参与块间压缩）。 */
function codeBlockPlainText(element: Element): string {
  const out: string[] = [];
  const visit = (node: Node): void => {
    if (node.nodeType === Node.TEXT_NODE) { out.push(node.textContent ?? ""); return; }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node as Element;
    if (el.matches(HIDDEN_SELECTORS)) return;
    if (el.tagName === "BR") { out.push("\n"); return; }
    for (const child of Array.from(el.childNodes)) visit(child);
    // 代码行通常是 div / ne-line / li；行后补换行，空行（空 div）自然形成 \n\n。
    if (el.tagName === "DIV" || el.tagName === "P" || el.tagName === "LI" || el.tagName === "NE-LINE") out.push("\n");
  };
  visit(element);
  return out.join("").replace(/[ \t]+\n/g, "\n").replace(/^\n+|\n+$/g, "");
}

function isCodeBlock(element: Element): boolean {
  return element.tagName === "PRE" || element.tagName === "NE-CODE-BLOCK" || element.classList.contains("ne-code-block");
}

export function plainTextFromRange(range: Range): string {
  const CUSTOM_BLOCKS = /^(NE-P|NE-H[1-6]|NE-LI|NE-UL|NE-OL|NE-BLOCKQUOTE|NE-CODE-BLOCK|NE-TABLE|NE-CARD)$/;
  const parts: string[] = [];
  const codeBlocks: string[] = [];
  const codeMarker = (index: number): string => "\u0000" + index + "\u0000";
  const walk = (node: Node): void => {
    if (node.nodeType === Node.TEXT_NODE) {
      parts.push(node.textContent ?? "");
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const element = node as Element;
    if (element.matches(HIDDEN_SELECTORS)) return;
    if (element.tagName === "BR") {
      parts.push("\n");
      return;
    }
    if (isCodeBlock(element)) {
      // 用占位符把代码块隔离：块间换行归一化不会碰到它内部的原始空行。
      parts.push(codeMarker(codeBlocks.length));
      codeBlocks.push(codeBlockPlainText(element));
      parts.push("\n");
      return;
    }
    for (const child of Array.from(element.childNodes)) walk(child);
    if (BLOCK_TAGS.has(element.tagName) || CUSTOM_BLOCKS.test(element.tagName)) parts.push("\n");
  };
  for (const child of Array.from(range.cloneContents().childNodes)) walk(child);
  let text = parts.join("")
    .replace(/[\u200B\u200C\u200D\uFEFF]/g, "")
    .replace(/[ \t]+\n/g, "\n")
    // 嵌套块（卡片/列表里的段落）会让块级换行叠加成 \n\n ⇒ 压成单换行，避免复制出空行。
    .replace(/\n{2,}/g, "\n")
    .replace(/^\n+|\n+$/g, "");
  // 代码块内部原样回填（保留内容本来就有空行），不回填后再做归一化。
  for (let index = 0; index < codeBlocks.length; index += 1) {
    text = text.split(codeMarker(index)).join(codeBlocks[index]);
  }
  return text;
}

export function buildClipboardPayload(range: Range, document: Document): ClipboardPayload {
  return {
    html: normalizeClipboardHtml(range.cloneContents(), document),
    plain: plainTextFromRange(range),
  };
}

export function normalizeImageDataUrl(value: string): string | null {
  const match = /^data:[^;,]+;base64,([a-z0-9+/=\s]+)$/i.exec(value);
  if (!match) return value.startsWith("data:") ? null : value;
  const payload = match[1].replace(/\s/g, "");
  try {
    // 只解前 24 个 base64 字符（≈18 字节）做格式嗅探：复制事件里整串 atob 一张 12MP 照片
    // 会产生 10MB+ 的二进制串与逐字节数组（卡主线程/吃内存），而签名判断只需要开头几字节。
    const headLength = Math.min(24, Math.floor(payload.length / 4) * 4);
    const head = atob(payload.slice(0, headLength));
    const format = sniffImageFormat(Array.from(head, (character) => character.charCodeAt(0)));
    if (!format) return null;
    // Return corrected MIME type based on actual image format
    return `data:${format.mimeType};base64,${payload}`;
  } catch {
    return null;
  }
}

function isEmptyBlock(el: Element): boolean {
  const text = (el.textContent ?? "").replace(/[\s\u200B\u200C\u200D\uFEFF\u00A0]/g, "");
  if (text.length > 0) return false;
  const imgs = el.querySelectorAll("img");
  if (imgs.length > 0) return false;
  return true;
}

function normalizeNode(node: Node, document: Document): Node | null {
  if (node.nodeType === Node.TEXT_NODE) return document.createTextNode(node.textContent ?? "");
  if (!(node instanceof Element) || node.matches(HIDDEN_SELECTORS)) return null;

  if (node.tagName === "IMG") return normalizeImage(node as HTMLImageElement, document);
  if (node.tagName === "NE-CARD" || node.getAttribute("data-card-name") === "image") {
    const image = node.querySelector("img");
    return image ? normalizeImage(image, document) : normalizeChildren(node, document, "div");
  }

  const tagName = standardTagName(node);
  const output = document.createElement(tagName);
  copySafeAttributes(node, output);
  for (const child of Array.from(node.childNodes)) {
    const normalized = normalizeNode(child, document);
    if (normalized) output.append(normalized);
  }
  if (BLOCK_TAGS.has(tagName.toUpperCase()) && isEmptyBlock(output)) return null;
  return output;
}

function standardTagName(element: Element): string {
  if (BLOCK_TAGS.has(element.tagName)) return element.tagName.toLowerCase();
  if (INLINE_TAGS.has(element.tagName)) return element.tagName.toLowerCase();
  if (element.tagName === "NE-TEXT") return "span";
  if (element.tagName === "NE-P") return "p";
  return element.getAttribute("data-card-type") === "inline" ? "span" : "div";
}

function normalizeChildren(element: Element, document: Document, tagName: string): HTMLElement {
  const output = document.createElement(tagName);
  for (const child of Array.from(element.childNodes)) {
    const normalized = normalizeNode(child, document);
    if (normalized) output.append(normalized);
  }
  return output;
}

/**
 * 移动端环境判定：必须用 Capacitor 原生平台标志。
 * 旧实现用“lakeNative.uploadResource 存在”——但桌面也暴露该契约，会把桌面误判成移动端，
 * 进而对跨源资产图跑 canvas.toDataURL()，画布 taint 抛 SecurityError → 图片被丢弃（复制到微信裂图）。
 */
export function isMobileEnvironment(): boolean {
  try {
    const capacitor = (window as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
    return capacitor?.isNativePlatform?.() === true;
  } catch {
    return false;
  }
}

/** 已解码 <img> → canvas 同步转 PNG data URL（复制到微信；同步，复制事件内可用）。 */
function imageToPngDataUrl(image: HTMLImageElement): string | null {
  try {
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(image, 0, 0);
    return canvas.toDataURL("image/png");
  } catch {
    return null;
  }
}

function normalizeImage(image: HTMLImageElement, document: Document): HTMLImageElement | null {
  let source = image.getAttribute("src") ?? "";
  // 移动端本地资源图（canonical http://127.0.0.1:19876 或 blob:）：
  //   · 本地资产：**两端统一先同步取原图**（?base64=1，去掉显示用 w/date、保留 token）。
  //     不能再用 canvas —— 写作卡里 img 的 currentSrc 是 ?w=1024 缩略图，canvas 会把缩略图写进剪贴板。
  //   · blob: 临时预览：取不到原图字节，仍用 canvas 转 PNG（兜底不让复制裂图）。
  // 兜底：XHR 失败（旧服务/参数被破坏）时，移动端退回当前显示图 canvas（可能仍是缩略图，但不丢图）；
  // 桌面没有 canvas 兜底 ⇒ 与既有行为一致：取不到就丢弃该图（不写半截内容）。
  /** XHR/canvas 拿到的 data URL 还要按真实格式修正 MIME（避免 data:image/jpeg 里塞 PNG 头）。 */
  let needsFormatFix = false;
  if (source.startsWith(LOCAL_ASSET_PREFIX)) {
    const converted = assetUrlToDataUrlSync(source);
    if (converted) { source = converted; needsFormatFix = true; }
    else if (isMobileEnvironment() && image.complete && image.naturalWidth > 0) {
      const canvasPng = imageToPngDataUrl(image);
      if (!canvasPng) return null;
      source = canvasPng; needsFormatFix = true;
    } else return null;
  } else if (source.startsWith("blob:")) {
    if (!isMobileEnvironment() || !image.complete || image.naturalWidth <= 0) return null;
    const canvasPng = imageToPngDataUrl(image);
    if (!canvasPng) return null;
    source = canvasPng; needsFormatFix = true;
  } else {
    const normalized = normalizeImageDataUrl(source);
    if (!normalized || (!normalized.startsWith("data:image/") && !/^https?:\/\//i.test(normalized))) return null;
    source = normalized;
  }
  if (needsFormatFix && source.startsWith("data:")) {
    const normalized = normalizeImageDataUrl(source);
    if (!normalized) return null;
    source = normalized;
  }
  const output = document.createElement("img");
  output.src = source;
  if (image.alt) output.alt = image.alt;
  if (image.width > 0) output.width = image.width;
  if (image.height > 0) output.height = image.height;
  return output;
}

function copySafeAttributes(source: Element, target: HTMLElement): void {
  if (target.tagName === "A") {
    const href = source.getAttribute("href");
    if (href && /^(https?:|mailto:)/i.test(href)) target.setAttribute("href", href);
  }
  const style = source.getAttribute("style");
  if (style) target.setAttribute("style", style);
}

/**
 * 复制取图的 URL 规范化：把**显示专用**的 `w`（缩略档位）与 `date`（缓存破坏）去掉，
 * 其余 query（尤其 `token`）原样保留 —— 剪贴板物化必须写**原图**，不能写当前显示缩略图。
 * 非本地资产 URL 原样返回（外部图不归我们处理）。
 */
export function canonicalAssetUrlForCopy(url: string): string {
  if (!url.startsWith(LOCAL_ASSET_PREFIX)) return url;
  try {
    const parsed = new URL(url);
    parsed.searchParams.delete("w");
    parsed.searchParams.delete("date");
    return parsed.toString();
  } catch {
    return url;
  }
}

/** 组装资产服务器「取 data URL」请求。URL 已带 ?token= 时不能再拼第二个 ?（会把 base64 参数吞掉、返回二进制→裂图）。 */
export function buildAssetDataUrlRequest(url: string, token: string): string | null {
  if (!url.startsWith(LOCAL_ASSET_PREFIX)) return null;
  try {
    const target = new URL(url);
    target.searchParams.set("base64", "1");
    if (token) target.searchParams.set("token", token);
    return target.toString();
  } catch {
    return null;
  }
}

function assetUrlToDataUrlSync(url: string): string | null {
  const requestUrl = buildAssetDataUrlRequest(canonicalAssetUrlForCopy(url), assetToken());
  if (!requestUrl) return null;
  try {
    const xhr = new XMLHttpRequest();
    // 审计：CORS 拉取必须带资产令牌，否则资产服务器 403（外部网页无法读取本地图片）
    xhr.open("GET", requestUrl, false);
    xhr.send();
    if (xhr.status !== 200) return null;
    // 只接受 data URL；否则（403/参数被破坏/非 base64 分支）丢弃，避免把二进制当图片粘贴。
    const body = xhr.responseText;
    return body.startsWith("data:") ? body : null;
  } catch (e) {
    console.error("同步 XHR 获取本地图片失败:", e);
    return null;
  }
}



/**
 * 粘贴预处理：修复"复制时图片未加载"产生的空 SVG 占位。
 * 知乎等站点的懒加载图片在未加载完成时，img.src 是空白 SVG data URL，
 * 真实地址在 data-src / data-actualsrc / srcset 等属性里。
 * 这里在粘贴时把 src 替换为真实 URL，让 Lake 走正常下载管线（主进程带 Referer）。
 * 找不到真实 URL 的占位图保留原样（避免内容丢失）。
 */
export function upgradePastedHtml(html: string): string {
  if (!html.includes("data:image/svg+xml")) return html;
  let parsed: Document;
  try {
    parsed = new DOMParser().parseFromString(html, "text/html");
  } catch {
    return html;
  }
  let changed = false;
  const images = parsed.querySelectorAll("img");
  for (const img of Array.from(images)) {
    const src = img.getAttribute("src") || "";
    if (!isBlankSvgPlaceholder(src)) continue;
    const real = findRealImageUrl(img);
    if (real) {
      img.setAttribute("src", real);
      changed = true;
    }
  }
  return changed ? parsed.body.innerHTML : html;
}

function isBlankSvgPlaceholder(src: string): boolean {
  if (!src.startsWith("data:image/svg+xml")) return false;
  try {
    const decoded = decodeURIComponent(src.replace(/^data:image\/svg\+xml;utf8,?/, ""));
    // 空白 SVG：<svg ...></svg> 内无实际内容（无 path/circle/rect 等绘制元素）
    return /<svg[^>]*>\s*<\/svg>/.test(decoded) || !/<(path|circle|rect|line|polygon|polyline|ellipse|text|image|g)[\s>]/i.test(decoded);
  } catch {
    return false;
  }
}

function findRealImageUrl(img: Element): string | null {
  for (const attr of ["data-src", "data-actualsrc", "data-original", "data-lazy-src"]) {
    const value = img.getAttribute(attr);
    if (value && /^https?:\/\//i.test(value)) return value;
  }
  const srcset = img.getAttribute("srcset");
  if (srcset) {
    const first = srcset.split(",")[0]?.trim().split(/\s+/)[0];
    if (first && /^https?:\/\//i.test(first)) return first;
  }
  return null;
}


/**
 * 拦截原生粘贴事件的 getData("text/html")。
 * 原生 paste 事件的 clipboardData 是只读的，setData 无效（合成事件才能写），
 * 所以必须在 document 捕获阶段包一层 getData，返回升级（空 SVG 占位 → 真实 URL）后的 HTML，
 * 让 Lake 读到的就是处理过的内容。
 */
import { emitOversizeTablePaste, oversizeTableShape, shouldGuardOversizePaste } from "./tablePasteGuard";
import { activeEditorHost } from "./activeEditor";

/**
 * 一次粘贴的采集窗口（261023）：同一 paste 事件里内核会**多次**读 text/html（实测 13 次），
 * 统一压成一行 [perf] paste.html —— bytes / 读取次数 / 我们自己的升级耗时 / 是否被大表护栏拦下。
 * 粘贴"卡"的排查先看这行（配合 [perf] 资源上传 与 docs/TROUBLESHOOTING.md §M）。
 */
const PASTE_FLUSH_MS = 500;
const pasteStats = { open: false, bytes: 0, getData: 0, upgradeMs: 0, guard: "pass" as "pass" | "hit", timer: null as number | null };

function armPasteFlush(): void {
  if (pasteStats.timer !== null) window.clearTimeout(pasteStats.timer);
  pasteStats.timer = window.setTimeout(flushPasteWindow, PASTE_FLUSH_MS);
}

function flushPasteWindow(): void {
  if (pasteStats.timer !== null) { window.clearTimeout(pasteStats.timer); pasteStats.timer = null; }
  if (!pasteStats.open) return;
  // chars = 剪贴板 HTML 的字符数（不是字节数；中文页面两者差约 2–3 倍，别混用）
  const fields = { chars: pasteStats.bytes, getData: pasteStats.getData, guard: pasteStats.guard };
  const upgradeMs = pasteStats.upgradeMs;
  pasteStats.open = false;
  rlog.perf("paste.html", upgradeMs, fields);
}

function startPasteWindow(html: string): void {
  pasteStats.open = true;
  pasteStats.bytes = html ? html.length : 0;
  pasteStats.getData = 0;
  pasteStats.upgradeMs = 0;
  pasteStats.guard = "pass";
  armPasteFlush();
}

let pasteInterceptorInstalled = false;
export function installPasteInterceptor(): void {
  if (pasteInterceptorInstalled) return;
  pasteInterceptorInstalled = true;
  document.addEventListener(
    "paste",
    (event: Event) => {
      const dt = (event as ClipboardEvent).clipboardData;
      if (!dt) return;
      const clipboardData = dt as unknown as { getData: (type: string) => string };
      const originalGetData = clipboardData.getData.bind(clipboardData);
      // A（261008）：**大表格不进内核** —— 实测 5500 行 × 6 列（2.7MB HTML）会让主线程同步卡 30.7 秒
      // （内核表格卡片整表全量渲染、无虚拟化；云端 Lake 同样卡，见 HANDOFF §3#16）。
      // 拦在捕获阶段：阻止本次粘贴 + 抛事件让 TablePasteGuardDialog 给明确出口；
      // **剪贴板内容保留、绝不静默丢弃**（AGENTS §3#16）。
      const pastedHtml = originalGetData("text/html");
      startPasteWindow(pastedHtml);
      // 261009：护栏只对 **Lake 文档** 生效。网格类编辑器（usheet/sheet/bitable/board）自己按单元格
      // 处理大表粘贴、不经过内核表格卡片，拦它会把用户的大表粘贴误当成"文档卡死"（用户实测粘进 usheet 弹了护栏）。
      const oversized = shouldGuardOversizePaste(activeEditorHost()) ? oversizeTableShape(pastedHtml) : null;
      if (oversized) {
        event.preventDefault();
        event.stopImmediatePropagation();
        pasteStats.guard = "hit";
        flushPasteWindow();
        emitOversizeTablePaste({ shape: oversized, html: pastedHtml, at: Date.now() });
        return;
      }
      clipboardData.getData = (type: string): string => {
        const value = originalGetData(type);
        if (type === "text/html" && value) {
          const startedAt = performance.now();
          const upgraded = upgradePastedHtml(value);
          pasteStats.getData += 1;
          pasteStats.upgradeMs += performance.now() - startedAt;
          armPasteFlush();
          return upgraded || value;
        }
        return value;
      };
    },
    true
  );
}
