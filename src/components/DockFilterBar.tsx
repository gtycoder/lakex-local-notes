/**
 * dock 头部「隐藏式筛选」视图（目录栏 / 大纲共用；交互规则见 dockFilterModel.ts）。
 *
 * 视图只做两件事：按状态机渲染展开/收起的输入行，并把用户事件回灌给宿主状态
 * （目录树筛选词在 App，大纲筛选词在 OutlineController）。
 */
import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type RefObject } from "react";
import { Search } from "lucide-react";
import { initialDockFilterState, isFilterActive, stepDockFilter, type DockFilterEvent } from "./dockFilterModel";

export interface DockFilter {
  value: string;
  /** 输入框是否展开 */
  open: boolean;
  /** 是否有生效中的筛选词（图标常亮） */
  active: boolean;
  inputRef: RefObject<HTMLInputElement>;
  /** 图标按钮点击：展开 / 收起并清空 */
  toggle: () => void;
  onChange: (next: string) => void;
  onKeyDown: (event: ReactKeyboardEvent<HTMLInputElement>) => void;
  onBlur: () => void;
}

/**
 * @param value          宿主持有的筛选词（单一真相，组件不复制一份）
 * @param onValueChange  写回宿主；收起/Esc 时以空串调用一次（清空即解除筛选）
 */
export function useDockFilter(value: string, onValueChange: (next: string) => void): DockFilter {
  const [state, setState] = useState(() => initialDockFilterState(value));
  const inputRef = useRef<HTMLInputElement | null>(null);

  // 别处写入筛选词（如外部恢复/复用同一状态）时同步展开，避免"看不见却在筛选"。
  useEffect(() => {
    const step = stepDockFilter(state, { kind: "external-value", value });
    setState(step.state);
  }, [state, value]);

  // 收起时若输入框仍是焦点，交还给页面。
  // 注意：不能在 keydown(Esc)/toggle 里直接 blur()——那两个处理器拿到的 value 还是本次渲染的旧值，
  // 紧接着触发的 blur 会按"有内容"判定把输入框重新展开（实测 Esc 后行不收起就是这个原因）。
  useEffect(() => {
    if (!state.open && document.activeElement === inputRef.current) inputRef.current?.blur();
  }, [state.open]);

  const apply = useCallback((event: DockFilterEvent) => {
    const step = stepDockFilter(state, event);
    setState(step.state);
    if (step.clearValue) onValueChange("");
    if (step.focus) queueMicrotask(() => { inputRef.current?.focus(); inputRef.current?.select(); });
  }, [state, onValueChange]);

  const toggle = useCallback(() => apply({ kind: "toggle" }), [apply]);
  const onChange = useCallback((next: string) => {
    onValueChange(next);
    setState((prev) => stepDockFilter(prev, { kind: "input" }).state);
  }, [onValueChange]);
  const onKeyDown = useCallback((event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Escape") return;
    // 阻止冒泡：Esc 在本应用还承担"关闭菜单/浮层"的全局语义，清空筛选不应顺手关掉整个面板。
    event.stopPropagation();
    apply({ kind: "escape" });
  }, [apply]);
  const onBlur = useCallback(() => apply({ kind: "blur", value }), [apply, value]);

  return { value, open: state.open, active: isFilterActive(value), inputRef, toggle, onChange, onKeyDown, onBlur };
}

/** 展开/收起的筛选输入行：收起时不占位、不进无障碍树、不可聚焦。 */
export function DockFilterRow({ filter, placeholder, className = "" }: { filter: DockFilter; placeholder: string; className?: string }) {
  return (
    <div className={`dock-filter-row${filter.open ? " is-open" : ""}${className ? " " + className : ""}`} aria-hidden={!filter.open}>
      <div className="dock-filter-row__inner">
        <Search size={12} aria-hidden="true" />
        <input
          ref={filter.inputRef}
          className="dock-filter-input"
          placeholder={placeholder}
          aria-label={placeholder}
          value={filter.value}
          tabIndex={filter.open ? 0 : -1}
          spellCheck={false}
          onChange={(event) => filter.onChange(event.target.value)}
          onKeyDown={filter.onKeyDown}
          onBlur={filter.onBlur}
        />
      </div>
    </div>
  );
}
