import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import type { DbLike } from "./dbLike.js";
import { AppError } from "../src/core/storeErrors.js";
import { isSafePathSegment, sanitizeFileName } from "../src/core/storeUtils.js";
import { mdToHtml, wrapHtmlPage } from "../src/core/mdToHtml.js";
import { mimeTypeForFilename } from "../src/core/imageUtils.js";
import { ASSET_PORT } from "./assetServer.js";

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
 * 文档导出域（原生 Lake / HTML / Markdown 资料包）。
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

  /** 默认导出根目录（桌面 lake-notes-导出）。 */
  private defaultExportBase(): string {
    return path.join(os.homedir(), "Desktop", "lake-notes-导出");
  }

  /**
   * M1：导出原生 Lake 文档（图片 base64 内嵌，VS Code Lake 插件兼容）。
   * 把 image card 的 src 从本地 assetServer URL 替换为 data:image/...;base64，其余结构原样保留。
   */
  exportNativeLake(id: string, baseDir?: string): { exportPath: string; imageCount: number; skipped: number; size: number } {
    if (!isSafePathSegment(id)) throw new AppError("InvalidInput", `无效的笔记 ID: ${id}`);
    const lakePath = this.ctx.notePathFor(id);
    if (!fs.existsSync(lakePath)) throw new AppError("NotFound", `笔记不存在: ${id}`);
    const lake = fs.readFileSync(lakePath, "utf8");
    const titleRow = this.ctx.db.prepare("SELECT title FROM notes WHERE id=?").get(id) as { title: string } | undefined;
    const title = sanitizeFileName(titleRow?.title ?? "未命名");
    const base = baseDir ?? this.defaultExportBase();
    const exportDir = this.uniqueExportDir(base, title);
    fs.mkdirSync(exportDir, { recursive: true });
    const exportPath = path.join(exportDir, `${title}.lake`);
    // image card: <card ... name="image" ... value="data:...">（value = "data:" + encodeURIComponent(JSON)）
    const cardRe = /(<card\b[^>]*\bname="image"[^>]*\bvalue=")data:([^"]+)(")/g;
    let imageCount = 0;
    let skipped = 0;
    const out = lake.replace(cardRe, (whole, prefix: string, encoded: string, suffixTag: string) => {
      try {
        const value = JSON.parse(decodeURIComponent(encoded)) as { src?: string };
        const src = typeof value.src === "string" ? value.src : "";
        const m = localAssetLakeSrcRe(ASSET_PORT).exec(src);
        if (!m) { skipped++; return whole; } // 远程 URL 保持原样
        const noteId = m[1];
        const filename = m[2];
        if (!isSafePathSegment(noteId) || !isSafePathSegment(filename)) { skipped++; return whole; }
        const file = path.join(this.ctx.noteAssetsDir, noteId, filename);
        if (!fs.existsSync(file)) { skipped++; return whole; }
        const bytes = fs.readFileSync(file);
        const mime = mimeTypeForFilename(filename);
        value.src = `data:${mime};base64,${bytes.toString("base64")}`;
        imageCount++;
        return prefix + "data:" + encodeURIComponent(JSON.stringify(value)) + suffixTag;
      } catch { skipped++; return whole; }
    });
    fs.writeFileSync(exportPath, out, "utf8");
    return { exportPath, imageCount, skipped, size: out.length };
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
    const label = kind === "sheet" ? "表格" : kind === "bitable" ? "多维表" : kind === "board" ? "画板" : kind;
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
   * M1：导出资料包（Markdown + 图片）到桌面 lake-notes-导出/{标题}/。
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
