/**
 * 日期格式化 lint（Q9，R0-4）：桌面渲染层**禁止**用 `toLocale*String` 显示日期。
 *
 * 背景（docs/audit-261112/00-MASTER-PLAN.md K2/Q9）：日期显示的单一来源 = `core/dateFormat`
 * （`formatYmd / formatMd / formatHm / formatMdHm / formatDateTime / formatListTime`）。
 * `toLocaleDateString` 等会随系统 locale/时区/是否含秒漂移：同一份数据在不同机器上显示不同，
 * 列表快照无法对拍，A/B 两份设备读数会"看起来不一致"。
 *
 * 口径（为什么是这三条，而不是"全仓禁 toLocaleString"）：
 * - 只扫**桌面渲染层**（`src/components` / `src/features` / `src/desktop` / `src/hooks` / `src/App.tsx` / `src/main.tsx`）；
 *   移动端自带口径与自己的 backlog（N 系列），`src/core` / `electron` 不在本条红线内。
 * - `toLocaleDateString` / `toLocaleTimeString` = 只说日期/时间，没有"误伤数字格式化"的可能 ⇒ 无条件禁。
 * - `toLocaleString@@ 是**双重语义**（日期 / 千分位数字）⇒ 只禁 `new Date(...).toLocaleString(...)`
 *   这种**接收者是 Date** 的写法；`n.toLocaleString("en-US")` 之类数字格式化不受影响。
 * - 迁移在 R0-3 完成：SearchPanel / AssetsBrowser / DraftRecoveryDialog / RebuildDataBlock /
 *   DiaryWorkspace / tablePasteGuard / SettingsPanel 已全部改走 `core/dateFormat`；允许清单已清空。
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, "..");

/** 桌面渲染层扫描根（相对 src）。 */
const DESKTOP_ROOTS = ["components", "features", "desktop", "hooks", "App.tsx", "main.tsx"];

/**
 * 允许清单（相对 src 的路径）：只有"尚未迁移且已登记"的文件可以出现日期 `toLocaleString`。
 * 目前仅 SettingsPanel（R0-3 K2 由并行会话迁移；迁移完成后删掉这一行即可）。
 */
const ALLOWED = new Set<string>();

function walk(abs: string, out: string[] = []): string[] {
  for (const entry of readdirSync(abs, { withFileTypes: true })) {
    const child = path.join(abs, entry.name);
    if (entry.isDirectory()) {
      walk(child, out);
      continue;
    }
    if (!entry.name.endsWith(".ts") && !entry.name.endsWith(".tsx")) continue;
    out.push(child);
  }
  return out;
}

const DATE_LOCALE_CALL = /\.toLocale(?:Date|Time)String\(/;
const DATE_RECEIVER_LOCALE_STRING = /new Date\([^()]*\)\s*\.toLocaleString\(/;

describe("日期格式化单一来源（桌面 UI 禁止 toLocale*）", () => {
  it("桌面渲染层不出现 toLocaleDateString / toLocaleTimeString / new Date(...).toLocaleString", () => {
    const offenders: string[] = [];
    for (const root of DESKTOP_ROOTS) {
      const absRoot = path.join(SRC, root);
      const files = statSync(absRoot).isDirectory() ? walk(absRoot) : [absRoot];
      for (const abs of files) {
        if (/\.test\./.test(path.basename(abs))) continue;
        const rel = path.relative(SRC, abs).split(path.sep).join("/");
        if (ALLOWED.has(rel)) continue;
        const source = readFileSync(abs, "utf8");
        if (DATE_LOCALE_CALL.test(source) || DATE_RECEIVER_LOCALE_STRING.test(source)) offenders.push(rel);
      }
    }
    expect(
      offenders,
      "日期显示必须走 core/dateFormat（formatYmd/formatMd/formatHm/formatDateTime/formatListTime）；" +
        "规则与允许清单见本文件头注释：\n  " + offenders.join("\n  "),
    ).toEqual([]);
  });

  it("允许清单里的文件仍存在（防止清单腐化成永久豁免）", () => {
    for (const rel of ALLOWED) {
      expect(() => readFileSync(path.join(SRC, rel), "utf8"), rel + " 已不存在，请从 ALLOWED 删除").not.toThrow();
    }
  });

  it("已迁移文件确实走 core/dateFormat（防回退）", () => {
    const migrated = [
      "components/app/SearchPanel.tsx",
      "components/app/AssetsBrowser.tsx",
      "components/app/DraftRecoveryDialog.tsx",
      "components/app/RebuildDataBlock.tsx",
      "features/diary/DiaryWorkspace.tsx",
      "features/editor/tablePasteGuard.ts",
    ];
    for (const rel of migrated) {
      // 6 个文件都在 src 下两级（../.. = src），桌面渲染层的既有 import 口径就是 "../../core/*"。
      expect(readFileSync(path.join(SRC, rel), "utf8"), rel).toContain('from "../../core/dateFormat"');
    }
  });
});
