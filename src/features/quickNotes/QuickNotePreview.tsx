/**
 * 小记卡片的**只读预览** = 快路径（自研 DOM，零内核实例）+ **内核只读视图兜底**（261010 定稿）。
 *
 * 为什么不全用内核：时间线一屏十几条，每条挂一个 Lake 实例 ≈ +5MB RSS/实例（见
 * AGENTS §4 / docs/TAG-SYSTEM-DESIGN.md）；而小记正文是**内核产出的标准 lake 标记**，常见块用普通 DOM
 * 就能忠实呈现 ⇒ 纯文字小记走快路径，移动端冷开不受影响。
 *
 * 为什么必须有兜底：内核的格式集合是**开放的**（每升级一次内核就可能多几种卡），
 * 自研解析器不可能穷举 ⇒ 只要出现一个还原不了的块，整条卡片改由内核自己渲染
 * （`QuickNoteKernelPreview`）。**格式覆盖度由内核保证，我们不再维护卡片白名单。**
 */
import { Suspense, lazy, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronUp, Paperclip } from "lucide-react";
import { isQuickNoteImageMime } from "../../core/quickNoteModel";
import type { QuickNoteImage } from "../../lib/types";
import { imageBoxAttrs } from "../../lib/imageBox";
import { hasUnsupportedNodes, parseQuickNotePreview, type PreviewRun, type QuickNotePreviewNode } from "./quickNotePreviewParser";
/**
 * 内核只读兜底 = **懒加载**（261014 冷启动修复）。
 *
 * 为什么必须懒：HomePage → QuickNotePreview → QuickNoteKernelPreview → lakeRuntime 是一条**静态**链，
 * 而 lakeRuntime 是 **6.1MB** 的内核 chunk —— 它一进静态图，构建就会给入口挂上 40+ 条 modulepreload，
 * 冷启动要**先拉取 + 解析整个内核**才画得出首页（设备实测：DCL 3943ms、一个 1821ms 长任务、真首页 6123ms）。
 * 而这条兜底只在"快路径还原不了的块"出现时才用得上 ⇒ 没理由让所有人替它付冷启动成本。
 */
const QuickNoteKernelPreview = lazy(() => import("./QuickNoteKernelPreview").then((m) => ({ default: m.QuickNoteKernelPreview })));

type Asset = QuickNoteImage & { url?: string };

function Runs({ runs }: { runs: PreviewRun[] }) {
  return <>{runs.map((run, index) => {
    let node: React.ReactNode = run.text;
    // 内核产出的**内容**样式（字号/颜色/背景）只能用行内 style 还原；这里不是 UI 版式，是数据。
    const style: React.CSSProperties = {};
    if (run.fontSize) style.fontSize = `${run.fontSize}px`;
    if (run.color) style.color = run.color;
    if (run.background) style.backgroundColor = run.background;
    if (run.code) node = <code key={`c${index}`}>{node}</code>;
    if (run.underline) node = <u>{node}</u>;
    if (run.strike) node = <del>{node}</del>;
    if (run.italic) node = <em>{node}</em>;
    if (run.bold) node = <strong>{node}</strong>;
    if (run.link) node = <a href={run.link} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()}>{node}</a>;
    return <span key={index} style={Object.keys(style).length > 0 ? style : undefined}>{node}</span>;
  })}</>;
}

/** 段落级样式（对齐 / 行高）→ 行内 style。 */
function blockStyle(align?: string, lineHeight?: number): React.CSSProperties | undefined {
  const style: React.CSSProperties = {};
  if (align) style.textAlign = align as React.CSSProperties["textAlign"];
  if (lineHeight) style.lineHeight = lineHeight;
  return Object.keys(style).length > 0 ? style : undefined;
}

interface MediaProps {
  filename: string | null;
  cardName: string;
  /** 卡片自带的原始展示名（附件卡的 `name` / 音频卡的 `fileName`）；取不到回落资源里的文件名。 */
  label: string | null;
  assets: Asset[];
  onImageClick(image: Asset): void;
  /** 单行省略的工具类（桌面 .ln-ellipsis / 移动端 .mb-ellipsis）——由调用方给，组件不写死。 */
  ellipsisClassName: string;
}

function Media({ filename, cardName, label, assets, onImageClick, ellipsisClassName }: MediaProps) {
  const asset = filename ? assets.find((item) => item.filename === filename) : undefined;
  /** 文件条上显示的名字：优先卡片里的原始名（"报告.pdf"），否则资源文件名（磁盘名）。 */
  const displayName = label ?? asset?.filename ?? filename ?? "";
  if (!asset?.url) {
    return <span className="quick-note-preview-unsupported">{displayName ? `${displayName}（资源缺失）` : cardName === "image" ? "图片（资源缺失）" : "附件（资源缺失）"}</span>;
  }
  if (isQuickNoteImageMime(asset.mimeType)) {
    // 比例盒：宽高元数据可用时给 <img> 写 width/height 属性（CSS max-width/max-height 仍生效），
    // 加载前浏览器先按比例占位 —— 列表式预览不再因图片到达而跳版；老数据缺尺寸则不写。
    const box = imageBoxAttrs(asset);
    return <img className="quick-note-preview-image" src={asset.url} alt="小记图片" loading="lazy" decoding="async" title="点击放大"
      {...(box ?? {})}
      onClick={(event) => { event.stopPropagation(); onImageClick(asset); }} />;
  }
  if (asset.mimeType.startsWith("video/")) {
    return <video className="quick-note-preview-video" src={asset.url} title={displayName} controls preload="metadata" onClick={(event) => event.stopPropagation()} />;
  }
  if (asset.mimeType.startsWith("audio/")) {
    return <audio className="quick-note-preview-audio" src={asset.url} title={displayName} controls preload="metadata" onClick={(event) => event.stopPropagation()} />;
  }
  return <span className="quick-note-file-chip" title={displayName}>
    <Paperclip size={14} />
    <span className={"quick-note-file-chip__name " + ellipsisClassName}>{displayName}</span>
  </span>;
}

function Nodes({ nodes, assets, onImageClick, onToggleTask, ellipsisClassName, hiddenMediaNames }: {
  nodes: QuickNotePreviewNode[]; assets: Asset[]; onImageClick(image: Asset): void;
  /** 待办勾选（预览里点复选框就能完成/取消，用户 260919 要求：只做这一个交互）。 */
  onToggleTask?(checkboxIndex: number, checked: boolean): void;
  ellipsisClassName: string;
  /** 已经在上方**封面**里展示过的图片（磁盘名）：预览里不再重复渲染（261112 用户报「插一张图展两张」）。 */
  hiddenMediaNames?: ReadonlySet<string>;
}) {
  return <>{nodes.map((node, index) => {
    switch (node.kind) {
      case "paragraph":
        return <p key={index} className="quick-note-preview-paragraph" style={blockStyle(node.align, node.lineHeight)}><Runs runs={node.runs} /></p>;
      case "heading": {
        const Tag = `h${Math.min(6, Math.max(1, node.level))}` as "h1";
        return <Tag key={index} className="quick-note-preview-heading" style={blockStyle(node.align, node.lineHeight)}><Runs runs={node.runs} /></Tag>;
      }
      case "list": {
        const ListTag = node.ordered ? "ol" : "ul";
        // 缩进层级 → 左侧内缩（内核把层级写在 `<ul data-lake-indent>` 上）
        return <ListTag key={index} className="quick-note-preview-list" style={node.depth > 0 ? { paddingLeft: 22 + node.depth * 16 } : undefined}>
          {node.items.map((item, itemIndex) => <li key={itemIndex} className={item.task ? "quick-note-preview-task" : undefined} style={blockStyle(item.align, item.lineHeight)}>
            {item.task && <input
              type="checkbox"
              checked={item.checked}
              readOnly={!onToggleTask}
              tabIndex={-1}
              onClick={(event) => event.stopPropagation()}
              onChange={onToggleTask && typeof item.checkboxIndex === "number"
                ? () => onToggleTask(item.checkboxIndex as number, !item.checked)
                : undefined}
            />}
            <span><Runs runs={item.runs} /></span>
          </li>)}
        </ListTag>;
      }
      case "quote":
        return <blockquote key={index} className="quick-note-preview-quote"><Nodes nodes={node.nodes} assets={assets} onImageClick={onImageClick} onToggleTask={onToggleTask} ellipsisClassName={ellipsisClassName} hiddenMediaNames={hiddenMediaNames} /></blockquote>;
      case "divider":
        return <hr key={index} className="quick-note-preview-divider" />;
      case "media":
        // 封面已经展示了这张图 ⇒ 预览里跳过（只跳 image；附件/音视频没有封面语义，照常显示）。
        if (node.cardName === "image" && node.filename && hiddenMediaNames?.has(node.filename)) return null;
        return <Media key={index} filename={node.filename} cardName={node.cardName} label={node.label} assets={assets} onImageClick={onImageClick} ellipsisClassName={ellipsisClassName} />;
      default:
        return <span key={index} className="quick-note-preview-unsupported" title="该块不支持在卡片里预览，请在编辑态查看">{node.label}</span>;
    }
  })}</>;
}

interface QuickNotePreviewProps {
  /** 内核形态正文（`.qnote.body`）。 */
  body: string;
  /** 小记 id：走**内核兜底**渲染时要用（与编辑态同一个 id；缺省时兜底不可用，只显示占位）。 */
  noteId?: string;
  /** 资源清单（用于把媒体卡解析成真实资源）。 */
  assets: Asset[];
  onImageClick(image: Asset): void;
  /** 解析不出内容时的回落（老的纯文本镜像）。 */
  fallbackText?: string;
  /** 待办勾选回调（不传则复选框只读）。 */
  onToggleTask?(checkboxIndex: number, checked: boolean): void;
  /** 单行省略的工具类（默认桌面 .ln-ellipsis；移动端传自有 .mb-ellipsis）——
   *  两端各自拥有样式，组件只发**调用方给的那个类名**，满足「不共享样式、只共享逻辑」。 */
  ellipsisClassName?: string;
  /**
   * 已在卡片**封面**里展示过的图片（磁盘名）⇒ 预览里跳过，避免同一张图出现两次
   * （261112 用户报「只插了一张图片，预览里展示 2 张」：封面 + 预览各画一遍）。
   * 只影响 image 卡；附件/音视频卡没有封面语义，照常渲染。
   */
  hiddenMediaNames?: ReadonlySet<string>;
  /**
   * **恒定槽位**模式（261119 平滑度审计 F-B/F-C/F-H；移动端首页小记列表卡专用）。
   * 不传 = 经典行为（桌面 / 标签详情），与 261010 定稿一致。
   *
   * 为什么需要：列表投影不带正文 ⇒ 卡片先画 `fallbackText` 纯文本、正文到达再换富预览，
   * 两态高度不同 ⇒ 下方卡片位移（F-B）；内核兜底的 Suspense fallback 又是第三种高度（F-C）。
   * 槽位模式把「外框几何」从内容手里拿走，只由槽决定：
   *  - `text`（纯文本卡）= 5 行摘要槽（SLOT_TEXT_MAX）：占位与富预览同容器同排版 ⇒ 两态同高；
   *  - `media`（封面之外还有图）= 折叠上限槽（COLLAPSED_MAX_PX）**恒定** ⇒ 图文到达只填内容不改框；
   *  - 内核兜底：Suspense fallback 继续画占位文本（不再换成 unsupported 标签片），外框只在
   *    正文到达时上一阶（「单阶」验收口径），内核落地不改外框。
   * 展开/收起 = 结构展开位移过渡（既有 motion 令牌；reduced-motion 瞬切）。
   */
  slotFrame?: "text" | "media";
}

/** 折叠上限（px）：超长小记卡收起后的预览高（用户 260919 #5：否则一条长小记会把其他小记挤走）。 */
const COLLAPSED_MAX_PX = 220;
/**
 * 槽位模式「文本卡」的槽高（em，相对槽内字号；行高 1.5 ⇒ 5 行）。
 * 取 5 行 = `previewText`（主进程截断 120 字）在主流机型宽度上的自然换行高 ⇒
 * 占位与富预览都从同一档截断 ⇒ 纯文本卡两态逐像素同高（F-B 恒定几何）。
 */
const SLOT_TEXT_MAX = "7.5em";
/** 溢出判定余量（亚像素/滚动条误差；与标签详情小记卡同口径）。 */
const OVERFLOW_SLACK_PX = 2;

export function QuickNotePreview({ body, noteId, assets, onImageClick, fallbackText, onToggleTask, ellipsisClassName = "ln-ellipsis", hiddenMediaNames, slotFrame }: QuickNotePreviewProps) {
  const nodes = useMemo(() => parseQuickNotePreview(body), [body]);
  /** 封面已展示的图不重复画 ⇒ 只剩这些节点时整块预览就不占位（否则卡片中间留一片空白）。 */
  const visibleNodes = useMemo(
    () => nodes.filter((node) => !(node.kind === "media" && node.cardName === "image" && node.filename && hiddenMediaNames?.has(node.filename))),
    [nodes, hiddenMediaNames],
  );
  /** 快路径还原不了 ⇒ 整条卡片交给内核（判据 = 解析器自己的 unsupported 节点，不另立清单）。 */
  const kernelFallback = useMemo(() => hasUnsupportedNodes(nodes), [nodes]);
  const hostRef = useRef<HTMLDivElement>(null);
  /** 槽位模式的内容盒：外框被槽钉住后宿主不再变高 ⇒ 异步内容（正文/内核/图片）长高由它上报（标签详情卡先例）。 */
  const contentRef = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [overflowing, setOverflowing] = useState(false);
  /** F-H 展开/收起位移过渡：动画期行内高由下方 effect 接管，React 的 style 只回写 max-height:none。 */
  const [animating, setAnimating] = useState(false);
  const animatingRef = useRef(false);
  const animTargetRef = useRef<{ from: number; to: number } | null>(null);
  /** 收起动画回落的槽高 = 展开前实测的折叠高。 */
  const collapseTargetRef = useRef<number | null>(null);

  /** 占位 = `fallbackText` 纯文本，与富预览**同一容器、同一排版**（槽位两态同高的前提）。 */
  const placeholder = fallbackText ? <p className="quick-note-preview-paragraph">{fallbackText}</p> : null;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const measure = () => {
      if (animatingRef.current) return;
      setOverflowing(slotFrame
        ? host.scrollHeight > host.clientHeight + OVERFLOW_SLACK_PX
        : host.scrollHeight > COLLAPSED_MAX_PX + 8);
    };
    measure();
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    observer?.observe(host);
    if (slotFrame && contentRef.current) observer?.observe(contentRef.current);
    // 异步内容到达与 ResizeObserver 回调可能同帧错位 ⇒ 补一帧复测（标签详情卡先例）。
    const frame = typeof requestAnimationFrame === "function" ? requestAnimationFrame(measure) : 0;
    return () => {
      observer?.disconnect();
      if (frame && typeof cancelAnimationFrame === "function") cancelAnimationFrame(frame);
    };
  }, [body, kernelFallback, slotFrame]);
  useEffect(() => {
    setExpanded(false);
    collapseTargetRef.current = null;
  }, [body]);

  /** F-H：展开/收起 = 结构展开位移过渡（只走既有 motion 令牌；reduced-motion 下瞬切）。 */
  useEffect(() => {
    if (!animating) return;
    const host = hostRef.current;
    const target = animTargetRef.current;
    if (!host || !target) {
      animatingRef.current = false;
      return;
    }
    host.style.maxHeight = "none";
    host.style.height = target.from + "px";
    void host.offsetHeight; // 起点先落定，否则同帧改终点会被合并成瞬切
    const frame = typeof requestAnimationFrame === "function"
      ? requestAnimationFrame(() => { host.style.height = target.to + "px"; })
      : 0;
    let finished = false;
    const finish = (event?: TransitionEvent): void => {
      if (event && event.target !== host) return; // 子元素冒泡上来的 transitionend 不算
      if (finished) return;
      finished = true;
      animatingRef.current = false;
      animTargetRef.current = null;
      host.style.height = "";
      host.style.maxHeight = "";
      setAnimating(false);
    };
    host.addEventListener("transitionend", finish);
    // transition 没跑（reduced-motion / 样式缺位）不会有 transitionend ⇒ 超时兜底收尾。
    const timer = window.setTimeout(finish, 400);
    return () => {
      if (frame && typeof cancelAnimationFrame === "function") cancelAnimationFrame(frame);
      host.removeEventListener("transitionend", finish);
      window.clearTimeout(timer);
    };
  }, [animating]);

  const toggleExpanded = (event: React.MouseEvent): void => {
    event.stopPropagation();
    const next = !expanded;
    const host = hostRef.current;
    const reduced = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!slotFrame || !host || reduced) {
      setExpanded(next);
      return;
    }
    const from = host.clientHeight;
    const to = next ? host.scrollHeight : Math.min(host.scrollHeight, collapseTargetRef.current ?? from);
    if (next) collapseTargetRef.current = from;
    animatingRef.current = true;
    animTargetRef.current = { from, to };
    setExpanded(next);
    setAnimating(true);
  };

  // 经典路径（桌面 / 标签详情）：保持 261010 定稿行为。
  if (!slotFrame && !kernelFallback && visibleNodes.length === 0) {
    return fallbackText ? <p className="quick-note-preview-paragraph">{fallbackText}</p> : null;
  }
  const collapsed = slotFrame
    ? !expanded && (overflowing || (slotFrame === "media" && body.length === 0))
    : overflowing && !expanded;
  /** 槽位夹持：文本卡 = 摘要槽；多图卡 = 折叠上限恒定；内核兜底 = 折叠上限（外框「单阶」上跳后不再变）。 */
  const clampStyle: React.CSSProperties | undefined = slotFrame && !expanded && !animating
    ? slotFrame === "media"
      ? { height: COLLAPSED_MAX_PX }
      : { maxHeight: kernelFallback && noteId ? COLLAPSED_MAX_PX : SLOT_TEXT_MAX }
    : undefined;
  const style = animating ? { maxHeight: "none" } : clampStyle;
  // 槽位模式的类名拼装（qn-preview-slot* 只有移动端样式；桌面不传 slotFrame ⇒ 从不渲染这些类）。
  const className = slotFrame
    ? ["quick-note-preview", "qn-preview-slot", "qn-preview-slot--" + slotFrame, collapsed ? "is-collapsed" : "", expanded ? "is-expanded" : "", animating ? "is-animating" : ""].filter(Boolean).join(" ")
    : "quick-note-preview" + (collapsed ? " is-collapsed" : "");
  const fastPath = <Nodes nodes={visibleNodes} assets={assets} onImageClick={onImageClick} onToggleTask={onToggleTask} ellipsisClassName={ellipsisClassName} hiddenMediaNames={hiddenMediaNames} />;
  const chips = <Nodes nodes={nodes} assets={assets} onImageClick={onImageClick} onToggleTask={onToggleTask} ellipsisClassName={ellipsisClassName} hiddenMediaNames={hiddenMediaNames} />;
  const content = kernelFallback && noteId
    ? (
      // F-C：槽位模式下 fallback 保留**占位文本**（与外框同构），内核到达不改外框；
      // 经典模式保持原「unsupported 标签片」fallback。
      <Suspense fallback={slotFrame ? (placeholder ?? chips) : chips}>
        {/* 内核只读兜底无法摘掉首图（它按正文自己渲染）⇒ 这条路径仍可能与封面重复；只在快路径里去重。 */}
        <QuickNoteKernelPreview body={body} noteId={noteId} />
      </Suspense>
    )
    : visibleNodes.length > 0
      ? fastPath
      : (slotFrame ? placeholder : fastPath);
  return <>
    <div ref={hostRef} className={className} style={style}>
      {slotFrame ? <div ref={contentRef}>{content}</div> : content}
    </div>
    {overflowing && <button
      className="quick-note-preview-toggle"
      onClick={toggleExpanded}
    >{expanded ? <><ChevronUp size={13} />收起</> : <><ChevronDown size={13} />展开</>}</button>}
  </>;
}
