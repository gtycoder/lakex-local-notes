import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import sharp from "sharp";
import type { DbLike } from "./dbLike.js";
import { AppError } from "../src/core/storeErrors.js";
import { isSafePathSegment, sanitizeFileName } from "../src/core/storeUtils.js";
import { mdToHtml, wrapHtmlPage } from "../src/core/mdToHtml.js";
import { mimeTypeForFilename } from "../src/core/assetNaming.js";
import { ASSET_PORT } from "./assetServer.js";
import { bitableAttachments, parseBitableBody } from "../src/core/bitableDoc.js";
import { bitableTableCsv, csvFileNameFor } from "../src/core/bitableCsv.js";
import { parseUsheetBody } from "../src/core/usheetDoc.js";
import { usheetSheetCsv } from "../src/core/usheetCsv.js";
import { buildUsheetXlsx } from "./usheetXlsxExport.js";
import { collectMarkdownImageSources, markdownToDocx, type DocxImage } from "../src/core/docx.js";
import { parseLocalAssetUrl } from "../src/core/assetUrl.js";
import { ZipWriter } from "../src/core/zipArchive.js";

/** 同名附件归档时的去重后缀：a.pdf → a (2).pdf。 */
function withSuffix(name: string, n: number): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(0, dot) + " (" + n + ")" + name.slice(dot) : name + " (" + n + ")";
}

/**
 * W-3：资产服务器 URL 提取正则工厂。端口跟随 ASSET_PORT（LAKE_ASSET_PORT 可覆盖，
 * 多端同机双开），此前硬编码 19876 会在端口覆盖时让导出静默丢失全部图片。
 */
export function localAssetLakeSrcRe(port: number): RegExp {
  return new RegExp(`^http://127\\.0\\.0\\.1:${port}/([^/]+)/([^/]+)$`);
}
export function localAssetHtmlImgRe(port: number): RegExp {
  return new RegExp(`<img[^>]*src="(http://127\\.0\\.0\\.1:${port}/([^/]+)/([^/"\\s]+))"`, "g");
}
export function localAssetMdImgRe(port: number): RegExp {
  return new RegExp(`!\\[[^\\]]*\\]\\((http://127\\.0\\.0\\.1:${port}/([^/)]+)/([^/)]+))\\)`, "g");
}

/** 导出上下文：DB + 路径 + 缓存读取（由 Store 装配）。 */
export interface NoteExportContext {
  db: DbLike;
  /** .lake 正文文件绝对路径 */
  notePathFor: (noteId: string) => string;
  /** workspace 级资产根目录（note-assets/） */
  noteAssetsDir: string;
  /** 读取笔记缓存（markdown/plain） */
  readNoteCaches: (noteId: string) => { markdown: string | null; plain: string | null };
}

/**
 * 文档导出域（HTML / Markdown 资料包 / 多维表 CSV）。
 * 从事务语义到 SQL 全部原样迁移自 Store（REFACTOR：只搬家不改行为）。
 */
export class NoteExport {
  private readonly ctx: NoteExportContext;

  constructor(ctx: NoteExportContext) {
    this.ctx = ctx;
  }

  /** 唯一导出目录（{base}/{title}，重名自动 -2/-3 后缀）。 */
  private uniqueExportDir(base: string, title: string): string {
    let exportDir = path.join(base, title);
    let suffix = 2;
    while (fs.existsSync(exportDir)) {
      exportDir = path.join(base, `${title}-${suffix}`);
      suffix++;
    }
    return exportDir;
  }

  /** 默认导出根目录（桌面 lakex-local-notes-导出）。 */
  private defaultExportBase(): string {
    return path.join(os.homedir(), "Desktop", "lakex-local-notes-导出");
  }

  /**
   * D01：导出多维表**活动数据表**为 CSV（UTF-8 BOM + CRLF，Excel 通用）。
   * 只读 / 锁定文档也允许导出（导出不改数据）；非多维表明确拒绝。
   */
  exportBitableCsv(id: string, baseDir?: string): { exportPath: string; rowCount: number; size: number } {
    if (!isSafePathSegment(id)) throw new AppError("InvalidInput", `无效的笔记 ID: ${id}`);
    const row = this.ctx.db.prepare("SELECT title, kind FROM notes WHERE id=?").get(id) as { title?: string; kind?: string | null } | undefined;
    if ((row?.kind ?? "doc") !== "bitable") throw new AppError("InvalidInput", "该文档不是多维表，无法导出 CSV");
    const bodyPath = this.ctx.notePathFor(id);
    if (!fs.existsSync(bodyPath)) throw new AppError("NotFound", `笔记不存在: ${id}`);
    const doc = parseBitableBody(fs.readFileSync(bodyPath, "utf8"));
    if (!doc || doc.tables.length === 0) throw new AppError("InvalidInput", "多维表正文为空，无可导出的数据表");
    const table = doc.tables.find((t) => t.id === doc.activeTableId) ?? doc.tables[0];
    const csv = bitableTableCsv(table, { tables: doc.tables });
    const title = sanitizeFileName(row?.title ?? "未命名");
    const base = baseDir ?? this.defaultExportBase();
    fs.mkdirSync(base, { recursive: true });
    const stem = `${title} - ${csvFileNameFor(table).replace(/\.csv$/, "")}`;
    const exportPath = this.uniqueExportFile(base, stem, "csv");
    fs.writeFileSync(exportPath, csv, "utf8");
    return { exportPath, rowCount: table.records.length, size: csv.length };
  }

  /**
   * 文档（doc）：导出 Word（.docx）。
   * 图片：本地资产读盘；webp 等 Word 不稳的格式用 sharp 转 png；图片尺寸用于按比例缩到 ≤600px 宽。
   * 解析/转换失败的图片不阻断导出，计入 skipped（结果提示里明说）。
   */
  async exportDocxNote(id: string, baseDir?: string): Promise<{ exportPath: string; imageCount: number; skipped: number; size: number }> {
    if (!isSafePathSegment(id)) throw new AppError("InvalidInput", `无效的笔记 ID: ${id}`);
    this.assertDocKind(id);
    const caches = this.ctx.readNoteCaches(id);
    const markdown = caches.markdown ?? "";
    if (!markdown.trim()) throw new AppError("InvalidInput", "该文档还没有文本缓存，请先打开并保存一次");
    const images = new Map<string, DocxImage>();
    for (const src of collectMarkdownImageSources(markdown)) {
      const ref = parseLocalAssetUrl(src);
      if (!ref || ref.space !== "note" || ref.staging) continue;
      if (!isSafePathSegment(ref.noteId) || !isSafePathSegment(ref.filename)) continue;
      const file = path.join(this.ctx.noteAssetsDir, ref.noteId, ref.filename);
      try {
        if (!fs.existsSync(file)) continue;
        const ext = path.extname(ref.filename).toLowerCase();
        if (ext === ".png" || ext === ".jpg" || ext === ".jpeg" || ext === ".gif") {
          const meta = await sharp(file).metadata();
          if (!meta.width || !meta.height) continue;
          images.set(src, {
            bytes: new Uint8Array(fs.readFileSync(file)),
            extension: ext === ".png" ? "png" : ext === ".gif" ? "gif" : "jpeg",
            width: meta.width,
            height: meta.height,
          });
        } else {
          const converted = await sharp(file).png().toBuffer({ resolveWithObject: true });
          images.set(src, { bytes: new Uint8Array(converted.data), extension: "png", width: converted.info.width, height: converted.info.height });
        }
      } catch {
        // 单张图失败：跳过（result.skipped 会计数并提示），不影响整篇导出。
      }
    }
    const result = markdownToDocx(markdown, (src) => images.get(src) ?? null);
    const titleRow = this.ctx.db.prepare("SELECT title FROM notes WHERE id=?").get(id) as { title: string } | undefined;
    const title = sanitizeFileName(titleRow?.title ?? "未命名");
    const base = baseDir ?? this.defaultExportBase();
    fs.mkdirSync(base, { recursive: true });
    const exportPath = this.uniqueExportFile(base, title, "docx");
    fs.writeFileSync(exportPath, Buffer.from(result.bytes));
    return { exportPath, imageCount: result.imageCount, skipped: result.skippedImages, size: result.bytes.byteLength };
  }

  /**
   * 表格（usheet）：导出某一张工作表为 CSV（UTF-8 BOM + CRLF，Excel 通用）。
   * 工作表选择：渲染层给了活动 sheetId 就用它，否则回退 sheetOrder 第一张（结果带表名，UI 会明确导的是哪张）。
   * 空工作表**明确报错**，不产出一个空文件让用户以为成功。
   */
  exportUsheetCsv(id: string, baseDir?: string, sheetId?: string): { exportPath: string; rowCount: number; sheetName: string; size: number } {
    if (!isSafePathSegment(id)) throw new AppError("InvalidInput", `无效的笔记 ID: ${id}`);
    const row = this.ctx.db.prepare("SELECT title, kind FROM notes WHERE id=?").get(id) as { title?: string; kind?: string | null } | undefined;
    if ((row?.kind ?? "doc") !== "usheet") throw new AppError("InvalidInput", "该文档不是表格，无法导出 CSV");
    const bodyPath = this.ctx.notePathFor(id);
    if (!fs.existsSync(bodyPath)) throw new AppError("NotFound", `笔记不存在: ${id}`);
    const doc = parseUsheetBody(fs.readFileSync(bodyPath, "utf8"));
    if (!doc) throw new AppError("InvalidInput", "表格正文为空或无法解析，无可导出的数据");
    const result = usheetSheetCsv(doc.workbook, sheetId);
    if (!result.csv) throw new AppError("InvalidInput", `工作表「${result.sheetName}」为空，没有可导出的数据`);
    const title = sanitizeFileName(row?.title ?? "未命名");
    const base = baseDir ?? this.defaultExportBase();
    fs.mkdirSync(base, { recursive: true });
    const stem = `${title} - ${sanitizeFileName(result.sheetName)}`;
    const exportPath = this.uniqueExportFile(base, stem, "csv");
    fs.writeFileSync(exportPath, result.csv, "utf8");
    return { exportPath, rowCount: result.rowCount, sheetName: result.sheetName, size: result.csv.length };
  }

  /**
   * 表格（usheet）：导出全部工作表为 Excel（.xlsx，多工作表 + 图片内嵌）。
   * 语义映射在 core/usheetExcel.ts；写库在 electron/usheetXlsxExport.ts（write-excel-file）。
   * 所有工作表都为空 ⇒ 明确报错，不产出空工作簿。
   */
  async exportUsheetXlsx(id: string, baseDir?: string): Promise<{ exportPath: string; rowCount: number; sheetCount: number; imageCount: number; skipped: number; size: number }> {
    if (!isSafePathSegment(id)) throw new AppError("InvalidInput", `无效的笔记 ID: ${id}`);
    const row = this.ctx.db.prepare("SELECT title, kind FROM notes WHERE id=?").get(id) as { title?: string; kind?: string | null } | undefined;
    if ((row?.kind ?? "doc") !== "usheet") throw new AppError("InvalidInput", "该文档不是表格，无法导出 Excel");
    const bodyPath = this.ctx.notePathFor(id);
    if (!fs.existsSync(bodyPath)) throw new AppError("NotFound", `笔记不存在: ${id}`);
    const doc = parseUsheetBody(fs.readFileSync(bodyPath, "utf8"));
    if (!doc) throw new AppError("InvalidInput", "表格正文为空或无法解析，无可导出的数据");
    const result = await buildUsheetXlsx(doc.workbook, { noteId: id, assetsDir: this.ctx.noteAssetsDir });
    if (result.cellCount === 0 && result.imageCount === 0) throw new AppError("InvalidInput", "表格内容为空，没有可导出的数据");
    const title = sanitizeFileName(row?.title ?? "未命名");
    const base = baseDir ?? this.defaultExportBase();
    fs.mkdirSync(base, { recursive: true });
    const exportPath = this.uniqueExportFile(base, title, "xlsx");
    fs.writeFileSync(exportPath, Buffer.from(result.bytes));
    return { exportPath, rowCount: result.rowCount, sheetCount: result.sheetCount, imageCount: result.imageCount, skipped: result.skipped, size: result.bytes.byteLength };
  }

  /**
   * D01 续：导出多维表**活动数据表**为 ZIP 压缩包 —— 内含 `{表名}.csv` + `附件/{文件名}`。
   * 附件/图片字段引用的真实文件一并打包；同名附件自动加 (2)/(3) 后缀，并让 CSV 对应单元格指向归档内相对路径。
   * store（不压缩）**流式写盘**：每次只读一个附件，避免整包进内存；4GiB 以上明确报错（需 ZIP64）。
   */
  exportBitableZip(id: string, baseDir?: string): { exportPath: string; rowCount: number; fileCount: number; skipped: number; size: number } {
    if (!isSafePathSegment(id)) throw new AppError("InvalidInput", `无效的笔记 ID: ${id}`);
    const row = this.ctx.db.prepare("SELECT title, kind FROM notes WHERE id=?").get(id) as { title?: string; kind?: string | null } | undefined;
    if ((row?.kind ?? "doc") !== "bitable") throw new AppError("InvalidInput", "该文档不是多维表，无法导出压缩包");
    const bodyPath = this.ctx.notePathFor(id);
    if (!fs.existsSync(bodyPath)) throw new AppError("NotFound", `笔记不存在: ${id}`);
    const doc = parseBitableBody(fs.readFileSync(bodyPath, "utf8"));
    if (!doc || doc.tables.length === 0) throw new AppError("InvalidInput", "多维表正文为空，无可导出的数据表");
    const table = doc.tables.find((t) => t.id === doc.activeTableId) ?? doc.tables[0];

    // 1) 收集附件（按磁盘名去重）：附件 / 图片字段引用的 { file, name }
    const pairs: Array<{ file: string; name: string }> = [];
    const seen = new Set<string>();
    for (const field of table.fields) {
      if (field.type !== "attachment" && field.type !== "image") continue;
      for (const record of table.records) {
        for (const attachment of bitableAttachments(record.values[field.id])) {
          if (seen.has(attachment.file)) continue;
          seen.add(attachment.file);
          pairs.push({ file: attachment.file, name: attachment.name });
        }
      }
    }
    // 2) 归档内文件名去重（与 CSV 单元格一一对应）
    const used = new Set<string>();
    const archiveName = new Map<string, string>();
    for (const pair of pairs) {
      const base = pair.name.replace(/[\\/:*?"<>|\r\n]/g, "_").trim() || "附件";
      let candidate = base;
      let suffix = 2;
      while (used.has(candidate)) candidate = withSuffix(base, suffix++);
      used.add(candidate);
      archiveName.set(pair.file, candidate);
    }
    const labelOf = (attachment: { file: string; name: string }): string => "附件/" + (archiveName.get(attachment.file) ?? attachment.name);
    const csv = bitableTableCsv(table, { tables: doc.tables }, { attachmentLabel: labelOf });

    // 3) 流式写 zip
    const title = sanitizeFileName(row?.title ?? "未命名");
    const tableName = csvFileNameFor(table).replace(/\.csv$/, "") || "数据表";
    const base0 = baseDir ?? this.defaultExportBase();
    fs.mkdirSync(base0, { recursive: true });
    const exportPath = this.uniqueExportFile(base0, `${title} - ${tableName}`, "zip");
    const fd = fs.openSync(exportPath, "w");
    let fileCount = 0;
    let skipped = 0;
    try {
      const writer = new ZipWriter((chunk) => fs.writeSync(fd, chunk));
      writer.addFile(tableName + ".csv", Buffer.from(csv, "utf8"));
      for (const pair of pairs) {
        if (!isSafePathSegment(pair.file)) { skipped++; continue; }
        const src = path.join(this.ctx.noteAssetsDir, id, pair.file);
        if (!fs.existsSync(src)) { skipped++; continue; }
        writer.addFile("附件/" + (archiveName.get(pair.file) ?? pair.name), fs.readFileSync(src));
        fileCount++;
      }
      writer.finish();
    } finally {
      fs.closeSync(fd);
    }
    return { exportPath, rowCount: table.records.length, fileCount, skipped, size: fs.statSync(exportPath).size };
  }

  /**
   * kind 守卫：非 doc 类型（表格/多维表）正文不是 Lake 文档格式，缓存 markdown 为空/无意义，
   * 导出会产出坏文件或无语义内容 → 统一前置拦截。
   * UI 侧（目录树右键「导出」子菜单 / 文档 ⋯ 菜单）对非 doc 已隐藏入口，这里做**兜底**（防 IPC 直调）。
   */
  private assertDocKind(id: string): void {
    const row = this.ctx.db.prepare("SELECT kind FROM notes WHERE id=?").get(id) as { kind?: string | null } | undefined;
    const kind = row?.kind ?? "doc";
    if (kind === "doc") return;
    const label = kind === "usheet" ? "表格" : kind === "bitable" ? "多维表" : kind === "board" ? "画板" : kind === "ink" ? "手写板" : kind;
    throw new AppError("InvalidInput", `${label}文档暂不支持导出（仅文档可导出 Markdown/HTML/PDF/资料包）`);
  }

  /**
   * M1：导出 HTML（收口导出的一环）：读缓存 Markdown → 轻量转 HTML →
   * 复制本地图片到 images/ 并改写相对引用 → 写 {标题}/index.html。
   */
  exportHtmlNote(id: string, baseDir?: string): { exportPath: string; imageCount: number; skipped: number; size: number } {
    if (!isSafePathSegment(id)) throw new AppError("InvalidInput", `无效的笔记 ID: ${id}`);
    this.assertDocKind(id);
    const caches = this.ctx.readNoteCaches(id);
    const markdown = caches.markdown ?? "";
    if (!markdown.trim()) throw new AppError("InvalidInput", "该文档还没有文本缓存，请先打开并保存一次");
    const titleRow = this.ctx.db.prepare("SELECT title FROM notes WHERE id=?").get(id) as { title: string } | undefined;
    const title = sanitizeFileName(titleRow?.title ?? "未命名");
    const base = baseDir ?? this.defaultExportBase();
    const exportDir = this.uniqueExportDir(base, title);
    const imagesDir = path.join(exportDir, "images");
    fs.mkdirSync(imagesDir, { recursive: true });
    let body = mdToHtml(markdown);
    // 提取 <img src="http://127.0.0.1:{ASSET_PORT}/{noteId}/{file}"> 并复制 + 改写相对引用
    const imgRe = localAssetHtmlImgRe(ASSET_PORT);
    const seen = new Set<string>();
    let imageCount = 0;
    let skipped = 0;
    body = body.replace(imgRe, (whole: string, url: string, noteId: string, filename: string) => {
      const key = `${noteId}/${filename}`;
      if (seen.has(key)) return whole.replace(url, `images/${filename}`);
      seen.add(key);
      if (!isSafePathSegment(noteId) || !isSafePathSegment(filename)) { skipped++; return whole; }
      const src = path.join(this.ctx.noteAssetsDir, noteId, filename);
      try {
        if (fs.existsSync(src)) {
          const dest = path.join(imagesDir, filename);
          if (!fs.existsSync(dest)) fs.copyFileSync(src, dest);
          imageCount++;
          return whole.replace(url, `images/${filename}`);
        }
      } catch { /* 复制失败算跳过 */ }
      skipped++;
      return whole;
    });
    const page = wrapHtmlPage(title, body);
    fs.writeFileSync(path.join(exportDir, "index.html"), page, "utf8");
    return { exportPath: path.join(exportDir, "index.html"), imageCount, skipped, size: page.length };
  }

  /** 唯一导出文件路径（{base}/{title}.{ext}，重名 -2/-3 后缀）。 */
  private uniqueExportFile(base: string, title: string, ext: string): string {
    let p = path.join(base, `${title}.${ext}`);
    let suffix = 2;
    while (fs.existsSync(p)) {
      p = path.join(base, `${title}-${suffix}.${ext}`);
      suffix++;
    }
    return p;
  }

  /**
   * M3：PDF 导出内容准备（本方法无 electron 依赖、可测）：缓存 Markdown → HTML →
   * 图片 data URI 内嵌（单文件交付，临时页 loadFile 无 data URL 导航大小限制）→
   * 自包含临时 HTML + 唯一 pdf 目标路径。渲染（隐藏窗口 printToPDF）由 electron/export.ts
   * 完成（思源同款 printToPDF 路线），临时目录由调用方用完即删。
   */
  exportPdfHtml(id: string, baseDir?: string): { htmlPath: string; tempDir: string; pdfPath: string; imageCount: number; skipped: number } {
    if (!isSafePathSegment(id)) throw new AppError("InvalidInput", `无效的笔记 ID: ${id}`);
    this.assertDocKind(id);
    const caches = this.ctx.readNoteCaches(id);
    const markdown = caches.markdown ?? "";
    if (!markdown.trim()) throw new AppError("InvalidInput", "该文档还没有文本缓存，请先打开并保存一次");
    const titleRow = this.ctx.db.prepare("SELECT title FROM notes WHERE id=?").get(id) as { title: string } | undefined;
    const title = sanitizeFileName(titleRow?.title ?? "未命名");
    const base = baseDir ?? this.defaultExportBase();
    fs.mkdirSync(base, { recursive: true });
    const pdfPath = this.uniqueExportFile(base, title, "pdf");
    let body = mdToHtml(markdown);
    // 图片 → data URI 内嵌（同图复用缓存，避免多次读同一文件）
    const imgRe = localAssetHtmlImgRe(ASSET_PORT);
    const uriCache = new Map<string, string | null>();
    const toDataUri = (noteId: string, filename: string): string | null => {
      const key = `${noteId}/${filename}`;
      if (uriCache.has(key)) return uriCache.get(key)!;
      let uri: string | null = null;
      if (isSafePathSegment(noteId) && isSafePathSegment(filename)) {
        const file = path.join(this.ctx.noteAssetsDir, noteId, filename);
        try {
          if (fs.existsSync(file)) {
            uri = `data:${mimeTypeForFilename(filename)};base64,${fs.readFileSync(file).toString("base64")}`;
          }
        } catch { /* 读取失败算跳过 */ }
      }
      uriCache.set(key, uri);
      return uri;
    };
    let imageCount = 0;
    let skipped = 0;
    body = body.replace(imgRe, (whole: string, url: string, noteId: string, filename: string) => {
      const uri = toDataUri(noteId, filename);
      if (!uri) { skipped++; return whole; }
      imageCount++;
      return whole.replace(url, uri);
    });
    // 打印优化（A4 分页防断裂；页边距由 printToPDF margins 管，body 不再留白/限宽）
    const printCss = "<style>body { max-width: none; padding: 0; } h1, h2, h3 { break-after: avoid; } pre, blockquote, img, li { break-inside: avoid; }</style>";
    const page = wrapHtmlPage(title, body).replace("</head>", `${printCss}</head>`);
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "lake-export-pdf-"));
    const htmlPath = path.join(tempDir, "index.html");
    fs.writeFileSync(htmlPath, page, "utf8");
    return { htmlPath, tempDir, pdfPath, imageCount, skipped };
  }

  getNotePaths(id: string): { title: string; lakePath: string; assetsDir: string } {
    if (!isSafePathSegment(id)) throw new AppError("InvalidInput", `无效的笔记 ID: ${id}`);
    const row = this.ctx.db.prepare("SELECT title FROM notes WHERE id=?").get(id) as { title: string } | undefined;
    if (!row) throw new AppError("NotFound", `笔记不存在: ${id}`);
    return { title: row.title, lakePath: this.ctx.notePathFor(id), assetsDir: path.join(this.ctx.noteAssetsDir, id) };
  }

  /**
   * M1：导出资料包（Markdown + 图片）到桌面 lakex-local-notes-导出/{标题}/。
   * 图片引用从 Lake 生成的 markdown 里以轻量正则提取（`![](http://127.0.0.1:19876/{noteId}/{filename})`），
   * 复制到导出目录 images/ 并把 MD 改写为相对引用，产出自包含资料包。
   */
  exportNotePackage(id: string, baseDir?: string): { exportDir: string; imageCount: number; skipped: number; size: number } {
    if (!isSafePathSegment(id)) throw new AppError("InvalidInput", `无效的笔记 ID: ${id}`);
    this.assertDocKind(id);
    const caches = this.ctx.readNoteCaches(id);
    const markdown = caches.markdown ?? "";
    if (!markdown.trim()) throw new AppError("InvalidInput", "该文档还没有文本缓存，请先打开并保存一次");
    const titleRow = this.ctx.db.prepare("SELECT title FROM notes WHERE id=?").get(id) as { title: string } | undefined;
    const title = sanitizeFileName(titleRow?.title ?? "未命名");
    // 提取图片引用（仅处理本地 assetServer URL；远程 URL 保持原样）
    const imgRe = localAssetMdImgRe(ASSET_PORT);
    const unique: Array<{ url: string; noteId: string; filename: string }> = [];
    const seen = new Set<string>();
    let m: RegExpExecArray | null;
    while ((m = imgRe.exec(markdown))) {
      const url = m[1], noteId = m[2], filename = m[3];
      if (!isSafePathSegment(noteId) || !isSafePathSegment(filename)) continue; // 防路径穿越
      const key = `${noteId}/${filename}`;
      if (seen.has(key)) continue;
      seen.add(key);
      unique.push({ url, noteId, filename });
    }
    const base = baseDir ?? this.defaultExportBase();
    const exportDir = this.uniqueExportDir(base, title);
    const imagesDir = path.join(exportDir, "images");
    fs.mkdirSync(imagesDir, { recursive: true });
    let imageCount = 0;
    let skipped = 0;
    let md = markdown;
    for (const img of unique) {
      const src = path.join(this.ctx.noteAssetsDir, img.noteId, img.filename);
      let copied = false;
      try {
        if (fs.existsSync(src)) {
          const dest = path.join(imagesDir, img.filename);
          if (!fs.existsSync(dest)) fs.copyFileSync(src, dest);
          copied = true;
        }
      } catch { /* 复制失败算跳过 */ }
      if (copied) {
        imageCount++;
        md = md.split(img.url).join(`images/${img.filename}`);
      } else {
        skipped++;
      }
    }
    fs.writeFileSync(path.join(exportDir, "index.md"), md, "utf8");
    return { exportDir, imageCount, skipped, size: md.length };
  }
}
