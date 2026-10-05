/**
 * 内核实例 ↔ 挂载点 注册表（261005）。
 *
 * 为什么需要：拿不到 `editor` 实例的调用方（如 AI 面板的「复制为 Lake」）要按**当前挂载点**
 * 找到内核来调 `readData/writeData`。活动性判定仍归 `activeEditor.ts`（只认 data-active），
 * 这里只登记「这个挂载点对应哪个内核实例」，不做任何几何/显示推断。
 */
import type { LakeEditorInstance } from "./lakeRuntime";

const byMount = new WeakMap<HTMLElement, LakeEditorInstance>();

/** 由 createLakeDocument 在实例创建后登记（mount = .lake-editor-mount）。 */
export function registerEditorInstance(mount: HTMLElement, editor: LakeEditorInstance): void {
  byMount.set(mount, editor);
}

/** 按挂载点取内核实例；没有就返回 null（调用方各自回退）。 */
export function editorInstanceAt(mount: HTMLElement | null | undefined): LakeEditorInstance | null {
  return mount ? byMount.get(mount) ?? null : null;
}
