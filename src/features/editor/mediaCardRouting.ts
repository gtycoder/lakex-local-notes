/**
 * 附件 → 音视频卡自动分发（桌面/移动端共用，挂到 Lake 编辑器实例）。
 *
 * 背景：Lake 的「附件」路径（原生工具栏/slash 的附件、dropFile、移动端 insertFiles）
 * 一律产出文件卡（file card），音频/视频/图片都落成附件卡；而原生音频/视频/图片卡
 * （slash「音频/视频/图片」）在编辑器内嵌播放/显示。这里在附件路径插入时按扩展名
 * （mediaKindOfFilename）自动分发为 audio/video/image 三类原生卡，其余保持附件卡。
 *
 * 机制（经 CDP 实测验证）：
 *  - Lake 的 fileReader 按 readData 选项分发：`{ category: "audio", from: "ui" }` →
 *    audio reader（uploadAudioFile + createCard("audio")）；`category: "video"` 同理。
 *    `insertFiles` 命令把第三参数原样透传给 readData（Hme.execute → readData("Files", t, n)）。
 *  - 附件路径的原始调用是 `execCommand("insertFiles", files, { from: "ui", category: "file" })`。
 *  - `beforeExecCommand` 事件（`editor.editing.on`）在命令执行前触发，事件对象为
 *    `{ commandName, args }` 引用——改写 `args` 即可重定向命令（实测生效）。
 *
 * 分发策略（保持插入顺序）：
 *  - 同批文件全为同一媒体类型（如全是 mp3）→ 直接改写原命令 args 为
 *    `[files, { category, from }]`，单次事务完成，顺序保持。
 *  - 混合类型（如 mp3 + pdf + mp4）→ 原命令 args[0] 置空（readData([]) 为无副作用
 *    no-op），再异步按原顺序分批重发（audio/video 带 category，其余保持附件路径）。
 *  - 已有明确 category（audio/video/image/localDoc）或非媒体文件 → 不拦截。
 *
 * 防递归：重发批次带 category（handler 放行）＋ `rerouting` 标志双保险。
 */

import { mediaKindOfFilename } from "../../core/assetNaming.js";
import type { LakeEditorInstance } from "./lakeRuntime.js";

/** 已有明确卡片类型的 category——不参与自动分发（图片保持图片卡，音视频保持音视频卡）。 */
const ROUTING_IGNORE_CATEGORIES = new Set(["audio", "video", "image", "localDoc", "localdoc"]);

interface BeforeExecEvent {
  commandName?: string;
  args?: unknown[];
}

interface MediaRoutingEditing {
  on?(event: string, listener: (event: BeforeExecEvent) => void): unknown;
  off?(event: string, listener: (event: BeforeExecEvent) => void): unknown;
}

interface MediaRoutingRenderer {
  execCommand?(name: string, ...args: unknown[]): unknown;
}

function rendererOf(editor: LakeEditorInstance): MediaRoutingRenderer | null {
  try {
    return (editor as unknown as { renderer?: MediaRoutingRenderer }).renderer ?? null;
  } catch {
    return null;
  }
}

function editingOf(editor: LakeEditorInstance): MediaRoutingEditing | null {
  try {
    return (editor as unknown as { editing?: MediaRoutingEditing }).editing ?? null;
  } catch {
    return null;
  }
}

/**
 * 安装附件 → 音视频卡自动分发。
 * 返回清理函数（编辑器销毁时调用）。
 */
export function installMediaCardCategoryRouter(editor: LakeEditorInstance): () => void {
  const editing = editingOf(editor);
  if (!editing || typeof editing.on !== "function") return () => undefined;

  let rerouting = false;
  const pendingTimers = new Set<ReturnType<typeof setTimeout>>();

  const dispatchBatch = (renderer: MediaRoutingRenderer, files: File[], category: string | undefined, from: unknown): void => {
    try {
      renderer.execCommand?.("insertFiles", files, category ? { category, from } : { from });
    } catch {
      /* 单批失败不阻断后续批次 */
    }
  };

  const handler = (event: BeforeExecEvent): void => {
    if (rerouting) return;
    const cmd = event.commandName;
    if (cmd !== "insertFiles" && cmd !== "dropFile") return;
    const args = event.args;
    if (!Array.isArray(args)) return;
    const files = args[0];
    if (!Array.isArray(files) || files.length === 0) return;
    const opts = (args[1] ?? {}) as Record<string, unknown>;
    const existingCategory = typeof opts.category === "string" ? opts.category : undefined;
    if (existingCategory && ROUTING_IGNORE_CATEGORIES.has(existingCategory)) return;
    // 保持原顺序地切成连续类型段（audio / video / 其它）
    const batches: Array<{ files: File[]; category: string | undefined }> = [];
    for (const f of files) {
      const name = typeof (f as File)?.name === "string" ? (f as File).name : "";
      const cat = mediaKindOfFilename(name) ?? existingCategory;
      const last = batches[batches.length - 1];
      if (!last || last.category !== cat) {
        batches.push({ files: [f as File], category: cat });
      } else {
        last.files.push(f as File);
      }
    }
    const needsRouting = batches.some(
      (b) => b.category === "audio" || b.category === "video" || b.category === "image"
    );
    if (!needsRouting) return; // 无音视频/图片，原附件路径放行
    const renderer = rendererOf(editor);
    if (!renderer || typeof renderer.execCommand !== "function") return;
    const from = opts.from ?? "ui";
    // 单一类型段（最常见：一次全选同一类媒体）→ 直接改写原命令参数，单次事务
    if (batches.length === 1 && batches[0].category) {
      args[0] = batches[0].files;
      args[1] = { ...opts, category: batches[0].category, from };
      return;
    }
    // 混合类型 → 原命令 no-op（空文件列表），异步按原顺序分批重发
    args[0] = [];
    rerouting = true;
    const timer = globalThis.setTimeout(() => {
      try {
        for (const b of batches) dispatchBatch(renderer, b.files, b.category, from);
      } finally {
        rerouting = false;
      }
    }, 0);
    pendingTimers.add(timer);
  };

  editing.on("beforeExecCommand", handler);

  return () => {
    try { editing.off?.("beforeExecCommand", handler); } catch { /* 忽略 */ }
    for (const t of pendingTimers) globalThis.clearTimeout(t);
    pendingTimers.clear();
  };
}
