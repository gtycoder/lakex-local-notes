/**
 * 开发期字体试用切换器（UI 重设计 P3）。
 *
 * 目的：让用户多试几款字体后**定默认**。**仅 dev 安装**、不进设置项、不落盘；
 * 正式默认字体将来写回 src/styles/themes/base.css 的 --lake-font-family* 三个令牌。
 *
 * 用法（dev 控制台）：
 *   __lakeFontTrial.list()            // 候选 + 本机是否可用（document.fonts.check）
 *   __lakeFontTrial.apply("songti")   // 试用（只改 CSS 变量，刷新即还原）
 *   __lakeFontTrial.current()         // 当前生效的 id
 *   __lakeFontTrial.reset()           // 还原默认
 */

export interface FontCandidate {
  id: string;
  label: string;
  /** 界面字体栈 */
  stack: string;
  /** 正文（编辑器）字体栈；缺省 = 与界面同栈 */
  reading?: string;
  /** 等宽字体栈；只有需要的候选项给 */
  mono?: string;
}

const SANS_FALLBACK = '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei UI", "Noto Sans CJK SC", sans-serif';

export const FONT_CANDIDATES: FontCandidate[] = [
  { id: "system", label: "系统默认（SF Pro + 苹方/冬青黑）", stack: '-apple-system, BlinkMacSystemFont, "Segoe UI", ' + SANS_FALLBACK },
  { id: "pingfang", label: "苹方 PingFang SC", stack: '"PingFang SC", ' + SANS_FALLBACK },
  { id: "hiragino", label: "冬青黑体 Hiragino Sans GB", stack: '"Hiragino Sans GB", ' + SANS_FALLBACK },
  { id: "songti", label: "宋体 Songti SC（衬线）", stack: '"Songti SC", "Songti TC", "SimSun", serif', reading: '"Songti SC", "Songti TC", "SimSun", serif' },
  { id: "heiti", label: "黑体-简 STHeiti", stack: '"STHeiti", "Heiti SC", ' + SANS_FALLBACK },
  { id: "kaiti", label: "楷体 Kaiti SC（衬线）", stack: '"Kaiti SC", "KaiTi", "STKaiti", serif', reading: '"Kaiti SC", "KaiTi", "STKaiti", serif' },
  { id: "sourcehan", label: "思源黑体 Source Han Sans / Noto Sans CJK SC", stack: '"Source Han Sans SC", "Noto Sans CJK SC", ' + SANS_FALLBACK },
  { id: "lxgw", label: "霞鹜文楷 LXGW WenKai（需自行安装）", stack: '"LXGW WenKai", "LXGW WenKai TC", ' + SANS_FALLBACK, reading: '"LXGW WenKai", "LXGW WenKai TC", ' + SANS_FALLBACK },
];

const FIRST_FAMILY = /^\s*"?([^,"]+)"?/;

/** 该候选的首选字体在本机是否真的可用（否则会静默回退到 fallback，用户会以为"没变化"）。 */
export function candidateAvailable(id: string): boolean {
  const c = FONT_CANDIDATES.find((x) => x.id === id);
  if (!c) return false;
  if (c.id === "system") return true;
  const m = FIRST_FAMILY.exec(c.stack);
  if (!m) return false;
  try { return document.fonts.check('16px "' + m[1].trim() + '"'); } catch { return false; }
}

let applied: string | null = null;

export function applyFontCandidate(id: string): boolean {
  const c = FONT_CANDIDATES.find((x) => x.id === id);
  if (!c) return false;
  const root = document.documentElement.style;
  root.setProperty("--lake-font-family", c.stack);
  root.setProperty("--lake-font-family-reading", c.reading ?? c.stack);
  if (c.mono) root.setProperty("--lake-font-family-mono", c.mono);
  else root.removeProperty("--lake-font-family-mono");
  applied = id;
  return true;
}

export function resetFontTrial(): void {
  const root = document.documentElement.style;
  root.removeProperty("--lake-font-family");
  root.removeProperty("--lake-font-family-reading");
  root.removeProperty("--lake-font-family-mono");
  applied = null;
}

export function installFontTrial(): void {
  window.__lakeFontTrial = {
    list: () => FONT_CANDIDATES.map((c) => ({ id: c.id, label: c.label, available: candidateAvailable(c.id) })),
    apply: (id: string) => applyFontCandidate(id),
    current: () => applied,
    reset: () => resetFontTrial(),
  };
  // eslint-disable-next-line no-console
  console.info("[font-trial] 可用：__lakeFontTrial.list() / .apply(id) / .reset()");
}

declare global {
  interface Window {
    __lakeFontTrial?: {
      list: () => Array<{ id: string; label: string; available: boolean }>;
      apply: (id: string) => boolean;
      current: () => string | null;
      reset: () => void;
    };
  }
}
