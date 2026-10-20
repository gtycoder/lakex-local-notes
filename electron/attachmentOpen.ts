/**
 * 「用系统应用打开附件」的落地实现（261020）：压缩包先复制/硬链接到临时目录再打开。
 *
 * 为什么单独一层：`ipc/registerNotes.ts` 里那堆 handler 不好单测，而这段策略（直接开 / 挪到临时目录）
 * 恰恰是最容易写错、也最容易在 macOS 上悄悄把目录堆进 note-assets 的地方 ⇒ 逻辑放这里，依赖注入、可测。
 *
 * ⚠️ 跨卷回落的那次复制必须是**异步**：主进程同步复制一个几百 MB 的压缩包会整窗卡死。
 */
import path from "node:path";
import { ATTACHMENT_OPEN_TEMP_DIR, isArchiveAttachment } from "../src/core/attachmentOpen.js";

export interface AttachmentOpenFs {
  removeDir(p: string): void | Promise<void>;
  makeDir(p: string): void | Promise<void>;
  /** 硬链接；跨卷/不支持时会抛，由调用方回落复制。 */
  link(from: string, to: string): void | Promise<void>;
  /** 回落复制（实现方应使用异步 API）。 */
  copy(from: string, to: string): void | Promise<void>;
}

export interface AttachmentOpenPlan {
  /** 要交给 shell.openPath 的路径。 */
  openPath: string;
  /** direct = 原地打开；temp-copy = 打开的是临时副本。 */
  mode: "direct" | "temp-copy";
}

/** 纯决策 + 副本准备（不调用 shell）。tempRoot 一般传 `app.getPath("temp")`。 */
export async function prepareAttachmentOpen(
  input: { noteId: string; filename: string; fullPath: string },
  tempRoot: string,
  fs: AttachmentOpenFs,
): Promise<AttachmentOpenPlan> {
  if (!isArchiveAttachment(input.filename)) return { openPath: input.fullPath, mode: "direct" };
  const dir = path.join(tempRoot, ATTACHMENT_OPEN_TEMP_DIR, input.noteId);
  // 每次打开先清掉这个笔记上一次的解压产物：临时目录只服务"这一次"，避免越攒越多
  await fs.removeDir(dir);
  await fs.makeDir(dir);
  const target = path.join(dir, input.filename);
  try {
    await fs.link(input.fullPath, target);
  } catch {
    await fs.copy(input.fullPath, target);
  }
  return { openPath: target, mode: "temp-copy" };
}
