/**
 * 用**内核模型选区**（不是 DOM range）支撑 AI 结果的「替换选区」。
 *
 * 依据（实证，来自云端语雀 lakex 的 AI 面板 bundle doc_editor.*.async.js）：
 *   • AI 面板捕获/使用的是**内核模型选区** `kernel.document.selection.firstRange`（模型态，
 *     对话框抢焦点也不会丢）；
 *   • 回写前先 `execCommand("selection", { ranges: [{start:{node,offset},end:{node,offset}}] })`
 *     把选区设回内核，再让内核按当前选区插入 ⇒ 非折叠选区即"替换"；
 *   • 云端替换 = `execCommand("aiInsert", { dataType, data, select, insertAtAfter:false })`，
 *     插入到下方 = 同命令 `insertAtAfter:true`。
 *
 * 我们内核（vendor lakex.js）确有 `pluginName:"selection"` 的 `selection` 命令与 `insertAtSelection`，
 * 但没有云端那版 `aiInsert` 插件 ⇒ 这里用「设回选区 + insertAtSelection」等价实现。
 * 注意：不需要 DOM→view 映射（那条路实测 `renderer.toViewRange` 返回 null，走不通）。
 *
 * 内核无类型声明 ⇒ 全程 try/catch；拿不到就返回 null，调用方回退到 DOM 路径。
 */
type AnyRec = Record<string, unknown>;

export interface CapturedModelRange {
  start: { node: unknown; offset: number };
  end: { node: unknown; offset: number };
}

/** 从内核文档模型里取当前选区（模型态）。 */
export function captureModelRange(editor: unknown): CapturedModelRange | null {
  try {
    const ed = (editor ?? {}) as AnyRec;
    const kernel = (ed.kernel ?? (ed.engine as AnyRec | undefined)?.kernel) as AnyRec | undefined;
    const doc = (kernel?.document ?? (kernel?.model as AnyRec | undefined)?.document) as AnyRec | undefined;
    const first = (doc?.selection as AnyRec | undefined)?.firstRange as AnyRec | undefined;
    const s = first?.start as { node?: unknown; offset?: unknown } | undefined;
    const e = first?.end as { node?: unknown; offset?: unknown } | undefined;
    if (!s?.node || !e?.node) return null;
    return {
      start: { node: s.node, offset: typeof s.offset === "number" ? s.offset : 0 },
      end: { node: e.node, offset: typeof e.offset === "number" ? e.offset : 0 },
    };
  } catch { return null; }
}

/** 把捕获的模型选区设回内核（`selection` 命令）。成功返回 true。 */
export function applyModelRange(editor: unknown, range: CapturedModelRange | null): boolean {
  if (!range) return false;
  try {
    const ed = (editor ?? {}) as AnyRec;
    if (typeof ed.execCommand !== "function") return false;
    (ed.execCommand as (n: string, a: unknown) => unknown).call(ed, "selection", { ranges: [{ start: range.start, end: range.end }] });
    return true;
  } catch { return false; }
}
