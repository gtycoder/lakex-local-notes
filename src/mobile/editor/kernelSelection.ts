/**
 * 内核模型选区（261017）：撤销/重做恢复快照后，必须把**内核选区**放回编辑点。
 *
 * 为什么必须走内核：`setDocument` 会把模型选区重置到文档开头；只改 DOM selection 时
 * 光标看起来在编辑点，但下一个输入命令仍按模型选区插入 ⇒ 新内容跑到开头（用户 261017 报）。
 * 内核 job 提供 `setSelectionFromJson`（选择 JSON 可从 `document.selection.toJSON()` 拿到），
 * 实测恢复后 `execCommand("input", …)` 会插在恢复的位置。
 */
import type { LakeEditorInstance } from "../../features/editor/lakeRuntime";

/** 内核对象（闭源，无类型声明）——只声明用到的私有字段。 */
interface KernelInternals {
  _model?: {
    _document?: { selection?: { toJSON?: () => unknown } };
    _editing?: {
      newJob?: () => KernelJob | null;
      commitJob?: (job: KernelJob) => void;
      cancelJob?: (job: KernelJob) => void;
    };
  };
  renderer?: { repaintSelection?: () => void };
}

interface KernelJob {
  setSelectionFromJson?: (json: unknown) => void;
}

function internals(editor: LakeEditorInstance | null): KernelInternals | null {
  const kernel = (editor as unknown as { kernel?: KernelInternals } | null)?.kernel;
  return kernel ?? null;
}

/** 读当前内核选区并序列化（Selection JSON 很小，可直接进快照）。 */
export function readKernelSelection(editor: LakeEditorInstance | null): string | null {
  try {
    const json = internals(editor)?._model?._document?.selection?.toJSON?.();
    return json ? JSON.stringify(json) : null;
  } catch {
    return null;
  }
}

/** 把内核选区恢复到快照时刻的位置；返回是否成功（失败时调用方保留 DOM 兜底）。 */
export function applyKernelSelection(editor: LakeEditorInstance | null, json: string | null): boolean {
  if (!json) return false;
  try {
    const k = internals(editor);
    const editing = k?._model?._editing;
    const job = editing?.newJob?.();
    if (!job || !editing?.commitJob) return false;
    job.setSelectionFromJson?.(JSON.parse(json));
    editing.commitJob(job);
    k?.renderer?.repaintSelection?.();
    return true;
  } catch {
    return false;
  }
}
