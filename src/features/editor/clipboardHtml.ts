import { sniffImageFormat } from "./imageFormat";

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

export function normalizeImageDataUrl(value: string): string | null {
  const match = /^data:[^;,]+;base64,([a-z0-9+/=\s]+)$/i.exec(value);
  if (!match) return value.startsWith("data:") ? null : value;
  try {
    const binary = atob(match[1].replace(/\s/g, ""));
    const bytes = Array.from(binary, (character) => character.charCodeAt(0));
    const format = sniffImageFormat(bytes);
    if (!format) return null;
    // Return corrected MIME type based on actual image format
    return `data:${format.mimeType};base64,${match[1].replace(/\s/g, "")}`;
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

function normalizeImage(image: HTMLImageElement, document: Document): HTMLImageElement | null {
  let source = image.getAttribute("src") ?? "";
  if (source.startsWith(LOCAL_ASSET_PREFIX)) {
    const converted = assetUrlToDataUrlSync(source);
    if (converted) source = converted;
    else return null;
  } else {
    const normalized = normalizeImageDataUrl(source);
    if (!normalized || (!normalized.startsWith("data:image/") && !/^https?:\/\//i.test(normalized))) return null;
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

const LOCAL_ASSET_PREFIX = "http://127.0.0.1:19876/";

function assetUrlToDataUrlSync(url: string): string | null {
  if (!url.startsWith(LOCAL_ASSET_PREFIX)) return null;
  try {
    const xhr = new XMLHttpRequest();
    xhr.open("GET", url + "?base64=1", false);
    xhr.send();
    if (xhr.status !== 200) return null;
    return xhr.responseText; // already "data:image/png;base64,..."
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
let pasteInterceptorInstalled = false;
function escapeHtmlText(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Cmd/Ctrl+Shift+V：粘贴为纯文本。
 * 实测：Chromium（Electron）的 Cmd+Shift+V 不产生 paste 事件（无默认菜单项也不触发），
 * execCommand("paste"/"insertHTML") 在 Lake 编辑器不可靠（被 Lake 重置或拒绝）。
 * 正解：keydown 拦截（document 捕获，先于一切）→ 读剪贴板纯文本 →
 * 在光标处直接插入 <p> 段落（contenteditable 标准机制）→ 派发 input 事件驱动 Lake 同步。
 * 另保留 paste 事件补丁：若某环境仍触发 paste（armed 置位），同样转纯文本，双保险。 */
let pasteAsPlainTextArmed = false;

/** 判断焦点是否在 Lake 编辑器内 */
function isFocusInLakeEditor(anchor: Node | null): boolean {
  if (!anchor || !anchor.isConnected) return false;
  const el = anchor instanceof Element ? anchor : anchor.parentElement;
  return !!el?.closest(".lake-editor");
}

/** 在光标处插入多个纯文本段落（contenteditable 标准机制），派发 input 事件驱动 Lake 同步 */
function insertPlainParagraphs(paragraphs: string[]): void {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return;
  const doc = sel.anchorNode?.ownerDocument ?? document;
  const host = sel.anchorNode instanceof Element
    ? sel.anchorNode.closest(".ne-engine")
    : sel.anchorNode?.parentElement?.closest(".ne-engine");
  if (!host) return;
  const range = sel.getRangeAt(0);
  range.deleteContents();
  let prev: HTMLElement | null = null;
  for (const line of paragraphs) {
    const p = doc.createElement("p");
    p.textContent = line;
    if (prev === null) {
      range.insertNode(p);
    } else {
      const r = doc.createRange();
      r.setStartAfter(prev);
      r.collapse(true);
      r.insertNode(p);
    }
    prev = p;
  }
  // 光标移到最后一个段落末尾
  if (prev) {
    const r = doc.createRange();
    r.selectNodeContents(prev);
    r.collapse(false);
    sel.removeAllRanges();
    sel.addRange(r);
  }
  host.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertParagraph", data: null }));
}

/** 读剪贴板纯文本并插入为段落（Cmd/Ctrl+Shift+V 自实现） */
async function pastePlainTextFromClipboard(event: KeyboardEvent): Promise<void> {
  // 仅当焦点在 Lake 编辑器内时处理
  if (!isFocusInLakeEditor(window.getSelection()?.anchorNode ?? null)) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  try {
    const text = await navigator.clipboard.readText();
    const paragraphs = text.split(/\n+/).map((line) => line.trim()).filter(Boolean);
    if (paragraphs.length === 0) return;
    insertPlainParagraphs(paragraphs);
  } catch { /* 剪贴板读取被拒（如未授权）时忽略 */ }
}

export function installPasteInterceptor(): void {
  if (pasteInterceptorInstalled) return;
  pasteInterceptorInstalled = true;
  // 记录 Cmd/Ctrl+Shift+V：keydown 置位（供 paste 事件兜底）+ 自实现纯文本粘贴。
  document.addEventListener("keydown", (event: KeyboardEvent) => {
    if (event.key.toLowerCase() === "v" && (event.metaKey || event.ctrlKey) && event.shiftKey) {
      pasteAsPlainTextArmed = true;
      window.setTimeout(() => { pasteAsPlainTextArmed = false; }, 1000);
      void pastePlainTextFromClipboard(event);
    }
  }, true);
  document.addEventListener(
    "paste",
    (event: Event) => {
      const dt = (event as ClipboardEvent).clipboardData;
      if (!dt) return;
      const armed = pasteAsPlainTextArmed;
      pasteAsPlainTextArmed = false;
      const clipboardData = dt as unknown as { getData: (type: string) => string };
      const originalGetData = clipboardData.getData.bind(clipboardData);
      clipboardData.getData = (type: string): string => {
        const value = originalGetData(type);
        if (type === "text/html") {
          if (armed) {
            // 纯文本模式：把 text/plain 包装成 <p> 段落
            const text = originalGetData("text/plain") || "";
            const paragraphs = text.split(/\n+/).map((line) => line.trim()).filter(Boolean);
            if (paragraphs.length > 0) return paragraphs.map((line) => `<p>${escapeHtmlText(line)}</p>`).join("");
            return "";
          }
          if (value) {
            const upgraded = upgradePastedHtml(value);
            return upgraded || value;
          }
        }
        return value;
      };
    },
    true
  );
}
