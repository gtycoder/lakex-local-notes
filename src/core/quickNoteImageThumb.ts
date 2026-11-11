import { parseLocalAssetUrl } from "./assetUrl.js";

/**
 * 【task-26】小记写作卡图片缩略的 allowlist（内核图片渲染钩子专用）。
 *
 * 背景：内核图片卡在缺 `original.width/height` 时会用**当前显示图**的 naturalWidth/Height
 * 补写原尺寸并 `sync(true)`（见 docs/LAKEX-CONTRACT.md §5.51）。若显示图是 `?w=1024` 缩略图，
 * 这个缩略尺寸就会被当成原尺寸写回模型、保存后落盘。
 * ⇒ 只给**卡片已带正数 original 尺寸**的图加缩略；缺 origin 的历史卡一律走原图（fail-safe）。
 *
 * 本模块只做纯解析（core 层禁 DOM）：正文 `<card name="image" value="data:...">` →
 * 本地资产 **filename** 集合；坏 JSON / 非 image 卡 / 非本地资产一律跳过。
 */

const CARD_TAG_RE = /<card\b[^>]*>/gi;
/** 卡片值编码前缀：内核既有形态 = `data:` + encodeURIComponent(JSON)。 */
const CARD_VALUE_PREFIX = "data:";

function cardAttr(tag: string, name: string): string | null {
  const m = tag.match(new RegExp(String.raw`\b${name}="([^"]*)"`, "i"));
  return m ? m[1] : null;
}

/** 本地资产 filename（显示 URL 的 allowlist 键；兼容带 token/w= 的显示 URL）。 */
export function imageThumbKey(src: string): string | null {
  return parseLocalAssetUrl(src)?.filename ?? null;
}

/** 正文里**已带正数 original 尺寸**的 image 卡 → 本地资产文件名集合（用于显示缩略 allowlist）。 */
export function imageThumbAllowFiles(body: string): Set<string> {
  const out = new Set<string>();
  if (!body) return out;
  for (const tag of body.match(CARD_TAG_RE) ?? []) {
    if (cardAttr(tag, "name") !== "image") continue;
    const raw = cardAttr(tag, "value");
    if (!raw || !raw.startsWith(CARD_VALUE_PREFIX)) continue;
    try {
      const value = JSON.parse(decodeURIComponent(raw.slice(CARD_VALUE_PREFIX.length))) as {
        src?: unknown;
        originWidth?: unknown;
        originHeight?: unknown;
      };
      if (typeof value.src !== "string") continue;
      if (typeof value.originWidth !== "number" || typeof value.originHeight !== "number") continue;
      if (!(value.originWidth > 0) || !(value.originHeight > 0)) continue;
      const file = imageThumbKey(value.src);
      if (file) out.add(file);
    } catch { /* 坏卡片跳过：宁可不缩 */ }
  }
  return out;
}
