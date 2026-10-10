import { useEffect, useRef, useState } from "react";
import { addAssetAccessToken, stripAssetAccessToken } from "../../lib/assetPort";
import { emptyLakeBody } from "../../core/lakeDocForm.js";
import type { ResourceUploadOutput } from "../../lib/types";
import { createLakeDocument, type LakeEditorInstance } from "../editor/lakeRuntime";
import { installMediaCardCategoryRouter } from "../editor/mediaCardRouting";

/** 交给父组件的取正文句柄（「有没有内容」与「保存什么」用**同一个来源**，避免两套口径打架）。 */
export interface QuickNoteEditorApi {
  /** 内核形态正文（`.lake` 同构）。取不到时返回空串 —— 主进程会按 text 合成，不阻断保存。 */
  getBody(): string;
  /** 纯文本镜像（预览/搜索/「有内容」判定）。 */
  getText(): string;
}

interface QuickNoteEditorProps {
  /**
   * 编辑器版式：`card`＝小卡片（最小工具条 + 右上角展开，分块视图用）；
   * `full`＝文档样式（完整工具条，列表视图右侧用）。两者「+」面板都取内核全量（261010 起不再白名单过滤）。
   */
  ui?: "card" | "full";
  /** 归属 id：新建用草稿 id，编辑用小记 id（决定图片落在哪个作用域）。 */
  ownerId: string;
  /**
   * 所在工作区是否可见（App 的 keep-alive 视图用 `display:none` 隐藏）。
   *
   * **内核实例只在容器真的有宽度之后才创建**（首次），因为内核的「工具条塞不下就折叠进 ⋯」
   * 只在创建时算一次、之后不随容器宽度重算：在 0 宽（隐藏视图）里创建的实例，工具条会按错误宽度
   * 排到溢出（实测容器 1015px 时工具条内容 1064px ⇒ 整块正文区横向溢出 76px），换一条小记
   * （= 重建实例）才正常 —— 这正是用户 260920 报的「列表页第一次打开小记左右宽度不适配」。
   */
  active?: boolean;
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
 * （单实例实测 ≈1.3~5MB 堆 / 冷开 ≈150ms，见 docs/QUICK-NOTES-SPEC.md）。
 * 正文与 `.lake` 同构 ⇒ 「小记 → 正式文档」转换只是搬运（见 docs/QUICK-NOTES-SPEC.md）。
 *
 * ⚠️ 260919 踩坑：内核 `contentchange` 在小记上下文不保证把文本回传，且
 * `editor.getDocument("text/plain")` 可能拿不到内容 ⇒ 必须再加 DOM `input` 兜底 + DOM 文本回退，
 * 否则「输入了字但判定为空、点发布没反应」。
 */
export function QuickNoteEditor({ ownerId, initialBody, ui = "card", active = true, uploadResource, onTextChange, onReady }: QuickNoteEditorProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const callbacksRef = useRef({ uploadResource, onTextChange, onReady });
  callbacksRef.current = { uploadResource, onTextChange, onReady };
  /**
   * 「见过一次可见状态」的闩：只在**首次可见**后建实例，之后即使工作区被隐藏也不销毁。
   * 不能按当前可见性挂/卸 —— 内核正文只活在实例里，卸载后用陈旧的 `initialBody` 重建会把正在写的内容丢掉。
   */
  const [everActive, setEverActive] = useState(active);
  useEffect(() => { if (active) setEverActive(true); }, [active]);

  useEffect(() => {
    if (!everActive) return;
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
      // 小记 = 文档编辑器外观 + 受限工具栏（只裁 toolbar items；「+」面板取内核全量）。
      // 这是**只给小记**的开关：文档编辑器不传 quickNoteUi，能力与外观完全不受影响。
      //
      // ⚠️ `disableVirtualRendering: true` 必须开（260919 用户报「输入一个字整片空白 + 编辑态顶部大空白」的根因）：
      // 虚拟渲染靠 `scrollNode` 量视口，而小记编辑器没有 Lake 内部滚动容器，fallback 到 `.document-pane`
      // 会量错 ⇒ 正文被换成 `.ne-virtual-render-placeholder`（顶部留白 100+px、输入触发重渲染后整片变占位）。
      // 移动端早已为此置位（见 QuickNotesWorkspace 前的 HANDOFF §8.8 同款坑）。
      { disableNativeToc: true, quickNoteUi: ui, disableVirtualRendering: true },
      (request: unknown) => callbacksRef.current.uploadResource(request),
    );
    // 兜底：DOM 层 input 事件（真实键入必触发）——内核 contentchange 之外的第二条信号。
    host.addEventListener("input", emitText, true);
    /**
     * **附件按类型成卡**（用户 260920 报「插入附件 mp4 没转成视频卡，只有预览是视频」）：
     * 内核的「附件」路径（`insertFiles(files,{from:'ui',category:'file'})`）一律产出 file 卡，
     * 于是 mp4/mp3 在编辑态只是附件条、在卡片预览里却是可播放的视频/音频 —— 两边不一致。
     * 这个路由本来就是**文档编辑器**在用的（`mediaCardRouting`，按扩展名把音频/视频/图片改写成
     * 对应 category 再交给内核原生 pre-reader 建卡），小记这套新编辑器漏了挂载 ⇒ 这里补上。
     * 只在 `mode === "editor"` 的编辑器上装（阅读态/文档侧各自已有自己的挂载点）。
     */
    const detachMediaCardRouter = installMediaCardCategoryRouter(editor);
    // **空小记也必须装载一次正文**：内核 `document.ready` 只在真正 setDocument 后触发，
    // 而小记版式的三样东西（`ne-note-ui` 版式类 / 右上角「展开」按钮（**仅桌面**：移动端 fullscreen 关闭）/
    // note 工具条注册）都挂在该钩子上。此前"有正文才 setDocument"⇒ 新建空小记时工具条空白、展开按钮不渲染、
    // 键入也不回传（HANDOFF §2.10 三.2 的根因）。空正文用单一来源 emptyLakeBody，与主进程同构。
    editor.setDocument("text/lake", addAssetAccessToken(initialBody || emptyLakeBody(ownerId)));
    callbacksRef.current.onReady({
      getBody: () => { try { return stripAssetAccessToken(editor.getDocument("text/lake")); } catch { return ""; } },
      getText: readText,
    });
    callbacksRef.current.onTextChange(readText());
    return () => {
      host.removeEventListener("input", emitText, true);
      detachMediaCardRouter();
      callbacksRef.current.onReady(null);
      try { (editor.destroy ?? editor.destory)?.call(editor); } catch { /* 已销毁 */ }
    };
  }, [everActive, ownerId, initialBody, ui]);

  return <div className="quick-note-editor" ref={hostRef} data-owner={ownerId} />;
}
