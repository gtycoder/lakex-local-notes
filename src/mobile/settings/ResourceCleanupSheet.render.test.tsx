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
    const m = await mount({ onDeleteOrphan, onCleanOrphans });
    try {
      expect(m.container.textContent).toContain("未引用的本地文件（2）");
      expect(m.container.textContent).toContain("a.png");
      const del = m.container.querySelector('[aria-label="删除 a.png"]') as HTMLButtonElement;
      await act(async () => del.click());
      expect(onDeleteOrphan).toHaveBeenCalledWith(1);
      const bulk = buttonByText(m.container, "清理全部（2）");
      expect(bulk).toBeTruthy();
      await act(async () => bulk!.click());
      expect(onCleanOrphans).toHaveBeenCalledTimes(1);
    } finally { await m.unmount(); }
  });

  it("未引用文件：空态不出现清理按钮", async () => {
    const m = await mount({ orphans: [] });
    try {
      expect(m.container.textContent).toContain("没有未引用的本地文件");
      expect(buttonByText(m.container, "清理全部（0）")).toBeUndefined();
    } finally { await m.unmount(); }
  });

  it("云端清理：不可用时有原因且按钮禁用；可用时点击回调", async () => {
    const onCleanCloud = vi.fn();
    const disabled = await mount({ mode: "cloudGc", cloudReady: false, cloudHint: "未配置云同步：按纯本地空间处理，不能清理云端。", onCleanCloud });
    try {
      const btn = buttonByText(disabled.container, "清理云端");
      expect(btn?.disabled).toBe(true);
      expect(disabled.container.textContent).toContain("未配置云同步");
    } finally { await disabled.unmount(); }
    const ready = await mount({ mode: "cloudGc", cloudReady: true, gcMessage: "已清理 3 个对象", onCleanCloud });
    try {
      expect(ready.container.textContent).toContain("已清理 3 个对象");
      const btn = buttonByText(ready.container, "清理云端");
      expect(btn?.disabled).toBe(false);
      await act(async () => btn!.click());
      expect(onCleanCloud).toHaveBeenCalledTimes(1);
    } finally { await ready.unmount(); }
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
