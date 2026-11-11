/**
 * 【task-26 / 边界 A】新插入图片的显示缩略「放行」跟踪器。
 *
 * 背景：内核图片卡缺 original 尺寸时会用**当前显示图**的 naturalWidth 补写原尺寸并 sync(true)
 * （LAKEX-CONTRACT §5.51 实测）⇒ 显示缩略前必须确认模型里已有正数 origin。
 * 新插入图片的 origin 由内核在上传/加载阶段写入，时机不在我们这一侧；因此这里只做一件事：
 * 上传成功后按延时多次读**正文**，一旦正文里该资产已带正数 origin 就把它并进活 allowlist
 * （imageThumbLearnFromBody，幂等）。正文里还没出现 origin ⇒ 一律不放行（宁可不缩，不许污染正文）。
 *
 * 只依赖注入的 readBody/schedule，纯逻辑可单测；不碰 DOM、不碰内核私有字段。
 */
import { imageThumbBodyHasFile, imageThumbKey, imageThumbLearnFromBody, imageThumbPendingCount, imageThumbPendingOrigins } from "../../core/quickNoteImageThumb.js";

export interface ImageThumbTrackerDeps {
  /** 显示缩略档位（prefs.imageThumbWidth）；<=0 / 非数字 ⇒ 整个跟踪器不工作。 */
  width: number | undefined;
  /** 活 allowlist（同一实例被内核 onBeforeRenderImage 闭包持有，就地增补）。 */
  allow: Set<string> | undefined;
  /** 读当前正文（text/lake）；编辑器已销毁时抛错/返回空串都可。 */
  readBody: () => string;
  /** 延时调度（生产 = setTimeout；测试注入假时钟）。返回取消函数。 */
  schedule: (delayMs: number, run: () => void) => () => void;
  /** 观测（缺省静默；用于排查"为什么这张图没缩"）。 */
  log?: (event: "confirmed" | "learned" | "giveup", detail: { file: string; tries: number }) => void;
}

export interface ImageThumbUploadTracker {
  /** 本地资产上传完成后调用（output.url = 资产服务 URL）；非本地资产/已放行/未启用 ⇒ 空操作。 */
  onUploaded(output: { url?: unknown }): void;
  /** 取消所有待确认定时器（编辑器销毁时调）。 */
  dispose(): void;
  /** 当前待确认资产数（测试/诊断用）。 */
  pendingCount(): number;
}

/** 读正文的时点：0ms 抢在内核把 src 写回模型后的第一帧，之后两次退避兜底（多数命中在 0–300ms）。
 *  每次读 = 一次整篇序列化（移动端大文档不可忽略）⇒ 只保留 3 次采样。 */
const CHECK_DELAYS_MS = [0, 150, 600];

export function createImageThumbUploadTracker(deps: ImageThumbTrackerDeps): ImageThumbUploadTracker {
  const enabled = typeof deps.width === "number" && deps.width > 0 && deps.allow instanceof Set;
  const pending = new Map<string, { cancels: Array<() => void>; tries: number }>();

  const cancel = (file: string): void => {
    const entry = pending.get(file);
    if (!entry) return;
    for (const off of entry.cancels) { try { off(); } catch { /* 已触发 */ } }
    pending.delete(file);
  };

  const step = (file: string, index: number): void => {
    const entry = pending.get(file);
    if (!entry) return;
    entry.tries += 1;
    let body = "";
    try { body = deps.readBody(); } catch { body = ""; }
    imageThumbLearnFromBody(body, deps.allow as Set<string>);
    if (deps.allow?.has(file)) {
      cancel(file);
      deps.log?.("learned", { file, tries: entry.tries });
      return;
    }
    if (index + 1 >= CHECK_DELAYS_MS.length) {
      cancel(file);
      deps.log?.("giveup", { file, tries: entry.tries });
      return;
    }
    entry.cancels.push(deps.schedule(CHECK_DELAYS_MS[index + 1] - CHECK_DELAYS_MS[index], () => step(file, index + 1)));
  };

  /**
   * 上传 resolve 时的即时确认：正文里恰好只有一张「上传中（src 空）且已有正数 origin」的 image 卡，
   * 且我们的卡还没回填 src ⇒ 那张就是本条 ⇒ 现在就放行（无需等 100ms 后的重渲染）。
   * 判据来自实测（261111）：file/base64 两条路径在上传 resolve 前内核已写真实 origin。
   * 多张并发（数不出来是哪张）或读不到正文 ⇒ 返回 false，交给退避重试按 src+origin 放行。
   */
  const confirmPendingNow = (file: string): boolean => {
    let body = "";
    try { body = deps.readBody(); } catch { return false; }
    if (!body) return false;
    // 我们的卡已经回填 src（上传完成）⇒ 不走即时确认，交给重试按正文 origin 判断（避免认错卡）。
    if (imageThumbBodyHasFile(body, file)) return false;
    // 身份校验：全篇必须**恰好只有一张**待上传卡，才可能是我们这张；并发（≥2）/没有（0）都不认。
    if (imageThumbPendingCount(body) !== 1) return false;
    // 那张唯一的待上传卡还必须已经带正数 origin（否则放行就会让内核拿 1024 补写原尺寸）。
    if (imageThumbPendingOrigins(body).length !== 1) return false;
    (deps.allow as Set<string>).add(file);
    return true;
  };

  return {
    onUploaded(output) {
      if (!enabled) return;
      const url = typeof output?.url === "string" ? output.url : "";
      const file = imageThumbKey(url);
      if (!file || deps.allow?.has(file) || pending.has(file)) return;
      if (confirmPendingNow(file)) {
        deps.log?.("confirmed", { file, tries: 0 });
        return;
      }
      const entry = { cancels: [] as Array<() => void>, tries: 0 };
      pending.set(file, entry);
      entry.cancels.push(deps.schedule(CHECK_DELAYS_MS[0], () => step(file, 0)));
    },
    dispose() {
      for (const file of [...pending.keys()]) cancel(file);
    },
    pendingCount() {
      return pending.size;
    },
  };
}
