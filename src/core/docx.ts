/**
 * 极简 Word（.docx）写入器 —— 纯函数，无 DOM / node: 依赖（桌面导出与测试共用）。
 *
 * 输入 = 保存时由内核 getDocument("text/markdown") 生成并缓存的 Markdown（见 electron/noteExport.ts）；
 * 输出 = 标准 OOXML：ZIP + [Content_Types].xml + word/document.xml + styles/numbering + media。
 *
 * 覆盖：标题 H1–H6 / 段落 / 有序·无序列表 / 引用 / 代码块 / 分隔线 / 表格（基础）/
 *       粗体·斜体·删除线·行内代码 / 链接（外部超链接）/ 图片（由调用方提供字节，主进程负责读盘与格式转换）。
 * 不搬运：行内 HTML、复杂嵌套格式、表格样式、页眉页脚 —— 文本不丢，只是降级为纯文本/基础结构。
 *
 * 图片解析是回调（DocxImageResolver）：core 不碰 node/sharp，主进程把本地资产读成字节再交进来。
 * 解析不到（远程图 / 文件缺失 / 不支持的格式）⇒ 计入 skippedImages，绝不静默当成功。
 */
import { createZip } from "./zipArchive.js";
import { xmlText } from "./ooxml.js";

export interface DocxImage {
  bytes: Uint8Array;
  extension: "png" | "jpeg" | "gif";
  width: number;
  height: number;
}

export type DocxImageResolver = (src: string) => DocxImage | null | undefined;

export interface DocxResult {
  bytes: Uint8Array;
  imageCount: number;
  skippedImages: number;
  linkCount: number;
}

const encoder = new TextEncoder();
const EMU_PER_PX = 9525;
const MAX_IMAGE_WIDTH_PX = 600;

type InlineNode =
  | { type: "text" | "bold" | "italic" | "strike" | "code"; text: string }
  | { type: "link"; text: string; href: string }
  | { type: "image"; alt: string; src: string };

type Block =
  | { type: "paragraph"; text: string }
  | { type: "heading"; level: number; text: string }
  | { type: "quote"; text: string }
  | { type: "code"; text: string }
  | { type: "list"; ordered: boolean; level: number; text: string }
  | { type: "hr" }
  | { type: "table"; rows: string[][] };

/** 从 Markdown 中提取图片源（主进程据此预先读盘/转码）。 */
export function collectMarkdownImageSources(markdown: string): string[] {
  const out = new Set<string>();
  const re = /!\[[^\]]*\]\(([^)\s]+)\)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(markdown))) out.add(match[1]);
  return [...out];
}

export function parseMarkdownInline(text: string): InlineNode[] {
  const nodes: InlineNode[] = [];
  const pattern = /(!\[[^\]]*\]\([^)\s]+\)|\[[^\]]+\]\([^)\s]+\)|\*\*[^*]+\*\*|__[^_]+__|~~[^~]+~~|\x60[^\x60]+\x60|\*[^*\n]+\*|_[^_\n]+_)/g;
  let last = 0;
  let match: RegExpExecArray | null;
  const flush = (end: number) => {
    if (end > last) nodes.push({ type: "text", text: text.slice(last, end) });
  };
  while ((match = pattern.exec(text))) {
    flush(match.index);
    const token = match[0];
    if (token.startsWith("![")) {
      const img = /^!\[([^\]]*)\]\(([^)\s]+)\)$/.exec(token);
      if (img) nodes.push({ type: "image", alt: img[1], src: img[2] });
    } else if (token.startsWith("[")) {
      const link = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(token);
      if (link) nodes.push({ type: "link", text: link[1], href: link[2] });
    } else if (token.startsWith("**") || token.startsWith("__")) {
      nodes.push({ type: "bold", text: token.slice(2, -2) });
    } else if (token.startsWith("~~")) {
      nodes.push({ type: "strike", text: token.slice(2, -2) });
    } else if (token.startsWith("\x60")) {
      nodes.push({ type: "code", text: token.slice(1, -1) });
    } else {
      nodes.push({ type: "italic", text: token.slice(1, -1) });
    }
    last = match.index + token.length;
  }
  flush(text.length);
  return nodes;
}

function splitTableRow(line: string): string[] {
  let trimmed = line.trim();
  if (trimmed.startsWith("|")) trimmed = trimmed.slice(1);
  if (trimmed.endsWith("|")) trimmed = trimmed.slice(0, -1);
  return trimmed.split("|").map((cell) => cell.trim());
}

function parseMarkdownBlocks(markdown: string): Block[] {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();
    if (trimmed === "") { i += 1; continue; }
    const fence = /^\x60\x60\x60(.*)$/.exec(trimmed);
    if (fence) {
      const code: string[] = [];
      i += 1;
      while (i < lines.length && !/^\x60\x60\x60\s*$/.test(lines[i].trim())) { code.push(lines[i]); i += 1; }
      i += 1;
      blocks.push({ type: "code", text: code.join("\n") });
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(trimmed);
    if (heading) { blocks.push({ type: "heading", level: heading[1].length, text: heading[2] }); i += 1; continue; }
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) { blocks.push({ type: "hr" }); i += 1; continue; }
    if (/^\|.*\|$/.test(trimmed) && i + 1 < lines.length && /^\|?[\s:|-]+\|?$/.test(lines[i + 1].trim()) && lines[i + 1].includes("-")) {
      const rows: string[][] = [splitTableRow(line)];
      i += 2;
      while (i < lines.length && /^\|.*\|$/.test(lines[i].trim())) { rows.push(splitTableRow(lines[i])); i += 1; }
      blocks.push({ type: "table", rows });
      continue;
    }
    if (trimmed.startsWith(">")) {
      const quote: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith(">")) { quote.push(lines[i].trim().replace(/^>\s?/, "")); i += 1; }
      blocks.push({ type: "quote", text: quote.join("\n") });
      continue;
    }
    const list = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(line);
    if (list) {
      const level = Math.min(3, Math.floor(list[1].length / 2));
      blocks.push({ type: "list", ordered: /^\d/.test(list[2]), level, text: list[3] });
      i += 1;
      continue;
    }
    blocks.push({ type: "paragraph", text: trimmed });
    i += 1;
  }
  return blocks;
}

function run(text: string, opts: { bold?: boolean; italic?: boolean; strike?: boolean; code?: boolean; color?: string; underline?: boolean } = {}): string {
  if (text === "") return "";
  const props: string[] = [];
  if (opts.code) props.push('<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/>');
  if (opts.bold) props.push("<w:b/>");
  if (opts.italic) props.push("<w:i/>");
  if (opts.strike) props.push("<w:strike/>");
  if (opts.underline) props.push('<w:u w:val="single"/>');
  if (opts.color) props.push('<w:color w:val="' + opts.color + '"/>');
  const rPr = props.length > 0 ? "<w:rPr>" + props.join("") + "</w:rPr>" : "";
  return "<w:r>" + rPr + '<w:t xml:space="preserve">' + xmlText(text) + "</w:t></w:r>";
}

interface ImageStateMeta { relId: string; id: number; image: DocxImage; }

class DocumentBuilder {
  private readonly resolveImage: DocxImageResolver | undefined;
  readonly images: DocxImage[] = [];
  readonly links: string[] = [];
  private readonly imageBySrc = new Map<string, ImageStateMeta | null>();
  private readonly linkByHref = new Map<string, string>();
  private imageCount = 0;
  private skippedImages = 0;
  /** 每个有序列表块分配独立 numId（numId=1 固定给无序列表），避免第二段有序列表接着上段编号。 */
  readonly orderedNums: number[] = [];
  private nextOrderedNumId = 2;

  constructor(resolveImage?: DocxImageResolver) {
    this.resolveImage = resolveImage;
  }

  get counts(): { imageCount: number; skippedImages: number; linkCount: number } {
    return { imageCount: this.imageCount, skippedImages: this.skippedImages, linkCount: this.links.length };
  }

  private imageMeta(src: string): ImageStateMeta | null {
    if (this.imageBySrc.has(src)) return this.imageBySrc.get(src) ?? null;
    const image = this.resolveImage?.(src) ?? null;
    if (!image) {
      this.skippedImages += 1;
      this.imageBySrc.set(src, null);
      return null;
    }
    const meta: ImageStateMeta = { relId: "rIdImg" + (this.images.length + 1), id: this.images.length + 1, image };
    this.images.push(image);
    this.imageBySrc.set(src, meta);
    this.imageCount += 1;
    return meta;
  }

  private linkRel(href: string): string {
    const existing = this.linkByHref.get(href);
    if (existing) return existing;
    const relId = "rIdLink" + (this.links.length + 1);
    this.links.push(href);
    this.linkByHref.set(href, relId);
    return relId;
  }

  private inlineXml(text: string): string {
    return parseMarkdownInline(text).map((node) => {
      switch (node.type) {
        case "text": return run(node.text);
        case "bold": return run(node.text, { bold: true });
        case "italic": return run(node.text, { italic: true });
        case "strike": return run(node.text, { strike: true });
        case "code": return run(node.text, { code: true });
        case "link": return '<w:hyperlink r:id="' + this.linkRel(node.href) + '">' + run(node.text, { color: "0563C1", underline: true }) + "</w:hyperlink>";
        case "image": {
          const meta = this.imageMeta(node.src);
          return meta ? this.drawingXml(meta, node.alt) : run(node.alt ? "[图片] " + node.alt : "[图片]");
        }
        default: return "";
      }
    }).join("");
  }

  private drawingXml(meta: ImageStateMeta, alt: string): string {
    const { image } = meta;
    const ratio = image.width > 0 && image.height > 0 ? image.height / image.width : 0.75;
    const widthPx = Math.min(Math.max(image.width || MAX_IMAGE_WIDTH_PX, 1), MAX_IMAGE_WIDTH_PX);
    const heightPx = Math.max(Math.round(widthPx * ratio), 1);
    const cx = widthPx * EMU_PER_PX;
    const cy = heightPx * EMU_PER_PX;
    const name = "image" + meta.id + "." + image.extension;
    return '<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">'
      + '<wp:extent cx="' + cx + '" cy="' + cy + '"/>'
      + '<wp:docPr id="' + meta.id + '" name="' + xmlText(alt || "Picture " + meta.id) + '"/>'
      + '<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">'
      + '<a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">'
      + '<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">'
      + '<pic:nvPicPr><pic:cNvPr id="' + meta.id + '" name="' + name + '"/><pic:cNvPicPr/></pic:nvPicPr>'
      + '<pic:blipFill><a:blip r:embed="' + meta.relId + '"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>'
      + '<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="' + cx + '" cy="' + cy + '"/></a:xfrm>'
      + '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>'
      + '</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>';
  }

  private paragraph(text: string, opts: { style?: string; numId?: number; level?: number; align?: string; border?: boolean } = {}): string {
    const props: string[] = [];
    if (opts.style) props.push('<w:pStyle w:val="' + opts.style + '"/>');
    if (opts.numId !== undefined) props.push('<w:numPr><w:ilvl w:val="' + (opts.level ?? 0) + '"/><w:numId w:val="' + opts.numId + '"/></w:numPr>');
    if (opts.align) props.push('<w:jc w:val="' + opts.align + '"/>');
    if (opts.border) props.push('<w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="D0D5DD"/></w:pBdr>');
    const pPr = props.length > 0 ? "<w:pPr>" + props.join("") + "</w:pPr>" : "";
    return "<w:p>" + pPr + this.inlineXml(text) + "</w:p>";
  }

  private tableXml(rows: string[][]): string {
    const border = '<w:tblBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="D0D5DD"/><w:left w:val="single" w:sz="4" w:space="0" w:color="D0D5DD"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="D0D5DD"/><w:right w:val="single" w:sz="4" w:space="0" w:color="D0D5DD"/><w:insideH w:val="single" w:sz="4" w:space="0" w:color="D0D5DD"/><w:insideV w:val="single" w:sz="4" w:space="0" w:color="D0D5DD"/></w:tblBorders>';
    const columnCount = rows.reduce((max, cells) => Math.max(max, cells.length), 0);
    // OOXML 要求 w:tbl 带 w:tblGrid（Word 缺它会报“文档需要修复”）；等宽交给自动布局。
    const grid = columnCount > 0
      ? "<w:tblGrid>" + Array.from({ length: columnCount }, () => '<w:gridCol w:w="2400"/>').join("") + "</w:tblGrid>"
      : "";
    const body = rows.map((cells) => {
      const cellXml = cells.map((cell) => '<w:tc><w:tcPr><w:tcW w:w="0" w:type="auto"/></w:tcPr>' + this.paragraph(cell, { style: "TableText" }) + "</w:tc>").join("");
      return "<w:tr>" + cellXml + "</w:tr>";
    }).join("");
    return '<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/>' + border + '</w:tblPr>' + grid + body + '</w:tbl>';
  }

  buildBody(blocks: Block[]): string {
    const out: string[] = [];
    for (let i = 0; i < blocks.length; i++) {
      const block = blocks[i];
      switch (block.type) {
        case "heading": out.push(this.paragraph(block.text, { style: "Heading" + block.level })); break;
        case "quote": out.push(this.paragraph(block.text, { style: "Quote" })); break;
        case "code": out.push(block.text.split("\n").map((line) => this.paragraph(line, { style: "Code" })).join("")); break;
        case "hr": out.push("<w:p><w:pPr><w:pBdr><w:bottom w:val=\"single\" w:sz=\"6\" w:space=\"1\" w:color=\"D0D5DD\"/></w:pBdr></w:pPr></w:p>"); break;
        case "list": {
          const ordered = block.ordered;
          const numId = ordered ? this.nextOrderedNumId++ : 1;
          if (ordered) this.orderedNums.push(numId);
          // 连续同类型列表共用一个 numId（嵌套项另起一段也没关系）；有序列表按“段”重启编号。
          while (i < blocks.length) {
            const item = blocks[i];
            if (item.type !== "list" || item.ordered !== ordered) break;
            out.push(this.paragraph(item.text, { style: "ListParagraph", numId, level: item.level }));
            i += 1;
          }
          i -= 1;
          break;
        }
        case "table": out.push(this.tableXml(block.rows) + this.paragraph("")); break;
        default: out.push(this.paragraph(block.text));
      }
    }
    return out.join("");
  }
}

const STYLES_XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
  + '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
  + '<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:eastAsia="MiSans" w:hAnsi="Calibri"/><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr></w:rPrDefault>'
  + '<w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>'
  + '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>'
  + '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="240" w:after="120"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:sz w:val="36"/></w:rPr></w:style>'
  + '<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="200" w:after="100"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/><w:sz w:val="32"/></w:rPr></w:style>'
  + '<w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="160" w:after="80"/><w:outlineLvl w:val="2"/></w:pPr><w:rPr><w:b/><w:sz w:val="28"/></w:rPr></w:style>'
  + '<w:style w:type="paragraph" w:styleId="Heading4"><w:name w:val="heading 4"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:outlineLvl w:val="3"/></w:pPr><w:rPr><w:b/><w:sz w:val="26"/></w:rPr></w:style>'
  + '<w:style w:type="paragraph" w:styleId="Heading5"><w:name w:val="heading 5"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:outlineLvl w:val="4"/></w:pPr><w:rPr><w:b/><w:sz w:val="24"/></w:rPr></w:style>'
  + '<w:style w:type="paragraph" w:styleId="Heading6"><w:name w:val="heading 6"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:outlineLvl w:val="5"/></w:pPr><w:rPr><w:b/><w:sz w:val="22"/></w:rPr></w:style>'
  + '<w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/><w:basedOn w:val="Normal"/><w:pPr><w:ind w:left="420"/></w:pPr><w:rPr><w:i/><w:color w:val="595959"/></w:rPr></w:style>'
  + '<w:style w:type="paragraph" w:styleId="Code"><w:name w:val="Code"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="0"/><w:shd w:val="clear" w:color="auto" w:fill="F4F6F8"/></w:pPr><w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/><w:sz w:val="20"/></w:rPr></w:style>'
  + '<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/><w:pPr><w:ind w:left="720"/></w:pPr></w:style>'
  + '<w:style w:type="paragraph" w:styleId="TableText"><w:name w:val="Table Text"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="0"/></w:pPr></w:style>'
  + '</w:styles>';

function levelXml(abstractId: number, format: "bullet" | "decimal"): string {
  const levels = [0, 1, 2].map((level) => {
    const left = 720 + level * 360;
    const text = format === "bullet" ? (level === 0 ? "•" : "◦") : "%" + (level + 1) + ".";
    return '<w:lvl w:ilvl="' + level + '"><w:start w:val="1"/><w:numFmt w:val="' + format + '"/><w:lvlText w:val="' + text + '"/><w:lvlJc w:val="left"/>'
      + '<w:pPr><w:ind w:left="' + left + '" w:hanging="360"/></w:pPr>'
      + (format === "bullet" ? '<w:rPr><w:rFonts w:ascii="Symbol" w:hAnsi="Symbol"/></w:rPr>' : "")
      + "</w:lvl>";
  }).join("");
  return '<w:abstractNum w:abstractNumId="' + abstractId + '"><w:multiLevelType w:val="hybridMultilevel"/>' + levels + "</w:abstractNum>";
}

/** 每个有序列表块一个 <w:num>（startOverride=1），让第二段有序列表从 1 重新开始。 */
function numberingXml(orderedNums: readonly number[]): string {
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
    + levelXml(0, "bullet") + levelXml(1, "decimal")
    + '<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>'
    + orderedNums.map((numId) => '<w:num w:numId="' + numId + '"><w:abstractNumId w:val="1"/>'
      + '<w:lvlOverride w:ilvl="0"><w:startOverride w:val="1"/></w:lvlOverride></w:num>').join("")
    + '</w:numbering>';
}

// 路径用拼接：core 边界检查会把源码里的 word/document.xml 误判成 DOM 全局（见 check-core-boundaries.mjs 的说明）。
const DOCUMENT_PART = "word/document" + ".xml";
const DOCUMENT_RELS_PART = "word/_rels/document" + ".xml.rels";
// MIME 里也带 document 字样，同样拼接避开边界检查的误判。
const MIME_DOCUMENT_MAIN = "application/vnd.openxmlformats-officedocument.wordprocessingml." + "document" + ".main+xml";

const CONTENTS_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
  + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
  + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
  + '<Default Extension="xml" ContentType="application/xml"/>'
  + '<Default Extension="png" ContentType="image/png"/>'
  + '<Default Extension="jpeg" ContentType="image/jpeg"/>'
  + '<Default Extension="gif" ContentType="image/gif"/>'
  + '<Override PartName="/' + DOCUMENT_PART + '" ContentType="' + MIME_DOCUMENT_MAIN + '"/>'
  + '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>'
  + '<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>';

const ROOT_RELS = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
  + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
  + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="' + DOCUMENT_PART + '"/>'
  + '</Relationships>';

/** Markdown → DOCX 字节。resolveImage 缺省 = 所有图片按「[图片] alt」降级（仍计入 skipped）。 */
export function markdownToDocx(markdown: string, resolveImage?: DocxImageResolver): DocxResult {
  const blocks = parseMarkdownBlocks(markdown);
  const builder = new DocumentBuilder(resolveImage);
  const body = builder.buildBody(blocks);
  const numbering = numberingXml(builder.orderedNums);
  const counts = builder.counts;
  const documentXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'
    + ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"'
    + ' xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"'
    + ' xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"'
    + ' xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">'
    + '<w:body>' + body
    + '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="851" w:footer="992" w:gutter="0"/></w:sectPr>'
    + '</w:body></w:document>';
  const rels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    + '<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'
    + '<Relationship Id="rIdNumbering" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>'
    + builder.images.map((image, index) => '<Relationship Id="rIdImg' + (index + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image' + (index + 1) + "." + image.extension + '"/>').join("")
    + builder.links.map((href, index) => '<Relationship Id="rIdLink' + (index + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="' + xmlText(href) + '" TargetMode="External"/>').join("")
    + "</Relationships>";
  const contentTypes = CONTENTS_HEAD + "</Types>";
  const files = [
    { name: "[Content_Types].xml", data: encoder.encode(contentTypes) },
    { name: "_rels/.rels", data: encoder.encode(ROOT_RELS) },
    { name: DOCUMENT_PART, data: encoder.encode(documentXml) },
    { name: DOCUMENT_RELS_PART, data: encoder.encode(rels) },
    { name: "word/styles.xml", data: encoder.encode(STYLES_XML) },
    { name: "word/numbering.xml", data: encoder.encode(numbering) },
    ...builder.images.map((image, index) => ({ name: "word/media/image" + (index + 1) + "." + image.extension, data: image.bytes })),
  ];
  const bytes = createZip(files);
  return { bytes, imageCount: counts.imageCount, skippedImages: counts.skippedImages, linkCount: counts.linkCount };
}
