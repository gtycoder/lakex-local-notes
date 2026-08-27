/**
 * 移动端图片卡片 blob 注入（setCardValue 命令版，D8 收尾）。
 *
 * 背景：Lake 编辑器创建图片卡片时强制 original.type=binary → status=pending → 清空 src
 * （无视内容层注入的 src/status）。唯一外部通道是官方命令 setCardValue
 * （dist lakex-editor-react-component.es.js L59905-59909：
 *   renderer.execCommand("setCardValue", isUser, nodeId, value) → setAttribute(value) → commitJob）。
 *
 * 本模块在卡片渲染后（DOM 存在）对每个 image 卡片调用该命令，注入 src=blob + status=done +
 * originalType=link，让卡片走非 binary 路径直接渲染 blob。
 * - 显示层：不动 .lake 存储（getDocument 输出 blob，由 restore() 还原为 canonical）。
 * - 保存还原：restore(content) 把 blob URL 换回 canonical http URL（blob→canonical 映射）。
 */
import type { LakeEditorInstance } from "../features/editor/lakeRuntime";
import { lakeBridge } from "../features/editor/lakeRuntime";
import { parseLocalAssetUrl } from "../core/assetUrl.js";
import { scanFileCards } from "../core/fileCard.js";
import { bridge } from "./bridge";
import { registerRuntimeBlob, unregisterRuntimeBlob } from "./cachePort.js";

/**
 * 跨文档进入/模式切换复用的 blob 缓存（图片破裂优化）：
 * canonical src → blob URL + 引用计数。同一张图在文档重开/模式切换间复用同一 blob URL，
 * 注入时可立即命中；引用归零才 revoke（受 cachePort 注册表与"清缓存"统一管理）。
 */
const blobCache = new Map<string, { url: string; refs: number }>();

/** 全局 blob → canonical 映射（跨注入器实例共享）：点击附件/保存还原都要能由 blob src 反查原始 URL。 */
const globalBlobToCanonical = new Map<string, string>();

/** 由 blob URL 反查原始 canonical URL（cardBlobInject 注入后 src 是 blob，打开附件需要原始引用）。 */
export function canonicalForBlob(blobUrl: string): string | null {
  return globalBlobToCanonical.get(blobUrl) ?? null;
}

function cachedBlobUrl(canonicalSrc: string, bytes: Uint8Array): string | null {
  const hit = blobCache.get(canonicalSrc);
  if (hit) {
    hit.refs += 1;
    return hit.url;
  }
  const url = URL.createObjectURL(new Blob([bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer]));
  blobCache.set(canonicalSrc, { url, refs: 1 });
  registerRuntimeBlob(url);
  return url;
}

function releaseBlobUrl(canonicalSrc: string, url: string): void {
  const hit = blobCache.get(canonicalSrc);
  if (!hit) return;
  hit.refs -= 1;
  if (hit.refs <= 0) {
    blobCache.delete(canonicalSrc);
    URL.revokeObjectURL(url);
    unregisterRuntimeBlob(url);
  }
}

/** card 元素 value="data:{uri-encoded-json}"（含完整 src） */
const CARD_VALUE_RE = /<card\b[^>]*\bname="image"[^>]*\bvalue="data:([^"]+)"[^>]*>/g;

export interface CardBlobInjectResult {
  /** 对当前 editor 所有 image 卡片执行 setCardValue 注入 blob。返回注入的卡片数。 */
  inject(editor: LakeEditorInstance): number;
  /** 编辑器重建后调用：清空幂等集（injectedIds 按 canonicalSrc 去重仅限同一编辑器实例内，
   * 跨重建（viewer↔editor 切换）必须重置，否则重建后的新卡片 DOM 会被幂等挡住永不注入）。 */
  reset(): void;
  /** 把内容（getDocument 输出）里的 blob URL 还原为 canonical http。 */
  restore(content: string): string;
  /** 释放所有 blob URL。 */
  revoke(): void;
}

/**
 * 从文档内容扫描所有 image 卡片的 canonical src（供注入前建立 blob）。
 * 返回 [{ cardId, canonicalSrc, blobUrl }]——cardId 是 value.id，用于匹配 DOM 节点。
 */
function scanImageCards(content: string): Array<{ cardId: string; canonicalSrc: string; blobUrl: string | null }> {
  const out: Array<{ cardId: string; canonicalSrc: string; blobUrl: string | null }> = [];
  for (const m of content.matchAll(CARD_VALUE_RE)) {
    try {
      const obj = JSON.parse(decodeURIComponent(m[1]).replace(/^data:/, ""));
      if (typeof obj.src !== "string") continue;
      const ref = parseLocalAssetUrl(obj.src);
      if (!ref) continue;
      const bytes = bridge.getAssetBytes(ref.noteId, ref.filename);
      out.push({
        cardId: typeof obj.id === "string" ? obj.id : "",
        canonicalSrc: obj.src,
        blobUrl: bytes ? cachedBlobUrl(obj.src, bytes) : null,
      });
    } catch { /* 跳过无法解析的卡片 */ }
  }
  return out;
}

/**
 * 从文档内容扫描所有 file（附件）卡片的 canonical src。
 * 移动端 file 卡片 src 是桌面 canonical URL（127.0.0.1:19876 不可达），
 * Lake 渲染成 ne-error-tips「文件上传失败」——需要像 image 卡片一样注入本地 blob。
 */
function scanFileCardsForInject(content: string): Array<{ cardId: string; canonicalSrc: string; blobUrl: string | null; value: Record<string, unknown> }> {
  const out: Array<{ cardId: string; canonicalSrc: string; blobUrl: string | null; value: Record<string, unknown> }> = [];
  for (const card of scanFileCards(content)) {
    if (!card.ref) continue;
    const bytes = bridge.getAssetBytes(card.ref.noteId, card.ref.filename);
    out.push({
      cardId: card.cardId,
      canonicalSrc: card.value.src,
      blobUrl: bytes ? cachedBlobUrl(card.value.src, bytes) : null,
      value: { ...card.value },
    });
  }
  return out;
}

/** ne-card 元素内部的卡片实例访问器（实例在 _virtualNode._instance，部分形态在 _instance）。 */
function cardInstanceOf(el: Element): unknown {
  try {
    const ref = (el as unknown as { _neRef?: { _virtualNode?: { _instance?: unknown }; _instance?: unknown } })._neRef;
    return ref?._virtualNode?._instance ?? ref?._instance ?? null;
  } catch { return null; }
}

/** 从卡片实例取 cardData（编辑器/查看器字段名 _cardData 或 cardData）。 */
function cardDataOf(inst: unknown): { getCardValue?: () => Record<string, unknown>; _cardValue?: Record<string, unknown>; _resetCardValue?: (v: Record<string, unknown>) => void; sync?: (isUser: boolean) => unknown; _cardUI?: { setDisplayUrl?: (u: string | null) => void } } | null {
  if (!inst || typeof inst !== "object") return null;
  const cd = (inst as { cardData?: unknown; _cardData?: unknown })._cardData
    ?? (inst as { cardData?: unknown }).cardData
    ?? null;
  return cd && typeof cd === "object" ? (cd as ReturnType<typeof cardDataOf>) : null;
}

/**
 * 读取卡片元素当前 value 的 src（cardData 活值优先，value 属性解码兜底）。
 * 注入幂等判定用：src 已是 blob = 已注入；仍是 canonical = 需要（重新）注入。
 * （Lake 上传完成会重写卡片 value 把 src 写回 canonical——不能按 canonicalSrc 永久去重，
 * 否则重写后的卡片被幂等挡住永不注入，表现为"上传后图片空白"。）
 */
function currentCardSrc(el: Element): string | null {
  try {
    const cd = cardDataOf(cardInstanceOf(el));
    const v = cd && typeof cd.getCardValue === "function" ? cd.getCardValue() : (cd?._cardValue ?? null);
    if (v && typeof v.src === "string") return v.src;
  } catch { /* 忽略 */ }
  try {
    const raw = el.getAttribute("value") ?? "";
    if (raw.startsWith("data:")) {
      const obj = JSON.parse(decodeURIComponent(raw.slice("data:".length))) as { src?: unknown };
      if (typeof obj.src === "string") return obj.src;
    }
  } catch { /* 忽略 */ }
  return null;
}

/**
 * 把图片卡片的显示强制切到 blob（Lake 上传完成后的显示层修复）。
 *
 * 背景（实测定位）：图片 <img> 的 src 来自图片 React 组件 state.imageDisplayUrl，它只在
 * 组件挂载时由 generateDisplayUrl()（= 控制器 getDisplayUrl() = _displayUrl || cardData.getSrc()）
 * 派生一次。上传完成后组件的 imageDisplayUrl 与控制器 _displayUrl 都缓存了 canonical URL
 * （127.0.0.1:19876 不可达 → 编辑态空白）；setCardValue 只改 cardData 值，不会刷新这两个缓存。
 *
 * 修复：清控制器 _displayUrl（防下次重挂载又回 canonical）+ 沿 React fiber 找到图片组件
 * setState({ imageDisplayUrl: blob })，让 <img> 立即渲染 blob。
 */
function forceImageDisplay(el: Element, blobUrl: string): void {
  try {
    // 先清控制器 _displayUrl 缓存（即使 img 尚未渲染：卡片后续重挂载时
    // componentDidMount 的 generateDisplayUrl() 会回落到 cardData.getSrc() = blob）
    try {
      const inst = cardInstanceOf(el) as { _cardUI?: { setDisplayUrl?: (u: string | null) => void } } | null;
      inst?._cardUI?.setDisplayUrl?.(null);
    } catch { /* 忽略 */ }
    const img = el.querySelector("img");
    if (!img) return;
    const fiberKey = Object.keys(img).find((k) => k.startsWith("__reactFiber"));
    if (!fiberKey) return;
    let cur: unknown = (img as unknown as Record<string, unknown>)[fiberKey];
    for (let hops = 0; hops < 40 && cur; hops++) {
      const sn = (cur as { stateNode?: unknown }).stateNode as { state?: Record<string, unknown>; setState?: (p: Record<string, unknown>) => void } | null;
      if (sn && sn.state && typeof sn.state === "object" && "imageDisplayUrl" in sn.state && typeof sn.setState === "function") {
        sn.setState({ imageDisplayUrl: blobUrl });
        return;
      }
      cur = (cur as { return?: unknown }).return;
    }
  } catch { /* 单卡片显示修复失败不阻断 */ }
}

/**
 * 为移动端 editor 建立 blob 注入器：inject() 用 setCardValue 命令把卡片 src 换成 blob，
 * restore() 把 getDocument 输出里的 blob 还原为 canonical（保存前调用）。
 */
export function createCardBlobInjector(content: string): CardBlobInjectResult {
  const cards = scanImageCards(content);
  const fileCards = scanFileCardsForInject(content);
  const blobToCanonical = new Map<string, string>();
  const registerBlob = (c: { blobUrl: string | null; canonicalSrc: string }): void => {
    if (c.blobUrl) {
      blobToCanonical.set(c.blobUrl, c.canonicalSrc);
      globalBlobToCanonical.set(c.blobUrl, c.canonicalSrc);
    }
  };
  for (const c of [...cards, ...fileCards]) registerBlob(c);
  const blobUrls = [...cards, ...fileCards].map((c) => c.blobUrl).filter((u): u is string => u !== null);
  return {
    inject(editor) {
      let injected = 0;
      // 动态扫描：上传/粘贴新增的图片/附件不在初始 content 里（编辑中插入）——每次 inject 从编辑器
      // 当前内容补扫新卡片。注入幂等不依赖 getDocument（见下方 live-src 判定），这里仅负责：
      // 1) 把新卡片的 blob → canonical 注册进 restore 映射（保存还原必需）；
      // 2) 让新卡片进入注入候选列表。
      try {
        if (typeof editor?.getDocument === "function") {
          const live = editor.getDocument("text/lake");
          if (typeof live === "string") {
            for (const lc of scanImageCards(live)) {
              if (!cards.some((k) => k.canonicalSrc === lc.canonicalSrc)) {
                registerBlob(lc);
                cards.push(lc);
                blobUrls.push(lc.blobUrl ?? "");
              }
            }
            // 附件卡片同样动态补扫：新上传的附件 src=canonical 不可达 → Lake 渲染错误态，需注入 blob
            for (const fc of scanFileCardsForInject(live)) {
              if (!fileCards.some((k) => k.canonicalSrc === fc.canonicalSrc)) {
                registerBlob(fc);
                fileCards.push(fc);
              }
            }
          }
        }
      } catch { /* 动态扫描失败不影响初始注入 */ }
      // 从 DOM 拿 image + file 卡片节点（NE-CARD）
      const cardEls = Array.from(document.querySelectorAll(
        "NE-CARD[data-card-name=\"image\"], ne-card[name=\"image\"], NE-CARD[data-card-name=\"file\"], ne-card[name=\"file\"]",
      ));
      // renderer（编辑态 fallback 用 execCommand）
      const renderer = lakeBridge(editor).renderer;
      const canExec = !!renderer && typeof renderer.execCommand === "function";
      const execCmd = canExec && renderer?.execCommand
        ? (name: string, ...args: unknown[]) => renderer.execCommand!(name, ...args)
        : null;
      // 先注入 image 卡片（原逻辑），再注入 file 卡片（附件 src 换 blob，消除"文件上传失败"错误态）
      const allCards = [...cards, ...fileCards];
      for (const c of allCards) {
        if (!c.blobUrl) continue;
        const byCardId = cardEls.find((el) => el.getAttribute("id") === c.cardId);
        const el = byCardId || cardEls[allCards.indexOf(c)];
        if (!el) continue;
        const isFile = "value" in c; // file 卡片保留原 value（name/size/mode 等）
        const nodeId = el.getAttribute("id") || "";
        // live-src 判定（取代按 canonicalSrc 永久去重）：Lake 上传完成会重写卡片 value 把 src
        // 写回 canonical——按 canonical 去重会把重写后的卡片挡住永不注入（上传后空白的根因）。
        const liveSrc = currentCardSrc(el);
        const imgSrc = (el.querySelector("img")?.getAttribute("src") ?? "").split("?")[0];
        const valueIsBlob = !!liveSrc && liveSrc.startsWith("blob:");
        // 显示层已是 blob → 无需处理（直读 img src，绕开 imageDisplayUrl state 缓存）
        if (imgSrc.startsWith("blob:")) continue;
        const blobSrc = valueIsBlob ? liveSrc! : c.blobUrl!;
        let handled = false;
        try {
          if (!valueIsBlob) {
            // 路径 1：卡片实例有 cardData（viewer/部分编辑态）→ _resetCardValue + sync(false)
            const cd = cardDataOf(cardInstanceOf(el));
            if (cd && typeof cd._resetCardValue === "function" && typeof cd.sync === "function") {
              // file 卡片用扫描保留的原始 value（错误态时 Lake 会清空 _cardValue 的 name，
              // 依赖 old 会让名称/大小丢失）；image 卡片沿用 old（含宽高裁剪等运行时字段）
              const old = isFile
                ? (c as { value: Record<string, unknown> }).value
                : (typeof cd.getCardValue === "function" ? cd.getCardValue() : cd._cardValue) ?? {};
              const newValue = {
                ...old,
                src: c.blobUrl,
                status: "done",
                // file 卡片无 originalType 概念，注入 link 标记无害（image 卡片必需，防 binary 上传态）
                ...(isFile ? {} : { originalType: "link" }),
              };
              delete (newValue as Record<string, unknown>).taskId;
              delete (newValue as Record<string, unknown>).clientId;
              cd._resetCardValue(newValue);
              cd.sync(false); // 必须传 boolean（set-card-value-command.ts:17 断言）
              handled = true;
            } else if (execCmd && nodeId) {
              // 路径 2：编辑态卡片无 cardData → execCommand("setCardValue")（官方命令通道）
              const newValue = isFile
                ? { ...(c as { value: Record<string, unknown> }).value, src: c.blobUrl, status: "done" }
                : {
                    src: c.blobUrl,
                    originalType: "link",
                    status: "done",
                    name: c.canonicalSrc.split("/").pop() ?? "image",
                    size: 0,
                    width: undefined,
                    height: undefined,
                    from: "ui",
                    id: nodeId,
                  };
              if (isFile) {
                delete (newValue as Record<string, unknown>).taskId;
                delete (newValue as Record<string, unknown>).clientId;
              }
              execCmd("setCardValue", true, nodeId, newValue);
              handled = true;
            }
          } else {
            handled = true; // value 已是 blob（注入过/上传重写）——只需显示同步
          }
          if (handled) {
            // 图片卡片显示同步：setCardValue 只改 cardData 值，上传成功缓存的
            // imageDisplayUrl/_displayUrl（canonical）不会跟随 → 强制切到 blob，否则编辑态空白。
            if (!isFile) forceImageDisplay(el, blobSrc);
            injected++;
          }
        } catch { /* 单卡片失败不阻断 */ }
      }
      if (injected > 0) console.log("[card-inject] 注入", injected, "张卡片（image", cards.length, "+ file", fileCards.length, "）");
      return injected;
    },
    reset() {
      // 注入判定基于元素当前 src（blob 与否），天然幂等——重建后无需清理状态。
    },
    restore(content) {
      let out = content;
      for (const [blobUrl, canonical] of blobToCanonical) {
        // Lake 会给 img src 的 blob URL 追加 ?date= 缓存破坏参数；split(blobUrl) 匹配不到带参形态，
        // 导致保存时 blob 无法还原为 canonical → 污染存储。用 uuid 前缀正则，容忍任意参数后缀。
        // 形态 2：card value 里 blob URL 是 URI 编码（blob%3Ahttps%3A%2F%2Flocalhost%2Fuuid）——
        // 明文正则匹配不到 → 还原失败、blob 污染存储（改动文字保存后图片裂的根因）。
        // 两种形态都还原；编码形态替换为编码 canonical（保持 value 的 URI 编码一致性）。
        const uuid = (blobUrl.split("/").pop() ?? "").split("?")[0];
        if (!uuid) continue;
        const re = new RegExp("(?:blob:|blob%3A)[^\\s\"'<>]*?" + uuid + "(?:\\?[^\\s\"'<>]*)?", "g");
        const encodedCanonical = encodeURIComponent(canonical);
        out = out.replace(re, (m) => (m.startsWith("blob%3A") ? encodedCanonical : canonical));
      }
      return out;
    },
    revoke() {
      // 释放缓存引用（引用归零才真正 revoke + 注销注册表；跨进入复用的 blob 保留）
      for (const c of cards) {
        if (c.blobUrl) releaseBlobUrl(c.canonicalSrc, c.blobUrl);
      }
    },
  };
}
