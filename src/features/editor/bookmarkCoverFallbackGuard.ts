/**
 * 书签卡封面「未变才写」守卫（261119 文档卡片闪烁修复）。
 *
 * 真身：内核 bookmark/bookmarklink 卡的封面 `<img class="ne-card-bookmark-cover-img">`
 * onError 兜底**无条件**把 src 重写为内核兜底图（lakex.js `_getCoverElement`：
 * `coverRef.current.src = 'https://gw.alipayobjects.com/…A*MfA2QIGNXcE…'`，构建期被
 * lakexLocalize 本地化为 `/vendor/lakex/alipay/A_MfA2…`）。封面 URL 失败（CSP/断网/防盗链）
 * 且兜底图也拉不到时：error → 同值重写 src → 浏览器**重新拉取**（实测 `img.src = img.src`
 * 会重新走一次加载）→ 再 error → 再同值重写……形成网络往返节奏（实测 ~0.4–0.8s/圈、
 * 无上限）的加载/破图闪烁环 —— 用户看到的「文档里卡片每隔不到一秒闪一下」（261119 录屏）。
 *
 * 修法 = AGENTS I2「未变才写」：给封面 img 挂**元素级 src 访问器**，赋值与现值
 * （attribute 原文）相同时直接跳过，不触发浏览器重拉。内核 onError 语义不变：
 * 首次失败 → 兜底照常写入（值不同）；兜底再失败 → 同值写被吞，环终止，封面稳定停在
 * 破图/兜底态。合法变化（真实换图、恢复加载）仍正常写。
 *
 * 挂载点 = createLakeDocument 的 mount（桌面 EditorTab / 移动 LakeEditor / 预览共用），
 * dispose 随编辑器销毁。只读探查不改内核产物（LOCAL-CHANGES §二.1 应用层优先）。
 */

export const BOOKMARK_COVER_SELECTOR = 'img.ne-card-bookmark-cover-img, img.h5-ne-card-bookmark-cover-img';

interface SrcGuardedImage extends HTMLImageElement {
  __lakeCoverSrcGuarded?: boolean;
}

/**
 * 给单个封面 img 装「同值不写」的 src 访问器（幂等）。只包一层属性访问器，
 * 不拦截事件、不改传播路径，内核 onError 仍按原语义执行。
 */
export function guardBookmarkCoverWriteOnce(img: HTMLImageElement): void {
  const el = img as SrcGuardedImage;
  if (el.__lakeCoverSrcGuarded) return;
  el.__lakeCoverSrcGuarded = true;
  const desc = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, "src");
  if (!desc?.get || !desc.set) return;
  const protoGet = desc.get;
  const protoSet = desc.set;
  Object.defineProperty(el, "src", {
    configurable: true,
    get(this: HTMLImageElement) {
      return protoGet.call(this);
    },
    set(this: HTMLImageElement, value: string) {
      const next = String(value);
      // 未变才写：目标值与现值（attribute 原文，含兜底 URL 本地化/原始两种形态）一致 → 跳过。
      if (next === this.getAttribute("src")) return;
      protoSet.call(this, next);
    },
  });
}

/**
 * 在 host 上以捕获阶段监听 img error，为书签卡封面装防环守卫；返回 dispose。
 * error 事件不冒泡但走捕获，挂在 mount 上即可覆盖内核渲染的所有封面 img。
 */
export function installBookmarkCoverFallbackGuard(host: HTMLElement): () => void {
  const onError = (event: Event): void => {
    const target = event.target as Element | null;
    if (!target || target.tagName !== "IMG") return;
    if (!target.matches(BOOKMARK_COVER_SELECTOR)) return;
    guardBookmarkCoverWriteOnce(target as HTMLImageElement);
  };
  host.addEventListener("error", onError, true);
  return () => {
    host.removeEventListener("error", onError, true);
  };
}
