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
| **写域** | `src/mobile/sync/maintenanceLocks.ts` 的 `writeLock` | 本地写：saveNote / 目录树 CRUD / 小记 / 历史 / 回收站 / 孤儿资产 / GC 账本；**以及同步引擎的 DB 片段**（经 `syncDbPort` 的 `withWriteLock` 短锁） | 可与网络阶段**并行**；同域内串行 |
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
- `src/mobile/sync/maintenanceLocks.test.ts` —— 维护域被占满时写域仍立刻完成（F16 机制回归，CI 可跑，不必上模拟器）；
- `src/mobile/data/syncDbPortBatchGuard.test.ts` —— 批窗口内被本机编辑的笔记不被远端覆盖；
- `electron/maintenanceQueueScope.test.ts` —— 桌面维护队列只包维护操作（反向护栏）。

**弱网实测（261010 已收尾，验收通过）**：`adb emu network delay|speed gprs`（7.0 KB/s ↓ / 3.5 KB/s ↑ / 35–200ms）；
整轮同步 **59.3s**，**同步中的本地写等待 32ms**（基线写 84ms）⇒ **写等待/同步时长 = 0.001**（旧实现 ≈1.00：152.0s/152.3s）。
装置：`node scripts/mobile-f16-acceptance.mjs`（会新建 2 篇 `F16 验收 A/B` 探针，按 AGENTS §4 不自动删）。
计时入口 = `window.lakeNative.syncNow()` / 本地写 + 页内 `performance.now()`。**回归门禁**为 CI 可跑的 `mobile/sync/maintenanceLocks.test.ts`（不必上模拟器）。

## 三、跨端能力矩阵（单一来源）

| 面 | 数量 | 载体 | 说明 |
| --- | --- | --- | --- |
| 桌面 IPC | **121** | `electron/preload.cjs` | 桌面渲染层的能力面 |
| 移动实现本体 | **76** | `src/mobile/bridge.ts` 的 `bridge` 对象 | 互斥域判据按此表登记（261020 移动端批 +createBitable；ink 批 +createInk 等；261010 收窄：删死方法 `uploadObject`） |
| 移动调试契约 | **50** + 2 | `window.lakeNative`（`src/mobile/native/lakeNativeContract.ts`，**从实现派生**） | CDP/真机自动化入口（261020 +createBitable 供造数/验收）；+2 = `runNativeSqliteSpike` / `migrateSnapshotToNativeSqlite` |
| 移动性能探针 | 2 | `window.__lakePerf`（reset / snapshot） | 资产传输耗时观测 |

### 契约面「归属」分类（261010：`bridge` 不再是「70 个方法没人知道谁在用」）

`bridge` 同时是**共享契约 `window.lakeNative` 的移动端实现**（类型面 `src/lib/native.ts`，共享组件用 `native.X()` 调）
与移动端 UI 的内部 API。每个方法必须至少有**一类归属**：

| 类 | 数量 | 判据 | 含义 |
| --- | --- | --- | --- |
| **T1 移动端 UI 直接调** | **50** | `src/mobile/**`（非测试）出现 `bridge.X(` | 移动端自己的界面在用（261020 +createBitable） |
| **T2 共享契约** | **9** | 共享代码（非 mobile、非测试）出现 `native.X(` | 两端都跑的组件会调 ⇒ 移动端**必须实现**。成员：`createQuickNote` `getNoteInfo` `readAssetPreview` `previewHistorySnapshot` `openAttachment` `saveAssetAs` `cleanupHistory` `listS3GcPending` `uploadResource` |
| **T3 自动化 / 调试契约** | **5** | `scripts/**` 出现 `.X(` 或登记在 `lakeNativeContract.ts` | 供 e2e 脚本与真机手工调试。成员：`saveQuickNote` `saveQuickNoteWithImages` `trashNote` `restoreNote` `listTrashed` |
| **T4 测试观测/播种口**（显式登记，只许变小） | **7** | 三类都没有，但写在 `contractSurface.test.ts` 的 `TEST_SEAM` | **去向已定（261010）**：生产走 `gcRepository` 直调与 `dbPort`，这几个只是再暴露一份；现存单测借它**播种+观测**验证真实行为（GC 分批删除 / 维护队列写 / 墓碑发布 / folder 防复活）⇒ **保留并登记，不许增长** |

**护栏** `src/mobile/contractSurface.test.ts`：无归属方法必须登记进 `TEST_SEAM`；`TEST_SEAM` 只许变小；`lakeNative` 声明必须是 `bridge` 的子集。
⇒ **新方法不写清用途就直接失败**，从机制上阻止契约面无声增长（"上帝对象"的真实成因是契约面，不是文件行数）。

⚠️ 判据是**静态扫描**（`bridge.X(` / `native.X(` / 脚本 `.X(`），**别名调用会漏判** —— 本轮就漏过一个
（`scripts/e2e-f06-android.mjs` 用 `api.listTrashed()`，差点把在用的方法判成死方法）。**删除前必须人工复核全部引用形式，别只信扫描。**

移动端**已无"整类只读"的文档类型**：doc 交给 Lake 编辑器，表格（usheet，§五#9）、画板（board，§五#9 附）、
多维表（bitable，§五#10，261020 起）都已接入移动编辑。**这不等于与桌面功能等齐** —— 各类型的功能缺口见 §五#9/#10 与 §八。

## 四、数据与同步约束

- 本地是唯一真相，S3 只是镜像；墓碑、回收站、恢复语义与桌面一致。
- 当前 Lake Manifest 为 **V1**（260928 重置），所有端必须一起升级。
- 资源存在性按远端清单差集；下载按实扫 size+sha256 复用本地文件。
- `note_history` 仍需补齐 `refs_json`/`protected_until`，纳入真机验收。
- **保存正文不改树归属**（261020 实测 bug 修复）：`noteRepository.saveNote` 的 UPDATE 用 `parent_id=COALESCE(?, parent_id)`。
  自动保存 / 「完成」只关心正文、不传 parentId，旧实现直接写 `parent_id=?` ⇒ 每保存一次就把文档从笔记本里摘出来
  （parent_id 变 NULL：目录里找不到、笔记本计数下降）。**显式移动必须走 `moveTreeNodeOrdered`**（那才是树操作）。
  回归护栏 `bridgeTree.test.ts`「保存不改树归属」。
- **返回首页要刷新列表**（261020）：首页是 keep-alive 常驻层，`MobileApp` 在 route 从 notebook → home 时补一次
  `refreshAll()`（否则在工作区新建/编辑后回首页，笔记本计数与「最近文档」还是旧值 —— 用户报的「计数不涨」）。
- **secret 不落 WebView 存储**：Android Keystore 保管密钥（`SecureStorePlugin.kt` + `src/mobile/native/keystoreSecretStore.ts`），
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
4. **可编程入口 = `window.lakeNative`（50 方法）+ `window.__lakePerf`**：自动化验收（含 F16 计时）全靠它；
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

   **落地结构（261014 P1–P3 收口，新增代码按这个分层放）**：
   `editSurfaceModel.ts`（纯函数算术，带单测）→ `useEditSurface.ts`（**编辑面唯一 owner**：外壳高度 / 面板状态机 /
   输入法抑制 / 焦点守卫）→ `EditorDock.tsx`（只做渲染 + 命令 + 选区簿记）。
   内核几何（按视口 or 按桌面写死的高度/上限/限宽）**只有一份收口**：`editor/edit-surface-kernel.css`，
   宿主契约 = 编辑面容器挂 `data-mb-edit-host` + `data-mb-kernel="note|doc"`（新增编辑面挂上即继承）。
   **判据装置**：`node scripts/css-audit/drive.mjs <port> scripts/mobile-audit/edit-surface-invariants.mjs` ——
   两条编辑器各跑 I1 几何恒定 / I2 光标存在 / I3 光标在工具栏上方 / I4 面板不自关·无闪。
8. **移动端 Univer 必须用移动 UI 插件族**（261019 实测定稿）：`UniverSheetsCorePreset` 自带的是桌面
   `UniverUIPlugin` / `UniverSheetsUIPlugin`，其 selection service 会把单指横拖当成多选范围（实测选成
   B12:D12），既不会滚动也不符合触屏习惯；必须成套替换为 `UniverMobileUIPlugin` +
   `UniverSheetsMobileUIPlugin` + docs/numfmt/formula/drawing 的 mobile UI 插件（见
   `src/mobile/usheet/mobileUniverPreset.ts`）。移动版语义 = 单指拖动滚动、点按选一个单元格、拖选区控制点扩选。
   移动 Workbench footer 保留（编辑面/工作表标签需要）；阅读态用 `.mobile-usheet.is-readonly` 隐去浮动按钮，顶部工作表标签栏保留但隐藏「＋」。
   **编辑态的两颗官方浮动钮要校位**：`bottom-14` 会被视觉视口推到容器下沿（实测只露出半颗、点按落到网格），
   用 `transform: translateY(-40px)` 整体上移；顶栏已有插入/格式后，再隐藏「打开表格工具」圆钮，只留「键盘」，
   完整官方动作面板从顶栏「••• → 更多表格工具」打开（`display:none` 的按钮仍可被程序 click）。
   **凡是可横向拖动的自有内容（表格/多维表/画板）必须挂 `data-prevent-swipe`**：外壳 `usePanelDrag` 在
   `touchstart` 阶段按 `closest()` 排除，绝不能让内容横滑被外层拉成目录/大纲抽屉；命中目标可能是 **SVGElement**，
   所以排除判据必须用 `Element`，不能只认 `HTMLElement`。设备验收：AVD `lake_gate` 上表格左右拖从 A–D → D–G、
   右拖回 A–D，抽屉均不出现；多维表左拖 scrollLeft 0 → 346、右拖不拉抽屉；画板右拖画布平移且抽屉不出现。
9. **移动端 usheet 编辑（261019 P1 第二刀：语雀式编辑面 + 新建）**：
   - **新建**：目录「新建 → 新建表格」已解禁；`bridge.createUsheet()` 用共享的 `emptyUsheetBody()`（50×16）落
     `doc_kind=usheet`，建完直接进编辑态。（当时数据表/画板仍未接移动编辑器；261020 起数据表解禁，见 §五#10。）
   - **顶栏**：不使用 Univer 桌面 Ribbon（会把横拖判成扩选）；自绘一条常驻工具条，按钮全部走 facade：
     插入（行/列/合并）、撤销/重做、粗/斜/下划线/删除线、文字格式面板（对齐/字体色/填充色/清除）、更多（删行/删列/
     官方动作面板）。右侧绿点 = 自动保存状态。工具条不挂 `pointerdown preventDefault`（Android WebView 会连 click 一起吞）。
   - **布局动作（261020 P1 第一批）**：「更多」面板新增三组 —— **冻结窗格**（冻结至当前行 / 至当前列 / 取消冻结）、
     **行高**（+8 / -8 / 自动行高）、**列宽**（+24 / -24）。实现全部走 Univer facade（`setFrozenRows/Columns`、
     `cancelFreeze`、`get/setRowHeight`、`autoFitRow`、`get/setColumnWidth`），纯逻辑在
     `src/mobile/usheet/usheetLayoutActions.ts`（单一来源 + 单测；行高/列宽有下限 16/32，Univer facade 没有"自动列宽"）。
     设备实测：冻结至当前行 ⇒ 正文 `freeze.ySplit=5`；行高 +8 ⇒ `rowData[4].h=32`；列宽 +24 ⇒ `columnData[1].w=112`；
     自动行高置 `ia:1`；取消冻结 ⇒ `xSplit/ySplit=0`。
   - **数字格式（261020 P1 第二批）**：「更多 → 数字格式」= 常规（清除）/ 文本 / 数字（两位小数）/ 整数 / 百分比 / 货币（¥）/
     日期 / 时间 / 日期时间，共 9 档（选项表单一来源 `src/mobile/usheet/usheetNumfmt.ts`）。运行时能力来自
     `@univerjs/sheets-numfmt` 给 `FRange` 追加的 `setNumberFormat(pattern)`（facade mixin）：
     调用前先判 `typeof range.setNumberFormat === "function"`，**缺失时明确 toast 提示、不静默 no-op**。
     设备实测：B1=1.5 选「数字」⇒ 正文 `styles[..].n.pattern="#,##0.00"` 且格 `s` 指向它；B3=21.5 选「百分比」⇒
     公式栏显示值实测 **`2150.00%`**、正文 pattern `0.00%`（Univer numfmt 渲染链路正常）。
   - **剪贴板：未做（试过并回退）**：`sheet.command.copy/cut/paste` 经 `executeCommand` 派发时返回 true 但**无效果**
     （依赖内核自己的剪贴板 data 通道，移动 WebView 拿不到原生 copy/paste 事件）；要支持需接 Android ClipboardManager
     + 内核可编程剪贴板服务（单独立项）。**不要**放一排点了没反应的按钮。
   - **公式栏**：移动 UI 插件不渲染内置 formula-bar，自绘 `地址 + 显示值` 条（编辑态显示，随选区/命令刷新）。
   - **手势**：内容区 `data-prevent-swipe` + `Element` 命中；单指横拖只滚动画布，不拉目录抽屉（设备实测 A–D ↔ D–G）。
   - **保存**：`Event.CommandExecuted` 600ms 防抖写回；点「完成」、关标签、返回首页用 `onCapture` 同步取
     `book.save()` 的最新 workbook。阅读态 `setEditable(false)` 且不显示工具条/公式栏。
   - **独立画板（kind=board）**：目录「新建画板」已解禁；`bridge.createBoard()` 用 `emptyBoardBody()` 落
     `boards/{id}.board.json`，建完直接进编辑态。`MobileBoardViewer` 支持 `editing`：编辑态 `readOnly=false` 并恢复
     Drawnix 工具条（`.mobile-board-viewer.is-editing .draw-toolbar`），800ms 防抖 + `onCapture` 与 usheet 共用
     `liveBodyCapturesRef`；完成/关标签/返回首页都会同步取最新 body。
   - **画板视口记忆（261020 P1）**：缩放/平移是**本机 UI 状态**（`features/board/boardViewStore`，localStorage L3，
     与桌面同一份存储）；**不进正文、不标脏、不进 S3**。打开时：有记忆 ⇒ `fitOnInit=false` 并喂 `plaitViewport`（缩放），
     平移 = **滚动画布容器**（盯 `.viewport-container`，滚动合并 200ms + 松手立即落盘）；无记忆才自适应内容。
     设备验收：把画布滚到 800/499.8 → 重启 App 重开仍为 800/499.8，且 `boards/*.board.json` 逐字节未变。
   - **画板内联图片走资产管线（261020 P1）**：与桌面共用 `features/board/boardImageAssets` 的纯函数，移动端只注入两个能力 ——
     读回 `native.readAssetPreview`（资产 URL → data URL，内存口径；引擎导出/预览不吃跨源 CORS）、
     上传 `bridge.uploadResource`（data URL → `note-assets/{noteId}/`，磁盘口径 = canonical 资产 URL）。
     **提升在途不保存**（否则会把 `data:image` 写进正文）；单张失败保持内联（不丢图），完成后自动补一次保存。
     设备验收：种入内联 PNG → 进编辑态 ⇒ 正文变为 `http://127.0.0.1:19876/{noteId}/<磁盘名>.png` 且资产文件落盘；
     再切两次编辑态 ⇒ 资产文件仍 1 个、正文不变（不重复上传）；重开后引擎里是 `data:image`（hydrate 生效）。
   - **已知**：移动端 `purgeTreeItem` 不清理 `note-assets/`（正文/历史会删；本机图片目录残留，等孤儿资源清理或手动删），
     261020 验收时已顺手清理测试残留。
   - **父节点兜底（261020 用户报「新建后目录不出现」）**：`createParent` 空串时回退 `notebookId`；
     `bridge.createNote/createUsheet/createBoard` 把空白 parentId 视为缺失并走 `defaultNotebookId()`。
     `noteRepository.createNote` 已支持 `kind` 参数，避免再建出 `parent_id=''` 的孤儿。
   - 设备实测：新建表格/画板即编辑；表格双击公式栏、粗体/插入行落盘；画板矩形工具可绘制并落盘
     `boards/{id}.board.json`；横滑不拉抽屉；官方动作面板可从「•••」打开。
   - ⚠️ 仍待后续：CardResizer 触控调高、复制粘贴/公式库的移动专有交互。
     **画板剩余**：AI 徽标（**移动端还没有 AI 通道** —— 首页「AI 助手」仍是"尚未接入"提示，接画板 AI 要先立 AI 通道项目）。

10. **移动端多维表编辑（261020 P0：新建 + 查看/编辑 + 字段与记录基础增删改）**：
    - **新建**：目录「新建 → 新建数据表」已解禁；`bridge.createBitable()` 用 core `emptyBitableBody()`
      （1 文本列 + 3 条空记录），`doc_kind=bitable`，建完直接进编辑态（与表格/画板同一条创建通道 + 空父兜底）。
    - **编辑形态（用户 261020 确认）**：**点单元格 → 打开该记录的底部面板**逐字段编辑（不是原地把格子变输入框）。
      理由：触屏 + IME 下原地输入要处理滚动/键盘/格尺寸，且单选/多选/日期/评分/进度在触屏上都需要弹层（飞书/语雀移动端同族做法）。
      **布尔值快路径**：网格里单击直接切换，不弹面板。
    - **字段**：顶部「字段」面板 = 重命名 / 删除（确认框 + 说明全视图配置一并清除；只剩一列时拒绝）/ 新增（P0 九种类型：
      文本·数字·日期·单选·多选·复选框·链接·评分·进度）。单选/多选可在记录面板里新建选项（同名复用、新建即选中）。
    - **记录**：表尾「＋ 新增记录」（建完即开面板）；记录面板底部「删除记录」（确认）。**无撤销**（与桌面删记录同语义）。
    - **只读字段**：附件 / 图片 / 关联 / 系统时间 / AI / Markdown 在移动端只读并**写明理由**（不提供"建得出来但改不了"的字段入口）。
    - **正文语义**：与桌面同一份 core 写入纯函数（`core/bitableMutations`）；序列化恒写 canonical 导航（第一表 / 第一视图）
      ⇒ 切数据表/视图是**设备本地 UI 状态**，不写正文、不落盘、不进 S3。**bitable 正文 JSON 绝不给 Lake 编辑器**。
      导航的读写/应用是**单一来源** `features/bitable/bitableNavStore.ts`（桌面 `BitableEditor` 与移动端共用；
      localStorage 键 `lake-notes-v3.bitable-nav.<noteId>`），切表只写导航、重开回到上次那张表。
    - **行窗口**：记录全集留在模型里，只限制挂载行（100 条/页 + 显式「加载更多」；不静默裁剪）。真实虚拟滚动视设备表现再定（P1）。
    - **已知边界（P1 清单）**：复制/剪切/粘贴、公式库、数字格式、排序/筛选/分组、填充柄、附件/关联编辑、撤销重做、
      视图切换与视图配置、真实虚拟滚动。`docs/BITABLE-VIEWPORT.md` 的桌面行窗口契约不因本条改动。
    - 护栏：`mobile/bitable/mobileBitableEdit.test.ts`（canonical / 字段与记录写入 / 窗口 / 取值口径）、
      `mobileBitableViewer.test.ts`（编辑态部件 + 100/120 分页 + 阅读态不出现编辑件）、
      `mobileBitableRecordSheet.test.ts`（按字段类型给对控件 + 不可编辑字段给理由）、
      `workspaceMenu.test.ts`（五类创建项全部可点、数据表建完进编辑态）、`bridgeTree.test.ts`（createBitable 落库/树/空父兜底）。


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
| 文档类型 | 表格(usheet) / 画板(board) / 多维表(bitable) 均已接入移动编辑（261020 起多维表可编辑；缺口见 §五#10 P1 清单） |

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
`components/ui/settingsPrimitives`（设置页 Group/Item/Seg/Block/NumField/Switch）·
`features/quickNotes/{QuickNoteEditor,QuickNotePreview}`（含 `quickNoteToolbarWidgets` 的表情选择器）·
`features/bitable/FileKindIcon`（文件类型图标）· `components/model/treeDrag`（拖拽逻辑与 DOM 混合）·
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

## 十、撤销 / 重做后端（261017 定稿）

> 起因：用户报「手机撤销点了没反应 / 文档不能多次撤销」。方案对标思源（`siyuan-android-main` 只是安卓壳，
> 撤销逻辑在 Web 包：`siyuan-master/app/src/protyle/undo/*` + `app/src/mobile/util/keyboardToolbar.ts`）。

**两个后端，按编辑器类型切换**（`EditorDock` 的 `undoBackend`）：

| 后端 | 用于 | 实现 | 按钮判据 |
| --- | --- | --- | --- |
| `kernel` | 保留（默认，当前两端都未启用） | lakex `history` + `undo/redo` 命令；执行前先提交 IME 组合 | `queryCommandEnabled('undo'/'redo')`，不可用**置灰** |
| `snapshot` | **文档 + 小记**（261017 用户定） | `src/mobile/editor/useSnapshotUndo.ts` + `snapshotUndoModel.ts`（思源 `LocalUndo` 式前端栈） | 栈的 `canUndo/canRedo` |

**为什么小记必须用 snapshot**：note-mini 编辑器里**键入不进 kernel history**（设备实测 `canUndo=false`；改成文档版式 / 不传 `quickNoteUi` 结果相同），只有格式化命令进历史 ⇒ 输入撤销无从谈起。snapshot 按「输入停顿 450ms」记 `text/lake` 快照（条数 40 + 总字符 8M 双上限），撤销/重做 = `setDocument` 恢复。

**两条硬约束**：① 恢复快照会触发 contentchange ⇒ 必须用 applying 标记忽略（否则自己给自己压栈）；② 内容相同不压栈（组合输入期间 contentchange 会重复触发）。护栏：`snapshotUndoModel.test.ts`（纯逻辑 6 例）+ `execCommand.test.ts`（命令入口唯一性）。

**光标还原（两层，缺一不可）**：
1. **内核模型选区**（权威）：`setDocument` 会把内核选区重置到文档开头 ⇒ 只改 DOM 时“看得见的光标在编辑点、但下一个输入仍按模型选区插入到开头”（用户 261017 两次报同一现象）。快照因此同时记录 `document.selection.toJSON()`，恢复时用内核 job 的 `setSelectionFromJson` + `commitJob` + `repaintSelection` 放回模型选区（`src/mobile/editor/kernelSelection.ts`）。
2. **DOM 光标 + 滚动**：`{blockId, offset}` 记录 + 重试 4 次找回可见光标，并保存/还原 `.ne-editor-wrap` 滚动位置。
设备实测：小记 `abc → 撤销 → ab → 输入 Z = abZ`；文档 `abc → 撤销 → ab → 输入 Z = abZ`（修复前两者都是 `Zab`/`Z…`）。

**容量**：小记 `DEFAULT_LIMITS`（40 条 / 8M 字符）；文档 `DOC_LIMITS`（25 条 / 4M 字符，快照序列化更贵）。**重做按钮在横滑区末位**，默认在屏外，滑一下可见（261017 用户已接受该布局）。

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