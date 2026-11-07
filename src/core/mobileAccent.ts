/**
 * 移动端「笔记本动态主色」（261107 v2 柔光纸面）：
 * 把笔记本 id 稳定映射到 5 色板之一，只影响外壳强调色（--mb-accent / --mb-accent-ink），
 * 不写正文、不参与同步、不影响桌面。
 *
 * 口径：
 * - 固定 5 色（与设计基线 docs/MOBILE-DESIGN §0.4 一致）——不允许任意取色，保证浅/深色下对比度与一致性；
 * - 纯函数 + 稳定散列：同一笔记本在重启/换端后颜色不变；
 * - 空 id / 异常输入回落墨蓝（= --lake-accent 的默认语义）。
 */
export interface MobileAccent {
  /** 主色（图形/边框/焦点环/选中底纹） */
  base: string;
  /** 主色文字档（文字、图标前景，保证 AA） */
  ink: string;
  /** 色板名（测试/调试用） */
  name: string;
}

export const MOBILE_ACCENTS: readonly MobileAccent[] = [
  { name: "墨蓝", base: "#3f5fa0", ink: "#33497f" },
  { name: "青绿", base: "#2f7a6b", ink: "#24604f" },
  { name: "暖金", base: "#a9721c", ink: "#7f5411" },
  { name: "紫", base: "#6b5bd6", ink: "#4f41ac" },
  { name: "玫瑰", base: "#b4506a", ink: "#8c3b52" },
];

/** 稳定散列（djb2 变体）：只用于选色，不参与任何安全/标识用途。 */
function hashId(id: string): number {
  let h = 5381;
  for (let i = 0; i < id.length; i += 1) h = ((h << 5) + h + id.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export function mobileAccentForNotebook(notebookId: string | null | undefined): MobileAccent {
  if (!notebookId) return MOBILE_ACCENTS[0];
  return MOBILE_ACCENTS[hashId(notebookId) % MOBILE_ACCENTS.length];
}

/** 直接给 React 根节点用的 CSS 变量（不写颜色字面量到组件 CSS/主题之外）。 */
export function mobileAccentVars(notebookId: string | null | undefined): Record<string, string> {
  const accent = mobileAccentForNotebook(notebookId);
  // --mb-accent-soft / --mb-canvas-glow 在 theme/:root 里声明，自定义属性会在声明处就完成 var() 替换 ⇒
  // 只在工作区根节点覆盖 --mb-accent 不会让它们跟着变。这里直接给出基于本笔记本主色的取值
  // （color-mix 里的 var(--lake-bg-panel) 在使用处解析，浅/深色自动跟随）。
  return {
    "--mb-accent": accent.base,
    "--mb-accent-ink": accent.ink,
    "--mb-accent-soft": `color-mix(in srgb, ${accent.base} 13%, var(--lake-bg-panel))`,
    "--mb-canvas-glow": `color-mix(in srgb, ${accent.base} 11%, transparent)`,
  };
}
