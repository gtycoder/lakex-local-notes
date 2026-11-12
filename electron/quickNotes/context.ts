/**
 * 小记库的**共享上下文与纯工具**（261112 拆分，05 报告 S-3）。
 *
 * 为什么有这个文件（原 `electron/quickNotes.ts` 1451 行单类）：
 * 拆分后各子模块只拿**窄依赖**，路径/原子写/校验/toStoreValidation 这些被所有人用到的东西
 * 放这里一份 —— 否则每个模块都会各写一份，变成新的重复来源（AGENTS §3「单一来源」）。
 *
 * 纪律：本文件只放**无状态**的路径、落盘、纯工具；不碰任何业务判断、不查库、不 import 子模块
 * （子模块之间的依赖方向必须是单向的，见 quickNotes/index.ts 的装配顺序）。
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { isSafePathSegment as isSafeSegment } from "../../src/core/storeUtils.js";
import { AppError } from "../../src/core/storeErrors.js";
import { ASSET_PORT } from "../assetServer.js";
import { localAssetHttpUrl } from "../../src/core/assetUrl.js";
import { QuickNoteModelError, validateQuickNoteContent, type StoredQuickNoteContent } from "../quickNoteModel.js";

/** V5 §5.3：save/import 轻量 staging 文件约定（staging/{draftId|stagingKey}/ 内）。 */
export const SAVE_BODY_FILE = "content.qnote";
export const SAVE_META_FILE = "meta.json";

/** 小记数据空间的四个根目录（items/assets/staging 都在 quick-notes 下）。 */
export interface QuickNotePaths {
  /** `<workspace>/quick-notes` */
  readonly root: string;
  readonly itemsDir: string;
  readonly assetsDir: string;
  readonly stagingDir: string;
}

export function nowIso(): string { return new Date().toISOString(); }
export function uuid(): string { return crypto.randomUUID(); }
export function sha256Hex(bytes: Buffer | string): string { return crypto.createHash("sha256").update(bytes).digest("hex"); }

export function itemPathOf(paths: QuickNotePaths, id: string): string {
  if (!isSafeSegment(id)) throw new AppError("InvalidInput", `无效的小记 ID: ${id}`);
  return path.join(paths.itemsDir, `${id}.qnote`);
}

export function assetDirOf(paths: QuickNotePaths, id: string): string {
  if (!isSafeSegment(id)) throw new AppError("InvalidInput", `无效的小记 ID: ${id}`);
  return path.join(paths.assetsDir, id);
}

export function stagingDirOf(paths: QuickNotePaths, draftId: string): string {
  if (!isSafeSegment(draftId)) throw new AppError("InvalidInput", "无效的小记草稿会话");
  return path.join(paths.stagingDir, draftId);
}

export function quickImageUrlOf(noteId: string, filename: string): string {
  return localAssetHttpUrl(noteId, filename, { port: ASSET_PORT, space: "quick-notes" });
}

export function stagingImageUrlOf(draftId: string, filename: string): string {
  return `http://127.0.0.1:${ASSET_PORT}/quick-notes/staging/${draftId}/${filename}`;
}

/** 原子写：同目录临时文件 + rename（pid 后缀防同进程并发同名）。 */
export function atomicWriteFile(filePath: string, bytes: string | Buffer): void {
  const temporary = `${filePath}.tmp-${process.pid}`;
  fs.writeFileSync(temporary, bytes);
  fs.renameSync(temporary, filePath);
}

/** 模型层错误 → Store 层结构化错误（IPC 能带上可分类的 code）。 */
export function toStoreValidation<T>(operation: () => T): T {
  try { return operation(); }
  catch (error) {
    if (error instanceof QuickNoteModelError) throw new AppError(error.kind, error.message);
    throw error;
  }
}

/** 落盘内容校验（model 层唯一判据 + Store 错误包装）；staging/save/trash/missing 共用这一份。 */
export function validateStoredContent(raw: unknown): StoredQuickNoteContent {
  return toStoreValidation(() => validateQuickNoteContent(raw));
}
