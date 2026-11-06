import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  MAX_IMPORT_IMAGE_BYTES,
  MAX_MARKDOWN_FOLDER_FILES,
  describeMarkdownFile,
  isSupportedMarkdownFile,
  listMarkdownFilesInDir,
  readImportImage,
} from "./markdownImportScan.js";

/**
 * 261106 Markdown 导入：主进程侧文件发现/读取（纯 fs）。
 * 覆盖：扩展名白名单、正文读取（去 BOM）、20MB too-large、消失文件逐条 error、
 * 目录递归（隐藏/node_modules/.git 跳过、保留 relativePath、上限截断、正文总量上限）、
 * 导入图片（扩展名+魔数双校验）。
 */
const roots: string[] = [];
function tempRoot(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lake-md-scan-"));
  roots.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of roots.splice(0)) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

function write(file: string, content: string | Buffer): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

describe("扩展名白名单", () => {
  it("只认 .md / .markdown（大小写不敏感）", () => {
    for (const name of ["a.md", "b.MD", "c.markdown", "d.MarkDown"]) expect(isSupportedMarkdownFile(name), name).toBe(true);
    for (const name of ["a.txt", "b.mdx", "c.md.html", "d", "e.md.pdf"]) expect(isSupportedMarkdownFile(name), name).toBe(false);
  });
});

describe("describeMarkdownFile", () => {
  it("读 UTF-8 正文并去掉 BOM", () => {
    const root = tempRoot();
    const file = path.join(root, "笔记.md");
    write(file, "\uFEFF# 标题\n正文");
    const entry = describeMarkdownFile(file);
    expect(entry).toMatchObject({ name: "笔记.md", relativePath: "笔记.md", supported: true, size: fs.statSync(file).size });
    expect(entry.text).toBe("# 标题\n正文");
    expect(entry.error).toBeUndefined();
  });

  it("> 20MB ⇒ tooLarge 且不读正文", () => {
    const root = tempRoot();
    const file = path.join(root, "huge.md");
    write(file, "");
    fs.truncateSync(file, 20 * 1024 * 1024 + 1);
    const entry = describeMarkdownFile(file);
    expect(entry.tooLarge).toBe(true);
    expect(entry.text).toBeUndefined();
    expect(entry.size).toBe(20 * 1024 * 1024 + 1);
  });

  it("文件消失/不可读 ⇒ 该条给 error，不抛", () => {
    const entry = describeMarkdownFile(path.join(tempRoot(), "missing.md"));
    expect(entry.error).toContain("无法读取文件");
    expect(entry.size).toBe(0);
    expect(entry.text).toBeUndefined();
  });

  it("不支持扩展名照常返回（supported:false），供调用方计入跳过数", () => {
    const root = tempRoot();
    const file = path.join(root, "readme.txt");
    write(file, "hello");
    const entry = describeMarkdownFile(file);
    expect(entry.supported).toBe(false);
    expect(entry.text).toBe("hello");
  });
});

describe("listMarkdownFilesInDir：递归扫描", () => {
  function fixture(): string {
    const root = tempRoot();
    write(path.join(root, "a.md"), "# A");
    write(path.join(root, "sub", "b.markdown"), "# B");
    write(path.join(root, "sub", "deep", "c.md"), "# C");
    write(path.join(root, "sub", "ignore.txt"), "x");
    write(path.join(root, ".hidden", "d.md"), "# D");         // 隐藏目录整棵跳过
    write(path.join(root, "node_modules", "e.md"), "# E");    // 依赖目录跳过
    write(path.join(root, "tiny", ".git", "f.md"), "# F");    // .git 跳过
    fs.mkdirSync(path.join(root, "empty-dir"), { recursive: true });
    return root;
  }

  it("只收 md、保留 relativePath（/ 分隔）、跳过隐藏与依赖目录", () => {
    const root = fixture();
    const scan = listMarkdownFilesInDir(root);
    expect(scan.truncated).toBe(false);
    expect(scan.files.map((file) => file.relativePath)).toEqual(["a.md", "sub/b.markdown", "sub/deep/c.md"]);
    expect(scan.files.every((file) => file.supported && typeof file.text === "string")).toBe(true);
  });

  it("上限截断并标记 truncated", () => {
    const root = fixture();
    const scan = listMarkdownFilesInDir(root, { maxFiles: 2 });
    expect(scan.truncated).toBe(true);
    expect(scan.files).toHaveLength(2);
    expect(MAX_MARKDOWN_FOLDER_FILES).toBe(500);
  });

  it("正文总量上限：超出后不再读（该条给 error）", () => {
    const root = tempRoot();
    write(path.join(root, "a.md"), "x".repeat(600));
    write(path.join(root, "b.md"), "y".repeat(600));
    const scan = listMarkdownFilesInDir(root, { maxTextBytes: 1000 });
    expect(scan.files[0].text).toBeDefined();
    expect(scan.files[1].text).toBeUndefined();
    expect(scan.files[1].error).toContain("正文总量已达上限");
  });

  it("目录不存在 ⇒ 空结果（不抛）", () => {
    expect(listMarkdownFilesInDir(path.join(tempRoot(), "nope"))).toEqual({ files: [], truncated: false });
  });
});

describe("readImportImage：导入图片字节", () => {
  it("png：返回字节 + mime + 文件名", () => {
    const root = tempRoot();
    const file = path.join(root, "图.png");
    write(file, PNG);
    const image = readImportImage(file);
    expect(image.mimeType).toBe("image/png");
    expect(image.filename).toBe("图.png");
    expect(image.bytes.byteLength).toBe(PNG.byteLength);
  });

  it("扩展名不在白名单 ⇒ 拒绝", () => {
    const root = tempRoot();
    const file = path.join(root, "a.bmp");
    write(file, PNG);
    expect(() => readImportImage(file)).toThrowError(/不支持的图片类型/);
  });

  it("扩展名与内容不一致（魔数校验）⇒ 拒绝", () => {
    const root = tempRoot();
    const file = path.join(root, "fake.jpg");
    write(file, Buffer.from("not an image at all"));
    expect(() => readImportImage(file)).toThrowError(/魔数校验失败/);
    const pngAsJpg = path.join(root, "png-as-jpg.jpg");
    write(pngAsJpg, PNG);
    expect(() => readImportImage(pngAsJpg)).toThrowError(/扩展名与内容不一致/);
  });

  it("空文件 / 不存在 ⇒ 可读错误", () => {
    const root = tempRoot();
    const empty = path.join(root, "empty.png");
    write(empty, "");
    expect(() => readImportImage(empty)).toThrowError(/为空/);
    expect(() => readImportImage(path.join(root, "missing.png"))).toThrow();
    expect(MAX_IMPORT_IMAGE_BYTES).toBe(20 * 1024 * 1024);
  });
});
