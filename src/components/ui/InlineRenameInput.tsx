import { useCallback, useEffect, useRef, type Ref } from "react";

/**
 * 行内重命名输入（DT-12，261028）：把「Enter 提交 / Esc 取消 / 失焦是否提交 / 空名怎么办」收敛成一个原语。
 *
 * 为什么有它：目录重命名弹窗、标签管理行内重命名（以及后续同型入口）各写一套 onKeyDown，
 * 三处的**空名口径本来就不同**，靠的是各自的 if 判断散落在业务函数里：
 *  · 目录（Sidebar）：空名 = 不提交、保持原名（弹窗里「确定」同时置灰）—— `fallback`；
 *  · 标签（QuickNoteTagManager）：空名 = 退出编辑、不改名 —— `reject`；
 *  · 允许空名的场景 —— `allow`。
 * 这里只收敛交互与判定，**差异用 props 表达**，不改任何一处的既有行为。
 *
 * 组件只渲染一个 <input>（不包 wrapper）：调用方原有的 `.ln-input` 外壳、类名、aria 一律原样传进来，
 * DOM 结构与几何不变。
 */
export type RenameEmptyPolicy = "fallback" | "reject" | "allow";

export interface RenameCommitPlan {
  /** commit＝提交（value 已 trim）；cancel＝放弃编辑；none＝什么都不做（保留当前编辑态）。 */
  action: "commit" | "cancel" | "none";
  value: string;
}

/**
 * 提交判定（纯函数，单独导出给单测）：trim 后非空一律提交；空名按策略分流。
 * - fallback：保持编辑态、不改名（目录重命名弹窗：空名时「确定」是置灰的，回车也不该有副作用）；
 * - reject：退出编辑、不改名（标签行内重命名）；
 * - allow：允许提交空串（由调用方决定怎么写）。
 */
export function resolveRenameCommit(value: string, policy: RenameEmptyPolicy): RenameCommitPlan {
  const name = value.trim();
  if (name.length > 0) return { action: "commit", value: name };
  if (policy === "allow") return { action: "commit", value: "" };
  if (policy === "reject") return { action: "cancel", value: "" };
  return { action: "none", value: "" };
}

export interface InlineRenameInputProps {
  value: string;
  onChange(value: string): void;
  /** Enter（以及 commitOnBlur 时为失焦）提交；入参已 trim。 */
  onCommit(value: string): void;
  /** Esc 取消（调用方恢复/退出编辑态）。 */
  onCancel(): void;
  /** 空名策略（见 resolveRenameCommit）。 */
  emptyPolicy: RenameEmptyPolicy;
  /** 失焦也走提交（默认 false：三处现状都只在 Enter 提交）。 */
  commitOnBlur?: boolean;
  /**
   * 聚焦即全选（**默认开启**，261106 用户验收：新建/重命名打开后名称默认全选，直接打字即整体替换）。
   * 传 false 可关掉（例如以后要「光标落在末尾继续补全」的场景）；
   * 统一由这一处实现，**调用方不要再手写 onFocus + select()**。
   */
  selectOnFocus?: boolean;
  className?: string;
  /** 映射到 aria-label（调用方各自的原值）。 */
  ariaLabel?: string;
  autoFocus?: boolean;
  disabled?: boolean;
  placeholder?: string;
  /** 外部 ref（目录弹窗要把它交给 <Dialog initialFocus>）。 */
  inputRef?: Ref<HTMLInputElement>;
}

export function InlineRenameInput({
  value,
  onChange,
  onCommit,
  onCancel,
  emptyPolicy,
  commitOnBlur = false,
  selectOnFocus = true,
  className,
  ariaLabel,
  autoFocus = false,
  disabled = false,
  placeholder,
  inputRef,
}: InlineRenameInputProps) {
  /** Enter/Esc 已收尾后，紧随其后的 blur 不能再提交一次（提交常伴随失焦或卸载）。 */
  const settledRef = useRef(false);
  /** 内部 ref：既转发给调用方（Dialog initialFocus 要它），又用于「打开即全选」的补选。 */
  const innerRef = useRef<HTMLInputElement | null>(null);
  const assignRef = useCallback((node: HTMLInputElement | null) => {
    innerRef.current = node;
    if (typeof inputRef === "function") inputRef(node);
    else if (inputRef) (inputRef as { current: HTMLInputElement | null }).current = node;
  }, [inputRef]);

  /**
   * 打开即全选（261106 用户验收）。为什么不能只靠 onFocus：弹窗里的输入框由 `Dialog` 的 initialFocus
   * 在**布局阶段**的 focus() 聚焦（portal 首帧），React 的 focus 合成事件在那时可能还没挂上 ⇒ 实测
   * `select()` 一次都没被调用（selection 停在 value 末尾）。这里在挂载后的被动 effect 里补一次，
   * onFocus 仍然保留（用户之后 Tab 回来再全选）。两处都在这一组件内，调用方不手写 selection。
   */
  useEffect(() => {
    if (!selectOnFocus) return;
    const el = innerRef.current;
    if (el && document.activeElement === el) el.select();
  }, [selectOnFocus]);

  const settle = () => {
    const plan = resolveRenameCommit(value, emptyPolicy);
    if (plan.action === "none") return;
    settledRef.current = true;
    if (plan.action === "commit") onCommit(plan.value);
    else onCancel();
  };

  return (
    <input
      ref={assignRef}
      className={className}
      value={value}
      aria-label={ariaLabel}
      autoFocus={autoFocus}
      disabled={disabled}
      placeholder={placeholder}
      onChange={(event) => onChange(event.target.value)}
      onFocus={selectOnFocus ? (event) => event.currentTarget.select() : undefined}
      onKeyDown={(event) => {
        if (event.key === "Enter") { event.preventDefault(); settle(); }
        else if (event.key === "Escape") { event.preventDefault(); settledRef.current = true; onCancel(); }
      }}
      onBlur={commitOnBlur ? () => { if (!settledRef.current) settle(); } : undefined}
    />
  );
}
