/**
 * 卡工具条「下拉菜单」家族（内核 `.ne-card-toolbar-select-menu`）—— **卡工具条家族内单一来源**：
 * 图片浮栏的对齐 / 样式 / 批量二级菜单（SelectionToolbar.renderImage）共用这一对组件；
 * 类名 / 结构与云端图片工具栏逐字同构（样式全部来自 vendored lakex-doc.css / antd.css，
 * 非自造，见 .ne-card-toolbar-select-menu* 规则）。
 *
 * 尺寸弹层另管：图片 imgsize / 视频 videosize 的「宽度」弹窗走共享样板组件 `MediaSizePop`
 * （本家族只管下拉菜单；VideoSizeMenu 改判后已不再用 CardMenu*，focusable / ariaPressed 无调用方随之删除）。
 */
import { type CSSProperties, type ReactNode } from "react";
import { KIcon } from "./kernelUiAtoms";

/** 图片浮栏：内核卡片工具栏下拉菜单（云端同款 `.ne-card-toolbar-select-menu`）。 */
export function CardMenu({ menu, style, surfaceRef, children }: { menu: string; style?: CSSProperties; surfaceRef?: (el: HTMLElement | null) => void; children: ReactNode }) {
  return (
    <div ref={surfaceRef} style={style} className="selection-toolbar__kmenu" data-menu={menu}>
      <ul className="ant-dropdown-menu ant-dropdown-menu-root ant-dropdown-menu-vertical ant-dropdown-menu-light ne-card-toolbar-select-menu" role="menu">{children}</ul>
    </div>
  );
}

/**
 * 菜单项（`.ne-card-toolbar-select-menu-item`）：30px 对勾槽常驻（几何不动），选中靠
 * `.ant-dropdown-menu-item-selected` 把 `.ne-card-toolbar-check-icon` 从 opacity:0 翻到 1（内核 CSS）。
 * 纯菜单语义（内核原样的鼠标菜单；DOM 与改造前逐字一致）——历史上给视频宽度弹层用的
 * `focusable` / `ariaPressed`（Tab 可达 / aria-pressed）已随该弹层改走 MediaSizePop 删除（无调用方）。
 */
export function CardMenuItem({ label, icon, selected, onClick }: {
  label: string; icon?: string; selected?: boolean; onClick?: () => void;
}) {
  return (
    <li
      role="menuitem"
      className={"ant-dropdown-menu-item ne-card-toolbar-select-menu-item" + (selected ? " ant-dropdown-menu-item-selected" : "")}
      onClick={onClick}
    >
      <div className="ne-card-toolbar-check-icon"><KIcon type="check" /></div>
      <div className="ne-card-toolbar-select-item-content">
        {icon ? <div className="ne-card-toolbar-select-item-icon"><KIcon type={icon} /></div> : null}
        <div className="ne-card-toolbar-select-item-label">{label}</div>
      </div>
    </li>
  );
}
