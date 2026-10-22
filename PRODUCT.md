# Product

<!-- impeccable:product-schema 1 -->

<!--
init 说明（本次）：`impeccable init` 的实时问答工具在当前模式不可用，未能进行用户确认轮。
因此本文全部结论来自仓库既有事实（README.md / AGENTS.md / HANDOFF.md / docs/ 与源码），
其中推断而非逐条确认的条目一律标注「（推断）」。若与实际不符，请直接改本文。

工作区布局：本文件位于应用仓库 `local-lakex-notes/`（独立 git 仓库），即本项目根。
其父目录 `local-lake/` 只是容器，里面的兄弟目录（siyuan-master / lake-main / lake-editor-main /
lakex-doc-react-main / yuque-developer-docs）是只读参考资料。
-->

## Platform

web

（UI 全部是 HTML/CSS/React，运行在 Electron 与 Capacitor WebView 里；原生外壳不改变设计语言 —— 见 README、capacitor.config.ts、src/desktop 与 src/mobile 两套 web 界面。）

## Users

唯一用户是作者本人（单人、个人笔记）：在多台自己的设备之间轮换使用（macOS 桌面端 + Android 手机），做个人笔记与资料管理。明确不存在「多设备同时编辑同一文档」的并发协作场景，没有账号、团队、共享或多人协作概念（README「设计先决条件」§2、AGENTS「核心设计原则」1）。

（推断）不对外分发、无「其他用户」：仓库内没有用户/账号体系、没有发布渠道与运营文案，远程为 Gitee 个人仓库。

## Product Purpose

本地优先（local-first）的个人笔记应用：用「语雀 Lake 编辑器」内核写富文本笔记，本地 SQLite + 文件系统是唯一数据真相，对象存储（S3 兼容，当前用七牛 Kodo）只作为多端镜像/备份。

它存在，是为了像思源笔记那样「自持数据」：完全离线可用、复制到微信等第三方时图片正常显示、不依赖任何云端服务就能写作与检索。

成功 = ① 数据永不丢失（由本地机制保证）；② 多设备可轮换并把编辑传播出去；③ 在大库下依然可用（长期压测基线 10 万文档 / 100 万附件；日常设计基线 5000 文档 / 2 万附件，全库含附件约 20GB）。

## Positioning

与云笔记（语雀 / Notion）和纯本地笔记（思源）都不同的一点：用闭源的「语雀 Lake 内核」提供与云端一致的编辑体验，同时把「本地即真相、S3 仅镜像」做成架构红线——云端绝不反向覆盖本地。

差异化机制 = 内核级 Lake 富文本 + 自持 S3 备份 + 明确的冲突/删除/恢复语义（先拉后推、墓碑权威=删除压编辑、不合并冲突、恢复是唯一显式例外）。这是邻近产品无法照抄的定位：它们要么是云端为真相，要么没有 Lake 内核级编辑体验。

## Operating Context

- 桌面端 = Electron 44 桌面应用（macOS arm64 优先）；移动端 = Vite + Capacitor Android（正式端之一）。
- 数据后端：桌面 better-sqlite3 + 文件系统；移动 sql.js / Capacitor SQLite。
- 资源：图片/附件按笔记分目录 `note-assets/{noteId}/`，本地 HTTP 资源服务（:19876）供编辑器与「复制到微信」使用（webp→png）；Lake 编辑器约 35 个 CDN 资源全量本地镜像，保证离线。
- S3：七牛 Kodo（S3 兼容 API），同步并发上限 8；协议见 `docs/SYNC-PROTOCOL.md`，GC 与保留链见 `docs/S3-GC-DESIGN.md`，存储分层见 `docs/STORAGE-LAYERS.md`。
- 文档分工：`README.md` 概览 / `HANDOFF.md` 唯一交接（当前状态/待办/坑）/ `AGENTS.md` 长期红线；`docs/` 按主题存契约（`LAKEX-CONTRACT.md` 等）。文档与界面均为简体中文。
- 开发环境：Node 24（必须）、Gitee 远程 `origin`、主分支 `master`、macOS。

## Capabilities and Constraints

已实现能力：笔记本树、富文本编辑（Lake 内核：标题/列表/待办/引用/表格/代码块/公式/分栏/折叠块等）、多维表（bitable）、表格（sheet）、画板（Drawnix）、手写板（矢量墨迹与多页 A4）、小记（独立时间线，可转正式笔记）、AI 助手（文本/图片/PDF 多模态；选区浮动栏 + 顶栏 + 块菜单三个入口）、大纲、历史快照、回收站、附件/图片管理、S3 同步 + GC。

技术栈（由现有代码回答，不再单列 ## Stack）：Electron 44 + React 18 + TypeScript 5.9 + better-sqlite3 13（N-API）+ vendored 的 `@dlient/lakex-doc-react`（内核 v1.99.0，已 pin）+ Drawnix 画板 + sharp + @aws-sdk/client-s3；移动端 Vite + Capacitor。准确版本以 `package.json` 为准。

约束与红线：

- 本地是真相，S3 只是镜像；墓碑权威（删除压编辑）；恢复是唯一显式例外（`restore_pending_at` → local-wins）。同步顺序 = 先拉后推。
- 不考虑数据兼容/迁移：开发数据可删可重建，判断标准是「能否删了重建？能就不写兼容」。
- 拒绝过度设计与「迎合式找需求」：任何非 bug 改动先证真实价值，证不了就直说「不做」。
- 自有设计系统（硬约束）：颜色/圆角/间距/字号/动效只用 `--lake-*` 令牌（主题即数据，颜色字面量只准出现在 `src/styles/themes/`）；组件走 `src/styles/kit.css` 的 `ln-*` 原语；浮层一律走 `src/components/ui/Overlay.tsx`；禁止内联样式与新增 `!important`（上限 ≤10 且每条须写明理由）；层序用 CSS `@layer` 而非特异性取胜。
- 「同一个交互语义，全仓只能有一套视觉与几何」；改动必须改在单一来源，禁止层层覆盖。
- 编辑器内核（lakex）已 vendored 并 pin，禁止随意升级。
- 术语：Lake = 正式笔记；小记 = 临时时间线（独立数据空间）；笔记本 = 树容器；多维表/表格/画板/手写板/小记是不同的编辑器类型。（推断：需长期保留的中文术语集）

## Brand Commitments

- 名称：LocalLakexNotes（桌面）/ LocalLakexNotes（Android）；应用 id `com.locallakexnotes.desktop` / `com.locallakexnotes.mobile`。
- 界面语言：简体中文（`<html lang="zh-CN">`）。
- 气质：务实、工程师导向、自觉拒绝炫技；明确不弹「正在加载」之类的 toast（README 核心理念）。
- 现有资源：`build/icon.icns`、`build/icon.png`。

- **视觉方向（261006 用户定稿，长期有效）**：走**品类标准**——常规、克制、**简约大气**，对标
  **语雀网页版 / 飞书云文档 / Obsidian 默认主题** 的工艺水准；**不加任何花活**、不为设计而设计。
  **布局冻结**：结构（有哪些区域）与构图（怎么排）都不改；**只做主题类优化**——配色、字体层级、
  材质与纵深、动效，且一律经 `--lake-*` 令牌。已明确淘汰的方向：刻本/朱墨、档案卷宗、厂牌编号、
  构格字样、机场导视、全屏内容流、排版尺度、留白优先、一墨多层。

（推断：以上均从仓库既有实现归纳，非用户逐条确认。）

## Evidence on Hand

- 真实代码与测试：`local-lakex-notes/`（vitest 1600+ 用例、多份 e2e 脚本，真实 Electron 实测记录见 `HANDOFF.md`）。
- 架构/协议文档：`docs/ARCHITECTURE.md`、`docs/SYNC-PROTOCOL.md`、`docs/S3-GC-DESIGN.md`、`docs/STORAGE-LAYERS.md`、`docs/LAKEX-CONTRACT.md`、`docs/QUICK-NOTES-SPEC.md`、`docs/MOBILE-*.md` 等。
- 只读参考仓库：`siyuan-master`（思源 v3.8.0，AGPL-3.0，样式/同步参考，移植需留 NOTICE）、`lake-main`（lakejs 社区版，仅机制字典）、`lake-editor-main`（第三方 VSCode 插件）、`yuque-developer-docs`（语雀官方文档本地副本，内核资料第一顺位）。
- 缺面：没有用户研究、真实客户/案例、基准数据出处；后续工作**不得**编造 testimonials、客户、定价或部署声明。

## Product Principles

1. 本地优先：本地是唯一真相，云端只做镜像备份，绝不反噬本地。
2. 数据不丢由本地机制保证（软删保留 + 历史快照 + 恢复标记），同步只负责传播。
3. 先问「能否删了重建」，能就不写兼容/迁移代码。
4. 拒绝过度设计：任何非 bug 改动先证真实价值，证不了就说不做。
5. 单一来源：同一交互语义全仓只有一套视觉、几何与实现。

## Accessibility & Inclusion

- 已有专门的无障碍层 `src/styles/a11y.css`（层序最高，含 `prefers-reduced-motion` 契约）；移动端有安全区/系统栏适配（`src/mobile/native/systemBars.ts`）。
- （推断）未发现产品级的可达性目标（如 WCAG 等级）或特定用户需求的明文约定 —— 记为**开放项**，待用户确认。
