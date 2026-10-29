import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * 261019 优化：恢复历史标签时**只挂当前页**的正文分量（其余等切到时再挂）。
 * 状态机与懒读行为由 useNotebookTabs.test.ts 验证；本文件只卡工作区接线。
 */
const WS = readFileSync(new URL("./NotebookWorkspace.tsx", import.meta.url), "utf8");
const SESSION = readFileSync(new URL("./useNotebookTabs.ts", import.meta.url), "utf8");

describe("工作区正文懒挂载接线", () => {
  it("标签会话交给 useNotebookTabs；恢复只建占位、活动页正文按需补读", () => {
    expect(WS).toContain("useNotebookTabs({");
    // MOB-12：恢复走 hook 的 restore()（一次 dispatch；顺序/上限/激活页都在 hook 里），
    // workspace 只按目录已知 id 过滤。
    expect(WS).toMatch(/restore\(\[initialNoteId, \.\.\.saved\.filter\(\(id\) => id !== initialNoteId\)\], initialNoteId, \{ enterEditor: initialMode === "editor" \}\);/);
    expect(WS).toMatch(/restore\(saved, saved\[saved\.length - 1\]\);/);
    expect(WS).toContain("const saved = savedTabIds.filter");
    // restore 只建未加载的占位（不读正文）⇒ 只有活动页会被"未加载则补读"的 effect 读到
    expect(SESSION).toMatch(/const restore = useCallback/);
    expect(SESSION).toContain("function placeholderTab");
    expect(SESSION).toMatch(/loaded: false/);
    expect(WS).toMatch(/if \(!active \|\| active\.loaded\) return;\s*\n\s*void loadTabBody\(active\.id\);/);
    expect(WS).not.toContain("pendingEditRef");
    expect(WS).toMatch(/enterEditor: kind === "usheet" \|\| kind === "bitable" \|\| kind === "board"/);
  });

  it("活动页未挂载时显示骨架；正文只在 mountedIds 命中后起编辑器", () => {
    expect(WS).toMatch(/!active \|\| !mountedIds\.has\(active\.id\)/);
    expect(WS).toMatch(/!mountedIds\.has\(t\.id\) \? null :/);
  });

  it("R2：骨架是并列占位层，不替换整份 pane 列表（已挂载的 keep-alive 页必须留在 DOM 里）", () => {
    // 旧实现 = `{活动页未挂载 ? 骨架 : tabs.map(...)}`：打开尚未挂载的新文档会把别的标签一起卸载，
    // 回来时 scrollTop 归零（261027 R2 实测 752→0）。现在 pane 列表先渲染，骨架只在后面追加。
    const paneListAt = WS.indexOf("{tabs.map((t) => (!mountedIds.has(t.id) ? null : (");
    const skeletonAt = WS.indexOf('aria-label="正在打开文档"');
    expect(paneListAt).toBeGreaterThan(-1);
    expect(skeletonAt).toBeGreaterThan(paneListAt);
    // 骨架分支不得再包住 pane 列表（旧形态的特征串）
    expect(WS).not.toMatch(/\? \([\s\S]{0,200}aria-label="正在打开文档"[\s\S]{0,800}tabs\.map/);
  });
});
