// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  BOOKMARK_COVER_HIDDEN_CLASS,
  BOOKMARK_COVER_SELECTOR,
  guardBookmarkCoverWriteOnce,
  installBookmarkCoverFallbackGuard,
} from "./bookmarkCoverFallbackGuard";

/**
 * 书签卡封面闪烁环护栏（261119）：
 * 真身 = 内核封面 img onError 无条件把 src 重写为兜底 URL；兜底也失败时
 * error → 同值重写 → 浏览器重拉 → error ……无限环（录屏里「卡片每隔不到一秒闪一下」）。
 * 两层修法：①「未变才写」——同值 src 赋值直接跳过；② 261119 用户裁决「两级皆败 ⇒ 静默隐藏
 * 缩略框」——error 分发内没有异值写（内核兜底下一级没上路）⇒ 加隐藏态类。
 * 这里以「内核式 onError 写回」模拟级联，断言 ① 首次兜底照常写入（行为不变）② 之后同值写
 * = 0 次（环终止）③ 真实换图仍正常写 ④ 单级失败兜底图仍显示 ⑤ 两级皆败静默隐藏 ⑥ 恢复/换图显示。
 */
const FALLBACK = "/vendor/lakex/alipay/A_MfA2QIGNXcEAAAAAAAAAAAAAARQnAQ";
const ORIGINAL = "http://mmbiz.qpic.cn/mmbiz_jpg/deadbeef/0?wx_fmt=jpeg";
const NEXT_URL = "https://example.com/another-cover.jpg";

function coverImg(): HTMLImageElement {
  const img = document.createElement("img");
  img.className = "ne-card-bookmark-cover-img";
  return img;
}

/** 微任务 + 宏任务各让一拍：隐藏裁决在 error 分发结束后的微任务里定夺。 */
const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/** 装一个「内核式 onError」：每次 error 都无条件重写为兜底（lakex.js _getCoverElement）。 */
function withKernelFallback(host: HTMLElement, img: HTMLImageElement): () => void {
  const onKernelError = (): void => {
    img.src = FALLBACK;
  };
  host.addEventListener("error", onKernelError, true);
  return () => host.removeEventListener("error", onKernelError, true);
}

describe("书签卡封面 src「未变才写」守卫", () => {
  it("同值赋值不落到原型 setter（不会触发浏览器重拉），异值照常写", () => {
    const img = coverImg();
    const desc = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, "src");
    let sets = 0;
    Object.defineProperty(HTMLImageElement.prototype, "src", {
      configurable: true,
      get: desc!.get,
      set(this: HTMLImageElement, value: string) {
        sets += 1;
        desc!.set!.call(this, value);
      },
    });
    try {
      guardBookmarkCoverWriteOnce(img);
      img.src = ORIGINAL;
      expect(sets).toBe(1);
      expect(img.getAttribute("src")).toBe(ORIGINAL);
      // 同值重写（内核 onError 在兜底失败后的重复写）：被吞掉
      img.src = ORIGINAL;
      img.src = ORIGINAL;
      expect(sets).toBe(1);
      // 真实换图（换到兜底）：照常写
      img.src = FALLBACK;
      expect(sets).toBe(2);
      // 兜底再失败后的同值重写：仍被吞掉
      img.src = FALLBACK;
      expect(sets).toBe(2);
    } finally {
      Object.defineProperty(HTMLImageElement.prototype, "src", desc!);
    }
  });

  it("重复守卫幂等；非封面 img 不受影响", () => {
    const img = coverImg();
    guardBookmarkCoverWriteOnce(img);
    guardBookmarkCoverWriteOnce(img);
    const plain = document.createElement("img");
    expect(img.matches(BOOKMARK_COVER_SELECTOR)).toBe(true);
    expect(plain.matches(BOOKMARK_COVER_SELECTOR)).toBe(false);
  });

  it("写次数断言：无守卫的环每次 error 都写、有守卫的环只写第一次兜底", () => {
    // 两份同样的「内核式」回路：error → 无条件 img.src = FALLBACK
    const run = (withGuard: boolean): number => {
      const host = document.createElement("div");
      const img = coverImg();
      img.src = ORIGINAL;
      host.appendChild(img);
      const desc = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, "src");
      let sets = 0;
      Object.defineProperty(HTMLImageElement.prototype, "src", {
        configurable: true,
        get: desc!.get,
        set(this: HTMLImageElement, value: string) {
          sets += 1;
          desc!.set!.call(this, value);
        },
      });
      try {
        if (withGuard) installBookmarkCoverFallbackGuard(host);
        // 模拟内核 onError：每次 error 都无条件重写为兜底（lakex.js _getCoverElement）
        const onKernelError = (): void => {
          img.src = FALLBACK;
        };
        host.addEventListener("error", onKernelError, true);
        for (let i = 0; i < 20; i += 1) {
          img.dispatchEvent(new Event("error", { bubbles: false }));
        }
        host.removeEventListener("error", onKernelError, true);
        return sets;
      } finally {
        Object.defineProperty(HTMLImageElement.prototype, "src", desc!);
      }
    };
    const unguarded = run(false);
    const guarded = run(true);
    // 前后对比：无守卫 = 每次 error 都写（环无限）；有守卫 = 首次兜底 1 次，之后 0 次。
    expect(unguarded).toBe(20);
    expect(guarded).toBe(1);
  });

  it("卸载后不再拦截（dispose 干净）", () => {
    const host = document.createElement("div");
    const img = coverImg();
    img.src = ORIGINAL;
    host.appendChild(img);
    const dispose = installBookmarkCoverFallbackGuard(host);
    dispose();
    const desc = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, "src");
    let sets = 0;
    Object.defineProperty(HTMLImageElement.prototype, "src", {
      configurable: true,
      get: desc!.get,
      set(this: HTMLImageElement, value: string) {
        sets += 1;
        desc!.set!.call(this, value);
      },
    });
    try {
      img.dispatchEvent(new Event("error", { bubbles: false }));
      img.src = FALLBACK;
      // 未装守卫 ⇒ 原型 setter 照常收到写入
      expect(sets).toBe(1);
    } finally {
      Object.defineProperty(HTMLImageElement.prototype, "src", desc!);
    }
  });
});

describe("两级皆败 ⇒ 静默隐藏缩略框（261119 用户裁决）", () => {
  it("单级失败 ⇒ 兜底图照常显示（不隐藏）", async () => {
    const host = document.createElement("div");
    const img = coverImg();
    img.src = ORIGINAL;
    host.appendChild(img);
    installBookmarkCoverFallbackGuard(host);
    const stop = withKernelFallback(host, img);
    img.dispatchEvent(new Event("error", { bubbles: false }));
    await tick();
    stop();
    // 原 URL 败、内核兜底下一级已上路 ⇒ 缩略框不隐藏，兜底图照常接管
    expect(img.getAttribute("src")).toBe(FALLBACK);
    expect(img.classList.contains(BOOKMARK_COVER_HIDDEN_CLASS)).toBe(false);
  });

  it("两级皆败 ⇒ 静默隐藏缩略框；隐藏后 error 风暴零写（环死 + 稳定）", async () => {
    const host = document.createElement("div");
    const img = coverImg();
    img.src = ORIGINAL;
    host.appendChild(img);
    const desc = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, "src");
    let sets = 0;
    Object.defineProperty(HTMLImageElement.prototype, "src", {
      configurable: true,
      get: desc!.get,
      set(this: HTMLImageElement, value: string) {
        sets += 1;
        desc!.set!.call(this, value);
      },
    });
    try {
      installBookmarkCoverFallbackGuard(host);
      const stop = withKernelFallback(host, img);
      img.dispatchEvent(new Event("error", { bubbles: false })); // 原 URL 败 → 兜底写入（异值）
      img.dispatchEvent(new Event("error", { bubbles: false })); // 兜底也败 → 同值写被吞 = 无下一级
      await tick();
      expect(img.classList.contains(BOOKMARK_COVER_HIDDEN_CLASS)).toBe(true);
      // 隐藏后 error 风暴：内核同值重写持续被吞 —— 零写、不抖
      for (let i = 0; i < 20; i += 1) img.dispatchEvent(new Event("error", { bubbles: false }));
      await tick();
      expect(sets).toBe(1);
      expect(img.classList.contains(BOOKMARK_COVER_HIDDEN_CLASS)).toBe(true);
      stop();
    } finally {
      Object.defineProperty(HTMLImageElement.prototype, "src", desc!);
    }
  });

  it("恢复/换图 ⇒ 显示：真实换图立即恢复；加载成功（load）恢复", async () => {
    const host = document.createElement("div");
    const img = coverImg();
    img.src = ORIGINAL;
    host.appendChild(img);
    installBookmarkCoverFallbackGuard(host);
    const stop = withKernelFallback(host, img);
    // 造出两级皆败的隐藏态
    img.dispatchEvent(new Event("error", { bubbles: false }));
    img.dispatchEvent(new Event("error", { bubbles: false }));
    await tick();
    expect(img.classList.contains(BOOKMARK_COVER_HIDDEN_CLASS)).toBe(true);
    // ① 真实换图（异值写）⇒ 立即恢复显示
    img.src = NEXT_URL;
    expect(img.getAttribute("src")).toBe(NEXT_URL);
    expect(img.classList.contains(BOOKMARK_COVER_HIDDEN_CLASS)).toBe(false);
    // ② React setAttribute 换图路径不经过访问器 ⇒ load 成功也要能恢复
    img.dispatchEvent(new Event("error", { bubbles: false }));
    img.dispatchEvent(new Event("error", { bubbles: false }));
    await tick();
    expect(img.classList.contains(BOOKMARK_COVER_HIDDEN_CLASS)).toBe(true);
    img.dispatchEvent(new Event("load", { bubbles: false }));
    expect(img.classList.contains(BOOKMARK_COVER_HIDDEN_CLASS)).toBe(false);
    stop();
  });

  it("隐藏态类的样式在 styles/feature.css 接线（display:none + 无封面排版的 body 间距摘除）", () => {
    const css = readFileSync(path.resolve(process.cwd(), "src/styles/feature.css"), "utf8");
    expect(css).toContain(`${BOOKMARK_COVER_HIDDEN_CLASS} { display: none; }`);
    expect(css).toContain(`${BOOKMARK_COVER_HIDDEN_CLASS} + .ne-card-bookmark-body`);
    expect(css).toContain(`${BOOKMARK_COVER_HIDDEN_CLASS} + .h5-ne-card-bookmark-body`);
  });
});

describe("闪烁环前提与接线护栏", () => {
  it("内核 _getCoverElement 的 onError 仍是「无条件重写兜底」（守卫前提；内核重转后此断言提醒复核）", () => {
    // jsdom 环境下 import.meta.url 不是 file: scheme ⇒ 按仓库根解析（vitest root = 仓库根）。
    const lakex = readFileSync(path.resolve(process.cwd(), "vendor/lakex-doc-react/src/components/lakex/lakex.js"), "utf8");
    // 两处封面 onError（块卡 / h5 卡）都直接写 coverRef.current.src = 兜底 URL，无同值判断
    const matches = lakex.match(/coverRef\.current\.src\s*=/g) ?? [];
    expect(matches.length).toBe(2);
    expect(lakex).toContain("A*MfA2QIGNXcEAAAAAAAAAAAAAARQnAQ");
  });

  it("createLakeDocument 挂载封面守卫（桌面/移动/预览共用入口）", () => {
    const runtime = readFileSync(path.resolve(process.cwd(), "src/features/editor/lakeRuntime.ts"), "utf8");
    expect(runtime).toContain("installBookmarkCoverFallbackGuard(mount)");
  });
});
