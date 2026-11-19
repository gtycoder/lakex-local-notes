/**
 * 书签卡封面加载失败守卫（261119 文档卡片闪烁修复 + 261119 用户裁决「两级皆败静默隐藏」）。
 *
 * 真身：内核 bookmark/bookmarklink 卡的封面 `<img class="ne-card-bookmark-cover-img">`
 * onError 兜底**无条件**把 src 重写为内核兜底图（lakex.js `_getCoverElement`：
 * `coverRef.current.src = 'https://gw.alipayobjects.com/…A*MfA2QIGNXcE…'`，构建期被
 * lakexLocalize 本地化为 `/vendor/lakex/alipay/A_MfA2…`）。封面 URL 失败（CSP/断网/防盗链）
 * 且兜底图也拉不到时：error → 同值重写 src → 浏览器**重新拉取**（实测 `img.src = img.src`
 * 会重新走一次加载）→ 再 error → 再同值重写……形成网络往返节奏（实测 ~0.4–0.8s/圈、
 * 无上限）的加载/破图闪烁环 —— 用户看到的「文档里卡片每隔不到一秒闪一下」（261119 录屏）。
 *
 * 两层修法：
 * ① AGENTS I2「未变才写」：给封面 img 挂**元素级 src 访问器**，赋值与现值（attribute 原文）
 *    相同时直接跳过，不触发浏览器重拉。内核 onError 语义不变：首次失败照常写兜底（值不同）；
 *    兜底再失败时同值写被吞、环终止。合法变化（真实换图、恢复加载）仍正常写。
 * ② 261119 用户裁决「两级皆败 ⇒ 静默隐藏缩略框」（不再停在破图/兜底图，卡片只留标题/来源行）：
 *    每次 error 分发结束后裁决内核 onError 有没有把「下一级」写上路 —— 分发内出现**异值** src
 *    写入 = 兜底正在接力（单级失败，兜底图照常显示）；同值写被吞/根本没写 = **无下一级** ⇒
 *    两级皆败，给封面 img 加 `lake-bookmark-cover-failed` 静默隐藏（样式在 styles/feature.css：
 *    display:none + 摘掉 .ne-card-bookmark-body 的封面间距 = 无封面排版）。隐藏的只是封面
 *    img 本体，卡壳/标题/来源行不动。真实换图（异值写）与加载成功（load）摘类恢复显示。
 *
 * 挂载点 = createLakeDocument 的 mount（桌面 EditorTab / 移动 LakeEditor / 预览共用），
 * dispose 随编辑器销毁。只读探查不改内核产物（LOCAL-CHANGES §二.1 应用层优先）。
 */

export const BOOKMARK_COVER_SELECTOR = 'img.ne-card-bookmark-cover-img, img.h5-ne-card-bookmark-cover-img';

/**
 * 两级皆败时加到封面 img 的隐藏态类（261119 用户裁决）。样式单一来源 = styles/feature.css
 * （display:none + 兄弟 .ne-card-bookmark-body 摘封面间距）；加/摘只在本模块。
 */
export const BOOKMARK_COVER_HIDDEN_CLASS = "lake-bookmark-cover-failed";

interface SrcGuardedImage extends HTMLImageElement {
  __lakeCoverSrcGuarded?: boolean;
  __lakeCoverCascade?: CoverCascade;
}

/** 单个封面 img 的错误级联状态（原 URL → 内核兜底 → …直到无下一级）。 */
interface CoverCascade {
  /** 有一轮 error 分发正在等裁决（微任务里定夺）。 */
  errorPending: boolean;
  /** 本轮 error 分发内出现过异值 src 写入 = 内核兜底下一级已上路。 */
  wroteNextLevel: boolean;
}

function hideCover(img: HTMLImageElement): void {
  img.classList.add(BOOKMARK_COVER_HIDDEN_CLASS);
}

function showCover(img: HTMLImageElement): void {
  img.classList.remove(BOOKMARK_COVER_HIDDEN_CLASS);
}

/**
 * 给单个封面 img 装「同值不写」的 src 访问器（幂等）。只包一层属性访问器，
 * 不拦截事件、不改传播路径，内核 onError 仍按原语义执行。
 *
 * 访问器同时承担错误级联的观测点：error 分发内的异值写 = 内核兜底下一级（不隐藏）；
 * 其余异值写 = 真实换图/重新加载（摘隐藏态，恢复正常显示）。
 */
export function guardBookmarkCoverWriteOnce(img: HTMLImageElement): void {
  const el = img as SrcGuardedImage;
  if (el.__lakeCoverSrcGuarded) return;
  el.__lakeCoverSrcGuarded = true;
  const desc = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, "src");
  if (!desc?.get || !desc?.set) return;
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
      const cascade = (this as SrcGuardedImage).__lakeCoverCascade;
      if (cascade && cascade.errorPending) {
        cascade.wroteNextLevel = true;
      } else {
        showCover(this);
      }
      protoSet.call(this, next);
    },
  });
}

/**
 * 在 host 上以捕获阶段监听 img error / load，为书签卡封面装防环 + 两级皆败隐藏守卫；返回 dispose。
 * error/load 事件不冒泡但走捕获，挂在 mount 上即可覆盖内核渲染的所有封面 img。
 */
export function installBookmarkCoverFallbackGuard(host: HTMLElement): () => void {
  const coverOf = (event: Event): HTMLImageElement | null => {
    const target = event.target as Element | null;
    if (!target || target.tagName !== "IMG") return null;
    if (!target.matches(BOOKMARK_COVER_SELECTOR)) return null;
    return target as HTMLImageElement;
  };
  const onError = (event: Event): void => {
    const img = coverOf(event);
    if (!img) return;
    // 首次 error 时装「未变才写」访问器（须早于内核 onError 的兜底写）。
    guardBookmarkCoverWriteOnce(img);
    const el = img as SrcGuardedImage;
    const cascade = (el.__lakeCoverCascade ??= { errorPending: false, wroteNextLevel: false });
    cascade.errorPending = true;
    cascade.wroteNextLevel = false;
    // 本轮分发（含内核 onError 的兜底写）结束后裁决：没见异值写 = 无下一级 ⇒ 两级皆败，静默隐藏。
    queueMicrotask(() => {
      if (!cascade.errorPending) return; // 已被 load/换图重置
      cascade.errorPending = false;
      const hasNextLevel = cascade.wroteNextLevel;
      cascade.wroteNextLevel = false;
      if (!hasNextLevel) hideCover(img);
    });
  };
  const onLoad = (event: Event): void => {
    const img = coverOf(event);
    if (!img) return;
    const cascade = (img as SrcGuardedImage).__lakeCoverCascade;
    if (cascade) {
      cascade.errorPending = false;
      cascade.wroteNextLevel = false;
    }
    showCover(img);
  };
  host.addEventListener("error", onError, true);
  host.addEventListener("load", onLoad, true);
  return () => {
    host.removeEventListener("error", onError, true);
    host.removeEventListener("load", onLoad, true);
  };
}
