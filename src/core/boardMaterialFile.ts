/**
 * 画板「自定义素材」文件格式（261114 用户点单：不再存 localStorage，改存**可打开的文件夹**）。
 *
 * 目录 = 数据目录下 `materials/`（桌面；面板里可一键打开）。每个素材一个 `.board.json` 文件，
 * 写法 = **画板文档正文**（`kind:"board"`）＋额外 `material` 元数据 ⇒ 用户也能把 `boards/{id}.board.json`
 * 这类画板文档直接丢进素材文件夹当素材用。
 *
 * 这是**设备本地**能力（不进 S3、不跨端）：图片仍是素材文件里的 data URL，插入画板并保存时才进
 * 该画板的 `note-assets/{noteId}/` 走资产管线；素材文件本身可被用户拷走/备份。
 */

export const BOARD_MATERIAL_FILE_SUFFIX = ".board.json";
/** 单个素材文件读取上限（IPC 两侧共用；防止一次 read 把主进程/渲染层撑爆）。 */
export const BOARD_MATERIAL_MAX_FILE_BYTES = 64 * 1024 * 1024;

export interface BoardMaterialEntry {
  /** 素材 id = 文件名（含后缀；用户重命名文件 = 换 id，下次打开列表即生效）。 */
  id: string;
  name: string;
  createdAt: number;
  /** 画板场景（与 `boardDoc.BoardDoc.elements` / 卡片 `plaitValue` 同构）。 */
  elements: unknown[];
  width?: number;
  height?: number;
}

export type BoardMaterialsRequest =
  | { op: "list" }
  | { op: "save"; name: string; elements: unknown[]; width?: number; height?: number }
  | { op: "delete"; file: string }
  | { op: "open" };

export interface BoardMaterialsListResult {
  dir: string;
  materials: BoardMaterialEntry[];
  /** 读不出/格式不认的文件名（列表仍可用，UI 可选择忽略）。 */
  skipped: string[];
}

export interface BoardMaterialSaveResult { dir: string; file: string; material: BoardMaterialEntry }

function isFinitePositive(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/** 文件名 → 可读素材名：去掉 `.board.json` / `.json` 后缀。 */
export function materialNameFromFile(file: string): string {
  return file.replace(/\.board\.json$/i, "").replace(/\.json$/i, "").trim() || "素材";
}

export function isBoardMaterialFileName(file: string): boolean {
  if (typeof file !== "string" || !file) return false;
  if (file !== file.split("/").pop() || file !== file.split("\\").pop()) return false;
  if (file.startsWith(".") || file === "." || file === "..") return false;
  return /\.json$/i.test(file);
}

/** 生成落盘文件名（安全字符 + 长度上限；重名由调用方加后缀）。 */
export function safeMaterialFileStem(name: string): string {
  const cleaned = String(name ?? "")
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-")
    .replace(/\s+/g, " " )
    .trim()
    .replace(/^\.+/, "")
    .slice(0, 80)
    .trim();
  return cleaned || "素材";
}

interface ParsedRecord { record: Record<string, unknown>; elements: unknown[]; name: string; createdAt: number; width?: number; height?: number }

function parseMaterialRecord(text: string, file: string, fallbackCreatedAt: number): ParsedRecord | null {
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { return null; }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  const elements = Array.isArray(record.elements)
    ? record.elements
    : Array.isArray(record.plaitValue)
      ? record.plaitValue
      : null;
  if (!elements) return null;
  const material = record.material && typeof record.material === "object" && !Array.isArray(record.material)
    ? (record.material as Record<string, unknown>)
    : null;
  const name = (typeof material?.name === "string" && material.name.trim())
    || (typeof record.name === "string" && record.name.trim())
    || materialNameFromFile(file);
  const createdAt = (typeof material?.createdAt === "number" && Number.isFinite(material.createdAt))
    ? material.createdAt
    : (typeof record.createdAt === "number" && Number.isFinite(record.createdAt) ? record.createdAt : fallbackCreatedAt);
  return {
    record,
    elements,
    name: name.trim().slice(0, 200),
    createdAt,
    ...(isFinitePositive(material?.width) ? { width: material.width } : {}),
    ...(isFinitePositive(material?.height) ? { height: material.height } : {}),
  };
}

/** 解析一个素材文件（同时兼容“我们的素材文件”和“普通画板文档”）。 */
export function parseBoardMaterialFile(
  text: string,
  file: string,
  fallbackCreatedAt = 0,
): BoardMaterialEntry | null {
  if (!isBoardMaterialFileName(file)) return null;
  const parsed = parseMaterialRecord(text, file, fallbackCreatedAt);
  if (!parsed) return null;
  return {
    id: file,
    name: parsed.name,
    createdAt: parsed.createdAt,
    elements: parsed.elements,
    ...(parsed.width !== undefined ? { width: parsed.width } : {}),
    ...(parsed.height !== undefined ? { height: parsed.height } : {}),
  };
}

/** 序列化为「画板文档 + material 元数据」：文件本身仍是一篇可读的画板文档 JSON。 */
export function serializeBoardMaterialFile(entry: BoardMaterialEntry): string {
  return JSON.stringify({
    kind: "board",
    version: 1,
    engine: "drawnix",
    preset: "drawing",
    elements: entry.elements,
    material: {
      name: entry.name,
      createdAt: entry.createdAt,
      ...(entry.width !== undefined ? { width: entry.width } : {}),
      ...(entry.height !== undefined ? { height: entry.height } : {}),
    },
  });
}
