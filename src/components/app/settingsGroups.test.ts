import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SETTING_ITEMS } from "../model/settingsSearch";
import { DISPLAY_ONLY_SHORTCUTS, SHELL_COMMANDS } from "../../lib/shortcuts/registry";

/**
 * 设置页分组归属（261105 用户验收重组）：每个 itemId 必须落在期望分类下，
 * 不允许再出现「备份混杂在云端与同步里」或「数据体检挂在文档历史页」。
 */
/** 261112 R2-S7：分组 JSX 已从 SettingsPanel.tsx 拆到 settings/sections/*；导航仍在状态/布局侧。 */
/** 分类 → 分组文件（nav 仍从 SettingsPanel 解析；设置项扫描面 = 对应分组文件整份）。 */
const SECTION_FILES: Record<string, string> = {
  editor: "EditorSection.tsx",
  appearance: "AppearanceSection.tsx",
  shortcuts: "ShortcutsSection.tsx",
  sync: "SyncSection.tsx",
  backup: "BackupSection.tsx",
  history: "HistorySection.tsx",
  maintenance: "MaintenanceSection.tsx",
  browser: "BrowserSection.tsx",
  ai: "AiSection.tsx",
  update: "UpdateSection.tsx",
  about: "AboutSection.tsx",
};
/** 取某个分类的源码片段：拆分后 = 该分类的分组文件整份（原来 = SettingsPanel 里的分类分支）。 */
function blockOf(category: string): string {
  const file = SECTION_FILES[category];
  if (!file) throw new Error("分类分支不存在：" + category);
  return readFileSync(new URL("./settings/sections/" + file, import.meta.url), "utf8");
}
const itemIds = (category: string): string[] => [...blockOf(category).matchAll(/itemId="([^"]+)"/g)].map((m) => m[1]);

describe("设置页分组归属（重组后）", () => {
  it("常规 = 编辑器 / 标签页 / 附件 / 启动（默认空间）", () => {
    expect(itemIds("editor").sort()).toEqual([
      "editor-clear-tabs-on-exit", "editor-default-space", "editor-floating-toolbar", "editor-font-size",
      "editor-max-attachment", "editor-max-open-tabs", "editor-outline-enhance", "editor-toolbar",
      // 261114：空间关闭（仅日记 / AI 写作可关；sort 后 space-ai-writing 在 space-diary 前）
      "space-ai-writing", "space-diary",
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
    // 261112 R2-S7：nav 数组随状态层搬到 useSettingsPanelScope（面板只消费它），解析目标随之调整。
    const STATE_SRC = readFileSync(new URL("./settings/useSettingsPanelScope.tsx", import.meta.url), "utf8");
    const navStart = STATE_SRC.indexOf("const nav = [");
    const nav = STATE_SRC.slice(navStart, STATE_SRC.indexOf("];", navStart));
    const order = [...nav.matchAll(/id: "(\w+)" as const, label: "([^"]+)"/g)].map((m) => m[1] + ":" + m[2]);
    expect(order).toEqual([
      "editor:常规", "appearance:外观", "shortcuts:快捷键", "sync:云端与同步",
      "backup:备份与恢复", "history:数据与历史", "maintenance:数据维护", "browser:浏览器端", "ai:AI 助手", "update:更新", "about:关于",
    ]);
  });

  it("每个 itemId 只属于一个分类，且注册表分类都能在面板找到分支", () => {
    const categories = ["editor", "appearance", "shortcuts", "history", "maintenance", "sync", "backup", "ai", "browser", "update", "about"];
    // 261114：快捷键行由 src/lib/shortcuts/registry.ts 生成（itemId={settingId}），静态扫不到 ⇒ 并入。
    const shortcutIds = [
      ...SHELL_COMMANDS.map((command) => command.settingId),
      ...DISPLAY_ONLY_SHORTCUTS.map((row) => row.settingId),
    ];
    const seen = new Map<string, string>();
    for (const category of categories) {
      const ids = category === "shortcuts" ? [...itemIds(category), ...shortcutIds] : itemIds(category);
      for (const id of ids) {
        expect(seen.has(id), "重复归属：" + id).toBe(false);
        seen.set(id, category);
      }
    }
    for (const item of SETTING_ITEMS) {
      expect(seen.get(item.id), item.id + " 的注册分类与实际分支不一致").toBe(item.category);
    }
  });
});
