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

/** 移动端 blob 注入判定：window.lakeNative.uploadResource 存在 = 移动端（桌面无此注入）。
 * 移动端复制到微信：blob 注入的图已解码（naturalWidth>0）→ canvas 同步转 PNG data URL
 * （微信等不渲染 data:image/webp/avif，统一转 PNG，对齐桌面 assetServer ?base64=1 sharp 行为）。 */
function isMobileBlobEnvironment(): boolean {
  return typeof window !== "undefined" && typeof (window as { lakeNative?: { uploadResource?: unknown } }).lakeNative?.uploadResource === "function";
}

function blobImageToPngDataUrl(image: HTMLImageElement): string | null {
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
  // 移动端：blob 注入的图（src=blob: 且已解码）→ canvas 转 PNG（复制到微信；同步，复制事件内可用）
  if (isMobileBlobEnvironment() && source.startsWith("blob:") && image.complete && image.naturalWidth > 0) {
    const converted = blobImageToPngDataUrl(image);
    if (converted) source = converted;
    else return null;
  }
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

import { ASSET_TOKEN, LOCAL_ASSET_PREFIX } from "../../lib/assetPort";

function assetUrlToDataUrlSync(url: string): string | null {
  if (!url.startsWith(LOCAL_ASSET_PREFIX)) return null;
  try {
    const xhr = new XMLHttpRequest();
    // 审计：CORS 拉取必须带资产令牌，否则资产服务器 403（外部网页无法读取本地图片）
    xhr.open("GET", `${url}?base64=1&token=${encodeURIComponent(ASSET_TOKEN)}`, false);
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
      clipboardData.getData = (type: string): string => {
        const value = originalGetData(type);
        if (type === "text/html" && value) {
          const upgraded = upgradePastedHtml(value);
          return upgraded || value;
        }
        return value;
      };
    },
    true
  );
}
