/**
 * 小记卡片的**只读预览** = 快路径（自研 DOM，零内核实例）+ **内核只读视图兜底**（261010 定稿）。
 *
 * 为什么不全用内核：时间线一屏十几条，每条挂一个 Lake 实例 ≈ +5MB RSS/实例（见
 * docs/QUICK-NOTES-SPEC.md）；而小记正文是**内核产出的标准 lake 标记**，常见块用普通 DOM
 * 就能忠实呈现 ⇒ 纯文字小记走快路径，移动端冷开不受影响。
 *
 * 为什么必须有兜底：内核的格式集合是**开放的**（每升级一次内核就可能多几种卡），
 * 自研解析器不可能穷举 ⇒ 只要出现一个还原不了的块，整条卡片改由内核自己渲染
 * （`QuickNoteKernelPreview`）。**格式覆盖度由内核保证，我们不再维护卡片白名单。**
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronUp, Paperclip } from "lucide-react";
import { isQuickNoteImageMime } from "../../core/quickNoteModel";
import type { QuickNoteImage } from "../../lib/types";
import { hasUnsupportedNodes, parseQuickNotePreview, type PreviewRun, type QuickNotePreviewNode } from "./quickNotePreviewParser";
import { QuickNoteKernelPreview } from "./QuickNoteKernelPreview";

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
    return <img className="quick-note-preview-image" src={asset.url} alt="小记图片" loading="lazy" title="点击放大"
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

function Nodes({ nodes, assets, onImageClick, onToggleTask, ellipsisClassName }: {
  nodes: QuickNotePreviewNode[]; assets: Asset[]; onImageClick(image: Asset): void;
  /** 待办勾选（预览里点复选框就能完成/取消，用户 260919 要求：只做这一个交互）。 */
  onToggleTask?(checkboxIndex: number, checked: boolean): void;
  ellipsisClassName: string;
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
        return <blockquote key={index} className="quick-note-preview-quote"><Nodes nodes={node.nodes} assets={assets} onImageClick={onImageClick} onToggleTask={onToggleTask} ellipsisClassName={ellipsisClassName} /></blockquote>;
      case "divider":
        return <hr key={index} className="quick-note-preview-divider" />;
      case "media":
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
}

export function QuickNotePreview({ body, noteId, assets, onImageClick, fallbackText, onToggleTask, ellipsisClassName = "ln-ellipsis" }: QuickNotePreviewProps) {
  const nodes = useMemo(() => parseQuickNotePreview(body), [body]);
  /** 快路径还原不了 ⇒ 整条卡片交给内核（判据 = 解析器自己的 unsupported 节点，不另立清单）。 */
  const kernelFallback = useMemo(() => hasUnsupportedNodes(nodes), [nodes]);
  const hostRef = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [overflowing, setOverflowing] = useState(false);
  /** 超长默认收起一部分（用户 260919：#5 —— 否则一条长小记会把其他小记挤走），点「展开」看全部。 */
  const COLLAPSED_MAX_PX = 220;
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const measure = () => setOverflowing(host.scrollHeight > COLLAPSED_MAX_PX + 8);
    measure();
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    observer?.observe(host);
    return () => observer?.disconnect();
  }, [body, kernelFallback]);
  useEffect(() => { setExpanded(false); }, [body]);
  if (!kernelFallback && nodes.length === 0) {
    return fallbackText ? <p className="quick-note-preview-paragraph">{fallbackText}</p> : null;
  }
  const collapsed = overflowing && !expanded;
  return <>
    <div
      ref={hostRef}
      className={"quick-note-preview" + (collapsed ? " is-collapsed" : "")}
      style={collapsed ? { maxHeight: COLLAPSED_MAX_PX } : undefined}
    >
      {kernelFallback && noteId
        ? <QuickNoteKernelPreview body={body} noteId={noteId} />
        : <Nodes nodes={nodes} assets={assets} onImageClick={onImageClick} onToggleTask={onToggleTask} ellipsisClassName={ellipsisClassName} />}
    </div>
    {overflowing && <button
      className="quick-note-preview-toggle"
      onClick={(event) => { event.stopPropagation(); setExpanded((value) => !value); }}
    >{expanded ? <><ChevronUp size={13} />收起</> : <><ChevronDown size={13} />展开</>}</button>}
  </>;
}
