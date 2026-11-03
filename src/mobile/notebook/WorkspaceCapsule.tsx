import { ArrowLeftRight, File, Files, List } from "lucide-react";

/**
 * 工作区底部胶囊（261103 P4 拆件）：文档树 / 标签页 / 大纲 / 切换笔记本。
 * 手机与平板**同一套**（用户定稿）；显隐/抬升只由调用方给的布尔控制，组件本身无状态。
 */
export interface WorkspaceCapsuleProps {
  hidden: boolean;
  /** 文档编辑态：抬到底部 dock 上方（261103）。 */
  aboveDock: boolean;
  /** 表格阅读态：让位 Univer 自带工具条。 */
  aboveSheet: boolean;
  treeActive: boolean;
  tabsActive: boolean;
  outlineActive: boolean;
  outlineAvailable: boolean;
  tabCount: number;
  title: string;
  onTree: () => void;
  onTabs: () => void;
  onOutline: () => void;
  onSwitchNotebook: () => void;
}

export function WorkspaceCapsule(props: WorkspaceCapsuleProps) {
  const { hidden, aboveDock, aboveSheet, treeActive, tabsActive, outlineActive, outlineAvailable, tabCount, title } = props;
  return (
    <nav
      className={"mobile-bottom-bar"
        + (hidden ? " mobile-bottom-bar--hidden" : "")
        + (aboveDock ? " mobile-bottom-bar--above-dock" : "")
        + (aboveSheet ? " mobile-bottom-bar--above-sheet" : "")}
      data-prevent-swipe
      aria-hidden={hidden ? "true" : "false"}
    >
      <button
        className={"mobile-bottom-bar__item" + (treeActive ? " active" : "")}
        onClick={props.onTree}
        aria-label="文档树"
        title="文档树"
      ><Files /></button>
      <button
        className={"mobile-bottom-bar__item" + (tabsActive ? " active" : "")}
        onClick={props.onTabs}
        aria-label="标签页"
        title="标签页"
      ><File />{tabCount > 0 && <span className="bottom-bar-count">{tabCount}</span>}</button>
      <button
        className={"mobile-bottom-bar__item" + (outlineActive ? " active" : "")}
        onClick={props.onOutline}
        disabled={!outlineAvailable}
        aria-label="大纲"
        title={outlineAvailable ? "大纲" : "该文档类型没有大纲"}
      ><List /></button>
      <button
        className="mobile-bottom-bar__item"
        onClick={props.onSwitchNotebook}
        aria-label="切换笔记本"
        title={"切换笔记本（当前：" + title + "）"}
      ><ArrowLeftRight /></button>
    </nav>
  );
}
