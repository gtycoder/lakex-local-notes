// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MARKDOWN_CONVERT_TIMEOUT_MS,
  MARKDOWN_IMPORT_CONTAINER_WIDTH,
  MarkdownImportError,
  convertMarkdownToLake,
  createMarkdownImportContainer,
  dirnameOf,
  markdownConvertInFlight,
  resetMarkdownConvertQueueForTest,
  resolveLocalImagePath,
  rewriteMarkdownImages,
  stripFrontmatter,
  type MarkdownKernelHandle,
  type MarkdownKernelLike,
} from "./markdownImportPipeline";

/**
 * 261106 Markdown 导入共享管线（md → lake）。
 * 内核用 stub 注入（真内核在 lazy 边界里，测试不碰）；这里守的是**我们这一侧的契约**：
 * 离屏容器宽度/可见性（不能 display:none）、setDocument('text/markdown') → getDocument('text/lake')、
 * 产物必须含 data-lake-id、frontmatter 丢弃、图片物化/远程降级、超时、串行队列。
 */
const LAKE = '<p data-lake-id="b1">hello</p>';

/** stub 内核：setDocument 后 renderTicks 次 getDocument 才产出正文（模拟 tile 分批渲染）。 */
function stubKernel(options: { body?: () => string; delayTicks?: number; onSetDocument?: (type: string, content: string) => void } = {}): MarkdownKernelLike & { setCount: number; polls: number; destroyed: boolean } {
  const kernel = {
    setCount: 0,
    polls: 0,
    destroyed: false,
    setDocument(type: string, content: string) {
      kernel.setCount += 1;
      kernel.polls = 0;
      options.onSetDocument?.(type, content);
      (kernel as unknown as { _type: string })._type = type;
    },
    getDocument(type: string) {
      kernel.polls += 1;
      expect(type).toBe("text/lake");
      if (kernel.polls <= (options.delayTicks ?? 1)) return "";
      return options.body ? options.body() : LAKE;
    },
    destroy() { kernel.destroyed = true; },
  };
  return kernel as MarkdownKernelLike & { setCount: number; polls: number; destroyed: boolean };
}

function factory(kernelRef: { kernel: MarkdownKernelLike; container?: HTMLElement }, hooks: { onDispose?: () => void } = {}) {
  return (container: HTMLElement): MarkdownKernelHandle => {
    kernelRef.container = container;
    return { kernel: kernelRef.kernel, dispose: () => { hooks.onDispose?.(); } };
  };
}

afterEach(() => {
  resetMarkdownConvertQueueForTest();
  document.body.innerHTML = "";
});

describe("预处理：frontmatter / 换行", () => {
  it("丢弃 YAML frontmatter 并记 warning；正文分隔线不受影响", () => {
    const warnings: string[] = [];
    expect(stripFrontmatter("---\ntitle: x\ndate: 2026\n---\n# 标题", warnings)).toBe("# 标题");
    expect(warnings[0]).toContain("frontmatter");
    const plain = "---\n# 标题";
    expect(stripFrontmatter(plain, warnings)).toBe(plain);
  });
});

describe("图片重写", () => {
  it("本地图物化为资产 URL；远程图降级为链接；data: 丢弃", async () => {
    const warnings: string[] = [];
    const stats = { imageCount: 0 };
    const uploaded: string[] = [];
    const output = await rewriteMarkdownImages(
      "![本地](./img/a.png)\n![远程](https://example.com/x.png)\n![内嵌](data:image/png;base64,AAAA)",
      {
        baseDir: "/docs",
        assetUploader: async (absolute: string) => { uploaded.push(absolute); return "http://127.0.0.1:19876/n1/a.png"; },
      },
      warnings,
      stats,
    );
    expect(uploaded).toEqual(["/docs/img/a.png"]);
    expect(stats.imageCount).toBe(1);
    expect(output).toContain("http://127.0.0.1:19876/n1/a.png");
    expect(output).toContain("[远程](https://example.com/x.png)");
    expect(output).not.toContain("data:image/png");
    expect(warnings.some((warning) => warning.includes("远程图片未下载"))).toBe(true);
    expect(warnings.some((warning) => warning.includes("内嵌 data: 图片"))).toBe(true);
  });

  it("本地图物化失败 ⇒ 降级为链接 + warning（不留下坏图片语法）", async () => {
    const warnings: string[] = [];
    const stats = { imageCount: 0 };
    const output = await rewriteMarkdownImages("![a](./missing.png)", { baseDir: "/docs", assetUploader: async () => null }, warnings, stats);
    expect(output).toBe("[a](./missing.png)");
    expect(stats.imageCount).toBe(0);
    expect(warnings.some((warning) => warning.includes("本地图片未能物化"))).toBe(true);
  });

  it("路径解析：相对/绝对/../ 与 URL 编码；越界返回 null", () => {
    expect(resolveLocalImagePath("/docs/sub", "../a.png")).toBe("/docs/a.png");
    expect(resolveLocalImagePath("/docs", "./a%20b.png")).toBe("/docs/a b.png");
    expect(resolveLocalImagePath("/docs", "/abs/b.png")).toBe("/abs/b.png");
    expect(resolveLocalImagePath(undefined, "a.png")).toBeNull();
    expect(dirnameOf("/docs/a/b.md")).toBe("/docs/a");
  });
});

describe("转换：容器 / 内核配方 / 产物校验", () => {
  it("离屏容器宽 800、不是 display:none、挂在 document.body，用完移除", async () => {
    const kernel = stubKernel();
    const ref: { kernel: MarkdownKernelLike; container?: HTMLElement } = { kernel };
    const result = await convertMarkdownToLake({ markdown: "# hi", createKernel: factory(ref) });
    expect(result.body).toBe(LAKE);
    expect(MARKDOWN_IMPORT_CONTAINER_WIDTH).toBe(800);
    const container = ref.container as HTMLElement;
    expect(container).toBeTruthy();
    expect(container.style.width).toBe("800px");
    expect(container.style.display).toBe("");
    expect(container.style.visibility).toBe("hidden");
    expect(container.getAttribute("data-markdown-import-host")).toBe("1");
    // 转换结束容器已清理（不残留离屏 DOM）
    expect(document.body.contains(container)).toBe(false);
    expect(createMarkdownImportContainer().style.width).toBe("800px");
  });

  it("调用 setDocument('text/markdown', md) 并读 getDocument('text/lake')", async () => {
    const seen: Array<{ type: string; content: string }> = [];
    const kernel = stubKernel({ onSetDocument: (type, content) => seen.push({ type, content }) });
    await convertMarkdownToLake({ markdown: "# 标题\n正文", createKernel: factory({ kernel }) });
    expect(seen).toHaveLength(1);
    expect(seen[0].type).toBe("text/markdown");
    expect(seen[0].content).toContain("# 标题");
  });

  it("产物缺 data-lake-id ⇒ 抛 no-lake-id（不落半成品）", async () => {
    const kernel = stubKernel({ body: () => "<p>no id</p>" });
    await expect(convertMarkdownToLake({ markdown: "x", createKernel: factory({ kernel }), renderTimeoutMs: 400 }))
      .rejects.toMatchObject({ code: "no-lake-id" });
    const noIdKernel = stubKernel({ body: () => '<p data-lake-id="x">ok</p>' });
    const ok = await convertMarkdownToLake({ markdown: "x", createKernel: factory({ kernel: noIdKernel }) });
    expect(ok.body).toContain("data-lake-id");
  });

  it("渲染一直为空 ⇒ render-timeout（清理容器/内核后抛出）", async () => {
    const kernel = stubKernel({ delayTicks: 10_000 });
    const ref: { kernel: MarkdownKernelLike; container?: HTMLElement } = { kernel };
    let disposed = 0;
    await expect(convertMarkdownToLake({ markdown: "x", createKernel: factory(ref, { onDispose: () => { disposed += 1; } }), renderTimeoutMs: 300 }))
      .rejects.toBeInstanceOf(MarkdownImportError);
    expect(disposed).toBe(1);
    expect(document.body.contains(ref.container as HTMLElement)).toBe(false);
  });

  it("空 Markdown ⇒ 不启内核，返回空正文 + warning", async () => {
    const createKernel = vi.fn();
    const result = await convertMarkdownToLake({ markdown: "   \n\n", createKernel });
    expect(result.body).toBe("");
    expect(createKernel).not.toHaveBeenCalled();
    expect(result.warnings.some((warning) => warning.includes("内容为空"))).toBe(true);
  });

  it("> 20MB 直接拒绝（too-large）", async () => {
    await expect(convertMarkdownToLake({ markdown: "x".repeat(20 * 1024 * 1024 + 1) }))
      .rejects.toMatchObject({ code: "too-large" });
    expect(MARKDOWN_CONVERT_TIMEOUT_MS).toBe(15_000);
  });

  it("复用 existingKernel：不建容器、不销毁", async () => {
    const kernel = stubKernel();
    const result = await convertMarkdownToLake({ markdown: "# hi", existingKernel: kernel });
    expect(result.body).toBe(LAKE);
    expect(kernel.destroyed).toBe(false);
  });
});

describe("串行队列", () => {
  it("并发调用同一时刻只跑一个转换（max in-flight = 1）", async () => {
    let active = 0;
    let maxActive = 0;
    const makeFactory = () => (): MarkdownKernelHandle => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      const kernel = stubKernel({ delayTicks: 2 });
      return { kernel, dispose: () => { active -= 1; } };
    };
    const jobs = [1, 2, 3].map((index) => convertMarkdownToLake({ markdown: "# doc " + index, createKernel: makeFactory() }));
    const results = await Promise.all(jobs);
    expect(results.map((result) => result.body)).toEqual([LAKE, LAKE, LAKE]);
    expect(maxActive).toBe(1);
    expect(markdownConvertInFlight()).toBe(0);
  });
});
