/**
 * 思源 litheness \`iconExpandLevel\`（展开到级别）：左侧三级列表 + 右侧上下箭头。
 * 路径取自 siyuan \`app/appearance/icons/litheness/icon.js\`（AGPL-3.0），与思源大纲头部第四枚按钮一致；
 * 其余大纲头部图标（Filter/Focus/ChevronsUpDown/ChevronsDownUp）本就是 lucide，无需另造。
 */
export function ExpandLevelIcon({ size = 14 }: { size?: number }) {
  return (
    <svg
      className="lucide"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 5h8" />
      <path d="M3 12h8" />
      <path d="M3 19h8" />
      <path d="m15 8 3-3 3 3" />
      <path d="m15 16 3 3 3-3" />
    </svg>
  );
}
