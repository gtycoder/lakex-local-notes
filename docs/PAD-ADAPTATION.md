# PAD-ADAPTATION.md — 平板（Android 平板 + 后期 iPad）适配调研

> **261102 调研 + 逐批落地**。§0–§7 是调研（用户裁决前的方案分析），§8 工具栏路线，§9「新开 pad 端」评估，**§10 = 逐批落地记录，也是当前唯一的 pad 规格**（原计划「落地后并入 MOBILE-DESIGN 再删本文」**改为长期保留**：平板外壳的几何/层序/触达例外细节都在这里，动平板先读 §10 最新一批）。§0–§9 里的「建议」仍未全部实施；**与 §10 冲突时以 §10 为准**（例：§3.3/§3.6 写「正文限宽 760 居中」，十三批已按用户口径改为「正文满宽 + 阅读内距 32」）。
> 依据 = HEAD `a8abcdab`（§8 时 HEAD 已到 `6433153a`：另一会话已提交 PDF 插件与手写板 v2，并在改 ink 未提交；§8 以 `6433153a` 为准，§1–§7 保持 `a8abcdab` 口径）。落地时把结论吸收进 `docs/MOBILE-DESIGN.md` / `docs/MOBILE-TECH-STACK.md` / `scripts/mobile-audit/README.md`，本文删除（仓规：研究/计划不建 archive）。

---

## 0. 结论摘要

> **iOS 现状（261102 核对，别误读本文标题）**：仓库**没有 `ios/` 工程**（`capacitor.config.ts` 的 appId 只服务 Android，`com.lakexlocalnotes.ios` 只是预留 bundle id）。iPad / iPhone **当前没有可运行的端** ⇒ 本文所有 iPad 内容都是**调研与预留**，不是已实现、也不是「下一步就能适配」：前置是**先建 iOS 壳工程**（Capacitor iOS + BodyStore / AssetServer / SecureStore / SQLite 的 iOS 端口 + 签名分发），属独立工程批；在那之前**不做任何 iPad/iPhone 专项实现**（本批所有实测都在 Android 平板 `lake_tab`）。

1. **现状 = 「大号手机」**：`src/mobile` 宽度断点 **0 条**（唯一 `@media` 是占位）；平板只有 7 条 CSS（内容限宽 760 + 设置页 440），IA 与全部几何按 412×842 手机冻结。原生已有 `smallestScreenWidthDp>=600` 判据和 `lakeDevice` 桥，但只够「加一个类」。
2. **三个硬伤**（会真坏，不只是难看）：
   - ① 平板判据绑死 Android 原生桥 ⇒ **iPad / 浏览器永远拿不到平板态**（`deviceProfile.ts` 无桥直接 return）。
   - ② 设置子页被平板规则压成 440 宽且子页无遮罩 ⇒ 左边一条白板、右边露出首页（回收站/历史/外观/AI/S3 全在这一层）。
   - ③ 判据用**设备属性**（`smallestScreenWidthDp`）而不是**窗口宽度** ⇒ 分屏 / Slide Over / Stage Manager / DeX 下必然判错；配套的 `shellHeight` 单调取最大值且只在方向变化时重置 ⇒ 窗口一缩小就可能**永久判成「键盘打开」**。
3. **业界没有第三套 IA**，只有两条主流：① 平板直接跑**桌面 UI**（思源：按 UA 把 Pad 路由到 desktop bundle，另有「桌面模式」开关）；② 保留**手机版式 + 常驻侧栏/双栏**，栏数按宽度分档（Notion 横屏常驻侧栏、Obsidian 按尺寸分档、Bear 三栏逐级收起）。**没有一家为平板造第三套信息架构。**
4. **建议**：手机 IA 冻结不变；按**容器宽度**分三档（compact <600 / medium 600–799 / expanded ≥800），medium 做「体面单栏」（限宽 + 浮层收敛 + 修缺陷），expanded 做「双栏工作区」（左树常驻 + 正文，≥1100 可选右栏大纲）。iPad 属独立工程批（Capacitor iOS + 三个原生端口），布局复用同一套断点。
5. **必须先裁决 3 件事**（§4）：平板是否允许双栏（要动 mobile IA 定稿）；双栏态底部胶囊的去留；首页在 expanded 的形态。
6. **二轮补充（§8，用户定调「pad 适配核心 = 工具栏」）**：内核工具栏（Lake）**开开关就能用**、画板/手写板几乎免费；**表格 ribbon 与 Univer 桌面 UI 插件焊死**（0.5–3 人日只能拿到部分）；**多维表要按桌面规格重做**（5–7 人日）。全量「工具栏向桌面看齐」粗估 **12–20 人日**，分四期。

---

## 1. 现状（本仓已验证）

### 1.1 已有的平板接入点

| 环节 | 现状 | 位置 |
| --- | --- | --- |
| 原生判据 | `smallestScreenWidthDp >= 600`（注释自称「与思源同口径」）；`onConfigurationChanged` 时重推给 Web | `android/app/src/main/java/com/lakexlocalnotes/android/MainActivity.kt:129-142` |
| 原生桥 | `lakeDevice.isTablet()`（`@JavascriptInterface`） | 同上 `:193-195` |
| Web 入口 | `installDeviceProfile()`：有桥 ⇒ 写 `body.lake-tablet`；**无桥（iPad / 浏览器）⇒ 直接 return** | `src/mobile/native/deviceProfile.ts:1-21` |
| 平板样式 | 7 条：内容 `max-width:760` 居中、设置页 `min(92%,440px)`；注释写明「不改信息架构」 | `src/mobile/mobile.css:1231-1238` |
| 宽度断点 | **0 条**（其余 `@media` 只有 `prefers-reduced-motion`） | `src/mobile/mobile.css:5` 等 |
| 安全区 | 原生只采 top/bottom；横屏左右只靠 `env()` | `MainActivity.kt:85-87`、`src/mobile/native/safeAreaInsets.ts:14-15`、`src/mobile/theme/tokens.css:267-268` |
| 键盘/外壳高 | `useKeyboard` 双通道（innerHeight + visualViewport）；`shellHeight` **单调取最大值**，只在 `orientationchange` 重置 | `src/mobile/hooks/useKeyboard.ts:41-52`、`src/mobile/hooks/viewportShell.ts:14-49` |
| 方向 | Manifest 未锁方向；`configChanges` 含 orientation/screenSize/smallestScreenSize（不重建 Activity） | `android/app/src/main/AndroidManifest.xml:13-20` |

### 1.2 尺寸事实（手机口径，全部按 412×842 标定）

| 项 | 值 | 位置 |
| --- | --- | --- |
| 顶栏 / 底栏 / 胶囊槽 | 44 / 56 / 48 | `tokens.css:259-261` |
| 控件高 / 触达最小 / 页内距 / 阅读内距 | 44 / 44 / 16 / 20 | `tokens.css:235-246` |
| 抽屉（目录 / 设置） | `min(86%,360px)` / `min(86%,360px)` | `mobile.css:561-577`、`:394-412` |
| 底部 Sheet / ActionSheet / MenuSheet | 全宽（left:0;right:0）、`max-height:90dvh` | `floating.css:34-36,80,141` |
| 首页 | 横向分页舞台（两页并排 + scroll-snap） | `mobile.css:113-121,665` |
| 编辑面板 | 高 `max(键盘高, 280)`、上限 60dvh | `src/mobile/editor/editSurfaceModel.ts:54`、`editor-dock.css:101` |
| 插入面板 | 3 列 / tile 4 列、格子高 52 | `editor-dock.css:136-147` |
| 手写板纸面 | `width: min(100%, (100dvh - 202px) * 0.707)` | `src/mobile/ink/inkPad.mobile.css:80` |
| 快照基线 | 412×842 / dpr 2.625，6 态 | `scripts/mobile-audit/README.md:173`、`baseline/mobile-snap.json` |

### 1.3 平板下会坏 / 会难看（按严重度）

| # | 现象 | 机制 | 位置 |
| --- | --- | --- | --- |
| 1 | 设置子页变 440 宽白板、右露首页 | `body.lake-tablet .mobile-settings-page`(0,2,1) 压过 `--full`(0,1,0) 的 `width:100%`；子页不渲染遮罩 | `mobile.css:1233` vs `:408`；`SettingsDrawer.tsx:264` |
| 2 | iPad / 浏览器无平板态，1280 下正文一行拉满 | 无 `lakeDevice` 桥即 return | `deviceProfile.ts:16-20` |
| 3 | 窗口缩小后可能永久判「键盘打开」 | `shellHeight` 单调最大值 + 仅方向变化重置 ⇒ 分屏/自由窗口缩小时 `shell - innerHeight > 8` 永真 | `viewportShell.ts:33-49`、`useKeyboard.ts:38-41` |
| 4 | 首页顶栏右侧不再贴右（1280 空约 336px） | `.mobile-topbar` 无 `justify-content`；`.mobile-home-tabs` 是 `flex:1` 且被平板规则限宽 760 | `mobile.css:40-42,665,1237` |
| 5 | 全宽浮层变 1024 宽横条 | `.mb-sheet` / `.mb-actionsheet` 全宽、子菜单 `100vw` | `floating.css:34-36,80,177` |
| 6 | 插入/新建面板格子被拉宽（1024 下每格≈250×52） | 固定 3/4 列 + 面板通栏 | `editor-dock.css:90-92,136-147`、`floating.css:194` |
| 7 | 抽屉每次遮 65% 屏，与「抽屉不长期驻留」契约反向（无侧栏形态） | 抽屉固定 360 + 全屏遮罩 | `mobile.css:558-577` |
| 8 | 手写板横屏纸面塌到 400×566，左右各约 300 空白 | 纸面按高度换算宽度 | `inkPad.mobile.css:80` |
| 9 | 小记卡 728 宽一行字；AI 气泡 ≈880 | 单列卡 + 760 限宽；AI 页 `inset:0` + 88% | `mobile.css:182,1236`；`ai/ai.css:8,56-57` |
| 10 | 多维表画册固定 2 列、卡片列硬编码 1/2（1024 下每卡≈490） | 栅格列数写死 | `bitable/mobileBitable.css:414-419,100-101`、`MobileBitableViewConfigSheet.tsx:117-121` |
| 11 | 横屏刘海/手势条在左右，无原生 inset | 原生只采 top/bottom | `MainActivity.kt:85-87` |

### 1.4 会挡住适配的既有契约 / 门禁

- **入口分工定稿**（`AGENTS.md` §4 移动端条）：首页胶囊 = 搜索/＋/AI（3 项）；工作区胶囊 = 文档树/标签页/大纲/切换笔记本（4 格）；「抽屉不长期驻留」。**双栏要动它 ⇒ 需用户裁决（§4）**。
- **外壳结构冻结**：`docs/MOBILE-DESIGN.md:125`（外壳）、`:163`（＋ 4 列、格宽 93）、`:167`（面板高度与工具栏位置不改）。
- **移动端样式层计数只许降**：`src/mobile/mobileLayers.test.ts:64` 逐文件声明数硬上限（mobile.css 1522 / kit 568 / editor-dock 258…），且扫描器**递归进 `@media`**（`:146-151`）⇒ 新增平板规则必须按「新增交互形态」登记理由。
- **静态门禁**：`check:mobileui` = 3 个 test + `ui-metrics`（字号字面量 ≤49、`!important` 18 条、桌面类名 0）。
- **快照只有手机 6 态**：无 ≥600 视口 ⇒ 平板回归完全不可见；基线依赖 `lake_gate` + 固定夹具。
- **两端 UI 不共享**：不得把桌面壳/桌面样式搬进移动端（`mobileIndependence.test.ts`）。

---

## 2. 外部对照

### 2.1 平台硬约束（官方口径）

| 平台 | 约束（已核实的硬事实） | 对本项目的含义 |
| --- | --- | --- |
| Android 窗口档 | androidx `WindowSizeClass` 源码常量：**宽 Compact <600dp / Medium 600–839 / Expanded ≥840**（高另有 <480 / 480–899 / ≥900）。窗口尺寸要用 **WindowMetrics / WindowSizeClass** 读，不是设备级 `smallestScreenWidthDp` | 三档阈值可用；判据必须能随窗口变化（分屏/自由窗口/DeX/折叠） |
| Android 多窗口 | 分屏、自由窗口、折叠展开都会改窗口宽度；手势条/刘海 insets 四边都可能非 0 | 现在的「设备级判据 + 只采 top/bottom inset + shellHeight 只按方向重置」都要改 |
| iPadOS | **Apple 不给像素档位**：只有 compact / regular 二分，且由设备 + 窗口配置 + 多任务状态共同决定；HIG 原文明确 **App 收不到多任务配置变化、也不控制它** ⇒ 只能按实际宽度连续响应，不存在「固定几种宽度」 | 与 Android 结论一致：**按容器宽度连续响应**，别按机型/设备类写死 |
| iPad 导航 | iPad tab bar 在**屏幕顶部**，并可转成侧栏；侧栏期望边缘滑动、层级 ≤2；compact 宽度下用 sheet 而不是 popover | 我们的底部胶囊在 iPad 上属自定义范式（可留，但别指望系统语义）；窄窗浮层用 sheet 合理 |
| iPad 输入 | 指针是**附加**输入、不替代触摸（hover 只做增强）；硬件键盘支持 Full Keyboard Access；Apple Pencil / Scribble；拖放支持触摸/指针/键盘三通道 | hover 只能作增强；快捷键按平台 modifier；笔迹先走 Pointer Events |
| 通用 | 不锁方向；键盘弹出时 iOS 用 `visualViewport` 收缩、Android `adjustResize` 缩 WebView | 现有 `useKeyboard` 双通道思路正确，但 iPad 需实测 |

> 注：m3.material.io 全站 JS 渲染抓不到正文，Android 官方站本环境 DNS 不可达 ⇒ 上表 Android 数值改用 androidx 源码常量核实；M3 文档里 Large 1200+/ExtraLarge 1600+ 与 canonical layouts 只见二手转述，**本项目不需要**，故不当硬约束。HIG 部分为原文链接。

来源：<https://github.com/androidx/androidx/blob/androidx-main/compose/material3/material3-window-size-class/src/commonMain/kotlin/androidx/compose/material3/windowsizeclass/WindowSizeClass.kt>、<https://developer.apple.com/design/human-interface-guidelines/layout>、<https://developer.apple.com/design/human-interface-guidelines/multitasking>、<https://developer.apple.com/design/human-interface-guidelines/windows>、<https://developer.apple.com/design/human-interface-guidelines/split-views>、<https://developer.apple.com/design/human-interface-guidelines/sidebars>、<https://developer.apple.com/design/human-interface-guidelines/tab-bars>、<https://developer.apple.com/design/human-interface-guidelines/pointing-devices>、<https://developer.apple.com/design/human-interface-guidelines/apple-pencil-and-scribble>。

### 2.2 思源（siyuan-master 3.8.4 / siyuan-android 3.8.5-alpha.5）

| 结论 | 证据 |
| --- | --- |
| **只有两套 UI**，平板不给第三套：server 按 UA 选 bundle；UA 含 `Pad` 或「Android 且无 Mobile」⇒ **desktop bundle**（注释直言「平板当桌面设备」，issue #8435/#8497）；cookie `siyuan-desktop-mode` 可强制切 | `kernel/server/serve.go:754-787` |
| 设置里给「桌面模式」开关（原生提示重启） | `app/src/config/tabs/appearanceTab.ts:1012-1057` |
| 桌面壳宽度**不是断点切布局，而是 JS 驱动「放不下就浮动」**：编辑区最小 480、滞后 32；先收右栏再收左栏，仍不够则 `autoFloating`（右栏变抽屉），手动拖过后 `manualOverride` 锁住 | `app/src/layout/dock/responsive.ts:8-9`、`responsiveLayout.ts`、`app/src/layout/util.ts:1269-1302` |
| 面板宽度语义化：常规 232、宽面板（反链/关系图/收集箱）320 | `app/src/layout/dock/index.ts:37-38` |
| 正文宽度用**容器查询**三档：760 / 952 / 2280，>952 用 `(100cqi-760)/2` 居中、>2280 用黄金比；不监听 resize | `app/src/assets/scss/protyle/_protyle.scss:447-511`、`app/src/protyle/ui/padding.ts:8-24` |
| 移动 UI 里**没有宽度媒体查询、没有横屏 CSS、平板不会自动双栏**：单栏 + 三块 `100vw` 全屏面板（目录/大纲/设置）由边缘手势拉出 | `app/src/assets/scss/main/_mobile.scss:6-14,794-807` |
| Android 原生端只做形态色彩：平板 `smallestScreenWidthDp>=600` ⇒ **隐藏状态栏**、跳过软键盘工具栏注册、状态栏着色 no-op | `siyuan-android-main/app/src/main/java/org/b3log/siyuan/Utils.java:151-153,213-228`、`MainActivity.java:296-298`、`JSAndroid.java:813-815` |
| 笔：Android 平板用 `pointerover` + `pointerType==='pen'` 复刻悬停浮窗；无手写画布 | `app/src/block/popover.ts:318-380` |
| 移动端 hover 只在 `hover:hover` 加；`hover:none` 时放大滑块/常显滚动箭头 | `main/_mobile.scss:200,315`、`protyle/_protyle.scss:85-95` |

**可借鉴**：① 平板不造第三套 IA（要么手机、要么桌面）；② 「宽度驱动 + 滞后 + 先右后左」比「断点切布局」稳；③ 正文用容器查询限宽；④ hover/指针只做增强。
**不照搬**：① 平板=桌面 UI 的前提是**容器能同时供两套 bundle**（思源 kernel 同时 serve desktop/mobile），我们两套 UI 的数据端口不同（Electron IPC vs Capacitor 桥），不具备该前提；② 移动侧栏 100vw 全屏在平板上浪费；③ 拿 `screen.width` 当预算 + 命令式内联尺寸（`adjustLayout`）太脆；④ `user-scalable=no` 有无障碍风险（我们没抄，保持）。

### 2.3 其他笔记应用（有出处的事实）

| 应用 | 平板形态 | 侧栏行为 | 出处 |
| --- | --- | --- | --- |
| Notion | **手机版式 + 侧栏**，官方自述「向桌面化演进、未完成」 | 横屏常驻、转竖屏自动收起 | <https://www.notion.com/releases/2020-04-07> |
| Obsidian | 多栏可配，**按尺寸分档**（不是按机型） | 桌面/较大平板侧栏可见；手机/小平板默认收起，滑动或图标打开 | <https://obsidian.md/help/sidebar> |
| Bear | 三栏 Tags / Notes / Editor | 横屏左滑逐级隐藏（先侧栏再列表）；竖屏点开笔记后侧栏自动隐藏 | <https://bear.app/faq/hide-the-sidebar-and-note-list-on-mac-and-ipad/> |
| Apple 备忘录 | 系统 split view；格式面板是**非模态 sheet** | 系统侧栏 | <https://developer.apple.com/design/human-interface-guidelines/sheets> |
| GoodNotes、语雀、flomo、Craft、Heptabase、Logseq、OneNote | **未找到可核验的官方版式说明**（GoodNotes 帮助中心被 Cloudflare 拦，其余官方帮助只讲功能） | — | — |

归纳成四种形态（按适配成本排）：

| 形态 | 做法 | 适配成本 |
| --- | --- | --- |
| ① 手机布局拉伸 | 不改 IA，顶多限宽 | 最低，观感最差 |
| ② 单栏限宽 + 居中浮层（+ 可收起侧栏） | 内容 700–800 居中，Sheet 变居中卡片；侧栏常驻或抽屉 | 低（Notion 走的就是这条） |
| ③ 列表 + 正文双栏 | 侧栏常驻可收，正文限宽，右栏可选 | 中（Obsidian / Bear / 系统备忘录） |
| ④ 平板 = 桌面 UI | 平板直接加载桌面布局 | 高（需容器双 bundle，思源式，见 §2.2） |

> 注意：四家官方文档都**没写编辑器限宽数值**——「正文限宽」是我们的设计判断（§3.1），不是抄来的事实。

### 2.4 共识与分歧

- **共识**：① 栏数由**宽度**决定，不是机型（Obsidian 原文最直白）；② 竖屏收侧栏、横屏放（Notion / Bear）；③ 窄窗必须能退回单栏——因为 App 收不到多任务配置变化（HIG 原文）；④ 多任务/指针/键盘/笔都只是**附加通道**，不是替代触控。
- **分歧**：① 平板走「桌面版式」还是「手机版式 + 侧栏」——Notion 与 Obsidian 路线不同，没有统一答案；② 编辑器是否限宽（四家官方都没写，属推断）；③ 底部导航 vs 侧边 rail——iPad 原生 tab bar 在顶部且可转侧栏，Android 主流仍是 bottom bar（Material 建议 ≥600 换 rail，但移动 App 普遍保留）。
- **对本项目的启发**：我们已有「限宽 760」这唯一做对的一处（`mobile.css:1238`），P0 就是把这一处**从「平板类」扩展到「所有 ≥600 视口」**，并把浮层/抽屉/顶栏一起收口；② 的答案对我们是现成的（Notion 路线 = 保留手机 IA + 加侧栏），P1 再上双栏。

### 2.5 中国 Android 平板的坑（会直接影响验收）

| 厂商 | 已知行为 | 对我们的影响 |
| --- | --- | --- |
| 华为「平行视界」 | **未适配分栏的应用会被系统强制一分为二**（默认 1:1）——应用内看到的是被压窄的窗口；`wideSplit/squareSplit` 以 **≥600vp** 为界，比例限 1:2–2:1，可拖拽吸附 | 我们的判据若用设备级 `smallestScreenWidthDp`，此时窗口其实很窄 ⇒ 必须按**窗口宽**判据，否则会「按平板排双栏、实际只有半屏」。官方：<https://developer.huawei.com/consumer/cn/doc/doccenter-multi-device/bpta-easygo-parallel> |
| 小米自由窗口 | 需要 `resizeableActivity`；`onMultiWindowModeChanged`；尺寸取 `newConfig.bounds` / `getCurrentWindowMetrics`；`configChanges` 要含 `screenSize|screenLayout|orientation|smallestScreenSize` 防重建 | 我们 Manifest 已含这些 configChanges、未锁 `resizeableActivity`（默认 true）⇒ 不重建，**Web 必须自己响应 resize**（现在 `shellHeight` 只按方向重置 = 会踩坑，见 §1.3#3）。官方：<https://dev.mi.com/xiaomihyperos/documentation/detail?pId=1593> |
| OPPO 兼容模式 | 存在「兼容模式」开关（官方页仅证明开关存在，具体分屏规则未公开核验） | 低优先级；按窗口宽判据天然兼容 |
| 通用 | 中国厂商平板的分屏/平行视界规则各自不同，且用户可开关 | **不要按"这是华为/小米"特判**；只认窗口宽（与 §3.2 一致） |

---

## 3. 建议

### 3.1 形态模型（三档，按**窗口/容器宽**）

| 档 | 宽度（CSS px） | 典型设备（竖屏 → 横屏） | 目标形态 |
| --- | --- | --- | --- |
| compact | < 600 | 手机；Slide Over ≈320；分屏 1/3 | **现行手机布局，零改动** |
| medium | 600 – 799 | 8" Android 平板 ≈600×960；iPad mini 744×1133；分屏 1/2 | 单栏 + **内容限宽 760 居中** + 浮层收敛 + 修缺陷（「体面单栏」） |
| expanded | ≥ 800 | Pixel Tablet / Tab S9 ≈800×1280；iPad 10.9/11 ≈820–834（竖屏）；上述设备的任意横屏 | **双栏**：左栏 280–320（树/列表）+ 正文（限宽 760）；≥1100 可选右栏大纲 |

- 阈值取 800 而不是 Material 的 840：iPad 10.9/11 竖屏是 820–834，取 840 会让 iPad 竖屏落到单栏（Apple 备忘录 / Obsidian / Bear 在 iPad 竖屏都给侧栏或分栏）。8" 平板（600）只吃到「体面单栏」。
- 800 是**下限**：真正的判断看窗口，不看设备（§3.2）。
- 断言：**同一套断点同时服务 Android 平板与 iPad**，不按平台分叉（iPad 只是没有原生桥，判据走 Web）。
- 设备宽度是近似值：现场一律以 `adb shell wm size` / `wm density` 与 `window.innerWidth` 为准。

### 3.2 判据单一来源（最关键的一条）

1. **用窗口宽度，不用设备属性**。`smallestScreenWidthDp` 只说明「这是台平板」，不说明「现在窗口多宽」——分屏、Slide Over、Stage Manager、DeX 下都会错。
2. **判据放 Web**：`matchMedia('(min-width: 600px)') / '(min-width: 800px)' / '(min-width: 1100px)'`，一次性算出 `data-form-factor="compact|medium|expanded"` 写到 `<html>`（替代只由原生注入的 `body.lake-tablet`；保留类名兼容期）。
3. **原生只做提示**：`lakeDevice.isTablet()` 降级为「启动初值/遥测」，不参与布局；iPad（无桥）自然走同一 Web 判据。
4. **断点值同源**：TS 常量 + CSS `@media` 双写时必须加静态测试（扫描 `@media (min-width: Npx)` 与常量一致），否则第二份副本必然漂移（本项目已有 CSP 单源测试的前例）。
5. **加滞后**：窗口拖动/分屏拖拽时，跨档切换需要 **32px 死区**（思源同款），避免临界抖动导致反复重排。
6. **首帧不闪**：`matchMedia` 同步可读，首帧前写入属性，不依赖原生异步推送。

### 3.3 逐屏目标形态

| 屏 | compact | medium | expanded |
| --- | --- | --- | --- |
| 首页（小记/知识库） | 横滑分页（现状） | **禁横滑分页**，顶部 tab 切换；内容 760 居中；小记卡单列 | 同 medium（小记时间线保持单列限宽，长文更适合窄行宽）；知识库可选 2 列 |
| 工作区 | 单栏 + 4 格胶囊 | 单栏 + 胶囊居中、内容限宽 | **双栏**：左树常驻 280–320 + 正文；胶囊拆解（见 §4 第 2 条） |
| 目录/标签页/大纲/设置 | 360 抽屉 | 400 抽屉（overlay） | 工作区内的树常驻；其余场景仍 overlay（避免第二套导航） |
| 编辑器 Lake | 底部 dock | dock 居中悬浮（max 760） | 常驻格式条（顶或底，横向）+ 插入面板居中 560；正文 760 |
| 多维表 | 表单/表格/卡片（现状） | 卡片 2 列、表格横滚；表单居中 560 | 卡片 2–3 列；记录详情居中面板而非全屏页 |
| 表格 usheet | 移动件工具条 | 工具条限宽居中 | 同 desktop 比例，工具条常驻 |
| 手写板 | 纸面按高度换算 | 纸面 `min(宽, 高×0.707)` 取大者 | 纸面按可用区最大化；缩略图侧栏可选 |
| AI 页 | 全屏单栏 | 内容 760 居中 | 会话列表 + 会话双栏（可选 P2） |
| 设置 | 360 抽屉 / 子页全屏 | 子页 **760 居中**（修 440 白板） | 左导航 + 右内容双栏（可选） |
| 浮层 | 底部 Sheet 全宽 | **居中卡片** `min(560, 100%-32px)` | 同 medium；菜单可贴触发点（popover） |

### 3.4 浮层与面板（统一收口）

- `.mb-sheet` / `.mb-actionsheet` / `.mb-menusheet` 在 ≥600：`left:50%; translateX(-50%); width:min(560px, calc(100% - 32px)); max-height:min(80dvh,720px); border-radius:16px`——**只加几何，不改组件 API**。
- 子菜单 `100vw` → `min(360px, calc(100% - 32px))`。
- 抽屉在 medium 保持 overlay（360→400）；在 expanded 的工作区里由常驻栏取代，其余场景（设置/标签页/大纲）仍 overlay。
- 设置子页：平板规则从「440」改为「`--full` 时 760 居中」，并补回遮罩语义。

### 3.5 输入与多任务

- **笔**：iPad 用 Pointer Events（`pointerType==='pen'`，`pressure`/tilt 可用），Pencil hover（M2+）只做光标/预览增强；**先实测延迟**，PencilKit 维持 `docs/INK-PAD.md` 的「不提前引入」。Android 触控笔同理（已有 `StylusInputPlugin`）。
- **外接键盘会隐藏软键盘** ⇒ dock 的「⌨ 收键盘」在 medium/expanded 应隐藏或改语义（「收起面板」）；快捷键先做最小集（⌘/Ctrl+K 搜索、N 新建、F 查找复用 `MobileFindBar`、Esc 退浮层），modifier 按平台。
- **hover 只做增强**：`@media (hover:hover)` 才加 hover 底色；触屏保持 `:active`（现状即如此，别改）。
- **多任务**：Slide Over/分屏窄窗 → 自动回落 compact；Stage Manager/自由窗口 → 容器驱动 + 32px 滞后；**修 `shellHeight`**：窗口尺寸显著变化（非 IME）时应重置或按「两通道一致」重学基准，不能只靠 `orientationchange`。
- **中国厂商**：华为「平行视界」会把未适配应用强制压成半屏（§2.5）⇒ 判据必须按窗口宽；不要按厂商特判。

### 3.6 分期与粗估

| 期 | 内容 | 粗估 | 交付判定 |
| --- | --- | --- | --- |
| **P0 体面单栏** | 判据单一来源（§3.2）+ 三档属性 + 限宽/浮层/抽屉/顶栏收口 + 修 1.3 的 #1/#4/#5/#6/#8/#3 + 平板视口快照装置 | 1–2 天 | 800/1024/1280 下无「横条/白板/拉满」；手机 6 态基线 0 差异 |
| **P1 双栏工作区** | 左树常驻 + 正文右栏 + 胶囊拆解 + 首页禁横滑 + 编辑器工具条 + 记录详情居中 | 3–5 天 | 平板真机走查 23 屏 + 平板快照 0 差异 |
| **P2 iOS 壳工程（前置，非适配）** | 当前**无 ios/ 工程**：需先建 Capacitor iOS 壳 + `BodyStore`/`AssetServer`/`SecureStore`/SQLite 的 iOS 端口 + Info.plist/方向/Stage Manager + 签名分发；布局断点才能被真机验证 | 5–10 天 | iPad 模拟器 + 真机；数据与 Android 互通（S3 v3 不变） |
| **P3 可选** | 右栏大纲/反链、AI 双栏、设置双栏 | 按需 | 不做也能用 |

### 3.7 验证与门禁

- **装置**：给 `check-mobile-snap` 加 `--viewport 800x1280,1280x800`，走 CDP `Emulation.setDeviceMetricsOverride`（仓内已有先例：`scripts/css-audit/stylesnap.mjs:182`），基线单独 `baseline/mobile-snap-tablet.json`；**手机基线不动**，两套基线并列。
- **真机**：新增 `lake_tab` AVD（Pixel Tablet 1280×800 dp）；手测分屏、自由窗口、横竖屏、外接键盘；截图仍走 `adb exec-out screencap -p`。
- **iPad**：P2 用 Xcode Simulator（iPad Pro 11 / iPad 10.9），重点验 Slide Over 320 与 Stage Manager 拖拽。
- **静态**：`mobileLayers.test.ts` 新增规则按「新增交互形态」登记理由（只增不减的语义要写清）；`check:mobileui` 三项不破；新增「断点常量 = CSS」静态测试。
- **顺手要补的基线口径**：走查 23 屏在平板视口补一轮（新装置，不进手机基线）。

### 3.8 不做（YAGNI）

- 不做平板专属的**第二套 IA**（第三套导航/第三套首页）。
- 不做可拖拽分栏、浮动窗口、多窗口同时编辑同一文档。
- 不把桌面 Electron UI 搬上平板（数据端口不同，等于重写一端的桥）。
- 不为平板重做视觉令牌（继续 `--lake-*` / `mb-*`；平板只加布局与几何）。
- 不做 PencilKit / Jetpack Ink（`docs/INK-PAD.md` 已定「不提前增加抽象」）。
- 不做「平板全局字号放大」——正文已经 16px + 限宽，放大只会变丑。

---

## 4. 待裁决（3 件事，建议按推荐选）

1. **平板目标选型**（决定 P0 之后走不走 P1）：
   - A（推荐）**分阶段双栏**：P0 体面单栏 → P1 双栏工作区；
   - B **只做体面单栏**：成本最低，长时间内平板只是「大号手机」；
   - C **平板=桌面 UI**（思源式）：技术上可行但代价最大，粗估 **45–71 人日 + 长期第三条维护线**，拆解见 §7；不推荐作为第一版。
2. **双栏态是否允许拆工作区胶囊**：树常驻后「文档树」入口多余；「大纲」宜进右栏；「标签页」宜变顶部 tab 条；「切换笔记本」宜进左栏顶部。这需要**豁免 `AGENTS.md` 的移动端入口定稿**（只在 expanded 生效，compact 不变）。不豁免 ⇒ 双栏只能做成「抽屉常驻」，体验打折。
3. **首页在 expanded 的形态**：小记时间线保持单列限宽（推荐，长文阅读更好）还是 2 列/瀑布流；知识库要不要双栏。

> 另有一条产品问题（不急）：平板要不要一个「桌面模式/双栏开关」让用户自选？建议**先不做**，等真机反馈（思源有，是因为它有两套 bundle；我们只有一套）。

---

## 5. 证据与来源

- **本仓**：`AGENTS.md` §4 移动端入口定稿 / §7#13–#20；`docs/MOBILE-OPS.md`（构建/门禁）、`docs/MOBILE-DESIGN.md:125,163,167`、`docs/MOBILE-TECH-STACK.md`、`docs/INK-PAD.md:13,99`；`src/mobile/native/deviceProfile.ts`、`src/mobile/hooks/viewportShell.ts`、`src/mobile/hooks/useKeyboard.ts`、`src/mobile/mobile.css`、`src/mobile/floating.css`、`src/mobile/editor/editor-dock.css`、`src/mobile/ink/inkPad.mobile.css`、`src/mobile/bitable/mobileBitable.css`、`src/mobile/mobileLayers.test.ts`、`scripts/mobile-audit/*`、`android/app/src/main/java/com/lakexlocalnotes/android/MainActivity.kt`。
- **思源**：`siyuan-master/kernel/server/serve.go:754-787`、`app/src/layout/dock/{responsive,responsiveLayout,index}.ts`、`app/src/layout/util.ts:1269-1302`、`app/src/assets/scss/{protyle/_protyle.scss:447-511,main/_mobile.scss}`、`app/src/config/tabs/appearanceTab.ts:1012-1057`、`siyuan-android-main/app/src/main/java/org/b3log/siyuan/{Utils.java,MainActivity.java,JSAndroid.java}`。
- **平台/外部**：androidx `WindowSizeClass` 源码常量（600/840）；Apple HIG Layout / Multitasking / Windows / Split Views / Sidebars / Tab Bars / Pointing Devices / Apple Pencil and Scribble（URL 见 §2.1）；Notion / Obsidian / Bear 官方帮助（URL 见 §2.3）；华为平行视界、小米自由窗口官方文档（URL 见 §2.5）。

---

## 6. 变更记录

- 261102：建立（调研稿）。结论来源 = 本仓只读审计（HEAD `a8abcdab`）+ 思源 3.8.4/3.8.5-alpha.5 源码 + 平台官方口径 + Notion/Obsidian/Bear 官方帮助 + 华为/小米官方适配文档；**未做任何设备实测**（无平板模拟器真机），§1.3 的「会坏」均为代码推断，落地前须实机复核。
- 261102 追加：§7「平板=桌面 UI」代价评估（143 方法契约、鼠标优先证据、45–71 人日拆解、与 P0/P1/中间路线对比）。实测**零次**，全部为静态测量。
- 261102 二轮：§8「工具栏向桌面看齐」（用户定调）。结论：Lake 开开关 3–5 人日、画板 0.5–1、手写板 1–2、表格 0.5–3（只能部分）、多维表 5–7（复刻规格），合计 13–19 人日；含 `mobileIndependence` 围栏分析与红线豁免点。**未实测**（Univer ribbon 命中/折叠、Lake 工具栏点按钮收键盘均待实机）。另一会话已把 HEAD 推到 `6433153a`（PDF + ink v2），§8 以此为准。
- 261102 三轮：§9「新开一个 pad 端」评估。结论：**不建议本轮新开端**；按代码量（runtime 9.1k / UI 22.6k + CSS 5k / 测试 15.9k）估算新端 40–70 人日（不含 iPad / 双入口基建），而「pad 外壳层」8–15 人日能拿到同样的设计自由度。

---

## 7. 附录：`平板 = 桌面 UI` 的代价评估（261102 追问）

### 7.1 结论

**能做，但它是「把桌面端变成第二个产品面」的工程，不是「给平板加个 bundle」。** 粗估 **45–71 人日**（单人 ≈2–3.5 个月），且此后每个桌面功能都要额外过一遍触屏 + 平板回归。收益是 100% 桌面能力与观感；但如果不做触控化，用户拿到的是「在平板上很难点的桌面版」。

### 7.2 为什么说「技术上可行」（这是它诱人的原因）

- **桌面渲染层已经验证可以脱离 Electron 跑**：桌面端自带「浏览器端」（设置 → 浏览器端，`127.0.0.1:19880`），主进程用 `renderNativeShim` 把 `window.lakeNative` 换成 HTTP `/api` + SSE；能力矩阵 `hostCapabilities` 已把「无本机文件系统 / 无原生目录框 / 无窗口控制」这些差异显式建模，UI 会降级而不是崩。
- **契约只有一层**：渲染层与宿主的边界 = `window.lakeNative`，**143 个方法**（`src/lib/native.ts` 的 `LakeNative` 接口；preload 暴露 144 个；浏览器端 `WEB_METHODS` 135 个）。
- **移动端已经声明实现了同一契约**：`src/mobile/bridge.ts` 头注释「实现 `window.lakeNative` 契约（对齐桌面 preload 的 IPC 语义）」；143 个方法里 **57 个**在 `src/mobile` 有同名能力，其余 86 个需映射或补（含约 15 个桌面独有：导出/整库备份/路径 reveal/窗口事件/浏览器端开关/日志）。
- 所以「最便宜的宿主」不是把 Electron 主进程搬到 Android（26,322 行 TS + better-sqlite3 + fs），而是**给桌面 bundle 注入一个基于移动 bridge 的 shim**。

### 7.3 代价拆解（粗估，单人日）

| 工作包 | 内容 | 人日 |
| --- | --- | --- |
| **A 宿主适配层** | 143 方法 → 移动 bridge/插件；事件总线（sync-progress / library-changed / pending-summary）；能力矩阵降级；真正的语义缺口 ≈20–30 个（导出→系统分享、备份/恢复、绝对路径、窗口控制、日志、草稿日志、缓存 digest…） | 10–15 |
| **B 触控化** | 桌面渲染层 44,652 行是**鼠标优先**：控件高 27px（触屏下限 44）、79 条 `:hover`、15 处右键菜单、33 处拖拽、4px 分栏手柄、全局 `title`→tooltip、13px 标签；触屏相关代码仅 9 处。需要命中区、长按、触摸拖拽、IME、滚动条、无 hover 降级 | 15–25 |
| **C 打包与性能** | 两套 bundle 进 APK（`dist/assets` 43MB vs `dist-mobile/assets` 44MB，大量依赖重复；桌面入口 chunk **6.7MB raw**，移动入口预算只有 73KB）；冷启动解析/执行、内存、构建管线 | 5–8 |
| **D 门禁与 QA** | 桌面快照门禁 42 态跑在 Electron；要新增「WebView + 桌面 bundle」装置与基线（平板视口）；此后每次桌面改动都要过平板 | 5–8（+长期） |
| **E iPad 容器** | 桌面 UI 假设 hover/右键/窗口控制/菜单栏，WKWebView 上还要补 iOS 三个原生端口（BodyStore/AssetServer/SecureStore） | 10–15（与任何 iPad 路线共有） |
| **合计** | | **45–71** |

长期成本（不进上表）：① 每次桌面 UI 改动都要过触屏与平板回归；② 手机端仍要维护移动 UI ⇒ **永久两条 UI 线 + 第三个部署矩阵**；③ 这正是 `AGENTS.md` 「两端 UI 不共享」当初要止损的东西。

### 7.4 与替代路线对比

| 路线 | 人日 | 用户可见收益 | 长期成本 |
| --- | --- | --- | --- |
| P0 体面单栏（§3.6） | 1–2 | 平板不再「拉伸/白板/横条」 | 低 |
| **P1 双栏（移「布局」不移「UI」，§3.3）** | **3–5** | 平板像桌面：常驻树 + 正文 + 大纲 | 低（仍是移动 UI 一套） |
| **D1 桌面 UI 平板版（本附录）** | **45–71** | 100% 桌面能力与观感（触屏精细度需另做） | 高（第三条维护线） |
| D3 把 Electron 主进程重写成 Android 本地 API 服务再跑桌面 UI | 更大（26k 行后端 + 平台数据层） | 同 D1 | 高 |

中间路线（推荐备选）：**「移外壳、不移数据」**——不做 143 方法适配，只在移动 UI 层重建桌面外壳的三栏结构（侧栏 / tab 条 / 状态栏 / 大纲），组件仍用 `mb-*` 重写。约 **8–10 人日**可拿到桌面观感的 80%，且不产生第三条维护线；它是 P1 的加强版，不是 D1 的简化版。

### 7.5 什么情况下才值得走 D1

1. 平板被明确定义为「第二个桌面端」，用户会拿它做导出/备份/多栏对照这类**只有桌面 UI 有**的事；或
2. 未来想收敛成「桌面 UI 一套通吃桌面 + 平板」，并接受手机端继续用移动 UI（长期仍是两套）；或
3. 顺手要把 Electron 主进程换成「本地 API 服务」（那是独立项目，26k 行后端 + 平台端口）。

否则建议：**先 P1（3–5 天）**，把「平板像不像桌面」这个价值点用最低成本验证掉；真出现「平板要完整桌面能力」的硬需求，再按 D1 立项，并坚持「只给平板加载桌面 bundle，手机端不动」。

### 7.6 测量口径（可复算）

```bash
# 契约方法数 / 移动同名覆盖
sed -n '/export interface LakeNative {/,/^}/p' src/lib/native.ts | grep -cE '^  [A-Za-z0-9_]+\??[:(]'
# 桌面渲染层与主进程规模
find src/desktop src/components src/features -name '*.ts*' | xargs wc -l | tail -1
find electron -name '*.ts' -o -name '*.cjs' | xargs wc -l | tail -1
# 鼠标优先证据
grep -rn ':hover' src/styles/*.css | wc -l
grep -rn 'onContextMenu' src/components src/features src/desktop | wc -l
grep -rn 'onDragStart\|onDrop\|draggable' src/components src/features | wc -l
# 两套 bundle
du -sh dist/assets dist-mobile/assets
```

---

## 8. 二轮：工具栏向桌面看齐（261102，用户定调）

> 用户判断原文：「pad 适配的核心是工具栏……只要工具栏和桌面端一样就行了」。下面把它拆成四个编辑器的可执行结论 —— **部分成立，且成立的部分很便宜；唯一不成立的（表格）恰好是唯一被第三方焊死的。**
> 依据 HEAD `6433153a`（调研开始时 `a8abcdab`；另一会话已提交 PDF 插件与手写板 v2，ink 仍有未提交改动）。

### 8.0 四行结论

| 编辑器 | 桌面工具栏是什么 | 平板能否「和桌面一样」 | 代价 |
| --- | --- | --- | --- |
| Lake 文档 | 内核固定工具栏（26 项 + 6 分隔线，`toolbar.agentConfig.default` 下发） | **能**：开开关即可，溢出折叠本来就是桌面行为 | 3–5 人日（含触屏调优） |
| 表格 usheet | Univer ribbon（页签 36 + 工具行 40、按钮 24） | **不能直接复用**：ribbon 与桌面 UI 插件绑定，换桌面 UI 会抢手势、丢移动公式栏 | 0.5–3 人日只拿部分 |
| 多维表 | 自建 `.bt-viewbar` + 8 项 `.bt-tool-btn` 行（26–30px / 13px） | 只能**复刻规格**（直 import 撞围栏 + 未分层 CSS） | 5–7 人日 |
| 手写板 | 共享 InkPad 的 desktop variant（单行 27px） | **能**：桌面变体已在，补触达 | 1–2 人日 |
| 画板 | vendor `draw-toolbar`，两端已共用，>720px 自动走桌面分支 | **已是**，只差 tooltip/长按 | 0.5–1 人日 |

### 8.1 Lake 文档：开开关就行（最便宜、收益最大）

- **开关**：`src/features/editor/lakeRuntime.ts:500-501`（showToolbar）、`:803-805`（false 时 disabledPlugins 加 toolbar）、`:595-602`（items）、`:837-847`（agentConfig 下发）；`src/mobile/editor/DocumentEditor.tsx:189` 传 `showToolbar: !editing` ⇒ 编辑态关；阅读态又被 viewer 分支（`:803-804`）关 ⇒ **永远不出现**。**没有任何 CSS 隐藏**（`edit-surface-kernel.css` 无 `.ne-ui-toolbar` 规则）⇒ 启用只改一行配置。
- **真实几何**（vendor）：条高 50、`flex-shrink:0`（`lakex-doc.css:4575-4584`）；内容 `nowrap`、无横滚（`:4598-4608`）；item 26×26（`:4367-4374`）、间距 8（`:4610`）、下拉 40、字号选择 50（`:3973`）。溢出由 JS 折叠（`lakex.js:158281-158400`）进「…」（`:158387-158580`）。
- **关键认知**：**「放不下就进 …」就是桌面行为**——桌面 1024 窗口同样折叠。所以「和桌面一样」= 同一套 items + 同样的折叠，不是 27 项全平铺。宽度下界约 1040（29×34 + 6×9）⇒ 1024 约可见 22 项、800 约 17 项（估算，未实测）。
- **触屏**：26px < 本仓 44；下拉是 `click`（`lakex.js:159290`）、tooltip `hover/click`（`:62706`）⇒ **不依赖 hover**；内核按钮未 preventDefault ⇒ 点按钮可能 blur 收键盘（未实测）。
- **与现有机制**：`.ne-editor-body{height:calc(100% - 50px)}` 已让位（`lakex-doc.css:5082`）；`--mb-app-h` 由 `useEditSurface.ts:218` 扣键盘/面板。若同时留 dock = 44 顶栏 + 50 工具栏 + 56 dock ⇒ 正文过矮且**双输入源**。
- **方案（只在 expanded 平板）**：① `showToolbar: editing && tablet`；② 平板不挂 `EditorDockHost`；③ items 裁掉云端/空 descriptor（arrangement / translate / correction / materialLibrary——内核会静默丢弃）；④ 平板作用域把 item 26→≥40、下拉行高 ≥44（走 `body.lake-tablet` + 现有 `!important` 例外登记流程）；⑤ 工具栏按钮 `preventDefault` 保键盘；⑥ `cardSelect` 插入面板在 800/1024 夹视口（现 `mobile.css:1139-1141` 只覆盖 search 面板）。
- **必须补的缺口**：移动 dock 的插入面板含桌面没有的项（拍照/附件/音视频/引用卡/加密文本/日历/画板族）⇒ 平板要留一个「＋」入口（浮钮或二级条），否则功能倒退。代价 3–5 人日。

### 8.2 表格：唯一被第三方焊死的一项

- **桌面 ribbon 机制**：preset 把 `toolbar`/`ribbonType` 原样交给 `UniverUIPlugin`（`@univerjs/preset-sheets-core/lib/es/index.js:57,63-67`）；Workbench 需 `header && toolbar` 才挂 headerbar（`@univerjs/ui/lib/es/index.js:6802`）；part toolbar → Ribbon（`:6970`）；尺寸 36+40、按钮 24（`:4491-4523,3501-3507`）；溢出=**项级收起**进 ⋮（`:4449-4478`），没有断点。
- **移动为什么拿不到**：本仓 `createMobileSheetsCorePreset` 把桌面 UI 插件**整族替换**成移动版（`src/mobile/usheet/mobileUniverPreset.ts:78`），移动表格走 `MobileCompactTopBar`（`ui:24128`，只有撤销/重做 + ⋯）；`MobileUsheetViewer.tsx:530` 显式 `toolbar:false`。
- **换桌面 UI 的代价**：桌面 `SheetSelectionRenderService` 在 pointerdown 就建选区 + `setCapture`（`sheets-ui:35752,35962-35966`），移动版是 pointerup 且位移 ≤10 才选格（`:34649-34660`）⇒ 单指拖动变成选不滚动；**没有配置开关**，只能换服务实现，而移动服务未导出（`sheets-ui/types/index.d.ts:123-130`）；换 UI 还会丢移动公式栏（移动编辑输入面）。
- **路径与代价**：A 维持现状 0.5；**B 开官方 mobile ribbon 0.5–1**（只补撤销/重做 + ⋯，替不了自建 TopBar）；C 自挂 `<Ribbon toolbarOnly ribbonType="collapsed">` 2–3（要自己注册 `IRibbonOverrideService`；24px 命中、76px 高、只读态）；D 桌面 UI + 接管滚动 5–8（高风险）；E 给 sheets-ui 打 patch 2–3（与三处补丁白名单冲突，不建议）。
- **建议**：B 先拿撤销/重做 + ⋯，保留自建 TopBar；要更"桌面"再上 C；不做 D/E。

### 8.3 多维表：要做，但它是「复刻规格」不是「复用组件」

- **桌面**：`.bt-viewbar`（`bitableEditor.css:86-93`）+ `.bt-tool-btn` 行 8 项（表格配置/视图/筛选/分组/排序/行高/填色/导入 CSV/添加记录，`BitableEditor.tsx:1163-1216`）；26–30px、13px；依赖 kit `ln-*`、Overlay/usePopoverPosition、`native.pickImportCsv`、HTML5 拖拽、右键行菜单、hover 才显 ⋯。
- **移动**：只有 3 个 36px 图标钮（`MobileBitableViewer.tsx:531-543`、`mobileBitable.css:45-47`），无文字、无导入/行高/填色。
- **围栏**：不得 import 桌面 CSS（`mobileIndependence.test.ts:124-129`）、不得 import `components/`（`:208-214`）、`ln-*` 必须 0（`:58-62,110`）；`features/*` 组件不被直接拦，但它 JS import 的 CSS 会**未分层**进移动端（`cssLayers.test.ts:254-261`），而移动端没有 kit.css ⇒ 直 import = 样式打架。
- **建议**：移动层用 `mb-*` 复刻规格（图标+文字、行高 38–44、hover 显隐→常显、双击重命名→⋯、拖拽→长按把手、右键→行尾 ⋯），新规则按 `mobileLayers.test.ts` 登记；5–7 人日。共享层（`src/shared-ui`）要 10–15 人日且改 P0 围栏，本轮不做。

### 8.4 手写板：几乎免费

- `InkPad.tsx` 双端共用，CSS 由宿主各自 import（`DesktopInkPad.tsx:8-9` / `MobileInkPad.tsx:9-10`），`inkPad.shared.css` 已复制且漂移（hover→`:active`、1px→.5px）。
- 桌面单行 = 笔/高亮/橡皮 + 8 色 + 4 笔宽 + 撤销 + 导入 + 缩放（`InkPad.tsx:686-737`），按钮 27（`inkPad.desktop.css:17-20`）；移动 = 顶部翻页/缩放/预览 + 底部坞、色/宽收浮层（44 触达，`inkPad.mobile.css:10-14`）。
- 平板：走 desktop variant + 27→40–44 + hover→`:active` ⇒ 1–2 人日。**另一会话正在改 ink（v2 图片页/导入），必须与它排队合流。**

### 8.5 画板：已经是桌面工具栏

- 两端同一 `DrawnixBoardCore`，工具栏 = vendor `draw-toolbar`（`DrawnixBoardCore.css:977-989`），`app-toolbar` 被隐藏（`:136`）；桌面只补图标对齐（`boardEditor.css:53-64`），移动只有 2 条显隐（`mobile.css:736-742`）。
- vendor 有 720px 断点（`:1023-1032`）⇒ 平板自动走桌面分支（竖排 rail）；要处理的只有 hover tooltip/长按，以及移动端没传 `ai`（AI 入口缺失，`BoardEditor.tsx:523-529` vs `MobileBoardViewer.tsx:392-404`）。0.5–1 人日。

### 8.6 架构与红线（必须先想清楚）

- **「复用桌面组件」会同时撞三条**：① `mobileIndependence` 禁 import 桌面样式与 `components/`、`ln-*` 必须 0；② 桌面组件自带的 CSS 是**未分层**的，进移动端会与内核/移动样式打架；③ 移动端没有 `kit.css`/桌面令牌。
- 所以只有三条路：
  - **A 复刻规格（推荐）**：把桌面的**几何/字号/图标序列/交互语义**抄进移动层（`mb-*`），用测试卡住规格数值；零围栏改动；代价 = 两份实现（移动工具栏本来就有，等于只改布局）。
  - **B 新共享层 `src/shared-ui`**：双端 import、无桌面类名、tokens-only；最「单一来源」，但要改 P0 围栏 + 迁移桌面组件（10–15 人日），本轮不划算。
  - **C 直 import 桌面组件**：不建议（三条全撞）。
- **需要豁免/改写红线的两条**（只在 expanded 平板生效）：AGENTS「移动端 Lake 输入面 = 底部 dock，没有第二条路」；`MOBILE-DESIGN.md:167`「面板高度与工具栏位置不改」。建议写成「平板例外」条款，与 §3.2 的 `data-form-factor` 一起评审。
- **不要做**：不要为平板引入第二套工具栏状态源（undo/search/items 分叉）；不要升级内核（已 pin v1.99.0）；不要给 Univer 打第四个补丁。

### 8.7 分期与人日

| 期 | 内容 | 人日 |
| --- | --- | --- |
| **T0** | Lake 内核工具栏（≥800）+ 平板关 dock + 留「＋」入口 + 画板 tooltip + 手写板 desktop variant | 5–7 |
| **T1** | 表格：官方 mobile ribbon（B）+ TopBar 让位 | 1–2 |
| **T2** | 多维表横向工具条（复刻规格）+ 长按/常显改造 | 5–7 |
| **T3**（可选） | 表格自挂 Ribbon（C） | 2–3 |
| **合计** | | **13–19** |

对照：§7 的 D1（平板=桌面 UI）45–71 人日 ⇒ **工具栏路线约是它的 1/3，拿到「输入能力」这一层的主要收益**。但要说清：工具栏只解决「能输入什么」，不解决「布局像不像桌面」（单栏 vs 双栏，见 §3.3 的 P1）。

### 8.8 验证

- 手机零回归：`check:mobilesnap` 6 态 + 23 屏走查；平板新增视口快照（§3.7）。
- 平板实测清单：800/1024 下 Lake 工具栏折叠数、点按钮是否收键盘、`cardSelect` 插入面板位置、关 dock 后 `--mb-app-h` 与键盘行为；Univer ribbon 命中区与 ⋯；多维表横向条在 800 是否溢出；画板 tooltip/长按。
- 交互回归：长按/双击/拖拽/右键全部换触屏语义后逐项过。
- 手写板与另一会话的 ink v2 合流后再测。

### 8.9 风险

1. **双输入源分叉**：平板走 kernel toolbar、手机走 dock，undo/search/items 两套语义必须一致。
2. **内核 pin**：折叠/插入面板行为只能实测，v1.99.0 不能升级。
3. **Univer 无配置开关**：ribbon 与桌面 UI 焊死，C 路径要自己注册服务，回归面在表格内核。
4. **触屏命中 26→40**：与「保持桌面观感」有张力（放大后更像移动端），需要设计确认。
5. **并行改动**：手写板/PDF 批次在推进，T0 的 ink 与 board 要等它合流。

---

## 9. 三轮：新开一个「pad 端」值不值（261102，用户追问）

> 用户设想：不复用手机端，直接新开一个 pad 端，甚至按平板特点重新设计交互。下面按代码量、基础设施、长期维护三条算账。

### 9.1 结论

- **不建议本轮新开端。** pad 端约 90% 的成本在**重写 UI**，不在「分端」；同样的设计自由度用「pad 外壳层」**8–15 人日**就能拿到，新端要 **40–70 人日**且此后多一条维护线。
- 关键区分：**设计自由度来自「外壳层（shell）」，不来自「新 entry」**。双栏、工具栏、外接键盘、笔、hover、多任务这些重设计，在外壳层里全都能做；新端只多买到「代码隔离」，代价是两份 UI 长期漂移。
- 新端只在三种条件同时成立时才值得：pad 是一等产品、IA 与手机长期分叉、有 2–3 个月预算；且**必须先抽 runtime**（见 §9.4#8）。

### 9.2 代码事实（成本的分母）

| 层 | 内容 | LOC（非测试） | 新端能否直接复用 |
| --- | --- | --- | --- |
| 运行时 | `src/mobile/{bridge,data,native,sync,v3,lib}` | **9,066** | 能，但**住在 src/mobile 里**，要先抽出来（§9.4#8） |
| 移动 UI | home 2,089 / notebook 1,961 / editor 2,450 / settings 1,586 / ai 2,078 / bitable 3,232 / usheet 3,300 / ui 1,434 / hooks 986 / 其余 | **≈22,600** | 新端 = 重写；外壳层 = 复用 |
| 移动 CSS | `src/mobile/**/*.css`（含层基线） | **4,954** | 同上 |
| 移动测试 | 逐文件声明数、独立性围栏、快照 | **15,947** | 新端要再来一套 |
| 共享域 | `src/core` + `src/lib` | 23,257 | 已两端共享，直接复用 |

### 9.3 四个方案

| 方案 | 形态 | 人日 | 设计自由度 | 长期成本 |
| --- | --- | --- | --- | --- |
| A 自适应（§3 的 P0/P1） | 同一套 UI + 断点 | 3–5 | 中（受手机 IA 约束） | 低 |
| **B pad 外壳层（推荐）** | `src/mobile/pad/**`，同一 bundle，`data-form-factor` 切外壳/工具栏；屏幕组件复用 | **8–15** | **高**（首页/工作区/工具栏/面板都能重设计） | 低（一套测试/门禁） |
| C 新 pad 端（独立 UI root，复用 runtime） | `src/pad/**` 自己一套 shell + screens | **40–70** | 最高 | 高（两条 UI 线 + 平板门禁） |
| C+ 独立 entry/bundle | C + 双入口构建 | C + 5–10 | 同 C | 同 C + 构建复杂度 |
| D 桌面 UI 平板版（§7） | 桌面渲染层 + 宿主 shim | 45–71 | 低（鼠标优先） | 高 |

### 9.4 新端真正的代价清单

1. **UI 重写 22.6k LOC + 对应测试**（设置 12 节、多维表 4 视图 + 表单、usheet chrome 3.3k、AI 页、回收站…）——这是大头。
2. **Capacitor 只加载一个 webDir/一个 index.html**：现有构建把 `mobile.html` 复制成 `dist-mobile/index.html`（`vite.mobile.config.ts`）⇒ 双入口要么在 index.html 里按形态动态 import（可行），要么原生换 URL（脆）。不是天然支持。
3. **APK 体积/构建时间**：两套 chunk 图都进包（`dist/assets` 43MB / `dist-mobile/assets` 44MB，依赖大量重复）。
4. **门禁翻倍**：手机 6 态 + 平板视口 + pad 自己的走查/快照基线 + 视觉人工走查。
5. **文档/手册分端**（现在 guide 只有桌面/Android 两栏）。
6. **维护**：每个功能 2–3 处实现；本仓已经为「两端 UI 不共享」付过一次代价（`mobileIndependence` 的立项理由就是「移动端不共享桌面 UI」），新端等于主动再开一条。
7. **iPad**：再补一份原生端口与容器。
8. **隐性成本（最容易被忽略）**：runtime 现在住在 `src/mobile`（bridge 实现 `window.lakeNative`、data、native 插件、v3 同步）。新端直接 import 会形成 `src/pad → src/mobile` 的跨端依赖，结构护栏（`mobileStructure.test.ts`、`check:mobileui`）也会拦。要干净必须先做 **`src/runtime` 抽取**（3–5 人日，纯搬移 + 测试迁移，手机端零回归）。

### 9.5 如果仍要做新端：正确顺序

1. 抽 `src/runtime`（bridge/data/native/sync/v3）——纯搬移，手机零回归；
2. **单入口形态路由**：`index.html` 按 `data-form-factor`/原生 dp 动态 import `mobile/main` 或 `pad/main`（绕开 Capacitor 单 webDir 限制，代码仍分包，手机不加载 pad chunk）；
3. **pad 最小闭环**（首页 + 工作区 + 编辑器 3 屏）→ 真机验收 → 再按模块迁 bitable / usheet / ink / board / settings；
4. pad 的 CSS 自成一层（新增 `padLayers.test.ts` 基线），不与 `mb-*` 混；
5. **每迁一个模块，手机端删掉对应平板分支**，否则就是三份实现。
- 半途而废的风险：停在「3 屏可用、其余跳回手机 UI」= 两头不是，比不做还差。

### 9.6 触发条件（什么时候才真该新开端）

- pad 的 IA 与手机**结构**分叉超过 ~30% 屏幕（不是样式差异）；
- 外壳层里的 pad 分支已超过移动 UI 的 ~20%（说明共享外壳已不成立）；
- 有 2–3 个月预算、愿意承担两条 UI 线、并有平板门禁装置；
- 满足前两条再启动，且第一步必须是抽 runtime。

### 9.7 推荐路径与累计成本

P0 体面单栏（1–2）→ P1 双栏（3–5）→ 工具栏 T0（5–7，§8）→ **pad 外壳层**（8–15）→ 观察半年 → 触发 §9.6 再抽 runtime + 新端。

**累计 17–29 人日**即可到「平板是独立设计过的端」的 ~80%；新端 40–70+ 人日，且第一年净收益为负（多维护、少功能、要重做门禁）。

### 9.8 「按 pad 特点重新设计交互」清单（与端无关，外壳层就能做）

双栏（树/列表 + 正文）· 常驻工具栏（§8）· 大纲右栏 · 外接键盘快捷键 · 触控板 hover 增强 · Apple Pencil/触屏笔（压感/悬停/防误触）· 多任务窄窗回落 · 拖放（文件/文本/跨应用）· 面板改居中浮层 · 平板专属首页（小记/知识库并排）· 更大的编辑器阅读宽与页边距。
—— 这些都不需要新端；需要的是**外壳层 + 一套断点判据**（§3.2）。

---

## 10. 第一批落地（261102，分支 `feat/pad-adaptation`，worktree `../lakex-pad`）

> 用户裁决：「布局没有疑问，风格按项目已有的做，切分支推进」。第一批只做 §3 的 **P0 外壳 + §8 的 Lake 工具栏（T0 的文档部分）**，手机零改动。

### 10.1 做了什么

| 项 | 落点 | 说明 |
| --- | --- | --- |
| 形态判据（单一来源） | `src/mobile/pad/formFactor.ts` + `useFormFactor.ts` | 按**窗口宽**三档 `<600 compact / 600–799 medium / ≥800 expanded`，写 `html[data-form-factor]` + `body.lake-tablet`（兼容）；`installFormFactor()` 在 `main.tsx` 首帧前安装，resize/orientation 跟随；原生 `__lakeSetTablet` 仅记录提示，不参与布局。**删除** `native/deviceProfile.ts`（设备属性判据退场）。 |
| 平板外壳 CSS | `src/mobile/pad/pad.css`（新，38 声明 / 0 重复组，已登记 `mobileLayers.test.ts`） | `expanded` = 双栏（`.mobile-workspace-main` flex-row）+ 左栏 `.pad-tree` 280；正文 `.lake-editor-mount` 取消 760 限宽、`.ne-engine` 限 760 居中；去掉 dock 的 80px 让位；内核工具栏命中 26→40。 |
| 双栏工作区 | `notebook/NotebookWorkspace.tsx` | 抽屉与左栏**共用同一份 `treeList`**（平板不渲染抽屉那份，避免 `.side-panel-body` 双实例）；左栏头 = 笔记本图标/名称 + 新建 + 收起；胶囊「文档树」在平板 = 左栏开合；平板点文档不关左栏。 |
| 文档工具栏 | `editor/DocumentEditor.tsx` | `expanded` 编辑态 `showToolbar:true`（内核固定工具栏）+ **不挂 `EditorDockHost`**；手机仍 `showToolbar:!editing` + dock。 |
| 平板 medium 收敛 | `mobile.css` | 原 7 条 `body.lake-tablet` 规则改为 `html[data-form-factor="medium|expanded"]`（内容限宽 760 / 设置页 440）。 |
| 红线更新 | `AGENTS.md` | 移动端「输入面=底部 dock，没有第二条路」加平板例外条款（expanded 走内核工具栏 + 不挂 dock）。 |
| 验收装置 | AVD `lake_tab`（pixel_tablet / android-36 / 端口 5580 / CDP 9340） | 不占用 `lake_gate`(5562)/`lake_mobile`(5554)。 |

### 10.2 实测（lake_tab，1280×800 dp，dpr 2）

- `document.documentElement.dataset.formFactor` = **expanded**；`body.lake-tablet` 已加。
- 工作区：`.mobile-workspace-main` flexDirection = **row**；`.pad-tree` 宽 **280**；树 = 5 条夹具文档。
- 编辑态：内核工具栏 **906×50**（吃满文档列）、图标按钮 **40×40**、`.med-toolbar` **不存在**；`.ne-engine` **760** 居中；可正常输入/保存（灌入正文后重开可见）。
- 阅读态：工具栏不存在（viewer 关）；正文 760 居中。
- 截图：`.css-audit/pad-mockup/`（设计方案）与 `.css-audit/pad-impl/`（真机）；均为 gitignored。

### 10.3 已知缺口（下一批）

1. ~~顶栏仍是手机样式（无桌面式文档页签）~~ → **10.4 已做**（平板顶栏 = 页签 + 动作组；胶囊在平板退场）。
2. ~~右大纲常驻栏未做（仍是抽屉）~~ → **10.4 已做**（OutlineSheet rail 变体）。
3. **首页**：expanded 只是限宽 760，横滑分页未禁（§3.3）。
4. **表格 ribbon / 多维表横向工具条 / 手写板桌面工具条** = §8 的 T1/T2/T0 剩余。
5. 平板快照装置（`check-mobile-snap --viewport`）未加；**手机 6 态快照未在 lake_gate 上复跑**（改动按 `data-form-factor` 门控，预期手机零差异）。
6. 平板编辑态的图片/附件插入走内核 `cardSelect` 面板，上传链路（`EditorDockHost` 的隐藏 file input）摘掉后需实测。

### 10.4 第二批（commit 26885092 + 一处颜色字面量修正）：顶栏页签 / 常驻大纲 / 胶囊退场

- **平板顶栏**（仅 expanded；手机仍是「返回 + 标题输入 + 动作」）：返回 · 笔记本切换（名称 + 图标，点开切换面板）· **文档页签条**（激活态、× 关闭、＋ 打开文档；溢出横向滚动）· 动作组（文档树开关 / 大纲开关 / 查找 / 编辑 / 同步）。
  - 平板**文档重命名**改走目录树行 ⋮（手机仍用标题输入框）；chromeHiddenNow 在平板关掉（顶栏有页签，滚动时不闪）。
  - 胶囊（底部四格）**只在手机渲染**；平板上的树 / 页签 / 大纲 / 切换笔记本都在顶栏或常驻栏里。
- **常驻右栏大纲**：OutlineSheet 新增 rail 变体（无遮罩、无滑入，220×整高，头 + side-panel-body）；顶栏大纲按钮开合；切到无大纲的文档类型自动收起。手机仍是右侧抽屉。
- **实测**：2 个页签可切换/关闭；右栏 220×692；打开的文档 h2 正确进大纲（「为什么先做工具栏」）；页签 × 的 UA 默认边框已重置（border 0）。
- **手机门控复核**（CDP 视口压到 412×842）：formFactor=compact、无 pad-tabs/pad-tree/pad-outline、标题输入框回来、工作区胶囊回来；恢复 1280 后全部回到平板形态。
- **门禁**：tsc 0 / vitest run src/mobile 836 例 / check:mobileui（含 ui-metrics，颜色字面量 0）/ git diff --check；全量 vitest 542/543 文件通过（electron/s3v3/perf.integration.test.ts 在满载（模拟器 + 并行 worker）下曾抖红一次，单独与复跑均通过，非本批引起）。
- 截图：.css-audit/pad-impl/tablet-tabs-outline.png、tablet-edit-outline.png。

### 10.5 第三批：平板快照装置进门禁

- **装置**：`snap-gate.mjs` 新增 `--viewport WxH`（透传 `LAKE_SNAP_VIEWPORT`）；`mobile-snap.mjs` 启动时 `Emulation.setDeviceMetricsOverride`（dpr 2）、结束时 clear；`home-doc` 在 `.pad-tree` 存在时点左栏行（手机仍走底栏「文档树」→ 抽屉）。
- **入口**：`scripts/mobile-audit/check-mobile-snap-tablet.mjs` + `npm run check:tabletsnap`（默认端口 9340）；基线 **独立** `scripts/mobile-audit/baseline/mobile-snap-tablet.json`，手机基线 `mobile-snap.json` 不动。
- **为什么钉视口**：平板态与设备状态栏/导航栏实际高度解耦（1280×800、dpr 2）⇒ 换一台 `lake_tab` 也能复现；但仍绑定「该夹具 + 该视口」。
- **基线（干净实例 + gate-fixture）**：home-library 1822 / home-quicknotes 1822 / home-library-list 1827 / home-doc 2012 / settings 1912 / settings-appearance 1849；**连跑两轮 0 差异**。
- **文档**：`scripts/mobile-audit/README.md` 新增「平板专项快照」节，`docs/MOBILE-OPS.md` §5.5 装置表登记。


### 10.6 第四批：首页收口 + 表格 ribbon 实验（结论：不做）

- **平板首页禁横滑翻页**：`html[data-form-factor="expanded"] .mobile-tab-stage { overflow-x: hidden; touch-action: pan-y; scroll-snap-type: none }`。顶部页签仍可用（`useTabPager` 用程序化 `scrollTo`，`overflow:hidden` 不拦程序化滚动）；手机保持原生分页手势。设备实测计算值 `overflow-x: hidden / touch-action: pan-y`。
- **表格 ribbon 实验**（临时把 `createMobileSheetsCorePreset` 的 `toolbar` 在 expanded 置 true，已回滚）：
  - 实际多出来的是 **Univer 的 mobile compact strip**（一行：网格 / 筛选 / 排序 / 查找 ｜ 撤销 / 重做 / 底色 / ⋯），不是桌面那套「开始/插入/公式/数据/视图」分组 ribbon。
  - 与现有自建 chrome **重复**（`SheetTopBar` 已有工作表/网格/缩放/＋/☰；编辑态 `SheetDock` 已有 ＋/T/筛选/⋯/撤销/重做），且会让表格多一行、压缩网格高度。
  - ⇒ **T1 不做**。真要桌面 ribbon 只能「自挂 Ribbon（2–3 天，24px 命中）」或打 `sheets-ui` 补丁（与补丁白名单冲突），两者都不划算。
- 表格现状（平板阅读态）：`SheetTopBar` + 网格 + 底部公式栏；编辑态再加 `SheetDock`——在 1280 宽下可用，不是这次要解决的问题。
- **基线重烤（本批唯一一次）**：首页那条 CSS 改变了 `.mobile-tab-stage` 的计算样式 ⇒ 平板 6 态**元素数不变、指纹全变**（快照按元素计算值取指纹）⇒ 按 AGENTS §3#21③ 重烤 `baseline/mobile-snap-tablet.json`，重烤后连跑 **0 差异**。手机基线不受影响。


### 10.7 第五批：平板表格只读 dock 常驻

- **问题**：手机表格在阅读态只有「阅读工具条」，dock 只在编辑态出现 ⇒ 进出编辑时网格整块上下跳；桌面是工具栏常驻。
- **改法**：`SheetDock` 新增 `readOnly` 文案/禁用态（工具全禁用、隐藏键盘键）；`MobileUsheetViewer` 在 `expanded` 下**只读也渲染 dock**，并用 `.mobile-usheet.is-readonly .mb-usheet-dock { position: static }` 让它进流常驻，`.mb-usheet-chrome-spacer { height: 0 }`（只读时不再为 fixed dock 预留 96px）。手机（compact）与编辑态完全不变（编辑态仍 fixed + 96px spacer + 键盘键）。
- **实测**（lake_tab 阅读态）：dock 存在、`position: static`、7/7 按钮 disabled、无键盘键、spacer 0；切编辑态：`position: fixed`、8 按钮（含键盘）、spacer 96、阅读工具条隐藏 —— 与手机语义一致。
- **顺带修**：`useFormFactor` 在 `matchMedia` 缺失时不再崩（jsdom / 老 WebView 只靠 resize）；`mobileUsheetViewer.test.ts` 把 innerWidth 钉到 412（这组用例验的是手机 compact 语义，jsdom 默认 1024 会命中平板分支）。
- **门禁**：tsc 0 / 全量 vitest **543 文件 3360 例** / `check:mobileui` / `git diff --check` / **平板快照 6 态 0 差异**（本批未动平板外壳）。


### 10.8 第六批：多窗口外壳高修复 + 多维表工具栏主操作

- **分屏 / 自由窗口下「键盘永远开着」**（§1.3#3 的 P1）：根因 = `shellHeight` 单调取历史最大值、只在 `orientationchange` 重置；窗口被拖窄后 `shell - innerHeight > 8` 永真。
  - 修法：`viewportShell` 新增纯函数 `widthChanged(prev, next)`（≥24 CSS px 才算），`useKeyboard` 每次 update 先判宽度变化 → `resetShellHeight()` 再 `noteViewport` 重学基准。**IME 不改宽度**，所以不会误伤键盘判定；纯高度拖拽仍是已知盲区（无法与 IME 区分，先不猜）。
  - 单测 +2（宽度抖动/分屏/折叠/横竖屏）。
- **多维表工具栏「添加记录」**：在现有 `.mbt-toolbar` 右侧加主按钮（复用已有 `addRecord`：先落盘再改界面、窗口覆盖新记录、自动打开记录面板），位置对齐桌面「添加记录」。设备实测：点击后 `4 → 5 条记录`，新记录面板自动打开。
- **平板基线纠错**：上一批在**脏实例**（中途创建的「无标题表格」会多一行树行）上重烤过 `home-doc`（2029）⇒ 本批在 `pm clear` + 干净夹具上重烤回 **2012**，连跑两轮 **0 差异**。教训已写进 `scripts/mobile-audit/README.md`：平板基线只认"干净实例 + 固定夹具"。


### 10.9 第七批：手写板平板工具坞内联色板 + 手机/平板基线复核

- **手写板（T0 剩余）**：`InkPad` 新增 `inlineTools` 开关（默认 false）。平板 `expanded` 下工具坞把**色板（COLORS）与 4 档笔宽平铺**进工具行（44 触达，桌面单行观感），坞内悬浮色板/笔宽面板不再渲染；手机保持 v3「当前值按钮 + 悬浮面板」。
  - 接线：`MobileInkPad` 用 `useFormFactor() === "expanded"` 注入；桌面 `DesktopInkPad` 不变。
  - 设备实测（lake_tab）：dock 984×89，内联 6 色 + 4 档，无 `[data-overlay=palette/widths]`；编辑态正常。
  - 护栏：`inkPadWiring` 静态断言改为「内联只在 `inlineTools` 分支」；`MobileInkPad.render.test.tsx` 视口钉 412（手机语义）+ 新增 expanded 内联用例。
- **手机 6 态门禁（首次真正跑通）**：`lake_gate` 起在 5582 / CDP 9336，装合并后 APK + 干净夹具。
  - 首轮 1 态差异：`home-doc 1996 → 1997` —— 根因 = `NotebookWorkspace` 平板批次多了 `.mobile-workspace-main` 包装层（手机也 +1 元素，属有意结构）。
  - 重烤 `baseline/mobile-snap.json` 后连跑两轮 **0 差异**（手机其余 5 态元素数不变）。
- **平板 6 态门禁**：`pm clear` + 夹具后因 `home-doc` 指纹带文档 node id（已知装置约束）而重烤一次（元素数 2012 不变），连跑两轮 **0 差异**。
- **教训（再次确认）**：两份基线都只认「专用实例 + 干净夹具」；`pm clear`/重灌夹具/创建测试文档后必须重烤，否则必假红。


### 10.10 第八批：视图配置「排序 / 分组」可编辑

- **为什么现在能做**：AGENTS §4 已定「表格列宽行高隐藏冻结、多维表视图配置仍属文档数据」⇒ 编辑态下改排序/分组是写正文，不违反「打开 = 只读」（只读态仍不改）。
- **改动**：`MobileBitableViewConfigSheet` 三个页签 → 四个页签（筛选 / 排序 / **分组** / 布局）；编辑态下：
  - 排序：列出规则（字段 + 排序方式胶囊：升序/降序，单选/多选另有选项顺序/逆序）+ 删除；底部「排序 + 字段」追加一条升序规则；走 core 的 `sortModesForField / sortModeOf / applySortMode / sortModeLabel`（单一映射，不另造语义）。
  - 分组：显示当前分组字段 + 取消；下方字段胶囊直接设为唯一分组（只支持一级，与云端一致）。
  - 两者都经 `updateView`（`mutate` → 落盘）写视图配置；只读态显示只读说明，不提供按钮。
- **设备实测**（lake_tab）：页签 = 筛选/排序/分组/布局；排序加「文本」后 `readNote` 回读正文含 `"sorts"`；分组选「文本」后回读含 `"groups"`。
- **未做**：筛选条件编辑器（按字段类型的操作符/值 UI）——下一批；行高/填色/导入 CSV 也未做。


### 10.11 第九批：筛选条件编辑器（移动端首个可写筛选）

- **范围**：编辑态下可编辑**扁平筛选规则**（增/删/改操作符/改值），根连接 且/或；**嵌套分组**只展示 + 删除（条件树 UI 不在移动端复制，明确指路桌面）。
- **单一来源**：全部走 core 的 `filterOperatorsFor / filterOperatorLabel / filterValueKindFor / defaultFilterValueFor / createBitableFilterRule / dateFilterModesFor / BITABLE_DATE_FILTER_MODE_LABEL / isBitableFilterGroup / bitableFilterRuleCount / isRelationFieldType`，不另造语义。
- **值编辑器**：文本/数字（`.mb-input`）、布尔（胶囊）、单选（选项胶囊）、多选（选项多选胶囊；关联字段给「请在桌面编辑」）、日期（模式胶囊 + `type=date` 自定义输入）、附件（仅空/非空）。
- **写入口**：`onUpdateView({ filters, filterOperator })` → `mutate` → 落盘（与排序/分组同一条路径）。
- **实测**（lake_tab）：筛选页签点「+ 文本」加规则 → 改值「季度」→ 再加一条 → 切「或」→ `readNote` 回读正文含 `"filters"`（两条规则 + 值都在）。
- **未做**：嵌套分组编辑、按关联记录选择筛选值、筛选对视图数据的即时预览刷新（写完后关闭面板即按新规则渲染）。


### 10.12 第十批：多维表平板 9 项工具条 + 行高

- **平板工具条**（仅 `expanded`，手机保持紧凑图标行）：桌面同序 **9 项文字按钮** —— 表格配置 / 视图 / 筛选 / 分组 / 排序 / 行高 / 填色 / 导入 CSV + 添加记录。
  - 筛选 / 分组 / 排序 → 直接打开视图配置对应页签（`MobileBitableViewConfigSheet` 新增 `initialTab`）。
  - 表格配置 → 字段面板（只读禁用并给理由）；视图 → 视图列表。
  - **填色 / 导入 CSV 置灰**：前者需要完整的条件填色编辑器、后者需要列映射对话框（桌面已有），移动端不做假入口，title 写明「请在桌面…」。
- **行高**：新增行高面板（低/中/高）；`BITABLE_ROW_HEIGHT_OPTIONS` + `bitableRowHeightPx` 下沉 `core/bitableDoc.ts` 作为单一映射，**桌面 BitableEditor 同步改用**（删掉本地重复实现）；移动端查看态通过 `--mbt-row-h` 生效。
- **实测**（lake_tab）：9 按钮 = 表格配置/视图列表/筛选/分组/排序/行高/新增记录可用，填色/导入 CSV disabled；行高选「高」→ `--mbt-row-h: 64px` 且 `readNote` 回读正文含 `"rowHeight":"high"`。
- **测试基建修正**：`useFormFactor` 在无 `window`（node/SSR 静态渲染）时按 compact 返回；移动端 jsdom 用例需要手机语义的按**文件**钉 412 视口（全局改会污染桌面 jsdom 用例——实测 Markdown 面板宽度 480→476）。


### 10.13 第十一批：平板外接键盘快捷键（最小集）

- **落点**：`src/mobile/pad/usePadShortcuts.ts`（纯判据 `matchPadShortcut` + 输入态守卫 `isTypingTarget` + hook），**仅 `expanded` 挂载**；手机不挂（软键盘没有这套语义）。
- **键位**：
  | 快捷键 | 行为 | 落点 |
  | --- | --- | --- |
  | ⌘/Ctrl + K | 全局搜索 | `MobileApp`（打开 SearchSheet） |
  | ⌘/Ctrl + F | 文档内查找（仅 Lake 文档） | `NotebookWorkspace`（`toggleOverlay("find")`） |
  | N | 新建文档（**裸 N 只在非输入态**） | `NotebookWorkspace`（`createChildDocument("doc", notebookId)`） |
  | Esc | 关闭当前浮层 | 两处各自处理（首页级 sheet / 工作区 overlay） |
- **输入态守卫**：焦点在 `input/textarea/select/contenteditable/.ne-engine/.ne-editor/.lake-editor-mount/.mobile-usheet-root` 时，裸 N 不抢键（编辑正文照常输入字母）；带修饰键的 K/F/N 仍生效。
- **实测**（lake_tab，CDP `Input.dispatchKeyEvent`，modifiers=2 表示 Ctrl）：Ctrl+K → 搜索面板出现、Esc 关闭；Ctrl+F → `.mb-find` 出现、Esc 关闭；N → 页签数 2 → 3（真新建一篇文档）。
- **未做**：按键映射自定义、更多快捷键（保存/关标签/大纲切换）——按需再加，不在最小集内。


### 10.14 第十二批：多窗口/断点实测 + 目标收尾

- **现场改窗口宽**（lake_tab，`adb shell wm size`）：
  | 物理/密度 | CSS 视口 | formFactor | 表现 |
  | --- | --- | --- | --- |
  | 1200×1600 @2 | 600×800 | **medium** | `.pad-tree` 消失、`.mobile-workspace-main` 变 column（单栏） |
  | 1600×1600 @2 | 800×800 | **expanded**（阈值边界） | 左栏回来、双栏 |
  | reset（2560×1600 @2） | 1280×800 | **expanded** | 恢复双栏 |
  ⇒ 分屏 / 自由窗口 / 折叠展开下布局按**窗口宽**实时切换，不需要重启。
- **shellHeight（键盘误判）**：平板没有 dock，键盘态没有可观察 UI；修复由 `widthChanged` 纯函数单测覆盖（宽度 ≥24px 变化才重置，IME 不改宽度）。纯高度拖拽仍是已知盲区（无法与 IME 区分）。
- **门禁**：手机 6 态 **0 差异**（未重烤，直接用既有基线）；平板 6 态在 `pm clear` + 干净夹具上**重烤**（home-doc 指纹含文档 node id），连跑两轮 **0 差异**；tsc 0 / 全量 vitest **548 文件 3408 例** / `check:mobileui` / `git diff --check`。
- **目标完成清单**：三档判据 + 双栏外壳（前三批）· 桌面式顶栏页签 / 常驻大纲 / 胶囊退场（第二批）· 双套快照门禁（第三批）· 首页禁横滑 / 表格 ribbon 否决（第四批）· 表格只读 dock（第五批）· 多窗口外壳高修复 + 多维表添加记录（第六批）· 手写板内联色板（第七批）· 视图配置排序/分组（第八批）· 筛选编辑器（第九批）· 多维表 9 项工具条 + 行高（第十批）· 外接键盘快捷键（第十一批）· 多窗口实测（本批）。
- **明确不做 / 遗留**：**iPad / iPhone = 没有端**（仓库无 `ios/` 工程；这不是「适配」任务，而是先建 iOS 壳：Capacitor iOS + 三个原生端口 + 签名分发，另立项）；条件填色规则编辑器；导入 CSV 列映射对话框；真机手写笔延迟/掌托验收；纯高度拖拽的键盘判定盲区。

### 10.15 第十三批：悬浮目录/大纲 + 正文满宽 + 收起键盘（**口径变更**）

> ⚠️ **本条覆盖 §3.1/§3.3/§3.6/§3.8 与 §10.1 的「正文限宽 760 居中 / expanded = 双栏」**：用户在第十三批的口径是**正文满宽**（正文不被 280/240 侧栏挤窄），侧栏改为按需悬浮。§3 的「限宽」建议与 §10.1 的双栏描述只作历史背景；§10.14 完成清单里的「双栏外壳 / 常驻大纲」以本条为准。

- **悬浮覆盖层（不占布局）**：`.pad-tree` 280 / `.pad-outline` 240 改 `position:fixed`（top = `--pad-float-top` = 顶栏 44 + margin 8 + `max(0, safe-top - 8)`；圆角 + `--lake-shadow-popover`；**无遮罩**）。
- **层序**：两者 z-index 用 **`--mobile-z-drawer`(45)**（= 手机抽屉层；高于页面 30、低于底部 Sheet 70 / 菜单 81 / 对话框 90）。**不要用 `--lake-z-sidebar`(250)/`--lake-z-outline`(260)** —— 那是桌面外壳的数值，在移动端会压住 Sheet/菜单/对话框。
- **默认收起 + 三路收起**（覆盖层会盖正文 ⇒ 生命周期跟抽屉一致，不跟常驻栏一致）：默认 `padTreeOpen/padOutlineOpen = false`；收起路径 = 顶栏按钮 / **点正文**（`.mobile-workspace-body` onPointerDown）/ **Esc**（`usePadShortcuts` 逐层：浮层 → 树 → 大纲）；**点开文档自动收左栏**。
- **Esc 逐层语义（本批修的真 bug）**：`usePadShortcuts` 的 handler 可返回 `false` = 「本层没东西可关」⇒ 不 `preventDefault`，把键让给后注册的监听者。此前 `MobileApp` 无条件挂 escape 并 preventDefault，工作区那条永远收不到（现象：浮层收得掉、树收不掉）。
- **正文满宽**：`.mobile-doc-body .lake-editor-mount` 与 `.ne-engine` 取消 760 限宽/居中；改 `--mb-reader-pad: 32px`（只给文档正文面；手机仍 20）。**代价**：1280 窗口行长≈1216px，可读性弱于限宽——这是用户口径，别默默改回去。
- **首页**：`.mobile-library` 与 `.mobile-home-tabs` 1080（小记时间线仍 760）；`.mobile-scroll` 不再为胶囊预留 96px（平板没有底栏胶囊）。
- **令牌修正**：两处 `var(--hairline)` → `var(--lake-border-1)`（`--hairline` 全仓未定义 ⇒ 树/大纲头部的 0.5px 分隔线此前根本没画）。
- **收起键盘浮钮**：平板没有 dock ⇒ `useKeyboard().keyboardOpen` 时顶栏内渲染 `.pad-kb-dismiss`（fixed 右下、`.mb-btn` 44 触达）；顶栏 `onPointerDown` 一律 blur 收 IME。
- **门禁与基线**：平板 6 态**重烤**（home-doc 2012 → 1913：树不再常驻挂载 + 正文几何变；其余 1822/1822/1827/1912/1849 不变），连跑两轮 0 差异；手机 6 态元素数全不变（1997/1822/1822/1827/1912/1849），`pm clear` 重灌夹具后只有 home-doc 指纹变（行 key 带文档 id，装置既有约定）⇒ 按 README 重烤 `mobile-snap.json` 后 0 差异。`mobileLayers.test.ts` 的 `pad.css` 基线 **152 → 151**。
- **设备实测（lake_tab / emulator-5582，1280×800）**：默认 tree/outline 不渲染；开树 280 / z=45；点树行开文档 → 树收起；点正文 → 收起；Esc → 收起；大纲 320 同理（261103 加宽）；键盘模拟（视口压到 400）→ 「收起键盘」浮钮 85×44 出现在右下，点顶栏后 activeElement=BODY、恢复视口后浮钮消失。
- **已知没做（有意）**：无遮罩；跨档 32px 滞后（§3.2#5）；横屏左右 `safe-area-inset-left/right`；顶栏小按钮（页签关闭 26 / ＋ 28）低于 44 Rule —— 例外登记在 `docs/MOBILE-DESIGN.md` 的「Pad shell」一节。

### 10.16 第十四批：**口径反转** —— 工具条全部回移动端 + 胶囊回归 + 树/大纲可固定（分支 `feat/pad-touch-ui`）

> ⚠️ **本条覆盖 §10.4（胶囊退场 / 桌面式顶栏）、§10.7（表格只读常驻 dock）、§10.9（手写板内联色板）、§10.12（多维表 9 项工具条 + 行高）**，以及 §8「工具栏向桌面看齐」的整体路线：
> 用户结论 = **「即使使用 pad，桌面端那套逻辑也不适合触屏」**。平板从「桌面式」回到 **「更宽的移动端外壳」**。
> **不受影响**：§10.9–§10.11 的「视图配置 筛选/排序/分组可写」（手机也在用、与形态无关）；§10.5/10.6/10.13/10.14/10.15 的判据、门禁、多窗口、快捷键、悬浮层与正文满宽仍然有效。

- **工具条（一律与手机一致）**：Lake 编辑态回 `EditorDockHost`（`showToolbar:!editing`，内核固定工具栏不再启用）；多维表删 9 项文字条 + 行高入口（筛选/排序/分组从「视图配置」页签进）；手写板删 `inlineTools`（回 v3 悬浮色板/笔宽，prop 已整体删除）；表格删只读常驻 dock（只读=无 dock，编辑态 fixed + 96px spacer）。**不要再给平板开第二套工具条**。
- **胶囊**：工作区胶囊（文档树/标签页/大纲/切换笔记本）在 expanded 恢复渲染；平板顶栏只留「返回 + 文档页签条 + 查找/编辑/同步」；胶囊编辑态隐藏（手机同款）。AGENTS 的「平板不挂胶囊」例外已撤回。
- **树/大纲**：默认收起 + 默认**悬浮**（fixed，左 280 / 右 320 = `--pad-outline-width`，z=`--mobile-z-drawer`45）；面板头 **Pin 固定按钮** → `position:static` 停靠进布局，`.pad-main--docked` 改 row 三栏、可编辑空间收窄（实测正文 1280→1000）；再点回悬浮。收起 = 胶囊/点正文/Esc，**固定态不吃这些收起路径**（它不是临时浮层）；点开文档自动收悬浮左栏。**固定状态持久化**：`lakex-local-notes-mobile.pad-panels`（只存 {tree,outline} 的 pinned；设备本地视图，不写正文/不进 S3；冷启直接按固定态停靠展开；坏值/缺字段回落 false）。门禁装置每态前会清掉这个 key（`snap-lib.clearPadPanels`），保证基线只认「无固定」的默认态。
- **宽度**：正文满宽 + `--mb-reader-pad:32`（沿 10.15）之上，知识库补齐 —— `.mobile-library`/`.nb-shelf`/`.nb-list` 1080 + 书架列 `repeat(auto-fill,minmax(96px,1fr))`（1280 实测 9 列、书架 976）；小记时间线仍 760。
- **画布高度**：`.mobile-doc-body > .lake-editor` 与 `.lake-editor-mount` 在 expanded 下 `height:100%`（内核按内容撑成 ~85px，挂载实高 85→612）。**已知**：点画布空白处不会落光标（内核只认引擎内点击，与手机一致）——如需"点空白即定位文末"要另加 JS。
- **键盘**：dock 的 `.med-btn--kb` 就是收起/展开键盘（手机同一条）；十三批的 `.pad-kb-dismiss` 浮钮与顶栏 `onPointerDown` 已删。
- **门禁**：tsc 0 / vitest 548 文件 3408 例 / check:core 135 / check:mobileui / 双 build / check:bundle / diff-check；`mobileLayers` 基线收紧（pad.css 144、usheet-chrome 542、bitable 896）。
- **手势 = 胶囊**：`usePanelDrag` 在 expanded 下把 `getPanel/getMask/isOpen/commit` 指向**悬浮左/右栏**（手机抽屉在平板不渲染）⇒ 横向手势与胶囊打开的是同一个面板；关闭态没有 DOM 可跟手，松手后以 250ms 入场动画出现（reduced-motion 已登记），打开态仍可跟手滑走。**不要**再让平板走 `.side-panel` 抽屉（会带出遮罩/空抽屉，且没有 Pin）。点正文收起用 `onClick` 不是 `onPointerDown`（手势从正文起手，pointerdown 会把面板提前收掉再被同一手势判成拉开另一侧）。
- **设备**：见 HANDOFF §0 第十四批（lake_tab，胶囊 4 项 / 固定前后 position 与正文宽度 / 编辑态 dock 与内核工具栏 0 / 知识库 976·9 列 / 画布 612）；手势实测两向开合都落在 `.pad-tree`/`.pad-outline`（phone drawer / mask = 0）。平板 6 态重烤后两轮 0 差异（home-doc 1913→1912），手机 6 态 0 差异。

### 10.17 胶囊常显（文档编辑态）+ 底距下移 + 编辑态手势（261103）

- **胶囊**：底距 = status + gap + safe − `--mobile-capsule-drop`(12)（32 → 20px；手机/平板同一处）。文档编辑态**常显**并抬到 dock 上方（`.mobile-bottom-bar--above-dock` = dock 56 + gap 8）；`.mobile-workspace--capsule-edit .mobile-doc-body` 补正文底距。表格/多维表/画板/手写板编辑态仍隐藏。
- **手势**：`usePanelDrag.allowFrom` 允许从 Lake 正文（contenteditable）起手；`canOpen` 只认文档类型 —— 其余编辑器横滑 no-op（胶囊仍可用）。手机与平板同一条判据。
- **设备（261103）**：pad 读态胶囊 bottom 20；pad 编辑态胶囊 bottom 680（dock 688，gap 8）、右滑开 `.pad-tree`、左滑开 `.pad-outline`；phone 编辑态等价（`.side-panel`）；usheet 横滑 no-op。
- **大纲加宽（同日）**：`.pad-outline` **240 → 320**（令牌 `--pad-outline-width`；悬浮/停靠同宽）。实测 1280：悬浮 x=960 w=320；停靠后正文 960、main row。左树仍 280。
- **基线**：手机 6 态（home-doc 1997）+ 平板 6 态（home-doc 1897，干净夹具）都重烤，连跑两轮 0 差异（大纲不在 6 态里，加宽后平板门禁仍 0 差异）。
