import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

// 主进程 IPC 只用 electron 的 dialog/BrowserWindow；用 mock 隔离系统对话框。
const dialogMock = vi.hoisted(() => ({ showOpenDialog: vi.fn() }));
vi.mock("electron", () => ({
  dialog: { showOpenDialog: dialogMock.showOpenDialog },
  BrowserWindow: { getFocusedWindow: () => null, getAllWindows: () => [] },
}));

import { registerMarkdownImportIpc } from "./registerMarkdownImport.js";
import { describeMarkdownFile, listMarkdownFilesInDir } from "../markdownImportScan.js";

/**
 * 261106 Markdown 导入 IPC（pick_markdown_files / pick_markdown_folder / read_import_image）。
 * 真 fs + 假对话框：守住「取消 → 空（不抛）」「多选逐条描述」「目录递归」「图片校验」。
 */
type Handler = (...args: unknown[]) => unknown;
const roots: string[] = [];
function tempRoot(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lake-md-ipc-"));
  roots.push(dir);
  return dir;
}
afterEach(() => {
  dialogMock.showOpenDialog.mockReset();
  for (const dir of roots.splice(0)) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

function harness() {
  const handlers = new Map<string, Handler>();
  const ipc = {
    handle: (channel: string, handler: Handler) => { handlers.set(channel, handler); },
    handleEvent: (channel: string, handler: Handler) => { handlers.set(channel, handler); },
    registry: new Map(),
  };
  registerMarkdownImportIpc(ipc as unknown as Parameters<typeof registerMarkdownImportIpc>[0]);
  return {
    channels: () => [...handlers.keys()].sort(),
    call: (channel: string, ...args: unknown[]) => handlers.get(channel)!(...args),
  };
}

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

describe("registerMarkdownImportIpc：通道与取消语义", () => {
  it("注册三个通道（与 preload/WEB_METHODS 同名）", () => {
    expect(harness().channels()).toEqual(["pick_markdown_files", "pick_markdown_folder", "read_import_image"]);
  });

  it("多选文件：取消 ⇒ 空数组（不抛）", async () => {
    dialogMock.showOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] });
    const result = await harness().call("pick_markdown_files");
    expect(result).toEqual([]);
    const call = dialogMock.showOpenDialog.mock.calls[0];
    expect(call[1]).toMatchObject({ properties: ["openFile", "multiSelections"] });
    expect(JSON.stringify(call[1].filters)).toContain("markdown");
  });

  it("多选文件：逐个读取正文（不支持的扩展名也返回，供计入跳过数）", async () => {
    const root = tempRoot();
    const md = path.join(root, "a.md");
    const txt = path.join(root, "b.txt");
    fs.writeFileSync(md, "# A");
    fs.writeFileSync(txt, "hello");
    dialogMock.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: [md, txt] });
    const result = await harness().call("pick_markdown_files") as Array<Record<string, unknown>>;
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ name: "a.md", relativePath: "a.md", supported: true, text: "# A" });
    expect(result[1]).toMatchObject({ name: "b.txt", supported: false, text: "hello" });
  });

  it("选择文件夹：取消 ⇒ 空结果；选中 ⇒ 递归扫描（保留 relativePath）", async () => {
    const root = tempRoot();
    fs.mkdirSync(path.join(root, "docs", "deep"), { recursive: true });
    fs.writeFileSync(path.join(root, "a.md"), "# A");
    fs.writeFileSync(path.join(root, "docs", "deep", "b.md"), "# B");
    fs.writeFileSync(path.join(root, "docs", "skip.txt"), "x");
    dialogMock.showOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] });
    expect(await harness().call("pick_markdown_folder")).toEqual({ files: [], truncated: false });
    dialogMock.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: [root] });
    const scan = await harness().call("pick_markdown_folder") as { files: Array<Record<string, unknown>>; truncated: boolean };
    expect(scan.truncated).toBe(false);
    expect(scan.files.map((file) => file.relativePath)).toEqual(["a.md", "docs/deep/b.md"]);
  });
});

describe("registerMarkdownImportIpc：read_import_image", () => {
  it("读 png 字节（含 mime/文件名）", () => {
    const root = tempRoot();
    const file = path.join(root, "图.png");
    fs.writeFileSync(file, PNG);
    const image = harness().call("read_import_image", file) as { bytes: Uint8Array; mimeType: string; filename: string };
    expect(image.mimeType).toBe("image/png");
    expect(image.filename).toBe("图.png");
    expect(image.bytes.byteLength).toBe(PNG.byteLength);
  });

  it("非法参数 / 非图片 ⇒ 抛可读错误", () => {
    const h = harness();
    expect(() => h.call("read_import_image", "")).toThrowError(/路径无效/);
    expect(() => h.call("read_import_image", 42)).toThrowError(/路径无效/);
    const root = tempRoot();
    const txt = path.join(root, "a.png");
    fs.writeFileSync(txt, "not an image");
    expect(() => h.call("read_import_image", txt)).toThrowError(/魔数校验失败/);
  });
});

describe("主进程扫描函数（被 IPC 复用）", () => {
  it("describeMarkdownFile / listMarkdownFilesInDir 在临时目录上的口径与 IPC 一致", () => {
    const root = tempRoot();
    fs.writeFileSync(path.join(root, "x.markdown"), "# X");
    expect(describeMarkdownFile(path.join(root, "x.markdown")).text).toBe("# X");
    expect(listMarkdownFilesInDir(root).files.map((file) => file.name)).toEqual(["x.markdown"]);
  });
});
