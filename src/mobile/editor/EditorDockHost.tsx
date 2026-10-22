/**
 * 编辑态底部「dock 宿主」= **EditorDock + 隐藏 file input + 插入回调接线**（261013 抽出）。
 *
 * 为什么单独一层：**文档编辑器与小记编辑器共用同一份 dock 接线**（用户 261013：安卓小记要"复用"文档编辑的
 * 工具栏，后续文档侧改了这边必须跟着变）。抽出来后任何 dock 变化（新增项 / 新面板 / 样式）**两端自动一致**，
 * 不再各写一份会漂移的接线。
 *
 * 插入通道只有一条：隐藏 `<input type=file>` → 内核 `insertFiles`（图片 / 拍照 / 附件 / 音频 / 视频，
 * 类型由 `mediaKindOfFilename` 路由成对应卡片）；表格走内核 `table` 命令（缺 rows/columns 会报错，默认 3×3）。
 */
import { useRef } from "react";
import { EditorDock } from "./EditorDock";
import { editorCommandFailureMessage, execEditorCommandResult } from "./execCommand";
import { showToast } from "../ui/toastBus";
import type { LakeEditorInstance } from "../../features/editor/lakeRuntime";
import { mediaKindOfFilename } from "../../core/assetNaming.js";

export function EditorDockHost({ editor, editing, undoBackend = "kernel", undoLimits }: {
  /** 内核实例（宿主用 state 持有，就绪后必须触发一次重渲染，否则 dock 一直拿到 null）。 */
  editor: LakeEditorInstance | null;
  /** 编辑态才渲染 dock。 */
  editing: boolean;
  /** 撤销后端；小记/文档都传 "snapshot"（逐段撤销 + 光标还原）。 */
  undoBackend?: "kernel" | "snapshot";
  /** snapshot 后端的容量上限（文档更保守）。 */
  undoLimits?: import("./snapshotUndoModel").StackLimits;
}) {
  const editorRef = useRef<LakeEditorInstance | null>(null);
  editorRef.current = editor;
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const runCommand = (command: string, ...args: unknown[]): void => {
    const result = execEditorCommandResult(editorRef.current, command, ...args);
    if (!result.ok && result.reason !== "editor-unavailable") showToast(editorCommandFailureMessage(command, result), { type: "error" });
  };

  /** 复用隐藏 file input：`capture` 传 "environment" 时 Android 直接开相机拍照（拍完即当图片插入）。 */
  const insertFileViaInput = (accept: string, capture?: "environment") => {
    const input = fileInputRef.current;
    if (!input) return;
    input.accept = accept;
    if (capture) input.setAttribute("capture", capture);
    else input.removeAttribute("capture");
    input.value = "";
    input.click();
  };

  return (
    <>
      <EditorDock
        editor={editor}
        editing={editing}
        undoBackend={undoBackend}
        undoLimits={undoLimits}
        onInsertImage={() => insertFileViaInput("image/*")}
        onInsertCamera={() => insertFileViaInput("image/*", "environment")}
        onInsertAttachment={() => insertFileViaInput("")}
        onInsertAudio={() => insertFileViaInput("audio/*")}
        onInsertVideo={() => insertFileViaInput("video/*")}
        onInsertTable={() => {
          // lakex 的 table 命令需要 rows/columns 配置（缺省会读 width 报错）；默认 3×3
          runCommand("table", { rows: 3, columns: 3 });
        }}
      />
      <input
        ref={fileInputRef}
        type="file"
        style={{ display: "none" }}
        onChange={(e) => {
          const file = e.target.files?.[0];
          const ed = editorRef.current;
          if (!file || !ed) return;
          const kind = mediaKindOfFilename(file.name);
          const opts = kind ? { category: kind, from: "ui" } : undefined;
          const result = execEditorCommandResult(ed, "insertFiles", [file], opts);
          if (!result.ok && result.reason !== "editor-unavailable") showToast(editorCommandFailureMessage("insertFiles", result), { type: "error" });
        }}
      />
    </>
  );
}
