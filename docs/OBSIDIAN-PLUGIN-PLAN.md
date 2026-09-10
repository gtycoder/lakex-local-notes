# Lake Notes → Obsidian 插件：设计与实施方案（Markdown 底层）

> **文档目的**：自足、供外部 AI / 顾问复核。无需访问本仓库其它文件即可理解。
> **决策前提（已定）**：Obsidian 插件 + Markdown + 复用 Obsidian 的 MD 生态；自研只做"Lake 体验层"。
> **关联**：`docs/OBSIDIAN-PLUGIN-FEASIBILITY.md`（前期可行性）· `obsidian-platform-capability-research.md`（Obsidian 平台能力）· 《Lake 编辑器嵌入与 MD 桥接》研究纪要。
> **状态**：方案已定方向，细节待评审后细化。非最终交付代码。

---

## 0. TL;DR

- **目标**：在 Obsidian 中以**单个插件**实现"Lake 风格的编辑体验"，底层为 **Markdown**。
- **核心思路（三对齐）**：
  1. **样式复刻 Lake** —— 工具栏的按钮集合/分组/图标/提示/位置/hover、以及卡片与复杂排版的**观感**，尽量像 Lake。
  2. **功能对齐 Lake** —— 每个按钮/操作产生的**结果**（加粗、标题、列表、引用、代码、表格、分隔线、插入思维导图/画板/callout/附件/表情/日期…）与 Lake 一致。
  3. **技术对齐 Obsidian** —— 用 **Obsidian 的 MD 生态**（mermaid/Canvas/callout/embed/表格/代码栅栏/frontmatter + 社区插件）实现，**不碰专有引擎、不替换核心编辑器**。
- **"卡片"的定义**：一个能渲染成该样式的 **Obsidian 原生构造** + 你给它的 **Lake 风格皮肤（工具栏入口 + CSS）**。
- **自研范围**（MD 生态表达不了的那层）：Lake 风格工具栏 + 卡片皮肤 + 附件归档/分类/命名/限长 + 小记面板 + 大纲增强 +（可选）草稿恢复。
- **白拿（MD 生态）**：搜索、图谱、双链、标签、文件/附件管理、Markdown 渲染、图片/音频/视频内嵌播放、主题/CSS、移动端、同步（Obsidian Sync/Remotely Save）、模板(Templater)/Dataview/Tasks。
- **关键取舍**：不照抄 Lake 内部格式/引擎；卡片是"Obsidian 构造 + Lake 皮肤"。加密卡片**暂缓**（非刚需，后续讨论）。

---

## 1. 背景与动机

### 1.1 现状
Lake Notes 目前是**独立应用**：Electron 43 桌面 + Capacitor 安卓，自研编辑内核（vendored 语雀 Lake）、自研 S3 同步协议、全套自研 UI（文件树/设置/回收站/历史/搜索/小记/大纲/附件）。**沉没成本高、壳层维护重**，用户觉得"跑偏"。

### 1.2 用户真实诉求（已确认）
- **一个 Obsidian app 就能用**，不想多开软件。
- **保留 Lake 的编辑体验**：工具栏（最看重）、复杂排版、自定义字体颜色、卡片（思维导图/画板/代码/图片/附件/表格/表情/高亮/折叠/分隔线/日历/日期）。
- **只需** 大纲 + 附件管理；**不需要** 标签、双链、生态。
- **愿意** 围绕插件自研优化。
- 底层用 **Markdown**，很多能力用 MD 生态去做。

### 1.3 已核实的关键事实（决定方向）
1. 语雀 Lake 引擎 `@alipay/lakex-doc` 是**专有、无开源、走阿里 CDN**；其 MIT React 包装层（`lakex-editor-react-component`）已被本地 vendored。=> "开源 lake/lakex" 不存在（公共 npm 的 `lakex-editor` 是占位符；`lakejs/lake` 是另一个不同编辑器）。
2. Obsidian 支持 `registerExtensions` + 自定义 View 接管**自定义扩展名**，但**不能替换核心 .md 编辑器（CM6）**；自定义扩展名内容**不进**搜索/图谱/双链（官方版主确认无 full functionality）。
3. 因此只有两条路：
   - **A. 用专有引擎**（Obsidian 私有插件）：真 Lake 卡片/画板；代价=专有(自用可/上架死)、搜索丢失(需自建)、Obsidian 生态对内容不可见、移动端弱。
   - **B. 切 MD 生态**（本方案）：开放/可上架、搜索/图谱/双链/生态/移动端全白拿；代价=卡片是"Obsidian 构造 + Lake 皮肤"，不是专有卡片内部。

**结论：选定 B。**

---

## 2. 决策与理由

| 决策点 | 选择 | 理由 |
|---|---|---|
| 宿主 | Obsidian（桌面为主，移动端后续） | 免费提供文件树/搜索/设置/主题/同步/移动端，省掉自建壳 |
| 格式 | **Markdown（.md）** | Obsidian 全文索引/图谱/双链/标签/插件生态全免费；卡片可用 MD/embed/callout/mermaid/canvas 表达；开放、无许可、移动端稳 |
| 编辑方式 | **叠加层，不替换核心编辑器** | CM6 扩展做悬浮块工具栏 + 卡片；文件保持 .md，编辑器/生态都兼容 |
| 引擎 | 不用语雀 Lake 引擎 | 专有/许可 + 不能进 MD 索引 + 移动端弱；改用 MD 生态表达卡片 |
| lake↔md 转换 | **不做** | 纯 MD 单向；不做双格式、不做 .lake 侧、不做 .md 镜像 |
| 加密卡片 | **暂缓**（非刚需） | 需要专门加密插件或自研；后续单独讨论 |

---

## 3. 目标 / 非目标

**目标**
1. 一个 Obsidian 插件提供 Lake 风格的编辑体验（工具栏/卡片/复杂排版/自定义字体颜色）。
2. 大纲（TOC/结构导航）+ 附件管理（粘贴自动归档、按图片/音频/视频分类、内容寻址命名、大小限制）。
3. 小记（快速记录时间线 + 转为正式笔记）。
4. 所有功能在 **.md 生态**内实现；文件是**真 .md**；不替换 Obsidian 核心编辑器；无专有依赖；可上架。

**非目标**
- 不照抄 Lake 内部格式/引擎；不做 lake↔md 双向转换；不引入 .lake 自定义扩展名。
- 不强制标签/双链/图谱/生态（Obsidian 原生免费有，但用户不强制要求）。
- 加密卡片暂缓。
- 不做与现有 Electron 端深度耦合的同步协议（先走 Obsidian 同步，见 §12）。

---

## 4. 整体架构（详细）

### 4.1 模块划分（一个插件，按领域拆）

```
lakenote-plugin/
├── manifest.json            # 插件元信息（minAppVersion、isDesktopOnly=false）
├── main.ts                  # 入口：注册命令/设置/事件；初始化各模块
├── editor/
│   ├── toolbar.ts           # CM6 悬浮块工具栏（Lake 版式）：按钮+分组+图标+hover
│   ├── insertCards.ts       # "+ 插入卡片"菜单：每种卡片→插入对应 MD/embed/canvas/callout token
│   ├── selection.ts         # 选区/光标定位、替换、包裹（加粗/标题/列表等）
│   └── keymap.ts            # 快捷键（对齐 Lake）+ 与 Obsidian 冲突面
├── cards/
│   ├── cards.css            # 把 callout/mermaid/embed/代码/表格 包装成"Lake 卡片"观感
│   └── cardRegistry.ts      # 卡片类型清单 + 每种卡片的插入 token + 皮肤 class
├── attachment/
│   ├── paste.ts             # 粘贴拦截：归档+分类(图片/音频/视频)+命名+魔数嗅探+大小限制+并发
│   ├── copy.ts              # 桌面：复制选中图片→webp→png→写剪贴板（第三方可显示）
│   ├── naming.ts            # 内容寻址命名（复用现有 assetNaming 逻辑）
│   └── typeDetect.ts        # 魔数嗅探 + 扩展名 + MIME 兜底（复用现有 imageFormat/sniff）
├── quicknotes/
│   ├── QuickNotesView.ts    # 小记时间线面板 + 手动保存 + 删除5秒撤销
│   └── convert.ts           # 转为正式笔记：选笔记本→新 .md 插顶→换行→段落、图→embed
├── outline/
│   ├── OutlineView.ts       # 大纲/TOC（可复用现有 outline 逻辑，或基于 Obsidian 原生 Outline 增强）
├── settings/
│   ├── settings.ts          # 附件目录/分类开关/大小上限/桌面转码等设置
│   └── settingsTab.ts       # 设置页（思源版式，条目级搜索可选）
└── shared/
    ├── pluginEnv.ts         # 平台分支（isDesktopOnly/Platform.isDesktop/isMobile）
    └── request.ts            # 网络（requestUrl 绕 CORS，下载外部图/附件）
```

### 4.2 技术要点
- **编辑器层**：用 `Plugin.registerEditorExtension([...])` 注入 CM6 扩展，渲染**悬浮块工具栏**（随光标/块出现）与**卡片 hover 工具栏**。**不动核心编辑器**，文件保持 .md。
- **卡片层**：每种卡片 = MD/embed/canvas/callout 构造 + `cards.css` 里的"Lake 卡片"皮肤。卡片插入按钮由工具栏触发。
- **附件层**：paste/drop 拦截（CM6 或 DOM 事件）→ 二进制写 vault（`vault.createBinary`/adapter）→ 插入 embed；命名/分类/限长逻辑纯前端。
- **环境层**：`isDesktopOnly=false`（移动端要跑）；用 `Platform.isDesktop/isIosApp/isAndroidApp` 分支；移动端无 Node/Electron → 转码用 Canvas/OffscreenCanvas 统一或桌面保留 sharp（注意 ABI）。

---

## 5. 数据模型与 Vault 布局

### 5.1 笔记
- 笔记 = **.md 文件**，位于 vault 任意位置（可按笔记本=目录组织）。
- 元数据可选放 **frontmatter**：`tags`（可选）、`created`/`updated`、`source`（转自小记）、`attachments`（本笔记附件清单，便于 GC）等。

### 5.2 附件目录约定
```
Vault/
├── 个人笔记/                 # 笔记本 = 目录
│   ├── 到啦领导.md
│   └── 项目A/
│       └── 设计稿.md
├── lake-assets/
│   └── {noteId}/
│       ├── image/{ts}_{hash}.png
│       ├── audio/{ts}_{hash}.mp3
│       ├── video/{ts}_{hash}.mp4
│       └── doc/{ts}_{hash}.pdf
└── quick-notes/             # 小记（可选，或改用 daily notes 目录）
    └── {date}.md
```
- **命名**：内容寻址（`{13位时间戳}_{8位hex}.{ext}`），同名即同内容，天然去重、跨端互认（复用现有 `assetNaming.ts` 的 `ASSET_NAME_RE`）。
- **noteId**：可用笔记文件名（稳定）或 frontmatter 中的 id；优先用文件名，简化跨端一致。

---

## 6. Lake 卡片 → Obsidian/MD 构造映射表（详细）

| Lake 卡片 | Obsidian/MD 构造 | 插入内容 | 实现 | 备注 |
|---|---|---|---|---|
| 段落/标题 | Markdown | 文本 / `# h1`… | 原生 | ✅ |
| 加粗/斜体/下划线/删除线 | Markdown | `**`/`*`/`<u>`/`~~` | 原生 | ✅（下划线需 CSS/HTML） |
| 颜色/字体 | 内联 HTML `<span style>` + CSS | `<span style="color:#..">` | 自研渲染 + CSS | ⚠️ 自定义颜色是 MD 弱项，靠 inline HTML/class；需在工具栏渲染层保证 |
| 高亮 | Markdown | `==高亮==` | 原生 | ✅ |
| 链接 | Markdown | `[text](url)` | 原生 | ✅ |
| 无序/有序列表、任务 | Markdown | `-`/`1.`/`- [ ]` | 原生 | ✅ |
| 引用 | Markdown | `> ` | 原生 | ✅ |
| 代码块 | Markdown | ```lang …``` | 原生 | ✅ |
| 表格 | Markdown 表格 | `| a | b |` | 原生 | ✅ |
| 分隔线 | Markdown | `---` | 原生 | ✅ |
| 折叠块 | Callout（可折叠） | `> [!note]-` | 原生 + CSS | ✅ |
| 高亮块 | Callout | `> [!note]` / `> [!tip]` | 原生 + CSS | ✅ |
| 思维导图 | Mermaid | ```mermaid
mindmap
…``` | 原生（Obsidian 渲染 mermaid） | ✅ 或 `obsidian-markmap` |
| 画板 | Obsidian Canvas | 创建 .canvas + `![[x.canvas]]` 嵌入 | 原生 | ✅ |
| 图片 | embed | `![[img.png]]` 或粘贴即插 | 原生 + 附件层 | ✅ |
| 附件（文件卡） | embed + 卡片皮肤 | `![[file.pdf]]` | 原生 + CSS 皮肤 | ✅ Obsidian 原生内嵌播放音/视频 |
| 音频/视频 | embed | `![[audio.mp3]]`/`![[video.mp4]]` | 原生内嵌播放器 | ✅ |
| 表情 | emoji | 直接插入 emoji / emoji 插件 | 插件/自研 | ✅ |
| 日期/日历 | 前端模板 / Dataview / 日历插件 | 插入日期串或日历卡 | 插件 | ✅ |
| 加密卡片 | **暂缓** | 需加密插件或自研 | 后续讨论 | ⚠️ 非刚需 |
| 文件卡"内嵌各种文件" | embed + 自定义 post-processor | `![[file]]` 渲染成富卡片 | 自研卡片处理器 | ✅（Excalidraw 同款模式） |

> **结论**：要的卡片**绝大多数**落在 Obsidian 原生 / 少量插件上；自研主要集中在"工具栏入口 + 卡片皮肤 + 少数卡片处理器（如图片/附件卡片化）"。

---

## 7. 附件模块设计（详细）

### 7.1 粘贴/拖拽归档流程（paste 拦截）
1. 捕获 paste/drop（CM6 扩展 `editorView.dom` 或 DOM 事件，捕获阶段）。
2. 从 `clipboardData`/DataTransfer 拿到文件（File/Blob）或 URL。
3. **类型分类**：`typeDetect`（先魔数嗅探 `sniffImageFormat` 认 png/jpg/gif/webp/avif；再按 MIME；再扩展名兜底）→ 归类 image/audio/video/doc。
4. **命名**：`naming` 生成 `{13ts}_{8hex}.{ext}`（内容寻址，去重）。
5. **大小限制**：图片 ≤25MiB、附件 ≤用户配置（默认 25MiB 可调大）；超限报错。
6. **写盘**：`vault.createBinary` 写到 `lake-assets/{noteId}/{type}/{name}`（或配置的附件目录）。
7. **插入**：在编辑器替换选区插入 `![[asset]]`（图片/音/视频用 embed）。
8. **并发/重试**：复用现有 `resourceUpload.ts` 的 `createConcurrencyQueue` + `withRetry` 思路（小规模可简化）。

### 7.2 复制到第三方（微信等）图片可见 —— 桌面优先
- 捕获 copy：选中 embed/image → 读出文件字节 → **webp→png** 转码 → `clipboard.writeImage(PNG)`（桌面 Electron）。
- **转码**：优先 Canvas/OffscreenCanvas（`new Image`+webp decode+`toBlob('image/png')`，桌面/移动端 Chromium 都支持）；或桌面用 native sharp（需按 Obsidian Electron ABI 预编译，有追随成本）。
- **移动端**：插件 API 对"写图片字节到剪贴板"支持有限 → **桌面可靠、移动端弱/降级**（或移动端直接保存为 PNG 简化）。

### 7.3 复用资产（纯逻辑直接带）
- `src/core/assetNaming.ts`：`ASSET_NAME_RE`、类型清单、`isImageExtension/isAssetExtension`。
- `src/features/editor/imageFormat.ts`：`sniffImageFormat`（魔数）、`validateImageInput`（大小/格式）。
- `src/features/editor/resourceUpload.ts`：并发队列/重试/上限思路。
- **需替换**：IPC、assetServer(`:19876`)、sharp 原生绑定。

### 7.4 说明
- Obsidian 原生"粘贴图片"已能保存到附件目录，但**组织/分类/命名/限长/GC**较弱——这正是本模块的价值点。
- 移除本地资源服务（`:19876`）→ 资产用 vault 文件 + `app://`/相对路径，**顺带修复现有 Android 真机 `127.0.0.1` 不可达的遗留 bug**。

---

## 8. 工具栏模块设计（详细）

### 8.1 交互
- **悬浮块工具栏**：光标在段落/块内时，块左侧或上方出现 Lake 风格工具栏（CM6 decoration）。
- **选中文字**：选中时浮出格式工具栏（加粗/斜体/下划线/删除线/颜色/高亮/链接）。
- **"+ 插入"菜单**：块工具栏的 + 入口，列出所有卡片类型（思维导图/画板/代码/图片/附件/表格/表情/高亮/折叠/分隔线/日期/日历）。
- **hover 卡片工具栏**：卡片（callout/mermaid/embed）hover 时出现标题栏/拖拽/删除（CSS + 事件）。

### 8.2 按钮分组（对齐 Lake）
1. **块类型**：段落 / h1–h6 / 引用 / 无序·有序列表 / 任务 / 代码。
2. **文本格式**：加粗 / 斜体 / 下划线 / 删除线 / 颜色 / 高亮 / 链接。
3. **插入（卡片）**：+ 菜单 → 思维导图 / 画板 / 代码 / 图片 / 附件 / 表格 / 表情 / 高亮块 / 折叠块 / 分隔线 / 日期 / 日历 /（加密暂缓）。

### 8.3 行为实现
- 非卡片格式：`editorView.dispatch` / `replaceSelection`/包裹。
- 卡片：插入 §6 对应 token；必要时创建 .canvas 文件并嵌入。
- 与 Obsidian 已有插件/快捷键的冲突面：`keymap.ts` 维护，优先让 Lake 快捷键，但避免吞掉 Obsidian 全局键。

### 8.4 模式差异
- **Live Preview / Source**：卡片构造在阅读/Live Preview 渲染成卡片；Source 模式是裸 MD 文本。这是 Obsidian 固有形态，需接受（Lake 是纯 WYSIWYG）。

---

## 9. 小记（快速记录）面板设计

- **模型**：用 Obsidian 生态建模（daily notes / 一个 `QuickNotes/` 目录 + 每篇 .md，或用插件内存面板落盘到临时目录）。
- **行为**（对齐现有小记）：按创建时间倒序时间线；**手动"记下"才保存**；删除 **5 秒撤销**（无回收站）；无自动保存；纯文本+图片。
- **转正式笔记**：选笔记本 → 新建 .md 插到树最顶 → 标题`未命名文档 · YYYY-MM-DD HH:mm` → 每个换行 = 一个段落、每张图 = `![[image]]` embed → 成功后删源小记（或标记已转换）。
- **数据安全**：小记是"随手记"，不搞复杂备份（同现有）。

---

## 10. 大纲增强
- Obsidian 已有原生 **Outline 视图**（按标题树）。若够用则直接用。
- 若要"Lake 式大纲（含卡片/行内标题/跳转）"，用 `src/features/outline` 现有逻辑移植成自定义大纲 View，支持点击跳转、heading unfold、scrollByNodeId。

---

## 11. 复用现有资产 vs 弃用

| 资产（现有 Electron 版） | 复用度 | 用途 |
|---|---|---|
| `src/core/assetNaming.ts` | ★★★★★ | 附件命名/类型清单/引用提取 |
| `src/features/editor/imageFormat.ts` | ★★★★★ | 魔数嗅探/格式校验/大小限制 |
| `src/features/editor/resourceUpload.ts` | ★★★★☆ | 并发/重试思路 |
| `src/features/outline/*` | ★★★★☆ | 大纲增强 |
| `src/features/editor/lakeRuntime.ts` | ☆ | 语雀引擎相关，弃用 |
| `electron/assetServer.ts` | ☆ | 本地资源服务，弃用（改 vault 文件） |
| `electron/sync.ts` / `src/core/syncEngine.ts` | ★★☆☆☆ | 仅当自研同步时用（§12） |
| `better-sqlite3` / Ion 存储 | ☆ | 元数据改回 frontmatter/文件，弃用 |
| Electron 壳 / IPC / Capacitor 壳 / 精仿思源 UI / sharp | ☆ | Obsidian 替代 |

---

## 12. 同步策略（选型）

| 方案 | 说明 | 判断 |
|---|---|---|
| **A. Remotely Save**（首选推荐） | 社区插件，S3/S3-compatible（七牛 Kodo 需实测 endpoint/region/CORS，`requestUrl` 绕 CORS）；vault 文件级增量 | 零开发；文件级；冲突=keep newer/larger（免费）；**丢墓碑/恢复/GC 语义** |
| **B. Obsidian Sync**（官方付费） | 端到端加密、双端体验好 | 省心；付费；同 A 的语义简化 |
| **C. 自研 syncEngine 移植** | 保原墓碑/恢复/GC/冲突副本语义 | 工作量最大；建议仅当"本地是真相/删除权威/恢复标记"这些语义不可丢时再做 |

> 若用户希望保留"本地是真相、删除传播、回收站恢复标记"这类数据安全语义，需在 A/B（简化语义）与 C（保语义、多干活）之间权衡。**建议先 A/B 快速上路**，语义损失作为已知代价；后续若在意再补 C 的子集。

---

## 13. 移动端
- Obsidian 移动端可运行插件（`isDesktopOnly=false`）；CM6 编辑扩展在移动编辑模式可跑；无 Node/Electron → 只用 Obsidian 插件 API + `Platform` 分支。
- 图片转码：用 Canvas/OffscreenCanvas 统一（移动端无 sharp）；桌面可选保留 sharp（ABI 追随）。
- 资产：vault 文件 + `app://`/相对路径，**修复真机 `127.0.0.1:19876` 不可达 bug**；同步用 Obsidian Sync/Remotely Save。
- 移动端"复制图片到第三方"是弱项（同 §7.2），可降级。

---

## 14. 风险与待验证（Phase 0 spike 建议）

> 在正式开发前，先用一个最小插件验证以下"硬未知数"，死路即止损：

1. **CM6 悬浮块工具栏**在 Live Preview / Source 模式的稳定性、与 Obsidian 自身/其它插件快捷键冲突面。
2. **卡片皮肤**：callout/mermaid/embed/代码/表格 用 CSS 包装成"Lake 卡片"后的渲染是否够接近、是否破坏 Obsidian 默认排版。
3. **中文 IME**、粘贴、画板(Canvas) 嵌入、图片粘贴归档全链路。
4. **大文档性能**（数 MB 级 .md + 多个 embed/canvas）。
5. **图片转码**（Canvas vs sharp）质量/体积/性能差异；移动端可行。
6. **Obsidian API 漂移**（`registerEditorExtension`/View/事件等核心机制是否稳定；pin 版本）。
7. **附件模块**：粘贴→归档→分类→命名→限长→插入 embed 的完整路径验证。

---

## 15. 迁移（从现有 Electron 版选出数据）
- 一次性导出脚本（可在新插件里做，或独立脚本）：
  - `notes/*.lake` → Markdown（用 Lake 自带的 `readData("text/markdown")` 或现有 `store.ts` 导出 + `lakeCaches` 兜底转换；有损点=卡片/画板/表格细节，需人工/工具补）。
  - `note-assets/{noteId}/*` → `lake-assets/{noteId}/{type}/`。
  - 小记 `quick-notes/*` → 新建 .md。
- 可并存试跑、可回退（数据是文件，随时可逆）。

---

## 16. 请复核 AI 重点评估的问题

1. **CM6 悬浮块工具栏（Lake 版式）**在 Obsidian 的实现可行性与坑？（装饰、焦点、快捷键、与 Live Preview 交互）
2. **"卡片 = Obsidian 原生构造 + CSS 皮肤"**是否足够接近 Lake 观感？哪些卡片（尤其画板/思维导图/复杂排版/自定义颜色）难以逼近、需要额外自研？
3. **附件**：粘贴归档/分类/命名/限长在插件内的实现路径是否合理？`webp→png` 复制到第三方在桌面/移动端的可行性（尤其移动端剪贴板写图片字节）？
4. **小记**在 MD 生态内如何建模最合理（daily notes vs 独立目录 vs 插件面板）？"转为正式笔记"的最佳实现？
5. **同步**：Remotely Save 连七牛 Kodo 的**实测**可行性；文件级同步丢"墓碑/删除传播/恢复标记"语义是否可接受，或有没有轻量补救？
6. **是否有遗漏的功能/设计点**？（功能清单见 §1.2、§3、§6、§7–§10；也可参考 `docs/OBSIDIAN-PLUGIN-FEASIBILITY.md` 与两个研究纪要）
7. **反方意见**：这个方案有没有被忽略的致命伤？（如 MD 表达卡片的天花板、Obsidian 生态/API 依赖、移动端、同步语义、性能）

---

## 17. 参考
- `docs/OBSIDIAN-PLUGIN-FEASIBILITY.md`（前期可行性，含平台事实、复用度、Phase 阶梯）
- `/Users/admin/file/local-lake/obsidian-platform-capability-research.md`（Obsidian 平台能力边界：registerExtensions/View/搜索索引/移动端/同步）
- 《Lake 编辑器嵌入与 MD 桥接》研究纪要（语雀引擎=专有、无开源；`lakejs/lake`=不同 MIT 编辑器；Markdown 映射有损）
- 现有代码：`src/core/assetNaming.ts`、`src/features/editor/imageFormat.ts`、`src/features/editor/resourceUpload.ts`、`src/features/outline/*`

---

## 18. 附录：参考文档与关键结论速览（供复核方一次看全）

### 18.1 参考文档清单

| 文档 | 路径 | 内容 | 对本文的作用 |
|---|---|---|---|
| 本设计方案 | `docs/OBSIDIAN-PLUGIN-PLAN.md` | 方向/架构/卡片映射/附件/小记/同步/风险 | 主题文 |
| 前期可行性 | `docs/OBSIDIAN-PLUGIN-FEASIBILITY.md` | 平台硬事实(带来源)、复用度、Phase 0 阶梯、反方 | 补平台事实与迁移/复用细节 |
| Obsidian 平台能力边界 | `/Users/admin/file/local-lake/obsidian-platform-capability-research.md` | registerExtensions/View、不可替换核心编辑器、自定义扩展名不进搜索/图谱/标签、移动端、同步 | 定"叠加层 + MD 生态"的依据 |
| Lake 编辑器嵌入与 MD 桥接 | （研究纪要，结论已并入 §1.3） | 语雀引擎=专有无开源、`lakejs/lake`=另一个 MIT 编辑器、Markdown 映射有损 | 论证"不用语雀引擎" |
| **现有功能全量清单（原始盘点）** | `/Users/admin/file/local-lake/lake-notes-feature-inventory.md` | 130+ 条分类功能清单 + 桌面/移动标注 + 已知痛点/遗留 + 文档提到未实现 | §19 的原始数据来源（§19 已按 MD 决策重新标注处置） |

### 18.2 关键结论速览（从研究纪要提炼）

1. **Obsidian 可以注册自定义扩展名 + 自定义 View 完全接管渲染/编辑该文件**，但不能把 `.md` 注册到自己 View（核心编辑器固定为 CM6）。=> 我们选"叠加层 + MD"，不接管 `.md` 编辑器。
2. **自定义扩展名内容不进 Obsidian 的搜索/反链/图谱/标签**（基于 Markdown 元数据缓存；官方版主确认无 full functionality）。=> 若走 `.lake` 自定义扩展名会丢搜索；故用 `.md` 白拿搜索/生态。
3. **移动端**支持社区插件（无 Node/Electron；`isDesktopOnly` 可禁移动；部分桌面 API 不可用）；自定义 View 在移动端可建但布局是 drawer。
4. **同步**：Obsidian Sync（付费、端到端加密）；Remotely Save（免费、S3/S3-compatible；七牛 Kodo **需实测**；`requestUrl` 绕 CORS）；文件级、冲突简单（free=keep newer/larger）。
5. **无任何嵌入语雀/Lake 编辑器的 Obsidian 插件**；富文本/块编辑插件都是"另开面板/工作区"或"CM6 装饰"，且以 Markdown 为源（Wysimark / Notion Block / Blockspace）。
6. **语雀 Lake 引擎 `@alipay/lakex-doc` 是专有、无开源、走阿里 CDN**；`lakejs/lake`(MIT) 是另一编辑器且无卡片/画板；`lakex-editor`(npm) 是占位符。
7. **Markdown 映射有损**（callout/任务/公式/mermaid/附件等会降级）——但本文方案不追求 lake↔md 保真，卡片用"Obsidian 原生构造 + Lake 皮肤"表达。

### 18.3 给复核方的特别提示
- §1.3 与 §18.2 是"为什么必须走 MD 生态、不能走专有引擎/自定义扩展名"的论证主线，请重点核对。
- §6 的卡片映射、§7 的附件、§12 的同步、§14 的 Phase 0 spike 是建议重点评审的技术细节。
- 功能盘点（全量功能清单）由"全量盘点应用功能点"子代理产出，落地后会并入 §6/§7，避免遗漏；当前先以 §1.2/§3/§6–§10 为准。

---

---

## 19. 现有应用全量功能清单（迁移核对表）

> **重要**：本盘点按现有 app **全量**列出（含大量在 MD 决策下已不需要的项）。每题标注在 **MD 生态** 决策下的处置：
> - **【原生】** Obsidian 原生 / MD 生态提供，白拿（几乎不用做）
> - **【插件】** 需在插件里实现（本文档重点）
> - **【简化】** 可简化 / 降级（用 MD + Obsidian 同步/社区插件时语义减弱）
> - **【无】** 因弃用 Lake 引擎 / 改 MD 而不再需要
>
> **特别提示**：本盘点最初按"保留语雀引擎 + .lake 自定义扩展名"假设进行；因决策已改为"MD 生态"，凡依赖 **Lake 引擎 / .lake 格式** 的项，在 MD 下大多归入【无】或【插件但大幅简化】。分界线是：**Lake 引擎相关→【无】；资产/图片/小记/大纲/编辑体验层→【插件】；同步语义→【简化】。**

### 19.1 编辑体验
| 功能 | 处置 | 说明 |
|---|---|---|
| 多标签、标签右键/切换器/滚动/FLIP 动画 | 【无】 | Obsidian 原生标签已覆盖 |
| 每标签 contentCache / keep-alive | 【无】 | Obsidian 原生 retain |
| 文档上限自动淘汰 | 【简化】 | Obsidian 不限制，可选 |
| 挂载 lakex 内核 / 编辑/查看双模式 | 【无】 | 弃 Lake 引擎；Obsidian 阅读/编辑原生 |
| 回收站/被 purge 只读打开(isGoneNote) | 【简化】 | 走 MD + 简化同步语义 |
| 正文改动守卫 / 复制清洗 / 粘贴拦截 | 【插件】 | 保留"粘贴/复制清洗"逻辑；改动守卫在 MD 下简化 |
| 代码块自愈 / 表情/公式框自动开 / 表格卡片 hover 桥 | 【无】 | Lake 引擎特有 |
| 画板卡片滚动守卫 / 滚动记忆 | 【插件】 | 滚动记忆 Obsidian 原生；画板守卫看 Canvas 嵌入 |
| 搜索命中定位 / 编辑器右键菜单(导出) | 【插件/原生】 | 导出子菜单保；定位 Obsidian 原生 |
| 编辑偏好注入(字号/段间距/TOC/工具栏) | 【插件】 | CSS + CM6 扩展 + 设置实现 |
| 语雀 bookmark 卡降级 / 单卡错误边界 | 【无】 | Lake 引擎特有 |
| Slash 菜单调整 / 自定义画板卡 / 卡片图标 | 【无】 | 改由 MD 卡片(§6) + 工具栏实现 |
| 自研滚动跟随 TOC / 大纲树(折叠/展开/筛选/持久化/高亮/两态) | 【插件】 | Obsidian 原生 Outline 可能已够；要"Lake 式"则复用现有 outline 逻辑 |
| 图片灯箱(缩放/平移/画廊) | 【插件/原生】 | Obsidian 原生图片查看(部分)；画廊需插件 |
| 图片上传管线(并发/重试/保留原始格式) | 【插件】 | 复用 resourceUpload 逻辑 |
| 外部 URL 下载(SSRF/DNS/限重) | 【插件】 | 桌面 Node/requestUrl；移动受限 |
| 附件→音视频/图片卡自动分发；内嵌播放 | 【插件/原生】 | 类型分类 + embed；播放 Obsidian 原生 |

### 19.2 文档管理
| 功能 | 处置 | 说明 |
|---|---|---|
| 三类侧栏/目录树/筛选/新建/重命名/右键/拖拽移动/序号 | 【原生/插件】 | Obsidian 文件树原生；拖拽/筛选可增强 |
| 节点 emoji 图标 / 文档锁定(只读) | 【插件】 | frontmatter/属性 + 插件 |
| 回收站(双tab/预览/恢复/彻底删/清空/自动过期/徽章/恢复标记) | 【简化】 | Obsidian 基础回收站；"笔记本回收站/30天/恢复标记/purge墓碑"在 MD 同步下简化 |
| 历史快照(手动/15min/冲突自动留档/保留策略/恢复/预览/删除) | 【插件/简化】 | Obsidian 无文档级历史；自建(文件/前端)或 git 插件 |
| 冲突归档保护 / 孤儿文件管理 / 历史资源引用保护 | 【插件】 | 视同步方案；社区同步则简化/丢失 |
| 草稿恢复(draft-journal) | 【插件/简化】 | Obsidian 原生撤销/恢复，或轻量自建 |

### 19.3 搜索
| 功能 | 处置 | 说明 |
|---|---|---|
| 全局搜索面板(⌘K)/FTS trigram/高亮/导航/定位 | 【原生】 | Obsidian 原生全文搜索免费且更强 |
| 设置条目级搜索 | 【插件/可选】 | 若保留自定义设置页可做 |
| 目录树/大纲筛选 | 【原生】 | Obsidian 原生 |

### 19.4 同步与数据安全
| 功能 | 处置 | 说明 |
|---|---|---|
| Manifest v4 / 增量 / 内容寻址 / 墓碑 / 冲突四分支 / 恢复标记 | 【简化】 | Obsidian Sync/Remotely Save 由官方/社区处理；要坚持语义需 §12 C 自研 |
| 资产差集(清单声明/禁HEAD/并发≤8) | 【简化】 | MD 下附件走文件级；GC/去重可简化 |
| S3 GC / 待回收 / 保留窗口 / 深度清理 | 【简化】 | 社区同步基本不做 GC；要做需自研 |
| 备份 A1 / 云端恢复 A2 / 换机恢复 | 【插件】 | Obsidian 无整库备份；社区备份插件或自建 |
| 数据体检 A3 / 日志查看器 / 完整性检查 | 【插件/可选】 | 可做轻量版 |
| 崩溃自动恢复 / 子进程留档 | 【无】 | Obsidian 内部处理 |
| 安全加固(IPC白名单/SSRF/secret加密/路径白名单/限值) | 【插件】 | 需在插件宿主重实现(桌面 Node/移动受限) |

### 19.5 附件与图片（用户硬性要求，重点）
| 功能 | 处置 | 说明 |
|---|---|---|
| 按笔记分目录存储 | 【插件】 | lake-assets/{noteId}/{type}/ |
| 本地资源 HTTP 服务 :19876 | 【无】 | 改 vault 文件 + app://（顺带修真机 bug） |
| 复制到微信(webp→png) | 【插件】 | 桌面可、移动降级 |
| webp/avif→png | 【插件】 | Canvas/OffscreenCanvas 统一或桌面 sharp |
| MIME 表+魔数嗅探 / Range 206 / 缓存 | 【插件】 | 复用现有 |
| 附件预览(PDF/音视频内联) | 【原生】 | Obsidian 原生 embed/查看器 |
| 文件卡片解析 / 打开 / 大小上限 | 【插件】 | 卡片皮肤+embed；上限可配置 |
| 上传分流(图片保格式/附件落盘) | 【插件】 | 复用逻辑 |
| 附件管理界面(未引用统计/清理) | 【插件】 | Obsidian 无 GC；可做 |

### 19.6 小记（quick notes）
| 功能 | 处置 | 说明 |
|---|---|---|
| 时间线/手动"记下"/删除5秒撤销/转正式笔记 | 【插件】 | 核心体验保留，模型用 MD(daily/quicknotes 目录) |
| 独立库/独立同步/转换 journal/回收站/冲突副本 | 【简化】 | 独立库语义简化；转正式笔记用 §9 |

### 19.7 设置 / 导出 / 性能
| 功能 | 处置 | 说明 |
|---|---|---|
| 桌面设置 9 分类 / 移动设置抽屉 / S3 表单 / 清理缓存 | 【简化】 | Obsidian 原生设置；插件自定义设置页接插件项 |
| 外观 浅/深 | 【原生】 | Obsidian 主题 |
| 快捷键 | 【原生】 | Obsidian 命令/快捷键 |
| 导出 Markdown/HTML/原生 Lake / mdToHtml | 【插件】 | MD 导出 Obsidian 原生；HTML/Lake 导出插件 |
| Word/PDF 导出 | 【插件/可选】 | 未实现，可后续 |
| 虚拟渲染 / 卡片水合 / 长任务观测 | 【无】 | Lake 引擎特有；MD 大文档 Obsidian 原生 |
| 同步差集 / gzip / 早退 / 树列表子帧优化 | 【无】 | 同步语义走社区则简化 |
| 移动端 keep-alive / 键盘双通道 / 返回键优先链 | 【原生】 | Obsidian 移动端原生；键盘适配看需 |

### 19.8 其它
| 功能 | 处置 | 说明 |
|---|---|---|
| 专注模式 / 顶栏菜单 / 活动栏 / 状态栏 / 面包屑 | 【原生/插件】 | Obsidian 有对应 UI；专注/状态栏可插件 |
| 窗口状态 / 单实例锁 / dev S3 seed | 【无】 | Obsidian 处理 |
| 无默认"未分类" | 【简化】 | MD 下文件夹即容器 |

### 19.9 已知痛点/遗留（迁移需决策）
- Word/PDF 导出未实现；附件大文件分片/断点续传未做；FTS 1/2 字短词（MD 下 Obsidian 原生解决）；FTS 启动全量重建；快照 gzip 异步化；PUT 5xx 重试；sort_order 撞号；大纲 viewer 跳转（移动）；浮层样式收编。
- 移动端：剪贴板粘贴不解析为空；**真机 canonical URL 不可达（Obsidian app:// 修复）**；移动端无 sharp（Canvas 转码）；大纲 expand-to-level 崩溃；无 UI 删笔记本入口；技术债（sql.js 持久化/secret 非硬件级/CSP/搜索 LIKE）。
- 产品：回收站首拉成本；历史分层保留；块级 Diff 取消；大纲滚动抖动；外部变更检测/formatLake/.lakebook 导入/Markdown 导入/选区转 md（未实现）；抽屉标签后台卸载/树虚拟化/TaskManager（暂缓）。

### 19.10 MD 决策下的核对结论
- **归入【无】最大的两块**：Lake 引擎相关（挂载/查看器/卡片/虚拟渲染/内核 hack/浮层）、"本地资源 HTTP 服务"（改 app:// 反而修真机 bug）。
- **归入【原生】白拿最大**：文件树/搜索/设置/主题/多标签/命令面板/移动端壳/图片音视频播放/回收站基础。
- **插件必须自研（核心）**：Lake 风格工具栏+卡片皮肤、附件模块（归档/分类/命名/限长/复制转码）、小记面板+转正式笔记、大纲增强、导出、设置项接插件、可选草稿恢复/历史/健康检查/日志、以及宿主安全边界（桌面 Node/移动受限）。
- **同步语义**：MD + Obsidian Sync/Remotely Save → **简化**（丢墓碑/GC/恢复标记）；若强烈要保，再考虑 §12 C 自研子集。

---

*本文由 Lake Notes 项目会话整理（设计阶段）。功能盘点已并入 §19（现有功能全量清单 + MD 决策下处置标注）；§6 卡片映射、§7 附件、§12 同步、§14 Phase 0 spike 为技术评审重点。*
