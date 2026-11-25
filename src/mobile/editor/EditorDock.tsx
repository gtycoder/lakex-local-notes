/**
 * 移动端编辑态底部 dock（app 化适配；交互口径 = AGENTS §3「移动端 Lake 输入面 = 底部 dock，没有第二条路」）：
 * - 主工具栏悬浮在输入法上方：插入(+)、Aa（字体）、B、列表、待办、收起键盘
 * - 展开面板**占住输入法键盘区（键盘不显示）**：insert（图片/拍照/附件/表格/音频/视频/高亮块/状态/引用/分割线/代码块）+ font（块级/行内/对齐/颜色/背景）
 * - 键盘收起（dock 隐藏 + 右下角重显按钮）
 * 格式命令走 Lake renderer.execCommand（文本 ne-* 属性；块级 style "h1"/"p" 等）。
 *
 * 2026-09 修订（对齐 Lake 官方移动工具栏）：
 * - 类别按钮（+ / Aa）展开面板时变成 ×（关闭）并触发触感反馈；
 * - 命令按钮（B/列表/待办 及面板内 mark/block）随光标/选区**实时高亮**（queryCommandState + getSelectionAttrs）；
 * - 底部被占高度（面板/键盘）由**外壳高度**承担（`--mb-app-h` = 稳定外壳高 − 占用，见 viewportShell.ts），
 *   编辑面的滚动容器只留工具栏的固定留白（80px）⇒ 面板⇄输入法切换时内容盒高度不变（不跳）。
 *
 * M-04 拆分（261125，纯搬移）：命令判据/hook = editor/dockCommandState.ts；面板 JSX/条目清单 = editor/DockPanels.tsx；
 * 本文件只留工具栏 + 编排（面板开合、链接浮窗、分栏气泡、键盘开合）。
 */
import { useEffect, useRef, useState } from "react";
import { Plus, Bold, List, ListTodo, Keyboard, KeyboardOff, X, Type, MoreHorizontal, Undo, Redo } from "lucide-react";
import type { LakeEditorInstance } from "../../features/editor/lakeRuntime";
import { setDockPanelPhase } from "./dockPanelPhase";
import { reportMobileActionError } from "../lib/reportMobileActionError";
import { useSnapshotUndo } from "./useSnapshotUndo";
import type { StackLimits } from "./snapshotUndoModel";
// 链接编辑的判定/选区还原复用共享实现（桌面浮栏同一份，不另造一套；契约见 dockCommandState.ts 的取值型命令注释）。
import { applyTextLink, captureLinkTarget, type LinkEditorTarget } from "../../features/editor/selectionToolbar/linkEditor";
import { LinkEditorSheet } from "./LinkEditorSheet";
// 「编辑面」的口径：算术在 editSurfaceModel.ts（纯函数 + CI 单测），owner（外壳高 / 面板状态机 / 输入法 / 焦点守卫）在 useEditSurface.ts
import { useEditSurface } from "./useEditSurface";
import { useEditorCommandDispatcher } from "./useEditorCommandDispatcher";
// 焦点交还正文时放行卡内 textarea 等非正文输入面（261123：插完表情要能就地继续输入）。
import { isTextEntryField } from "../../features/editor/fieldInsert";
// 原生弹键盘兜底（261015）：WebView 里程序化 focus 不保证弹软键盘，点「⌨ 展开键盘」时用它补一次。
import { showNativeKeyboard } from "../native/nativeKeyboard";
import { useActiveCommandStates, useEditorExec } from "./dockCommandState";
import { DockPanels } from "./DockPanels";

type PanelMode = "insert" | "font" | "more" | "emoji" | null;

/** 分栏数量（261104：内核 columns 命令接数量，设备实测 3 栏生效）。 */
const COLUMN_CHOICES: ReadonlyArray<{ value: number; label: string }> = [
  { value: 2, label: "两栏" },
  { value: 3, label: "三栏" },
  { value: 4, label: "四栏" },
];
/** 分栏气泡的估算尺寸（与 editor-dock.css 的 .med-chooser-pop 一致；只用于定位，不参与布局）。 */
const COLUMN_POPOVER_WIDTH = 236;
const COLUMN_POPOVER_HEIGHT = 48;

export interface EditorDockProps {
  editor: LakeEditorInstance | null;
  /** 编辑态才渲染 */
  editing: boolean;
  /** 撤销后端：`kernel` = 内核 history；`snapshot` = 前端快照栈（小记与文档都走它：逐段撤销 + 光标还原）。 */
  undoBackend?: "kernel" | "snapshot";
  /** snapshot 后端的容量上限（文档用更保守的 DOC_LIMITS）。 */
  undoLimits?: StackLimits;
  /** 退出编辑态（工具栏“完成”） */
  /** 触发图片插入（选文件 → 上传 → 插入 Lake） */
  onInsertImage?: () => void;
  /** 触发附件插入 */
  onInsertAttachment?: () => void;
  /** 触发音频卡片插入 */
  onInsertAudio?: () => void;
  /** 触发视频卡片插入 */
  onInsertVideo?: () => void;
  /** 触发表格插入 */
  onInsertTable?: () => void;
  /** 触发拍照（相机直出图片） */
  onInsertCamera?: () => void;
}

export function EditorDock({ editor, editing, undoBackend = "kernel", undoLimits, onInsertImage, onInsertCamera, onInsertAttachment, onInsertAudio, onInsertVideo, onInsertTable }: EditorDockProps) {
  /**
   * 「Aa」面板内的**内联展开**件（用户 261012 定：全套走语雀方式 —— 都在面板内展开，不弹层、不做二级面板）：
   *   - 颜色：**两行各自独立**（用户 261014 定）—— 上排 A = 文字色、下面色板 = 背景色，
   *     不再共用"变体"状态（那样两行会互相回显，用户看到的"串联"）；
   *   - linkSheetOpen：链接编辑浮窗是否打开（261120 起改为底部可拖动浮窗；判定/选区还原仍走共享 linkEditor.ts）。
   */
  /** 261120：链接编辑改成**底部可拖动浮窗**（LinkEditorSheet），不再在面板内联展开。 */
  const [linkSheetOpen, setLinkSheetOpen] = useState(false);
  const [linkInitialText, setLinkInitialText] = useState("");
  /** 261104：分栏选择 = 贴着「分栏」条目弹出的**气泡**（用户口径：像对话框一样在原位置出气泡；不再用面板底部内联行）。 */
  const [columnsAnchor, setColumnsAnchor] = useState<{ left: number; top: number } | null>(null);
  const linkTargetRef = useRef<LinkEditorTarget>({ range: null, selected: "" });

  const dockRef = useRef<HTMLDivElement>(null);
  /**
   * **编辑面 owner**（261014 P2/P3 收口）：外壳高度 + 面板状态机 + 输入法抑制 + 焦点守卫全在 useEditSurface.ts，
   * 几何算术在 editSurfaceModel.ts（纯函数 + CI 单测）。本组件只剩：渲染 + 命令 + 选区/内联件的簿记。
   * restoreFocus 走 ref —— focusEditor 定义在早退之后，而 hook 调用必须在早退之前。
   */
  const focusEditorRef = useRef<() => void>(() => {});
  // minPanelHeight 261104：Aa 面板内容（字号搬走后）实测 ≈300px，原下限 280 会裁掉末行 20px；
  // 且「打开前键盘开着」捕获 312、「键盘关着」落到 280 ⇒ 同一个面板两种高度（观感不稳）。统一 312（≈常见键盘高）。
  const surface = useEditSurface({ editing, dockRef, restoreFocus: () => focusEditorRef.current(), minPanelHeight: 312 });
  const { panelMode, renderedPanel, closing, closingHold, openPanel, closePanel } = surface;
  // 261104：把「二级面板开合阶段」暴露成单一来源（工作区胶囊判据会读它）。
  // 面板开合本身会改变 IME/视口状态 ⇒ 旧的「键盘弹起就隐藏胶囊」会在过渡期抖一下，表现为胶囊闪入闪出；
  // 定稿口径是面板阶段内胶囊**不隐藏**、由层序盖住（见 dockPanelPhase.ts / capsuleVisibility.ts）。
  useEffect(() => { setDockPanelPhase(panelMode ? "open" : closing ? "closing" : "closed"); }, [panelMode, closing]);
  useEffect(() => () => setDockPanelPhase("closed"), []);
  const usable = surface.kbOffset;
  const keyboardOpen = surface.keyboardOpen;
  const panelHeight = surface.panelHeight;
  /** 261120：链接编辑搬进底部浮窗后，面板里不再有需要输入法的控件 ⇒ 原「面板抬到键盘上方」
   *（linkKeyboard / data-link-kb）整段作废，--kb-offset 回到通用口径。 */
  const dockOffset = usable;
  void panelHeight;
  const exec = useEditorExec(editor);
  const execRef = useRef(exec);
  execRef.current = exec;
  const { states: activeStates, enabled: commandEnabled, values: activeValues, refresh: refreshActive } = useActiveCommandStates(editor);
  const {
    savedRangeRef,
    snapshotSelection,
    restoreSelection,
    runInline,
    runPanel,
  } = useEditorCommandDispatcher({
    exec,
    refreshActive,
    dismissIme: () => surface.suppressIme(),
    closePanel,
  });
  /** 前端兜底撤销栈（思源 LocalUndo 式）：仅小记等 kernel history 不可用的编辑器启用。 */
  const snapshotUndo = useSnapshotUndo(editor, undoBackend === "snapshot", undoLimits);

  // 收起面板（切换/关闭）时复位两个内联件：色板回到文字色、链接编辑器收起并清空草稿。
  useEffect(() => {
    if (!panelMode) { setLinkSheetOpen(false); setColumnsAnchor(null); }
  }, [panelMode]);
  // 261120：链接编辑搬进浮窗后，面板里不再有内联输入行 ⇒ 原来给它做的 scrollIntoView 补偿一并删除
  //（分栏早改成锚定气泡，也不依赖这条）。

  // 注：原先的「面板⇄输入法硬互斥兜底」已删除——那条规则是"面板占键盘区"时代的补丁
  // （键盘被顶回来会把面板压成细条）。新口径下面板挂在工具栏上沿、键盘本就常驻，
  // 内核命令后重聚焦正文只会让键盘保持原样，不再需要 blur 兜底（blur 反而会引出输入法动画）。

  // 面板占位 / 收起的时序（含"等键盘真的回来再清占位"）与 --mb-app-h 都由 useEditSurface 负责。

  // 编辑态常驻底部工具栏（完成/插入/字体等）；键盘弹出时悬浮在键盘上方。
  if (!editing) return null;

  const focusEditor = () => {
    // 卡内 textarea / 输入框仍聚焦时，焦点与光标留在输入面（261123：插完表情要能就地继续输入），
    // 不交给内核宿主——那正是「插表情后光标/输入面被抢走」的来源。
    if (isTextEntryField(document.activeElement)) return;
    // 输入法由 useEditSurface 的 restoreIme() 放回（它就在 closePanel 里）；这里只把**焦点**交还正文。
    try { const ce = document.querySelector<HTMLElement>(".doc-pane.active [contenteditable]"); ce?.focus(); } catch (error) { reportMobileActionError("聚焦正文", error); }
    try { execRef.current("focus"); } catch (error) { reportMobileActionError("聚焦正文（内核命令）", error); }
  };
  focusEditorRef.current = focusEditor;
  /** 收起输入法（面板要占键盘区）：**保留焦点与光标**（口径见 useEditSurface.ts） */
  const dismissIme = () => surface.suppressIme();

  /**
   * 展开/收起面板（面板占住键盘区；同一帧挂面板、下一帧才收输入法 —— 键盘从铺满的面板背后滑走，不与面板对撞）。
   * 状态机在 useEditSurface：`closePanel` 是唯一收口（动画 + 放回输入法 + 等键盘真回来再清占位），
   * `openPanel` 负责"从关到开时捕获键盘区高度 / 面板间切换沿用原高度"。
   * 这里只补本组件的簿记：切面板前先记选区（面板项命令靠它还回去）。
   */
  const togglePanel = (mode: Exclude<PanelMode, null>) => {
    if (panelMode === mode) { closePanel(); return; }                 // 再点一次 = 关面板并放回键盘
    snapshotSelection();
    openPanel(mode);
  };


  // 收起键盘：手动收起（编辑态保留）。有关闭面板则先收起面板 —— **不放回输入法**（hide 档），光标留住。
  // 261015 用户点单：**点 ⌨ 要连带展开区一切收起**（面板关 + 键盘放回来）。
  //  原先这里走 `closePanel("hide")`（只收键盘、留住光标）—— 面板虽然关了，但它的占位要等 2.5s 兜底才释放，
  //  且键盘不会回来 ⇒ 用户看到一块**空白**（实测：点后 0.3s/1.2s 都是 `--kb-offset:280px`、`--mb-app-h:562px`、
  //  `inputmode:none`，直到 3.0s 才复位）。⇒ 改走 `closePanel("restore")`（与 × / 点正文同一条路：关面板 + 放回输入法）。
  /**
   * 展开键盘（261015 修：用户报「能收起不能展开」）。
   * 根因：收键盘走的是 `suppressIme()` —— 它给正文宿主写 `inputmode="none"`（这是"留住光标"的关键），
   * 展开时**没有摘掉**该属性 ⇒ 系统认定这个宿主不接受软键盘，`focus()` 也不会弹（实测两轮点击后 ih 仍 842、inputmode 仍 none）。
   * 顺序必须是：**先 restoreIme() 摘属性，再聚焦**；再用原生插件兜一次（程序化 focus 在 WebView 里不保证弹，见 nativeKeyboard.ts）。
   */
  const showKeyboard = () => {
    surface.restoreIme();
    focusEditor();
    window.setTimeout(showNativeKeyboard, 300);
  };

  /** 打开链接浮窗：先捕获当前选区（我们自己的输入框会抢走内核选区，确认前必须还回去）。 */
  const openLinkSheet = () => {
    snapshotSelection();
    const captured = captureLinkTarget();
    linkTargetRef.current = captured.range
      ? captured
      : { range: savedRangeRef.current, selected: savedRangeRef.current ? savedRangeRef.current.toString().trim() : "" };
    setLinkInitialText(linkTargetRef.current.selected);
    setColumnsAnchor(null);
    setLinkSheetOpen(true);
  };
  /**
   * 分栏 = 贴着「分栏」条目弹一个**气泡**（用户 261104：像对话框一样在原位置出气泡，不要面板底部内联行）。
   * 位置：优先排在条目上方（气泡高 48），上方放不下再放下方；左右按视口夹住。
   * 注意锚点必须是**被点条目**（insBtn 把 currentTarget 传进来），不是胶囊/面板。
   */
  const openColumnsChooser = (anchor?: HTMLElement | null) => {
    const rect = anchor?.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left = rect ? rect.left + rect.width / 2 - COLUMN_POPOVER_WIDTH / 2 : 8;
    left = Math.max(8, Math.min(left, vw - COLUMN_POPOVER_WIDTH - 8));
    let top = rect ? rect.top - COLUMN_POPOVER_HEIGHT - 8 : 8;
    if (top < 8) top = rect ? Math.min(rect.bottom + 8, vh - COLUMN_POPOVER_HEIGHT - 8) : 8;
    setLinkSheetOpen(false);
    setColumnsAnchor({ left, top });
  };

  /**
   * 确认链接：判定与选区还原全在共享实现里（桌面浮栏调的是同一份）。
   *
   * ⚠️ **移动端必须"失败重试一次"**（261012 设备实测）：我们的链接输入框拿到焦点后，
   * 还原选区 + `focus` + **同一个 tick 内**执行 `link`，内核会返回 false、链接不落地；
   * 同样还原、**等一拍**再执行就成功（实测返回卡 id 且写出 `<a href>`）。
   * 内核要等一拍才认"刚从我们输入框交还回来的选区"。
   * 桌面浮栏不受影响、保持同步执行 ⇒ 这条重试只放在移动端这一侧。
   */
  const confirmLink = (value: { text: string; src: string }) => {
    const target = linkTargetRef.current;
    const { text, src } = value;
    const finish = (applied: boolean) => {
      // 成功才关浮窗；失败保持打开（绝不假装成功，用户可改链接再试）。
      if (applied) setLinkSheetOpen(false);
      snapshotSelection();
      dismissIme();
      refreshActive();
    };
    // 先立即试一次（选区本就还在编辑器里时这一步就成功）；失败说明内核选区尚未就绪 ⇒ 160ms 后重试一次。
    const attempt = (delay: number) => {
      window.setTimeout(() => {
        const applied = applyTextLink({ editor: editor ?? {}, run: execRef.current, target, text, src });
        if (!applied && delay === 0) attempt(160);
        else finish(applied);
      }, delay);
    };
    attempt(0);
  };

  // 工具栏“收起/展开键盘”按钮：无面板 = 按键盘开合切换；有面板 = 收起面板（键盘此前已收起）
  // ⌨：三种状态三条路（261015 定）——
  //   ① 面板开着 ⇒ `closePanel("restore")`：**面板与展开区一起收、键盘放回来**（不留空白；与 × 同一条路）；
  //   ② 无面板有键盘 ⇒ `dismissIme()`：只收键盘、**留住光标**（不走 closePanel —— 那会把 closing 置真却等不到"键盘回来"）；
  //   ③ 无面板无键盘 ⇒ `showKeyboard()`：先 restoreIme 摘抑制再聚焦（+ 原生兜底）。
  const onKbToggle = () => { if (panelMode) closePanel("restore"); else if (keyboardOpen) dismissIme(); else showKeyboard(); };
  const kbLabel = panelMode ? "收起面板" : (keyboardOpen ? "收起键盘" : "展开键盘");

  // --kb-offset：无面板 = 键盘上移量（adjustResize 恒 0；edge-to-edge = 键盘高度）；
  // 面板开 = 面板占住的键盘区高度（键盘收起过程中 innerHeight 530→842 时它同步长出来，
  // 工具栏屏幕 Y 恒定、面板"接管"键盘腾出的位置 —— HANDOFF §8.3 原始结论）。
  const isOn = (name: string) => !!activeStates[name];
  const plusCls = "med-btn med-toggle" + (panelMode === "insert" ? " med-open" : "");
  const aaCls = "med-btn med-toggle med-aa" + (panelMode === "font" ? " med-open" : "");

  return (
    <div
      ref={dockRef}
      className="mobile-editor-dock"
      data-panel={panelMode ?? "none"}

      style={{ ["--kb-offset" as string]: `${Math.round(dockOffset)}px` } as import("react").CSSProperties}
    >
      {/* 主工具栏（悬浮输入法上方）；对齐 Lake 官方：类别(+/Aa)展开即变 ×，命令按钮实时高亮 */}
      <div className="med-toolbar mb-glass" data-prevent-swipe onMouseDown={(e) => { e.preventDefault(); snapshotSelection(); }}>
        {/* 中间按钮可左右滑动；键盘键**固定在最右**（261017 用户点单 B 方案） */}
        <div className="med-toolbar-scroll">
          <button className={plusCls} onClick={() => togglePanel("insert")} aria-label="插入">
            {panelMode === "insert" ? <X size={20} /> : <Plus size={21} />}
          </button>
          <button className={aaCls} onClick={() => togglePanel("font")} aria-label="字体">
            {panelMode === "font" ? <X size={20} /> : <Type size={20} />}
          </button>
          <button className={"med-btn" + (isOn("bold") ? " med-active" : "")} onClick={() => runInline("bold")} aria-label="加粗"><Bold size={19} /></button>
          <button className={"med-btn" + (isOn("unorderedList") ? " med-active" : "")} onClick={() => runInline("unorderedList" as never)} aria-label="列表"><List size={20} /></button>
          <button className={"med-btn" + (isOn("taskList") ? " med-active" : "")} onClick={() => runInline("taskList" as never)} aria-label="待办"><ListTodo size={20} /></button>
          <button className={"med-btn med-toggle" + (panelMode === "more" ? " med-open" : "")} onClick={() => togglePanel("more")} aria-label="更多">
            {panelMode === "more" ? <X size={20} /> : <MoreHorizontal size={20} />}
          </button>
          {/* 撤销 / 重做（261017 用户点单：从「更多」面板移到主工具栏，键盘之前）。
              后端二选一：文档 = 内核 history（可用态走 queryCommandEnabled，不可用置灰）；
              小记 = 前端快照栈（note-mini 键入不进内核 history，见 useSnapshotUndo 头注释）。 */}
          <button
            className="med-btn"
            disabled={undoBackend === "snapshot" ? !snapshotUndo.canUndo : !commandEnabled.undo}
            onClick={() => (undoBackend === "snapshot" ? snapshotUndo.undo() : runInline("undo"))}
            aria-label="撤销"
          ><Undo size={19} /></button>
          <button
            className="med-btn"
            disabled={undoBackend === "snapshot" ? !snapshotUndo.canRedo : !commandEnabled.redo}
            onClick={() => (undoBackend === "snapshot" ? snapshotUndo.redo() : runInline("redo"))}
            aria-label="重做"
          ><Redo size={19} /></button>
        </div>
        {/* ⌨ 两个状态两个图标（261019 用户点单）：键盘展开时 = **收起**（KeyboardOff，思源同款"键盘+斜线"）；
            键盘收起时 = **展开**（Keyboard）。仅靠同一个键盘图标时用户分不出当前是收还是展。 */}
        <button className="med-btn med-btn--kb" onClick={onKbToggle} aria-label={kbLabel} title={kbLabel}>
          {keyboardOpen ? <KeyboardOff size={19} /> : <Keyboard size={19} />}
        </button>
      </div>

      {/* 展开面板（JSX/条目清单在 DockPanels.tsx；props = 命令执行器 + 当前值）。 */}
      <DockPanels
        panelMode={panelMode}
        renderedPanel={renderedPanel}
        closing={closing}
        closingHold={closingHold}
        onPanelTransitionEnd={surface.onPanelTransitionEnd}
        runPanel={runPanel}
        exec={exec}
        restoreSelection={restoreSelection}
        snapshotSelection={snapshotSelection}
        refreshActive={refreshActive}
        closePanel={closePanel}
        togglePanel={togglePanel}
        onInsertImage={onInsertImage}
        onInsertAttachment={onInsertAttachment}
        onInsertAudio={onInsertAudio}
        onInsertVideo={onInsertVideo}
        onInsertTable={onInsertTable}
        onInsertCamera={onInsertCamera}
        openLinkSheet={openLinkSheet}
        openColumnsChooser={openColumnsChooser}
        activeValues={activeValues}
        isOn={isOn}
        editor={editor}
      />
      {/* 分栏选择气泡：锚在「分栏」条目上（fixed 定位，不受面板 inner 滚动/裁切影响；z 高于面板）。 */}
      {columnsAnchor && (
        <>
        {/* 点外部关闭：用透明背板而不是 window 监听（dock 不许自挂全局监听，见 dockPanelFocusGuard 护栏）。 */}
        <div className="med-chooser-backdrop" aria-hidden="true" onPointerDown={() => setColumnsAnchor(null)} />
        <div
          className="med-chooser-pop"
          role="dialog"
          aria-label="分栏栏数"
          style={{ left: columnsAnchor.left, top: columnsAnchor.top }}
        >
          {COLUMN_CHOICES.map((choice) => (
            <button
              key={choice.value}
              type="button"
              className="med-f-btn"
              aria-label={choice.label + "分栏"}
              title={choice.label}
              onClick={() => { setColumnsAnchor(null); runPanel("columns", choice.value); }}
            >{choice.label}</button>
          ))}
        </div>
        </>
      )}
      {/* 261120 用户点单：链接编辑 = 底部可拖动浮窗（面板内不再内联输入行）。 */}
      <LinkEditorSheet
        open={linkSheetOpen}
        initialText={linkInitialText}
        onConfirm={confirmLink}
        onCancel={() => setLinkSheetOpen(false)}
      />
    </div>
  );
}
