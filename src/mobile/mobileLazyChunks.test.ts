/**
 * 移动端启动体积护栏（260920）。
 *
 * 背景：Lake 内核（≈6.7MB raw）静态进入口 chunk 时，冷启动 JS 解析从 ~200ms 涨到 ~750ms
 * （实测 effectStart 712→200ms）。正确做法是**懒加载边界**：入口只保留壳 + bridge + 轻量组件，
 * 内核相关三条路径都走 React.lazy：
 *   \`MobileApp → NotebookWorkspace\`、\`HomePage → QuickNoteComposer\`、\`SettingsDrawer → TrashPreviewPage\`。
 *
 * ⚠️ 同时**不要**给 \`@dlient/lakex-doc-react\` 加 rolldown \`codeSplitting\` 分组：实测会把 vendor 内部
 * 懒加载 chunk（DrawnixBoardCore）的 export 绑定拆坏 —— 打开编辑器即
 * "SyntaxError: Export 'DrawnixBoardCore_..._exports' is not defined in module" 整页白屏。
 *
 * 内核静态化会让启动回退，故用源码级断言卡住（vitest node 环境起不了内核）。
 */
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
/** 是否存在 \`import { X } from ...\` 形式的**静态**导入。 */
const staticImport = (src: string, name: string) =>
  new RegExp("import\\s*\\{[^}]*\\b" + name + "\\b[^}]*\\}\\s*from").test(src);

describe("移动端入口不静态引入 Lake 内核", () => {
  it("三条内核承载路径都走 lazy 动态边界", () => {
    expect(read("./MobileApp.tsx")).toMatch(/lazy\(\(\) => import\("\.\/notebook\/NotebookWorkspace"\)/);
    // 261019 起用自研加载壳（不用 React.lazy；预取过可同步渲染、零 fallback）
    expect(read("./home/quickNoteComposerLazy.tsx")).toMatch(/import\("\.\/QuickNoteComposer"\)/);
    expect(read("./settings/SettingsDrawer.tsx")).toMatch(/lazy\(\(\) => import\("\.\.\/trash\/TrashPreviewPage"\)/);
  });

  it("入口模块没有内核承载模块的静态导入", () => {
    const mobileApp = read("./MobileApp.tsx");
    expect(staticImport(mobileApp, "NotebookWorkspace")).toBe(false);
    expect(mobileApp).not.toMatch(/import\s+\{[^}]*DocumentEditor[^}]*\}\s+from/);
    expect(staticImport(read("./home/HomePage.tsx"), "QuickNoteComposer")).toBe(false);
    const settings = read("./settings/SettingsDrawer.tsx");
    expect(staticImport(settings, "TrashPreviewPage")).toBe(false);
    expect(settings).not.toMatch(/import\s+\{[^}]*LakeEditor[^}]*\}\s+from/);
  });

  it("静态快捷方式用 intent 的 android:data 属性携带深链（嵌套 data 元素会被 ShortcutParser 忽略）", () => {
    const xml = read("../../android/app/src/main/res/xml/shortcuts.xml");
    const code = xml.replace(/<!--[\s\S]*?-->/g, ""); // 去掉注释，避免注释文字误伤断言
    expect(code).toMatch(/android:data="lakexlocalnotes:\/\/quick-note"/);
    // 260920 实测：退回嵌套 data 元素 ⇒ 快捷方式点开丢深链、进不了速记框
    expect(code).not.toMatch(/<data[\s>]/);
  });

  it("移动端不借桌面「文档属性」弹窗（否则会连带把桌面编辑器打进移动端包）", () => {
    // P9-5b：浮层拆到 WorkspaceOverlayHost.tsx（NoteInfoSheet 的 import 落点跟着搬）。
    const nw = read("./notebook/NotebookWorkspace.tsx");
    const overlay = read("./notebook/WorkspaceOverlayHost.tsx");
    expect(nw).not.toMatch(/components\/NoteInfoDialog/);
    expect(overlay).not.toMatch(/components\/NoteInfoDialog/);
    expect(overlay).toMatch(/from "\.\.\/ui\/NoteInfoSheet"/);
  });

  it("移动端表格查看器（Univer 内核）也走 lazy，不进入口 chunk", () => {
    // P9-5b：懒加载声明随 pane 列表拆到 NotePaneHost.tsx
    expect(read("./notebook/NotePaneHost.tsx")).toMatch(/lazy\(\(\) => import\("\.\.\/usheet\/MobileUsheetViewer"\)/);
  });

  it("vite.mobile.config.ts 的 codeSplitting 分组不碰内核/画板 vendor（只允许首屏自有共享块）", () => {
    // 261111：允许用 codeSplitting.groups 收敛**首屏自有共享块**（bridge/data、入口图标、轻量 UI），
    // 目标是 modulepreload 收敛到 ≤12 条；但**绝不允许**把内核（@dlient/lakex-doc-react）或画板 vendor
    // （lakex-drawnix / @plait/*）卷进任何 group —— 261103 实测会把 vendor 内部懒 chunk
    // （DrawnixBoardCore）的 export 绑定拆坏，打开编辑器即整页白屏（见本文件头与 vite.mobile.config.ts 注释）。
    const cfg = read("../../vite.mobile.config.ts");
    const start = cfg.indexOf("codeSplitting:");
    expect(start).toBeGreaterThan(-1);
    const open = cfg.indexOf("{", start);
    let depth = 0;
    let end = open;
    for (let i = open; i < cfg.length; i += 1) {
      if (cfg[i] === "{") depth += 1;
      else if (cfg[i] === "}") { depth -= 1; if (depth === 0) { end = i; break; } }
    }
    // 去注释后再判：解释这条坑的注释里本来就会出现这些名字
    const block = cfg.slice(start, end + 1).replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
    expect(block).not.toMatch(/@dlient|lakex-drawnix|@plait/);
    // 分组名是白名单：新增分组必须同时在这里登记（否则等于绕过首屏字节审查）
    const names = [...block.matchAll(/name:\s*"([^"]+)"/g)].map((m) => m[1]);
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) {
      expect(["mobile-bridge-data", "mobile-entry-icons", "mobile-ui-shared"]).toContain(name);
    }
  });

  // ── M-01（审计 03-mobile）：sql.js 是**测试后端**（生产 Android 用原生 SQLite），wasm 约 685KB。
  // 静态进入口图 = 进首屏 chunk + 随 APK 分发；只允许 data/sqliteDbWeb.ts 动态 import（测试 mock/浏览器兜底）。
  // 探针自证（AGENTS §7#21）：提取器先用已知命中样本验证，不能只看「跑通了、结果是 0」。
  const stripComments = (src: string) => src.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
  /** 提取**静态** import/export 说明符；动态 import() 是懒边界，不算入口静态图。 */
  const staticImportSpecifiers = (src: string): string[] => {
    const code = stripComments(src);
    const specs: string[] = [];
    for (const m of code.matchAll(/(?:^|[\n;])[ \t]*(?:import|export)\b[^;]*?from\s*["']([^"']+)["']/g)) specs.push(m[1]);
    for (const m of code.matchAll(/(?:^|[\n;])[ \t]*import\s*["']([^"']+)["']/g)) specs.push(m[1]);
    return specs;
  };
  /** 相对说明符 → 源文件（.ts/.tsx/.js）；裸说明符与资源不入图（sql.js 家族在图外单独判）。 */
  const resolveModuleFile = (fromFile: string, spec: string): string | null => {
    if (!spec.startsWith(".")) return null;
    const target = decodeURIComponent(new URL(spec, new URL("file://" + fromFile)).pathname);
    const base = target.replace(/\.jsx?$/, "");
    for (const candidate of [target, base + ".ts", base + ".tsx", base + ".js"]) {
      if (existsSync(candidate)) return candidate;
    }
    return null;
  };
  /** 从入口走静态 import 图（BFS，去重），返回可达源码文件集与 sql.js 违规清单。 */
  const staticImportGraph = (entry: URL): { files: Set<string>; violations: string[] } => {
    const files = new Set<string>();
    const violations: string[] = [];
    const queue: string[] = [decodeURIComponent(entry.pathname)];
    while (queue.length > 0) {
      const file = queue.pop() as string;
      if (files.has(file)) continue;
      files.add(file);
      for (const spec of staticImportSpecifiers(readFileSync(file, "utf8"))) {
        if (spec === "sql.js" || spec.startsWith("sql.js/")) {
          violations.push(file + " -> " + spec);
          continue;
        }
        const resolved = resolveModuleFile(file, spec);
        if (resolved != null && /\.tsx?$/.test(resolved)) queue.push(resolved);
      }
    }
    return { files, violations };
  };

  it("静态 import 提取器自证（已知样本必须命中、注释不得误报）", () => {
    expect(staticImportSpecifiers('import initSqlJs from "sql.js";')).toEqual(["sql.js"]);
    expect(staticImportSpecifiers('import { executeBatch } from "./data/dbPortTypes.js";')).toEqual(["./data/dbPortTypes.js"]);
    expect(staticImportSpecifiers('export type { MobileDb } from "./data/dbPortTypes.js";')).toEqual(["./data/dbPortTypes.js"]);
    // 动态 import 是懒边界（wasm 随 lazy chunk 走）——不得计入静态图
    expect(staticImportSpecifiers('const m = await import("sql.js");')).toEqual([]);
    // 注释里的 import 不算
    expect(staticImportSpecifiers('// import initSqlJs from "sql.js";')).toEqual([]);
    expect(staticImportSpecifiers('/*\n * import x from "sql.js";\n */\nimport { y } from "./a";')).toEqual(["./a"]);
  });

  it("入口静态图不得出现 sql.js（M-01：wasm 不进首屏 chunk 与 APK）", () => {
    const { files, violations } = staticImportGraph(new URL("./main.tsx", import.meta.url));
    expect(violations).toEqual([]);
    // sql.js 后端（data/sqliteDbWeb.ts）只许测试 mock / 浏览器兜底动态 import，入口可达集里不得出现
    for (const file of files) expect(file.endsWith("sqliteDbWeb.ts")).toBe(false);
  });
});
