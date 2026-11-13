// @vitest-environment jsdom
/**
 * 资源管理「清理」明细面板（261105 用户点单）：首页不再外露删除，删除入口必须先进「查看」面板。
 * 只测面板本身（MobileSheet 外壳复用既有原语，行为已由其他装置覆盖）。
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { ResourceCleanupSheet, type ResourceCleanupSheetProps } from "./ResourceCleanupSheet";

const ORPHANS = [
  { id: 1, noteId: "n1", filename: "a.png", size: 1024, mimeType: "image/png" },
  { id: 2, noteId: "n2", filename: "b.webp", size: 2048, mimeType: "image/webp" },
];

interface Mounted { container: HTMLElement; unmount: () => Promise<void> }

async function mount(overrides: Partial<ResourceCleanupSheetProps> = {}): Promise<Mounted> {
  const props: ResourceCleanupSheetProps = {
    open: true,
    mode: "orphans",
    orphans: ORPHANS,
    busy: false,
    cloudReady: true,
    onClose: () => undefined,
    onDeleteOrphan: () => undefined,
    onCleanOrphans: () => undefined,
    onCleanCloud: () => undefined,
    ...overrides,
  };
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  await act(async () => { root.render(<ResourceCleanupSheet {...props} />); });
  return { container, unmount: async () => { await act(async () => root.unmount()); container.remove(); } };
}

const buttonByText = (root: ParentNode, text: string) =>
  [...root.querySelectorAll("button")].find((el) => (el.textContent || "").trim() === text) as HTMLButtonElement | undefined;

beforeAll(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

describe("ResourceCleanupSheet", () => {
  it("未引用文件：标题带数量、逐条可删、底部可清理全部", async () => {
    const onDeleteOrphan = vi.fn();
    const onCleanOrphans = vi.fn();
    const onPreviewOrphan = vi.fn();
    const m = await mount({ onDeleteOrphan, onCleanOrphans, onPreviewOrphan });
    try {
      expect(m.container.textContent).toContain("未引用的本地文件（2）");
      expect(m.container.textContent).toContain("a.png");
      const del = m.container.querySelector('[aria-label="删除 a.png"]') as HTMLButtonElement;
      await act(async () => del.click());
      expect(onDeleteOrphan).toHaveBeenCalledWith(1);
      // 删除按钮不冒泡成「预览」
      expect(onPreviewOrphan).not.toHaveBeenCalled();
      const bulk = buttonByText(m.container, "清理全部（2）");
      expect(bulk).toBeTruthy();
      await act(async () => bulk!.click());
      expect(onCleanOrphans).toHaveBeenCalledTimes(1);
    } finally { await m.unmount(); }
  });

  it("未引用文件：点击行预览内容（图片/附件由宿主决定）", async () => {
    const onPreviewOrphan = vi.fn();
    const m = await mount({ onPreviewOrphan });
    try {
      const row = m.container.querySelector('[aria-label="预览 a.png"]') as HTMLElement;
      expect(row).toBeTruthy();
      await act(async () => row.click());
      expect(onPreviewOrphan).toHaveBeenCalledWith(expect.objectContaining({ id: 1, filename: "a.png" }));
    } finally { await m.unmount(); }
  });

  it("未引用文件：不提供预览回调时行不是可点按钮", async () => {
    const m = await mount();
    try {
      expect(m.container.querySelector('[aria-label="预览 a.png"]')).toBeNull();
    } finally { await m.unmount(); }
  });

  it("未引用文件：空态不出现清理按钮", async () => {
    const m = await mount({ orphans: [] });
    try {
      expect(m.container.textContent).toContain("没有未引用的本地文件");
      expect(buttonByText(m.container, "清理全部（0）")).toBeUndefined();
    } finally { await m.unmount(); }
  });

  it("云端清理：未预览只能点「预览」，不能真删", async () => {
    const onPreviewCloud = vi.fn();
    const onCleanCloud = vi.fn();
    const m = await mount({ mode: "cloudGc", gcMessage: "已清理 3 个对象", onPreviewCloud, onCleanCloud });
    try {
      // 保留窗口与「先预览」口径对用户可见
      expect(m.container.textContent).toContain("超过 7 天");
      expect(m.container.textContent).toContain("已清理 3 个对象");
      const previewBtn = buttonByText(m.container, "预览");
      expect(previewBtn?.disabled).toBe(false);
      const cleanBtn = buttonByText(m.container, "清理云端");
      expect(cleanBtn?.disabled).toBe(true);
      await act(async () => previewBtn!.click());
      expect(onPreviewCloud).toHaveBeenCalledTimes(1);
      expect(onCleanCloud).not.toHaveBeenCalled();
    } finally { await m.unmount(); }
  });

  it("云端清理：预览后显示将删数量/字节与保留窗口，按钮才可点", async () => {
    const onCleanCloud = vi.fn();
    const m = await mount({ mode: "cloudGc", gcPreview: { count: 3, bytes: 2048 }, onCleanCloud });
    try {
      expect(m.container.textContent).toContain("将删除 3 个对象");
      expect(m.container.textContent).toContain("2.0 KB");
      expect(m.container.textContent).toContain("保留窗口 7 天");
      const cleanBtn = buttonByText(m.container, "清理 3 个对象");
      expect(cleanBtn?.disabled).toBe(false);
      await act(async () => cleanBtn!.click());
      expect(onCleanCloud).toHaveBeenCalledTimes(1);
    } finally { await m.unmount(); }
  });

  it("云端清理：预览为 0 / 不可用 / 进行中时真删都禁用", async () => {
    const empty = await mount({ mode: "cloudGc", gcPreview: { count: 0, bytes: 0 } });
    try {
      expect(empty.container.textContent).toContain("没有可清理的云端文件");
      expect(buttonByText(empty.container, "清理云端")?.disabled).toBe(true);
      expect(buttonByText(empty.container, "预览")?.disabled).toBe(false);
    } finally { await empty.unmount(); }
    const disabled = await mount({ mode: "cloudGc", cloudReady: false, cloudHint: "未配置云同步：按纯本地空间处理，不能清理云端。", gcPreview: { count: 3, bytes: 1 } });
    try {
      expect(disabled.container.textContent).toContain("未配置云同步");
      expect(buttonByText(disabled.container, "预览")?.disabled).toBe(true);
      expect(buttonByText(disabled.container, "清理 3 个对象")?.disabled).toBe(true);
    } finally { await disabled.unmount(); }
    const busy = await mount({ mode: "cloudGc", cloudBusy: true, gcPreview: { count: 2, bytes: 1 } });
    try {
      expect(buttonByText(busy.container, "预览")?.disabled).toBe(true);
      expect(buttonByText(busy.container, "处理中…")?.disabled).toBe(true);
    } finally { await busy.unmount(); }
  });

  it("清理中禁用删除入口", async () => {
    const m = await mount({ busy: true });
    try {
      const del = m.container.querySelector('[aria-label="删除 a.png"]') as HTMLButtonElement;
      expect(del.disabled).toBe(true);
      expect(buttonByText(m.container, "清理全部（2）")?.disabled).toBe(true);
    } finally { await m.unmount(); }
  });

  it("关闭时不渲染", async () => {
    const m = await mount({ open: false });
    try {
      expect(m.container.querySelector(".mb-sheet")).toBeNull();
    } finally { await m.unmount(); }
  });
});
