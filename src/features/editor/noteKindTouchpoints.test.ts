/**
 * kind 触点清单（Q2，R0-4；对应 06 报告 §1.3 F-02 与 00-MASTER-PLAN K12/Q2）。
 *
 * ## 为什么需要它
 * `NoteKind` 的**类型单一来源**是 `src/core/noteKind.ts`（`NOTE_KINDS` / `normalizeNoteKind`），
 * 但"kind 语义分派"没有注册表（刻意的：5 种 kind 固定、每 kind 宿主是不同第三方内核，注册表 = 过度设计）。
 * 后果是：**新增第 6 种 kind 不会编译失败**，漏改的那一处会静默走 doc 分支；而 `normalizeNoteKind`
 * 对未知值回落 doc（`core/noteKind.ts:19`），注释自己写明后果 —— "旧端把画板 JSON 当 Lake 文档导入并保存 = 毁正文"。
 *
 * ## 这个测试做什么 / 不做什么
 * - 只锁**清单**，不锁实现：把 `kind === "…"` / `switch (kind)` 出现的文件与次数钉死；
 *   新增/删除 kind、或某个触点增删分支 ⇒ 失败并提示回来逐条确认语义。
 * - 第二条断言：`src` 里除了 `core/noteKind.ts` 之外**不得再私抄 kind 字面量联合**
 *   （K12 已把 15 个文件改成 `import type { NoteKind }`；这条防回退）。
 * - **不覆盖**：`electron/**`（3 个文件仍有私抄：`batchExport.ts` / `noteQueries.ts` /
 *   `remoteImportRepository.ts`，归 electron 批次处理；本测试故意只扫 `src`，避免跨批次误伤）、
 *   也不管"UI 渲染条件"是否合理。
 *
 * ## 新增 kind 时怎么做
 * 1. 先改 `core/noteKind.ts` 的 `NoteKind` / `NOTE_KINDS` / `normalizeNoteKind`；
 * 2. 跑本测试拿到"文件:期望 vs 实际"的差集；
 * 3. **逐条**确认每个触点该走哪一支（正文解析 / 正文安全 / 历史预览 / 搜索文本 / 导出菜单 / 状态栏标签 /
 *    创建清单 / 预览器 / 移动端挂载链…），改完把本文件 `TOUCHPOINTS` 的期望值更新；
 * 4. 别忘了 `core/noteBodyPaths.ts` 的 `NOTE_BODY_DIR` / `NOTE_BODY_EXT`（类型系统会强制，但磁盘布局要人对）。
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { NOTE_KINDS } from "../../core/noteKind";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, "..", "..");

/** kind 集合钉死：**加/删 kind 必须逐条确认下面的触点表**。 */
const PINNED_KINDS = ["doc", "usheet", "bitable", "board", "ink"];
/**
 * kind 语义触点（相对仓库根）：值 = `kind === "<kind>"` 与 `switch (kind)` 的出现次数。
 * 取值 = 本测试第二条断言失败信息里的「最新实际值」；生成口径见 `branchCounts()`。
 */
const TOUCHPOINTS: Record<string, number> = {
  "src/App.tsx": 2,
  "src/components/app/AssetsBrowser.tsx": 1,
  "src/components/app/DesktopStatusBar.tsx": 4,
  "src/components/app/HistoryPanel.tsx": 4,
  "src/components/app/HistorySnapshotPreview.tsx": 5,
  "src/components/app/NoteInfoDialog.tsx": 1,
  "src/components/app/syncConflicts.ts": 1,
  "src/components/app/treeIcons.tsx": 4,
  "src/components/ui/ExportSubmenuItem.tsx": 4,
  "src/core/coldStartNote.ts": 1,
  "src/core/docBaseline.ts": 3,
  "src/core/docBodySafety.ts": 6,
  "src/core/historyPreview.ts": 4,
  "src/core/lakeBodyRewrite.ts": 1,
  "src/core/noteSearchText.ts": 4,
  "src/core/s3v3/state/deviceStore.ts": 1,
  "src/core/tagAggregate.ts": 1,
  "src/features/editor/MultiTabEditor.tsx": 4,
  "src/features/editor/noteRef.ts": 1,
  "src/features/tags/TagsWorkspace.tsx": 4,
  "src/hooks/desktopDerivedState.ts": 1,
  "src/hooks/saveConflictCopy.ts": 4,
  "src/hooks/useTreeActions.ts": 4,
  "src/mobile/data/noteRepository.ts": 1,
  "src/mobile/notebook/NotebookWorkspace.tsx": 1,
  "src/mobile/notebook/NotePaneHost.tsx": 4,
  "src/mobile/notebook/useWorkspaceActions.ts": 7,
  "src/mobile/notebook/useWorkspaceChrome.ts": 2,
  "src/mobile/notebook/useWorkspaceSession.ts": 3,
  "src/mobile/tags/TagsHomeTab.tsx": 3,
  "src/mobile/trash/TrashPreviewPage.tsx": 3,
  "src/mobile/v3/mobilePlatformPort.ts": 1,
};

/** kind 字面量联合的私抄（唯一允许 = 定义处 core/noteKind.ts）。 */
const KIND_UNION = /"doc" \| "usheet" \| "bitable" \| "board" \| "ink"/;

function walk(abs: string, out: string[] = []): string[] {
  for (const entry of readdirSync(abs, { withFileTypes: true })) {
    const child = path.join(abs, entry.name);
    if (entry.isDirectory()) walk(child, out);
    else if ((entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) && !/\.test\./.test(entry.name)) out.push(child);
  }
  return out;
}

const BRANCH = /[kK]ind === "(?:doc|usheet|bitable|board|ink)"|switch \(kind\)/g;

/** 每个文件的 kind 分派次数（当前实际值）。 */
function branchCounts(): Record<string, number> {
  const out: Record<string, number> = {};
  const root = path.resolve(SRC, "..");
  for (const abs of walk(SRC)) {
    const rel = path.relative(root, abs).split(path.sep).join("/");
    const count = (readFileSync(abs, "utf8").match(BRANCH) ?? []).length;
    if (count > 0) out[rel] = count;
  }
  return out;
}

describe("kind 触点清单（新增第 6 种 kind 必须逐条确认）", () => {
  it("NOTE_KINDS 集合与清单表一致（kind 集合变了 ⇒ 回来确认每个触点）", () => {
    expect(
      [...NOTE_KINDS],
      "新增/删除 kind：请按本文件头注释「新增 kind 时怎么做」逐条确认 TOUCHPOINTS 里每个文件的语义分派，" +
        "然后更新本文件的 PINNED_KINDS 与 TOUCHPOINTS",
    ).toEqual(PINNED_KINDS);
  });

  it("kind 分派触点与清单表逐文件相等（新增/漏改触点都会红）", () => {
    const actual = branchCounts();
    const declared = new Set(Object.keys(TOUCHPOINTS));
    const seen = new Set(Object.keys(actual));
    const newTouchpoints = [...seen].filter((f) => !declared.has(f)).sort();
    const staleEntries = [...declared].filter((f) => !seen.has(f)).sort();
    const countMismatches = [...declared]
      .filter((f) => seen.has(f) && actual[f] !== TOUCHPOINTS[f])
      .sort()
      .map((f) => f + "：期望 " + TOUCHPOINTS[f] + "，实际 " + actual[f]);
    expect(
      { 新增触点: newTouchpoints, 失效条目: staleEntries, 次数不符: countMismatches, 最新实际值: actual },
      "kind 分派触点变化：新增 kind 或新增分支时，逐条确认语义后更新 TOUCHPOINTS（本消息的「最新实际值」可直接抄）",
    ).toEqual({ 新增触点: [], 失效条目: [], 次数不符: [], 最新实际值: actual });
  });

  it("src 内不得私抄 kind 字面量联合（唯一允许 = core/noteKind.ts）", () => {
    const root = path.resolve(SRC, "..");
    const offenders = walk(SRC)
      .map((abs) => path.relative(root, abs).split(path.sep).join("/"))
      .filter((rel) => rel !== "src/core/noteKind.ts")
      .filter((rel) => KIND_UNION.test(readFileSync(path.join(root, rel), "utf8")));
    expect(
      offenders,
      "kind 字面量联合必须改成 import type { NoteKind } from 相对路径 core/noteKind（零行为变化，tsc 即证明）：",
    ).toEqual([]);
  });
});
