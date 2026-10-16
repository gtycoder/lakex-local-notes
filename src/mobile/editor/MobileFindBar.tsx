/**
 * 移动端「文档内查找」条（261016）：顶部一行 = 输入 + `n/m` + 上一个/下一个 + 关闭。
 * 结构复用移动端 kit 原语（`.mb-input` / `.mb-iconbtn--compact`），只新增容器与命中高亮两条自有规则
 * （见同目录 mobile-find.css）；命中高亮走 CSS Custom Highlight API。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronUp, X } from "lucide-react";
import { MAX_FIND_MATCHES, applyFindHighlights, clearFindHighlights, collectMatchRanges, nextMatchIndex, reconcileMatchIndex, scrollRangeIntoView } from "./mobileFind";
import "./mobile-find.css";

export interface MobileFindBarProps {
  /** 扫描范围（文档正文容器）；宿主未就绪时传 null。 */
  root: HTMLElement | null;
  /**
   * 正文签名（宿主传当前 content）。正文在查找期间被编辑时必须重扫：
   * 否则命中数是旧的、且 Range 可能已失效（点「下一个」会滚到错误位置）。
   */
  revision?: string;
  onClose: () => void;
}

export function MobileFindBar({ root, revision, onClose }: MobileFindBarProps) {
  const [query, setQuery] = useState("");
  const [ranges, setRanges] = useState<Range[]>([]);
  const [index, setIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement | null>(null);

  /** 打开即聚焦：用户点「查找」后可以直接打字。 */
  useEffect(() => { inputRef.current?.focus(); }, []);

  /** 输入变化 / 正文容器就绪 / **正文被编辑** ⇒ 重新扫描（并尽量保住当前位置）。 */
  useEffect(() => {
    const list = root ? collectMatchRanges(root, query) : [];
    setRanges(list);
    setIndex((current) => reconcileMatchIndex(current, list.length));
  }, [root, query, revision]);

  /** 命中或当前位置变化 ⇒ 刷新高亮并把当前命中滚进可视区。 */
  useEffect(() => {
    applyFindHighlights(ranges, index);
    const active = index >= 0 ? ranges[index] : undefined;
    if (root && active) scrollRangeIntoView(root, active);
  }, [ranges, index, root]);

  /** 关闭（或切换文档）时清掉高亮，别把颜色留在正文里。 */
  useEffect(() => () => clearFindHighlights(), []);

  const go = useCallback((delta: number) => {
    setIndex((current) => nextMatchIndex(current, delta, ranges.length));
  }, [ranges.length]);

  return (
    <div className="mb-find" role="search">
      <input
        ref={inputRef}
        className="mb-input mb-flex1"
        type="search"
        enterKeyHint="search"
        placeholder="在文档中查找"
        aria-label="在文档中查找"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") { event.preventDefault(); go(1); }
          else if (event.key === "Escape") { event.preventDefault(); onClose(); }
        }}
      />
      <span className="mb-find__count" aria-live="polite">{query ? `${index + 1}/${ranges.length}${ranges.length >= MAX_FIND_MATCHES ? "+" : ""}` : ""}</span>
      <button className="mb-iconbtn mb-iconbtn--compact" onClick={() => go(-1)} disabled={ranges.length === 0} aria-label="上一个" title="上一个"><ChevronUp size={18} /></button>
      <button className="mb-iconbtn mb-iconbtn--compact" onClick={() => go(1)} disabled={ranges.length === 0} aria-label="下一个" title="下一个"><ChevronDown size={18} /></button>
      <button className="mb-iconbtn mb-iconbtn--compact" onClick={onClose} aria-label="关闭查找" title="关闭"><X size={18} /></button>
    </div>
  );
}
