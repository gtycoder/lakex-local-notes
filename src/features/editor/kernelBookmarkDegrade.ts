/**
 * 书签卡降级（语雀 bookmark 卡 → 普通超链接）+ 销毁后热键表兜底。
 *
 * 261112 R2-S9：从 lakeRuntime.ts **原样搬出**（纯搬移：导出名/行为零变化）。
 * 公共符号仍由 ./lakeRuntime 门面 re-export；内核 lazy 边界不变（只被 lakeRuntime 静态 import）。
 */

/** 需要降级为超链接的 bookmark 卡名（Lake INode 的 card name；块卡落盘后为 bookmarklink）。 */
const BOOKMARK_CARD_NAMES = ["bookmarkInline", "bookmark", "bookmarklink"] as const;
/** 卡→链接转换用到的 Lake 命令名。 */
const CARD_TO_LINK_COMMAND = "cardToLink";
/** 粘贴后等待 Lake 渲染卡的首个延时（ms）。 */
const BOOKMARK_DEGRADE_FIRST_DELAY = 150;
/** 若卡尚未渲染/未拿到 src，后续重试的延时步进（ms）。 */
const BOOKMARK_DEGRADE_RETRY_DELAY = 350;
/** 单次粘贴后最多重试次数，兼顾 Lake 异步渲染慢（大文档/移动端）的场景。 */
const BOOKMARK_DEGRADE_MAX_RETRY = 3;

/** Lake 内核压缩 bundle 未公开 bookmark 卡数据接口，沿用项目现有私有路径访问。 */
interface LakeBookmarkCardData {
  getSrc?: () => string;
  getDetail?: () => { title?: unknown } & Record<string, unknown>;
  getCardValue?: () => { text?: string };
}


/** 从渲染后的 bookmark 卡 DOM 节点读取转换所需的（卡 id / 链接 / 标题）。 */
function readBookmarkCardInfo(
  card: Element,
): { id: string; src: string; title: string } | null {
  const id = card.getAttribute("id");
  if (!id) return null;
  const anyCard = card as unknown as {
    _neRef?: {
      _virtualNode?: { _instance?: { cardData?: unknown; _cardData?: unknown } };
      _instance?: { cardData?: unknown; _cardData?: unknown };
    };
  };
  const inst = anyCard._neRef?._virtualNode?._instance ?? anyCard._neRef?._instance;
  const data = (inst?.cardData ?? inst?._cardData) as LakeBookmarkCardData | undefined;
  const src = data?.getSrc?.() ?? "";
  if (!src) return { id, src: "", title: "" };
  const detail = data?.getDetail?.() ?? {};
  const title = (detail.title as string) || data?.getCardValue?.()?.text || src;
  return { id, src, title };
}


/**
 * 内核兼容补丁：**实例销毁后，工具条的 tooltip 仍会查一次热键表**。
 *
 * 内核 hotkey 插件的 `destroy()` 会 `delete this._named`（bundle 实测），但工具条每个按钮渲染时都会走
 * `getTooltip → renderer.getHotKeyByName(name) → this._named[name]` ⇒ 销毁之后再渲染一次就
 * `TypeError: Cannot read properties of undefined (reading 'undo'/'slash'/…)`，
 * 而这是 **React 渲染期抛错**：整棵工具条（进而整个小记面板）崩掉、不断重试 ⇒ 用户看到"反复闪烁、
 * 保存/取消都点不动"（260920 实测：列表视图里保存/取消/换条目连续操作，12 秒内 20+ 条同类错误）。
 *
 * 我们的编辑器生命周期里"销毁旧实例"是常态（小记切草稿、换条目、保存后重建），所以这里给
 * `renderer.getHotKeyByName` 包一层：**拿不到就返回 null**（工具条少一个快捷键提示），
 * 不再让一次迟到渲染炸掉整棵 UI。对健康实例是完全透明的（正常路径直接透传返回值）。
 */
export function hardenDestroyedHotKeyLookup(editor: unknown): void {
  try {
    const renderer = (editor as { renderer?: Record<string, unknown> } | null | undefined)?.renderer;
    const original = renderer?.getHotKeyByName;
    if (!renderer || typeof original !== "function") return;
    renderer.getHotKeyByName = function hardened(this: unknown, name: unknown) {
      try { return (original as (this: unknown, value: unknown) => unknown).call(this, name) ?? null; }
      catch { return null; }
    };
  } catch { /* 拿不到 renderer 就跳过：补丁只是兜底，不改变正常路径 */ }
}


/** 监听编辑器挂载容器的粘贴事件，把新出现的 bookmark 卡降级为普通超链接。 */
export function installBookmarkCardDegrade(
  scope: HTMLElement,
  editor: unknown,
): () => void {
  const selectors = BOOKMARK_CARD_NAMES.map((name) => `ne-card[data-card-name="${name}"]`).join(", ");
  const converted = new Set<string>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let retriesLeft = 0;

  const degradeOnce = () => {
    timer = null;
    const failed: Element[] = [];
    for (const card of Array.from(scope.querySelectorAll(selectors))) {
      const info = readBookmarkCardInfo(card);
      if (!info) continue;
      // 已成功的卡跳过；src 尚未就绪/转换失败则进入下一轮重试
      if (converted.has(info.id)) continue;
      if (!info.src) { failed.push(card); continue; }
      try {
        (editor as { execCommand?: (...args: unknown[]) => void }).execCommand?.(
          CARD_TO_LINK_COMMAND, info.id, info.src, info.title,
        );
        converted.add(info.id);
      } catch {
        failed.push(card);
      }
    }
    if (failed.length > 0 && retriesLeft > 0) {
      retriesLeft -= 1;
      timer = setTimeout(degradeOnce, BOOKMARK_DEGRADE_RETRY_DELAY * (BOOKMARK_DEGRADE_MAX_RETRY - retriesLeft));
    }
  };

  const schedule = () => {
    retriesLeft = BOOKMARK_DEGRADE_MAX_RETRY;
    if (timer != null) return;
    timer = setTimeout(degradeOnce, BOOKMARK_DEGRADE_FIRST_DELAY);
  };
  // Lake 粘贴会经 document 捕获阶段，事件仍会冒泡到挂载容器。
  scope.addEventListener("paste", schedule, true);
  return () => {
    if (timer != null) { clearTimeout(timer); timer = null; }
    scope.removeEventListener("paste", schedule, true);
  };
}

