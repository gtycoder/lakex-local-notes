import { sniffImageFormat } from "./imageFormat";

const BLOCK_TAGS = new Set(["P", "H1", "H2", "H3", "H4", "H5", "H6", "UL", "OL", "LI", "BLOCKQUOTE", "PRE", "TABLE", "THEAD", "TBODY", "TR", "TH", "TD"]);
const INLINE_TAGS = new Set(["SPAN", "STRONG", "B", "EM", "I", "U", "S", "DEL", "CODE", "A", "BR"]);
const HIDDEN_SELECTORS = ".ne-card-toolbar, .ne-card-resizer, ne-l-ph, ne-r-ph, [contenteditable='false'][aria-hidden='true']";

export function normalizeClipboardHtml(fragment: DocumentFragment, document: Document): string {
  const output = document.createElement("div");
  for (const child of Array.from(fragment.childNodes)) {
    const normalized = normalizeNode(child, document);
    if (normalized) output.append(normalized);
  }
  return output.innerHTML;
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
  const source = normalizeImageDataUrl(image.getAttribute("src") ?? "");
  if (!source || (!source.startsWith("data:image/") && !/^https?:\/\//i.test(source))) return null;
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
