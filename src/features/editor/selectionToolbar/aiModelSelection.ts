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

/**
 * 把捕获的模型选区设回内核（`selection` 命令）。成功返回 true。
 *
 * ⚠️ 必须走 **kernel.execCommand**，不是 editor.execCommand（261005 实测）：
 * editor 层的 `selection` 会拿模型节点去 `Range.setStart`（要 DOM 节点）⇒ 抛
 * `setStart: parameter 1 is not of type 'Node'`，而这里包了 try/catch 会**静默失败**。
 * 模型选区命令实际由 kernel 提供，用 kernel 调用才真正把选区设回（实测生效）。
 */
export function applyModelRange(editor: unknown, range: CapturedModelRange | null): boolean {
  if (!range) return false;
  try {
    const ed = (editor ?? {}) as AnyRec;
    const kernel = (ed.kernel ?? (ed.engine as AnyRec | undefined)?.kernel) as AnyRec | undefined;
    const target = kernel && typeof kernel.execCommand === "function" ? kernel : ed;
    if (typeof target.execCommand !== "function") return false;
    (target.execCommand as (n: string, a: unknown) => unknown).call(target, "selection", { ranges: [{ start: range.start, end: range.end }] });
    return true;
  } catch { return false; }
}

/** 模型节点只按我们实测到的字段访问（内核无类型声明）。 */
function modelParentOf(node: AnyRec): AnyRec | null {
  const p = node._parent;
  return p && typeof p === "object" ? (p as AnyRec) : null;
}

function modelChildrenOf(node: AnyRec): AnyRec[] {
  const c = node._children;
  if (!c) return [];
  return Array.isArray(c) ? (c as AnyRec[]) : Array.from(c as ArrayLike<AnyRec>);
}

function modelIdOf(node: AnyRec): string | null {
  const id = node.id ?? node._id;
  return typeof id === "string" && id ? id : null;
}

/**
 * 「插入到选区后」的落点：把捕获的模型选区**末端所在的顶层块**之后，换算成
 * `insertAtPosition` 需要的 `{ id: 父节点, offset: 子索引 }`（offset = 在该父节点第 N 个子节点前插入）。
 *
 * 为什么不用 DOM→模型映射（`engine.transformDOMRange(setStartAfter(el))`）：
 * 实测内核把「某元素之后」映射成**该元素自己的子索引**（少 1）——例如 4 项列表会落到
 * 「第 3 项之后」，这正是「插入到选区后」把最后一项落下 / 位置错位的来源。模型节点自带
 * `_parent`，直接按父节点的 `_children` 求下标最准确，也与列表在模型里是**一个 `<ul>`**、
 * 在 DOM 里被摊平成多个兄弟项这个差异无关。
 */
export function positionAfterModelRange(range: CapturedModelRange | null): { id: string; offset: number } | null {
  const end = (range?.end?.node ?? null) as AnyRec | null;
  if (!end) return null;
  try {
    // 从选区末端一路向上取到「根的直接子节点」（= 顶层块）；根 = `_parent` 为空的节点。
    const chain: AnyRec[] = [];
    let node: AnyRec = end;
    for (let p = modelParentOf(node); p; p = modelParentOf(node)) { chain.push(node); node = p; }
    const rootId = modelIdOf(node);
    if (!rootId) return null;
    const kids = modelChildrenOf(node);
    const block = chain.length > 0 ? chain[chain.length - 1] : null;
    const idx = block ? kids.indexOf(block) : -1;
    return { id: rootId, offset: idx < 0 ? kids.length : idx + 1 };
  } catch { return null; }
}
