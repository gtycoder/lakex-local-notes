/**
 * 云端语雀工具栏里的 AI 入口图标（原样取自 `larkui-icon-icon-ai-tag-new` / `IconAiTagNew`，viewBox 0 0 222 222）。
 * 绿色渐变两段色走主题令牌（桌面 CSS 禁止颜色字面量 ⇒ 只在 themes/base.css 定义）；
 * `<stop>` 用内联 style 而非属性，确保 `var()` 能被解析。
 */
export function AiTagIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 222 222" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient x1="16.301%" y1="15.187%" x2="81.58%" y2="87.389%" id="ai-tag-grad">
          <stop offset="0%" style={{ stopColor: "var(--lake-ai-tag-from)" }} />
          <stop offset="100%" style={{ stopColor: "var(--lake-ai-tag-to)" }} />
        </linearGradient>
      </defs>
      <g fill="none" fillRule="evenodd">
        <path d="M-17-16.646h256v256H-17z" />
        <path d="M128 16.646c61.304 0 111 49.697 111 111 0 61.304-49.696 111-111 111H51c-18.778 0-34-15.222-34-34v-77c0-61.303 49.696-111 111-111ZM99.805 74.954c-6.371-1.825-13.016 1.86-14.84 8.231l-24.578 85.789c-1.521 5.31 1.55 10.846 6.859 12.367l.27.074c5.226 1.343 10.602-1.714 12.097-6.933l3.468-12.11h26.836l3.47 12.11c1.52 5.31 7.058 8.38 12.367 6.86 5.31-1.522 8.38-7.059 6.86-12.368l-24.578-85.789a12 12 0 0 0-8.231-8.231ZM173 74.646h-20c-5.523 0-10 4.478-10 10 0 5.523 4.477 10 10 10h.5v66.5c0 .168.004.335.012.5H153c-5.523 0-10 4.478-10 10 0 5.523 4.477 10 10 10h20c5.523 0 10-4.477 10-10 0-5.36-4.216-9.734-9.513-9.988.009-.17.013-.34.013-.512V94.634c5.29-.26 9.5-4.632 9.5-9.988 0-5.522-4.477-10-10-10Zm-76.5 40.892 7.687 26.835H88.811l7.689-26.835Z" fill="url(#ai-tag-grad)" transform="translate(-17 -16.646)" />
      </g>
    </svg>
  );
}
