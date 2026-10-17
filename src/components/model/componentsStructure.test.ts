/**
 * src/components 结构护栏（C3-2，261017）。
 *
 * 4 桶职责：
 * - app/    应用屏（Sidebar/SettingsPanel/QuickNotesWorkspace/TrashPanel/…）
 * - ui/     通用原语与组件资产（Overlay/Select/DialogResizeHandles/ColorPalette/NodeIconGlyph/markdown/…）
 * - hooks/  组件层 hooks（useFloatingDialog/useHistorySnapshotViewer）
 * - model/  纯决策/模型（createMenuPosition/dockFilterModel/treeDrag/…）
 * 根目录**不得再放文件**；新增件必须进桶（否则又会混装）。
 */
import { readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const BUCKETS = ["app", "ui", "hooks", "model"] as const;

describe("src/components 4 桶结构（C3-2）", () => {
  it("根目录只允许 4 个桶目录（忽略系统隐藏文件）", () => {
    const entries = readdirSync(ROOT).filter((name) => !name.startsWith("."));
    expect(entries.sort()).toEqual([...BUCKETS].sort());
    for (const name of entries) expect(statSync(ROOT + name).isDirectory(), name + " 必须是目录").toBe(true);
  });

  it("每个桶非空，且桶内不再嵌套同名桶", () => {
    for (const bucket of BUCKETS) {
      const files = readdirSync(ROOT + bucket).filter((n) => !n.startsWith("."));
      expect(files.length, bucket + "/ 不能为空").toBeGreaterThan(0);
      for (const dir of ["app", "hooks", "model"]) expect(files.includes(dir), bucket + " 内不应再嵌套 " + dir + "/").toBe(false);
    }
  });
});
