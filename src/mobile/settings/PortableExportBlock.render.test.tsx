// @vitest-environment jsdom
/** 261117 D 项：设置「关于 → 卸载与换机 → 导出便携包到文件」的状态机与文案。 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ run: vi.fn() }));
vi.mock("../portable/exportPortable", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../portable/exportPortable")>();
  return { ...actual, exportPortableSnapshotToDownloads: h.run };
});

import { PortableExportBlock } from "./PortableExportBlock";

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot> | null = null;

function render() {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => { root!.render(<PortableExportBlock />); });
}
const button = (): HTMLButtonElement => host.querySelector("button")!;
const text = () => host.textContent ?? "";

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  h.run.mockReset();
  render();
});

afterEach(() => {
  act(() => { root?.unmount(); });
  host.remove();
  root = null;
  vi.unstubAllGlobals();
});

describe("PortableExportBlock", () => {
  it("入口文案：卸载前最可靠 + 下载目录 + 卸载后留存 + 明文提示", () => {
    expect(text()).toContain("卸载前最可靠");
    expect(button().textContent).toContain("导出便携包到文件");
    expect(text()).toContain("下载");
    expect(text()).toContain("仍然留存");
    expect(text()).toContain("明文");
  });

  it("进行中：按钮禁用且文案变「正在导出…」，结束后恢复", async () => {
    let resolveRun!: (value: unknown) => void;
    h.run.mockImplementation(() => new Promise((resolve) => { resolveRun = resolve; }));
    act(() => { button().dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    expect(button().disabled).toBe(true);
    expect(button().textContent).toContain("正在导出");
    await act(async () => { resolveRun({ ok: true, name: "lakex-portable-mobile-1.zip.lln", location: "Download", bytes: 1024, counts: { notes: 3, quickNotes: 1 } }); });
    expect(button().disabled).toBe(false);
    expect(button().textContent).toContain("导出便携包到文件");
  });

  it("成功：显示保存位置 + 文件名 + 文档/小记计数", async () => {
    h.run.mockResolvedValue({ ok: true, name: "lakex-portable-mobile-1.zip.lln", location: "Download", bytes: 2097152, counts: { notes: 12, quickNotes: 3 } });
    await act(async () => { button().dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    expect(text()).toContain("已保存到");
    expect(text()).toContain("Download");
    expect(text()).toContain("lakex-portable-mobile-1.zip.lln");
    expect(text()).toContain("12 篇文档");
    expect(text()).toContain("3 条小记");
  });

  it("失败：可执行错误原样给用户", async () => {
    h.run.mockResolvedValue({ ok: false, error: "保存到用户可见目录失败：磁盘空间不足（可改用桌面版导出便携包）" });
    await act(async () => { button().dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    const alert = host.querySelector("[role=alert]");
    expect(alert).toBeTruthy();
    expect(alert!.textContent).toContain("磁盘空间不足");
    expect(button().disabled).toBe(false);
  });
});
