// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { mountMediaCardResize } from "./mediaCardResize";
import { applyVideoLayout, readVideoLayout } from "./videoCardOps";

function rect(x: number, y: number, width: number, height: number): DOMRect {
  return { x, y, width, height, left: x, top: y, right: x + width, bottom: y + height, toJSON: () => ({}) } as DOMRect;
}

function videoCard(widthPercent = 50, align = "left") {
  const value: Record<string, unknown> = { status: "done", __videoWidth: widthPercent, __videoAlign: align };
  const card = document.createElement("ne-card");
  card.setAttribute("data-card-name", "video");
  card.setAttribute("id", "video-1");
  const done = document.createElement("div");
  done.className = "ne-card-video-content ne-card-video-done";
  card.appendChild(done);
  const cardData = {
    getCardValue: vi.fn(() => ({ ...value })),
    resetCardValue: vi.fn((next: Record<string, unknown>) => Object.assign(value, next)),
    sync: vi.fn(() => true),
  };
  Object.defineProperty(card, "_neRef", { value: { _virtualNode: { _instance: { cardData } } } });
  // 真实卡宽（视频卡 fit-content）：映射必须走真实分支，不许走 rect=0 的 fallback（261117 审计盲区）。
  vi.spyOn(card, "getBoundingClientRect").mockReturnValue(rect(0, 0, 250, 150));
  const host = document.createElement("div");
  const hole = document.createElement("ne-hole");
  vi.spyOn(hole, "getBoundingClientRect").mockReturnValue(rect(0, 0, 500, 500));
  hole.appendChild(card);
  host.appendChild(hole);
  return { card, host, cardData, value };
}

function imageCard(width = 300, alignment = "left") {
  const card = document.createElement("ne-card");
  card.setAttribute("data-card-name", "image");
  card.setAttribute("id", "image-1");
  const img = document.createElement("img");
  img.style.width = `${width}px`;
  vi.spyOn(img, "getBoundingClientRect").mockReturnValue(rect(20, 5, width, 150));
  Object.defineProperty(img, "naturalWidth", { value: 600 });
  Object.defineProperty(img, "naturalHeight", { value: 300 });
  card.appendChild(img);
  const editor = { execCommand: vi.fn(() => true) };
  Object.defineProperty(card, "_neRef", { value: { _virtualNode: { _instance: { editor } } } });
  // 卡片比图宽（正文满宽）：把手必须贴 img 盒而不是卡盒（R1 根因之一）。
  vi.spyOn(card, "getBoundingClientRect").mockReturnValue(rect(0, 0, 500, 200));
  const hole = document.createElement("ne-hole");
  if (alignment !== "left") hole.setAttribute("ne-alignment", alignment);
  vi.spyOn(hole, "getBoundingClientRect").mockReturnValue(rect(0, 0, 500, 500));
  hole.appendChild(card);
  const host = document.createElement("div");
  host.appendChild(hole);
  return { card, host, img, editor };
}

function drag(handle: HTMLElement, moves: number[], opts: { cancel?: boolean } = {}): void {
  handle.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, cancelable: true, clientX: 0 }));
  for (const x of moves) {
    window.dispatchEvent(new MouseEvent("pointermove", { bubbles: true, cancelable: true, clientX: x }));
  }
  window.dispatchEvent(
    opts.cancel
      ? new MouseEvent("pointercancel", { bubbles: true, cancelable: true })
      : new MouseEvent("pointerup", { bubbles: true, cancelable: true, clientX: moves[moves.length - 1] ?? 0 }),
  );
}

function pressEscape(): void {
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
}

describe("媒体缩放 · 把手集合（只在会动的边出把手）", () => {
  it("左对齐图片 = 右边缘 + 右上/右下角点，共 3 个", () => {
    const { card, host } = imageCard(300, "left");
    const dispose = mountMediaCardResize(host, true);
    const ids = [...card.querySelectorAll<HTMLElement>(".lake-media-resize-handle")].map((h) => h.dataset.handle);
    expect(ids).toEqual(["edge-right", "corner-tr", "corner-br"]);
    dispose();
  });

  it("居中 = 两侧 6 个；右对齐 = 左侧 3 个", () => {
    const center = imageCard(300, "center");
    const disposeCenter = mountMediaCardResize(center.host, true);
    expect(center.card.querySelectorAll(".lake-media-resize-handle")).toHaveLength(6);
    disposeCenter();
    const right = imageCard(300, "right");
    const disposeRight = mountMediaCardResize(right.host, true);
    const ids = [...right.card.querySelectorAll<HTMLElement>(".lake-media-resize-handle")].map((h) => h.dataset.handle);
    expect(ids).toEqual(["edge-left", "corner-tl", "corner-bl"]);
    disposeRight();
  });

  it("把手盒贴 img 实测盒（不是卡片盒），角点落在图片角上", () => {
    const { card, host } = imageCard(300, "left");
    const dispose = mountMediaCardResize(host, true);
    const box = card.querySelector<HTMLElement>(".lake-media-resize-box")!;
    // img rect = (20,5,300,150)，card rect = (0,0,500,200) ⇒ 盒 = img − card。
    expect(box.style.left).toBe("20px");
    expect(box.style.top).toBe("5px");
    expect(box.style.width).toBe("300px");
    expect(box.style.height).toBe("150px");
    dispose();
  });
});

describe("媒体缩放 · 线性跟手（思源公式）", () => {
  it("图片拖动 1:1：−100px ⇒ 300→200px；分 100 次 1px 拖也是 200px（不跑飞）", () => {
    const oneShot = imageCard(300, "left");
    const disposeOne = mountMediaCardResize(oneShot.host, true);
    drag(oneShot.card.querySelector<HTMLElement>('.lake-media-resize-handle[data-handle="edge-right"]')!, [-100]);
    expect(oneShot.img.style.width).toBe("200px");
    expect(oneShot.editor.execCommand).toHaveBeenCalledWith("updateImageData", "image-1", { width: 200 });
    disposeOne();

    const stepwise = imageCard(300, "left");
    const disposeStep = mountMediaCardResize(stepwise.host, true);
    drag(stepwise.card.querySelector<HTMLElement>('.lake-media-resize-handle[data-handle="edge-right"]')!, Array.from({ length: 100 }, (_, i) => -(i + 1)));
    expect(stepwise.img.style.width).toBe("200px");
    disposeStep();
  });

  it("视频拖动 = 布局实时预览（卡片/把手/下方间隔实时走位），松手一次写回且值不变", () => {
    const { card, host, cardData } = videoCard(50);
    const dispose = mountMediaCardResize(host, true);
    const handle = card.querySelector<HTMLElement>('.lake-media-resize-handle[data-handle="edge-right"]')!;
    handle.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, cancelable: true, clientX: 0 }));
    window.dispatchEvent(new MouseEvent("pointermove", { bubbles: true, cancelable: true, clientX: 50 }));
    expect(card.style.getPropertyValue("--lake-video-max-width")).toBe("60%"); // 拖动中即真布局（间隔实时变化）
    const box = card.querySelector<HTMLElement>(".lake-media-resize-box")!;
    expect(box.getAttribute("style") ?? "").toBe(""); // 视频盒 inset-0，跟随卡片布局自动走位
    expect(cardData.sync).not.toHaveBeenCalled();
    window.dispatchEvent(new MouseEvent("pointerup", { bubbles: true, cancelable: true, clientX: 50 }));
    expect(cardData.sync).toHaveBeenCalledTimes(1);
    expect(cardData.resetCardValue).toHaveBeenCalledWith(expect.objectContaining({ __videoWidth: 60 }));
    expect(card.style.getPropertyValue("--lake-video-max-width")).toBe("60%"); // 松手值 = 预览值（零跳变）
    dispose();

    const noop = videoCard(50);
    const disposeNoop = mountMediaCardResize(noop.host, true);
    drag(noop.card.querySelector<HTMLElement>('.lake-media-resize-handle[data-handle="edge-right"]')!, [0]);
    expect(noop.cardData.sync).not.toHaveBeenCalled();
    disposeNoop();
  });

  it("拖动锁：拖动中 applyVideoLayout 不得把旧宽度回写（防整卡跳回原尺寸）", () => {
    const { card, host, cardData } = videoCard(50);
    const dispose = mountMediaCardResize(host, true);
    const handle = card.querySelector<HTMLElement>('.lake-media-resize-handle[data-handle="edge-right"]')!;
    handle.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, cancelable: true, clientX: 0 }));
    window.dispatchEvent(new MouseEvent("pointermove", { bubbles: true, cancelable: true, clientX: 50 }));
    // 模拟 MutationObserver/contentchange 触发的布局回写：
    const layout = applyVideoLayout(card, readVideoLayout(card));
    expect(layout.widthPercent).toBe(50);
    expect(card.style.getPropertyValue("--lake-video-max-width")).toBe("60%"); // 被锁挡住：预览值未被旧持久值覆盖
    window.dispatchEvent(new MouseEvent("pointerup", { bubbles: true, cancelable: true, clientX: 50 }));
    expect(cardData.sync).toHaveBeenCalledTimes(1);
    dispose();
  });

  it("视频百分比按正文宽映射，居中系数 2：+50px @500 正文 ⇒ 左 60% / 中 70%", () => {
    const left = videoCard(50, "left");
    const disposeLeft = mountMediaCardResize(left.host, true);
    drag(left.card.querySelector<HTMLElement>('.lake-media-resize-handle[data-handle="edge-right"]')!, [50]);
    expect(left.card.style.getPropertyValue("--lake-video-max-width")).toBe("60%");
    disposeLeft();

    const center = videoCard(50, "center");
    const disposeCenter = mountMediaCardResize(center.host, true);
    drag(center.card.querySelector<HTMLElement>('.lake-media-resize-handle[data-handle="edge-right"]')!, [50]);
    expect(center.card.style.getPropertyValue("--lake-video-max-width")).toBe("70%");
    disposeCenter();
  });

  it("被拖边缘贴光标：居中系数 2、右侧固定系数 1，把手盒跟着走", () => {
    // 居中 + 右缘拖 −100：宽 = 300 − 100×2 = 100，盒左 = 20 + (300−100)×0.5 = 120 ⇒ 右缘 220 = 320−100 ✓
    const center = imageCard(300, "center");
    const disposeCenter = mountMediaCardResize(center.host, true);
    drag(center.card.querySelector<HTMLElement>('.lake-media-resize-handle[data-handle="edge-right"]')!, [-100]);
    const boxCenter = center.card.querySelector<HTMLElement>(".lake-media-resize-box")!;
    expect(boxCenter.style.left).toBe("120px");
    expect(boxCenter.style.width).toBe("100px");
    disposeCenter();

    // 右对齐 + 左缘拖 −100：宽 = 300 + 100 = 400，盒左 = 20 + (300−400)×1 = −80 ⇒ 左缘 −80 = 20−100 ✓
    const right = imageCard(300, "right");
    const disposeRight = mountMediaCardResize(right.host, true);
    drag(right.card.querySelector<HTMLElement>('.lake-media-resize-handle[data-handle="edge-left"]')!, [-100]);
    const boxRight = right.card.querySelector<HTMLElement>(".lake-media-resize-box")!;
    expect(boxRight.style.left).toBe("-80px");
    expect(boxRight.style.width).toBe("400px");
    disposeRight();
  });
});

describe("媒体缩放 · 取消 / 中断 / 键盘 / 阅读态", () => {
  it("Esc 显式取消精确还原：图片回原内联样式，视频回起始百分比", () => {
    const image = imageCard(300, "left");
    const original = image.img.getAttribute("style");
    const disposeImage = mountMediaCardResize(image.host, true);
    const imageHandle = image.card.querySelector<HTMLElement>('.lake-media-resize-handle[data-handle="edge-right"]')!;
    imageHandle.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, cancelable: true, clientX: 0 }));
    window.dispatchEvent(new MouseEvent("pointermove", { bubbles: true, cancelable: true, clientX: -100 }));
    pressEscape();
    expect(image.img.getAttribute("style")).toBe(original);
    expect(image.editor.execCommand).not.toHaveBeenCalled();
    disposeImage();

    const video = videoCard(50);
    const disposeVideo = mountMediaCardResize(video.host, true);
    const videoHandle = video.card.querySelector<HTMLElement>('.lake-media-resize-handle[data-handle="edge-right"]')!;
    videoHandle.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, cancelable: true, clientX: 0 }));
    window.dispatchEvent(new MouseEvent("pointermove", { bubbles: true, cancelable: true, clientX: 50 }));
    pressEscape();
    expect(video.card.style.getPropertyValue("--lake-video-max-width")).toBe("50%");
    expect(video.cardData.sync).not.toHaveBeenCalled();
    disposeVideo();
  });

  it("中断（pointercancel / 失焦）= 按当前值提交，不回退", () => {
    const video = videoCard(50);
    const dispose = mountMediaCardResize(video.host, true);
    drag(video.card.querySelector<HTMLElement>('.lake-media-resize-handle[data-handle="edge-right"]')!, [50], { cancel: true });
    expect(video.cardData.sync).toHaveBeenCalledTimes(1);
    expect(video.cardData.resetCardValue).toHaveBeenCalledWith(expect.objectContaining({ __videoWidth: 60 }));
    dispose();

    const image = imageCard(300, "left");
    const disposeImage = mountMediaCardResize(image.host, true);
    drag(image.card.querySelector<HTMLElement>('.lake-media-resize-handle[data-handle="edge-right"]')!, [-100], { cancel: true });
    expect(image.editor.execCommand).toHaveBeenCalledWith("updateImageData", "image-1", { width: 200 });
    disposeImage();
  });

  it("键盘 ←/→ 走步进并写回，Home/End 到 10/100", () => {
    const video = videoCard(50);
    const dispose = mountMediaCardResize(video.host, true);
    const handle = video.card.querySelector<HTMLElement>(".lake-media-resize-handle")!;
    handle.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    expect(video.card.getAttribute("data-video-width")).toBe("55");
    handle.dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true }));
    expect(video.card.getAttribute("data-video-width")).toBe("10");
    handle.dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true }));
    expect(video.card.getAttribute("data-video-width")).toBe("100");
    expect(video.cardData.sync).toHaveBeenCalledTimes(3);
    dispose();

    const image = imageCard(300, "left");
    const disposeImage = mountMediaCardResize(image.host, true);
    image.card.querySelector<HTMLElement>(".lake-media-resize-handle")!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    expect(image.editor.execCommand).toHaveBeenCalledWith("updateImageData", "image-1", { width: 310 });
    disposeImage();
  });

  it("阅读态不挂任何把手盒", () => {
    const video = videoCard(50);
    const image = imageCard(300);
    const disposeVideo = mountMediaCardResize(video.host, false);
    const disposeImage = mountMediaCardResize(image.host, false);
    expect(video.card.querySelectorAll(".lake-media-resize-box")).toHaveLength(0);
    expect(image.card.querySelectorAll(".lake-media-resize-box")).toHaveLength(0);
    disposeVideo();
    disposeImage();
  });
});

describe("媒体缩放 · 内核原生 resizer 接管", () => {
  it("内核 .ne-ui-image-resizer* 元素不被删除（隐藏交给 CSS）", () => {
    const { card, host } = imageCard(300);
    for (const corner of ["tl", "tr", "br", "bl"]) {
      const resizer = document.createElement("div");
      resizer.className = `ne-ui-image-resizer ne-resizer-${corner}`;
      card.appendChild(resizer);
    }
    const dispose = mountMediaCardResize(host, true);
    expect(card.querySelectorAll(".ne-ui-image-resizer")).toHaveLength(4);
    dispose();
  });

  it("样式层隐藏内核四角命中区、保留 selection box 描边（两端 CSS 都有接管声明）", () => {
    const desktop = readFileSync(join(process.cwd(), "src/styles/feature.css"), "utf8");
    const mobile = readFileSync(join(process.cwd(), "src/mobile/editor/edit-surface-kernel.css"), "utf8");
    for (const css of [desktop, mobile]) {
      expect(css).toContain(".ne-ui-image-resizer-handler");
      expect(css).toMatch(/\.ne-ui-image-resizer-handler[^}]*display: none/);
    }
  });
});

describe("移动端平台闸门（261119 用户裁决：移动端禁用图片/视频拖拽缩放）", () => {
  it("移动端（body.lake-mobile）挂载点不安装把手/盒；挂载后新增卡也不装（扫描器整链不跑）", async () => {
    document.body.classList.add("lake-mobile");
    try {
      const image = imageCard(300, "left");
      const video = videoCard(50, "center");
      const disposeImage = mountMediaCardResize(image.host, true);
      const disposeVideo = mountMediaCardResize(video.host, true);
      expect(image.card.querySelectorAll(".lake-media-resize-box, .lake-media-resize-handle")).toHaveLength(0);
      expect(video.card.querySelectorAll(".lake-media-resize-box, .lake-media-resize-handle")).toHaveLength(0);
      // 挂载后再插入的卡：扫描器（ensureBox 周期写回）若在跑，会经 MutationObserver → setTimeout(scan,0) 装上把手。
      const late = videoCard(50, "left");
      image.host.appendChild(late.card);
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(late.card.querySelectorAll(".lake-media-resize-box, .lake-media-resize-handle")).toHaveLength(0);
      // 拖拽交互零接入：按下不进拖动态（body 不加 lake-media-resizing / data-resize-cursor）。
      image.card.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, cancelable: true, clientX: 0 }));
      expect(document.body.classList.contains("lake-media-resizing")).toBe(false);
      expect(document.body.hasAttribute("data-resize-cursor")).toBe(false);
      disposeImage();
      disposeVideo();
    } finally {
      document.body.classList.remove("lake-mobile");
    }
  });

  it("移动端阅读态（interactive=false）同样零安装", () => {
    document.body.classList.add("lake-mobile");
    try {
      const video = videoCard(50);
      const dispose = mountMediaCardResize(video.host, false);
      expect(video.card.querySelectorAll(".lake-media-resize-box")).toHaveLength(0);
      dispose();
    } finally {
      document.body.classList.remove("lake-mobile");
    }
  });

  it("桌面照常（无 lake-mobile 标记 = 原语义：把手照旧安装）", () => {
    const { card, host } = imageCard(300, "left");
    const dispose = mountMediaCardResize(host, true);
    expect(card.querySelectorAll(".lake-media-resize-handle")).toHaveLength(3);
    dispose();
  });

  it("createLakeDocument 挂载入口按平台短路（EditorTab/LakeEditor 共用入口的源码级接线）", () => {
    const runtime = readFileSync(join(process.cwd(), "src/features/editor/lakeRuntime.ts"), "utf8");
    expect(runtime).toContain("import { mediaCardResizeEnabled, mountMediaCardResize }");
    expect(runtime).toContain("if (mediaCardResizeEnabled())");
    expect(runtime).toContain('mountMediaCardResize(mount, mode === "editor")');
  });
});
describe("把手盒的定位与宿主无关（261122 用户报「小记图片上下都占空间」）", () => {
  const CSS = readFileSync(join(process.cwd(), "src/styles/feature.css"), "utf8");

  it("position:absolute 规则不再只挂在 .lake-editor-tab 下（小记写作卡/详情也要生效）", () => {
    // 反例（改动前的 bug）：盒子在正常流里当卡片的第二个子元素，把图片高度再占一遍。
    expect(CSS).not.toMatch(/\.lake-editor-tab[^{]*>\.lake-media-resize-box\s*\{[^}]*position:\s*absolute/);
    expect(CSS).toMatch(/:is\(ne-card\[data-card-name="video"\], ne-card\[data-card-name="image"\]\) > \.lake-media-resize-box \{[^}]*position:\s*absolute/);
  });
});
