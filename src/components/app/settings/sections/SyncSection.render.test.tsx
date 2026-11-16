// @vitest-environment jsdom
/**
 * 「云端与同步 → S3 对象存储」261116 用户验收（对标新版思源）回归：
 * ① 设置页里只剩一行「同步服务配置」+ 右侧竖排 设置/导入/导出（字段不再常驻，旧 data-set-id 必须消失）；
 * ② 点「设置」开 NativeDialog，字段都在弹窗里，且弹窗内**没有** data-set-id（搜索锚点只认常驻行）；
 * ③ 取消 / Esc（cancel 事件）不保存即关闭；保存调既有 saveS3 后关闭；测试连接不关闭；
 * ④ 粘贴迁移码仍走既有 setS3ImportOpen；行内「导入/导出」走既有 importS3ConfigFile / exportS3ConfigFile。
 * 注：只用 document 查询（NativeDialog 是 portal 到 body 的原生 <dialog>）。
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SyncSection } from "./SyncSection";
import type { SettingsPanelContext } from "../useSettingsPanelScope";

const s3Defaults = {
  endpoint: "https://s3-cn-east-1.qiniucs.com",
  accessKeyId: "ak-1",
  secretAccessKey: "********",
  bucket: "lake-bucket",
  region: "cn-east-1",
  prefix: "notes/",
  forcePathStyle: false,
};

function makeContext(overrides: Partial<Record<string, unknown>> = {}) {
  const spy = () => vi.fn(async () => {});
  return {
    cloudConfigured: true,
    cloudOffline: false,
    cloudState: "auto",
    copySyncDiagnostics: spy(),
    exportS3ConfigFile: spy(),
    importS3ConfigFile: spy(),
    gcCfg: null,
    gcLog: [],
    gcRun: { busy: false },
    runGcAction: spy(),
    s3: s3Defaults,
    s3Verified: true,
    saveGcCfg: spy(),
    saveS3: spy(),
    saveSyncCfg: spy(),
    setS3Field: vi.fn(),
    setS3ImportOpen: vi.fn(),
    setSyncGateAlert: vi.fn(),
    setSyncMsg: vi.fn(),
    syncCfg: null,
    syncMsg: null,
    syncDiagMsg: null,
    syncDiagText: null,
    syncGateAlert: null,
    testS3: spy(),
    ...overrides,
  } as unknown as SettingsPanelContext;
}

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  document.querySelectorAll("dialog").forEach((d) => d.remove());
});

const renderSection = (ctx: SettingsPanelContext) => act(() => root.render(createElement(SyncSection, { c: ctx })));
const dialog = () => document.querySelector<HTMLDialogElement>("dialog.s3-config-dialog");
const buttonIn = (scope: ParentNode, text: string): HTMLButtonElement => {
  const found = [...scope.querySelectorAll<HTMLButtonElement>("button")].find((btn) => (btn.textContent ?? "").trim() === text);
  if (!found) throw new Error("找不到按钮：" + text);
  return found;
};
const click = async (btn: HTMLButtonElement) => { await act(async () => { btn.click(); }); };

describe("云端与同步 · S3 行（261116 用户验收）", () => {
  it("只剩一行常驻「同步服务配置」：显示 endpoint · bucket，右侧竖排 设置/导入/导出", () => {
    renderSection(makeContext());
    const row = host.querySelector('[data-set-id="s3-config"]')!;
    expect(row).not.toBeNull();
    expect(row.textContent).toContain("同步服务配置");
    expect(row.textContent).toContain("https://s3-cn-east-1.qiniucs.com");
    expect(row.textContent).toContain("lake-bucket");
    const col = row.querySelector(".settings-ctl-col")!;
    expect(col).not.toBeNull();
    expect([...col.querySelectorAll("button")].map((b) => (b.textContent ?? "").trim())).toEqual(["设置", "导入", "导出"]);
    // 字段不再常驻：旧锚点全部消失（否则 settingsSearch.test 的 id↔data-set-id 一致性会红）
    for (const id of ["s3-endpoint", "s3-access-key", "s3-secret-key", "s3-bucket", "s3-region", "s3-prefix", "s3-path-style", "s3-connection", "s3-transfer"]) {
      expect(host.querySelector('[data-set-id="' + id + '"]'), id).toBeNull();
    }
  });

  it("未配置时行内说明给指路文案（不是空白）", () => {
    renderSection(makeContext({ cloudConfigured: false }));
    expect(host.querySelector('[data-set-id="s3-config"]')!.textContent).toContain("还没有配置 S3 同步服务");
  });

  it("点「设置」打开弹窗：7 个字段都在弹窗里，且弹窗内没有 data-set-id", async () => {
    const ctx = makeContext();
    renderSection(ctx);
    await click(buttonIn(host.querySelector('[data-set-id="s3-config"]')!, "设置"));
    const dlg = dialog()!;
    expect(dlg).not.toBeNull();
    expect(dlg.getAttribute("aria-label")).toBe("同步服务配置");
    expect(dlg.querySelector(".ln-dialog__title")!.textContent).toBe("同步服务配置");
    const labels = [...dlg.querySelectorAll<HTMLInputElement>("input")].map((input) => input.getAttribute("aria-label"));
    expect(labels).toEqual(["Endpoint", "Access Key", "Secret Key", "Bucket", "Region", "对象前缀"]);
    expect(dlg.querySelector('[role="switch"]')!.getAttribute("aria-label")).toBe("使用 Path-style URL");
    expect(dlg.querySelector("[data-set-id]")).toBeNull();
    // 底部动作：粘贴迁移码（保留既有能力）+ 测试连接 + 取消 + 保存
    expect([...dlg.querySelectorAll(".ln-dialog__actions button")].map((b) => (b.textContent ?? "").trim()))
      .toEqual(["粘贴迁移码…", "测试连接", "取消", "保存"]);
  });

  it("测试连接：调既有 testS3，弹窗保持打开", async () => {
    const ctx = makeContext();
    renderSection(ctx);
    await click(buttonIn(host.querySelector('[data-set-id="s3-config"]')!, "设置"));
    await click(buttonIn(dialog()!, "测试连接"));
    expect((ctx as unknown as { testS3: () => void }).testS3).toHaveBeenCalledTimes(1);
    expect(dialog()).not.toBeNull();
  });

  it("取消：不调 saveS3，直接关闭", async () => {
    const ctx = makeContext();
    renderSection(ctx);
    await click(buttonIn(host.querySelector('[data-set-id="s3-config"]')!, "设置"));
    await click(buttonIn(dialog()!, "取消"));
    expect((ctx as unknown as { saveS3: () => void }).saveS3).not.toHaveBeenCalled();
    expect(dialog()).toBeNull();
  });

  it("Esc（原生 dialog 的 cancel 事件）：同样不保存即关闭", async () => {
    const ctx = makeContext();
    renderSection(ctx);
    await click(buttonIn(host.querySelector('[data-set-id="s3-config"]')!, "设置"));
    const dlg = dialog()!;
    await act(async () => { dlg.dispatchEvent(new Event("cancel", { cancelable: true })); });
    expect((ctx as unknown as { saveS3: () => void }).saveS3).not.toHaveBeenCalled();
    expect(dialog()).toBeNull();
  });

  it("保存：调既有 saveS3，完成后关闭弹窗", async () => {
    const ctx = makeContext();
    renderSection(ctx);
    await click(buttonIn(host.querySelector('[data-set-id="s3-config"]')!, "设置"));
    await click(buttonIn(dialog()!, "保存"));
    expect((ctx as unknown as { saveS3: () => void }).saveS3).toHaveBeenCalledTimes(1);
    expect(dialog()).toBeNull();
  });

  it("粘贴迁移码仍走既有 setS3ImportOpen（能力不丢），同一批提交里关本弹窗再开迁移码弹窗", async () => {
    const ctx = makeContext();
    renderSection(ctx);
    await click(buttonIn(host.querySelector('[data-set-id="s3-config"]')!, "设置"));
    await click(buttonIn(dialog()!, "粘贴迁移码…"));
    // 261116 根因修复后不再需要「两段提交」绕行（ui/Overlay 的 pickPortalHost 已稳定外层 host）；
    // 这里仍是同一批里关本弹窗 + 开迁移码弹窗，避免两个原生模态叠在栈里。
    expect(dialog()).toBeNull();
    expect((ctx as unknown as { setS3ImportOpen: (v: boolean) => void }).setS3ImportOpen).toHaveBeenCalledWith(true);
  });

  it("行内「导入 / 导出」分别调既有 importS3ConfigFile / exportS3ConfigFile", async () => {
    const ctx = makeContext();
    renderSection(ctx);
    const row = host.querySelector('[data-set-id="s3-config"]')!;
    await click(buttonIn(row, "导入"));
    await click(buttonIn(row, "导出"));
    expect((ctx as unknown as { importS3ConfigFile: () => void }).importS3ConfigFile).toHaveBeenCalledTimes(1);
    expect((ctx as unknown as { exportS3ConfigFile: () => void }).exportS3ConfigFile).toHaveBeenCalledTimes(1);
  });

  it("字段改动仍走既有 setS3Field（s3Verified 失效判据在那边，不在 UI 层复制）", async () => {
    const ctx = makeContext();
    renderSection(ctx);
    await click(buttonIn(host.querySelector('[data-set-id="s3-config"]')!, "设置"));
    const endpoint = dialog()!.querySelector<HTMLInputElement>('input[aria-label="Endpoint"]')!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(endpoint, "https://s3.example.com");
      endpoint.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect((ctx as unknown as { setS3Field: (k: string, v: string) => void }).setS3Field).toHaveBeenCalledWith("endpoint", "https://s3.example.com");
  });
});
