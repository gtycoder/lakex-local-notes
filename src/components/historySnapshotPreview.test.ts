import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * 历史快照「只读编辑器预览」护栏（260926）。
 *
 * 用户口径：快照里的表格图片/多维表图片/画板都要能看；可以挂只读编辑器，但**不要批量创建编辑器**
 * （所有快照共用一个槽位）。这三条都是易回归的集成约束，用源码级断言钉住（本仓惯例）：
 *  1. 三个编辑器都懒加载（预览与正式编辑共用分包，不给首屏加体积）；
 *  2. 一律 `readOnly` + `onChange` no-op（双保险：预览永不写盘）；
 *  3. 以 snapshotId 作 key ⇒ 切换快照重挂，**同一时刻只有一个实例**；
 *  4. 解析不了/编辑器失败 ⇒ 退回结构化摘要（不空白）。
 */
const SRC = readFileSync(new URL("./HistorySnapshotPreview.tsx", import.meta.url), "utf8");

describe("历史快照只读编辑器预览", () => {
  it("三个编辑器都懒加载（不额外增加首屏体积）", () => {
    for (const mod of ["../features/sheet/SheetEditor", "../features/bitable/BitableEditor", "../features/board/BoardEditor"]) {
      expect(SRC).toContain(`import("${mod}")`);
    }
    expect((SRC.match(/lazy\(\(\) => import\(/g) ?? []).length).toBe(3);
  });

  it("一律只读 + onChange no-op（预览绝不写盘）", () => {
    // 三个编辑器各出现一次 readOnly 与 onChange={noop}
    expect((SRC.match(/readOnly onChange=\{noop\}/g) ?? []).length).toBe(3);
    expect(SRC).toMatch(/const noop = useMemo\(\(\) => \(\) => undefined, \[\]\)/);
  });

  it("以 snapshotId 作 key：切快照重挂，同一时刻只有一个编辑器实例", () => {
    expect(SRC).toMatch(/<Suspense key=\{snapshotId\}/);
    expect(SRC).toContain("snapshotId: number | string;");
    // 不允许出现"按快照列表批量渲染编辑器"的写法
    expect(SRC).not.toMatch(/snapshots\.map|history\.map/);
  });

  it("失败/坏正文退回结构化摘要（不留空白、不炸弹窗）", () => {
    expect(SRC).toContain("class PreviewErrorBoundary");
    expect(SRC).toMatch(/fallback=\{<StructuredBlocks blocks=\{blocks\} \/>\}/);
    expect(SRC).toMatch(/const parseable = kind === "doc" \? false : !\(blocks\.length === 1 && blocks\[0\]\.type === "empty"\)/);
  });

  it("预览里隐藏编辑器外壳（只读预览不要「半个编辑器」的观感）", () => {
    expect(SRC).toContain("showToolbar={false}");
    expect(SRC).toContain("chrome={false}");
    const sheet = readFileSync(new URL("../features/sheet/SheetEditor.tsx", import.meta.url), "utf8");
    const bitable = readFileSync(new URL("../features/bitable/BitableEditor.tsx", import.meta.url), "utf8");
    expect(sheet).toMatch(/showToolbar\?: boolean;/);
    expect(sheet).toContain("showToolbar={showToolbar}");
    expect(bitable).toMatch(/chrome\?: boolean;/);
    expect(bitable).toMatch(/\{chrome && <div className="bt-viewbar">/);
    expect(bitable).toMatch(/\{chrome && <div className="bt-toolbar">/);
  });
});

/**
 * 历史面板侧的护栏（260926 第二批优化）：
 *  ① doc 快照的 viewer **同实例复用**（切快照只 setDocument，不重建内核）；
 *  ② 打开面板即**预热**预览分包；
 *  ③ 标出"与当前版本一致"的快照；
 *  ④ ↑/↓ 切换快照，且只改列表自己的 scrollTop（`scrollIntoView` 会滚所有祖先，仓里踩过）。
 */
describe("历史面板：复用 / 预热 / 当前版本 / 键盘", () => {
  const PANEL = readFileSync(new URL("./HistoryPanel.tsx", import.meta.url), "utf8");
  const HOOK = readFileSync(new URL("./useHistorySnapshotViewer.ts", import.meta.url), "utf8");

  it("doc 快照 viewer 同实例复用（切快照只 setDocument）", () => {
    // 只在没有实例时创建；已有实例（同一宿主 + 同一文档）继续用
    expect(HOOK).toMatch(/if \(!viewerRef\.current\) \{/);
    expect(HOOK).toMatch(/viewerRef\.current\.setDocument\("text\/lake", addAssetAccessToken\(body\)\)/);
    expect(HOOK).toMatch(/hostNodeRef\.current !== host \|\| noteRef\.current !== noteId/);
    // 两个入口（历史面板 / 属性弹窗）都走同一个 hook
    expect(PANEL).toContain("useHistorySnapshotViewer({");
    const infoDialog = readFileSync(new URL("./NoteInfoDialog.tsx", import.meta.url), "utf8");
    expect(infoDialog).toContain("useHistorySnapshotViewer({");
  });

  it("打开面板即预热预览分包（用历史列表里的 kind）", () => {
    expect(PANEL).toContain("function prefetchPreviewChunk(kind: NoteKind)");
    expect(PANEL).toMatch(/import\("\.\.\/features\/sheet\/SheetEditor"\)/);
    expect(PANEL).toMatch(/prefetchPreviewChunk\(nextHistory\[0\]\?\.kind \?\? "doc"\)/);
  });

  it("标出「当前」版本：拿当前正文 hash 与快照比", () => {
    expect(PANEL).toMatch(/native\.getNoteInfo\(noteId\)/);
    expect(PANEL).toMatch(/h\.contentHash === currentHash/);
    expect(PANEL).toContain('title="正文与当前已保存版本一致"');
  });

  it("↑/↓ 切换快照：只改列表自己的 scrollTop（不用 scrollIntoView）", () => {
    expect(PANEL).toMatch(/event\.key === "ArrowDown"/);
    expect(PANEL).toMatch(/event\.key === "ArrowUp"/);
    expect(PANEL).toMatch(/moveSelection\(1\)|moveSelection\(-1\)/);
    expect(PANEL).toContain("list.scrollTop -=");
    expect(PANEL).not.toMatch(/\.scrollIntoView\(/);
  });
});
