/**
 * 移动端「文档内查找」条（261016；261029 起命中逻辑接内核）。
 * 顶部一行 = 输入 + `n/m` + 上一个/下一个 + 关闭（结构复用移动端 kit 原语）。
 *
 * 命中逻辑：**优先用内核同一套 search 服务**（与桌面工具栏查找同源：`ISearchService.onSearch()` →
 * count / jumpTo，高亮与滚动都由内核负责）。取不到服务时降级为原 DOM 扫描（CSS Custom Highlight），
 * 保证内核版本变化/特殊实例下查找仍可用。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronUp, X } from "lucide-react";
import { MAX_FIND_MATCHES, applyFindHighlights, clearFindHighlights, collectMatchRanges, nextMatchIndex, reconcileMatchIndex, scrollRangeIntoView } from "./mobileFind";
import { getKernelFindService, type KernelFindSession } from "./kernelFind";
import "./mobile-find.css";

export interface MobileFindBarProps {
  /** 扫描范围（文档正文容器）；宿主未就绪时传 null。仅 DOM 降级路径使用。 */
  root: HTMLElement | null;
  /** 正文签名（宿主传当前 content）。正文在查找期间被编辑时必须重搜。 */
  revision?: string;
  /** 编辑器实例（LakeEditorInstance）。内核查找服务从这里取；为 null 时走 DOM 降级。 */
  editor: unknown | null;
  onClose: () => void;
}

export function MobileFindBar({ root, revision, editor, onClose }: MobileFindBarProps) {
  const [query, setQuery] = useState("");
  /** DOM 降级路径的命中 Range（内核路径不用）。 */
  const [ranges, setRanges] = useState<Range[]>([]);
  const [domIndex, setDomIndex] = useState(-1);
  const [kernelCount, setKernelCount] = useState(0);
  const [kernelIndex, setKernelIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const sessionRef = useRef<KernelFindSession | null>(null);

  const service = useMemo(() => getKernelFindService(editor), [editor]);
  const usingKernel = service !== null;

  /** 打开即聚焦：用户点「查找」后可以直接打字。 */
  useEffect(() => { inputRef.current?.focus(); }, []);

  /** 内核路径：输入变化 / 正文被编辑 / 编辑器实例切换 ⇒ 重新发起一轮内核搜索。 */
  useEffect(() => {
    if (!service) return;
    sessionRef.current?.destroy();
    sessionRef.current = null;
    setKernelCount(0);
    setKernelIndex(-1);
    if (!query) return;
    let session: KernelFindSession | null = null;
    try { session = service.onSearch(query); } catch { session = null; }
    if (!session) return;
    sessionRef.current = session;
    const total = session.count;
    setKernelCount(total);
    if (total > 0) {
      // 第二个参数 = 「不要滚动」（truthy 会跳过 scrollByNodeId）⇒ 必须省略/false 才会滚到命中。
      try { session.jumpTo(0); } catch { /* 内核定位失败：计数仍可用，不打断输入 */ }
      setKernelIndex(0);
    }
    return () => {
      try { session?.destroy(); } catch { /* 已销毁 */ }
      if (sessionRef.current === session) sessionRef.current = null;
    };
  }, [service, query, revision]);

  /** DOM 降级路径：输入变化 / 正文容器就绪 / 正文被编辑 ⇒ 重新扫描（并尽量保住当前位置）。 */
  useEffect(() => {
    if (service) return;
    const list = root ? collectMatchRanges(root, query) : [];
    setRanges(list);
    setDomIndex((current) => reconcileMatchIndex(current, list.length));
  }, [service, root, query, revision]);

  /** DOM 路径：命中或当前位置变化 ⇒ 刷新高亮并把当前命中滚进可视区。 */
  useEffect(() => {
    if (service) return;
    applyFindHighlights(ranges, domIndex);
    const active = domIndex >= 0 ? ranges[domIndex] : undefined;
    if (root && active) scrollRangeIntoView(root, active);
  }, [service, ranges, domIndex, root]);

  /** 关闭（或切换文档）时清掉 DOM 高亮；内核 context 由上面的 effect 清理。 */
  useEffect(() => () => clearFindHighlights(), []);

  const total = usingKernel ? kernelCount : ranges.length;
  const index = usingKernel ? kernelIndex : domIndex;
  const displayIndex = index >= 0 ? index + 1 : 0;
  const suffix = usingKernel ? "" : (ranges.length >= MAX_FIND_MATCHES ? "+" : "");

  const go = useCallback((delta: number) => {
    if (usingKernel) {
      if (kernelCount <= 0) return;
      const next = nextMatchIndex(kernelIndex, delta, kernelCount);
      try { sessionRef.current?.jumpTo(next); } catch { /* 定位失败时保持旧位 */ }
      setKernelIndex(next);
      return;
    }
    setDomIndex((current) => nextMatchIndex(current, delta, ranges.length));
  }, [usingKernel, kernelCount, kernelIndex, ranges.length]);

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
      <span className="mb-find__count" aria-live="polite">{query && total > 0 ? `${displayIndex}/${total}${suffix}` : ""}</span>
      <button className="mb-iconbtn mb-iconbtn--compact" onClick={() => go(-1)} disabled={total === 0} aria-label="上一个" title="上一个"><ChevronUp size={18} /></button>
      <button className="mb-iconbtn mb-iconbtn--compact" onClick={() => go(1)} disabled={total === 0} aria-label="下一个" title="下一个"><ChevronDown size={18} /></button>
      <button className="mb-iconbtn mb-iconbtn--compact" onClick={onClose} aria-label="关闭查找" title="关闭"><X size={18} /></button>
    </div>
  );
}
