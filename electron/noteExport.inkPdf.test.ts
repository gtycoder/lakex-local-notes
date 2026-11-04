/**
 * 手写板（kind=ink）导出 PDF 的**内容准备**测试（不跑 printToPDF：那需要 Electron 隐藏窗口）。
 *
 * 覆盖：逐页 A4 结构 / 多页分页 / 背景图 data URI（fit + pixel 提示）/ 缺图 skipped /
 * 矢量笔迹 path（pen 实心、highlighter opacity .3 + multiply）/ 无背景图白底 /
 * kind 分流（ink 的 pdf 内容准备成功，markdown/html/docx 仍拒绝）/ UI 与 export.ts 静态契约。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { localAssetHttpUrl } from "../src/core/assetUrl.js";
import { createInkDoc, createInkPage, inkToBody, parseInkBody, type InkDoc } from "../src/core/inkDoc.js";
import { Store } from "./store.js";
import { createSafeStorageSecretCipher } from "./secretCipher.js";
import { INK_PDF_PRINT_CSS, buildInkPageSvg, buildInkPdfBody, inkBackgroundFitCss } from "./noteExport.js";

const electronMock = vi.hoisted(() => {
  const secrets = new Map<string, string>();
  return {
    secrets,
    encryptString: (value: string) => {
      const id = crypto.randomUUID();
      secrets.set(id, value);
      return Buffer.from(id);
    },
    decryptString: (buf: Buffer) => secrets.get(buf.toString()) ?? "",
  };
});

vi.mock("electron", () => ({
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: electronMock.encryptString,
    decryptString: electronMock.decryptString,
  },
  net: { fetch: vi.fn() },
}));

const read = (rel: string): string => fs.readFileSync(new URL(rel, import.meta.url), "utf8");

function twoPageDoc(): InkDoc {
  const doc = createInkDoc("p1");
  doc.pages[0] = {
    ...doc.pages[0],
    backgroundImage: { url: localAssetHttpUrl("n1", "1700000000000_abcdef12.png"), fit: "cover", pixelWidth: 1600, pixelHeight: 2263 },
    strokes: [{ id: "s1", tool: "pen", color: "#112233", width: 2, points: [{ x: 10, y: 10, pressure: 0.5 }, { x: 60, y: 40, pressure: 0.5 }] }],
  };
  doc.pages.push({
    ...createInkPage("p2", "blank"),
    strokes: [{ id: "s2", tool: "highlighter", color: "#ffcc00", width: 18, points: [{ x: 20, y: 20, pressure: 0.5 }, { x: 120, y: 30, pressure: 0.5 }] }],
  });
  doc.activePageId = "p2";
  return doc;
}

describe("buildInkPdfBody（纯内容准备）", () => {
  it("每页一块 A4 比例画布 + 强制分页；笔迹 SVG 用页面逻辑坐标 viewBox", () => {
    const { bodyHtml } = buildInkPdfBody(twoPageDoc(), { imageDataUri: () => null });
    expect(bodyHtml).toContain('<div class="ink-pdf">');
    expect((bodyHtml.match(/class="ink-page"/g) ?? []).length).toBe(2);
    expect(bodyHtml).toContain('data-page="1"');
    expect(bodyHtml).toContain('viewBox="0 0 794 1123"');
    expect(bodyHtml).toContain('preserveAspectRatio="xMidYMid meet"');
    // A4 页面结构与分页规则
    expect(INK_PDF_PRINT_CSS).toContain("width: 210mm");
    expect(INK_PDF_PRINT_CSS).toContain("aspect-ratio: 210 / 297");
    expect(INK_PDF_PRINT_CSS).toContain("page-break-after: always");
    // pen：实心 path（无高亮 opacity）
    expect(bodyHtml).toMatch(/<path d="M [\d.]+ [\d.]+(?: L [\d.]+ [\d.]+)+ Z" fill="#112233" \/>/);
    // highlighter：opacity .3 + mix-blend-mode multiply
    expect(bodyHtml).toMatch(/fill="#ffcc00" opacity="0\.3" style="mix-blend-mode:multiply"/);
  });

  it("背景图 data URI 内嵌（fit→object-fit，pixel 尺寸仅带提示属性）", () => {
    const uri = "data:image/png;base64,AAAA";
    const { bodyHtml, imageCount, skipped } = buildInkPdfBody(twoPageDoc(), { imageDataUri: () => uri });
    expect(imageCount).toBe(1);
    expect(skipped).toBe(0);
    expect(bodyHtml).toContain('class="ink-page__bg"');
    expect(bodyHtml).toContain(`src="${uri}"`);
    expect(bodyHtml).toContain("object-fit:cover");
    expect(bodyHtml).toContain('data-pixel-width="1600"');
    expect(bodyHtml).toContain('data-pixel-height="2263"');
  });

  it("缺图：skipped++、不渲染 img，但页与笔迹照常输出（不产出空白页）", () => {
    const { bodyHtml, imageCount, skipped } = buildInkPdfBody(twoPageDoc(), { imageDataUri: () => null });
    expect(imageCount).toBe(0);
    expect(skipped).toBe(1);
    expect(bodyHtml).not.toContain("ink-page__bg");
    expect(bodyHtml).toMatch(/fill="#112233"/);
  });

  it("无背景图的页是白底（不画纸张底纹/不渲染 img）", () => {
    const doc = createInkDoc("p1");
    const { bodyHtml, imageCount } = buildInkPdfBody(doc, { imageDataUri: () => "data:image/png;base64,AAAA" });
    expect(imageCount).toBe(0);
    expect(bodyHtml).not.toContain("ink-page__bg");
    expect(bodyHtml).not.toContain("pattern");
  });

  it("fit 映射：contain/cover/stretch", () => {
    expect(inkBackgroundFitCss(undefined)).toBe("contain");
    expect(inkBackgroundFitCss("contain")).toBe("contain");
    expect(inkBackgroundFitCss("cover")).toBe("cover");
    expect(inkBackgroundFitCss("stretch")).toBe("fill");
  });
});

describe("NoteExport 的 ink PDF 内容准备 + kind 守卫", () => {
  let dir: string;
  let store: Store;
  let outDir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "lake-ink-pdf-test-"));
    electronMock.secrets.clear();
    store = new Store(dir, createSafeStorageSecretCipher());
    outDir = fs.mkdtempSync(path.join(os.tmpdir(), "lake-ink-pdf-out-"));
  });

  function makeInkNote(): { id: string } {
    const note = store.createInkIn(null, "手写测试");
    const paths = store.getNotePaths(note.id);
    const filename = "1700000000000_abcdef12.png";
    fs.mkdirSync(paths.assetsDir, { recursive: true });
    fs.writeFileSync(path.join(paths.assetsDir, filename), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    const doc = twoPageDoc();
    doc.pages[0] = { ...doc.pages[0], backgroundImage: { url: localAssetHttpUrl(note.id, filename), fit: "contain" } };
    fs.mkdirSync(path.dirname(paths.lakePath), { recursive: true });
    fs.writeFileSync(paths.lakePath, inkToBody(doc), "utf8");
    return { id: note.id };
  }

  it("ink 的 PDF 内容准备成功：两页 HTML + 背景图 data URI 内嵌，产出唯一 pdf 路径", async () => {
    const { id } = makeInkNote();
    const prep = await store.exportPdfHtml(id, outDir);
    const html = fs.readFileSync(prep.htmlPath, "utf8");
    expect(html).toContain('class="ink-pdf"');
    expect((html.match(/class="ink-page"/g) ?? []).length).toBe(2);
    expect(html).toContain("base64,");
    // 压平后的 HTML 不依赖资产服务器：背景图全部内嵌 data URI（无 http://127.0.0.1 引用）
    expect(html).not.toContain("http://127.0.0.1");
    expect(prep.imageCount).toBe(1);
    expect(prep.skipped).toBe(0);
    expect(prep.pdfPath.endsWith(".pdf")).toBe(true);
    expect(fs.existsSync(prep.tempDir)).toBe(true);
    fs.rmSync(prep.tempDir, { recursive: true, force: true });
  });

  it("markdown / html / docx 对 ink 仍拒绝，提示只保留 PDF", async () => {
    const { id } = makeInkNote();
    expect(() => store.exportNotePackage(id)).toThrow(/手写板/);
    expect(() => store.exportNotePackage(id)).toThrow(/仅支持导出 PDF/);
    expect(() => store.exportNotePackage(id)).toThrow(/Markdown\/HTML\/资料包/);
    expect(() => store.exportHtmlNote(id)).toThrow(/手写板/);
    await expect(store.exportDocxNote(id)).rejects.toThrow(/手写板/);
    // PDF 内容准备本身成功（唯一对 ink 放开的格式）
    const prep = await store.exportPdfHtml(id);
    expect(fs.existsSync(prep.htmlPath)).toBe(true);
    fs.rmSync(prep.tempDir, { recursive: true, force: true });
  });

  it("页图内嵌前转 JPEG（sharp）：HTML 里是 data:image/jpeg", async () => {
    const note = store.createInkIn(null, "JPEG 手写");
    const paths = store.getNotePaths(note.id);
    const filename = "1700000000200_deadbeef.png";
    fs.mkdirSync(paths.assetsDir, { recursive: true });
    // 真实可解码的 1×1 PNG（假的 4 字节头会让 sharp 转码失败、退回原始 mime）
    fs.writeFileSync(path.join(paths.assetsDir, filename), Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64"));
    const doc = twoPageDoc();
    doc.pages[0] = { ...doc.pages[0], backgroundImage: { url: localAssetHttpUrl(note.id, filename), fit: "contain" } };
    fs.mkdirSync(path.dirname(paths.lakePath), { recursive: true });
    fs.writeFileSync(paths.lakePath, inkToBody(doc), "utf8");
    const prep = await store.exportPdfHtml(note.id, outDir);
    const html = fs.readFileSync(prep.htmlPath, "utf8");
    expect(html).toContain("data:image/jpeg;base64,");
    fs.rmSync(prep.tempDir, { recursive: true, force: true });
  });

  it("单页 SVG 读取：只产出请求的那一页（标题可直接当文件名）", async () => {
    const { id } = makeInkNote();
    const doc = parseInkBody(store.readNote(id).content as string);
    expect(doc).not.toBeNull();
    const page = await store.readInkPageSvg(id, [doc!.pages[1].id]);
    expect(page.svg).toContain("<svg");
    expect(page.width).toBeGreaterThan(0);
    expect(page.title).toContain("手写测试");
  });
});


describe("261104 十七批：底纹 / 单页过滤 / 页图 JPEG / 独立 SVG", () => {
  it("有底纹的页印底纹（pattern + rect），blank 页不印", () => {
    const doc = twoPageDoc();
    doc.pages[0] = { ...doc.pages[0], background: "grid" };
    const { bodyHtml } = buildInkPdfBody(doc, { imageDataUri: () => null });
    expect(bodyHtml).toContain("ink-page__paper");
    expect(bodyHtml).toContain("<pattern");
    expect((bodyHtml.match(/ink-page__paper/g) ?? []).length).toBe(1);
  });

  it("v4 页内贴图：HTML 里逐张 <img class=ink-page__img>（百分比定位 + 旋转），缺图计 skipped", () => {
    const doc = twoPageDoc();
    doc.pages[0] = {
      ...doc.pages[0],
      images: [{ id: "i1", url: localAssetHttpUrl("n1", "1700000000100_abcdef13.png"), x: 100, y: 200, width: 397, height: 200, rotation: 15 }],
    };
    const withUri = buildInkPdfBody(doc, { imageDataUri: () => "data:image/jpeg;base64,AAAA" });
    expect(withUri.bodyHtml).toContain('class="ink-page__img"');
    expect(withUri.bodyHtml).toContain("rotate(15deg)");
    expect(withUri.bodyHtml).toContain("left:12.594458438287154%");
    expect(withUri.imageCount).toBe(2); // 背景图 1 + 贴图 1
    const without = buildInkPdfBody(doc, { imageDataUri: () => null });
    expect(without.skipped).toBe(2);
    expect(without.bodyHtml).not.toContain("ink-page__img");
  });

  it("v4 页内文字块：HTML 与独立 SVG 里都渲染成 <text>/<tspan>（换行与屏幕同一份估算）", () => {
    const doc = twoPageDoc();
    doc.pages[0] = {
      ...doc.pages[0],
      texts: [{ id: "t1", x: 100, y: 150, width: 200, fontSize: 20, color: "#262626", text: "第一行重点" }],
    };
    const html = buildInkPdfBody(doc, { imageDataUri: () => null }).bodyHtml;
    expect(html).toContain("<text ");
    expect(html).toContain("第一行重点");
    expect(html).toContain("<tspan");
    const svg = buildInkPageSvg(doc.pages[0], 0, { imageDataUri: () => null });
    expect(svg).toContain("<text ");
    expect(svg).toContain("第一行重点");
    // 文本转义：& < > 不能破坏 SVG
    doc.pages[0].texts = [{ id: "t2", x: 0, y: 0, width: 300, fontSize: 16, color: "#000", text: "a & b <c>" }];
    const escaped = buildInkPageSvg(doc.pages[0], 0, { imageDataUri: () => null });
    expect(escaped).toContain("a &amp; b &lt;c&gt;");
  });

  it("pageIds 只导出指定页（按原文顺序）", () => {
    const doc = twoPageDoc();
    const second = doc.pages[1].id;
    const { bodyHtml } = buildInkPdfBody(doc, { imageDataUri: () => null }, { pageIds: [second] });
    expect((bodyHtml.match(/class="ink-page"/g) ?? []).length).toBe(1);
    expect(bodyHtml).toContain('data-page="2"');
  });

  it("单页独立 SVG：自包含（页图 data URI + 笔迹 + 尺寸 = 页面逻辑尺寸）", () => {
    const page = twoPageDoc().pages[0];
    const svg = buildInkPageSvg(page, 0, { imageDataUri: () => "data:image/jpeg;base64,AAAA" });
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain("viewBox=");
    expect(svg).toContain("data:image/jpeg;base64,AAAA");
    expect(svg).toContain("<path");
    expect(svg).not.toContain("http://127.0.0.1");
  });

});

describe("静态契约：export.ts 分流 + UI 只对 ink 放开 PDF", () => {
  it("export.ts 的 pdf 分支注明按 kind 分流并走 NoteExport.exportPdfHtml", () => {
    const src = read("./export.ts");
    expect(src).toContain("内容准备按 kind 分流");
    expect(src).toContain("store.exportPdfHtml(id, baseDir, options)");
    expect(src).toContain("ink = 逐页压平");
  });

  it("NoteExport 里 ink 走 exportInkPdfHtml，非 ink 才 assertDocKind", () => {
    const src = read("./noteExport.ts");
    expect(src).toContain("exportInkPdfHtml(");
    expect(src).toContain('if ((kindRow?.kind ?? "doc") === "ink") return this.exportInkPdfHtml(id, baseDir, options);');
    expect(src).toContain("strokeToSvgPath");
    // perfect-freehand 必须在 dependencies（main 的 external 从 dependencies 派生）
    const pkg = JSON.parse(read("../package.json")) as { dependencies?: Record<string, string> };
    expect(pkg.dependencies?.["perfect-freehand"]).toBeTruthy();
  });

  it("导出菜单：ink 只有「导出为 PDF（手写压平）」", () => {
    const src = read("../src/components/ui/ExportSubmenuItem.tsx");
    expect(src).toMatch(/type === "ink"/);
    expect(src).toContain("导出为 PDF（手写压平）");
    // ink 分支里的 pdf 动作
    expect(src).toMatch(/type === "ink"[\s\S]{0,200}onExportAs\("pdf"\)/);
    // ink 不再走不存在的 markdown/html/docx 导出
    expect(src).not.toMatch(/type === "ink"[\s\S]{0,200}onExportAs\("docx"\)/);
  });
});
