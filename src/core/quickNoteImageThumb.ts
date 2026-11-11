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
  // 只认「属性名从空白/标签起点开始」：`\b` 会把 `data-name=` 也当成 `name=`（内核卡另有 data-* 属性）。
  const m = tag.match(new RegExp(String.raw`(?:^|\s)${name}="([^"]*)"`, "i"));
  return m ? m[1] : null;
}

/** 本地资产 filename（显示 URL 的 allowlist 键；兼容带 token/w= 的显示 URL）。 */
export function imageThumbKey(src: string): string | null {
  return parseLocalAssetUrl(src)?.filename ?? null;
}

/**
 * 【task-26】显示缩略档位（px）唯一来源：移动端小记写作卡 + 移动端文档编辑器共用。
 * 档位必须落在资产服务支持的集合里（128/256/512/1024），改这里前先看 assetUrl.ts 的档位表。
 */
export const MOBILE_IMAGE_THUMB_WIDTH = 1024;

interface ImageCardValue {
  /** 序列化里的 src：**上传中的卡是空串**（内核 toLake 写 `src: ""`）。 */
  src: string;
  originWidth?: number;
  originHeight?: number;
}

function hasPositiveOrigin(value: ImageCardValue): boolean {
  return typeof value.originWidth === "number" && typeof value.originHeight === "number"
    && value.originWidth > 0 && value.originHeight > 0;
}

/** 正文里所有 image 卡的语义值（坏卡片跳过：宁可不缩，不抛）。 */
function imageCardValues(body: string): ImageCardValue[] {
  const out: ImageCardValue[] = [];
  if (!body) return out;
  for (const tag of body.match(CARD_TAG_RE) ?? []) {
    if (cardAttr(tag, "name") !== "image") continue;
    const raw = cardAttr(tag, "value");
    if (!raw || !raw.startsWith(CARD_VALUE_PREFIX)) continue;
    try {
      const parsed = JSON.parse(decodeURIComponent(raw.slice(CARD_VALUE_PREFIX.length))) as {
        src?: unknown;
        originWidth?: unknown;
        originHeight?: unknown;
      };
      out.push({
        src: typeof parsed.src === "string" ? parsed.src : "",
        originWidth: typeof parsed.originWidth === "number" ? parsed.originWidth : undefined,
        originHeight: typeof parsed.originHeight === "number" ? parsed.originHeight : undefined,
      });
    } catch { /* 坏卡片跳过：宁可不缩 */ }
  }
  return out;
}

/** 正文里**已带正数 original 尺寸**的 image 卡 → 本地资产文件名集合（用于显示缩略 allowlist）。 */
export function imageThumbAllowFiles(body: string): Set<string> {
  const out = new Set<string>();
  for (const value of imageCardValues(body)) {
    if (!value.src || !hasPositiveOrigin(value)) continue;
    const file = imageThumbKey(value.src);
    if (file) out.add(file);
  }
  return out;
}

/**
 * 【task-26 / 边界 A】把正文里「已带正数 origin」的资产并进**活** allowlist（增量、幂等）。
 *
 * 新插入图片的 origin 由内核在上传/加载阶段写入模型，时机在我们之外；因此不能凭"上传过"就加缩略，
 * 只能等正文里真的出现正数 origin 后再放行（否则内核会把 1024 当原尺寸补写，见 LAKEX-CONTRACT §5.51）。
 * 返回新增条数（0 = 正文里还没有它的 origin，调用方应稍后再试或放弃）。
 */
export function imageThumbLearnFromBody(body: string, allow: Set<string>): number {
  if (!body) return 0;
  let added = 0;
  for (const file of imageThumbAllowFiles(body)) {
    if (!allow.has(file)) { allow.add(file); added += 1; }
  }
  return added;
}

/**
 * 【task-26 / 边界 A·即时确认】正文里「上传中（src 空）且已有正数 origin」的 image 卡尺寸。
 *
 * 实测（261111，5554）：文件选择 / 粘贴在上传 promise resolve 之前，内核已把**真实 origin**
 * （来自上传前对 File 的解码，不是显示图 naturalWidth）写进模型，此时 src 还是空串。
 * ⇒ 上传 resolve 时若正文里**恰好只有一张**这样的卡，可以安全地把本条资产加进 allowlist
 * （这正是它自己的待上传卡）；多张并发时无法区分，调用方应回退到「等 src 回填后按 origin 放行」。
 */
export function imageThumbPendingOrigins(body: string): Array<{ width: number; height: number }> {
  const out: Array<{ width: number; height: number }> = [];
  for (const value of imageCardValues(body)) {
    if (value.src || !hasPositiveOrigin(value)) continue;
    out.push({ width: value.originWidth as number, height: value.originHeight as number });
  }
  return out;
}

/**
 * 【task-26 / 边界 A·身份校验】正文里**上传中（src 空）**的 image 卡总数（不管有没有 origin）。
 *
 * 即时放行必须证明「那张待上传卡就是我这张」：只有**全篇恰好一张**待上传卡时才可能成立
 * （我们自己的上传在飞时它必然在列表里）；≥2 张说明有并发上传，无法分辨 ⇒ 不许放行。
 */
export function imageThumbPendingCount(body: string): number {
  let count = 0;
  for (const value of imageCardValues(body)) {
    if (!value.src) count += 1;
  }
  return count;
}

/** 正文里是否已有该本地资产（按 filename 比，容忍 token/显示参数差异）。 */
export function imageThumbBodyHasFile(body: string, file: string): boolean {
  if (!body || !file) return false;
  return imageCardValues(body).some((value) => value.src !== "" && imageThumbKey(value.src) === file);
}
