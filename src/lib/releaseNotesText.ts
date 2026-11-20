/**
 * 发版说明原文（docs/RELEASE-NOTES.md）的**按需**加载器（261120）。
 *
 * 为什么不在模块顶层 `import ... from "...?raw"`：这样文本会被打进**首屏资源图**
 * （桌面入口 chunk / 移动端设置 chunk），而它只在「更新日志」展开时才用得到。
 * 261120 实测代价：往 RELEASE-NOTES 加 44 行（≈1.5KB gzip）就让桌面首屏 +1,209B gzip，
 * 直接把 check:arch 的 602,000 预算顶爆（越线提交 534afa1a）。
 * 现在改成动态 import ⇒ 文本单独成一个 chunk，第一次真要看更新日志时才下载；
 * 两端共用这一份加载器（缓存 Promise，重复展开只下载一次，失败可重试）。
 */
let cached: Promise<string> | null = null;

export function loadReleaseNotesText(): Promise<string> {
  if (!cached) {
    cached = import("../../docs/RELEASE-NOTES.md?raw")
      .then((mod) => String((mod as { default?: unknown }).default ?? ""))
      .catch((error: unknown) => {
        // 加载失败不缓存，下次展开可以重试。
        cached = null;
        throw error;
      });
  }
  return cached;
}

/** 仅供测试/热重载重置（生产路径不会调用）。 */
export function resetReleaseNotesTextCache(): void { cached = null; }
