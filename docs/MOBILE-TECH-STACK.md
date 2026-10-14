# 移动端技术栈与架构规格

> 本文是移动端**唯一架构规格**。运行方式 / AVD / CDP / 验收见 `HANDOFF.md` §8；
> 长期红线与机制见 `AGENTS.md`；内核（lakex）行为契约见 `docs/LAKEX-CONTRACT.md`。
> 移动端是**正式端之一**（Capacitor Android，包名 `com.lakenotes.mobile`），桌面红线同样适用。

## 一、三层边界，以及"每层用哪种复用方式"

这两件事必须一起写清楚 —— 历史问题不是"没有分层"，而是**同一层里混用了两种复用哲学却无判据**。

| 层 | 是什么 | **复用方式** | 明确不做 |
| --- | --- | --- | --- |
| **原生层**（Capacitor 插件，Kotlin） | `AssetServer.kt`（本机资源 HTTP + 图片转换）、`AssetSyncPlugin.kt` + `AwsV4Signer.kt`（S3 流式，字节不过桥）、`OpenFilePlugin.kt`、`SharedContentPlugin.kt`、`PinShortcutPlugin.kt` | **只做服务、零 UI**（对齐语雀 Native「重服务轻 UI」）；只暴露能力，不做业务判断 | 不在原生层放业务/UI；不新增 UI 型插件 |
| **移动端外壳 UI**（`src/mobile/**`） | `MobileApp` / `HomePage` / `NotebookWorkspace` / `SettingsDrawer` / 抽屉与手势 | **整份各写**：移动与桌面外形差异是实质的（只读闸门 / 焦点闸门 / 资源 URL 带 token / 无工具条），强行抽公共 runtime 只会变成参数化分支 | 不把桌面外壳抽给移动端 |
| **共享编辑器宿主**（`src/features/editor/**`） | `LakeEditor` / `lakeRuntime` / 图片预览 / 附件路由 | **参数化共享 + 零平台分支**：差异经 `LakeEditorPrefs` 与注入函数传入（实测该层 `isMobile/Capacitor` 分支 = 0） | 不在共享层写 `if (isMobile)` |
| **共享核心**（`src/core/**`） | 同步引擎、决策纯函数、命名/哈希/尺寸校验 | **只上收"策略/决策"，不上收实现**；由跨端对拍测试保证等价 | 不合并两端的 schema / repository（AGENTS §3#17 已否决） |
| **UI 与样式**（移动端 `src/mobile/**` 的组件 + CSS ↔ 桌面 `src/styles/**` 与 `kit.css`） | 面板、工具栏、色板、浮层的**外形与几何** | **两端各自拥有，不共享**（用户 261012 定稿） | 不把桌面设计系统的样式/组件/几何套给移动端，也不把移动端几何反向塞回桌面 |

**规则一句话：策略与判据上收进 `src/core`（用跨端对拍证明等价）；实现与界面留在各端。**
**第二句（261012 用户定稿）：`AGENTS §3#14` 那套设计系统（`--lake-*` 令牌 / `kit.css` 的 `ln-*` 原语 / Overlay 浮层原语 / `!important` 上限 / 层序 `@layer`）
是**桌面端的规则**，不自动约束移动端**；移动端要有自己的适配与 UI 规则（当前方向：照语雀 App）。
**两端只共享"必要逻辑"** —— 命令字典（`editorCommands`）、色板**数据**（`core/colorPalette.ts`）、
应用语义（`colorApplyCommand`/`colorMemory`）、链接判定（`linkEditor`）、`core` 策略；**不共享样式与组件**。

**本条的首个实例（261012）**：移动端色板不再用桌面的 `LakeColorBoard` 适配器，改为 `EditorDock` 自画**语雀式 2×7 圆点格**
（几何实测自语雀：直径 37dp / 列距 52dp / 行距 48dp），**只共享** `core/colorPalette.ts` 的颜色数据与 `colorApplyCommand` 的清除/无填充语义。
取证见 `docs/LAKEX-CONTRACT.md` §5.33。**后续凡遇"桌面已有同类件"的移动端 UI，一律按本条办**（不共享、不自造颜色/语义）。

护栏：`scripts/check-core-boundaries.mjs`（`check:core`）卡住 `src/core/**` 零平台依赖；
`src/mobile/mobileLazyChunks.test.ts` 卡住桌面编辑器不得进移动包。

## 二、互斥域：写域 / 维护域（F16，261010 定稿）

判据单一来源 = **`src/core/maintenancePolicy.ts`**（71 个桥操作全量登记：`write` / `maintenance` / `none`）。

| 域 | 实例 | 收什么 | 关键约束 |
| --- | --- | --- | --- |
| **写域** | `src/mobile/maintenanceLocks.ts` 的 `writeLock` | 本地写：saveNote / 目录树 CRUD / 小记 / 历史 / 回收站 / 孤儿资产 / GC 账本；**以及同步引擎的 DB 片段**（经 `syncDbPort` 的 `withWriteLock` 短锁） | 可与网络阶段**并行**；同域内串行 |
| **维护域** | 同文件 `maintenanceQueue` | 轮次级网络与维护：`syncNow` / `gcDeepCleanup` / `ensureTrashNoteAssets` | 彼此串行；**禁止持有写域** |

三条不变量：

- **I1（F16）**：网络往返期间不得持有写域。历史缺陷：两域共用一条 `key="main"` 的队列 ⇒ 弱网下本地写等整轮同步 **152.0s**（基线写 32ms）。
- **I2**：跨网络窗口的「读 → 标记/落地」必须靠**"未变才标/未变才应用"守卫**（内容 hash 比较），不靠全局互斥。
  已落地：Lake 侧 `markSyncedIfUnchanged`（V5 §5.2）；小记侧 `markSyncedIfUnchanged`（本次新增，两端引擎优先用）；
  下载侧 `syncDbPort.flushNoteBatch` 的批窗口守卫（批窗口跨网络取内容 ⇒ 窗口内被本机改过的笔记推迟远端应用）。
- **I3**：两条队列都**无重入** ⇒ 禁止在同域内再取同域（会自锁）。写域短锁按"一次端口调用进出各一次"，网络往返不在其中。

护栏（改这里必跑）：

- `src/core/maintenancePolicy.test.ts` —— 分类完备 / 域不相交 / 计数基线；
- `src/mobile/maintenancePolicyCoverage.test.ts` —— 桥方法集合与判据表一致、调用点类别一致、**I3 同域嵌套静态卡死**；
- `src/mobile/maintenanceLocks.test.ts` —— 维护域被占满时写域仍立刻完成（F16 机制回归，CI 可跑，不必上模拟器）；
- `src/mobile/syncDbPortBatchGuard.test.ts` —— 批窗口内被本机编辑的笔记不被远端覆盖；
- `electron/maintenanceQueueScope.test.ts` —— 桌面维护队列只包维护操作（反向护栏）。

**弱网实测（261010 已收尾，验收通过）**：`adb emu network delay|speed gprs`（7.0 KB/s ↓ / 3.5 KB/s ↑ / 35–200ms）；
整轮同步 **59.3s**，**同步中的本地写等待 32ms**（基线写 84ms）⇒ **写等待/同步时长 = 0.001**（旧实现 ≈1.00：152.0s/152.3s）。
装置：`node scripts/mobile-f16-acceptance.mjs`（会新建 2 篇 `F16 验收 A/B` 探针，按 AGENTS §4 不自动删）。
计时入口 = `window.lakeNative.syncNow()` / 本地写 + 页内 `performance.now()`。**回归门禁**为 CI 可跑的 `mobile/maintenanceLocks.test.ts`（不必上模拟器）。

## 三、跨端能力矩阵（单一来源）

| 面 | 数量 | 载体 | 说明 |
| --- | --- | --- | --- |
| 桌面 IPC | **121** | `electron/preload.cjs` | 桌面渲染层的能力面 |
| 移动实现本体 | **70** | `src/mobile/bridge.ts` 的 `bridge` 对象 | 互斥域判据按此表登记（261010 收窄：删死方法 `uploadObject`，71→70） |
| 移动调试契约 | **49** + 2 | `window.lakeNative`（`src/mobile/lakeNativeContract.ts`，**从实现派生**） | CDP/真机自动化入口；+2 = `runNativeSqliteSpike` / `migrateSnapshotToNativeSqlite` |
| 移动性能探针 | 2 | `window.__lakePerf`（reset / snapshot） | 资产传输耗时观测 |

### 契约面「归属」分类（261010：`bridge` 不再是「70 个方法没人知道谁在用」）

`bridge` 同时是**共享契约 `window.lakeNative` 的移动端实现**（类型面 `src/lib/native.ts`，共享组件用 `native.X()` 调）
与移动端 UI 的内部 API。每个方法必须至少有**一类归属**：

| 类 | 数量 | 判据 | 含义 |
| --- | --- | --- | --- |
| **T1 移动端 UI 直接调** | **49** | `src/mobile/**`（非测试）出现 `bridge.X(` | 移动端自己的界面在用 |
| **T2 共享契约** | **9** | 共享代码（非 mobile、非测试）出现 `native.X(` | 两端都跑的组件会调 ⇒ 移动端**必须实现**。成员：`createQuickNote` `getNoteInfo` `readAssetPreview` `previewHistorySnapshot` `openAttachment` `saveAssetAs` `cleanupHistory` `listS3GcPending` `uploadResource` |
| **T3 自动化 / 调试契约** | **5** | `scripts/**` 出现 `.X(` 或登记在 `lakeNativeContract.ts` | 供 e2e 脚本与真机手工调试。成员：`saveQuickNote` `saveQuickNoteWithImages` `trashNote` `restoreNote` `listTrashed` |
| **T4 测试观测/播种口**（显式登记，只许变小） | **7** | 三类都没有，但写在 `contractSurface.test.ts` 的 `TEST_SEAM` | **去向已定（261010）**：生产走 `gcRepository` 直调与 `dbPort`，这几个只是再暴露一份；现存单测借它**播种+观测**验证真实行为（GC 分批删除 / 维护队列写 / 墓碑发布 / folder 防复活）⇒ **保留并登记，不许增长** |

**护栏** `src/mobile/contractSurface.test.ts`：无归属方法必须登记进 `TEST_SEAM`；`TEST_SEAM` 只许变小；`lakeNative` 声明必须是 `bridge` 的子集。
⇒ **新方法不写清用途就直接失败**，从机制上阻止契约面无声增长（"上帝对象"的真实成因是契约面，不是文件行数）。

⚠️ 判据是**静态扫描**（`bridge.X(` / `native.X(` / 脚本 `.X(`），**别名调用会漏判** —— 本轮就漏过一个
（`scripts/e2e-f06-android.mjs` 用 `api.listTrashed()`，差点把在用的方法判成死方法）。**删除前必须人工复核全部引用形式，别只信扫描。**

移动端**只读**范围（不写正文、不进 S3 正文）：表格（usheet，Univer 只读）/ 多维表 / 画板。doc 交给 Lake 编辑器。

## 四、数据与同步约束

- 本地是唯一真相，S3 只是镜像；墓碑、回收站、恢复语义与桌面一致。
- 当前 Lake Manifest 为 **V1**（260928 重置），所有端必须一起升级。
- 资源存在性按远端清单差集；下载按实扫 size+sha256 复用本地文件。
- `note_history` 仍需补齐 `refs_json`/`protected_until`，纳入真机验收。
- **secret 不落 WebView 存储**：Android Keystore 保管密钥（`SecureStorePlugin.kt` + `src/mobile/keystoreSecretStore.ts`），
  密文进应用私有 SharedPreferences；`localStorageSecretStore` 只在 Web/vitest 作后端，并负责把历史值迁移过去。
  设备验证（261010）：冷启动后 `skLen 40`、连通 OK、`localStorage` 里已无 secret。
  背景：同一台 AVD 实测 localStorage 跨重启仍在、**IndexedDB 重启后被重建为空**；固定派生密钥的 WebCrypto 方案只是"混淆"不是硬件级保护。

## 五、运行时硬约束（实测，长期有效）

1. **WebView 存储只有一半可靠**：localStorage 跨 App 重启仍在；IndexedDB 重启后库被重建为空
   （`app_webview/Default/IndexedDB/http_localhost_0.indexeddb.leveldb` 目录还在、库消失、`onupgradeneeded` 再次触发）。
   ⇒ 任何持久化（尤其密钥）都不要信 WebView 存储。历史缺陷：S3 密钥每次重启丢失、同步报 `signature mismatch`。
2. **CDP 的 `Page.captureScreenshot` 抓不到 GPU canvas 层**：usheet 网格在页面截图里整片空白，而同屏 `canvas.toDataURL()` 完整、
   `adb exec-out screencap -p` 正常 ⇒ 移动端验收**一律设备级截图**，否则误报「表格空白」。
3. **keep-alive 的隐藏视图仍在 DOM**：自动化导航与可见性判据必须带命中测试（`elementFromPoint`），只查 `querySelector` 会点到不可见元素。
4. **可编程入口 = `window.lakeNative`（49 方法）+ `window.__lakePerf`**：自动化验收（含 F16 计时）全靠它；
   换架构也必须保留等价入口（否则验收退回手工）。
5. **弱网可复现**：模拟器 `-netdelay gprs -netspeed gprs`（≈80kbps / 500ms RTT）。
6. **一个内核消费者必须自带宽样式**：内核 CSS 目前由消费者模块 import（桌面 `styles/index.css`、移动 `editor/DocumentEditor.tsx`、
   移动 `home/QuickNoteComposer.tsx`）。历史缺陷：小记作为冷启动后**第一个**内核消费者时渲染成大图标 + 原生 file input。
   改动装载/入口时必须重新验证这一条。
7. **面板不让视口变矮（只有输入法会）⇒ 外壳高度必须"钉住"**（261014 定稿，实测见 HANDOFF §8 该批）：
   adjustResize 下输入法把 WebView 压矮（842→530），而我们自己的面板（fixed 占键盘区）**不改视口** ⇒
   任何以视口高为基准的盒子在「键盘 ⇄ 面板」切换时都会变高变矮（实测写作卡 320 → 428 = 用户报的"编辑区跳动"）。
   口径（三条，缺一条就会复现）：
   ① **稳定外壳高** `viewportShell.ts`（单调取历史最大值 = 键盘收起时的高）→ `EditorDock` 用 **useLayoutEffect**
      写 `--mb-app-h = 稳定高 − 底部占用` 到 `:root`；`html, body, #root, .mobile-app` 都用它（无编辑 dock 时退回 `100%`）。
   ② **编辑面的滚动容器只留工具栏的固定留白（80px）**，不要再把"面板/键盘占位"重复加进 padding（那是外壳的职责）。
   ③ **内核按 vh 写的定高必须换基准**（`ne-doc-note-editor … min-height:40vh` → `calc(var(--mb-app-h,100%) * 0.4)`，
      见 `docs/LAKEX-CONTRACT.md` §5.37）；新增编辑面/面板时按这条自查。
   另外：**光标跟随**统一走 `useCaretIntoView`（文档与小记同一份；它同时监听 `selectionchange/pointerup/resize`，
   因为浏览器自己的"把光标滚进视口"是**按视口**算的，会把光标停在面板/键盘后面）。

## 六、未结项（登记的债，改前先看）

| 项 | 现状 | 影响 |
| --- | --- | --- |
| **移动端样式依附桌面设计系统** | **261012 review 已立项**：移动端入口引了 **10 个桌面样式表**，组件里用 ln-* 原语 **53** 处 / config-* **61** 处，自有样式仅 4 文件 1359 行 ⇒ 实质是"桌面样式之上的一层覆盖" | 桌面改令牌/原语会**连带改到移动端**，移动端无法按触屏独立演进。**审计、判据与重构清单见 §九**；安卓端样式重构按 §9.4 顺序推进 |
| ~~内核资源本地化插件两份~~ | **已收口（261010）**：单一来源 `scripts/lakexLocalize.ts`，两端传入各自 CSP；移动端同时补上 CSS `@import` 兜底 | — |
| ~~CSP `script-src` 含 `unsafe-inline` / `unsafe-eval`~~ | **已收紧（261010）**：内联 KITCHEN_URL 只按 **sha256 hash** 放行（hash 与桌面 prod 相同）；两个 unsafe 均已去掉。设备验证零违规，护栏 `mobileCspSingleSource.test.ts` 重算 hash 比对 | — |
| ~~SecretStore 非硬件级~~ | **已换 Android Keystore（261010 设备验证通过）**：`SecureStorePlugin.kt` + 迁移层；localStorage 降为 Web/vitest 后端 | — |
| ~~内核预热/复用~~ | **已测并给出结论（261010，AVD `lake_mobile`）**。**三条路径对比**（`scripts/mobile-coldopen-breakdown.mjs`，每次 `Page.reload` 重置 keep-alive 后量真挂载，页内 `performance.now()`）：**深链小记（无内核）88/65/82ms** · 首页小记写作卡（内核）656/412/290ms · 打开文档（内核）427/366/347ms；**内核 chunk 加载/求值仅 27ms**。另：冷启动 Activity 490ms、keep-alive 热切换 ≈73ms。⇒ **结论：不立项预热/池化** —— 单 WebView 无池可建；不挂内核的小记已秒开；内核路径瓶颈在**实例化与首帧**（chunk 只 27ms），复开已由 keep-alive 覆盖（73ms）。数据留表不再投工 | ✅ 已收口 |
| ~~`envAdapter` 只用 1/N~~ | **已收口（261010）**：外链端到端实测**正常**（点后前台切到 Chrome）⇒ `openLink` 不必接；`longPressCard` 官方语义是「使用方自实现 UI」⇒ 我方自写手势等价、保留。见 `LAKEX-CONTRACT §5.27`（含一次误判的修订记录） | — |

## 七、小记预览渲染：快路径 + 内核只读兜底（261010 定稿）

**问题**：小记正文是标准 lake 标记，而**内核的格式集合是开放的**（每升级一次内核就可能多几种卡）。
自研只读解析器（`src/features/quickNotes/quickNotePreviewParser.ts`）不可能穷举 ⇒ 只要它不认识某种卡，
那条小记在时间线里就「显示不出来」（261010 的真实案例：日期 / 表情 / 表格 / 高亮块 / 分栏）。

**方案（两条路，判据单一来源）**：

| 路 | 何时走 | 代价 |
| --- | --- | --- |
| **快路径**（`QuickNotePreview` 的 DOM 渲染） | 解析器能**完整还原**正文（文字/标题/列表/待办/引用/分割线/媒体卡） | 零内核实例（移动端冷开不受影响） |
| **内核只读兜底**（`QuickNoteKernelPreview`） | 解析结果里出现任意 `unsupported` 节点 | 一条 viewer 实例；**只给进入视口的卡片挂**（`IntersectionObserver`，提前 400px 预挂载，离开即销毁） |

- 判据 = `hasUnsupportedNodes(parseQuickNotePreview(body))`（**解析器自己的输出**，不另立卡片清单 —— 两份必然漂移）。
- 兜底 = `createLakeDocument(host, "viewer", …)` + `editor.setDocument("text/lake", addAssetAccessToken(body))`，
  与文档阅读态（EditorTab 锁定 / 回收站预览）**同一条内核路径**；`destroyLakeEditor` 收尾。
- ⇒ **格式覆盖度由内核保证**，不存在「我们没实现所以显示不出来」的格式。
- 配套：「+」插入面板 = **内核全量**（`quickNoteInsertFilter` 已删）：面板全量 24 项 / 1294px 高 ⇒ 手机上必须夹进视口并改锚点
  （`body.lake-mobile`；该修正在 261012 收尾时随 `mobile-kit.css` 退场一并收编进 `src/mobile/mobile.css`，见 `LAKEX-CONTRACT.md` §5.28）。
- ⚠️ **移动端小记没有插入面板入口（用户 261010 定稿，别再提议加回）**：紧凑工具条 = 用户指定的九项（不含加号），
  且移动端不展开 ⇒ 面板按钮不存在；而 `/` 斜杠在本构建**不可靠**（§5.23 实测 + 261010 复测 keydown/insertText 都没唤起）。
  ⇒ 表格 / 代码块 / 公式 / 高亮块 / 分栏 / 折叠块 / 画板 / 思维导图 / 日历 / 文档引用 在移动端小记里**插不了**
  （**显示**不受影响：预览走内核兜底 §七上半；桌面写作卡可展开进面板）。

**设备实测（261010，AVD `lake_mobile`）**：面板插入「日期 + 表情」→ 保存 → 时间线卡片由内核渲染
（`.quick-note-kernel-preview` 内 `ne-card[data-card-name=dateCard|unicodeEmoji]`，显示「📅 10月10日」）；
同屏另 2 条纯文字小记仍走快路径（兜底计数 = 1、残留占位条 = 0）。护栏 `quickNoteKernelFallback.test.ts`。

## 八、移动端 Lake 能力覆盖矩阵（261010 实测；装置 `scripts/mobile-lake-coverage.mjs`）

> 问题：桌面端 Lake（lakex 内核）能输入的东西，移动端能不能**展示**、能不能**编辑**。
> 口径（用户 261010 定）：移动端的输入面**只有底部 dock** —— **`/` 斜杠面板在移动端不可触发（小记与文档都不能）**，
> 所有工具栏都走 dock 那条路。实测：隔离桌面实例（dev1 前缀）+ 模拟器 App，夹具经 **S3 真实链路**送达
> （桌面 16 篇 → `lake-notes-dev1` → 移动端拉取应用 17 篇 / 4.55MB；图片·PDF·音频·视频用 `~/Documents` 真实文件）。

**移动端输入面（设备实测枚举）**

> ⚠️ **261013 按代码重数（原文的 6/11/17 是 261010 的旧态，已过期）**：以下三行为当前实测。
- dock 主条 **7 项**：插入 / 字体 / 加粗 / 列表 / 待办 / **更多** / 收起键盘
- `＋` 插入面板 **18 项 / 5 组**：图片与文件（图片·拍照·附件）· 文本块（表格·引用·分割线·代码块·高亮块·状态，2 行）·
  媒体｜布局（音频·视频 ｜ 分栏·折叠块）· 小工具（日期·表情·日历）· 关联（链接·文档引用）
- `更多` 面板 **6 项**：公式（可用）+ 画板·流程图·UML·思维导图·文本绘图（disabled 占位）
- `Aa` 字体面板：7 行分组卡（段落样式 / 行内标记 / 列表 / 块级 / 对齐 / 历史 / 字色 + 内联色板 + 字号 8 档）
- **不存在**：内核固定工具栏（`showToolbar: !editing` ⇒ `disabledPlugins:["save","toolbar"]`，`.ne-ui-toolbar` 计数 0）、
  块悬浮手柄与选区浮栏（两者都是 opt-in prefs，移动端没传 ⇒ 宿主计数 0）、`/` 面板、
  第三方服务嵌入（双端都被 `lakeRuntime.ts` 过滤）

**展示：无缺口** —— 逐项设备实测全部正常渲染：H1–H6、粗/斜/下划线/删除线、行内代码、字色、背景色、字号、对齐、
上标/下标、链接、无序/有序/待办列表、表格（`table.lake-table`）、代码块、分隔线、状态、公式、日历、日期、表情、
折叠块、分栏、图片、附件、音频、视频、画板、流程图、UML、思维导图、文本绘图、文档引用。

**编辑缺口（桌面能输入、移动端没有任何入口）**

| 类 | 缺的项 |
| --- | --- |
| 文本格式 | H5/H6、字号、字色、背景色、对齐、缩进、行高、清除格式、格式刷、链接 |
| 插入项 | 分栏卡片、折叠块、画板、流程图、UML 图、思维导图、公式、文本绘图、日历、日期、表情、文档引用 |
| 块级操作 | 整块复制/剪切/删除、转化为其它块、拖拽移动、整块/多块选中、添加间距、全屏/宽度 |
| 文档类型 | 表格文档(usheet) / 多维表(bitable) / 画板(board) 在移动端是**只读查看器**，不能编辑 |

**待确认（1 项，不要当结论用）**：某篇内容以 `<h1>` 开头、缺 `-body` 段落的文档，出现过「标题栏是该篇、正文却是空折叠块」；
同内容补 `-body` 段后移动端正常，桌面渲染该篇一直正常，设备 DB 内容完好（**无数据损坏**）。
自动化未稳定隔离（App 恢复 8 个 keep-alive 标签页会干扰判据）⇒ 需人工复核一次。
## 九、移动端 UI / 样式独立性：审计、判据与重构清单（261012 review）

> 用户 261012 定稿口径：**移动端要有自己的适配与 UI 规则，仅共享"必要逻辑"；不能共享样式和 UI。**
> 本节是这条口径的**取证（实测计数）+ 判据 + 不变量**；**执行方案（P0–P7 任务书 + 皮肤取值表 + IA 冻结清单）见 `docs/MOBILE-UI-REDESIGN.md`**。
>
> ⚠️ **范围别读偏（261012 用户澄清）**：这里的"分叉"指**皮肤层与页内交互形态**，**信息架构 / 页面层级冻结**（小记·知识库 第一层 → 笔记 第二层这种结构不动）；**弹层从居中对话框改底部 Sheet 这类页内交互属于允许范围**。三层划分与 IA 清单见 `MOBILE-UI-REDESIGN.md` §1 / §2。

### 9.1 先把口径拆成三层，否则规则不可执行

| 层 | 例 | 判据 |
| --- | --- | --- |
| **① 内核 UI** | lakex 自己的类与控件：`.ne-*`、`FrameworkUiLib`、`.lake-colorboard`、内核卡片/浮层 | **必须共享**（两端跑同一个内核；它不是我们的设计系统） |
| **② 我们的逻辑 / 数据** | `src/core/**`、`src/lib/**`、`features/editor/editorCommands`（命令字典）、`core/colorPalette`（颜色数据）、`colorApplyCommand`/`colorMemory`/`linkEditor`（应用语义） | **应当共享** —— "仅共享必要逻辑"指的就是这一层 |
| **③ 我们的 UI 与样式** | `src/styles/**`（`--lake-*` 令牌、`kit.css` 的 `ln-*`、`compat.css`、`dialog.css`、`components.css`…）、`src/components/**` 的 UI 件 | **不得共享**，各端自有 |

### 9.2 审计结论（261012 实测计数）：现状是 ③ 被大面积共享

| 证据 | 实测 |
| --- | --- |
| `src/mobile/main.tsx` 直接 import 的**桌面样式表** | **10 个**：`themes/{base,light,dark,warm}` · `tokens.css` · `compat.css` · `kit.css` · `components.css` · `dialog.css` · `app/quick-notes.css`，另加 `features/{editor/image-lightbox,attachment/attachment-preview}.css` |
| 移动端 tsx 里使用的**桌面原语类名** | `ln-*` **56 处 / 10 文件**、`b3-*`·`fn__*` **8 处 / 3 文件**（桌面会话独立计数）；本会话按前缀扫描得 `ln-*` 53 / `config-*` 61 ⇒ 两口径都远大于 0 |
| **反向耦合**（桌面为移动端开的分支） | `kit.css` **18 行** `:is(.app-shell, .mobile-app)` + `tokens.css` 1 条注释 = **19 行**（桌面会话发现）⇒ 解耦是**双向**的 |
| 移动端**自有**样式 | 只有 **4 个文件 / 1359 行**：`mobile.css` 935 · `editor/editor-dock.css` 267 · `editor-dark.css` 85 · `mobile-kit.css` 72 |
| 桌面样式体量（参照） | 53 个文件 / **8770 行** |
| `mobile-kit.css` 的定位 | 头注释自述"组件外观的单一来源仍是 `styles/kit.css`，这里只做移动端**必要覆盖**" ⇒ 移动端被建成**桌面样式之上的一层覆盖**（AGENTS §3#14 禁止的"层压层"，在双端之间放大了一版） |

**移动端引用的桌面 UI 件（③ 类，重构要拆）**：
`components/settingsPrimitives`（设置页 Group/Item/Seg/Block/NumField/Switch）·
`features/quickNotes/{QuickNoteEditor,QuickNotePreview}`（含 `quickNoteToolbarWidgets` 的表情选择器）·
`features/bitable/FileKindIcon`（文件类型图标）· `components/treeDrag`（拖拽逻辑与 DOM 混合）·
`features/editor/selectionToolbar/kernelUiAtoms`（`KLinkEditor`：渲染的是**内核** UI，属 ① 与 ③ 的边界件）。

**移动端引用的逻辑（② 类，保留）**：
`src/core/**`（14 个模块）· `lib/{types,settings,nativeErrors,assetPort,native,localStorageSafe,lakeEmojis,lakeEmojiGroups}` ·
`features/editor/{lakeRuntime,LakeEditor,editorCommands,resourceUpload}` · `selectionToolbar/{selectionToolbarModel,colorMemory,linkEditor}` ·
`features/attachment/attachmentPreviewController` · `features/usheet/*`。

### 9.3 判据（重构后要满足的不变量）

1. `src/mobile/**` **不得 import `src/styles/**`**（① 内核样式与字体资源除外）。
2. `src/mobile/**` **不得 import `src/components/**` 的 UI 件**；`ln-*` / `config-*` / `b3-*` / `fn__*` **不得出现在移动端 JSX**。
3. 跨端 import 只允许 **② 类白名单**（`src/core/**`、`src/lib/**`、内核宿主与命令字典、颜色数据与颜色/链接语义），**逐条登记**，新增走评审。
4. 字体文件（MiSans / JetBrains Mono）属**资源**不是设计系统 ⇒ 可共享，但移动端的字号/行高/密度必须由移动端令牌决定。

### 9.4 落地顺序

**见 `docs/MOBILE-UI-REDESIGN.md` §6（P0 护栏 → P1 令牌/皮肤 → P2 原语 → P3 浮层 → P4 样板屏 → P5 逐屏迁移 → P6 组件变体化 → P7 收口）。**

两条与本节的接口：
- **类名前缀 = `mb-*`**（实测 `.mb-` 占用 0；`md-*` 与既有 `.md-preview` 撞族；`mobile-*` 已被外壳 278 处占用，只把原语放 `mb-*`）。
- **令牌名沿用 `--lake-*`（共享词表），取值由移动端 `src/mobile/theme/**` 定义** —— 护栏卡的是「移动端不得 import 桌面 `themes/**`」，而不是「不许出现 `--lake-*`」。
- 本节的 ③ 类"不得共享"**不追溯**已完成的合理共享（如内核样式），只约束后续新增与本次重构。

## 验证

```bash
node node_modules/vite/bin/vite.js build --config vite.mobile.config.ts
bash scripts/android-build.sh --sync --install
bash scripts/emu-up.sh            # AVD lake_mobile（Pixel 6 / API 36 / arm64）
bash scripts/emu-cdp.sh 9335      # -> http://127.0.0.1:9335/json/list
bash scripts/mobile-preview.sh
npm run check:mobilesnap          # 6 态视觉基线
```

真机重点：图片/附件、V1 同步、编辑保存、键盘安全区、长文档大纲、剪贴板。