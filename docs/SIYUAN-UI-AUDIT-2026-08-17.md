# 思源 3.8.0 UI 对齐审计

- 审计日期：2026-08-17
- Lake Notes 分支：`feat/electron-43-upgrade`
- 对照源码：`/Users/admin/file/local-lake/siyuan-master`
- 对照版本：`app/package.json` = `3.8.0`
- 审计方式：源码逐项对照、CSS 文件一致性检查、TypeScript/测试/构建检查；运行时视觉截图因本机在审计期间处于锁屏状态，未把截图缺失误判为通过。

## 结论摘要

当前核心桌面壳层已经完成思源视觉层移植，未发现需要推翻重做的基础布局问题。以下部分与思源源码逐项核对通过：

- daylight 令牌文件与思源原文件一致，仅增加 Lake Notes 署名头。
- midnight 令牌文件与思源原文件一致，仅将 `:root` 作用域改成 `[data-theme="dark"]`，并同步调整语言选择器作用域。
- `src/b3/siyuan/component/` 的通用组件 SCSS 与思源 `app/src/assets/scss/component/` 逐文件一致。
- 活动轨宽度 `42px` 与思源 `.dock { width: 42px; }` 一致。
- 标签项 `min-height: 29px`、`margin: 6px 4px`、`max-width: 186px` 与思源 `.layout-tab-bar .item` 一致。
- 固定/悬浮 dock 的 `top: 112px`、`bottom: 82px`、圆角和阴影模型与思源 `_layout.scss` 一致。
- 面板圆角使用思源 `--b3-border-radius-b`，固定区域之间保留 4px 灰缝。
- 顶栏 Portal 菜单已经显式声明 `app-region: no-drag`，并修复了 Electron/macOS 物理鼠标在侧栏拖拽区重叠时无法点击“偏好设置”的问题。
- 右上角多余的大纲图标已隐藏；同时保留无图标命中区，不牺牲大纲固定/悬停切换能力。
- 小记已经移除重复的专用顶栏层，直接复用窗口级顶栏，并使用和笔记区域相同的“外层壳层 + 内嵌白色工作面 + 4px 灰缝”模型。

## 对照结果

| 区域 | 思源 3.8.0 事实 | Lake Notes 当前状态 | 结论 |
| --- | --- | --- | --- |
| 主题令牌 | daylight/midnight `--b3-*` | 原令牌接入，dark 作用域化 | 通过 |
| 通用组件 | button/dialog/menu/list/form/switch/typography | 直接复用对应 SCSS | 通过 |
| 活动轨 | 42px，透明、满高 | `--activity-rail-width: 42px` | 通过 |
| 左右固定面板 | 白色面板、12px 圆角、4px 灰缝 | 已实现 | 通过 |
| 悬浮 dock | 112px / 82px / 外侧阴影 | 已实现 | 通过 |
| 标签页 | 29px 高、6px 上下留白、4px 左右间距 | 已实现 | 通过 |
| 顶栏 | 思源 toolbar 行为与 Lake 的窗口拖拽要求不同 | Lake 使用窗口级 fixed tab-bar | 设计适配 |
| 状态栏 | 思源原生高度/统计项更多 | Lake 保留本地仓库、字数、图片、同步等业务信息 | 产品差异 |
| 小记 | 思源没有对应的 Lake 小记工作台 | Lake 自定义工作台，但外壳已统一 | 产品差异 |
| 同步 Toast | 思源没有 Lake S3 同步对应物 | 使用 B3 令牌的小型浮窗 | 产品差异 |
| 右上角大纲图标 | 思源 dock 通常有图标 | 按用户明确要求隐藏视觉图标，保留无图标命中区 | 用户覆盖 |

## 仍然存在、但不是本轮应盲目改动的差异

1. **顶栏业务按钮数量不同**：思源 `topBar.ts` 还包含前进、后退、插件、命令面板、全文搜索、缩放等按钮；Lake Notes 当前只保留工作空间、同步、外观和文档更多操作。它们依赖思源内核能力，不是单纯 CSS 没有移植到位，不能为了“像”而添加无功能按钮。
2. **状态栏统计口径不同**：思源可以显示 rune/word/link/image/ref/block 等统计；Lake Notes 当前只显示本地仓库、字数、图片、保存与同步状态。缺少的是业务统计能力，不是视觉层遗漏。
3. **大纲内容样式是 Lake 自定义**：思源大纲使用 `block__icons` / `b3-list`，Lake 为了支持 Lake 编辑器滚动跟随、标题级别标识和虚拟列表使用了自定义 `OutlineList`。外层壳层已对齐，内部信息架构不是遗漏。
4. **小记内部卡片是产品特有 UI**：思源没有对应的小记同步模型，因此只审计外壳材质、间距和边界，不强行套用文档编辑器 DOM。
5. **Electron 无边框窗口高度**：思源桌面 toolbar 和 Lake 的 hiddenInset traffic-light 区域并非同一窗口模型。Lake 使用 `--topbar-height: 38px` 配合 Electron macOS `hiddenInset`，这是窗口工程适配项，必须通过解锁后的实际窗口截图确认，不能仅凭源码把 38px 改成 32px/42px。

## 本轮额外修复

审计发现，上一轮为隐藏大纲图标而完全移除了大纲 rail 的按钮，会导致用户无法再切换“固定/悬停”状态。现已改为：

- 保留无图标的透明命中区；
- 保留 `onCollapse` / `onPin` 状态切换；
- 不恢复用户要求去掉的视觉大纲图标。

这样同时满足视觉要求和原有交互能力。

## 自动验证

- `npx tsc --noEmit`：通过
- `npm test -- --run`：217/217 通过
- `node node_modules/vite/bin/vite.js build`：通过
- `git diff --check`：通过

## 运行时验证限制

审计时本机 macOS 处于锁屏状态，Computer Use 无法读取 Lake Notes 窗口；CDP 也没有可连接的页面 target。因此本报告没有把“未能截图”当作视觉通过。解锁后仍应做一次亮色/暗色、笔记/小记、菜单/状态栏的截图回归，但源码层已完成最后一轮审计，未发现应立即进行的大规模 UI 重构项。
