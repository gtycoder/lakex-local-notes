import React from 'react';
import Doc from '../lakex/lakex';

import './BlockCardSelect.css';

export interface BlockCardSelectProps {
  config: {
    groups?: unknown[];
    [key: string]: unknown;
  } | null;
  dark?: boolean;
  language?: 'zh-cn' | 'en-us';
  overlayContainer?: HTMLElement;
  themeSelector?: string;
  onCancel?: () => void;
  onSelect: (item: any, ...args: any[]) => void;
}

/**
 * 行菜单专用的 CardSelect 实例。
 *
 * 这里只复用 Lakex 导出的菜单视图与已经解析好的卡片定义，不复用工具栏
 * “+”按钮的 Popover、锚点或开关状态，因此两个入口互不影响。
 */
export function BlockCardSelect({
  config,
  dark = false,
  language = 'zh-cn',
  overlayContainer,
  themeSelector,
  onCancel,
  onSelect,
}: BlockCardSelectProps) {
  const SearchCardMenu = Doc.FrameworkUiLib.SearchCardMenu as React.ComponentType<any>;

  if (!config?.groups?.length) {
    return (
      <div className="ne-block-card-select-empty">
        {language === 'en-us' ? 'No available cards' : '无可用卡片'}
      </div>
    );
  }

  return (
    <SearchCardMenu
      className="ne-ui-toolbar-card-select-menu ne-block-card-select-menu"
      config={config}
      disableSearch
      emptyTipText={language === 'en-us' ? 'No available cards' : '无可用卡片'}
      isDark={dark}
      overlayContainer={overlayContainer}
      showHover
      themeSelector={themeSelector}
      onCancel={onCancel}
      onSelect={onSelect}
    />
  );
}

export default BlockCardSelect;
