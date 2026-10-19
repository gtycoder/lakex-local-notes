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
import { readFileSync } from "node:fs";
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
    expect(code).toMatch(/android:data="lakenotes:\/\/quick-note"/);
    // 260920 实测：退回嵌套 data 元素 ⇒ 快捷方式点开丢深链、进不了速记框
    expect(code).not.toMatch(/<data[\s>]/);
  });

  it("移动端不借桌面「文档属性」弹窗（否则会连带把桌面编辑器打进移动端包）", () => {
    const nw = read("./notebook/NotebookWorkspace.tsx");
    expect(nw).not.toMatch(/components\/NoteInfoDialog/);
    expect(nw).toMatch(/from "\.\.\/ui\/NoteInfoSheet"/);
  });

  it("移动端表格查看器（Univer 内核）也走 lazy，不进入口 chunk", () => {
    expect(read("./notebook/NotebookWorkspace.tsx")).toMatch(/lazy\(\(\) => import\("\.\.\/usheet\/MobileUsheetViewer"\)/);
  });

  it("vite.mobile.config.ts 不给 @dlient/lakex-doc-react 加 codeSplitting 分组", () => {
    // 只匹配配置项本身（\`codeSplitting:\`），别被解释这条坑的注释误伤
    expect(read("../../vite.mobile.config.ts")).not.toMatch(/codeSplitting\s*:/);
  });
});
