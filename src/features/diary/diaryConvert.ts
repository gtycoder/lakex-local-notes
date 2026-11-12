/**
 * 「转为文档」执行序（261112 task-91）：同一篇文档从日记本移到知识库笔记本 + 可选改名。
 *
 * 顺序固定 **先 move 再 rename**：主进程/渲染层都对「日记子树」拒绝改名（标题即日期，
 * `renameTreeNode` 的 `assertNotDiarySubtree` + AGENTS §3#25）——先把它移出日记子树，才是普通文档。
 * 失败一律**可见**（不静默）：move 失败 ⇒ 不动标题、直接报错；rename 失败 ⇒ 文档已移出，
 * 提示里明确写「已移出、但改名失败」，不假装成功。
 *
 * 这里不碰 IPC/native：动作由 App 注入（便于单测顺序与失败路径），渲染层不自己写第二套判据。
 */
import { getNativeErrorMessage } from "../../lib/nativeErrors";

export interface DiaryConvertIo {
  /** 移到目标笔记本（换父节点 = 移动；正文/历史/回收站跟着走）。 */
  move(nodeId: string, targetNotebookId: string): Promise<void>;
  /** 改标题（必须在移出日记子树之后调用，否则会被日记守卫拒绝）。 */
  rename(nodeId: string, title: string): Promise<void>;
  /** 重读目录树（让目标笔记本下立刻出现）。实现方负责把自身失败报进自己的错误通道。 */
  refresh(): Promise<void>;
  /** 成功提示（带最终标题）。 */
  notice(text: string): void;
  /** 失败提示（错误必须可见）。 */
  error(text: string): void;
}

export interface DiaryConvertInput {
  /** 日记条目的**树节点 id**（不是 noteFileId）。 */
  nodeId: string;
  targetNotebookId: string;
  /** 用户在弹窗里确认的标题（默认是日期键，可改）。 */
  title: string;
  /** 条目当前标题（= 日期键）：相同则跳过改名，不多写一次盘。 */
  previousTitle: string;
}

export interface DiaryConvertOutcome {
  moved: boolean;
  renamed: boolean;
}

export async function convertDiaryEntryToDocument(io: DiaryConvertIo, input: DiaryConvertInput): Promise<DiaryConvertOutcome> {
  const nextTitle = input.title.trim();
  try {
    await io.move(input.nodeId, input.targetNotebookId);
  } catch (reason) {
    io.error("转为文档失败：" + (getNativeErrorMessage(reason) || "未知错误"));
    return { moved: false, renamed: false };
  }
  const shouldRename = nextTitle.length > 0 && nextTitle !== input.previousTitle;
  if (shouldRename) {
    try {
      await io.rename(input.nodeId, nextTitle);
    } catch (reason) {
      await io.refresh();
      io.error("已移出日记本，但改名失败：" + (getNativeErrorMessage(reason) || "未知错误"));
      return { moved: true, renamed: false };
    }
  }
  await io.refresh();
  io.notice("已转为文档：" + (nextTitle || input.previousTitle));
  return { moved: true, renamed: shouldRename };
}
