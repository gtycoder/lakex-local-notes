/**
 * 移动端执行内核命令的**唯一入口**（261017 修）。
 *
 * 为什么需要回退：内核实例形态并不统一 —— 小记写作卡拿到的实例带 `.renderer.execCommand`，
 * 而**文档编辑器**（LakeEditor → createLakeDocument）拿到的实例只有 `.execCommand`、没有 `.renderer`。
 * 移动端此前各处直接写 `editor.renderer?.execCommand(...)` ⇒ 在文档里全部**静默 no-op**
 *（加粗 / 列表 / 撤销 / 重做 / 插入表格 / 附件 / 大纲展开都失效；用户 261017 报「撤销没反应」）。
 *
 * 判据单一来源：按 `renderer.execCommand → editor.execCommand` 顺序取第一个可用者。
 * **新代码不要再直接访问 `.renderer.execCommand`**；要执行命令一律走这里。
 */
import type { LakeEditorInstance } from "../../features/editor/lakeRuntime";

type Exec = (name: string, ...args: unknown[]) => unknown;

export function execEditorCommand(
  editor: LakeEditorInstance | null | undefined,
  command: string,
  ...args: unknown[]
): unknown {
  if (!editor) return undefined;
  try {
    const renderer = (editor as unknown as { renderer?: { execCommand?: Exec } }).renderer;
    if (renderer && typeof renderer.execCommand === "function") {
      return renderer.execCommand(command, ...args);
    }
  } catch { /* 落到实例直调 */ }
  try {
    const direct = (editor as unknown as { execCommand?: Exec }).execCommand;
    if (typeof direct === "function") return direct.call(editor, command, ...args);
  } catch { /* 命令失败不阻断 */ }
  return undefined;
}
