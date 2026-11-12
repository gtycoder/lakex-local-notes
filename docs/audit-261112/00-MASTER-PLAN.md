# 00 · 发布前最终全仓审计：总方案（261112）

> **性质**：只读审计 + 方案设计。**本文件与 `docs/audit-261112/` 下的分册都是方案文档，不改任何产品代码**；是否执行、按什么顺序执行，等本方案逐项讨论后再决定。
> **审计基线**：`master @ 8cc65e06`（工作树 clean，单 worktree，双远端已同步）；日期 2026-11-12。
> **产出**：6 份分领域审计报告（见 §0.1）+ 本总方案。分册只读审计，未改代码、未跑设备、未触碰真实数据。
> **阅读方式**：先读 §1（一页结论）→ §6（裁决清单，逐项讨论用）→ 再按需读 §4 的分项方案与分册。

## 0. 分册索引与口径

### 0.1 分册（每份自包含、含 file:line 证据与复现命令）

| # | 报告 | 覆盖 | 结论规模 |
| --- | --- | --- | --- |
| 02 | [02-preview-unification.md](02-preview-unification.md) | 全仓预览能力：30 个入口、12 类渲染器、内核只读 4 包装、策略对象设计 | P1×4 / P2×8 / 裁决 8 |
| 03 | [03-desktop-ui-css.md](03-desktop-ui-css.md) | 桌面 UI 与样式系统（75 CSS / 11,424 行、kit 101 原语、层序） | P1×1 / P2×8 / 裁决 5 |
| 04 | [04-mobile.md](04-mobile.md) | 移动端 52,269 行源码 + 25 CSS + 18 Kotlin 插件 | P1×2 / P2×7 / 裁决 3 |
| 05 | [05-core-electron.md](05-core-electron.md) | `src/core` 22,433 行 + `electron` 24,054 行 + preload | P1×2 / P2×6 / 裁决 5 |
| 06 | [06-features.md](06-features.md) | 14 个特性域（editor/bitable/ink/usheet/board/AI/日记/小记/标签/搜索/导入/附件…） | P1×2 / P2×8 / 裁决 4 |
| 07 | [07-docs-cleanup.md](07-docs-cleanup.md) | 164 docs + 47 guide + 148 scripts + 仓库卫生 + 使用技巧 | P0×2 / P1×4 / P2 若干 / 裁决 8 |

### 0.2 判定口径

- **P0**＝发布阻断或数据风险；**P1**＝开源前应处理（成本可控、收益明确）；**P2**＝可排期/顺手做。**本轮代码域 P0 = 0**（这是六份报告交叉核对后的结论，不是省略）。
- 只列「问题真实存在 + 不做有代价 + 收益 > 新增复杂度」的项（AGENTS §3#17）。**审查中推翻的假设与「刻意差异」都单列**，防止下一轮重复立项（§7）。
- 证据分级：**【核实】**＝直接读代码/跑只读命令；**【推断】**＝结构推理、未运行时验证。分册中每条都带标记。
- 本方案不推翻 AGENTS 已定稿红线（删除/恢复语义、S3 协议、两端 UI 独立、内核 pin、不清理 vendor、依赖准入）。

### 0.3 事实基线（本机实测）

| 项 | 数值 |
| --- | --- |
| 自有产品代码（非测试） | `src` 128,439 行 TS/TSX + 17,540 行 CSS；`electron` 24,054 行；Kotlin 5,070 行 ≈ **175K 行** |
| 测试 | 872 个测试文件 / 5,448 个 `it/test` 用例 / 74,304 行（src 侧） |
| 分层边界 | `core` 164 文件 0 处 `node:`/`electron`/DOM；`electron→渲染层` 0；`renderer→electron` 0（`check:core` 通过） |
| IPC | 187 通道 × 4 面（register / preload / WEB_METHODS / `native.ts`），前三面已有 parity 测试并钉死规模 |
| 样式门禁 | 桌面颜色字面量 0 / 字号字面量 0 / `!important` 9=白名单 / 未定义令牌 0；移动颜色 0 / `!important` 15<19；跨端 UI 独立有护栏 |
| 构建预算 | 桌面首屏 564,742 / 600,000；app-js 192,028 / 307,200；mobile entry 60,058 gz / 首屏 348,202 / 360,000 |
| 工作树 | clean；HEAD `8cc65e06`；无未记录 worktree |

## 1. 一页结论（先读这段）

### 1.1 总体判定

**工程底座达到开源上游水平，不建议任何"推翻重写"；真正要花力气的是「最后一公里的一致性」与「文档/手册债务」。**

- 本地优先、墓碑权威、删除压编辑、恢复唯一例外、S3 v3 内容寻址、互斥域 I1–I3 —— 这些核心不变量在代码里**可证明**，且有 872 个测试/多套门禁兜底（05 报告逐条给出证据）。
- `src/core` 纯净、两端 UI 独立、协议单一来源、样式令牌唯一来源 —— 四条架构决策经受住了审计。
- 六份报告合计 **P0（代码域）= 0**；`docs` 侧两条 P0（手册落后、`.gitignore` 与内核入库矛盾）是发布前真正必须处理的。
- 用户点名的六个方向都**部分成立、但形态与预期不同**（见 1.2 校准）。按「先低风险、后重构」的顺序做，预计发布前 3–5 天、开源后 2–3 周可以收口。

### 1.2 对预设问题的校准（重要：避免按错误前提返工）

| 你的预设 | 审计事实 | 结论 |
| --- | --- | --- |
| 前端「层层套 CSS、嵌套严重」 | 桌面门禁全绿：非主题颜色字面量 **0**、字号字面量 **0**、`!important` **9=白名单**、未定义令牌 **0**。真实问题是 **58 条 legacy 声明已被上层压死**（25 条取值相反）⇒ 改它不生效；以及移动端 `mobile.css` 混入 bitable/board/editor 三域约 300 行 | **不是重写问题，是"删死声明 + 域归位 + 加机器门禁"问题** |
| 预览「很多套、入口混乱」 | 浮层只有一套（`ImageLightbox`/`AttachmentPreview` 两端共用）；小记「快路径+内核兜底」是全仓最干净范本。真实割裂 = **只读内核渲染 4 份包装器** + **文档只读预览 2 个宿主（能力集不同）** + **无策略对象（30 入口 4 种组合）** + **图片档位 4 套** + **tap 判定 2 份** | **只抽 3 样东西（hook/策略/档位），不要造万能组件** |
| 公共函数重复严重 | 跨端数据逻辑已大量共享（`core` 65 个模块被两端共用）；真正值得抽的约 **14 项**（剪贴板、日期、并发常量、hash、runPool、图片档位、tap、长按…） | **量小、清晰、低风险** |
| 模块划分混乱 | 分层边界干净、静态环 0；问题集中在 **7 个巨型文件**（最多 2,419 行）与 **15 个文件私抄 `NoteKind` 字面量**、**5 个一级空间工作区归属例外** | **有界拆分 + 编译期护栏，不搞注册表/重构框架** |
| 兼容历史数据代码很多 | 全仓逐条核对：**没有系统性违规**；唯一删候选 = 设备同步账本 v1/v2→v3 迁移（删除意图不可重建 ⇒ **建议保留**）；另有 1 处死开关（旧 quick-notes 通道已不存在） | **基本无需处理；只删死开关 + 补注释** |
| 需要重新设计某些模块架构 | 核心不变量与数据层不该动；但**横切能力（预览/只读/空间能力）缺一层"策略与契约"**，导致入口各写各的 | **新增能力层（纯逻辑）+ 契约层（测试对账），不动数据层** |

### 1.3 优先级总览

**发布前必修（R0，3–5 天）**
1. **文档/手册**：guide 新增 4 章（日记 / AI 写作 / 便携包与换机 / 更新中心）+ 全量改名与语义纠偏；README 文档地图与 HANDOFF 合并为单一来源；`ARCHITECTURE.md` 重写（3 个路径已不存在、仍是 Manifest V2 时代）。
2. **仓库卫生**：`.gitignore:28-31` 三行（内核已 vendored 却仍被忽略，升级新增文件会静默丢失）；21 处硬编码 `/Users/admin/`（`multi-end-sync/*.mjs` 在他人机器必崩）；`ARCHITECTURE §4.5` 真实桶名脱敏。
3. **死代码/死脚本**：`src/core/s3v3Gc.ts`（98 行，产品 0 引者却被 3 个测试当护栏）+ 23 个零引用脚本 + `docs/INK-DEVICE-CHECK.md`。
4. **零风险文案/注释纠错**：小记「保存并同步」失败文案错误（F-04）、AI 作用域 4 宿主缺 `data-note-id`（F-03，小修）、`settingsRepository` 安全反向注释、preview 头注释、`TagPreviewBody` 死分支、`lakeNativeContract` 计数注释、移动 `--mb-radius-xl` 悬空、`mobile.html` 双 theme-color、`OpenFile` 重复注册。
5. **护栏补齐**：`shadowedDecls`（桌面样式）、`kindTouchpoints`（kind 触点）、`native.ts` 第四面 parity、预览策略常量断言、小记同步理由映射。
6. **发布验证**：桌面 42 态（需夹具机）、手机/平板 10 态 + 23 屏、windowsweep、双 build/预算、全量 vitest。

**开源后第一批（R1，2–3 周）**
- 预览能力收口（4→1 hook / 策略对象 / 档位 / tap）；
- 只读状态与空间能力矩阵；
- 公共函数抽提 14 项；
- 巨型文件拆分第一批（`core/bitableDoc` → `BitableEditor`）；
- 桌面死声明删除 + 移动 `mobile.css` 域归位；
- 文档删/归档/压缩第二轮；脚本索引；Kotlin 测试与 Keystore 统一。

**长期（R2）**：`InkPad`/`lakeRuntime` 拆分、双端契约 conformance 套件、AI 会话模型统一、移动 CSS `@layer`（独立项目）、性能基线常态化、大库/真机验收。

### 1.4 需要你裁决的事项

共 **27 项**，集中列在 §6（每条给了推荐与代价）。最关键的 8 条：开源前是否做预览 Phase 2（两端回收站能力一致）、手机大图是否取原图、拆分是否放开源后、`.gitignore` 是否删三行、HANDOFF 压缩幅度、`audit-261027` 去留、桌面 42 态是否补跑、AI 助手桌面端是否要持久化会话。

## 2. 审计方法与覆盖

### 2.1 做法

- **六域并行只读审计**（预览 / 桌面 UI+样式 / 移动端 / core+electron / 特性域 / 文档脚本），各写一份自包含报告；Lead 独立复核关键结论并汇总。
- **Lead 独立复核**：`ui-metrics` / `check:core` / `check:mobileui` / `audit-dead-css` 实跑；对 8 条关键 finding 做 grep 级复现（`.gitignore`、`s3v3Gc`、并发常量、tap 窗口、长按第三份、AI scope、同步文案、shadowed 声明、日期绕开、剪贴板）。
- **不做**：未跑全量 vitest/构建/设备（只读纪律）；性能结论只引用仓库内已落盘实测（HANDOFF/移动性能基线），不新造数字。

### 2.2 覆盖与未覆盖

- **覆盖**：`src/**` 全部目录（含 mobile）、`electron/**`、`android/**/*.kt`、`docs/**`、`guide/**`、`scripts/**`、`public/vendor` 与 `vendor/lakex-doc-react` 的**仓库侧**（不审内核内部）、CI/发布配置。
- **未覆盖**：真实 S3 往返与 2 万文档压测、设备级实机观感/内存（未启动 App/模拟器）、平板预览几何、`InkPad/BitableEditor/lakeRuntime` 内部逐行正确性、`electron/ai/**` 与 `updateService` 行为细节、便携包 zip 条目级路径校验（列为下轮单看）。

### 2.3 已核实「不是问题」的项（防止重复立项）

以下均逐条查过并给出证据，**未来审计不要重复提**：
- 两端 UI/CSS 未共享（刻意独立，有 `mobileIndependence.test` 护栏）；两端数据访问未抽统一 Repository（宿主本质不同）。
- 浮层/对话框/确认/浮动窗/长按/多选/toast 桌面侧已单一来源（`Overlay`/`useConfirm`/`useFloatingDialog`/`longPressTimer`；toast 三套是三种语义，`.ln-toast` 已按零调用删除）。
- `!important`（桌面 9 白名单 / 移动 15<19）、颜色字面量（全部在 themes/mobile theme）、`.b3-*` 清零、未定义令牌 0。
- 分层纯净、静态环 0、内核 lazy 边界纪律、AI 出网唯一闸门（`lib/ai.ts`）、S3 安全（fail-closed/路径白名单/无 exec/无明文）、IPC 三面一致。
- 历史快照预览不重复序列化；小记预览判据单一（`unsupported` 节点）；标签聚合两端共用 `core/tagAggregate`。

## 3. 架构审查（第一性原理）

### 3.1 现状架构（as-is）

```text
┌────────────────── 桌面（Electron） ──────────────────┐   ┌───────────── 移动（Capacitor） ─────────────┐
│ 渲染层                                              │   │ 渲染层                                     │
│  App.tsx（编排，1445 行，30+ hook）                  │   │  MobileApp（路由/外壳）                     │
│  components/app/*（5 个一级空间 + shell 面板）       │   │  mobile/{home,notebook,settings,...}        │
│  features/*（14 域：editor/bitable/ink/usheet/...）  │   │  features/*（共享内核宿主/只读预览）        │
│  components/ui（Overlay/Dialog/Menu/Select…）        │   │  mobile/ui（MobileSheet/mb-* 原语）         │
│  styles（@layer: vendor<legacy<tokens<kit<...）      │   │  mobile.css + 各 feature css（未分层）      │
│      │ lib/native.ts（IPC 类型门面）                 │   │      │ mobile/bridge.ts（68 方法）          │
├──────┼───────────────────────────────────────────────┤   ├──────┼─────────────────────────────────────┤
│ 主进程 electron/：main + ipc(187) + 仓储 + s3v3 适配  │   │ Kotlin 插件 14 个 / 64 方法                 │
│      │ better-sqlite3 + 文件系统                      │   │      │ Capacitor SQLite + BodyStore 文件   │
├──────┴───────────────────────────────────────────────┴───┴──────┴─────────────────────────────────────┤
│ 共享纯逻辑 src/core（164 文件 / 22,433 行；65 个模块被两端同时消费；0 外部依赖）                          │
│   ├─ s3v3 协议/决策/合并/状态（v4 内核）   ├─ bitableDoc/inkDoc/boardDoc/usheetDoc（正文模型）         │
│   ├─ quickNote*/tag*/trash*/search/日期/资产命名/并发池/错误契约 …                                    │
└──────────────────────────────────────────────────────────────────────────────────────────────────────┘
共享 UI 边界 = features/editor 的 lakeRuntime / LakeEditor、features/quickNotes/QuickNotePreview、
             features/ink/InkPad、features/attachment/*（两端复用实现，视觉各端自有 CSS）
```

**一句话**：这是一套「双壳 + 共享领域内核 + 双数据后端」的合理架构；问题不在主干，在**横切能力的落点**。

### 3.2 做对了的四件事（不要动）

1. **`src/core` 纯净且可执行校验**：无 `node:`/electron/DOM；`check-core-boundaries.mjs` 让边界可回归。这是双端一致性的根。
2. **两端 UI 独立**：没有为"共享组件"牺牲触屏密度/手势/键盘，避免了第二套样式范式。
3. **同步语义单一来源且可证明**：先拉后推、删除=缺席、恢复标记、互斥域 I1–I3 都有代码级证据与测试；S3 安全面（fail-closed / 路径白名单 / 无 exec）干净。
4. **门禁即架构**：样式 @layer + 令牌门禁、内核 lazy 边界、IPC 三面 parity、构建预算、设备装置——这些"可执行的架构约束"比文档更能守住设计。

### 3.3 五个结构性根因（本轮要处理的对象）

| 编号 | 根因 | 证据 | 后果 |
| --- | --- | --- | --- |
| R1 | **横切能力没有落点**：预览/只读/选择/图片档位按"入口"各写一遍 | 30 个预览入口 4 种能力组合；内核只读 4 份包装；图片来源 4 套；tap 判定 2 份；长按 3 份 | 同一语义两端/多入口不一致；新入口必须重新发明规矩 |
| R2 | **空间×kind×端的语义分派靠 if 链**，无编译期护栏 | 77 处 kind 分支 / 31 文件；15 文件私抄 `NoteKind`；111 处 space 条件；新增 kind 静默回落 doc（毁正文级） | 开源后外部 PR 极易踩；语义漂移无告警 |
| R3 | **双端数据层只有"实现"、没有"契约"**（`repositoryCapabilities` 是雏形） | 桌面/移动仓储 30+ 能力对账表只覆盖函数存在性；无行为一致性测试 | 两端行为悄然分叉（如历史/回收站/标签顺序） |
| R4 | **巨型文件把"可单测的纯逻辑"锁在"必须起内核/Univer"里** | bitableDoc 2419、BitableEditor 2111、InkPad 1907、lakeRuntime 1699、QuickNotesWorkspace 1317、Sidebar 1857、SettingsPanel 1447 | 改动成本与回归面放大；开源后 review 困难 |
| R5 | **文档即架构，但单一来源被稀释/过期** | ARCHITECTURE 3 个路径不存在 + V2 时代；HANDOFF 83% 是批次流水；guide 落后两个版本；README 与 HANDOFF 两份文档地图 | 外部读者/贡献者按错的事实工作 |

### 3.4 目标架构（to-be）：只加一层能力层 + 一层契约层

**设计原则**：能力层只放「策略 / 类型 / 纯逻辑 / 薄 hook」，**不放样式、不放数据获取、不放组件树**；能靠"删/搬/加测试"解决的，绝不新增抽象。

```text
L0 原语（既有，不动）：Overlay / MobileSheet / kit(ln-*) / mobile kit(mb-*) / tokens
L1 能力层（新增，纯 TS + 薄 hook；两端共用逻辑、UI 各自渲染）
   core/capabilities/
     ├─ readOnlyState.ts     只读原因与能力（锁定/回收站/已清除/缺正文/云端已删/预览）
     ├─ spaceKindMatrix.ts   5 空间 × 5 kind 的语义能力表（建/标签/历史/同步快路径/预览/批量）
     └─ previewPolicy.ts     预览策略类型 + 5 个预设（纯类型/常量，不依赖 React）
   features/preview/
     ├─ useReadOnlyKernelViewer.ts   createLakeDocument("viewer") 的唯一包装（4→1）
     ├─ previewAsset.ts              图片档位 display / original / materialized 唯一判据
     └─ renderers.ts                 kind → 渲染器 映射（唯一分派点）
   lib/（跨域纯工具，零依赖）
     ├─ clipboard.ts / useCopiedFlag  复制文本 + 反馈收敛
     ├─ tapWindow.ts                  单击/双击判定唯一实现
     └─ asyncPool.ts / aiBudgets.ts / s3Limits.ts（见 §4K）
L2 特性域（既有，按 §4L 有界拆分）
L3 空间壳（既有；只把语义条件改读 L1 表）
L4 数据/端口（既有；桌面 IPC / 移动 bridge 不合并）
L5 契约层（新增测试，不新增运行时）
   core/repositoryCapabilities.ts 扩展为「能力 + 行为一致性」对账：
   桌面/移动各实现，共用同一组 conformance 测试（fixtures 双向）
```

**关键边界**：
- L1 不得 import `native`/`bridge`/`electron`，不得 import 任何端样式或组件；
- 预览的"内容获取"仍归宿主（各空间 IPC/bridge），能力层只接收 `PreviewSource`；
- 样式/几何/字号仍由两端各自决定（AGENTS §3#14 不变）；
- 不建运行期 kind 注册表（5 种 kind 固定、宿主是不同第三方内核；注册表 = 过度设计）。

### 3.5 为什么不做全面重写（收益/风险/成本）

| 选项 | 收益 | 风险/成本 | 结论 |
| --- | --- | --- | --- |
| 重写编辑器宿主/数据层 | 代码更"现代" | 触碰锁/解锁交接、tileRendering、输入法抑制、tile 虚拟渲染、同步热路径；现有 5,448 测试与设备装置是围绕现状建的 | **不做**（AGENTS §2：不在没有护栏时大改） |
| 引入 DI/ports-adapter/状态库/kind 注册表 | 结构更"整齐" | 静态环 0、边界 0 违规，改造纯属"整洁"收益；撞 §3#17 | **不做**（06 报告已逐条论证） |
| 能力层 + 契约层 + 有界拆分 | 消除 R1–R3，降低 R4/R5 | 低风险、可分批、每批有护栏 | **做** |

### 3.6 性能架构（测量驱动，不空谈）

- 既定预算（不要退）：桌面首屏 600KB / app-js 300KB；mobile entry 60KB gz / 首屏 360KB；移动冷启动 p50 ≈1.6s、capture ≈0.9s、写作卡热开 ≈0.33s（`.css-audit/perf` 本机基线）。
- **性能问题的正确形态**：不是"重写成高性能架构"，而是"守住已测出的地板 + 消除已证实的浪费"。本仓已有关键优化（内核 lazy 边界、首屏预热、小记快路径 13→11 请求、虚拟渲染、缩略图、并行闸门）。
- 待取证/待修（列 backlog，不在本轮拍脑袋优化）：
  1. 内核实例内存 ≈5MB/实例（预览/小记列表的实例上限策略已在 A2 收敛）；
  2. 深清 keep 集 N+1（2 万篇 ≈6 万查询，仅手动/定时）；
  3. better-sqlite3 同步 IO 与全表映射（无实测，先加埋点）；
  4. 移动 `getQuickNoteImage` 整图字节过桥（待设备堆采样）；
  5. 大数据集多维表/长文档（已有 `BITABLE-VIEWPORT` 与 perf 门禁）。
- **要求**：任何性能改动必须带"改前/改后"实测数字（沿用 HANDOFF 的口径），否则不做。

## 4. 分项方案（按讨论单元编号）

> 每项含：现状/证据 → 问题 → 方案 → 护栏 → 风险/回退 → 优先级。优先级：**R0**＝发布前，**R1**＝开源后第一批，**R2**＝长期。 
> 详细证据与 file:line 见对应分册，本总方案只给决策级摘要；**"不做什么"与"为什么"同样重要**。

### A. 预览能力统一（最优先的横切能力）

**现状（已核实）**：30 个用户可见预览入口（桌面 18 / 移动 12），12 类渲染器实现；经宿主间接使用 `createLakeDocument("viewer")` 的位置共 5 处（4 份独立包装 + `LakeEditor` viewer 模式）。
- 浮层（Lightbox / 附件预览）两端已是单例共享；小记「快路径 + 内核只读兜底」判据单一、是全仓范本。
- 真正割裂：①同一「文档只读预览」两个宿主（桌面 `NoteDocPreview` 只 create+setDocument；移动 `TrashPreviewPage` 用 `LakeEditor viewer`，连带挂图片放大/附件打开/长按卡片菜单/copy-cut）；②内核只读 viewer 4 份包装（生命周期/prefs/失败策略各写）；③「预览里能做什么」无策略对象（30 入口 4 种组合）；④「放大看大图」图片档位 4 套（原图 / `?w=1024` / `?base64=1` / 原生 dataUrl），移动放大后仍是 1024；⑤tap 判定 2 份（`pointerdown+300ms+28px` vs `click+320ms+filename`）；⑥两个沉浸浮层各自实现 portal/Esc/滚动锁/状态栏。

**方案（三小步 + 三小修，不造万能组件）**

| 编号 | 内容 | 落点 | 优先级 | 风险 |
| --- | --- | --- | --- | --- |
| A1 | **`useReadOnlyKernelViewer`**：把 4 份包装收成 1 个 hook（create/destroy/addAssetAccessToken/prefs/挡位/失败策略/视口闩锁），迁移顺序 `useHistorySnapshotViewer` → `QuickNoteKernelPreview` → `AiAnswerViewer`；`LakeEditor`/`EditorTab` **不动** | `src/features/preview/useReadOnlyKernelViewer.ts`（迁移期可先放 `components/hooks/`） | R1 | 中低：纯逻辑搬移；护栏=同 key 只 setDocument / 换 key 重建 / 卸载销毁 / token 一定被加 / 懒边界不破 |
| A2 | **`PreviewPolicy`**：5 个预设 `docPane / trash / history / tagSpace / quickNoteCard`，字段＝`inlineBody / zoomImage(intent) / openAttachment / copySelection / cardMenu / mount`。据此修两端回收站能力差：桌面回收站/历史新增"双击图片放大"（`NoteDocPreview` 挂 `attachImagePreviewClick`，不新增内核实例）；移动回收站走 `LakeEditor interaction:"preview"`（默认值＝现状，可回退） | `core/capabilities/previewPolicy.ts` + 各宿主 | R0 可选 / R1 | 中：动 `LakeEditor` 需设备门禁；策略常量用源码断言防漂移 |
| A3 | **`previewAsset.ts`**：图片引用 `{noteId, filename, src?, mime?, w?, h?}` + `intent: display/original/materialized` 唯一判据；Lightbox 打开时按 intent 取原图（先显示档、后换原图），迁移 8 个 `openImagePreview` 调用点 | `src/features/preview/previewAsset.ts`；`imagePreview.ts` 加可选 `assets` 入参（旧签名薄适配，迁完即删） | R1 | 低；唯一必须实机验证＝小记 4000×3000 图点开后 `naturalWidth` |
| A4 | **`tapWindow`**：单击/双击判定抽纯函数（`pointerdown` + 300ms + 28px + 移动/滚动取消），`HomePage` 由 `click` 改 `pointerdown` | `src/lib/tapWindow.ts` | R1（设备验证） | 中：移动手势 ⇒ 10 态 + 23 屏 + 单击/双击点按验收 |
| A5 | **`useImmersiveOverlay`**：统一 portal/Esc（`immersivePreview`）/滚动锁/移动状态栏/mac 让位；两浮层共用；**不共享 CSS** | `src/components/hooks/useImmersiveOverlay.ts` | R1 | 低；Esc 只关最上层已有护栏 |
| A6 | **移动历史版本预览**：桌面可预览、移动只能盲恢复；桥能力已登记（`lakeNativeContract.ts`），数据层不用新开 | 移动 `WorkspaceOverlayHost` + `previewHistorySnapshot` | R2（下版本） | 中：需设备；非 doc 仍可只给结构化摘要 |
| A7 | **死路径/注释纠偏**：`imagePreview.ts` 头注释（envAdapter 已不存在）、`TagPreviewBody` 不可达分支与保护它的测试、`NoteDocPreview/HistorySnapshotPreview` 的移动端不可达分支 | 3 文件 | R0 | 零 |

**明确不做**：万能 Preview 组件（5 套引擎塞进一个状态机）；跨端共享预览 CSS/组件；重写只读引擎；接 vendor `previewImgs`（本构建无效）；在预览里做任何写操作（唯一例外＝小记待办勾选）。

### B. 只读与锁定状态（横切语义，小改动）

**现状**：`readOnly` 在 5 个编辑器宿主一致注入（`MultiTabEditor`：`lockedNoteIds.has(id) || tab.deleted`）；「已进回收站/被他端 purge」判据单一（`core/syncDecisions.isGoneNote`），但**消费口径不同**：桌面＝只读+状态栏标记，移动＝拒绝打开+toast（与 AGENTS §3#16 字面不符）。另有正文缺失（`docBodySafety`）、云端已删除仅本地副本、预览恒只读、AI 只读视图——**五种"只读"原因分散在 4 个模块，UI 各自表达**。

**方案**：新增 `core/capabilities/readOnlyState.ts`（纯函数 + 表驱动测试）：
```ts
readOnlyStateOf({ editLocked, trashedAt, purged, bodyMissing, cloudDeletedCopy }): {
  canEdit, canSave, canRestore, canPreview, reason: "locked"|"trashed"|"purged"|"missing"|"cloud-deleted"|null, bannerKey
}
```
消费方：桌面 tab 壳、移动工作区、预览宿主、横幅/状态栏文案。**不改 §3#16 的语义**，只是把判据与文案收成一处；移动端「拒绝打开」若确为定稿，在 HANDOFF/AGENTS 登记为例外（Q-3）。

**护栏**：表驱动单测（5 原因 × 4 能力）；`RESILIENCE.md` 失败面表同步；两端现有 `*OpenReadOnly` 测试保持绿。
**风险**：低。**优先级**：R1（若发布前只做文案收口，可只建常量表）。

### C. 回收站能力

**现状**：`core/trashPolicy.ts`（33 行，天数/提醒）已共享；桌面 `electron/trashRepository+trashLifecycle`、移动 `mobile/data/trashRepository`（388 行）各自实现；UI 桌面 `TrashPanel`（列表+分栏预览）、移动 `TrashList`（树）+ `TrashPreviewPage`。purge/恢复语义已定稿（AGENTS §3#5/#15），**不要动**。

**方案**：抽 `core/capabilities/trashModel.ts`（纯逻辑）：行归一（kind/title/deletedAt/cloudDeleted/isGroup）、分组统计、「可执行动作矩阵」（restore/purge/preview/批量）、purge 二次确认文案键。两端仓储只做「行 → 模型」映射；**不抽数据层**。
**护栏**：同一组 fixture（桌面/移动各一份）跑 conformance 断言（数量、分组、动作可用性、天数）；UI 差异（列表形态）登记为已定稿。
**优先级**：R1。**风险**：低（不碰删除/恢复实现）。

### D. 标签能力

**现状**：领域逻辑已单一来源（`core/quickNoteTags`、`tagAggregate`、`batchTagging`；移动 `tags/tagAggregate` 只是 `import` core 后加聚合行，**不是复制**）；标签库两端都在小记库（桌面 261107 迁移）；顺序＝设备本地；删除＝缺席（禁墓碑）。UI 共 8 个组件（桌面 NoteTagDialog/NoteTagRow/BatchTagDialog/QuickNoteTagPicker/Manager；移动 NoteTagsSheet/BatchTagPickerSheet/MobileQuickNoteTagSheet/TagsHomeTab）。

**结论与方案**：**不统一 UI、不新增抽象层**。只做两件低风险事：
1. `core/batchTagging` 补 `planBatchTagApply()`（选中集合 + 增/删标签 → 计划 + 结果计数），让两端批量入口共用同一计划语义（若现状已覆盖则不新增）；
2. 文档化三条定稿语义（顺序仅本机 / 删除=缺席 / 桌面文档标签关系在标签库）进 guide 与 `TAG-SYSTEM-DESIGN.md`（07 报告已给落点）。
**护栏**：现有 `tagAggregate.test`/`batchTagging.test`；新增「两端计数同 fixture 相等」conformance。**优先级**：R1（低）。**风险**：极低；不要为此建标签服务层。

### E. 小记能力

**现状**：领域逻辑共享充分（`core/quickNote*` 14 个模块 + `s3v3/quickPush` 管线）；两端 UI 独立（桌面 `QuickNotesWorkspace` 1317 行 / 移动 `HomePage` 1312 行）；预览已统一；首屏预热已修；单条快路径 11 请求已定稿。
**方案**：
1. **R0**：修「保存并同步」失败文案（F-04：`no-baseline`/`cloud-changed` 被折叠成 `no-remote-manifest` ⇒ 谎称"云端还没有小记数据"）+ 同步过期注释（`QuickNotesWorkspace:540`、`quickNoteSyncTypes:8/16`）。
2. **R1**：`QuickNotesWorkspace` 按 03 报告拆 3 个 hook（list / draftSave / filters）+ 2 个纯展示组件，**一步一提交**；不搬目录（U-2 建议不搬）。
3. **R2**：桌面/移动列表模型若出现投影差异，再用 conformance 测试收口（当前 `core/quickNoteQueries/filters/sort` 已共享，暂不新建）。
**明确不做**：把小记并进文档空间；桌面/移动列表 UI 合并；为「保存并同步」再加快路径分支（已定稿）。

### F. 多选与批量操作

**现状**：桌面＝`core/treeSelection`（124 行纯逻辑）+ `App/Sidebar` 状态 + `TreeSelectionContextMenu`；移动＝`mobile/ui/useSelectionMode`（71）+ `selection.ts`（86）+ `docBatch.ts`（70）+ `SelectionActionBar/TopBar`；批量执行＝桌面 `electron/ipc/registerBatchNotes` vs 移动 `bridge/batchNotes`（都基于 `core/batchNotes`）。
**判定**：**UI 刻意不同，不合并**；但「选择模型（范围/全选/反选/剪枝）」与「批量动作可用性/结果模型」可能重复。
**方案（条件项）**：先花 0.5 天对比 `treeSelection` 与 `selection.ts/docBatch.ts` 语义；若确有重复，抽 `core/capabilities/selectionModel.ts`（纯 reducer）+ `core/batchActionPlan.ts`（动作可用性/结果），两端 UI 只 dispatch；若只是"看起来像"，**不做**（06 报告已指出桌面多选只有 1 个消费者，提前抽象＝过度设计）。
**优先级**：R1（条件触发）。**风险**：低-中（移动手势多选需设备验证）。

### G. 附件与资产

**现状**：共享原语 `AttachmentChipList` + `FileKindIcon/fileKindOf` + `attachmentPreviewController` + `openAssetEntry`；上传管线两端独立（桌面 `resourceUpload`、移动 `assetFs`）；**资产 URL 生成有 4 套**（`core/assetUrl` localAssetHttpUrl / `bitableAssetUrl` / `quickNotePreviewAssetUrl` / `assetDisplayUrl`），预览档位因此分散（与 A3 同源）。
**方案**：
1. A3 的 `previewAsset` 覆盖"预览/放大/复制"三种 intent；其它显示场景（编辑器登记、封面）保留现有 helper，但统一从 `core/assetUrl` 派生；
2. 检查 `AttachmentChipList` 是否只有 bitable 外的消费者；若有，搬到 `components/ui/`（纯搬运，不改结构）；
3. Kotlin 资产路径校验两套实现 → 归 N（安全项）。
**优先级**：R1（与 A3 同批）。**风险**：低。**不做**：合并两端上传管线。

### H. AI 助手与 AI 写作

**现状**：出网唯一闸门（`lib/ai.ts` `runAiChat`）正确；`core/aiProviders`/`aiChatMessages` 共享；**两端会话行为不一致**：桌面 AI 助手会话仅内存、关闭即丢；移动保存最近 50 条 / 30 天；答案渲染桌面走内核只读视图、移动走自研 `AiMarkdown`（为省 6.1MB 内核 chunk，**刻意**）。另有 F-03 作用域 bug（4 个非 doc 宿主无 `data-note-id` ⇒ 共用空作用域、关文档不销毁面板）与 3 个字符预算（60k/190k/200k，语义不同）。
**方案**：
1. **R0**：F-03 小修（4 宿主补 `data-note-id`；`aiAssistantSession` 选择器与 `activeEditor` 同族）+ 护栏；
2. **R1**：`core/aiBudgets.ts` 集中三个预算并写清语义（"附全文上限 / 命令上下文 / 主进程总预算"），不改数值；
3. **裁决 Q-12**：桌面 AI 助手是否要持久化会话（现状与移动不一致；若要做，复用移动的口径：50 条 / 30 天、只存本机）。
**明确不做**：移动 AI 上内核渲染（冷启动代价 > 收益）；把 AI 写作与 AI 助手合并成一套 UI（不同产品语义）。

### I. 日记与「空间 × kind」能力矩阵

**现状**：日记＝普通 Lake 文档 + `folders[].space` 标记，`core/diary` 判据单一；两端工作区都很薄（桌面 505 / 移动 8 文件）。全仓 `space` 条件 **111 处**、`kind` 分支 **77 处/31 文件**，其中真正"语义能力"（哪些空间支持标签/历史/批量/预览/新建哪些 kind）散落各处。
**方案**：新增 `core/capabilities/spaceKindMatrix.ts`（**纯数据 + 纯函数**，不依赖 React）：
```ts
SPACE_CAPABILITIES = {
  library: { kinds: ["doc","usheet","bitable","board","ink"], tags: true, history: true, batch: true, syncFastPath: false, previewInline: true },
  quickNotes: { kinds: [], tags: true, history: false, batch: true, syncFastPath: true, previewInline: true },
  diary: { kinds: ["doc"], tags: false, history: true, batch: false, previewInline: true, ... },
  aiWriting: { ... }, tags: { ... },
}
```
只供"入口/菜单/空态/能力提示"读取 + 测试对账；**布局/渲染条件不动**。为第 6 种 kind 加**编译期触点清单测试**（F-02：15 文件改 `import type { NoteKind }` + `noteKindTouchpoints.test.ts`）。
**优先级**：R0 做 kind 私抄清理与触点测试（零风险）；R1 做能力矩阵。**风险**：矩阵若被当成"万能配置"会过度设计——只允许描述**跨端一致的语义能力**，不描述观感。

### J. S3 / 同步流程

**现状（已核实）**：协议 v3/v4 不变量可证明（先拉后推、删除=缺席、恢复标记、互斥域 I1–I3、并发 12、事务、安全 fail-closed）；**问题集中在"单一来源"与"护栏"而非语义**：
- `src/core/s3v3Gc.ts`（98 行）**产品引者 0**，却被 3 个测试当护栏（删除域假护栏，v4 收口漏删）；
- 并发常量 12 两份字面量 + 两份夹取（`s3v3Engine.ts:36,208` / `quickPush/pipeline.ts:52,219`）；
- `native.ts` 是 IPC「第四面」不在 parity 测试内（漏改只在运行时报"不是函数"）；
- 同一 `contentHash` 两个算法入口（`noteBodyHash` vs `sha256Sync`）；注释反向漂移（`settingsRepository:65` 说"退回明文"，实现已 fail-closed）；
- 死 env 开关（`LAKE_SYNC_PROTOCOL=legacy` / `LAKE_S3V3_QUICK_NOTES=0` 指向已删除的旧通道）；深清 keep 集 N+1（仅手动/定时）。
**方案**：R0 做 ①删 `s3v3Gc` + 6 处测试调用点；②`core/s3v3/limits.ts` 单源；③`native.ts` 第四面 parity；④`noteBodyHash` 委托 core；⑤删死 env 开关/改注释；⑥`RESILIENCE.md` 失败面补登记。R1 做 `quickNotes.ts`/`webApiServer.ts` 拆分；R2 做 `main.ts` IPC 装配与 `s3v3Engine` 发布/深清抽离。
**明确不改**：S3 协议与数值 12；`'' AS content_hash`（配套 bodyChangeGuard）；小记"先 DB 后 promote"；墓碑水线"尝试推进"语义；C2–C5 兼容分支（删除判据不成立）；`deviceConformance.ts` 等测试支撑文件不改名（只登记口径）。

### K. 公共函数 / 方法抽提清单（按"是否值得做"排序）

> 判定：抽提的收益必须 ≥ 维护成本；跨端共享只限**纯逻辑**（无 DOM/无样式/无宿主 API）。以下 14 项来自六份报告的交叉去重。

| # | 重复/分散点 | 证据 | 目标 | 优先级 | 备注 |
| --- | --- | --- | --- | --- | --- |
| K1 | 剪贴板写入无公共 helper：桌面 10 个写点、3 处无 `.catch`、5 处各写"已复制"反馈 | `QuickNotesWorkspace:668`、`SettingsPanel:557/567` 等 | `lib/clipboard.ts`（`copyText(): Promise<boolean>`）+ `useCopiedFlag` | R0 最小版（补 3 处 catch）/ R1 完整 | 富格式管线（`blockCopyBridge`/`aiLakeClipboard`）**不并入** |
| K2 | 日期时间绕开单一来源 `core/dateFormat`：桌面 7 处 + 移动至少 1 处 | `SearchPanel:31`、`AssetsBrowser:544/579`、`DiaryWorkspace:92`、`DraftRecoveryDialog:27`、`RebuildDataBlock:34`、`SettingsPanel:554`（连 locale 都没给）、`tablePasteGuard:104`；`MobileUsheetViewer:504`（推断） | 全部换 helper；加 lint 式测试禁止 `toLocale*String` | R0（零风险） | 不加新 helper；`lib/formatTime` 可并入 core（字符串入参），非必须 |
| K3 | S3 并发常量 12 两份字面量 + 两份夹取 | `s3v3Engine.ts:36,208` / `quickPush/pipeline.ts:52,219` | `core/s3v3/limits.ts`（12 / 32 / clamp） | R0 | 零行为变化；AGENTS §3#13 单源 |
| K4 | 正文 hash 两个算法入口 | `electron/noteBodyHash.ts:8`（node:crypto）vs `core/sha256Sync.ts:29`（+ native 注入） | `noteBodyHash` 委托 `sha256Hex` | R1 | 输出当前逐字节相同；防未来规范化漂移 |
| K5 | `runPool` 两份 | `core/s3v3Pool.ts:25` vs `features/bitable/useAiFieldGeneration.ts:40` | `core/asyncPool.ts`（去 S3 化）并复用 | R2 | 15 行级工具；收益一般 |
| K6 | 预览图片来源 4 套 | 见 A3 证据 | `features/preview/previewAsset.ts` | R1（随 A3） | 与 A3 同一件事 |
| K7 | tap 单击/双击判定 2 份（参数已漂移 300 vs 320） | `imagePreview.ts:128-132` vs `HomePage:1154,1214-1235` | `lib/tapWindow.ts` | R1（设备验证） | 见 A4 |
| K8 | 长按第 3 份实现 | `lib/longPressTimer.ts` 声明唯一；`InkPagesPanel:121-172` 自写 300ms/8px/吞 click | 改用 `createLongPressTimer` | R0（小） | 行为不变；补 2 条渲染测试 |
| K9 | `sleep` 4 份 | `core/retry.ts`、`electron/resourceRepository.ts`、`markdownImportPipeline.ts`、`convertAiMarkdown.ts`（带 signal） | **不合并**（跨层/语义不同） | — | 已在 05 报告论证；不要为整洁强行合并 |
| K10 | `clamp` 2 份 | `core/inkDoc.ts:184`、`features/ink/inkPageImages.ts:101` | 归入 `lib/math.ts` 或 core 工具 | R2 | 4 行；顺手 |
| K11 | 体积格式化 3 种（`formatBytes` / `formatBytesCompact` / `formatFileSize`） | `lib/formatBytes.ts`、`core/fileCard.ts:197` | 合并到 `lib/formatBytes.ts` 三个导出（**语义不合并**） | R2 | 三种口径不同，别改格式 |
| K12 | `NoteKind` 字面量私抄 15 文件 | 06 报告 §1.3 清单 | 全部 `import type { NoteKind }` | R0 | 零行为；`tsc` 即证明 |
| K13 | `AI_DIALOG_GAP` 常量让 editor 依赖 ai 组件 | `SelectionToolbar:30` | 搬到 `features/ai/aiLayout.ts` | R0（1 行） | 消除"editor→ai 组件"假耦合 |
| K14 | IPC 第四面 `native.ts` 无 parity | `src/lib/native.ts:426-...` | `ipcChannelParity.test.ts` 增提取器 | R0 | 防 261016 同类事故 |
| K15 | 标签聚合两端 | `core/tagAggregate` + 移动薄扩展 | **已共享，不重复抽** | — | 记录为正面事实 |
| K16 | 其它已单一来源 | `fileKindOf`/`AttachmentChipList`/`nodeIcons`/`colorPalette`/`settingsSearch` 等 | **不动** | — | 防止重复审计 |

### L. 模块划分、分层与分包

**L1 归属判据（建议写进 `ARCHITECTURE.md`，避免下次再问）**

| 内容 | 归属 |
| --- | --- |
| 跨端纯逻辑（数据/协议/规则/算法） | `src/core/**`（禁 node/DOM/宿主） |
| 一级空间工作区（知识库/小记/日记/AI 写作/标签） | `src/features/<域>/<域>Workspace.tsx`（**小记为例外，见 L3**） |
| shell 级常驻面板（目录树/搜索/回收站/资源/设置） | `src/components/app/` |
| 跨域纯决策（可单测、无 JSX） | `src/components/model/` |
| 跨域可视原语（Overlay/Dialog/Menu/Input…） | `src/components/ui/` |
| 横切能力（预览策略/只读状态/空间矩阵/资产档位） | `src/core/capabilities/` + `src/features/preview/`（新增） |
| 移动端一切 UI/原语/端口 | `src/mobile/**`（不 import 桌面样式/组件） |

**L2 巨型文件拆分（纯搬移、零行为变化；按收益/风险排序）**

| 顺序 | 文件 | 目标形态 | 批次 | 护栏 |
| --- | --- | --- | --- | --- |
| 1 | `core/bitableDoc.ts` 2,419 | 8 模块（types/values/filter/fill/sortGroup/views/relations/ai）+ index re-export | R1 | 1,502 行现有测试原样跑绿 + "导出符号表不变"断言 |
| 2 | `features/bitable/BitableEditor.tsx` 2,111 | 容器 + 6 hook（tables/views/fields/records/import/chrome）+ 已独立的 FieldEditorModal | R1 | 行为测试 + `check:bitablesnap` 3 态 |
| 3 | `electron/quickNotes.ts` 1,451 | 8 模块（schema/staging/savePipeline/trash/search/tagLinks/missingBody/index 门面） | R1 | 小记全测 + `quickPush*`；**保住 DB→promote 顺序不变量** |
| 4 | `electron/webApiServer.ts` 988 | security/static/events/bridge/index | R1（先 security，零行为） | `webApiServer.test` + `ipcChannelParity` |
| 5 | `components/app/QuickNotesWorkspace.tsx` 1,317 | 3 hook + 2 展示组件 | R1 | quickNotes render/syncGate/pushPriority/prewarm |
| 6 | `components/app/Sidebar.tsx` 1,857 | 7 个内部组件外搬（先做 TreeRenameDialog 复用核对） | R2 | sidebar 相关测试；TreeRowFace 延后（memo 边界） |
| 7 | `components/app/SettingsPanel.tsx` 1,447 | 按设置分组抽 sections | R2 | **必须同步 `settingsSearch.ts` 的 `SETTING_ITEMS`** |
| 8 | `features/editor/lakeRuntime.ts` 1,699 | 实例化骨架 + 6 内核补丁模块 | R2 | 内核 lazy 边界 + 首屏预算；`DECL_CACHE` 保持进程级共享 |
| 9 | `features/ink/InkPad.tsx` 1,907 | 组合根 + 4 hook + 2 子组件 | R2 | **先补"落笔→防抖→保存"纯逻辑测试**（当前只有源码文本断言），否则不拆 |
| 10 | `electron/main.ts` 1,306 | 只抽 boot/paths + boot/ipcWiring | R2 | 单例显式传递；启动烟测 |
| 11 | `App.tsx` 1,445 / `store.ts` 2,108 | **不拆**（已是编排层/门面） | — | 记录为"不做" |

**L3 目录例外**：小记工作区在 `components/app` 而其它四个空间在 `features/`。建议**不搬**（git blame / import 改动 / 收益仅导航一致），只在 ARCHITECTURE 写成判据（U-2）。
**L4 `core` 扁平 100+ 文件**：不批量移动（会污染 blame 与 import）；只要求**新增模块**按域进子目录（`core/capabilities`、以后的 `core/ai/`）。
**L5 分包/懒加载**：保持现有边界（桌面内核 5 个 lazy 边界 + `kernelPrefetch`；移动 3 个 lazy + 若干视图 lazy）。新增能力层必须是纯逻辑/按需 import，**禁止从 `App.tsx`/`main.tsx` 静态 import 内核相关模块**；AGENTS 里"5 个 lazy 边界"的数字按实际更新（≥7，指向 `desktopKernelLazy.test.ts`）。

### M. 前端样式（桌面 + 移动）

**M1 桌面（R0/R1，零视觉变化为主）**
1. **删除 58 条被上层压死的 legacy 声明（25 条取值相反）**：涉及 `styles/app/dialogs.css`、`shell.css`、`tabs.css`、`document-status.css`、`quick-notes.css`；**只删 legacy 侧，不动胜者**（胜者已在 `overlay.css`/`kit.css`/`chrome.css`）。删完下调 `ui-metrics` 的 `crossFileDupGroups` 与 `cssLayers.test.ts` 逐文件 decls 基线。
2. **新增 `shadowedDecls` 门禁**（`ui-metrics.mjs` 内，~40 行，基线 25 只降）：把"往 legacy 再写一条会被压掉的规则"变成机器可拦——这是本轮样式问题的**根因护栏**。
3. **删 `.ln-modal*` / `.ln-drawer*`**（kit 269-287，0 消费者，与 `overlay.css` 的 `.ln-dialog` 同语义两套；261006 已按同判据删过 `.ln-toast`）；同步 `cssLayers` kit 基线。
4. **`.ln-row2`**：二选一——改名 `.ln-row--dense`（4 个面板 + 测试）或只在 DESIGN §Rows 登记两档（推荐后者，零风险；Q-11）。
5. **不做的**：不统一三套 toast（三种语义）、不改 legacy 菜单 JSX 类名（已由 kit 一份规则收编）、不清理 58 处内联样式（shadow 树例外 + 动态几何）、不清理 kit 设计词表、不新增依赖。
6. **装置债**：桌面 42 态 `check:stylesnap` 连续多批未跑（本机无夹具缓存）；发布前需在有夹具机器补跑（Q-13）。

**M2 移动（R1，需设备门禁）**
1. **`mobile.css`（1,390 行）域归位**：把 bitable（`:1049-1304`，约 250 行）、board（`:839-874`）、`med-*`（`:1256`）分别搬回 `bitable/mobileBitable.css`、`board/board.css`、`editor/editor-dock.css`；同步 `mobileLayers.test.ts` 基线（总数守恒）。**只搬不写**，搬完跑受影响 2–3 态；若级联结果变化，优先保持选择器特异性、**不许用 `!important` 压**。
2. 修 `--mb-radius-xl` 悬空（`mobile.css:520`，全仓 0 定义 ⇒ 多选操作条圆角失效为 0）；改 `var(--lake-radius-xl)` 或补定义。
3. `mobile.html` 双 `theme-color`（`:6` vs `:11`）+ 内联首帧底色 + `capacitor.config.ts` 三处同源化；`MOBILE-DESIGN` backlog 数字更新（HomePage 1112→1312 等）。
4. **不做**：移动端 `@layer` 渐进迁移（独立项目）、重写 `mobile.css`、跨端合并。

**M3 令牌**：桌面/移动令牌体系均无缺口（未定义 0、颜色字面量 0）；只建议给"品牌固定色"（`--lake-ai-icon-*` 等）加一行"深色不覆盖，有意"注释。不新增令牌机制。

### N. 移动端与 Android 原生层

| 项 | 内容 | 优先级 |
| --- | --- | --- |
| N1 | **资产路径校验单一来源**：`AssetSyncPlugin.kt:29-45` 与 `AssetServer.kt:174-190` 两套 canonical 前缀校验（允许集合不一致）→ 抽 `AssetPaths.kt`（READ/WRITE 模式 + staging 显式参数）+ 6 条对抗单测（`..`/URL 编码/symlink/前缀绕过/超长/空段） | R0/R1（需 `gradlew test`；不改变对外行为） |
| N2 | **Keystore 双实现**：`SecureStorePlugin.kt` 与 `SecretBox.kt` 同一套 AES-GCM；文档称"单一实现"与代码不符 → 让 SecureStore 内部改用 SecretBox（alias/prefs 不变 ⇒ 已存密钥不受影响），真机 smoke | R1 |
| N3 | Kotlin 高危路径测试：`UpdatePlugin`（sha256/证书/安装）、`PortablePackagePlugin`（zip 解压/回滚）、`BodyStorePlugin`（原子写/gzip）只补**纯函数/路径级**测试，不为覆盖率写假测试 | R1 |
| N4 | 注释/注册点漂移：`lakeNativeContract.ts:6-7` 计数（71/47 vs 实际 67/68）、`OpenFile` 在 `bridge/assets.ts:19` 与 `editor/DocumentEditor.tsx:36` 各注册一次、`MOBILE-AI.md` 的 SecretBox 声明 | R0（注释/去重） |
| N5 | `native/` 目录职责混装（端口+启动编排+缓存清理）：只加 6 行目录说明，**不拆目录** | R1（文档） |
| N6 | 平板 10 态/23 屏/键盘不变量：保持设备门禁；不新增自动迁移 | 持续 |
| N7 | `ARCHITECTURE.md` 对移动端只字未提 → 重写时补一节"移动架构索引"（指向 `MOBILE-TECH-STACK`/`MOBILE-OPS`） | R0（与 O 合并） |

### O. 清理与"不为历史数据写兼容"审查

**O1 仓库卫生（R0）**
- `.gitignore:28-31` 删除三行 + 改注释（内核已 vendored；`git check-ignore --no-index` 复现"升级新增文件被静默忽略"）。
- 21 个 tracked 文件含 `/Users/admin/`：**脚本侧必须改**（`scripts/multi-end-sync/*.mjs` 的 `createRequire` 在他人机器必崩）；文档侧替换为示例路径。
- `ARCHITECTURE §4.5` 删除真实账号下 5 个桶名（保留示例配置）。
- `.DS_Store` 未入库（本机清理即可）；`dist*` 均 ignored。

**O2 死文件/死脚本（R0，先 grep 复核再删）**
- 代码：`src/core/s3v3Gc.ts`（0 产品引者）+ 其 6 处测试调用点；`TagPreviewBody` 不可达分支；23 个零引用导出（可选，顺手删）。
- 脚本：148 个中 **23 个零引用**（11 个是 CSS 棘轮一次性 applier；`s3v3-verify.mjs` 引用的文件已不存在；`make-large-notes.mjs` 自述一次性…）。⚠️ **不要误删** `scripts/css-audit/audit-dead-css.test.ts`、`scripts/mobile-audit/snap-gate.test.ts`（vitest 收集）。
- 文档：`docs/INK-DEVICE-CHECK.md`（0 引用）。

**O3 文档去留（R0/R1）**
- 应删 1：INK-DEVICE-CHECK；应归档/合并 6：MOBILE-BITABLE-DINGTALK / MOBILE-USHEET-YUQUE-PARITY / MOBILE-LONG-DOC-PROBE / MOBILE-EMPTY-CATCH-LEDGER / LAKE-CONTENT-WRITING / PAD-ADAPTATION（压成结论+指针）；需重写 2：ARCHITECTURE、STORAGE-LAYERS；需压缩 2：HANDOFF（§0 占 83%）、LAKEX-CONTRACT（269KB，加目录/分卷）；需回填 5：MOBILE-AI / TAG-SYSTEM-DESIGN / TROUBLESHOOTING（旧编号）/ SYNC-DEVICE-CONTRACT / README（RELEASE-NOTES 区间）。
- HANDOFF 压缩：§0 只留最近 3 批（≤15KB），全文 ≤40KB；§1/§2/§3 保留但只写当前值。
- README 文档表与 HANDOFF §1 文档地图**合并为单一来源**（现在两份不一致）。
- `audit-261027/` 4 篇：AGENTS §2"审计直接删" vs HANDOFF"有引用保留"冲突 → 建议先消除 5 处代码 + 4 处文档引用（结论搬进 RESILIENCE/SYNC-PROTOCOL），再整目录删（Q-16）。
- 可选：`CONTRIBUTING.md` / `SECURITY.md`（开源惯例；不作为阻塞）。

**O4 历史兼容代码审查（AGENTS §3#7 逐条结论）**
| 项 | 结论 |
| --- | --- |
| `intentLogState` v1/v2→v3 迁移 | **保留**（设备同步账本承载"删除意图"，重置会让已删文档复活；"能删了重建"在此不成立）。补一行注释说明为什么是例外（07 报告 C2） |
| 死 env 开关 `LAKE_SYNC_PROTOCOL=legacy` / `LAKE_S3V3_QUICK_NOTES=0` | **删**（旧通道实现已不存在；当前效果只是"小记这一轮不同步"，注释误导） |
| `boardDoc` 双键名、`bitableDoc` 历史 ISO 值 | **保留**（用户正文不可再生；属"读兼容"，写恒用新键） |
| `noteKind` 未知→doc | **保留**（跨端安全阀；只补"读路径回退、写路径禁止猜"注释） |
| 标签 `deleted_at` 一次性迁移 | **保留**（AGENTS §4 明确要求；确认只跑一次） |
| `deviceConformance` "旧 API 保留兼容"、移动 `legacyBodies` 命名 | **改名/改注释**（纯命名，消 grep 假阳性） |
| 其余（C2/C3/C5/C6/C8/C11） | 保留，删除判据不成立 |
**结论**：本仓**没有**需要成批删除的"历史数据兼容"代码；唯一实质删除项是死 env 开关，其余是注释/命名。这条要写进开源后的贡献指南（避免外部 PR 引入兼容层）。

### P. 使用说明更新与"独特使用技巧"

**P1 README（R0）**：文档表与 HANDOFF 合并；RELEASE-NOTES 区间改 v1.1.0→v1.0.0；补"5 个一级空间（⌘1–5）"一行；补"换机两条路：便携包 / S3"；`.gitignore` 修复后删掉相关解释。

### K. 公共函数 / 方法抽提清单（按"是否值得做"排序）

> 判定：抽提的收益必须 ≥ 维护成本；跨端共享只限**纯逻辑**（无 DOM/无样式/无宿主 API）。以下 14 项来自六份报告的交叉去重。

| # | 重复/分散点 | 证据 | 目标 | 优先级 | 备注 |
| --- | --- | --- | --- | --- | --- |
| K1 | 剪贴板写入无公共 helper：桌面 10 个写点、3 处无 `.catch`、5 处各写"已复制"反馈 | `QuickNotesWorkspace:668`、`SettingsPanel:557/567` 等 | `lib/clipboard.ts`（`copyText(): Promise<boolean>`）+ `useCopiedFlag` | R0 最小版（补 3 处 catch）/ R1 完整 | 富格式管线（`blockCopyBridge`/`aiLakeClipboard`）**不并入** |
| K2 | 日期时间绕开单一来源 `core/dateFormat`：桌面 7 处 + 移动至少 1 处 | `SearchPanel:31`、`AssetsBrowser:544/579`、`DiaryWorkspace:92`、`DraftRecoveryDialog:27`、`RebuildDataBlock:34`、`SettingsPanel:554`（连 locale 都没给）、`tablePasteGuard:104`；`MobileUsheetViewer:504`（推断） | 全部换 helper；加 lint 式测试禁止 `toLocale*String` | R0（零风险） | 不加新 helper；`lib/formatTime` 可并入 core（字符串入参），非必须 |
| K3 | S3 并发常量 12 两份字面量 + 两份夹取 | `s3v3Engine.ts:36,208` / `quickPush/pipeline.ts:52,219` | `core/s3v3/limits.ts`（12 / 32 / clamp） | R0 | 零行为变化；AGENTS §3#13 单源 |
| K4 | 正文 hash 两个算法入口 | `electron/noteBodyHash.ts:8`（node:crypto）vs `core/sha256Sync.ts:29`（+ native 注入） | `noteBodyHash` 委托 `sha256Hex` | R1 | 输出当前逐字节相同；防未来规范化漂移 |
| K5 | `runPool` 两份 | `core/s3v3Pool.ts:25` vs `features/bitable/useAiFieldGeneration.ts:40` | `core/asyncPool.ts`（去 S3 化）并复用 | R2 | 15 行级工具；收益一般 |
| K6 | 预览图片来源 4 套 | 见 A3 证据 | `features/preview/previewAsset.ts` | R1（随 A3） | 与 A3 同一件事 |
| K7 | tap 单击/双击判定 2 份（参数已漂移 300 vs 320） | `imagePreview.ts:128-132` vs `HomePage:1154,1214-1235` | `lib/tapWindow.ts` | R1（设备验证） | 见 A4 |
| K8 | 长按第 3 份实现 | `lib/longPressTimer.ts` 声明唯一；`InkPagesPanel:121-172` 自写 300ms/8px/吞 click | 改用 `createLongPressTimer` | R0（小） | 行为不变；补 2 条渲染测试 |
| K9 | `sleep` 4 份 | `core/retry.ts`、`electron/resourceRepository.ts`、`markdownImportPipeline.ts`、`convertAiMarkdown.ts`（带 signal） | **不合并**（跨层/语义不同） | — | 已在 05 报告论证；不要为整洁强行合并 |
| K10 | `clamp` 2 份 | `core/inkDoc.ts:184`、`features/ink/inkPageImages.ts:101` | 归入 `lib/math.ts` 或 core 工具 | R2 | 4 行；顺手 |
| K11 | 体积格式化 3 种（`formatBytes` / `formatBytesCompact` / `formatFileSize`） | `lib/formatBytes.ts`、`core/fileCard.ts:197` | 合并到 `lib/formatBytes.ts` 三个导出（**语义不合并**） | R2 | 三种口径不同，别改格式 |
| K12 | `NoteKind` 字面量私抄 15 文件 | 06 报告 §1.3 清单 | 全部 `import type { NoteKind }` | R0 | 零行为；`tsc` 即证明 |
| K13 | `AI_DIALOG_GAP` 常量让 editor 依赖 ai 组件 | `SelectionToolbar:30` | 搬到 `features/ai/aiLayout.ts` | R0（1 行） | 消除"editor→ai 组件"假耦合 |
| K14 | IPC 第四面 `native.ts` 无 parity | `src/lib/native.ts:426-...` | `ipcChannelParity.test.ts` 增提取器 | R0 | 防 261016 同类事故 |
| K15 | 标签聚合两端 | `core/tagAggregate` + 移动薄扩展 | **已共享，不重复抽** | — | 记录为正面事实 |
| K16 | 其它已单一来源 | `fileKindOf`/`AttachmentChipList`/`nodeIcons`/`colorPalette`/`settingsSearch` 等 | **不动** | — | 防止重复审计 |

### L. 模块划分、分层与分包

**L1 归属判据（建议写进 `ARCHITECTURE.md`，避免下次再问）**

| 内容 | 归属 |
| --- | --- |
| 跨端纯逻辑（数据/协议/规则/算法） | `src/core/**`（禁 node/DOM/宿主） |
| 一级空间工作区（知识库/小记/日记/AI 写作/标签） | `src/features/<域>/<域>Workspace.tsx`（**小记为例外，见 L3**） |
| shell 级常驻面板（目录树/搜索/回收站/资源/设置） | `src/components/app/` |
| 跨域纯决策（可单测、无 JSX） | `src/components/model/` |
| 跨域可视原语（Overlay/Dialog/Menu/Input…） | `src/components/ui/` |
| 横切能力（预览策略/只读状态/空间矩阵/资产档位） | `src/core/capabilities/` + `src/features/preview/`（新增） |
| 移动端一切 UI/原语/端口 | `src/mobile/**`（不 import 桌面样式/组件） |

**L2 巨型文件拆分（纯搬移、零行为变化；按收益/风险排序）**

| 顺序 | 文件 | 目标形态 | 批次 | 护栏 |
| --- | --- | --- | --- | --- |
| 1 | `core/bitableDoc.ts` 2,419 | 8 模块（types/values/filter/fill/sortGroup/views/relations/ai）+ index re-export | R1 | 1,502 行现有测试原样跑绿 + "导出符号表不变"断言 |
| 2 | `features/bitable/BitableEditor.tsx` 2,111 | 容器 + 6 hook（tables/views/fields/records/import/chrome）+ 已独立的 FieldEditorModal | R1 | 行为测试 + `check:bitablesnap` 3 态 |
| 3 | `electron/quickNotes.ts` 1,451 | 8 模块（schema/staging/savePipeline/trash/search/tagLinks/missingBody/index 门面） | R1 | 小记全测 + `quickPush*`；**保住 DB→promote 顺序不变量** |
| 4 | `electron/webApiServer.ts` 988 | security/static/events/bridge/index | R1（先 security，零行为） | `webApiServer.test` + `ipcChannelParity` |
| 5 | `components/app/QuickNotesWorkspace.tsx` 1,317 | 3 hook + 2 展示组件 | R1 | quickNotes render/syncGate/pushPriority/prewarm |
| 6 | `components/app/Sidebar.tsx` 1,857 | 7 个内部组件外搬（先做 TreeRenameDialog 复用核对） | R2 | sidebar 相关测试；TreeRowFace 延后（memo 边界） |
| 7 | `components/app/SettingsPanel.tsx` 1,447 | 按设置分组抽 sections | R2 | **必须同步 `settingsSearch.ts` 的 `SETTING_ITEMS`** |
| 8 | `features/editor/lakeRuntime.ts` 1,699 | 实例化骨架 + 6 内核补丁模块 | R2 | 内核 lazy 边界 + 首屏预算；`DECL_CACHE` 保持进程级共享 |
| 9 | `features/ink/InkPad.tsx` 1,907 | 组合根 + 4 hook + 2 子组件 | R2 | **先补"落笔→防抖→保存"纯逻辑测试**（当前只有源码文本断言），否则不拆 |
| 10 | `electron/main.ts` 1,306 | 只抽 boot/paths + boot/ipcWiring | R2 | 单例显式传递；启动烟测 |
| 11 | `App.tsx` 1,445 / `store.ts` 2,108 | **不拆**（已是编排层/门面） | — | 记录为"不做" |

**L3 目录例外**：小记工作区在 `components/app` 而其它四个空间在 `features/`。建议**不搬**（git blame / import 改动 / 收益仅导航一致），只在 ARCHITECTURE 写成判据（U-2）。
**L4 `core` 扁平 100+ 文件**：不批量移动（会污染 blame 与 import）；只要求**新增模块**按域进子目录（`core/capabilities`、以后的 `core/ai/`）。
**L5 分包/懒加载**：保持现有边界（桌面内核 5 个 lazy 边界 + `kernelPrefetch`；移动 3 个 lazy + 若干视图 lazy）。新增能力层必须是纯逻辑/按需 import，**禁止从 `App.tsx`/`main.tsx` 静态 import 内核相关模块**；AGENTS 里"5 个 lazy 边界"的数字按实际更新（≥7，指向 `desktopKernelLazy.test.ts`）。

### M. 前端样式（桌面 + 移动）

**M1 桌面（R0/R1，零视觉变化为主）**
1. **删除 58 条被上层压死的 legacy 声明（25 条取值相反）**：涉及 `styles/app/dialogs.css`、`shell.css`、`tabs.css`、`document-status.css`、`quick-notes.css`；**只删 legacy 侧，不动胜者**（胜者已在 `overlay.css`/`kit.css`/`chrome.css`）。删完下调 `ui-metrics` 的 `crossFileDupGroups` 与 `cssLayers.test.ts` 逐文件 decls 基线。
2. **新增 `shadowedDecls` 门禁**（`ui-metrics.mjs` 内，~40 行，基线 25 只降）：把"往 legacy 再写一条会被压掉的规则"变成机器可拦——这是本轮样式问题的**根因护栏**。
3. **删 `.ln-modal*` / `.ln-drawer*`**（kit 269-287，0 消费者，与 `overlay.css` 的 `.ln-dialog` 同语义两套；261006 已按同判据删过 `.ln-toast`）；同步 `cssLayers` kit 基线。
4. **`.ln-row2`**：二选一——改名 `.ln-row--dense`（4 个面板 + 测试）或只在 DESIGN §Rows 登记两档（推荐后者，零风险；Q-11）。
5. **不做的**：不统一三套 toast（三种语义）、不改 legacy 菜单 JSX 类名（已由 kit 一份规则收编）、不清理 58 处内联样式（shadow 树例外 + 动态几何）、不清理 kit 设计词表、不新增依赖。
6. **装置债**：桌面 42 态 `check:stylesnap` 连续多批未跑（本机无夹具缓存）；发布前需在有夹具机器补跑（Q-13）。

**M2 移动（R1，需设备门禁）**
1. **`mobile.css`（1,390 行）域归位**：把 bitable（`:1049-1304`，约 250 行）、board（`:839-874`）、`med-*`（`:1256`）分别搬回 `bitable/mobileBitable.css`、`board/board.css`、`editor/editor-dock.css`；同步 `mobileLayers.test.ts` 基线（总数守恒）。**只搬不写**，搬完跑受影响 2–3 态；若级联结果变化，优先保持选择器特异性、**不许用 `!important` 压**。
2. 修 `--mb-radius-xl` 悬空（`mobile.css:520`，全仓 0 定义 ⇒ 多选操作条圆角失效为 0）；改 `var(--lake-radius-xl)` 或补定义。
3. `mobile.html` 双 `theme-color`（`:6` vs `:11`）+ 内联首帧底色 + `capacitor.config.ts` 三处同源化；`MOBILE-DESIGN` backlog 数字更新（HomePage 1112→1312 等）。
4. **不做**：移动端 `@layer` 渐进迁移（独立项目）、重写 `mobile.css`、跨端合并。

**M3 令牌**：桌面/移动令牌体系均无缺口（未定义 0、颜色字面量 0）；只建议给"品牌固定色"（`--lake-ai-icon-*` 等）加一行"深色不覆盖，有意"注释。不新增令牌机制。

### N. 移动端与 Android 原生层

| 项 | 内容 | 优先级 |
| --- | --- | --- |
| N1 | **资产路径校验单一来源**：`AssetSyncPlugin.kt:29-45` 与 `AssetServer.kt:174-190` 两套 canonical 前缀校验（允许集合不一致）→ 抽 `AssetPaths.kt`（READ/WRITE 模式 + staging 显式参数）+ 6 条对抗单测（`..`/URL 编码/symlink/前缀绕过/超长/空段） | R0/R1（需 `gradlew test`；不改变对外行为） |
| N2 | **Keystore 双实现**：`SecureStorePlugin.kt` 与 `SecretBox.kt` 同一套 AES-GCM；文档称"单一实现"与代码不符 → 让 SecureStore 内部改用 SecretBox（alias/prefs 不变 ⇒ 已存密钥不受影响），真机 smoke | R1 |
| N3 | Kotlin 高危路径测试：`UpdatePlugin`（sha256/证书/安装）、`PortablePackagePlugin`（zip 解压/回滚）、`BodyStorePlugin`（原子写/gzip）只补**纯函数/路径级**测试，不为覆盖率写假测试 | R1 |
| N4 | 注释/注册点漂移：`lakeNativeContract.ts:6-7` 计数（71/47 vs 实际 67/68）、`OpenFile` 在 `bridge/assets.ts:19` 与 `editor/DocumentEditor.tsx:36` 各注册一次、`MOBILE-AI.md` 的 SecretBox 声明 | R0（注释/去重） |
| N5 | `native/` 目录职责混装（端口+启动编排+缓存清理）：只加 6 行目录说明，**不拆目录** | R1（文档） |
| N6 | 平板 10 态/23 屏/键盘不变量：保持设备门禁；不新增自动迁移 | 持续 |
| N7 | `ARCHITECTURE.md` 对移动端只字未提 → 重写时补一节"移动架构索引"（指向 `MOBILE-TECH-STACK`/`MOBILE-OPS`） | R0（与 O 合并） |

### O. 清理与"不为历史数据写兼容"审查

**O1 仓库卫生（R0）**
- `.gitignore:28-31` 删除三行 + 改注释（内核已 vendored；`git check-ignore --no-index` 复现"升级新增文件被静默忽略"）。
- 21 个 tracked 文件含 `/Users/admin/`：**脚本侧必须改**（`scripts/multi-end-sync/*.mjs` 的 `createRequire` 在他人机器必崩）；文档侧替换为示例路径。
- `ARCHITECTURE §4.5` 删除真实账号下 5 个桶名（保留示例配置）。
- `.DS_Store` 未入库（本机清理即可）；`dist*` 均 ignored。

**O2 死文件/死脚本（R0，先 grep 复核再删）**
- 代码：`src/core/s3v3Gc.ts`（0 产品引者）+ 其 6 处测试调用点；`TagPreviewBody` 不可达分支；23 个零引用导出（可选，顺手删）。
- 脚本：148 个中 **23 个零引用**（11 个是 CSS 棘轮一次性 applier；`s3v3-verify.mjs` 引用的文件已不存在；`make-large-notes.mjs` 自述一次性…）。⚠️ **不要误删** `scripts/css-audit/audit-dead-css.test.ts`、`scripts/mobile-audit/snap-gate.test.ts`（vitest 收集）。
- 文档：`docs/INK-DEVICE-CHECK.md`（0 引用）。

**O3 文档去留（R0/R1）**
- 应删 1：INK-DEVICE-CHECK；应归档/合并 6：MOBILE-BITABLE-DINGTALK / MOBILE-USHEET-YUQUE-PARITY / MOBILE-LONG-DOC-PROBE / MOBILE-EMPTY-CATCH-LEDGER / LAKE-CONTENT-WRITING / PAD-ADAPTATION（压成结论+指针）；需重写 2：ARCHITECTURE、STORAGE-LAYERS；需压缩 2：HANDOFF（§0 占 83%）、LAKEX-CONTRACT（269KB，加目录/分卷）；需回填 5：MOBILE-AI / TAG-SYSTEM-DESIGN / TROUBLESHOOTING（旧编号）/ SYNC-DEVICE-CONTRACT / README（RELEASE-NOTES 区间）。
- HANDOFF 压缩：§0 只留最近 3 批（≤15KB），全文 ≤40KB；§1/§2/§3 保留但只写当前值。
- README 文档表与 HANDOFF §1 文档地图**合并为单一来源**（现在两份不一致）。
- `audit-261027/` 4 篇：AGENTS §2"审计直接删" vs HANDOFF"有引用保留"冲突 → 建议先消除 5 处代码 + 4 处文档引用（结论搬进 RESILIENCE/SYNC-PROTOCOL），再整目录删（Q-16）。
- 可选：`CONTRIBUTING.md` / `SECURITY.md`（开源惯例；不作为阻塞）。

**O4 历史兼容代码审查（AGENTS §3#7 逐条结论）**
| 项 | 结论 |
| --- | --- |
| `intentLogState` v1/v2→v3 迁移 | **保留**（设备同步账本承载"删除意图"，重置会让已删文档复活；"能删了重建"在此不成立）。补一行注释说明为什么是例外（07 报告 C2） |
| 死 env 开关 `LAKE_SYNC_PROTOCOL=legacy` / `LAKE_S3V3_QUICK_NOTES=0` | **删**（旧通道实现已不存在；当前效果只是"小记这一轮不同步"，注释误导） |
| `boardDoc` 双键名、`bitableDoc` 历史 ISO 值 | **保留**（用户正文不可再生；属"读兼容"，写恒用新键） |
| `noteKind` 未知→doc | **保留**（跨端安全阀；只补"读路径回退、写路径禁止猜"注释） |
| 标签 `deleted_at` 一次性迁移 | **保留**（AGENTS §4 明确要求；确认只跑一次） |
| `deviceConformance` "旧 API 保留兼容"、移动 `legacyBodies` 命名 | **改名/改注释**（纯命名，消 grep 假阳性） |
| 其余（C2/C3/C5/C6/C8/C11） | 保留，删除判据不成立 |
**结论**：本仓**没有**需要成批删除的"历史数据兼容"代码；唯一实质删除项是死 env 开关，其余是注释/命名。这条要写进开源后的贡献指南（避免外部 PR 引入兼容层）。

### P. 使用说明更新与"独特使用技巧"

**P1 README（R0）**：文档表与 HANDOFF 合并；RELEASE-NOTES 区间改 v1.1.0→v1.0.0；补"5 个一级空间（⌘1–5）"一行；补"换机两条路：便携包 / S3"；`.gitignore` 修复后删掉相关解释。
**P2 guide（R0，最高价值）**
1. **新增 4 章**：`16-diary.md`（日记＝普通文档、⌘3/第 3 格、写今天/翻历史/空间内搜索、转文档、不做标签/不缺天提醒）；`17-ai-writing.md`（⌘4、会话/多文档/提示词库/深度思考、生成文档/保存小记、**会话只存本机不进同步/搜索/目录树**）；`18-portable-and-migrate.md`（便携包 vs S3 vs 迁移码三条换机路、≤4GiB、不含历史、覆盖导入）；`19-update-center.md`（检查/更新日志/自动检查与下载/**不静默安装**/sha256）。
2. **全量纠偏**：7 处「资料库」→「知识库」；"底部胶囊"两种语义分清（首页＝五格 Dock + 中央＋；工作区＝胶囊）；`13-shortcuts` 改 ⌘1 文档 / ⌘2 小记 / ⌘3 日记 / ⌘4 AI 写作 / ⌘5 标签；`12-settings` 补桌面「更新」分类与 Android 更新中心 + 4 个新设置项；`07` 补「保存并同步」单条快路径；`08` 补标签三条定稿；`14-faq` 补便携包。
3. 目录表 15→19 行；平台差异表补 4 行（日记/AI 写作/更新中心/便携包）；截图 P2（可后补）。

**P3 独特使用技巧（15 条，均可直接落 guide；事实依据见 07 报告 §4.3）**

| # | 技巧 | 落点 |
| --- | --- | --- |
| T1 | **换机想省 S3 流量 → 用便携包**：桌面导出 `.zip.lln`（≤4GiB、不含历史），手机覆盖导入，之后 S3 只做增量 | guide 18 |
| T2 | **S3 配置可以"拷"给手机**：桌面导出配置 `.json` → 手机导入；内层 `LLN1.` 迁移码仅防误读、**不是安全边界** | guide 11/18 |
| T3 | **移动端图片默认 1024 缩略**（列表/标签/内嵌图），原图只在放大时取 → 流量紧张可开"按需下载附件" | guide 11/07 |
| T4 | **复制含图片到微信不会裂**：复制时本地图同步换成原图 data URI（webp/avif→PNG） | guide 03 |
| T5 | **看图画廊是整篇文档的图**（按正文顺序，不按 DOM）；手机单击预览、双击编辑 | guide 03 |
| T6 | **回收站不是删除**：软删（正文/附件保留）默认 90 天；「云端已删除·仅本地」副本可恢复 | guide 09 |
| T7 | **标签顺序只属于这台设备**（集合会同步、顺序不会）；标签删除＝云端不留墓碑，同步一次即消失 | guide 08 |
| T8 | **小记「保存并同步」是单条快路径**（11 请求；内容未变 0 上传 0 发布）；只想留本地点「保存」 | guide 07 |
| T9 | **手机速记两级**：＋ 短按＝新建面板；长按 260ms + 上滑＝全屏速记写作卡 | guide 07 |
| T10 | **日记是普通文档**：历史/回收站/搜索/导出/同步全部免费继承；"转为文档"＝移到别的笔记本，正文与历史跟着走 | guide 16 |
| T11 | **AI 写作会话只存本机**（不进同步/搜索/目录树）；"生成文档"落笔记本、"保存到小记"落小记 | guide 17 |
| T12 | **浏览器端当分屏阅读器**：设置 → 浏览器端（默认关），只服务本机 `127.0.0.1` 同一份数据 | guide 12 |
| T13 | **更新中心不静默安装**：自动检查/下载（Android 仅 Wi-Fi）后仍需你点安装；下载校验 sha256 | guide 19 |
| T14 | **数据不对劲先跑三个自愈入口**：一致性检查 / 重建全文搜索索引 / 重建数据；坏库走「从云端恢复」 | guide 14 |
| T15 | **删除压编辑是设计**：被删侧留历史快照，他端以"云端缺席"判定不再上传；从未持有过的设备无法恢复 | guide 09 |

### Q. 门禁 / 护栏新增（全部静态或单测，零新依赖）

| # | 护栏 | 拦什么 | 成本 |
| --- | --- | --- | --- |
| Q1 | `shadowedDecls`（ui-metrics 内，基线 25 只降） | 往 legacy 写会被上层压掉的声明 | ~40 行 |
| Q2 | `noteKindTouchpoints.test.ts`（触点清单） | 新增 kind 漏改；kind 字面量私抄 | 半天 |
| Q3 | `ipcChannelParity` 第四面（`src/lib/native.ts`） | 漏改 native 包装 → 运行时"不是函数" | ~20 行 |
| Q4 | `previewPolicy` 常量断言 + `trashPreview.render` | 两端回收站能力漂移 | 小 |
| Q5 | `quickNoteSyncGate` 理由→文案映射 | 同步失败文案说谎 | 小 |
| Q6 | `aiAssistantScope.test` | AI 作用域串台 | 小 |
| Q7 | `inkPagesPanel` 长按+吞 click 断言 | 第三份长按再次分叉 | 小 |
| Q8 | Kotlin `AssetPaths` 6 条对抗单测 | 路径校验分叉成漏洞 | 中 |
| Q9 | 日期格式化 lint（桌面 UI 禁止 `toLocale*String`） | 日期显示随 OS 漂移 | 小 |
| Q10 | `lib/clipboard` 单测（无 API/拒绝/成功） | 未捕获 rejection | 小 |

> 说明：`pr.yml` 未显式跑 `check:mobileui` 但跑了同源 `node scripts/ui-metrics.mjs`（该脚本同时输出桌面+移动指标），**不是缺口**（07 报告 §6.3 的"存疑"在此关闭）。

## 5. 路线图（建议执行顺序）

### R0 · 发布前（3–5 天，只做低风险 + 文档）

| 批次 | 内容 | 依赖 | 必跑门禁 |
| --- | --- | --- | --- |
| R0-1 文档 | guide 4 章 + 纠偏；README/RELEASE-NOTES；ARCHITECTURE 重写；HANDOFF 压缩；STORAGE-LAYERS 重写；文档地图单一来源 | 无 | `git diff --check`；无代码 |
| R0-2 卫生 | `.gitignore` 三行；21 处路径；桶名脱敏；死脚本 23 + INK-DEVICE-CHECK；s3v3Gc；死 env 开关 | 无 | `tsc` + 相关 vitest + `git diff --check` |
| R0-3 零风险纠错 | 小记同步文案（F-04）；AI 作用域（F-03）；K2 日期；K8 长按；K12 kind import；K13 常量；K14 第四面；N4 注释/去重；M2 的 radius/theme-color | 无 | `tsc` + 相关 vitest + `check:core` |
| R0-4 护栏 | Q1/Q2/Q3/Q5/Q6/Q7/Q9 | R0-3 | 新增测试绿 + 全量 vitest |
| R0-5 样式 | M1 删 58 条死声明 + 删 ln-modal/drawer + shadowed gate；M2 `mobile.css` 归位可延后到 R1 | Q1 | `ui-metrics` + `cssLayers` + 受影响快照 |
| R0-6 发布验证 | 桌面 42 态（夹具机）+ 手机/平板 10 态 + 23 屏 + windowsweep + 双 build + 全量 vitest + 预算 | 全部 | AGENTS §3#21 全量 |

### R1 · 开源后第一批（2–3 周）

能力层（A1–A5、B、C、I 矩阵）→ 公共函数（K1/K2 完整/K4/K6/K7）→ 拆分（bitableDoc → BitableEditor → quickNotes → webApiServer → QuickNotesWorkspace → Sidebar/SettingsPanel）→ 移动端（N1/N2/N3、mobile.css 归位）→ 文档第二轮（归档 6、audit-261027、脚本索引）→ 契约层 conformance 套件。

### R2 · 长期

`lakeRuntime`/`InkPad` 拆分、AI 会话模型统一、移动 `@layer` 迁移（独立项目）、性能基线常态化、大库/真机验收、双端契约扩展。

## 6. 需用户裁决（逐项讨论清单）

> 推荐值为我的建议；"发布前"指 R0。讨论时可以按编号逐条拍板，我会据此更新执行批次。

| # | 议题 | 选项 | 推荐 |
| --- | --- | --- | --- |
| Q01 | 预览 Phase 2（两端回收站能力一致）是否发布前做 | A 发布前 / B 发布后第一批 / C 不做 | **B**（要动 `LakeEditor` + 设备门禁；发布前只做 A1 的 hook 与文案/死路径） |
| Q02 | 手机"点开大图"是否取原图 | A 维持 1024 / B 打开后换原图 / C 全部原图 | **B**（与 `MOBILE-DESIGN` 一致；需实测 RSS） |
| Q03 | 移动历史版本是否加快照预览 | A 不做 / B 仅 doc / C 全 kind | **B（下版本）** |
| Q04 | 移动「打开回收站文档」= 拒绝打开（toast）是否定稿 | A 维持并登记 / B 对齐 §3#16 只读+横幅 | **A + 登记为例外** |
| Q05 | 移动回收站预览字号 | A 用户设置 / B 统一预览档 | **B**（与桌面同语义，移动用自己的档值） |
| Q06 | 桌面回收站/历史预览是否加图片放大 | A 不加 / B 加 | **B**（约 30 行 + 1 测试） |
| Q07 | 是否允许 `LakeEditor` 加 `interaction:"preview"` 档 | A 允许 / B 改用 NoteDocPreview（丢能力） | **A**（默认值回退） |
| Q08 | 移动 AI 回答是否上内核视图 | A 维持自研 / B 上内核 | **A**（6.1MB chunk + 每消息实例，撞 §3#17） |
| Q09 | 标签空间 doc 是否内嵌正文 | A 维持"点击打开" / B 内嵌 | **A**（261106 已定稿） |
| Q10 | 状态栏「已同步·历史」颜色 | A 绿色（现状胜者）/ B 主题色 | **A**（删 legacy 副本） |
| Q11 | `.ln-row2` | A 改名收敛 / B 只补 DESIGN | **B**（零风险；改名可延后） |
| Q12 | 桌面 AI 助手会话是否持久化（对齐移动 50 条/30 天） | A 保持内存 / B 持久化 | **B 或明确"不做"并写进文档**（两端不一致会被用户感知） |
| Q13 | 发布前是否补桌面 42 态快照 | A 有夹具机补跑 / B 接受代码级证据 | **A**（HANDOFF §3 已列为 P0） |
| Q14 | 是否加 `shadowedDecls` 门禁 | A 加 / B 不加 | **A** |
| Q15 | `.ln-modal/.ln-drawer` | A 删 / B 保留禁用 | **A**（与 `.ln-toast` 同标准） |
| Q16 | `docs/audit-261027/` 去留 | A 保留并加规则例外 / B 消引用后删 | **B**（先搬结论，再删；成本约 0.5 天） |
| Q17 | HANDOFF 压缩幅度 | A 最近 3 批 / B 最近 10 批 | **A**（≤40KB） |
| Q18 | `.gitignore` 第 28–31 行 | A 删三行 / B 保留改注释 | **A**（B 仍会漏文件） |
| Q19 | 巨型文件拆分是否发布前做 | A 只 bitableDoc+BitableEditor / B 全部推迟 / C 全做 | **B 或 A**（发版前最多做 A 的第 1 项；InkPad/lakeRuntime 必须等护栏） |
| Q20 | `QuickNotesWorkspace` 是否搬进 `features/` | A 搬 / B 不搬写判据 | **B** |
| Q21 | Kotlin `AssetPaths` 是否发布前做 | A 发布前 / B 发布后 | **A（若可跑 gradle test）** 否则 B |
| Q22 | Keystore 统一到 SecretBox | A 改代码 / B 改文档 | **A**（安全代码单一实现；真机 smoke） |
| Q23 | `intentLogState` v1/v2 迁移 | A 保留 / B 删并重置同步状态 | **A**（删除意图不可重建） |
| Q24 | 小记 4 句失败文案定稿（"本机还没有同步基线"是否暴露给用户） | 由用户按语气定 | 需你定稿 |
| Q25 | 是否新增 `CONTRIBUTING/SECURITY` | A 加 / B 不加 | **A**（开源推广前） |
| Q26 | AGENTS "5 个 lazy 边界"数字更新 | A 改数字+指向测试 / B 展开清单 | **A**（预算有限） |
| Q27 | 是否执行 `ARCHITECTURE` 重写 vs 只修索引 | A 重写（推荐）/ B 只修失效路径 | **A**（它已是外部读者第一手事实源） |

## 7. 明确不做（汇总，避免下一轮重复讨论）

1. 不重写编辑器/数据层/同步内核；不引入 DI、ports-adapter、状态管理库、运行期 kind 注册表（收益仅"整洁"，撞 §3#17）。
2. 不合并桌面/移动 UI/CSS/组件；不共享 `ln-*`/`mb-*`。
3. 不清理 vendor/内核（含 9.3MB `lakex.js`、`examples`、双份产物）；不改 4 处依赖补丁。
4. 不为旧数据/旧协议新增兼容层；不删 `intentLogState` 迁移、`boardDoc` 双键名、`bitableDoc` 历史值、`noteKind` 未知→doc（删除判据不成立）。
5. 不重写只读引擎；不接 vendor `previewImgs`；不做"万能 Preview 组件"。
6. 不统一三套 toast（三种语义）；不改 legacy 菜单 JSX 类名；不清理 58 处内联样式（shadow 树例外/动态几何）；不清理 kit 设计词表。
7. 不合并 `sleep` 四份、不合并三种体积格式语义、不为"统一错误码"改 Capacitor reject。
8. 不拆 `native/` 目录、不拆 `store.ts`/`App.tsx`、不批量移动 `core` 扁平文件。
9. 不做移动端 `@layer` 渐进迁移（独立项目）、不重写 `mobile.css`。
10. 不引 Tailwind/shadcn/Motion/dnd-kit/react-resizable-panels/Zustand（AGENTS §3#22 已裁定）；本方案零新依赖。
11. 不做代码生成（preload/native 契约 codegen）——CJS 边界与预算理由已论证。
12. 不为主进程 IO 做无实测证据的分帧优化；不为性能重写架构（测量驱动）。
13. 不逐篇裁剪 `docs/lakexEditor-developer-docs/` 官方镜像；不为 docs 引静态站点。
14. 不评估/升级依赖版本（内核 pin、Univer 只走 playbook）。
15. 不在没有纯逻辑测试前拆 `InkPad`（当前"落笔→防抖→保存"只有源码文本断言）。

## 8. 验证策略与风险

### 8.1 每类改动的门禁（沿用 AGENTS §3#21，不新造）

| 改动 | 必跑 |
| --- | --- |
| 纯 TS/文档/注释 | `npx tsc --noEmit` + 相关 vitest + `git diff --check` |
| 样式（桌面） | 上者 + `node scripts/ui-metrics.mjs` + `cssLayers.test.ts`（+ 受影响态 `check-stylesnap --states`） |
| 样式（移动） | `npm run check:mobileui` + `check:mobilesnap --states <受影响态>` + 交付前 `android-build.sh --sync --install` |
| 内核/首屏相关 | `npm run check:bundle` + `check:arch` + `desktopKernelLazy.test.ts` |
| 同步/拆分 | 该域全测（`quickPush*`/`s3v3*`/`deviceConformance`）+ 失败面回归 |
| 移动手势/几何 | 10 态 + 23 屏 + `edit-surface-invariants` + `capture-entry`（按受影响面） |
| 发版 | 桌面 42 态 + 手机/平板 10 态 + 23 屏 + windowsweep + 双 build + 预算 + 全量 vitest |

### 8.2 风险与缓解

- **发布前改代码越多，回归面越大**：R0 只允许"零行为/纯文档/删死代码/小修"；所有行为改动（预览能力、样式归属搬家）放 R1 并配套设备门禁。
- **拆分打断 blame / 引入静默差异**：每批"纯搬移 + 导出符号不变断言 + 该类目全测"；不夹带功能改动。
- **快照基线漂移**：任何影响外壳几何/夹具的改动先归因再重烤；只在专用 AVD（`lake_gate`/`lake_tab`）跑。
- **文档大改与代码不同步**：R0 文档批与 R0-3 代码批分开提交，文档里不写会过期的计数（或写成"以单一来源为准"）。
- **开源后外部贡献**：把"不做兼容/不引第二样式范式/单一来源"写进 CONTRIBUTING（Q25），并用门禁兜底。

### 8.3 完成判据（Definition of Done）

- R0：`git status` 只含预期改动；tsc 0；全量 vitest 绿（除既知 flaky 按口径）；双 build + 预算绿；guide 新 4 章可读；`.gitignore` 不再忽略已 tracked 内核；死代码/死脚本清零（按清单）；发布验证矩阵通过。
- R1：预览 30 入口能力矩阵统一（A2 策略生效）；内核只读包装 1 个；公共函数清单完成 ≥8 项；拆分 1–3 项完成且护栏齐；桌面 shadowedDecls = 0 或只降；移动 `mobile.css` 归位。
- R2：契约 conformance 套件覆盖 5 个核心域；性能基线可回归；文档单一来源体系稳定。

## 附录 A · 分册证据与复现

- 各分册均含"可复现命令"与 file:line。总入口命令：
```bash
cd /Users/admin/file/local-lake/lakex-local-notes
node scripts/ui-metrics.mjs          # 样式硬指标
node scripts/check-core-boundaries.mjs
node scripts/check-mobile-ui.mjs
node scripts/css-audit/audit-dead-css.mjs
git check-ignore --no-index -v vendor/lakex-doc-react/NEW.js public/vendor/lakex/NEW.svg
rg -n 'planLakeDeletes|planQuickNotesDeletes' src electron | grep -v s3v3Gc.ts   # 期望空
rg -n 'const DEFAULT_TRANSFER_CONCURRENCY' src/core
```

## 附录 B · 未覆盖清单（下一轮接手）

真实 S3 往返 / 2 万文档压测、设备实机观感与内存（含平板预览几何）、`InkPad/BitableEditor/lakeRuntime` 内部逐行正确性、`electron/ai/**` 与 `updateService.ts` 行为细节、便携包 zip 条目级路径校验、`webApiServer` SSE/静态服务逐段、移动端 302 个测试的有效性抽查、`docs/audit-261027` 各篇内容复核。

## 附录 C · 术语与口径

- **R0/R1/R2**：发布前 / 开源后第一批 / 长期。
- **纯搬移**：只移动代码位置、不改导出名与行为；以"导出符号表不变 + 该类目全测"验收。
- **能力层**：只含策略/类型/纯逻辑/薄 hook 的横切层；不含样式、数据获取、组件树。
- **分册编号**：02 预览 / 03 桌面 UI 样式 / 04 移动 / 05 core+electron / 06 特性域 / 07 文档清理。

---

**下一步**：请按 §6 的 Q01–Q27 逐条给结论（或先讨论 Q01–Q09 的能力统一方向）。我按你的裁决把 §5 拆成可执行批次，再进入实施（本轮不写任何产品代码）。

## 附录 D · R0 执行状态（261112，Work in Progress）

> 本批只执行「不需要用户裁决」的项；已本地提交四笔（`996b4d6e` docs / `fab629dc` chore / `8e20a6a3` fix / `40e83260` handoff），**未 push**，等用户验收。

**已完成（全部有门禁证据，见 docs/HANDOFF.md §0 该批）**
- 文档：guide 新增 16/17/18/19 四章 + 全量纠偏；README 文档表收为单一来源入口（指向 HANDOFF §1）；ARCHITECTURE 重写 + STORAGE-LAYERS 按 v3 重写 + TAG/MOBILE-AI/TROUBLESHOOTING/SYNC-DEVICE-CONTRACT/MOBILE-DESIGN 回填；SYNC-PROTOCOL 删 s3v3Gc 死引用；DIARY 修过期口径；HANDOFF 新增批次 + 文档地图 + 基线/风险/待办回写。
- 仓库卫生：.gitignore 三行修复；23 个死脚本 + docs/INK-DEVICE-CHECK.md + src/core/s3v3Gc.ts 删除（含 6 处假护栏断言）；scripts/multi-end-sync/*.mjs 硬编码清零；HANDOFF 真实桶名占位。
- 代码：F-04（4 理由透传 + 两端共用文案）、F-03（AI 作用域 5 宿主 + 单源判据）、K2 日期 7 处 + lint、K8 长按、K12 kind 私抄 14 文件 + 触点护栏、K13 常量单源、K14 IPC 第四面 parity、K1 最小版（3 处已有 catch 复核）、死 env 开关、安全注释。
- 样式/移动：桌面删 35 条被压死声明 + 6 条 kit 死原语（32 声明）；shadowedDecls 门禁（21 只降）；移动 4 小项。

**未做（有意留在 R1 / 等裁决）**
- 审计 §6 的 Q01–Q27 全部未拍板（尤其 Q01 预览 Phase2、Q02 原图、Q03 移动历史预览、Q12 AI 会话持久化、Q16 audit-261027、Q17 HANDOFF 压缩、Q19 拆分范围、Q22 Keystore）。
- 剩余 21 条 shadowed 声明（feature.css 3 / misc.css 4 / 共享规则 14——整条删会误伤生效的兄弟选择器，需重构而非删除）。
- 移动 mobile.css 域归位（约 300 行，需设备 2–3 态）。
- 设备/视觉矩阵：桌面 42 态、手机/平板 10 态、23 屏、windowsweep（本机无夹具/未启动模拟器）。
- 拆分类（L2）全部推迟：bitableDoc/BitableEditor/QuickNotesWorkspace/Sidebar/SettingsPanel/lakeRuntime/InkPad/electron 大文件。

**门禁实测（本批）**：tsc 0；全量 vitest 874 文件 / 5512 passed / 12 skipped / 0 failed；ui-metrics 66/21；check:core 163/0；双 build + bundle/arch PASS（数字见 HANDOFF §0）；git diff --check 0。已本地提交四笔、未 push（HEAD `40e83260`）。
