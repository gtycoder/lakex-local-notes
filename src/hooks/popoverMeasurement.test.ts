import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * DT-03 回归护栏（261028）：浮层定位**必须量真实尺寸**。
 *
 * 这四处的 9 个浮层曾把硬编码尺寸（220x260 / 140x84 / 132x220 / 380 …）喂给
 * clampPopoverPosition —— 猜小了贴底会被裁、猜大了提前翻转，正是 AGENTS §3#14
 * 「禁止估算高度自己夹」点名的老坑。现在统一走 usePopoverPosition（先挂屏外量真实宽高）。
 */
const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const FILES = [
  "../desktop/DesktopOverlays.tsx",
  "../components/app/QuickNotesWorkspace.tsx",
  "../features/outline/OutlineSidebar.tsx",
  "../components/app/SyncStatusPopover.tsx",
];

describe("浮层定位禁止估算尺寸（DT-03）", () => {
  it("这四处改用测量式定位，不再调用 clampPopoverPosition", () => {
    for (const file of FILES) {
      const src = read(file);
      expect(src, file).not.toContain("clampPopoverPosition(");
      // DT-12（261028）：小记页/大纲的菜单改走 useAnchoredMenu，定位仍由它内部的 usePopoverPosition 完成
      // ⇒ 两处任取其一即可；关键是不能退回「估算高度自己夹」。
      expect(src, file).toMatch(/useAnchoredMenu\(|usePopoverPosition\(/);
    }
  });
});
