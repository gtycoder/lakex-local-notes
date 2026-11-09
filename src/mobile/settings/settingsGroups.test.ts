/**
 * 261105 晚用户验收：移动端设置分组对齐桌面。
 * 「云端与同步」只放联网配置与同步；「备份与恢复」只放恢复动作（移动端没有整库备份/导出）；
 * 其余分组命名与顺序与桌面同构。
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const read = (rel: string): string => readFileSync(path.join(process.cwd(), rel), "utf8");
const DRAWER = read("src/mobile/settings/SettingsDrawer.tsx") + "\n" + read("src/mobile/settings/settingsMenu.ts");

const VIEW_TYPE = DRAWER.match(/export type SettingsView =([\s\S]*?);/)?.[1] ?? "";

const menuLabelsInOrder = (): string[] =>
  [...DRAWER.matchAll(/\{ key: "[a-z0-9]+", label: "([^"]+)"/g)].map((m) => m[1]);

describe("移动端设置分组（对齐桌面）", () => {
  it("分组命名与顺序：更新中心 → 云端与同步 → 备份与恢复 → AI → 编辑器 → 外观 → 历史 → 导入 → 资源管理 → 清理缓存 → 回收站 → 关于", () => {
    // 261106 task-86：新增「导入」分组（默认笔记本；分享进来的 Markdown 落这里）。
    expect(menuLabelsInOrder()).toEqual([
      "更新中心", "云端与同步", "备份与恢复", "AI 助手", "编辑器", "外观", "历史", "导入", "资源管理", "清理缓存", "回收站", "关于",
    ]);
    expect(VIEW_TYPE).toContain('"update"');
    expect(DRAWER).toContain('{view === "update" &&');
  });

  it("「导入」分组挂默认笔记本选择器（打开时默认选中当前值）", () => {
    expect(VIEW_TYPE).toContain('"import"');
    // v2（261107）：MENU 每项新增 tone（设置根页图标块取色）⇒ 用正则匹配，不再要求逐字节相同。
    expect(DRAWER).toMatch(/\{ key: "import", label: "导入", icon: Download, tone: "[^"]+" \}/);
    expect(DRAWER).toContain('{view === "import" && (');
    expect(DRAWER).toContain('name="默认笔记本"');
    expect(DRAWER).toContain("<DefaultNotebookPickerSheet");
    expect(DRAWER).toContain("currentId={importNotebookId}");
  });

  it("261106：设置页**不再有标签分组**（标签管理/标签空间已搬到一级「标签」页，避免双入口）", () => {
    expect(DRAWER).not.toContain("{ key: \"tags\"");
    expect(VIEW_TYPE).not.toContain('"tags"');
    expect(DRAWER).not.toContain("TagsSettingsSection");
  });

  it("「云端与同步」不再包含恢复动作；「备份与恢复」有从云端恢复 + 缺正文/缺小记引用", () => {
    const s3Start = DRAWER.indexOf('{view === "s3" && (');
    const backupStart = DRAWER.indexOf('{view === "backup" && (');
    const cacheStart = DRAWER.indexOf('{view === "cache" && (');
    expect(s3Start).toBeGreaterThan(-1);
    expect(backupStart).toBeGreaterThan(s3Start);
    expect(cacheStart).toBeGreaterThan(backupStart);
    const s3Body = DRAWER.slice(s3Start, backupStart);
    const backupBody = DRAWER.slice(backupStart, cacheStart);
    expect(s3Body).not.toContain("从云端恢复（换机或数据损坏）");
    expect(backupBody).toContain("从云端恢复（换机或数据损坏）");
    expect(backupBody).toContain("缺正文 / 缺小记");
    expect(backupBody).toContain('setView("resources")');
    expect(backupBody).toContain("missingBodies.reload()");
  });

  it("移动端不硬塞桌面项：备份页明确说明没有整库自动备份/导出", () => {
    const backupStart = DRAWER.indexOf('{view === "backup" && (');
    const backupBody = DRAWER.slice(backupStart, DRAWER.indexOf('{view === "cache" && ('));
    expect(backupBody).toContain("移动端不提供整库自动备份 / 导出");
    expect(backupBody).not.toContain("自动备份设置");
  });

  it("view 联合类型包含 backup（新增子页不是死代码）", () => {
    expect(VIEW_TYPE).toContain('"backup"');
  });
});
