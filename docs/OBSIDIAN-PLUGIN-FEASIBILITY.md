# Lake Notes → Obsidian 插件化：调研与方案

> **文档目的**：供外部 AI / 顾问评审。自带全部必要上下文，无需访问本仓库其他文件即可理解。
> **状态**：评估阶段，**方向未拍板**。结论倾向"先做 Phase 0 spike 再决定"，最终决策权在项目所有者。
> **日期**：2026-09-06

---

## 0. TL;DR

**项目所有者想做的**：一个"比较好的、可以同步的 Lake（语雀）编辑环境"。当前已实现为独立 Electron 桌面应用 + Capacitor 安卓端，但应用壳越做越重，感觉"跑偏"。

**提案**：改为 **Obsidian 插件**——在 Obsidian 内以插件形式实现 Lake 编辑器的挂载与原生 `.lake` 文件的管理，**不做任何 lake→md 格式转换**，同步沿用自研 S3 同步引擎。

**核心结论**：

1. 技术上可行。桌面端（Electron/Chromium）与 Android 端（Capacitor WebView/Chromium）与现有自建应用**同构**，Lake 编辑器已在这两种环境实测跑通。
2. **iOS 确定性出局**（WKWebView 无法渲染 SVG foreignObject 文字——这正是当年放弃 Tauri 的原因）。与现状持平，无额外损失。
3. 现有最值钱的资产（端口化同步引擎、vendored Lake 内核）**可以跨路线复用**；被丢弃的只是应用壳（Electron 主进程、自研 UI、安卓分发），而壳正是 Obsidian 免费提供的部分。
4. 代价：Obsidian 的双向链接/图谱/关系型元数据对 `.lake` 文件不可见；全文搜索需插件自建；Obsidian API 是移动靶。
5. **建议**：先做 1-2 天的 Phase 0 spike（最小插件挂载真实 Lake 内核），验证死活后再决定是否迁移。现有 Electron 版冻结在"可用"状态，不新增功能。

---

## 1. 背景与现状

### 1.1 项目是什么

**Lake Notes**：本地优先的个人笔记应用，编辑内核为语雀 Lake 编辑器，带 S3（七牛 Kodo 兼容）多端同步。

- 技术栈：Electron 43.4 + React 18.3 + TypeScript 5.9 + better-sqlite3 13（N-API）+ Lake 编辑器（`lakex-editor-react-component@0.1.2`，ESM，**vendored 且 pin 版**）+ Drawnix 画板（`lakex-drawnix@0.1.0`）+ sharp（图片转换，webp→png 等）+ @aws-sdk/client-s3
- 移动端：Vite + Capacitor（安卓），已发版真机可用（Android WebView = Chromium）
- 同步：S3 单桶，自有协议（详见 §1.3）
- 数据规模假设：个人笔记 N≈2000 篇，单篇最大数 MB，全库含附件 ~20G，不考虑更大规模

**为什么编辑内核必须是 Chromium**：Lake 是语雀 Web Component 编辑器，依赖 SVG foreignObject 文字渲染。项目曾用 Tauri（macOS 强制 WKWebView），画板/复杂排版渲染 bug 无法解决，因此换到 Electron 并验证通过。**这一引擎约束贯穿本文所有平台判断。**

### 1.2 数据落盘形态（关键事实）

本地存储**本来就是文件形态**，这对插件化迁移意义重大：

```
workspace-default/
├── notes/{noteId}.lake          # 正文，原生 Lake 格式（文本，XML 形态）
├── note-assets/{noteId}/...     # 图片/附件，按笔记分目录
├── metadata.sqlite3             # 元数据：笔记本树、同步状态、墓碑等
├── quick-notes/metadata.sqlite3 # 小记（随手记）独立库
├── history/                     # 历史快照
└── draft-journal/               # 草稿
```

- `.lake` 文件是纯文本，天然对 diff/备份/文件级同步工具友好。
- 桌面端有一套自研 UI（精仿思源笔记版式）：文件树、设置面板、回收站、历史、搜索、小记工作台等。
- 资源服务：本地 HTTP 服务（`http://127.0.0.1:19876/{noteId}/{file}`）向编辑器提供资产 URL——**这是已知痛点**（Android 真机上该地址不可达）。

### 1.3 自研同步协议要点（已稳定运行，语义需完整保留）

- **本地是真相，S3 只是镜像**（云端备份绝不反噬本地）。
- **墓碑权威（删除压编辑）**：删除传播到所有端；B 的编辑无论早晚都抵抗不了 A 的墓碑；被删方的本地编辑强制留历史快照。
- **恢复是唯一显式例外**：回收站恢复写 `restore_pending_at` → local-wins 覆盖墓碑并传播。
- 资产存在性判定 = 远端清单声明差集（对齐思源 dejavu），禁止逐对象 HEAD、禁止本机持久缓存；上传走差集但 manifest **全量声明**（防他端 GC 误删）。
- GC：只删未被任何在留清单引用的键 + 年龄保护；manifest commit 链保留 3 层。
- S3 并发峰值 ≤8（七牛建议）。
- 笔记本树强一致；软删 = 移入回收站笔记本；purge = 无条件写墓碑。

### 1.4 核心架构决策（对本次评估最重要的一个事实）

`src/core/` 目录**禁止 `node:` 导入**——平台差异全部通过端口（port）注入（如 `SyncDbPort`、`S3Store`）。桌面端注入 better-sqlite3 实现，移动端注入 sql.js（WASM）实现，**两端共享同一个 syncEngine**。

> 这意味着同步引擎**理论上可以直接搬进 Obsidian 插件**（插件也只是另一个宿主环境），这是本次"转身成本"评估中最有利的既成事实。

### 1.5 "跑偏"判断（项目所有者原话概括）

原始需求只是"一个比较好的可以同步的 lake 环境"，但两年来建成了完整自研应用：Electron 壳 + 主进程 IPC + 资源服务 + 打包/更新 + 精仿思源全套 UI + Capacitor 安卓壳。核心（编辑内核 + 同步引擎）是需要的，但**应用壳层的持续维护成本与原始需求不成比例**——而 Obsidian 作为成熟宿主恰好免费提供这层。

---

## 2. 目标方案定义

在 Obsidian 内以**单个插件**实现：

1. **原生 `.lake` 文件管理**：`.lake` 文件直接存于 vault（按笔记本 = 目录组织），无任何格式转换、无 md 镜像/sidecar。
2. **Lake 编辑器挂载**：插件注册 `.lake` 扩展名 → 双击用插件 View 打开 → 内部挂 vendored lakex 内核（React）编辑。
3. **资产管理**：`lake-assets/{noteId}/` 存于 vault，编辑器资源 URL 指向 vault 内路径（Obsidian `getResourcePath()` 的 `app://` 协议），**本地 HTTP 资源服务消失**。
4. **同步**：优先复用自研 syncEngine（端口实现换成 Obsidian vault adapter + 纯 fetch 版 S3 客户端）；备选 Remotely Save / Obsidian Sync（见 §4.4）。
5. **回收站/历史/小记**等语义作为插件内逻辑保留。

### Vault 数据布局

```
Vault/
├── 个人笔记/                    # 笔记本 = 目录
│   ├── 到啦领导.lake
│   └── 项目 A/
│       └── 设计稿.lake
├── lake-assets/{noteId}/...     # 资产原样，无转换
└── （无任何 .md 镜像、无 sidecar、无转换层）
```

- `.lake` 是唯一格式，Lake 内核是唯一读写方，Obsidian 只当壳。
- 明确**不做**：lake↔md 双向转换、双格式一致性维护、只读 md 存根（除非未来为图谱补索引，现阶段不需要）。

---

## 3. 平台硬事实（已核实，附来源）

| # | 事实 | 来源 |
|---|---|---|
| 1 | Obsidian 桌面 = Electron（Chromium），插件可访问 Node.js API 甚至原生模块（有插件用 better-sqlite3，需按 Obsidian 的 Electron ABI 预编译） | [obsidian-quick-plugin-switcher 兼容文档](https://github.com/3C0D/obsidian-quick-plugin-switcher/blob/master/OBSIDIAN_PORTABLE_COMPATIBILITY.md)、[open-connections PR #46](https://github.com/GoBeromsu/open-connections/pull/46/files) |
| 2 | Obsidian 移动端 = Capacitor WebView（Android = Chromium；iOS = WKWebView）。**Node.js / Electron API 在移动端完全不可用**，插件需 `isDesktopOnly: false` 并只用浏览器 API | [Obsidian 官方 Mobile development 文档](https://docs.obsidian.md/Plugins/Getting+started/Mobile+development) |
| 3 | `requestUrl`（绕 CORS 的 HTTP）桌面/移动双端可用——S3 同步在移动插件的可行路径，Remotely Save 已长期验证 | [官方文档/社区插件实践](https://docs.obsidian.md/Plugins/Getting+started/Mobile+development) |
| 4 | 插件可注册自定义文件扩展名并绑定自定义 View（`registerExtensions`），Excalidraw（`.excalidraw` 原生格式进 vault、从不转 md）是该模式的成熟先例 | [Excalidraw 插件](https://github.com/md42/obsidian-excalidraw-plugin/blob/master/docs/zh-cn/README.md)、[Custom File Extensions Plugin](https://plugins.semiautonomous.org/plugin/obsidian-custom-file-extensions-plugin) |
| 5 | 移动插件 DB 只能 WASM（如 sql.js）；本项目移动端 bridge **已经在用 sql.js**，代码现成 | 本仓库事实 |
| 6 | 社区对 Obsidian mobile 普遍评价"桌面 10 分、移动 4 分"，槽点集中在 iCloud 路径、社区插件兼容、图片路径——单一自有插件 + 自有 S3 + 明确资产目录约定的场景可绕开大部分 | [Obsidian mobile critique](https://codeculture.store/blogs/developer-culture/obsidian-mobile-problems-2025) |
| 7 | 私有插件分发：桌面放 `.obsidian/plugins/`；移动端用 BRAT 或手动拷贝插件目录 | 社区通行做法 |

---

## 4. 可行性逐项分析

### 4.1 Lake 编辑器挂载（唯一真正的技术未知数）

- 机制：`registerExtensions(['lake'], viewType)` + 自定义 ItemView + 内部挂 React + lakex Web Component。Excalidraw 验证过整条路径。
- 有利证据：lakex 是纯前端 ESM；**本项目已在 Electron 与 Android WebView 两种 Chromium 环境实测跑通**（大文档虚拟渲染、中文 IME、粘贴、画板均有实测记录）。
- 待 spike 验证（§7 Phase 0 清单）：在 Obsidian View 容器内的渲染完整性、IME、快捷键冲突、暗色主题 CSS 变量桥接、插件打包体积对加载的影响。

### 4.2 原生 `.lake` 管理能力矩阵（零转换前提下）

| 管理动作 | 原生/插件 | 说明 |
|---|---|---|
| vault 存储 `.lake` | ✅ 原生 | vault 即文件夹 |
| 文件树浏览/移动/重命名/删除 | ✅ 原生 | 目录树 = 笔记本树 |
| 快速切换器按文件名找 | ✅ 原生 | 未知扩展默认可能被忽略；开 "Detect all file extensions" 或插件注册后全覆盖 |
| 双击打开 → Lake 编辑 | 🔌 插件 | 见 §4.1 |
| 读写内容 | 🔌 插件 | `app.vault`/adapter 读写 `.lake` 原文，字节零转换 |
| 全文搜索 | ⚠️ 不可靠 | 核心搜索对非 md 内容不保证 → 插件自带搜索面板（现有 FTS 可迁移顶上） |
| 双链/图谱/反链 | ❌ | metadata cache 只解析 md/canvas——零转换方案的唯一实质代价 |
| md 笔记嵌入预览 `.lake` | 🔌 可做 | markdown post processor（Excalidraw 同款），非必需 |
| 同步（官方 Sync/Remotely Save/自研引擎） | ✅ | 按原文件字节同步，不关心扩展名 |

### 4.3 元数据与数据库

- 目录树交给 vault（目录 = 笔记本）后，`metadata.sqlite3` 剩余的主要是**同步状态**（sync_state/baseHash/墓碑）——本就该跟着 syncEngine 端口走，数据量小。
- desktop：better-sqlite3 可用但有 ABI 追随成本（Obsidian 升 Electron 需重编）；或 sql.js 双端统一。**倾向 sql.js 统一**（移动端代码现成，桌面性能足够——同步状态表很小）。
- FTS：现 `src/core/searchRepository.ts` 的 trigram FTS 可随引擎迁移，或先用插件内扫描式搜索（N≈2000 规模可接受）。

### 4.4 同步方案三选一

| 方案 | 说明 | 判断 |
|---|---|---|
| **A. 搬运自研 syncEngine（推荐）** | 端口实现换 Obsidian vault adapter + fetch 版 S3 sigv4；墓碑/GC/恢复语义原样保留 | 保住已打磨成熟的删除传播/恢复标记/GC 语义；主要工作量在 S3 客户端去 aws-sdk 化（aws-sdk v3 browser build 或手写签名） |
| B. Remotely Save（社区插件） | 零开发直连七牛 | 语义弱：文件级 mtime 比较，无墓碑权威/恢复标记，等于换一套同步世界观 |
| C. Obsidian Sync（官方付费） | 端到端加密、双端体验好 | 订阅费用；对自定义格式无特殊语义 |

### 4.6 附件与图片管理专项（**项目所有者的硬性要求**）

> 要求：现有"图片/附件按笔记分目录、文档与资源分离、粘贴/拖拽即存、复制到第三方图片可见"这套能力**必须完整满足，是方案的先决条件而非加分项**。

| 能力 | 现状（自建端） | Obsidian 插件方案 | 判定 |
|---|---|---|---|
| 按笔记分目录存储 | `note-assets/{noteId}/` | `lake-assets/{noteId}/` 于 vault 内，**结构原样平移** | ✅ |
| 编辑器内图片显示 | 本地 HTTP 服务 `:19876/{noteId}/{file}` | vault 内路径 → `getResourcePath()` 的 `app://` 协议 | ✅（spike 验证加载） |
| 资源 URL 真机可达 | ❌ 已知 bug（Android 真机访问不到 `127.0.0.1`） | `app://` 由 Obsidian 自己的协议处理，双端一致 | ✅ **反而修复遗留 bug** |
| 剪贴板粘贴图片 | 编辑器拦截 → 写盘 → 插入引用 | 插件 View 层拦截 paste → 二进制写 vault adapter → 插入 URL（Excalidraw 有同款先例） | 🔌 需实现，路径清晰 |
| 拖拽图片进文档 | 同上 | 同上（drop 事件） | 🔌 需实现 |
| webp→png 等格式转换（第三方剪贴板兼容） | sharp（Node 原生模块） | 桌面可留 sharp（插件可用 Node）；**移动端无 Node→无 sharp** → 需统一评估 Canvas/OffscreenCanvas 转码（Chromium WebView 支持 webp 解码，`toBlob('image/png')` 出 png） | ⚠️ 需 spike 验证转码质量/性能/一致性 |
| 文件名内容寻址（时间戳+hash 前缀，同名即同内容） | `buildAssetFilename` 纯 JS | 纯 JS，双端逻辑不变 | ✅ |
| 复制到微信等第三方时图片可见 | Electron 端已实现（转换后入剪贴板） | 桌面插件仍可用 Node/Electron API 重实现；移动端依赖系统分享能力，与现状持平 | 🔌 桌面需重接，移动持平 |
| S3 差集上传 + manifest 全量声明 + GC | syncEngine + 保留链 | **逻辑原样保留**（资产清单声明/GC 全在引擎内，与宿主无关） | ✅ |
| 附件管理界面（按笔记列资产、查看/清理） | 自研资源页 | 插件设置/命令面板自建；vault 文件树本身也直接可见 `lake-assets/` | ✅ |
| 大库（~20G 资产）对宿主的影响 | 自控 | Obsidian 只索引文件元数据（名字/大小），不读图片内容；文件数量大时文件树/索引表现需实测 | ⚠️ 观察项 |

**结论**：附件/图片管理的**存储结构、内容寻址、同步与 GC 语义全部原样保留**；需要新实现的是"粘贴/拖拽写入 vault"与"`app://` 资源 URL"两个接入点（路径清晰、有先例）；唯一真正的不确定项是**移动端无 sharp 后的图片转码方案**（Canvas 统一 vs 桌面保留 sharp），列入 Phase 0 必验项。

### 4.7 移动端专项

| 能力 | Android | iOS | 依据 |
|---|---|---|---|
| `.lake` 进 vault / 文件树 / 插件 View | ✅ | ✅ | 插件 API 双端同构 |
| Lake 编辑器渲染 + 中文 IME | ✅（实证） | ⚠️ 高风险 | Android WebView=Chromium，与自建 Capacitor 端同引擎，真机已跑通；iOS=WKWebView，foreignObject=Tauri 死因 |
| S3 同步 | ✅ | 理论可 | `requestUrl`/fetch + sigv4（Remotely Save 先例） |
| 元数据 DB | ✅ | 理论可 | sql.js WASM（代码现成） |
| 图片/资产显示 | ✅ | ⚠️ | `app://` 资源路径；**顺手解决真机 `127.0.0.1:19876` 不可达的遗留 bug** |
| 剪贴板粘贴 | 🔌 适配 | 🔌 | 移动端粘贴路径不同，需移动版拦截 |
| 键盘/工具栏布局 | 🔌 适配 | 🔌 | Obsidian mobile 统一管理键盘视口，比自管省心但要重新调 |

**结论**：Android 全链路可行且优于现自建端（省掉构建/签名/分发/键盘适配）；iOS 出局（与现状持平，无损失）。

---

## 5. 现有资产复用度

| 资产 | 复用度 | 说明 |
|---|---|---|
| `src/core/syncEngine.ts`（端口化） | ★★★★★ | 直接搬，端口换 Obsidian 实现 |
| `src/core/syncDecisions.ts` 等纯函数 | ★★★★★ | 直接搬 |
| vendored lakex + 本地 CDN 镜像 | ★★★★☆ | 直接搬；CDN 镜像随插件打包，按需裁剪 |
| S3 ObjectStore（aws-sdk） | ★★★☆☆ | 换 fetch/浏览器版 sigv4 |
| better-sqlite3 存储层 | ★★☆☆☆ | 大幅缩水：树归 vault，只剩同步状态表 |
| Electron 壳 / IPC / 资源服务 | ☆ | 弃用（Obsidian 替代） |
| 桌面精仿思源 UI 全套 | ☆ | 弃用（Obsidian 自带文件管理/设置/回收站入口） |
| Capacitor 安卓壳 | ☆ | 弃用（Obsidian Android 替代） |
| sharp 图片转换（webp→png 等） | ★★☆☆☆ | 移动插件无 Node→无 sharp；需评估用 Canvas/wasm 方案或降级 |

**弃用的都是壳，保住的都是核。**

---

## 6. 风险清单

| 风险 | 等级 | 缓解 |
|---|---|---|
| Lake 在 Obsidian View 内的未知数（IME/粘贴/画板/暗色/快捷键冲突） | 中 | Phase 0 spike 专门验证，死路即止损 |
| Obsidian API 漂移（无强契约，升级可能破坏） | 中 | pin Obsidian 版本；插件不追新；核心逻辑与 API 层隔离 |
| better-sqlite3 ABI 追随（desktop） | 低 | 直接 sql.js 统一双端 |
| 插件体积（lakex + CDN 镜像可能几 MB~几十 MB） | 低 | 镜像按需裁剪；Obsidian 对插件体积无硬限 |
| 双链/图谱缺失 | 中 | 已知代价；若未来需要可加只读 md 索引存根（可删可重建） |
| 语雀内核授权（仅当公开上架插件市场） | 自用=无 / 上架=高 | 个人私有插件无分发问题 |
| 迁移期双方案并存的数据一致性 | 中 | 一次性导出脚本（数据是文件，可重复导、可并存试跑） |
| 移动端粘贴/键盘适配工作量未知 | 低-中 | 有自建端全套经验与代码参照 |

---

## 7. 分阶段实施计划

### Phase 0：spike 决策门（1-2 天级）——**先做，决定生死**

独立目录，**不碰 lake-notes-electron 现有代码**。最小插件：

- [ ] `registerExtensions('lake')` + 自定义 View
- [ ] 挂 vendored lakex，打开一篇真实 `.lake` 文件（从 dev 数据拷贝）
- [ ] 验证：渲染完整性（标题/列表/表格/代码块/图片）、中文 IME、图片粘贴、Drawnix 画板、暗色主题、大文档性能（数 MB 级）
- [ ] **图片/附件专项（硬性要求，见 §4.6）**：`<img src="app://...">` 在插件 View 内正常加载；paste/drop 拦截 → 二进制写 vault → 插入引用全链路；Canvas webp→png 转码与 sharp 输出的质量/体积/性能对比
- [ ] 验证：Obsidian 全局快捷键与 Lake 内部命令的冲突面
- [ ] 产出：spike 仓库 + 结论记录

**任一验证项死路即停止，沉没成本只有两天。**

### Phase 1：桌面闭环

- vault 目录约定（笔记本=目录）+ `lake-assets/` 资源路径桥接
- syncEngine 桌面端口（vault adapter + sql.js）
- 回收站/历史/恢复语义移植（复用 `isGoneNote` 等纯函数）

### Phase 2：同步闭环

- fetch 版 S3 客户端（sigv4）+ GC 语义迁移
- 与现有 Electron 端对同一桶做双向同步回归（墓碑传播/恢复/资产差集）

### Phase 3：移动端

- 同一插件 `isDesktopOnly: false`，Obsidian Android 真机验证
- 资产 URL/键盘/粘贴适配；私有插件经 BRAT 分发

### 存量数据迁移

一次性导出脚本：`notes/*.lake` → vault（按笔记本建目录），`note-assets/` → `lake-assets/`，同步状态表重建。数据是文件，可重复导出、新旧方案可并存试跑，随时可退。

---

## 8. 备选方案对比

| | A. 维持现状（继续自建） | B. 全面转 Obsidian 插件 | C. 现状收尾 + 插件试水（**推荐**） |
|---|---|---|---|
| 同步语义 | 自主 | 保留（搬引擎） | 保留 |
| 应用壳成本 | 持续投入（更新/打包/双端/UI） | 归零 | 桌面冻结只维护，增量归零 |
| 生态扩展 | 全靠自己 | Obsidian 插件生态直接用 | 同 B |
| iOS | 无 | 无 | 无（持平） |
| 沉没成本 | — | 桌面 UI 层 | 最低 |
| 主要风险 | 继续重 | API 漂移、Lake 集成未知数 | 双线心智负担（过渡期） |

**推荐 C 的理由**：现有 Electron 版停在"可用 + 全绿门禁"状态不再加功能；Phase 0 spike 独立验证；通过后逐步移交重心。数据层面两条路共享同一份 `.lake` 文件与 S3 桶，随时可退。

---

## 9. 请评审方重点评估的问题

1. **Lake 内核集成**：vendored 语雀 lakex（Web Component + React wrapper）挂进 Obsidian 自定义 View（非 CodeMirror 路径），有哪些已知的坑？（IME、事件冒泡、焦点管理、全局快捷键冲突、CSS 隔离/shadow DOM 需要吗？）
2. **S3 移动端实现选型**：aws-sdk v3 browser build vs 手写 sigv4 fetch 客户端（约需 PUT/GET/HEAD/ListObjectsV2/DeleteObjects），在移动 WebView 里的体积/兼容性权衡？
3. **sql.js 双端统一 vs 桌面 better-sqlite3**：同步状态表（万级行）用 sql.js 的性能是否可接受？有没有更优的移动端持久化选型？
4. **双链缺失的补偿**：若未来需要 `.lake` 间引用进入图谱，只读 md 存根 vs 自建引用解析 + 自定义图谱面板，哪个更划算？
5. **API 漂移风险**：Obsidian 插件 API 历史上的破坏性变更频率？`registerExtensions`/自定义 View 这类核心机制是否稳定？
6. **体积与加载**：lakex vendor + 本地 CDN 镜像随插件打包（估计数 MB~数十 MB），对 Obsidian 启动/插件加载的实际影响？有无按需加载的成熟做法？
7. **迁移策略**：新旧方案并存期，同一 S3 桶双客户端（Electron 端 + 插件端）写同一协议，有哪些边界情况需要防？
8. **图片转码**：移动端无 sharp 后，Canvas/OffscreenCanvas（webp 解码 + png 重编码）与 sharp 的输出质量/体积/性能差异是否可接受？是否有更优的跨端统一转码方案（如 wasm 版 squoosh codec）？
9. **反方观点**：这个方案有没有被忽略的致命伤？

---

## 10. 参考来源

- [Obsidian 官方：Mobile development（Node/Electron 在移动端不可用、isDesktopOnly）](https://docs.obsidian.md/Plugins/Getting+started/Mobile+development)
- [Obsidian-Excalidraw 插件（自定义格式原生进 vault 的先例）](https://github.com/md42/obsidian-excalidraw-plugin/blob/master/docs/zh-cn/README.md)
- [Custom File Extensions Plugin（扩展名↔View 绑定机制）](https://plugins.semiautonomous.org/plugin/obsidian-custom-file-extensions-plugin)
- [open-connections PR #46（Obsidian 插件内 better-sqlite3 按 Electron ABI 预编译）](https://github.com/GoBeromsu/open-connections/pull/46/files)
- [Obsidian Portable 兼容性文档（桌面插件 Node API 的可行与边界）](https://github.com/3C0D/obsidian-quick-plugin-switcher/blob/master/OBSIDIAN_PORTABLE_COMPATIBILITY.md)
- [Obsidian mobile 体验批评（2025/2026，"桌面 10 移动 4"）](https://codeculture.store/blogs/developer-culture/obsidian-mobile-problems-2025)
- [obsidian-native-modules（按 Obsidian Electron ABI 预编译原生模块的基础设施）](https://github.com/tbhb/obsidian-native-modules)

---

*本文档由 Lake Notes 项目会话整理（2026-09-06）。现状基线见 `HANDOFF.md`；本文只覆盖 Obsidian 插件化方向的调研与方案。*
