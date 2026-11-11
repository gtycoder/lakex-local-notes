/**
 * 「复制为 Lake」的内核来源注册表（261110）。
 *
 * 为什么要这张表：文档空间的「复制为 Lake」按**活动挂载点**找内核
 * （`editorInstanceAt(activeEditorMount())`，见 editorRegistry.ts）；AI 写作空间没有
 * `data-active` 的文档编辑器 —— 回答正文由 AiAnswerViewer 自己 createLakeDocument 建的
 * **只读 viewer** 承载。viewer 创建后把内核登记到这里，复制动作取「最近挂载的一个」
 * （长会话里离用户最近的答案 = 最后挂载的 viewer）。
 *
 * 只存内核引用（不建实例、不碰 DOM）；实例销毁**前**必须撤销，否则会命中已销毁实例
 * （内核 destroy 后 readData/writeData 不可用）。转换逻辑不在这里：单一来源 =
 * aiLakeClipboard 的 copyMarkdownAsLake；本文件只负责「到哪儿拿内核」。
 */
import type { LakePayloadKernel } from "./aiLakeClipboard";

/** 登记顺序 = 挂载顺序；同时存在多个回答 viewer 时取最后一个（最近的答案）。 */
const registered: LakePayloadKernel[] = [];

/** 登记内核（重复登记同一个实例只保留一份，并挪到「最近」位置）。 */
export function registerLakeKernel(kernel: LakePayloadKernel): void {
  const index = registered.indexOf(kernel);
  if (index >= 0) registered.splice(index, 1);
  registered.push(kernel);
}

/** 撤销登记（viewer 卸载/销毁前调用；找不到时静默无操作）。 */
export function unregisterLakeKernel(kernel: LakePayloadKernel): void {
  const index = registered.indexOf(kernel);
  if (index >= 0) registered.splice(index, 1);
}

/** 最近登记的内核；没有就返回 null（调用方回退到活动文档内核 / 隐藏宿主）。 */
export function getRegisteredLakeKernel(): LakePayloadKernel | null {
  return registered.length > 0 ? registered[registered.length - 1] : null;
}
