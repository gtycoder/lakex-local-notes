/**
 * 卡工具条「下拉菜单」家族（内核 `.ne-card-toolbar-select-menu`）—— **卡工具条家族内单一来源**：
 * 图片浮栏的对齐 / 样式 / 批量二级菜单（SelectionToolbar.renderImage）与视频「宽度」弹层（VideoSizeMenu）
 * 共用这一对组件；类名 / 结构与云端图片工具栏逐字同构（样式全部来自 vendored lakex-doc.css / antd.css，
 * 非自造，见 .ne-card-toolbar-select-menu* 规则）。
 *
 * 261119 用户终裁：「视频宽度弹窗还是使用内核风格吧，就和图片的风格保持一致就行了」⇒ 视频宽度弹层同用
 * 本家族表面 / 菜单项。该弹窗属于**卡工具条内核家族表面，例外于 ln-* 单一来源**（用户裁决覆盖偏好，
 * 口径详见 VideoSizeMenu.tsx 头注释）。
 */
import { type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
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
 * `focusable` / `ariaPressed` 只给「非纯菜单」表面（视频宽度弹层）用：行本身 Tab 可达、Enter/Space 激活、
 * 选中态带 aria-pressed（该弹层的交互件要求 Tab 可达）；图片对齐 / 样式 / 批量等纯菜单不传，
 * 保持内核原样的鼠标菜单语义（DOM 与改造前逐字一致）。
 */
export function CardMenuItem({ label, icon, selected, onClick, ariaPressed, focusable }: {
  label: string; icon?: string; selected?: boolean; onClick?: () => void;
  ariaPressed?: boolean; focusable?: boolean;
}) {
  return (
    <li
      role="menuitem"
      aria-pressed={ariaPressed}
      tabIndex={focusable ? 0 : undefined}
      className={"ant-dropdown-menu-item ne-card-toolbar-select-menu-item" + (selected ? " ant-dropdown-menu-item-selected" : "")}
      onClick={onClick}
      onKeyDown={focusable ? (e: ReactKeyboardEvent<HTMLLIElement>) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick?.(); }
      } : undefined}
    >
      <div className="ne-card-toolbar-check-icon"><KIcon type="check" /></div>
      <div className="ne-card-toolbar-select-item-content">
        {icon ? <div className="ne-card-toolbar-select-item-icon"><KIcon type={icon} /></div> : null}
        <div className="ne-card-toolbar-select-item-label">{label}</div>
      </div>
    </li>
  );
}
