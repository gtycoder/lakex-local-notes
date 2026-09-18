import { useEffect, useRef } from "react";
import { addAssetAccessToken, stripAssetAccessToken } from "../../lib/assetPort";
import type { ResourceUploadOutput } from "../../lib/types";
import { createLakeDocument, type LakeEditorInstance } from "../editor/lakeRuntime";

/** 交给父组件的取正文句柄（「有没有内容」与「保存什么」用**同一个来源**，避免两套口径打架）。 */
export interface QuickNoteEditorApi {
  /** 内核形态正文（`.lake` 同构）。取不到时返回空串 —— 主进程会按 text 合成，不阻断保存。 */
  getBody(): string;
  /** 纯文本镜像（预览/搜索/「有内容」判定）。 */
  getText(): string;
}

interface QuickNoteEditorProps {
  /** 归属 id：新建用草稿 id，编辑用小记 id（决定图片落在哪个作用域）。 */
  ownerId: string;
  /** 初始正文（内核形态）。切换草稿时变化 → 组件重挂载。 */
  initialBody: string;
  /** 图片上传落盘：写进小记 staging 空间（见 QuickNotesWorkspace 的封装）。 */
  uploadResource(request: unknown): Promise<ResourceUploadOutput>;
  /** 内容变化：回传**实时纯文本**（父组件据此判定“有内容”与镜像预览）。 */
  onTextChange(text: string): void;
  /** 挂载/卸载时交出/收回句柄。 */
  onReady(api: QuickNoteEditorApi | null): void;
}

/**
 * 小记写作区 = **一个** Lake 编辑器实例（260919）。
 *
 * 只给「正在写的那一条」挂实例，离开即销毁 —— 时间线一屏十几条，每条都挂会把内存乘上条数
 * （单实例实测 ≈1.3~5MB 堆 / 冷开 ≈150ms，见 docs/QUICK-NOTE-LAKE-MEMORY-SPIKE-260919.md）。
 * 正文与 `.lake` 同构 ⇒ 「小记 → 正式文档」转换只是搬运（见 docs/QUICK-NOTE-LAKE-BODY-260919.md）。
 *
 * ⚠️ 260919 踩坑：内核 `contentchange` 在小记上下文不保证把文本回传，且
 * `editor.getDocument("text/plain")` 可能拿不到内容 ⇒ 必须再加 DOM `input` 兜底 + DOM 文本回退，
 * 否则「输入了字但判定为空、点发布没反应」。
 */
export function QuickNoteEditor({ ownerId, initialBody, uploadResource, onTextChange, onReady }: QuickNoteEditorProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const callbacksRef = useRef({ uploadResource, onTextChange, onReady });
  callbacksRef.current = { uploadResource, onTextChange, onReady };

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const engine = () => host.querySelector<HTMLElement>(".ne-engine");
    /** 纯文本镜像：内核 getDocument 优先，取不到/为空时回退读 DOM（两者都失败返回空串）。 */
    const readText = (): string => {
      try {
        const text = editor.getDocument("text/plain");
        if (text && text.trim()) return text;
      } catch { /* 回退 DOM */ }
      try { return engine()?.innerText ?? ""; } catch { return ""; }
    };
    const emitText = () => {
      try { callbacksRef.current.onTextChange(readText()); } catch { /* 卸载竞态忽略 */ }
    };
    const editor: LakeEditorInstance = createLakeDocument(
      host,
      "editor",
      emitText,
      false,
      ownerId,
      null,
      { disableNativeToc: true },
      (request: unknown) => callbacksRef.current.uploadResource(request),
    );
    // 兜底：DOM 层 input 事件（真实键入必触发）——内核 contentchange 之外的第二条信号。
    host.addEventListener("input", emitText, true);
    if (initialBody) editor.setDocument("text/lake", addAssetAccessToken(initialBody));
    callbacksRef.current.onReady({
      getBody: () => { try { return stripAssetAccessToken(editor.getDocument("text/lake")); } catch { return ""; } },
      getText: readText,
    });
    callbacksRef.current.onTextChange(readText());
    return () => {
      host.removeEventListener("input", emitText, true);
      callbacksRef.current.onReady(null);
      try { (editor.destroy ?? editor.destory)?.call(editor); } catch { /* 已销毁 */ }
    };
  }, [ownerId, initialBody]);

  return <div className="quick-note-editor" ref={hostRef} data-owner={ownerId} />;
}
