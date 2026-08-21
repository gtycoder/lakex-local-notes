# Lake Notes 前端与 UI 阶段审计

日期：2026-08-20
分支：`feat/lake-notes-ui-system`

## 审计证据

本轮使用真实 Electron 窗口和 CDP smoke 捕获，证据目录：

```text
/tmp/lake-notes-ui-smoke/01-baseline.png
/tmp/lake-notes-ui-smoke/02-search.png
/tmp/lake-notes-ui-smoke/03-sync-popover.png
/tmp/lake-notes-ui-smoke/result.json
```

同时执行：

```text
npm test -- --run
npx tsc --noEmit
npm run check:bundle
npm run test:ui
npm run test:drawnix
npm run test:packaged
npm run benchmark:workspace
```

## 逐步审计

### 1. 普通文档工作区

证据：`01-baseline.png`

通过项：

- 左右固定 rail 均为 38px，视觉对齐。
- 顶栏保留 `本地空间`，没有被同步状态挤掉。
- Lake 原生工具栏仍在，未被重写。
- 编辑器底部是浮动状态条，不占额外 grid row。
- 空/普通文档稳定显示 `字数 N`、`图片 N`、`仅本地/待同步/已同步`。
- 工作区背景、资料库、编辑区和状态条层次清楚，未发现滚动条被状态条遮挡。

### 2. 搜索

证据：`02-search.png`

通过项：

- `⌘K` 可以打开搜索浮层并自动聚焦。
- 搜索浮层居中，背景遮罩足够明确，不会误认为编辑器被锁死。
- 帮助文案明确“不搜索小记”、标题/正文范围和键盘操作。
- 关闭按钮和 `Esc` 路径均保留；smoke 使用关闭按钮做确定性证据。

后续可优化：

- 空状态文案和辅助说明的字号偏小；可在不扩大弹窗的前提下提升辅助文字对比度。
- 搜索结果较多时需要后续 benchmark，确认长列表不会让浮层 DOM 过大。

### 3. 全局同步 Popover

证据：`03-sync-popover.png`

通过项：

- 顶部云状态保留全局语义：待上传文档、资源、小记分开统计。
- 立即同步入口明确，设置入口与同步状态分离。
- 底部当前文档状态没有重复全局数量，信息层级正确。
- 主进程事实来源已覆盖墓碑、小记和资源计数，不再由 renderer 做减法推断。

后续可优化：

- 待上传资源数量较大时可增加“资源”一行的溢出/详情策略，但不应增加常驻提醒。
- 同步失败时可继续补 retry count / last error / next retry time。

## 无障碍与动效检查

已通过代码检查：

- 关键弹窗有 `role=dialog`、`aria-modal` 和 label；设置面板已补齐 `aria-labelledby` 和首次打开焦点。
- 搜索结果使用 `role=listbox/option`。
- 底部状态条使用 `aria-label`，状态变化可读。
- `prefers-reduced-motion` 已覆盖 shell、浮层、状态条和 Drawnix 外层。

截图无法证明的项目：

- VoiceOver 真实朗读顺序；
- 键盘用户在所有浮层关闭后的焦点回归；
- 低对比度显示器和系统放大字号；
- GPU/网络 service 崩溃后的真实系统级恢复体验。

## 代码审计结果

### 已完成

- `App.tsx` 已分批抽出 `useTopMenus`、`useDocumentStats`、`useSyncController`、`useDocumentTabs`。
- IPC 错误统一为可识别 code，并兼容 Electron/contextBridge 对 Error 自定义字段的丢失。
- 设置面板 Hook 顺序错误已修复。
- 失效 `lastOpenedNoteId` 启动回退已补齐。
- 草稿 journal 生命周期、远程导入 rename/DB transaction 故障、资源原子写入、同步锁决策均有测试护栏。
- 旧 statusbar CSS 覆盖清理，底部状态条仅由专用样式负责。
- Drawnix 通过动态 JS/CSS 加载，并有真实 board fixture 验证。

### 当前指标

```text
App.tsx       约 1,431 行
store.ts      约 1,822 行
sync.ts       约 1,126 行
!important    约 494 处（含思源移植层和 Lake 兼容层）
```

指标不是继续机械拆文件的理由。下一阶段只在有明确边界、可测试的领域抽取：

1. `useDocumentTabs`；
2. manifest validation / sync planner 纯函数；
3. 剩余故障注入与 packaged restart；
4. 大资料库虚拟化和后台 tab 生命周期 benchmark。

## 2026-08-21 UI refinement evidence

本批完成并通过 dev UI smoke：

- tab close 槽位独立，dirty dot 不再与 close 控件争抢空间；
- 状态条默认短条，消息出现时向左扩展且有最大宽度；
- 设置面板改为宽松卡片布局，外观分类只保留 daylight/midnight；
- 资料库标题移除，搜索和四个按钮合并为一行；
- 拖拽目标使用灰色行态/插入线，和大纲按钮保持相同的微动效语言；
- 正文和全局辅助文本对比度略有提升。

截图证据仍使用：

```text
/tmp/lake-notes-ui-smoke/01-baseline.png
/tmp/settings-new.png
```

## 依赖安全审计

`npm audit --registry=https://registry.npmjs.org --omit=dev --audit-level=high` 当前报告 5 个 moderate 传递依赖问题：来自 Drawnix/Mermaid 链的 `dompurify` 和 `uuid`，报告标记为 `No fix available`。本轮没有强行升级 Drawnix/Mermaid：它们属于编辑器/画板运行时，升级可能破坏按需加载和内容兼容；后续应在上游发布修复后单独升级并回归。

原公司 registry 的 audit endpoint 返回 HTTP 500，因此最终结果以公共 npm registry 的报告为准。

## 结论

当前 UI、前端代码、稳定性和发布验证已达到“可直接验收”的完成基线：布局、状态分层、搜索、同步 Popover、Drawnix 首次加载、窗口恢复、renderer 草稿恢复、GPU/network helper 处理和 packaged smoke 均有真实证据。剩余项目是需要真实用户设备/上游发布节奏的长期观察项：VoiceOver 实机朗读、第三方 Drawnix/Mermaid 漏洞修复，以及未来超大规模资料库的性能演进。
