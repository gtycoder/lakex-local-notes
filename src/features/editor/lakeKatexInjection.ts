/**
 * DT-07：KaTeX / mhchem 的**顺序预注入**（从 lakeRuntime.createLakeDocument 抽出）。
 *
 * 为什么单独成模块：这两行有**全局副作用**（往 <body> 插 <script>），且顺序是硬约束；
 * 原先埋在 900 行的 createLakeDocument 里，清理点只能靠 `__disposeExtras` 人工枚举。
 *
 * 顺序语义（勿改）：动态脚本默认 `async=true`，并行加载时 mhchem 可能先跑，
 * 此时 `window.katex` 还没就绪 → "Cannot read properties of undefined (reading '__defineMacro')"。
 * 显式 `async=false` 后经典脚本按插入顺序执行；并复用 Lake gJ 的 loaded/error 属性协议，
 * 避免它再次注入或等待永不触发的 load 事件。
 */

/** 与 createLakeDocument 的 `math.KaTexURL` 保持同一份相对路径，供预注入脚本去重匹配。 */
export const LAKE_KATEX_SCRIPT = "./vendor/cdn/os/lib/katex/0.16.8/dist/katex.min.js";
export const LAKE_MHCHEM_SCRIPT = "./vendor/cdn/os/lib/katex/0.16.8/dist/contrib/mhchem.min.js";

/**
 * 按 katex → mhchem 顺序把本地镜像脚本注入 <body>，返回 dispose。
 *
 * dispose 是**空操作**：脚本是进程级共享资源（Lake 按 `script[src]` 去重复用，后开的文档
 * 与已打开的公式卡都还在用）；销毁单个编辑器时摘掉脚本会让下一实例重新走异步加载。
 * 这里保留统一的「返回 dispose」契约，由 createLakeDocument 汇总进 `__disposeExtras`。
 */
export function injectKatexScriptsInOrder(): () => void {
  if (typeof document === "undefined") return () => undefined;
  const ensure = (src: string): void => {
    if (document.querySelector(`script[src="${src}"]`)) return;
    const el = document.createElement("script");
    el.src = src;
    el.async = false;
    el.addEventListener("load", () => el.setAttribute("loaded", "true"), { once: true });
    el.addEventListener("error", () => el.setAttribute("error", "true"), { once: true });
    document.body.appendChild(el);
  };
  ensure(LAKE_KATEX_SCRIPT);
  ensure(LAKE_MHCHEM_SCRIPT);
  return () => undefined;
}
