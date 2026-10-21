/**
 * dev 期「未分层全局 CSS」运行时探针（261021）。
 *
 * 为什么还要运行时探针：产物护栏（`scripts/css-audit/audit-vendor-css.mjs`，挂在 check:bundle）
 * 只守构建产物；而 dev 不构建、打包版也可能被绕过。这里在**开发期每次页面加载后**扫一遍
 * `document.styleSheets` 的注文本，命中就打 console.warn —— 让"一行 import 改全站"在开发当下可见。
 *
 * 判据与产物审计**同一份实现**（`src/lib/cssLayerScan.ts`）：未分层 + 裸标签选择器 + reset 属性。
 * 只在 `import.meta.env.DEV` 下安装（见 src/main.tsx），产物里没有这段代码。
 *
 * e2e 可用 `window.__cssLayerProbe()` 直接取命中列表（空数组 = 干净）。
 */
import { scanUnlayeredGlobalRules } from "./cssLayerScan";

export interface UnlayeredGlobalSheet {
  /** 样式表来源（dev 下是 vite 注入的 data-vite-dev-id 路径，便于定位是哪个文件）。 */
  sheet: string;
  selectors: string[];
}

interface StyleSheetLike {
  ownerNode: unknown;
}

const sheetLabel = (sheet: StyleSheetLike): string => {
  const node = sheet.ownerNode as { dataset?: Record<string, string | undefined>; getAttribute?: (name: string) => string | null } | null;
  return node?.dataset?.viteDevId ?? node?.getAttribute?.("href") ?? "(inline <style>)";
};

/** 读一张样式表的文本：dev 注入的 <style> 可以直接读 textContent；跨源 <link> 读不到就跳过。 */
const sheetText = (sheet: StyleSheetLike): string | null => {
  const node = sheet.ownerNode as { tagName?: string; textContent?: string | null } | null;
  if (!node) return null;
  if (node.tagName === "STYLE") return node.textContent ?? "";
  return null; // <link>（构建产物/预览）不读：dev 里第三方 CSS 都以 <style data-vite-dev-id> 注入
};

/** 扫描当前文档的全部样式表，返回命中的表（纯查询、无副作用）。 */
export function scanDocumentSheetTexts(texts: { sheet: string; text: string }[]): UnlayeredGlobalSheet[] {
  const hits: UnlayeredGlobalSheet[] = [];
  for (const { sheet, text } of texts) {
    const selectors = scanUnlayeredGlobalRules(text);
    if (selectors.length) hits.push({ sheet, selectors });
  }
  return hits;
}

/** 收集当前 document 的样式表（导出便于单测传假 Document）。 */
export function collectSheetTexts(doc: Document = document): { sheet: string; text: string }[] {
  const out: { sheet: string; text: string }[] = [];
  for (const sheet of Array.from(doc.styleSheets) as unknown as StyleSheetLike[]) {
    const text = sheetText(sheet);
    if (text !== null) out.push({ sheet: sheetLabel(sheet), text });
  }
  return out;
}

/**
 * 安装探针：立即扫一次 + 定时复扫（懒 chunk 的 CSS 是后注入的）。
 * 命中只报"新出现"的组合，避免每次定时刷屏。
 */
export function installCssLayerProbe(win: Window = window): () => void {
  const reported = new Set<string>();
  const run = (): UnlayeredGlobalSheet[] => {
    const findings = scanDocumentSheetTexts(collectSheetTexts(win.document));
    for (const finding of findings) {
      for (const selector of finding.selectors) {
        const key = `${finding.sheet}::${selector}`;
        if (reported.has(key)) continue;
        reported.add(key);
        console.warn(
          `[css-layer-probe] 发现未分层全局 CSS：${selector}（来源 ${finding.sheet}）\n` +
            "未分层普通声明会压过所有 @layer 规则（设计系统全靠层序）。\n" +
            "修法：第三方/全局 CSS 只能由 src/styles/index.css 以 @import … layer(...) 引入；组件/懒 chunk 只 import 自己的作用域 CSS。",
        );
      }
    }
    return findings;
  };

  // 供 e2e / 手工调试断言：window.__cssLayerProbe() 返回当前命中
  (win as unknown as Record<string, unknown>).__cssLayerProbe = () => scanDocumentSheetTexts(collectSheetTexts(win.document));

  run();
  const timers = [500, 1500, 4000].map((ms) => win.setTimeout(run, ms));
  const interval = win.setInterval(run, 5000);
  return () => {
    timers.forEach((timer) => win.clearTimeout(timer));
    win.clearInterval(interval);
  };
}
