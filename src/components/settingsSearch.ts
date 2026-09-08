import type { SettingsCategory } from "./SettingsPanel";

export interface SettingsNavSearchItem {
  id: SettingsCategory;
  label: string;
  keywords?: string;
}

export function filterSettingsNav<T extends SettingsNavSearchItem>(items: T[], query: string): T[] {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return items;
  return items.filter((item) => `${item.label} ${item.keywords ?? ""}`.toLocaleLowerCase().includes(normalized));
}

/** 条目级搜索（对齐思源：每条设置都可被搜到并定位，而不只是跳分类）。
 * id 同时是行上的 data-set-id（渲染层据此滚动/高亮）；三者一致性由 settingsSearch.test.ts 卡住。 */
export interface SettingItemEntry {
  id: string;
  category: SettingsCategory;
  label: string;
  /** 界面上看不出来但用户会搜的同义词（如 "GC"、"sk"、"路径在哪"）。 */
  keywords?: string;
}

/** 全部可搜索设置行。新增/改名设置时同步这里，否则漂移测试会红。 */
export const SETTING_ITEMS: SettingItemEntry[] = [
  { id: "editor-font-size", category: "editor", label: "正文字号", keywords: "字体 字号 font size" },
  { id: "editor-paragraph-spacing", category: "editor", label: "段间距", keywords: "段距 行距 留白" },
  { id: "editor-toc", category: "editor", label: "显示文档大纲（TOC）", keywords: "大纲 TOC 目录 侧栏" },
  { id: "editor-outline-enhance", category: "editor", label: "大纲增强", keywords: "大纲 增强 原生 目录 TOC 侧栏" },
  { id: "editor-toolbar", category: "editor", label: "显示编辑器工具栏", keywords: "工具栏 菜单栏" },
  { id: "editor-max-open-tabs", category: "editor", label: "最大同时打开标签数", keywords: "标签 页签 tab 上限" },
  { id: "editor-max-attachment", category: "editor", label: "附件大小上限", keywords: "附件 上传 大小 上限 MiB" },
  { id: "appearance-theme", category: "appearance", label: "主题", keywords: "主题 深色 浅色 dark light 夜间" },
  { id: "shortcut-search", category: "shortcuts", label: "打开全局搜索（标题和正文）", keywords: "搜索 快捷键 ⌘K" },
  { id: "shortcut-focus", category: "shortcuts", label: "进入或退出专注模式", keywords: "专注模式 全屏写作" },
  { id: "shortcut-move", category: "shortcuts", label: "在搜索结果中移动", keywords: "上下 选择" },
  { id: "shortcut-open", category: "shortcuts", label: "打开搜索结果并定位命中", keywords: "打开 定位 命中" },
  { id: "shortcut-open-tab", category: "shortcuts", label: "在新标签打开并定位命中", keywords: "新标签 打开" },
  { id: "shortcut-esc", category: "shortcuts", label: "关闭当前菜单或浮层", keywords: "关闭 浮层 菜单 Esc" },
  { id: "history-stats", category: "history", label: "快照占用", keywords: "快照 占用 大小 清理" },
  { id: "history-max-snapshots", category: "history", label: "每文档上限", keywords: "快照 上限 份数" },
  { id: "history-retention-days", category: "history", label: "保留天数", keywords: "保留 天数 过期" },
  { id: "history-cleanup-interval", category: "history", label: "定期清理（小时）", keywords: "定期 清理 间隔 小时" },
  { id: "history-snapshot-interval", category: "history", label: "自动快照（分钟）", keywords: "自动 快照 间隔 分钟" },
  { id: "history-data-health", category: "history", label: "一致性检查", keywords: "体检 诊断 一致性 缺失 校验" },
  { id: "sync-enabled", category: "sync", label: "启用云同步", keywords: "同步 开关 启用 云同步" },
  { id: "sync-auto-mode", category: "sync", label: "自动同步模式", keywords: "自动同步 模式 手动 间隔 开启关闭" },
  { id: "sync-auto-interval", category: "sync", label: "自动同步间隔（分钟）", keywords: "自动同步 间隔 分钟" },
  { id: "backup-export", category: "sync", label: "整库备份", keywords: "备份 整库 导出 目录" },
  { id: "backup-restore", category: "sync", label: "从云端恢复", keywords: "恢复 换机 坏库 云端恢复 隔离" },
  { id: "s3-endpoint", category: "sync", label: "Endpoint", keywords: "endpoint 接入点 地址 七牛 qiniu" },
  { id: "s3-access-key", category: "sync", label: "Access Key", keywords: "access key ak 密钥" },
  { id: "s3-secret-key", category: "sync", label: "Secret Key", keywords: "secret key sk 密钥 加密" },
  { id: "s3-bucket", category: "sync", label: "Bucket", keywords: "bucket 存储空间 桶" },
  { id: "s3-region", category: "sync", label: "Region", keywords: "region 区域 cn-north-1" },
  { id: "s3-prefix", category: "sync", label: "对象前缀", keywords: "前缀 prefix 目录" },
  { id: "s3-path-style", category: "sync", label: "使用 Path-style URL", keywords: "path style 路径风格 minio" },
  { id: "s3-connection", category: "sync", label: "连接", keywords: "测试连接 保存配置 连通" },
  { id: "gc-status", category: "sync", label: "回收状态", keywords: "GC 回收 对账 深度清理 待回收 未引用" },
  { id: "gc-retention-days", category: "sync", label: "回收窗口（天）", keywords: "回收窗口 保护期 天数 retention" },
  { id: "gc-interval-hours", category: "sync", label: "自动对账周期（小时）", keywords: "自动对账 周期 小时 清理频率" },
  { id: "gc-mirror", category: "sync", label: "云端只是镜像", keywords: "镜像 云端 不影响本地" },
  { id: "gc-pending-list", category: "sync", label: "待回收键明细", keywords: "待回收 明细 键 pending" },
  { id: "gc-log", category: "sync", label: "删除记录", keywords: "删除记录 审计 日志 GC" },
  { id: "trash-auto-purge-days", category: "trash", label: "回收站自动过期（天）", keywords: "回收站 自动过期 天数 彻底删除" },
  { id: "logs-main", category: "logs", label: "主进程日志", keywords: "日志 主进程 log 过滤 关键字" },
  { id: "about-app", category: "about", label: "Lake Notes", keywords: "版本 简介" },
  { id: "about-version", category: "about", label: "应用版本", keywords: "版本号 version" },
  { id: "about-runtime", category: "about", label: "运行时", keywords: "Electron Chromium Node 运行时 内核版本" },
  { id: "about-deps", category: "about", label: "内核与关键依赖", keywords: "依赖 lakex 内核 better-sqlite3 sharp 版本" },
  { id: "about-storage-stats", category: "about", label: "内容统计", keywords: "占用 空间 大小 笔记数 资源数 快照数 库大小" },
  { id: "about-data-dir", category: "about", label: "数据目录", keywords: "数据目录 路径 位置 在哪" },
  { id: "about-workspace-dir", category: "about", label: "工作空间", keywords: "工作空间 路径 目录" },
  { id: "about-assets-dir", category: "about", label: "资源目录", keywords: "资源目录 图片 附件 路径" },
  { id: "about-history-dir", category: "about", label: "历史快照目录", keywords: "历史快照 目录 路径" },
  { id: "about-logs-dir", category: "about", label: "日志目录", keywords: "日志目录 路径 log" },
  { id: "about-diagnostics", category: "about", label: "复制诊断信息", keywords: "诊断 复制 信息 反馈 报错" },
  { id: "about-health-entry", category: "about", label: "一致性检查", keywords: "体检 在哪 一致性" },
  { id: "about-siyuan-license", category: "about", label: "思源笔记 SiYuan", keywords: "思源 SiYuan AGPL 许可 移植 署名" },
  { id: "about-lakex-license", category: "about", label: "语雀 Lake 内核", keywords: "lakex 语雀 闭源 内核" },
  { id: "about-third-party", category: "about", label: "开源依赖", keywords: "第三方 开源 依赖 许可 license" },];

/** 多词按「每个词都命中」匹配（搜「回收 窗口」也能到）；空查询返回全部。 */
export function searchSettingItems(query: string, limit = 20): SettingItemEntry[] {
  const tokens = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return SETTING_ITEMS;
  const hits = SETTING_ITEMS.filter((item) => {
    const haystack = `${item.label} ${item.keywords ?? ""}`.toLocaleLowerCase();
    return tokens.every((token) => haystack.includes(token));
  });
  return hits.slice(0, limit);
}
