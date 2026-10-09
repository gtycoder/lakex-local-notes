/**
 * 表格（usheet）粘贴图片的落点判据 —— 用户 261010 定稿：**默认落「单元格图片」**，
 * 除非没有选中单元格（那种情况才保持内核默认的浮动图）。
 *
 * 本文件三个纯函数是这条规则的**全部判据**（可单测；真实端粘贴不好在 CI 里驱动）：
 *   ① `pasteImageTarget`   —— 落点：单元格图片 / 内核默认浮动图；
 *   ② `imageFilesFromClipboard` —— 剪贴板里到底有没有图片文件；
 *   ③ `isPureImageClipboard`    —— 是不是「纯图片」粘贴（带文本/HTML 时交回内核）。
 *
 * ## 为什么只能在 DOM 层收口（v1.0.3 读码 + 实测）
 * - 内核把图片粘贴的落点**写死在命令里**：`sheets-drawing-ui` 的剪贴板钩子 `onPasteFiles`
 *   只要剪贴板里有图片文件就无条件返回
 *   `{ redos: [{ id: "sheet.command.insert-float-image", params: { files } }] }`（浮动图）。
 * - 而 `sheets-ui` 的 `_executePaste` 是**聚合语义**：把所有 enabled 钩子返回的 undo/redo
 *   mutations **串起来一起执行** ⇒ 我们再注册一个钩子只会「单元格图 + 浮动图」两张都插。
 * - 换掉那条命令也不行：`CommandRegistry.registerCommand` 对已存在 id **抛错**
 *   （必须先 unregister），而注入进来的 `CommandService` **没有 getCommand**（原实现拿不到，
 *   没法做兜底委托），`beforeCommandExecuted` 的返回值又被忽略（不能取消命令）。
 * ⇒ 结论：在 **window 捕获阶段**（早于内核任何 document / 元素监听）拦下**纯图片**粘贴，自己做
 *   「上传成资产 → 单元格图片」；其余情况一律不拦，交回内核（行为与今天完全一致）。
 *
 * 多图（≥2）时单元格只能容纳一张，硬塞会静默丢图 —— 按 AGENTS §3#16「绝不静默丢弃用户输入」
 * 回退内核默认（浮动图，每张都保留）。
 */
export type PasteImageTarget = "cell" | "float";

/** 粘贴图片落点：单图 + 有活动单元格 ⇒ 单元格图片；其余（无选中 / 多图 / 空）⇒ 内核默认浮动图。 */
export function pasteImageTarget(files: readonly unknown[] | null | undefined, hasActiveRange: boolean): PasteImageTarget {
  const count = files?.length ?? 0;
  if (count === 1 && hasActiveRange) return "cell";
  return "float";
}

/** 剪贴板里结构上够我们读的东西（DataTransfer 的最小子集，便于单测）。 */
export interface ClipboardLike {
  items?: ArrayLike<{ kind?: string; type?: string; getAsFile?: () => File | null }> | null;
  files?: ArrayLike<File> | null;
}

/** 剪贴板里的图片文件（内核同口径：先看 items(kind=file, type=image/*)，再回退 files）。 */
export function imageFilesFromClipboard(data: ClipboardLike | null | undefined): File[] {
  const fromItems: File[] = [];
  const items = data?.items;
  if (items) {
    for (let i = 0; i < items.length; i += 1) {
      const item = items[i];
      if (!item || item.kind !== "file" || typeof item.type !== "string" || !item.type.startsWith("image/")) continue;
      const file = item.getAsFile?.();
      if (file) fromItems.push(file);
    }
  }
  if (fromItems.length > 0) return fromItems;
  const out: File[] = [];
  const files = data?.files;
  if (files) {
    for (let i = 0; i < files.length; i += 1) {
      const file = files[i];
      if (file && typeof file.type === "string" && file.type.startsWith("image/")) out.push(file);
    }
  }
  return out;
}

/** 是否「纯图片」剪贴板：没有文本/HTML 负载才由我们接管（带文本的粘贴交回内核自己的文本/HTML 路径）。 */
export function isPureImageClipboard(readText: (type: string) => string): boolean {
  try {
    if ((readText("text/plain") ?? "").trim().length > 0) return false;
    return (readText("text/html") ?? "").trim().length === 0;
  } catch {
    return true; // 读不到文本信息时按纯图片处理（内核也只看图片文件）
  }
}
