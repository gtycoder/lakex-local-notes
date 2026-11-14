/**
 * 画板自定义素材 = 数据目录下 `materials/` 里的画板文档 JSON（261114 用户点单：可打开文件夹放置/存储）。
 *
 * 只做文件 I/O 与格式校验（不依赖 electron，便于 vitest）：IPC 薄壳在 `electron/ipc/registerBoardMaterials.ts`。
 * 目录内容由用户可见：新增/删除素材 = 写/删一个 `.board.json` 文件；手动拷入的画板文档也能被识别。
 */
import fs from "node:fs";
import path from "node:path";
import {
  BOARD_MATERIAL_FILE_SUFFIX,
  BOARD_MATERIAL_MAX_FILE_BYTES,
  isBoardMaterialFileName,
  materialNameFromFile,
  parseBoardMaterialFile,
  safeMaterialFileStem,
  serializeBoardMaterialFile,
  type BoardMaterialEntry,
  type BoardMaterialSaveResult,
  type BoardMaterialsListResult,
} from "../src/core/boardMaterialFile.js";

export function boardMaterialsDir(root: string): string {
  return path.join(root, "materials");
}

function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

function isRegularFile(filePath: string): boolean {
  try { return fs.statSync(filePath).isFile(); } catch { return false; }
}

/** 读取目录下所有可识别的素材；坏文件只跳过并回报文件名，不影响其它素材。 */
export async function listBoardMaterials(root: string): Promise<BoardMaterialsListResult> {
  const dir = boardMaterialsDir(root);
  ensureDir(dir);
  const materials: BoardMaterialEntry[] = [];
  const skipped: string[] = [];
  let files: string[] = [];
  try { files = fs.readdirSync(dir); } catch { return { dir, materials, skipped }; }
  for (const file of files.sort()) {
    if (!isBoardMaterialFileName(file)) continue;
    const full = path.join(dir, file);
    if (!isRegularFile(full)) continue;
    try {
      const stat = fs.statSync(full);
      if (stat.size > BOARD_MATERIAL_MAX_FILE_BYTES) { skipped.push(file); continue; }
      const text = fs.readFileSync(full, "utf8");
      const entry = parseBoardMaterialFile(text, file, stat.mtimeMs);
      if (entry) materials.push(entry); else skipped.push(file);
    } catch { skipped.push(file); }
  }
  materials.sort((a, b) => b.createdAt - a.createdAt || a.name.localeCompare(b.name));
  return { dir, materials, skipped };
}

async function uniqueFileName(dir: string, stem: string): Promise<string> {
  const base = safeMaterialFileStem(stem);
  const suffix = BOARD_MATERIAL_FILE_SUFFIX;
  for (let index = 1; index <= 999; index += 1) {
    const candidate = index === 1 ? base + suffix : base + " (" + index + ")" + suffix;
    if (!fs.existsSync(path.join(dir, candidate))) return candidate;
  }
  return base + "-" + Date.now() + suffix;
}

/** 保存一条素材：写 `materials/<name>.board.json`（原子替换），返回实际文件名与回读条目。 */
export async function saveBoardMaterial(
  root: string,
  input: { name: string; elements: unknown[]; width?: number; height?: number },
): Promise<BoardMaterialSaveResult> {
  const dir = boardMaterialsDir(root);
  ensureDir(dir);
  const name = typeof input.name === "string" && input.name.trim() ? input.name.trim().slice(0, 200) : "素材";
  const entry: BoardMaterialEntry = {
    id: "",
    name,
    createdAt: Date.now(),
    elements: input.elements,
    ...(typeof input.width === "number" && Number.isFinite(input.width) && input.width > 0 ? { width: input.width } : {}),
    ...(typeof input.height === "number" && Number.isFinite(input.height) && input.height > 0 ? { height: input.height } : {}),
  };
  const text = serializeBoardMaterialFile(entry);
  if (Buffer.byteLength(text, "utf8") > BOARD_MATERIAL_MAX_FILE_BYTES) {
    throw new Error("素材过大（超过 64 MiB），请减少图片/内容后再保存");
  }
  const file = await uniqueFileName(dir, name);
  const full = path.join(dir, file);
  const temporary = full + ".tmp-" + process.pid + "-" + Math.random().toString(16).slice(2);
  try {
    fs.writeFileSync(temporary, text, "utf8");
    fs.renameSync(temporary, full);
  } catch (error) {
    try { fs.rmSync(temporary, { force: true }); } catch { /* best effort */ }
    throw error;
  }
  return { dir, file, material: { ...entry, id: file } };
}

/** 删除一条素材（只删 `materials/` 下白名单文件名，防路径穿越）。 */
export async function deleteBoardMaterial(root: string, file: string): Promise<{ removed: boolean; dir: string }> {
  const dir = boardMaterialsDir(root);
  if (!isBoardMaterialFileName(file)) throw new Error("无效的素材文件名");
  const full = path.join(dir, file);
  if (!isRegularFile(full)) return { removed: false, dir };
  fs.rmSync(full, { force: true });
  return { removed: true, dir };
}

/** 供 UI 显示：素材文件夹里的文件名（不含路径）。 */
export function boardMaterialDisplayName(file: string): string { return materialNameFromFile(file); }
