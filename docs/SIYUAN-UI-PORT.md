# UI 重做：复刻思源前端（视觉层移植）

> 状态：进行中（2026-08-16 立项）。目标：Lake Notes 界面「完全复刻」思源笔记观感，保留自定义 UI 能力。
> 来源：`/Users/admin/file/local-lake/siyuan-master`（v3.8.0，Electron 42.7.1）。
> **License：思源为 AGPL-3.0，本移植保留署名与 NOTICE；仅私有使用，若分发需按 AGPL 合规。**

## 架构决策（已定，勿改）

1. **只移植视觉层**（设计令牌 + 组件样式 + 布局结构），**不移植代码架构**。
   思源前端是自研框架（layout/Model + WebSocket 连 Go kernel + protyle 块编辑器），
   Lake Notes 是 React 18 + Lake 编辑器 + 本地 SQLite + S3 同步——架构不兼容。
2. **编辑器保留 Lake**，只改外框样式（文档区/工具栏/状态栏）。
3. **类名映射而非抄 TS**：思源 scss 的类名映射到 Lake Notes 现有 React 组件上。
4. **双主题**：`data-theme="dark"` 切换 daylight/midnight 令牌。
5. **自定义 UI**：CSS 变量 + 自定义 snippets（对应思源「外观 → 代码片段」）；插件系统不做。

## 文件组织（新增）

- `src/b3/theme-daylight.css` — 思源 daylight/theme.css 原文（含署名头）
- `src/b3/theme-midnight.css` — 思源 midnight/theme.css 原文（`:root` → `[data-theme="dark"]`）
- `src/b3/tokens.css` — 引入上面两个 + 通用基础（body/滚动条/排版），定义 Lake 侧映射
- `src/b3/components.css` — 移植的组件样式（button/dialog/menu/list/form/switch/tooltips/scrollbar 等）
- `src/b3/layout.css` — dock/顶栏/状态栏/标签页布局对齐（阶段 3）

## 令牌映射（思源 → Lake Notes 现有属性）

| 思源令牌 | Lake Notes 现状 | 用途 |
| --- | --- | --- |
| `--b3-theme-primary` #3575f0 | #216e4e（绿） | 主色/选中/焦点 |
| `--b3-body-background` #EBECF0 | #f4f5f7 | 应用背景 |
| `--b3-theme-background` #fff | #fff | 面板/卡片背景 |
| `--b3-theme-surface` #f6f6f6 | #fafafa | 表面/侧栏 |
| `--b3-theme-on-background` #222 | #20242c | 正文文字 |
| `--b3-theme-on-surface` #5f6368 | #626a75 | 次级文字 |
| `--b3-border-color` / `--b3-border-radius` | #e1e4e8 / 5px | 线条/圆角 |
| `--b3-scroll-color` | — | 滚动条 |
| `--b3-list-hover` | #eceef1 | 列表 hover |
| `--b3-tooltips-*` | — | 工具提示 |
| `--b3-font-family` / `--b3-font-size` | Inter / 13-14px | 字体 |

## 组件类名映射（阶段 2）

| Lake Notes 类 | 思源参考 | 说明 |
| --- | --- | --- |
| `.primary-button`/`.secondary-button` | `_button.scss` b3-button | 按钮 |
| `.floating-dialog`/`.modal-backdrop` | `_dialog.scss` b3-dialog | 浮层/弹窗 |
| `.statusbar-menu`/`.context-menu` | `_menu.scss` b3-menu | 菜单 |
| `.tree-row`/`.note-row` | `_list.scss` + dock 文件树 | 列表/树 |
| `.search-box`/input/select | `_text-field.scss`/`_select.scss` | 表单 |
| `.icon-button` | `_button.scss` | 图标按钮 |
| 滚动条 | `util/_scroll.scss` | 滚动条 |

## 实施阶段（每阶段可测、可回滚）

1. [x] 设计文档 + 令牌层（daylight/midnight 原文引入）
2. [x] 通用基础接线：body/应用背景/字体/滚动条/文本色 换用 `--b3-*`（含覆盖壳层 !important）
3. [x] 核心组件样式移植：按钮(→b3-button)/弹窗/菜单/列表/表单/开关/工具提示/绿色清零
4. [x] 布局对齐（思源整体模型）：灰底 + 白色一体卡片无连接线；活动轨满高透明；
   标签页思源激活态（浅蓝底+主色内边框）；状态栏全宽底部灰条；顶栏思源 #toolbar
   （工作空间S3 prefix/云同步/前进后退/外观/更多）；编辑器面包屑 protyle-breadcrumb
5. [x] 双主题切换（data-theme=dark，含编辑器 --lakex-* 变量覆盖）+ 自定义 snippets（外观设置）
6. [x] scroll-driven animations（阅读进度条 scroll() + 大纲/小记渐显 view()）
7. [x] text-wrap: balance（面板标题）；pretty 可在 UI 微调时补
8. [ ] 详细测试：tsc/217/build + A/B 多端 + 打包版验收
