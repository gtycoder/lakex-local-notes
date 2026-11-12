/**
 * 小记**暂存空间**（staging/{draftId}/）：图片/附件落盘、sidecar、读取校验、丢弃
 * —— 261112 从 electron/quickNotes.ts 拆出。
 *
 * 边界：本模块**只碰 staging 目录**（不写正式 items/assets、不查业务表、不提交事务）。
 * 往正式路径搬家（promote）与「DB 事务 → promote」的顺序不变量在 savePipeline 里（V5 §5.3），
 * 不允许在这里顺便 promote —— 否则又会出现「文件先于 DB 落地」的半失败形态。
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import sharp from "sharp";
import { isSafePathSegment as isSafeSegment } from "../../src/core/storeUtils.js";
import { AppError } from "../../src/core/storeErrors.js";
import { buildAssetFilename, mimeTypeForFilename } from "../../src/core/assetNaming.js";
import { MAX_ATTACHMENT_BYTES } from "../../src/core/storeLimits.js";
import { sanitizeDisplayName } from "../resourceRepository.js";
import {
  QUICK_NOTE_VERSION,
  parseQuickNoteContent,
  validateQuickNoteImageBytes,
  validateQuickNoteImageDimensions,
} from "../quickNoteModel.js";
import type { QuickNoteImage, QuickNoteImageInput } from "../quickNoteTypes.js";
import {
  atomicWriteFile,
  sha256Hex,
  stagingDirOf,
  stagingImageUrlOf,
  toStoreValidation,
  uuid,
  validateStoredContent,
  type QuickNotePaths,
} from "./context.js";

export interface QuickNoteStagingDeps {
  readonly paths: QuickNotePaths;
}

/** 暂存一张图片（校验字节与像素上限；sidecar `.<id>.json` 与文件同目录）。 */
export async function stageImage(deps: QuickNoteStagingDeps, draftId: string, input: QuickNoteImageInput): Promise<QuickNoteImage> {
  if (!input || !(input.bytes instanceof Uint8Array) && !Array.isArray(input.bytes)) throw new AppError("InvalidInput", "图片数据无效");
  const bytes = Buffer.from(input.bytes);
  const format = toStoreValidation(() => validateQuickNoteImageBytes(bytes));
  const metadata = await sharp(bytes, { animated: true }).metadata().catch(() => null);
  if (!metadata?.width || !metadata?.height) throw new AppError("InvalidInput", "图片尺寸读取失败");
  toStoreValidation(() => validateQuickNoteImageDimensions({ width: metadata.width!, height: metadata.height! }));
  const id = uuid();
  const filename = `${Date.now()}_${crypto.randomBytes(4).toString("hex")}.${format.extension}`;
  const stagingDir = stagingDirOf(deps.paths, draftId);
  fs.mkdirSync(stagingDir, { recursive: true });
  const staged = {
    id, filename, mimeType: format.mimeType, width: metadata?.width ?? null, height: metadata?.height ?? null,
    size: bytes.length, hash: sha256Hex(bytes),
  };
  atomicWriteFile(path.join(stagingDir, filename), bytes);
  atomicWriteFile(path.join(stagingDir, `.${id}.json`), JSON.stringify(staged));
  return { ...staged, url: stagingImageUrlOf(draftId, filename) };
}

/**
 * 暂存一个**附件**（内核 file 卡：pdf/zip/docx/…）。与图片共用同一 staging 空间与 promote 路径，
 * 差别只在：不做图片校验（无 sharp、无像素上限），宽高恒为 null，MIME 由扩展名兜底。
 * 硬上限 = `MAX_ATTACHMENT_BYTES`（协议上限）；渲染层还会按用户设置的上传上限先拦一道。
 */
export function stageFile(deps: QuickNoteStagingDeps, draftId: string, input: QuickNoteImageInput): QuickNoteImage {
  if (!input || !(input.bytes instanceof Uint8Array) && !Array.isArray(input.bytes)) throw new AppError("InvalidInput", "附件数据无效");
  const bytes = Buffer.from(input.bytes);
  if (bytes.length === 0) throw new AppError("InvalidInput", "附件内容为空");
  if (bytes.length > MAX_ATTACHMENT_BYTES) {
    throw new AppError("InvalidInput", `附件超过 ${MAX_ATTACHMENT_BYTES / 1024 / 1024} MiB 上限`);
  }
  const original = typeof input.filename === "string" && input.filename.trim() ? input.filename : "attachment";
  const id = uuid();
  // 磁盘名用 buildAssetFilename（同步/引用提取统一），**卡片展示名 = 原始文件名**（与文档附件卡同口径，
  // 见 electron/resourceRepository.ts 的 attachmentOutput）；URL 里才是磁盘名。
  const stored = buildAssetFilename(original);
  const stagingDir = stagingDirOf(deps.paths, draftId);
  fs.mkdirSync(stagingDir, { recursive: true });
  const staged = {
    id, filename: stored, mimeType: mimeTypeForFilename(stored), width: null, height: null,
    size: bytes.length, hash: sha256Hex(bytes),
  };
  atomicWriteFile(path.join(stagingDir, stored), bytes);
  atomicWriteFile(path.join(stagingDir, `.${id}.json`), JSON.stringify(staged));
  return { ...staged, filename: sanitizeDisplayName(original), url: stagingImageUrlOf(draftId, stored) };
}

/** 丢弃整份草稿的 staging（取消编辑）。 */
export function discardDraft(deps: QuickNoteStagingDeps, draftId: string): void {
  fs.rmSync(stagingDirOf(deps.paths, draftId), { force: true, recursive: true });
}

function readStagedMetadata(stagingDir: string, imageIds: string[]): Array<Omit<QuickNoteImage, "url">> {
  // stagedImageIds encode no filename; renderer sends prior IPC return only. Persist a small sidecar would add state.
  // To keep the API unforgeable, each stage writes a hidden metadata file alongside the image.
  return imageIds.map((assetId) => {
    if (!isSafeSegment(assetId)) throw new AppError("InvalidInput", "无效的暂存图片 ID");
    const metaPath = path.join(stagingDir, `.${assetId}.json`);
    let raw: unknown;
    try { raw = parseQuickNoteContent(fs.readFileSync(metaPath, "utf8")); } catch { throw new AppError("NotFound", "暂存图片已失效，请重新添加"); }
    const image = validateStoredContent({ version: QUICK_NOTE_VERSION, text: "x", body: "<p><br></p>", images: [raw] }).images[0];
    const imagePath = path.join(stagingDir, image.filename);
    if (!fs.existsSync(imagePath)) throw new AppError("NotFound", "暂存图片文件不存在");
    const bytes = fs.readFileSync(imagePath);
    if (bytes.length !== image.size || sha256Hex(bytes) !== image.hash) throw new AppError("InvalidInput", "暂存图片校验失败");
    return image;
  });
}

/**
 * 读取该 staging 目录里**全部**已落盘的资源 sidecar（按文件名排序保证确定性）。
 *
 * 260919：资源清单改以**正文引用**为准。渲染层传来的 `stagedImageIds` 会受"点击保存早于
 * 上传/插卡落地"的时序影响（用户实测：卡片流正常、一进编辑视频/附件就没了 —— 正文里有卡片、
 * 资源清单里却没有该资源，promote 也就没发生）。staging 目录是落盘事实，这里补齐"正文引用到
 * 但没在 ids 里"的资源；保存时再统一按正文过滤，两个方向的不一致都能收敛。
 */
export function readAllStagedMetadata(stagingDir: string): Array<Omit<QuickNoteImage, "url">> {
  if (!fs.existsSync(stagingDir)) return [];
  const ids = fs.readdirSync(stagingDir)
    .filter((name) => name.startsWith(".") && name.endsWith(".json"))
    .map((name) => name.slice(1, -".json".length))
    .filter((id) => isSafeSegment(id))
    .sort();
  const out: Array<Omit<QuickNoteImage, "url">> = [];
  for (const id of ids) {
    try { out.push(...readStagedMetadata(stagingDir, [id])); } catch { /* 半截/损坏的 sidecar 直接跳过 */ }
  }
  return out;
}

/** 保存主路径按「ids 点名」读取暂存资源（与 readAllStagedMetadata 并集后按正文过滤）。 */
export { readStagedMetadata };

/** 删除单张未保存暂存图片。 */
export function discardStagedImage(deps: QuickNoteStagingDeps, draftId: string, assetId: string): void {
  if (!isSafeSegment(assetId)) return;
  const dir = stagingDirOf(deps.paths, draftId);
  const metaPath = path.join(dir, `.${assetId}.json`);
  try {
    const raw = parseQuickNoteContent(fs.readFileSync(metaPath, "utf8"));
    const image = validateStoredContent({ version: QUICK_NOTE_VERSION, text: "x", body: "<p><br></p>", images: [raw] }).images[0];
    fs.rmSync(path.join(dir, image.filename), { force: true });
  } catch { /* metadata/file may already be gone */ }
  fs.rmSync(metaPath, { force: true });
}
