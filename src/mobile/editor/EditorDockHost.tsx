/**
 * 编辑态底部「dock 宿主」= **EditorDock + 隐藏 file input + 插入回调接线**（261013 抽出）。
 *
 * 为什么单独一层：**文档编辑器与小记编辑器共用同一份 dock 接线**（用户 261013：安卓小记要"复用"文档编辑的
 * 工具栏，后续文档侧改了这边必须跟着变）。抽出来后任何 dock 变化（新增项 / 新面板 / 样式）**两端自动一致**，
 * 不再各写一份会漂移的接线。
 *
 * 插入通道只有一条：**内核 `insertFiles`**（图片 / 拍照 / 附件 / 音频 / 视频，类型由 `mediaKindOfFilename`
 * 路由成对应卡片）；文件来源两条 —— 隐藏 `<input type=file>`（图片/附件/音频/视频）与原生相机直出（拍照，
 * `native/cameraCapture.takeCameraPhoto`，261118「拍照变相册」修复：WebView file input 的 capture 会被
 * 系统选择器吞掉，拍照必须直调 ACTION_IMAGE_CAPTURE）；表格走内核 `table` 命令（缺 rows/columns 会报错，默认 3×3）。
 */
import { useRef } from "react";
import { EditorDock } from "./EditorDock";
import { editorCommandFailureMessage, execEditorCommandResult } from "./execCommand";
// 261123 P1-B：媒体/表格与表情同一条内核插入语义（「非折叠选区被替换」）⇒ 同一片区守卫（判据共享）。
import { notifyInsertBlocked, selectionTouchesCard } from "../../features/editor/insertGuard";
import { showToast } from "../ui/toastBus";
import type { LakeEditorInstance } from "../../features/editor/lakeRuntime";
import { mediaKindOfFilename } from "../../core/assetNaming.js";
import { takeCameraPhoto } from "../native/cameraCapture";

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

  /** 复用隐藏 file input（图片/附件/音频/视频）。拍照不走它 —— capture 会被系统选择器吞掉，见 insertCameraPhoto。 */
  const insertFileViaInput = (accept: string) => {
    const input = fileInputRef.current;
    if (!input) return;
    input.accept = accept;
    input.value = "";
    input.click();
  };

  /**
   * 卡片保护区（261123 P1-B，与 EditorDock 的 insertAtSelection/insertCard 守卫同一判据）：
   * 内核通用插入 `insertFiles`/`table` 与 insertAtSelection 同语义——**非折叠选区被替换**。
   * 实测（模拟器，整卡非折叠选中）：插图片 / 插表格都把「加密文本」卡**整卡顶掉**（数据破坏级）。
   * ⇒ 选区触卡一律拦下并走同一提示通道（features/editor/insertGuard）。
   */
  const blockedByCardGuard = (): boolean => {
    if (!selectionTouchesCard()) return false;
    notifyInsertBlocked();
    return true;
  };

  /** 选到的文件 → 内核 insertFiles（图片/拍照/附件/音频/视频的唯一插入通道）。 */
  const insertFile = (file: File) => {
    const ed = editorRef.current;
    if (!ed) return;
    if (blockedByCardGuard()) return;
    const kind = mediaKindOfFilename(file.name);
    const opts = kind ? { category: kind, from: "ui" } : undefined;
    const result = execEditorCommandResult(ed, "insertFiles", [file], opts);
    if (!result.ok && result.reason !== "editor-unavailable") showToast(editorCommandFailureMessage("insertFiles", result), { type: "error" });
  };

  /**
   * 拍照 = 原生相机直出（261118）：ACTION_IMAGE_CAPTURE + FileProvider 落盘 → File → 与相册选图同一条
   * insertFiles 通道。用户取消返回 null 不插入；原生失败由 takeCameraPhoto 显式提示（绝不静默开相册）；
   * web 预览（mobile-preview）无原生桥时它内部回退既有 file input（降级行为保持现状）。
   */
  const insertCameraPhoto = async () => {
    const file = await takeCameraPhoto();
    if (file) insertFile(file);
  };

  return (
    <>
      <EditorDock
        editor={editor}
        editing={editing}
        undoBackend={undoBackend}
        undoLimits={undoLimits}
        onInsertImage={() => insertFileViaInput("image/*")}
        onInsertCamera={() => void insertCameraPhoto()}
        onInsertAttachment={() => insertFileViaInput("")}
        onInsertAudio={() => insertFileViaInput("audio/*")}
        onInsertVideo={() => insertFileViaInput("video/*")}
        onInsertTable={() => {
          if (blockedByCardGuard()) return;   // 261123 P1-B：table 同样会顶掉整卡（实测）
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
          if (file) insertFile(file);
        }}
      />
    </>
  );
}
