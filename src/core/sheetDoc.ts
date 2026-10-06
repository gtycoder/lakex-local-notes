/**
 * 表格文档（kind = "sheet"）正文格式与序列化 —— 桌面/移动端共享的单一事实源。
 *
 * 存储位置：sheets/{noteId}.sheet.json（本地）/ objects/{noteId}-{hash}.lake（S3，内容寻址）。
 * 正文是纯文本 JSON，因此天然复用「正文对象 + manifest.contentHash」的整条同步/GC/历史/回收站管线。
 *
 * 格式 v2（260919，FortuneSheet）：正文 = FortuneSheet 的 workbook 数据（`sheets: Sheet[]`）。
 * 为什么升 v2：v1 是 jspreadsheet CE 的 `{worksheets:[{name,data,columns}]}` 快照，换内核后结构完全不同
 * （FortuneSheet 是 sparse `celldata` + config/frozen/images/...）。按 AGENTS §3 #7：开发版数据可删可重建，
 * **不写兼容**——v1 正文 parse 返回 null → 按空表打开。
 *
 * 图片（260920 表格图片独立管理 P1，见 `docs/STORAGE-LAYERS.md`）：浮动图
 * `sheets[].images[].src` **存资产 filename**（文件落 `note-assets/{noteId}/`，复用资产管线：声明/GC/同步/
 * 历史/移动端 AssetServer）；渲染时由 `sheetImageSrc` 拼 URL，落盘时由 `sanitizeSheetWorksheet` 换回 filename。
 * **刻意不升版本号**：结构没变，`src` 的两种形态（filename / 内核刚插入的 `data:`）读写两侧天然都支持
 * （`sheetImageSrc` 一律放行 data:，编辑器打开时把遗留的 base64 提升成资产）——升版本只会让既有表格静默变空表，
 * 零收益破坏。
 *
 * 边界：本文件属 `src/core`（禁平台/第三方依赖），因此这里只声明「结构上兼容 FortuneSheet 的最小类型」，
 * 不 import `@fortune-sheet/core`；编辑器侧负责 `Sheet[]` 与本类型的互转（结构兼容，直接断言）。
 */
import { localAssetHttpUrl, parseLocalAssetUrl, withAssetWidth } from "./assetUrl.js";

export const SHEET_DOC_KIND = "sheet" as const;
export const SHEET_DOC_VERSION = 2 as const;

// 新建空表**不写 row/column**：交给 FortuneSheet 默认网格（60 列 × 84 行）。
// 写死小尺寸（如 8 列）会让 canvas 只按列数算宽 → 比容器窄：右侧留白、横向滚动条不在最右、
// 只显示到 H 列（260919 用户报）。FortuneSheet 会按需自动扩展。

/** FortuneSheet 单元格值（只声明搜索/校验需要读取的字段；其余样式字段透传）。 */
export interface SheetCellValue {
  /** 原始值。 */
  v?: string | number | boolean | null;
  /** 显示值（公式结果/格式化后的文本）。 */
  m?: string | number | null;
  [key: string]: unknown;
}

/** FortuneSheet `celldata` 项：sparse，只存非空格子。 */
export interface SheetCell {
  r: number;
  c: number;
  v?: SheetCellValue | null;
}

/** FortuneSheet 工作表（结构兼容；config/frozen/images/... 等未知字段原样透传）。 */
export interface SheetWorksheet {
  id?: string;
  name: string;
  celldata?: SheetCell[];
  [key: string]: unknown;
}

/**
 * 工作表里的图片（FortuneSheet `sheets[].images[]`，两种形态共用同一个数组）：几何是**像素**，
 * 相对网格内容原点（A1 左上），**zoom=1 单位**（内核渲染时统一乘 `zoomRatio`）。
 * 插入瞬间内核产出的是 `{ id, src:"data:image/png;base64,…", left, top, width, height, originWidth, originHeight }`，
 * 宿主在保存前把 `src` 提升成资产 filename（见 `STORAGE-LAYERS.md` P1）。
 * 带 `cell` 的是单元格图片（P2），几何由宿主一直跟着单元格矩形走。
 */
export interface SheetImageRef {
  id: string;
  /** 正文里的 src：**资产 filename**（`1712345678_ab12cd34.png`）；渲染时经 `sheetImageSrc` 拼 URL。 */
  src: string;
  left: number;
  top: number;
  width: number;
  height: number;
  /**
   * 单元格锚点（260921 P2「单元格图片」）：**带它就是单元格图片**——几何由宿主按
   * `sheetRangeRect` 一直跟着单元格走（列宽/行高/隐藏/合并变化都重算），渲染时等比缩进格内、不超过原图；
   * 不带则是浮动图（P1，用户可拖拽缩放）。带合并单元格时 `r/c` 记的是用户点选的那一格，渲染范围取整块。
   */
  cell?: { r: number; c: number };
}

/** 读出一个单元格锚点；非法/不存在返回 undefined。 */
function imageCellAnchor(value: Record<string, unknown>): { r: number; c: number } | undefined {
  const cell = value.cell;
  if (!cell || typeof cell !== "object") return undefined;
  const r = Number((cell as { r?: unknown }).r);
  const c = Number((cell as { c?: unknown }).c);
  if (!Number.isInteger(r) || !Number.isInteger(c) || r < 0 || c < 0) return undefined;
  return { r, c };
}

/** 读出一张工作表的图片（按 id 去重；几何非法或缺 src 的项跳过）。 */
export function sheetImages(sheet: SheetWorksheet | null | undefined): SheetImageRef[] {
  const raw = (sheet as { images?: unknown } | null | undefined)?.images;
  if (!Array.isArray(raw)) return [];
  const out: SheetImageRef[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const value = item as Record<string, unknown>;
    const src = typeof value.src === "string" ? value.src.trim() : "";
    if (!src) continue;
    const left = Number(value.left);
    const top = Number(value.top);
    const width = Number(value.width);
    const height = Number(value.height);
    if (!Number.isFinite(left) || !Number.isFinite(top) || !(width > 0) || !(height > 0)) continue;
    const id = typeof value.id === "string" && value.id ? value.id : `${left}:${top}:${src.length}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const cell = imageCellAnchor(value);
    out.push(cell ? { id, src, left, top, width, height, cell } : { id, src, left, top, width, height });
  }
  return out;
}

/**
 * 图片 src → 可渲染 URL（正文存 filename，URL 只在内存里存在）：
 * - `data:` / `http(s):` 原样返回（外部图片、内核刚插入还没提升的 base64）——已是 URL，只按需改写档位；
 * - 资产 filename 拼本机资产 canonical URL（端口取实例实际端口，A/B 双开各用各的）；
 * - 空/非法返回 null（调用方跳过）。
 *
 * `width`：缩略图档位（见 `assetUrl.ASSET_THUMB_WIDTHS`），只在**本地资产**上生效；
 * 对大图按档位取缩略图能省掉渲染进程的解码内存（像素 × 4B），显示尺寸只有几十像素时尤其可观。
 * 传 null/缺省 = 原图。
 */
export function sheetImageSrc(
  src: string | null | undefined,
  noteId: string,
  port?: number,
  width?: number | null,
): string | null {
  const value = typeof src === "string" ? src.trim() : "";
  if (!value) return null;
  const base = value.startsWith("data:") || value.startsWith("http://") || value.startsWith("https://")
    ? value
    : (noteId ? localAssetHttpUrl(noteId, value, port == null ? {} : { port }) : null);
  if (base == null) return null;
  return width == null ? base : withAssetWidth(base, width);
}

/**
 * 图片 src → **磁盘形态**（正文里能出现什么）：
 * - 本地资产 URL（含可能带的 `?token=`）→ 换回 filename —— 正文只存 filename（换端/换端口不失效，与
 *   `manifest.assets` 的 filename 语义一致）；
 * - `data:` / 外部 `http(s):` / 其它 → 原样（内核刚插入的 base64 由编辑器负责在保存前提升成资产）。
 */
export function sheetImageDiskSrc(src: unknown): unknown {
  if (typeof src !== "string") return src;
  const ref = parseLocalAssetUrl(src);
  if (ref && ref.space === "note" && !ref.staging) return ref.filename;
  return src;
}

export interface SheetDoc {
  kind: typeof SHEET_DOC_KIND;
  version: typeof SHEET_DOC_VERSION;
  sheets: SheetWorksheet[];
}

/** 新建表格文档的正文（1 张空表；最小可用，随后由编辑器保存覆盖）。 */
export function emptySheetBody(): string {
  const doc: SheetDoc = {
    kind: SHEET_DOC_KIND,
    version: SHEET_DOC_VERSION,
    sheets: [
      {
        id: "sheet-1",
        name: "Sheet1",
        order: 0,
        status: 1,
        // 默认 15 列 × 50 行（260919 用户定）。
        column: 15,
        row: 50,
        celldata: [],
        config: {},
      },
    ],
  };
  return JSON.stringify(doc);
}

/** 解析表格正文；非法/空/版本不符返回 null（调用方按「空表」处理，不抛错）。 */
export function parseSheetBody(content: string | null | undefined): SheetDoc | null {
  if (!content) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const doc = parsed as Partial<SheetDoc>;
  if (doc.kind !== SHEET_DOC_KIND || doc.version !== SHEET_DOC_VERSION || !Array.isArray(doc.sheets)) return null;
  const sheets = doc.sheets.filter(
    (sheet): sheet is SheetWorksheet => !!sheet && typeof sheet === "object" && typeof (sheet as SheetWorksheet).name === "string",
  );
  if (sheets.length === 0) return null;
  return { kind: SHEET_DOC_KIND, version: SHEET_DOC_VERSION, sheets };
}

/** FortuneSheet 运行时字段（选区等）——不持久化：属 L3 本机派生，不入正文。 */
const TRANSIENT_SHEET_KEYS = ["luckysheet_select_save", "luckysheet_selection_range", "scrollLeft", "scrollTop"] as const;

/**
 * 本机视图字段（用户 261006）：**当前工作表**（`status`）与**缩放**（`zoomRatio`）只改展示、且与设备/窗口相关
 * ⇒ 落 `sheetViewStore`（localStorage），不进正文、不进 S3。旧正文里可能有它们：读时照常读、保存时剔除。
 * （与 TRANSIENT 分开：这两个是「本机持久化的展示状态」，不是每次 onChange 都会变的运行时字段。）
 */
const LOCAL_SHEET_KEYS = ["status", "zoomRatio"] as const;

/** dense `data` 矩阵 → sparse `celldata`（只保留非空格子）。 */
function denseToCelldata(data: Array<Array<SheetCellValue | null>>): SheetCell[] {
  const out: SheetCell[] = [];
  for (let r = 0; r < data.length; r += 1) {
    const row = data[r];
    if (!Array.isArray(row)) continue;
    for (let c = 0; c < row.length; c += 1) {
      const v = row[c];
      if (v == null) continue;
      if (typeof v === "object" && !Array.isArray(v) && Object.keys(v).length === 0) continue;
      out.push({ r, c, v });
    }
  }
  return out;
}

/**
 * 把编辑器返回的 sheet 规范化成可持久化形态：
 * - 剔除选区/滚动等运行时字段（否则每次点选都会改正文 ⇒ 内容寻址对象无端膨胀、跨端无意义 diff）；
 * - dense `data` → sparse `celldata`（正文体积正比于「非空格子数」而不是网格面积）；
 * - 浮动图 `images[].src`：本地资产 URL → filename（正文不存 URL、不存 base64；几何/其余字段逐字节保留）。
 */
export function sanitizeSheetWorksheet(sheet: SheetWorksheet): SheetWorksheet {
  const source = sheet as SheetWorksheet & { data?: Array<Array<SheetCellValue | null>> };
  const rest = { ...source } as Record<string, unknown>;
  for (const key of TRANSIENT_SHEET_KEYS) delete rest[key];
  for (const key of LOCAL_SHEET_KEYS) delete rest[key];
  const celldata = Array.isArray(source.data) ? denseToCelldata(source.data) : (source.celldata ?? []);
  delete rest.data;
  if (Array.isArray(rest.images)) {
    rest.images = (rest.images as unknown[]).map((item) => {
      if (!item || typeof item !== "object") return item;
      const image = item as Record<string, unknown>;
      return { ...image, src: sheetImageDiskSrc(image.src) };
    });
  }
  return { ...rest, celldata } as SheetWorksheet;
}

/** sheets → 正文 JSON（统一走规范化：剔运行时字段 + dense→sparse）。 */
export function sheetsToBody(sheets: SheetWorksheet[]): string {
  const doc: SheetDoc = { kind: SHEET_DOC_KIND, version: SHEET_DOC_VERSION, sheets: sheets.map(sanitizeSheetWorksheet) };
  return JSON.stringify(doc);
}

/**
 * 表格正文 → 供全文搜索的纯文本（取各表 celldata 的显示/值文本，按行列顺序拼接；超长截断）。
 * 与 Lake 的 `lakeHtmlToPlain` 职责对应：非文档类型的正文不能喂给 HTML 解析器。
 */
export function sheetToSearchText(content: string | null | undefined, maxChars = 20000): string {
  const doc = parseSheetBody(content);
  if (!doc) return "";
  const parts: string[] = [];
  const reachedLimit = () => parts.join("\n").length > maxChars;
  for (const sheet of doc.sheets) {
    if (parts.length > 0) parts.push(`[${sheet.name}]`);
    const rows = new Map<number, Array<{ c: number; text: string }>>();
    for (const cell of sheet.celldata ?? []) {
      if (!cell || !Number.isFinite(cell.r) || !Number.isFinite(cell.c)) continue;
      const raw = cell.v?.m ?? cell.v?.v;
      if (raw == null || raw === "") continue;
      const text = String(raw);
      const row = rows.get(cell.r) ?? [];
      row.push({ c: cell.c, text });
      rows.set(cell.r, row);
    }
    for (const r of [...rows.keys()].sort((a, b) => a - b)) {
      parts.push((rows.get(r) ?? []).sort((a, b) => a.c - b.c).map((x) => x.text).join("\t"));
      if (reachedLimit()) break;
    }
    if (reachedLimit()) break;
  }
  const text = parts.join("\n");
  return text.length > maxChars ? text.slice(0, maxChars) : text;
}
