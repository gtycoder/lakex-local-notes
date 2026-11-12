# 09 · R0 文档批次独立复核（task-7 guide/README + task-8 架构/契约 7 份）

> 复核者：audit-docs（独立于 r0-guide / r0-arch 的执行者）· 2026-11-12
> 只读复核，**未修改任何产品文档**；本文件是唯一产出。
> 复核对象：task-7（`guide/**`、`README.md`）与 task-8（`docs/ARCHITECTURE.md`、`STORAGE-LAYERS.md`、`TAG-SYSTEM-DESIGN.md`、`MOBILE-AI.md`、`TROUBLESHOOTING.md`、`SYNC-DEVICE-CONTRACT.md`、`MOBILE-DESIGN.md`，另含 r0-arch 顺带修的 `SYNC-PROTOCOL.md`、`DIARY.md`）。
> 基线：`master @ 8cc65e06` + 两批未提交改动（`git status` 见附录 A）。

## 0. 结论摘要

**总体：PASS（可发布），但有 7 项「事实/导航」级需修项：guide 3 项（G1 设置路径 10 处、G2 导航断链、G3 平台归属）、架构/契约 4 项（A1 不存在的 treeRepository、A2 行数错、A3 MOBILE-DESIGN §0.3 过期、A5 SYNC-PROTOCOL 旧路径）＋1 项跨批依赖（A4 noteKindTouchpoints 待 task-11）；均为小改，不动结构。**

| 维度 | 结论 | 证据 |
| --- | --- | --- |
| 链接与路径（全 docs/guide） | **PASS** | 138 篇 md，仅 3 条失链，全部在 `docs/lakexEditor-developer-docs/` 的语雀原文绝对链接（上游镜像原样保留，不算问题）；本批 7 份文档内**仅剩 1 处**失效仓内路径（`docs/SYNC-PROTOCOL.md:62`） |
| guide 四新章 | **PASS** | 16/17/18/19 全部存在、体例一致、nav 链 15→16→17→18→19 完整 |
| guide 改名与语义纠偏 | **PASS（主项）** | `grep -c 资料库 guide/*.md README.md` = **0**；五格 Dock 与工作区胶囊已分离说明 |
| guide 设置路径 | **FAIL（7 处桌面 + 3 处移动，见 G1）** | 仍写「设置 → 编辑器 / 日志 / 文档与历史 / AI / 同步设置」，与实际分类（常规/数据维护/数据与历史/AI 助手/云端与同步）不一致 |
| guide 章节导航 | **FAIL（1 处，见 G2）** | `guide/14-faq.md:3` 缺「下一章 15」→ 14 与 15 之间断链 |
| guide 平台归属 | **FAIL（1 处，见 G3）** | `guide/07-quick-notes.md:12` 把「长按图标→小记」写成桌面程序坞行为；实际是 **Android 静态 App Shortcut**（`PinShortcutPlugin.kt:19-21`） |
| README 单一来源与事实 | **PASS** | 文档表缩为「入口」并指向 `docs/HANDOFF.md`；RELEASE-NOTES 区间 = `v1.1.0 → v1.0.0`（与 `docs/RELEASE-NOTES.md:3` 一致）；5 个一级空间、换机两条路已补；§S3 同步的「单文件 manifest」已改为 v3 表述 |
| ARCHITECTURE 重写 | **PASS（3 个原失效路径已消）**；2 处小错（见 A1/A2） | 原 `electron/quickNotesSync.ts`、`electron/s3Maintenance.ts`、`src/features/editor/BoardCard.tsx` 已不在文中；Manifest V2 仅以「已废弃」出现；真实桶名已删除 |
| STORAGE-LAYERS / TAG-SYSTEM-DESIGN | **PASS** | 抽样 5 条硬事实全部与代码一致（见 §3） |
| MOBILE-AI / TROUBLESHOOTING / SYNC-DEVICE-CONTRACT | **PASS** | SecretBox 表述已改为「两处实现、统一计划未执行」；测试路径笔误已修；真实桶名已改占位 |
| MOBILE-DESIGN | **部分过期待修（见 A3，非本批任务项）** | `§0.3:97/101` 仍是 261110 前的「首页 tab / 底部胶囊 3 格」，与同文件 `:195/:208/:211` 的「五格 Dock + 中央＋」冲突 |
| 15 条技巧落点 | **PASS** | T1–T15 全部有落点且事实与代码/契约一致（见 §5），未发现编造数值 |

---

## 1. 复核方法

1. **批量路径校验**（脚本，非人工目测）：抓 138 篇 md 的 markdown 相对链接（解析后 `fs.existsSync`）+ 正文里的仓内路径（`docs/ guide/ src/ electron/ scripts/ public/ android/ build/ patches/`），输出失效清单。命令见附录 A。
2. **事实对账**：每条用户可见结论都回落到代码/契约的单一来源，逐条列 file:line（见 §2.3、§3.2）。
3. **语义对账**：五格 Dock vs 工作区胶囊、⌘1–5、设置分类、S3 v3、SecretBox 现状、桶名脱敏。
4. **可复现**：所有结论给命令或文件行；「已核实」与「推断」分开（本文标注 ⚠推断 的只有 2 处）。

---

## 2. task-7（guide + README）逐项复核

### 2.1 PASS 项（含证据）

| # | 检查项 | 结论与证据 |
| --- | --- | --- |
| P1 | 4 新章存在 | `guide/16-diary.md`(129 行)、`17-ai-writing.md`(111)、`18-portable-and-migrate.md`(116)、`19-update-center.md`(89)；体例与既有章一致（标题/导航行/截图引用/相关章节） |
| P2 | 导航链 | 15→16→17→18→19 全部双向；`guide/15-import-export.md:3` 已补 nav（原文件无 nav） |
| P3 | 目录 19 行 | `grep -c '^\| \[1[0-9]\|^\| \[0[1-9]'` = **19** |
| P4 | 平台差异表补 4 行 | `guide/README.md` 新增「日记 / AI 写作 / 更新中心 / 便携包」4 行；「一级空间」行两端同序（桌面 ⌘1–⌘5 / 移动 小记·知识库·日记·AI·标签） |
| P5 | 「资料库」清零 | `grep -rc 资料库 guide/*.md README.md` → 0 命中（改动前 8 行 / 6 文件） |
| P6 | 五格 Dock 与工作区胶囊分离 | `guide/README.md:70-75`「两种『胶囊』，别弄混」+ `guide/01-getting-started.md:52-58`；移动实现判据 = `src/mobile/home/tabPager.ts:14` `HOME_TABS = ["quick","library","diary","ai","tags"]` |
| P7 | ⌘1–5 | `guide/13-shortcuts.md:29-34` 与 `src/hooks/useDesktopLifecycle.ts:115`（注释定稿）+ `src/desktop/DesktopTopBar.tsx:95-105`（空间菜单 label+hint）逐项一致 |
| P8 | 桌面设置 11 分类 / Android 12 菜单 | `guide/12-settings.md:5-6` 与 `src/components/app/SettingsPanel.tsx:574-584`（11 项）、`src/mobile/settings/settingsMenu.ts:33-46`（12 项）**逐字同序** |
| P9 | 4 个新设置项 | 12 章含「附件大小上限 / 默认空间 / 按需下载附件 / 后台扫描间隔 / 自动备份 / 导出便携包」，对应 `src/components/model/settingsSearch.ts:33,34,62,66,71,73` |
| P10 | 标签三条定稿 | `guide/08-search-outline-tags.md:61-66` 与 AGENTS §4（顺序设备本地 / 删除=缺席 / 文档标签关系在标签库）一致 |
| P11 | 小记「保存并同步」单条快路径 | `guide/07-quick-notes.md:34-37`；未引用「11 次请求」等会过期的数字（AGENTS §1 口径）✅ |
| P12 | 长按 260ms+上滑速记 | `guide/01:57`、`guide/07:13`、`guide/README.md:72`；代码 `src/mobile/ui/createPress.ts:16`（`CREATE_LONG_PRESS_MS = 260`）、`:18`（上滑 36px）、`:33-36`（长按未上滑=取消） |
| P13 | 看图画廊 = 正文全量 / 单击·双击 | `guide/03-editing.md:54-60`；`src/features/editor/ImageLightbox.tsx:116`（`n / m`）、`:115,117`（上/下一张）、`:119-121`（放大/缩小/重置）、`:37`（Esc）、`:123`（关闭）；触发语义见 AGENTS §4（261112 定稿） |
| P14 | 日记章事实 | `guide/16`：⌘3 / 移动第 3 格（`HOME_TABS` 下标 2）、标题只能是日期、一天多篇、年月分组自动建、不拖拽排序、转文档=移动、取消标记（整本）、不打标签、无月历浏览；均与 `docs/DIARY.md`（同批已修「移动端只做 open」的过期句）与 `src/mobile/diary/DiaryPage.tsx:5-9`（＋=新建 / 日历=选日期新建 / 写今天=幂等 open）一致 |
| P15 | AI 写作章事实 | `guide/17`：⌘4、桌面专属、会话只本机（不进同步/搜索/目录树）、便携包不含 AI 会话、深度思考默认开且无开关、生成文档只选笔记本且**标题可改**、单篇≈1.2 万字/合计≈4 万字/最多 20 篇；对应 `src/features/aiWriting/AiWritingWorkspace.tsx:165-166`（关闭态 banner 文案逐字一致）、`PublishDocDialog.tsx:31-32`（标题可编辑、首焦点）、`docs/AI-WRITING.md` 预算段 |
| P16 | 便携包章事实 | `guide/18`：`.zip.lln`、≤4GiB、不含历史、覆盖导入、离线可导出、云开启时导出前先同步、明文、不做增量/分卷/手机→桌面；对应 `src/core/portable/portableFormat.ts:12,14`、`src/components/app/SettingsPanel.tsx:1058-1059`（「迁移到手机」/「导出便携包（桌面 → 手机）」逐字）、`src/mobile/settings/PortableImportSection.tsx:107`（「从便携包导入（覆盖本机）」逐字）、`docs/PORTABLE-TRANSFER.md` |
| P17 | 更新中心章事实 | `guide/19`：桌面设置→更新、Android 更新中心（倒数第二）、自动检查默认开/24h、自动下载默认开、手动检查不自动下载、不静默安装、sha256 + Android 签名、重试 3 次、不降级、单飞；对应 `docs/UPDATE-CENTER.md` §1/§4/§5 与 `src/components/app/UpdateCenter.tsx:103-182`（行名「检查更新/自动检查/检查频率/自动下载/其它操作/更新日志」） |
| P18 | README 概览 4 项 | ①文档表 →「入口」4 行 + 单一来源指针（`README.md`「文档索引只有一份…`docs/HANDOFF.md`」）；②RELEASE-NOTES `v1.1.0 → v1.0.0`；③「五个一级空间（⌘1–⌘5）」；④「换机两条路」；另把「清单为单文件 manifest」改成 v3 表述（原句确为过期事实） |
| P19 | 数据位置/备份口径 | `guide/README.md` 数据段：整库备份含历史、自动备份仅数据库默认每天一份保留若干份 — 与 `electron/autoBackup.ts:32-38`（`enabled:true/intervalDays:1/keepCount:7/300MB`）一致 |

### 2.2 需修项（可直接照改）

**G1（P1）：guide 里 10 处「设置 → 旧分类名」，与 12 章新分类表自相矛盾。** 实际分类见 `SettingsPanel.tsx:574-584` / `settingsMenu.ts:33-46`。

| 文件:行 | 现状 | 改为 |
| --- | --- | --- |
| `guide/03-editing.md:26` | 「设置 → 编辑器」里可以关掉固定工具栏 | 「设置 → 常规 → 编辑器」里……（分组名仍叫「编辑器」，分类名是「常规」） |
| `guide/08-search-outline-tags.md:20` | 「设置 → 日志 → 重建全文搜索索引」 | 「设置 → 数据维护 → 全文搜索 → 重建全文搜索索引」 |
| `guide/08-search-outline-tags.md:35` | 「设置 → 编辑器 → 大纲增强」 | 「设置 → 常规 → 编辑器 → 大纲增强」 |
| `guide/09-history-trash.md:24` | 快照策略（设置 → 文档与历史） | 快照策略（设置 → 数据与历史） |
| `guide/09-history-trash.md:50` | 可在设置 → 回收站里改天数 | 可在设置 → 数据维护 → 回收站里改天数 |
| `guide/10-ai.md:9` | **桌面**：设置 → AI | **桌面**：设置 → AI 助手 |
| `guide/14-faq.md:89` | 桌面设置 → 日志可以查看运行日志 | 桌面设置 → 数据维护 → 应用日志可以查看运行日志 |
| `guide/11-cloud-sync.md:41` | 设置 → 同步设置：（Android 配置段） | 设置 → 云端与同步： |
| `guide/11-cloud-sync.md:89` | 手机端「设置 → 同步设置」 | 手机端「设置 → 云端与同步」 |
| `guide/14-faq.md:24` | 手机端在设置 → 同步设置里能看到 | 手机端在设置 → 云端与同步里能看到 |

> 说明：`guide/09:42` 的「Android 设置 → 回收站」正确（移动端确有独立「回收站」菜单）；`guide/10:23,71` 正确。

**G2（P2）：章节导航断一处。** `guide/14-faq.md:3` 只有「上一章 13」，缺「下一章」。改为：
`[← 返回目录](README.md) | 上一章：[13 快捷键](13-shortcuts.md) | 下一章：[15 导入、批量操作与导出 →](15-import-export.md)`

**G3（P1）：`guide/07-quick-notes.md:12`「桌面也可以长按程序坞图标进入『小记』快捷入口」——平台归属错误。**
- 证据：「长按图标→小记」是 **Android 静态 App Shortcut**：`android/app/src/main/java/com/lakexlocalnotes/android/PinShortcutPlugin.kt:19-21`（「Android 的**静态** App Shortcut（res/xml/shortcuts.xml）在原生与多数 ROM 上长按图标即可见……调 `ShortcutManager.requestPinShortcut` 让系统直接固定一个快捷方式到桌面」），入口文案在移动设置「常规 → 新建小记 → 添加到桌面」（`src/mobile/settings/SettingsDrawer.tsx:312,322`）。桌面端（macOS）没有这个入口：
`git grep -n dock -- electron` 无宿主导航菜单实现（`electron/appMenu.ts` 只有应用菜单，无 Dock 菜单）。
- 建议改为：「Android 长按应用图标→『小记』可直达速记（部分机型需先在 设置 → 常规 →「新建小记」里「添加到桌面」）；桌面没有这条入口。」

### 已核实「无需改」（避免后续误改）

- `guide/01-getting-started.md:55,58`「最右的云图标是『立即同步』」**正确**：移动首页云按钮的 `aria-label/title` 就是「立即同步」（`src/mobile/home/HomePage.tsx:771-773`）；AGENTS §4 的「云同步」指入口语义，不冲突。
- `guide/README.md` 5 分钟上手第 5 条「Android 点首页顶栏右侧的放大镜」**正确**：`src/mobile/home/HomePage.tsx:766`（`aria-label="搜索"`）。
- `guide/09-history-trash.md:42`「Android 设置 → 回收站」**正确**（移动端有独立「回收站」菜单，`settingsMenu.ts:42`）；`guide/10-ai.md:23,71`「设置 → AI 助手」**正确**。

### 2.3 15 条技巧落点对照（T1–T15）

| 技巧 | 落点 | 结论 |
| --- | --- | --- |
| T1 便携包省 S3 流量 | 18 章「三条路怎么选」+ 11 章备份段 + 14 FAQ | ✅ |
| T2 S3 配置迁移码 | 18 章「迁移码」+ 11 章「配置迁移」 | ✅（两处都写明「不是安全边界」） |
| T3 移动端 1024 缩略 / 按需下载附件 | 11 章「按需下载附件」+ 07 章 Android 段 + 12 章 | ✅ |
| T4 复制含图到微信不裂 | `03-editing.md:80-81` | ✅（写明 `?base64=1` 与 webp/avif→PNG） |
| T5 画廊 = 整篇文档的图 | `03-editing.md:54-60` | ✅ |
| T6 回收站不是删除 | `09-history-trash.md:47`（软删说明块） | ✅ |
| T7 标签顺序/删除=缺席 | `08-search-outline-tags.md:61-66` | ✅ |
| T8 保存并同步单条快路径 | `07-quick-notes.md:34-37` | ✅ |
| T9 手机速记两级 | `07:13` + `01:57` + README | ✅ |
| T10 日记是普通文档 | 16 章开头 + 转文档段 | ✅ |
| T11 AI 写作会话只本机 | 17 章「会话存在哪」 | ✅ |
| T12 浏览器端当分屏阅读器 | 12 章浏览器端段 | ✅ |
| T13 更新中心不静默安装 | 19 章「它不会自动装」 | ✅ |
| T14 三个自愈入口 | 12 章数据维护 + 14 FAQ | ✅ |
| T15 删除压编辑 | `09-history-trash.md:64-69` + 14 FAQ | ✅ |

---

## 3. task-8（架构/契约 7 份）逐项复核

### 3.1 逐文件结论

| 文件 | 结论 | 关键证据 |
| --- | --- | --- |
| `ARCHITECTURE.md` | **PASS（重写到位）**，1 处错 + 1 处跨批依赖 | 原 3 个失效路径已消失（抽验文中 37 条路径：35 条存在；2 条缺失 = A1 的 `treeRepository`、A5 的 `noteKindTouchpoints.test.ts`（待 task-11））；Manifest V2 仅出现在「旧 `manifests/latest.json` …不读不迁移」这类**否定句**（`:101`）；原 §4.5（真实账号 5 个桶名）整节已删，换成「§3.1 示例配置（占位，不是任何真实账号）」（`:103-110`，`<your-bucket>` 占位）；新增移动端索引（§五）与模块归属判据（§四） |
| `STORAGE-LAYERS.md` | **PASS** | 三层（L1 真相/L2 镜像/L3 保留链）与 v3 一致；删除了 `manifestTypes`、`declared_assets`、`sync_base` 等 V2 时代的「镜像层」描述；V2 只出现在「已过期」说明（`:150`） |
| `TAG-SYSTEM-DESIGN.md` | **PASS** | 补 261107「标签域单一归属小记库」；顺序仅本机、删除=缺席、无墓碑；8 个实现路径逐个验证存在 |
| `MOBILE-AI.md` | **PASS** | SecretBox 表述已改：`:359`「SecureStorePlugin 与 SecretBox 目前是两处实现…合并是已登记计划，尚未执行」，并自注 261112 校正（`:529`）；失效路径（AiComposer/aiLimits/AiSettingsSheet）已按现行实现改写 |
| `TROUBLESHOOTING.md` | **PASS** | 真实桶名已占位化（`:80` 改为 `<bucket>.s3.<region>.qiniucs.com`）；旧锚点 `HANDOFF §3#` 残留 = 0；`src/styles.css` 文案改为 `src/styles/index.css` 入口链 |
| `SYNC-DEVICE-CONTRACT.md` | **PASS（改动小）** | 失效测试引用 `deviceConformance.desktop.test.ts` 已移除；端口差异表述与 `desktopStoreAdapter`/`mobilePlatformPort` 一致 |
| `MOBILE-DESIGN.md` | **部分过期待修（见 A3）** | 门禁/预算/文件行数账本已更新（261112 实测值）；但 §0.3 的导航形态描述仍是改版前 |
| `SYNC-PROTOCOL.md`（顺带） | **PASS（除 1 条路径）** | `s3v3Gc` 规划器已删的描述与 task-9 删除 `src/core/s3v3Gc.ts` 对齐（`:404-410`）；但 `:62` 仍写 `src/core/s3v3Keys.ts`（见 A4） |
| `DIARY.md`（顺带） | **PASS** | 修正「移动端 v1 只做 open」为「261110 起与桌面同能力」，与 `DiaryPage.tsx:5-9` 一致 |

### 3.2 硬事实抽样对账（全部已核实）

| 文档断言 | 代码/契约 | 结论 |
| --- | --- | --- |
| 小记 `purged[]` 90 天窗口、缺失时间保守保留 | `src/core/s3v3/protocol/s3v3Index.ts:14,236-253`（`pruneQuickPurgedIds`） | ✅ |
| 待补资产账本 `state.pendingAssets`（attempts/上限） | `src/core/s3v3/state/deviceStore.ts:361`；AGENTS §4 维护域 | ✅ |
| 小记库表 `quick_note_file_ops` | `electron/quickNotes.test.ts:557`（INSERT 该表） | ✅ |
| 移动端设备本地键 `lakex-local-notes-mobile.pad-panels` | `src/mobile/pad/padPanelPrefs.ts:14` | ✅ |
| gzip 只用于元数据对象、按 key 判定不按魔数 | `src/core/s3v3/protocol/s3v3Keys.ts:17-19`（P0 事故注释） | ✅ |
| 桌面 S3/AI 密钥 `secretCipher` fail-closed | `electron/secretCipher.ts` 存在 + AGENTS §5 | ✅ |
| IPC 187 通道 | `docs/HANDOFF.md:305`「通道 186→187」+ `electron/ipc/ipcChannelParity.test.ts` 存在 | ✅（间接；⚠推断：未跑测试核实实时计数） |

### 3.3 需修项

**A1（P2）：`docs/ARCHITECTURE.md:16` 列了不存在的 `electron/treeRepository.ts`。**
实测 `electron/` 下只有 `treeBehaviorContract.test.ts`；目录树 CRUD 在 `electron/store.ts` + `electron/noteMetadataRepository.ts` + `electron/noteQueries.ts`。
改法：`noteContentRepository / noteMetadataRepository / noteQueries / treeRepository` → `noteContentRepository / noteMetadataRepository / noteQueries / storeQueries`（或直接删 `treeRepository` 这一项，保留前三个）。

**A2（P2）：`docs/ARCHITECTURE.md:12`「electron/（主进程，24k 行级）」数字错误。**
实测：`electron/*.ts`（顶层）= **30,487 行**；`electron/**/*.ts`（含 s3v3/ipc/ai/portable/update 子目录）= **43,253 行**。且 AGENTS 头部明确「不要抄会被改的数值」。改法：删掉「24k 行级」，写「主进程（大目录，规模以 `git ls-files electron | xargs wc -l` 为准）」。

**A3（P2，非本批任务项）：`docs/MOBILE-DESIGN.md` §0.3 仍是改版前形态。**
- `:98`「首页 tab 收起、居中显示当前页小标题」、`:99`「**首页 tab**：纯文字…」、`:101`「**底部胶囊**：形态/尺寸/命中不变（56 高、r28、**3 格**）」——首页 tab 行与首页胶囊已在 261110 改版中删除（`:227` 还有一段「首页 tab = 语雀式纯文字 tab（261013 A 批定）」同属改版前描述），文件自己在 `:195` 写「首页胶囊用法与 `.mobile-bottom-bar--home`（4 槽/192px）已删，胶囊只剩工作区/表格阅读态」、`:208` 写「首页 = 底部五格 Dock + 中央悬浮＋」。
- 建议：给 §0.3 加一句「（261110 起首页形态见 §5.4 / Dock 方案 A；本节只保留设置/Sheet/卡片等仍生效的条目）」并删掉 `:98-99` 的「首页 tab」与 `:101` 的「底部胶囊 3 格」两条（`:227` 那段加「（已废弃）」标注），或统一标注「已废弃」。**本项不属于 R0-1 清单，可放 R1**。

**A4（P2，跨批依赖）：`docs/ARCHITECTURE.md:138` 引用 `src/features/editor/noteKindTouchpoints.test.ts` 并标「本批新增」，但该文件当前不存在**（task-11 的 Q2 护栏尚未交付）。
- 若 task-11 本批交付 ⇒ 自动成立；若不交付 ⇒ 把「本批新增」改为「待建（Q2，06 报告 F-02）」，或先删该句避免读者找不到文件。

**A5（P2）：`docs/SYNC-PROTOCOL.md:62` 旧路径。**
「单一来源 = `src/core/s3v3Keys.ts`」→ `src/core/s3v3/protocol/s3v3Keys.ts`（文件已迁；同文其它处用的是文件名简写，只有这一处写了完整路径）。

---

## 4. 全局检查项

| 检查 | 结论 | 证据 |
| --- | --- | --- |
| 无「现行 Manifest V2 描述」 | **PASS** | 7 份文档中 V2/manifests 字样只剩「旧对象不读不迁移」「V2 描述已过期」两类否定句（`ARCHITECTURE:101`、`STORAGE-LAYERS:121,150`） |
| 无真实桶名 | **PASS（本批 7 份）** | 7 份文档 grep `local-lake-hebei/image-store-hebei/joplin-s3-hebei/local-image-lake/siyuan-qiniu-hebei` = 0；`ARCHITECTURE §4.5` 已换成 `<your-bucket>` 占位 |
| SecretBox 现状 | **PASS** | `MOBILE-AI:359` 明确「两处实现…统一尚未执行」，不再宣称单一实现 |
| 五格 Dock / 工作区胶囊 术语 | **PASS** | guide 侧 README/01/07/08 全部区分；docs 侧 `MOBILE-DESIGN:195/208/211` 与实现一致（§0.3 见 A3） |
| ⌘1–5 | **PASS** | 13 章与 `useDesktopLifecycle.ts:115` 一致；16/17 章引用 ⌘3/⌘4 一致 |
| README 文档表 = 单一来源 | **PASS（有条件）** | README 已缩为「入口」并声明唯一索引在 `docs/HANDOFF.md`；**前提**是 HANDOFF §1「文档地图（现存）」确实覆盖全部 docs —— 该地图当前未列入 `DIARY.md / AI-WRITING.md / RELEASE-NOTES.md / TAG-SYSTEM-DESIGN.md / MOBILE-SHEET-EXCEPTIONS.md`（见 §6-3） |
| 15 条技巧无编造数值 | **PASS** | 文中出现的数量型断言（90 天 / 260ms / ≤4GiB / 默认 24h / 上限 16 / 默认 8 / 1.2 万字 / 4 万字 / 20 篇）全部有代码或契约出处（§2.1、§3.2） |
| `git diff --check` | **PASS** | 两批改动均无空白错误（r0 批次自检；复核时抽查无尾随空白） |

---

## 5. 复核命令（可复跑）

```bash
export PATH="$HOME/.nvm/versions/node/v24.18.0/bin:$PATH"
cd "$(git rev-parse --show-toplevel)"

# 1) 链接 + 仓内路径存在性（138 篇 md；跳过已删除的 INK-DEVICE-CHECK）
R=$PWD node /tmp/doclint.mjs     # 脚本见附录 A；输出 brokenLinks / missing / guide chain

# 2) 改名与语义
grep -rc '资料库' guide/*.md README.md | grep -v ':0'   # 期望无输出
grep -n '五格 Dock\|工作区胶囊' guide/README.md guide/01-getting-started.md

# 3) 快捷键 / 设置分类 / 设置项（对单一来源）
sed -n '26,40p' guide/13-shortcuts.md;  sed -n '110,120p' src/hooks/useDesktopLifecycle.ts
sed -n '5,6p' guide/12-settings.md;     sed -n '574,584p' src/components/app/SettingsPanel.tsx
sed -n '33,46p' src/mobile/settings/settingsMenu.ts

# 4) 架构文档
grep -n 'Manifest V2\|manifests/latest' docs/ARCHITECTURE.md docs/STORAGE-LAYERS.md
grep -rn 'local-lake-hebei' docs/*.md
grep -n 'treeRepository\|24k 行级' docs/ARCHITECTURE.md
grep -n 's3v3Keys' docs/SYNC-PROTOCOL.md

# 5) 章节链（含未跟踪新章）
for f in guide/1*.md; do printf '%-28s ' "$(basename $f)"; sed -n '3p' "$f" | grep -o '下一章：\[[^]]*\]([^)]*)' || echo '(no next)'; done
```

---

## 6. 需 lead 决策 / 跨批事项（不属于 r0-guide / r0-arch 的失职）

1. **R0-1 的「HANDOFF 压缩」未落**：`git status` 无 `docs/HANDOFF.md` 修改（HANDOFF 仍 176KB，§0 占 83%）。r0-arch 的 task-8 范围不含 HANDOFF，需另派或 lead 自行收口。
2. **真实桶名仍有 1 处**：`docs/HANDOFF.md:511`（「真实七牛桶…Bucket local-lake-hebei…测试前缀 lakex-notes-dev3-portabletest2」）。7 份审计文档已脱敏，HANDOFF 是唯一残留；建议在压缩 HANDOFF 时顺带脱敏（把桶名/前缀换成 `<bucket>`/`<prefix>`）。
3. **README 的单一来源指针依赖 HANDOFF §1 文档地图的完整性**：该地图未登记 `DIARY.md / AI-WRITING.md / RELEASE-NOTES.md / TAG-SYSTEM-DESIGN.md / MOBILE-SHEET-EXCEPTIONS.md`。若要「真的只有一份」，HANDOFF 压缩时把这几篇补进 §1 地图。
4. **A3（MOBILE-DESIGN §0.3）**：建议放 R1（与本批 R0 风险无关，但会误导读设计文档的人）。
5. **A4（SYNC-PROTOCOL:62）**：r0-arch 已经改了同一文件（删 s3v3Gc），这条 1 行改动可顺手补；若本批不收口，记 R1。

## 7. 复核限制（未覆盖）

- 未运行任何测试/构建（只读复核）；「IPC 187 通道」为间接核实（HANDOFF 记录 + parity 测试存在），未实跑计数。
- `SYNC-DEVICE-CONTRACT.md` 仅按 diff 核对（改动 3 行），未逐段通读全文。
- 未复核 `docs/audit-261112/*` 其它分册、未复核 task-9/10/11/12 的代码产出（不在本任务范围）。
- 未验证 guide 截图（31 张）是否与新版界面一致（截图更新在方案里是 P2「可后补」）。

---

## 附录 A：本次使用的校验脚本（`/tmp/doclint.mjs`，一次性，不入库）

```js
import fs from 'node:fs'; import path from 'node:path'; import { execSync } from 'node:child_process';
process.chdir(process.env.R || process.cwd());
const files = execSync('git ls-files "*.md"', { encoding: 'utf8' }).trim().split('\n')
  .filter(f => f && fs.existsSync(f) && !f.startsWith('vendor/'));
const pathRe = /(?:^|[\s(\[`'"|])((?:docs|guide|scripts|src|electron|public|build|patches|android)\/[A-Za-z0-9._\-\/\u4e00-\u9fff]+\.(?:tsx|ts|md|mjs|json|css|png|kt|sh|yml|html))/g;
const linkRe = /\[[^\]]*\]\(([^)]+)\)/g;
// 1) markdown 相对链接 → existsSync；2) 正文仓内路径 → existsSync；3) guide 章节 prev/next 链
```

判读注意：`android/.../XxxPlugin.kt` 这类**带省略号的行文简写**会被脚本当成路径命中，属假阳性（5 条），复核时已人工剔除。

## 附录 B：改动前后基线对照

| 指标 | 改动前 | 改动后 |
| --- | --- | --- |
| 失链（md 相对链接） | 3（全是语雀镜像绝对链接） | 3（未变，非问题） |
| 仓内失效路径（按上述正则） | 46 | **32**（其中 7 份审计文档内仅 1 条：SYNC-PROTOCOL:62；其余在 LAKEX-CONTRACT/HANDOFF/audit-261027 等本批范围外文档） |
| guide 提及「日记/AI 写作/便携包/更新中心」的文件数 | 0 / 0 / 0 / 0 | 6 / 8 / 7 / 4 |
| guide 章数 | 15 + README | 19 + README |
| 「资料库」在 guide 出现行数 | 8 行 / 6 文件 | **0** |
| ARCHITECTURE 失效文件索引 | 3 个（quickNotesSync/s3Maintenance/BoardCard） | 0（新增 1 个 treeRepository，见 A1） |
| ARCHITECTURE 真实桶名 | 5 个 + 账号说明 | 0（占位化） |
