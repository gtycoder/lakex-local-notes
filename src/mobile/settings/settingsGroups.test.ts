/**
 * 261105 晚用户验收：移动端设置分组对齐桌面。
 * 「云端与同步」只放联网配置与同步；「备份与恢复」只放恢复动作（移动端没有整库备份/导出）；
 * 其余分组命名与顺序与桌面同构。
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const read = (rel: string): string => readFileSync(path.join(process.cwd(), rel), "utf8");
const DRAWER = read("src/mobile/settings/SettingsDrawer.tsx");

const menuLabelsInOrder = (): string[] =>
  [...DRAWER.matchAll(/\{ key: "[a-z0-9]+", label: "([^"]+)"/g)].map((m) => m[1]);

describe("移动端设置分组（对齐桌面）", () => {
  it("分组命名与顺序：云端与同步 → 备份与恢复 → AI → 编辑器 → 外观 → 历史 → 标签 → 资源管理 → 清理缓存 → 回收站 → 关于", () => {
    // 261106 用户验收：新增「标签」= 标签目录管理 + 简化标签空间（桌面是独立工作区，移动端收进设置一页）。
    expect(menuLabelsInOrder()).toEqual([
      "云端与同步", "备份与恢复", "AI 助手", "编辑器", "外观", "历史", "标签", "资源管理", "清理缓存", "回收站", "关于",
    ]);
  });

  it("「标签」子页存在且挂的是标签空间组件（不是死代码）", () => {
    expect(DRAWER).toMatch(/type View = [^;]*"tags"/);
    expect(DRAWER).toContain('{ key: "tags", label: "标签"');
    expect(DRAWER).toContain('{view === "tags" && (');
    expect(DRAWER).toContain("<TagsSettingsSection");
    // 页面数据来自 App 快照，点小记回首页定位（与全局搜索同一条通路）。
    expect(DRAWER).toContain("tags={props.tagDirectory ?? []}");
    expect(DRAWER).toContain("onOpenQuickNote={(quickNoteId)");
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
    expect(DRAWER).toMatch(/type View = [^;]*"backup"/);
  });
});
