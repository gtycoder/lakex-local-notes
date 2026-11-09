import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SETTING_ITEMS } from "../model/settingsSearch";

/**
 * 设置页分组归属（261105 用户验收重组）：每个 itemId 必须落在期望分类下，
 * 不允许再出现「备份混杂在云端与同步里」或「数据体检挂在文档历史页」。
 */
const SRC = readFileSync(new URL("./SettingsPanel.tsx", import.meta.url), "utf8");

/** 取某个分类分支的源码片段（从 {category === "x" && ( 到下一个分类分支/结尾）。 */
function blockOf(category: string): string {
  const start = SRC.indexOf('{category === "' + category + '" && (');
  if (start < 0) throw new Error("分类分支不存在：" + category);
  const rest = SRC.slice(start + 1);
  const next = rest.search(/\{category === "/);
  return next < 0 ? rest : rest.slice(0, next);
}
const itemIds = (category: string): string[] => [...blockOf(category).matchAll(/itemId="([^"]+)"/g)].map((m) => m[1]);

describe("设置页分组归属（重组后）", () => {
  it("常规 = 编辑器 / 标签页 / 附件", () => {
    expect(itemIds("editor").sort()).toEqual([
      "editor-clear-tabs-on-exit", "editor-floating-toolbar", "editor-font-size",
      "editor-max-attachment", "editor-max-open-tabs", "editor-outline-enhance", "editor-toolbar",
    ]);
  });

  it("云端与同步 = S3 + 同步策略 + 云端回收 + 同步诊断（不再含备份）", () => {
    const ids = itemIds("sync");
    for (const id of ["s3-endpoint", "s3-secret-key", "sync-enabled", "sync-auto-mode", "gc-retention-days", "sync-diagnostics"]) {
      expect(ids, id).toContain(id);
    }
    for (const id of ["backup-export", "backup-restore", "backup-import", "auto-backup"]) {
      expect(ids, id).not.toContain(id);
    }
  });

  it("备份与恢复 = 整库备份 / 从云端恢复 / 从数据库快照恢复 / 自动备份 / 快照占用 / 上次数据库备份结果 / 导出便携包（独立分类）", () => {
    expect(itemIds("backup").sort()).toEqual([
      "auto-backup", "auto-backup-enabled", "auto-backup-interval", "auto-backup-keep",
      "backup-export", "backup-import", "backup-last-result", "backup-portable-export", "backup-restore", "backup-usage",
    ]);
  });

  it("数据与历史 = 文档历史；数据维护 = 体检 / 重建 / 回收站 / 搜索 / 浏览器端 / 日志", () => {
    expect(itemIds("history").sort()).toEqual([
      "history-cleanup-interval", "history-max-snapshots", "history-retention-days",
      "history-snapshot-interval", "history-stats",
    ]);
    expect(itemIds("maintenance").sort()).toEqual([
      "data-rebuild", "data-scan-interval",
      "history-data-health", "logs-main", "search-rebuild", "trash-auto-purge-days",
    ]);
  });

  it("浏览器端是独立分类，只放启用/打开浏览器", () => {
    expect(itemIds("browser").sort()).toEqual(["browser-enabled", "browser-open"]);
  });

  it("导航顺序与名称（按使用频率；备份与恢复独立入口）", () => {
    const navStart = SRC.indexOf("const nav = [");
    const nav = SRC.slice(navStart, SRC.indexOf("];", navStart));
    const order = [...nav.matchAll(/id: "(\w+)" as const, label: "([^"]+)"/g)].map((m) => m[1] + ":" + m[2]);
    expect(order).toEqual([
      "editor:常规", "appearance:外观", "shortcuts:快捷键", "sync:云端与同步",
      "backup:备份与恢复", "history:数据与历史", "maintenance:数据维护", "browser:浏览器端", "ai:AI 助手", "update:更新", "about:关于",
    ]);
  });

  it("每个 itemId 只属于一个分类，且注册表分类都能在面板找到分支", () => {
    const categories = ["editor", "appearance", "shortcuts", "history", "maintenance", "sync", "backup", "ai", "browser", "update", "about"];
    const seen = new Map<string, string>();
    for (const category of categories) {
      for (const id of itemIds(category)) {
        expect(seen.has(id), "重复归属：" + id).toBe(false);
        seen.set(id, category);
      }
    }
    for (const item of SETTING_ITEMS) {
      expect(seen.get(item.id), item.id + " 的注册分类与实际分支不一致").toBe(item.category);
    }
  });
});
