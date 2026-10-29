/**
 * DT-07：audio 卡内嵌播放兜底（从 lakeRuntime.createLakeDocument 抽出）。
 *
 * 背景（保留原注释）：Lake 的 queryAudioUrl 自动触发在「加载已有卡」时不稳定
 * （渲染成版权/错误链接，点击会跳系统浏览器打开附件 URL）。直接调 onTranscodeSuccess
 * 设置播放器（audio 元素 src=canonical，应用内嵌播放）。卡渲染完成后调用才生效——持续重试
 * （最长 ~20s）直到播放器出现。
 *
 * 计时器全在这里登记，dispose 一次清干净；createLakeDocument 只负责把它挂进 `__disposeExtras`。
 */

const INITIAL_DELAY_MS = 80;
const RETRY_INTERVAL_MS = 800;
const MAX_TRIES = 25;
/** 前几轮卡还没渲染完（setDocument 异步）继续等；这么多轮后仍无媒体卡则停止，避免白跑。 */
const EMPTY_CARD_TRIES = 5;

/** 在**本实例自己的 mount** 内扫描 audio/video 卡并补水合，返回 dispose。 */
export function setupAudioCardRetry(mount: HTMLElement): () => void {
  const audioTimers: number[] = [];
  const tryEnsureAudio = (tries: number): void => {
    let allReady = true;
    try {
      // audio + video 卡都覆盖：两者初次渲染都可能撞上 AssetServer 启动竞态（error 4）。
      // §6.1-#4：扫描范围收窄到本实例自己的 mount——此前用 document.querySelectorAll 扫全工作区，
      // 每个 keep-alive 编辑器实例都重复扫同一批卡（实测 8 标签 ~53 次/前 6s）。卡都在本 mount 内。
      const cards = mount.querySelectorAll('ne-card[name="audio"], NE-CARD[data-card-name="audio"], ne-card[name="video"], NE-CARD[data-card-name="video"]');
      if (cards.length === 0) {
        // 卡尚未渲染（setDocument 异步）——前几轮继续等待；之后无媒体卡则停止（避免白跑）
        allReady = tries >= EMPTY_CARD_TRIES;
      } else {
        cards.forEach((card) => {
          // 播放器已渲染但加载失败（server 启动竞态/瞬时失败 → networkState 3 + error）→ 重载
          const mediaEl = card.querySelector("audio, video") as HTMLMediaElement | null;
          if (mediaEl && mediaEl.networkState === 3 && mediaEl.error) {
            const s = mediaEl.getAttribute("src");
            if (s) { mediaEl.preload = "metadata"; mediaEl.src = s; mediaEl.load(); }
          }
          if (card.querySelector("audio, video")) return;
          if (card.getAttribute("name") === "video" || card.getAttribute("data-card-name") === "video") return; // video 卡无 onTranscodeSuccess 流程
          allReady = false;
          // 编辑器实例在 _virtualNode._instance；viewer（只读）实例在 _neRef._instance
          const inst = (card as unknown as { _neRef?: { _virtualNode?: { _instance?: { cardData?: unknown; _cardData?: unknown; onTranscodeSuccess?: (e: unknown) => void }; }; _instance?: { cardData?: unknown; _cardData?: unknown; onTranscodeSuccess?: (e: unknown) => void } } })._neRef?._virtualNode?._instance
            ?? (card as unknown as { _neRef?: { _instance?: { cardData?: unknown; _cardData?: unknown; onTranscodeSuccess?: (e: unknown) => void } } })._neRef?._instance;
          const cd = inst?.cardData ?? inst?._cardData;
          const info = (cd as { getAudioInfo?: () => { id?: string | null } } | null | undefined)?.getAudioInfo?.();
          const url = info?.id;
          if (!url) return;
          const status = (cd as { getStatus?: () => string } | null | undefined)?.getStatus?.();
          if (status === "error") return;
          if (typeof inst?.onTranscodeSuccess === "function") {
            inst.onTranscodeSuccess({ success: true, data: { audio: url, origin: url } });
          } else {
            // viewer 实例无 onTranscodeSuccess（Lake viewer audio 卡不跑查询流程）→
            // 直接写 audioInfo.url = canonical + sync(true) + rerender（实测三者缺一不可：
            // sync 触发渲染、rerender 传 audioUrl/uiStatus 给播放器组件）
            const instAny = inst as { cardData?: { setAudioInfo?: (v: unknown) => void; sync?: (u: boolean) => void }; _cardUI?: { uiViewProxy?: { rerender?: (p: unknown) => void } }; _$cardUI?: { uiViewProxy?: { rerender?: (p: unknown) => void } } } | null | undefined;
            const cd2 = instAny?.cardData;
            if (cd2 && typeof cd2.setAudioInfo === "function") {
              cd2.setAudioInfo({ ...info, url });
              try { cd2.sync?.(true); } catch { /* 忽略 */ }
            }
            const ui = instAny?._cardUI ?? instAny?._$cardUI;
            try { ui?.uiViewProxy?.rerender?.({ audioUrl: url, uiStatus: "transcoded" }); } catch { /* 忽略 */ }
          }
        });
      }
    } catch { /* 单卡兜底失败不阻断 */ }
    if (!allReady && tries < MAX_TRIES) {
      audioTimers.push(window.setTimeout(() => tryEnsureAudio(tries + 1), RETRY_INTERVAL_MS));
    }
  };
  audioTimers.push(window.setTimeout(() => tryEnsureAudio(0), INITIAL_DELAY_MS));
  return () => {
    audioTimers.forEach((t) => window.clearTimeout(t));
  };
}
