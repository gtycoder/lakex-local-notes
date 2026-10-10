/**
 * lakex 内核资源本地化（**桌面与移动端共用一份**）。
 *
 * 为什么共用：此前 `vite.config.ts` 的 `lakexAlipayLocal` 与 `vite.mobile.config.ts` 的 `lakexAlipayLocalMobile`
 * 是两份复制品（移动端那份自注释就写着「POC 复制，正式迁移时抽共享模块」）⇒ **升级内核要改两处**，
 * 且移动端少了桌面的 PostCSS 兜底（见下）。现收成单一来源。
 *
 * 内容：
 * - `ALIPAY_JS_REUSE` / `MIRROR_EXACT`：镜像映射表；
 * - `lakexGwUrlLocalPostcss()`：**CSS `@import` 内联兜底** —— Vite 会把 vendor 样式内联进入口表，
 *   绕过按模块 id 判断的 transform（桌面就因此漏改过：dist CSS 残留 186 处 gw 引用）。PostCSS 在
 *   `@import` 内联**之后**运行，所以在 CSS 层兜底。**两端都要挂**（移动端此前没挂）。
 * - `lakexAlipayLocal({ csp })`：按模块 id 改写内核 CSS/JS 里的 gw URL + 注入 CSP meta。
 *   CSP 由各端传入（桌面有 dev/prod 两套、移动端一套 + WebView scheme）。
 */
import type { Plugin } from "vite";

/** 动态加载脚本 → 复用 index.html/vendor 已在用的本地文件。 */
export const ALIPAY_JS_REUSE: Record<string, string> = {
  "https://gw.alipayobjects.com/as/g/larkgroup/lake-codemirror/7.1.3/CodeMirror.js": "/vendor/cdn/as/g/larkgroup/lake-codemirror/7.1.3/CodeMirror.js",
  "https://gw.alipayobjects.com/render/p/yuyan_v/180020010000005484/7.1.27/CodeMirror.js": "/vendor/cdn/as/g/larkgroup/lake-codemirror/7.1.3/CodeMirror.js",
  "https://gw.alipayobjects.com/os/lib/katex/0.16.8/dist/katex.min.js": "/vendor/cdn/os/lib/katex/0.16.8/dist/katex.min.js",
  "https://gw.alipayobjects.com/os/lib/katex/0.16.8/dist/contrib/mhchem.min.js": "/vendor/cdn/os/lib/katex/0.16.8/dist/contrib/mhchem.min.js",
};

/** 少数非 gw host 的运行期图片：镜像后按完整 URL 精确重写（basename 有撞名风险，故用整串精确匹配）。 */
export const MIRROR_EXACT: Record<string, string> = {
  "https://mdn.alipayobjects.com/huamei_0prmtq/afts/img/A*KA8xSYmgiYgAAAAAAAAAAAAADvuFAQ/original": "/vendor/lakex/misc/drawnix-default.jpg",
};

const GW_RE = /https:\/\/gw\.alipayobjects\.com\/[^\s)"']+/g;

/** CSS `@import` 内联兜底（PostCSS 插件）。两端都必须挂。 */
export function lakexGwUrlLocalPostcss() {
  return {
    postcssPlugin: "lakex-gw-url-local",
    Declaration(decl: { value: string }) {
      if (!decl.value || !decl.value.includes("gw.alipayobjects.com")) return;
      decl.value = decl.value.replace(GW_RE, (m) => {
        const reuse = ALIPAY_JS_REUSE[m];
        if (reuse) return reuse;
        return `/vendor/lakex/alipay/${m.split("/").pop()}`;
      });
    },
  };
}

export interface LakexAlipayLocalOptions {
  /** 注入 index.html 的 CSP；可按 mode 返回不同策略（桌面 dev/prod）。 */
  csp: string | ((mode: string) => string);
  /** 插件名（两端不同，便于构建日志分辨）。 */
  name?: string;
}

export function lakexAlipayLocal(options: LakexAlipayLocalOptions): Plugin {
  const cspOf = typeof options.csp === "function" ? options.csp : () => options.csp as string;
  return {
    name: options.name ?? "lakex-alipay-local",
    enforce: "pre",
    transformIndexHtml(html, ctx) {
      // 正则强替换 CSP meta 的 content（兼容占位符 %MOBILE_CSP% / %VITE_CSP% 或已被其它步骤写成的旧值——
      // 实测 vite8 收到的 html 里占位符可能已消失，字面 replace 不匹配会导致旧 CSP 残留）
      return html.replace(/(<meta http-equiv="Content-Security-Policy" content=")[^"]*(")/, `$1${cspOf(ctx.mode)}$2`);
    },
    transform(code, id) {
      if (!id.includes("lakex-doc-react")) return;
      for (const [from, to] of Object.entries(MIRROR_EXACT)) {
        if (code.includes(from)) code = code.replaceAll(from, to);
      }
      // JS 模块 id 带 ?v= query，先剥离再判扩展名
      const cleanId = id.split("?")[0];
      if (cleanId.endsWith(".css")) {
        return code.replace(/url\(https:\/\/gw\.alipayobjects\.com\/[^)]+\)/g, (m) => {
          const name = m.slice(4, -1).split("/").pop() as string;
          return `url(/vendor/lakex/alipay/${name})`;
        });
      }
      if (cleanId.endsWith(".js") || cleanId.endsWith(".mjs")) {
        return code.replace(/https:\/\/gw\.alipayobjects\.com\/[^"'`\s)]+/g, (m) => {
          const reuse = ALIPAY_JS_REUSE[m];
          if (reuse) return reuse;
          return `/vendor/lakex/alipay/${m.split("/").pop()}`;
        });
      }
      return code;
    },
  };
}