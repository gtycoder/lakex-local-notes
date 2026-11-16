# 移动端设置页排版审计（261116 · 对标「左名右控件 / 去卡片框 / 分组层次」三步法）

> 任务：对**移动端设置页**（`src/mobile/settings/**` + `src/mobile/kit.css` 的 `mb-set-*` 骨架 + `src/mobile/mobile.css` 的设置外壳）做只读审计，对标用户贴的小红书三步法 ①左名称右控件、一项一行 ②去掉最外层卡片框 ③分组标题 + 组间多留白/组内少留白 + 删除类操作单独放底部；附加判据「设置页用左右排、注册/结账类表单用上下排」。
> 纪律：**只读仓库**（唯一写入 = 本文档）；不 commit；不跑 `--write-baseline`；未改 `src/`；设备上只做**导航与只读测量**（未切换任何设置项、未保存任何值）。
> 取证装置：`emulator-5554`（`lake_mobile`，WebView **133.0.6943.137**，CSS 视口 **412×842** @dpr 2.625；390 宽用 CDP `Emulation.setDeviceMetricsOverride` 临时覆盖，采完即清）。**没有** 用 `adb shell input`（本机模拟器不生效），全部走 CDP `Input.dispatchTouchEvent` / `Runtime.evaluate`。
> 截图：`/tmp/mobile-settings-audit/*.png`（绝对路径，清单见 §9；原始 JSON 同目录）。
> 门禁口径：视觉快照是 **`check:mobilesnap` 10 態**，跑在**专用实例 `lake_gate`(5556) + 固定夹具**上（见 `scripts/mobile-audit/README.md`），**不是**本次取证用的 5554 用户实例；本文所有「门禁成本」都按这条口径写。

## 0. 结论先行

### 0.1 一句话

**三步法里 ①③ 基本已经做到（且有实测数字支撑），②「去卡片框」与现有定稿直接冲突——只能列为待裁决，不能直接改**；另外顺带发现 **1 个真缺陷**（AI 页「模型」行控件溢出被卡片裁掉）和 **3 处一致性缺口**（单组页组标题重复、Block 动作/说明顺序三种写法、危险操作位置 2 处）。

### 0.2 三步法逐条判定

| 步骤 | 判定 | 关键证据 |
| --- | --- | --- |
| ① 左名称右控件、一项一行 | **对齐（达成）** | 设备可见 33 行 = **21 左右排 / 12 上下排**；12 处上下排里 **10 处是内容输入（Field，判据正确）**、2 处是长说明选择器（261113 用户点单）；「内容输入被塞进左右排」= **0 处** |
| ② 去掉最外层卡片框 | **冲突 → 待用户裁决（B1）** | 卡片 = `.mb-set-section` / `.mobile-settings-card`：**r16 + 阴影 + 0.5px 边 + 白底**（实测，见 §2.3）；这是 **v2 用户定稿**（`MOBILE-DESIGN.md:104`、`kit.css:227-238` 注释「261110 用户定稿：灰底 + 白卡」），且**桌面设置页也是白卡**（`feature.css:58-64`，260930 用户定稿）⇒ 改它要推翻两端定稿 |
| ③ 分组标题 + 组间多留白/组内少留白 + 删除类操作底部 | **部分对齐** | 标题 ✓（15px/600 + 图标）；间距 ✓（**组间 24px** vs **组内 0/8/12px**，见 §2.3）；危险操作：备份覆盖导入 ✓ 末组、资源清理 ✓ 靠底、回收站 ✓ 跟在对象行上；**根页数据维护卡不在最后一组**、**AI 页「清除 API Key」在中段** ⇒ 2 处待裁决（B2） |
| 附加判据「设置左右排 / 表单上下排」 | **对齐（达成）** | 选择器/开关/短数字/动作 = `Item`（左右排，17 个 Item 里 13 个；9 个 Switch 全行式）；内容输入 = `Field`（上下排，11 处全部；S3 6 / AI 4 / 更新 1）⇒ 与文章判据同向 |

### 0.3 最值得做的 3 件事

1. **A1（真 bug，先修）**：AI「模型」行 `Field` 里的「输入框 + 获取模型列表按钮」把控件列撑到 **382px**（可用 343px@412、321px@390），按钮被卡片 `overflow:hidden` 裁掉；412 裁 20px、390 裁 42px（截图 `20-ai.png` / `30-ai-390.png`）。
2. **A2（零风险纯排版）**：8 个**单组页**的分组标题与页标题完全重复（常规/外观/AI/历史/导入/资源管理/清理缓存/更新中心），去掉组标题可省约 30px/页且消除重复；多组页（云端与同步 5 组、备份与恢复 3 组、关于 2 组）**保留**。
3. **B1 提交裁决而不是直接改**：「去卡片框」是用户记忆点（灰底白卡 + r16 + 阴影），与桌面同源；建议拿 2 个方案 + 1 张对比图给用户定，不擅自动 5 个快照态。

### 0.4 两端该不该一致（先给结论）

**原则一致、实现必须独立（AGENTS §4 红线：移动端 UI 不共享桌面样式层/组件）**。实测两端共有：分组标题 + 白卡 + 0.5px 分隔 + 「组间 24px / 组内 12px」间距模型 + 行语义（Item 左右排 / Field 上下排）。**有意不同的三处**（不建议为了「一致」抹平）：①卡片圆角 12（桌面）vs 16（移动）、桌面靠 0.5px 边框显形 / 移动靠阴影+边；②**Field 布局相反**：桌面 `Field` 是「标题+说明在左、控件在右的单行」（用户 261007 定稿，`settingsPrimitives.tsx:57-75` + `feature.css:99-116`），移动 `Field` 是「标签在上、控件占满下一行」（用户 261102 3b 定稿，`settingsPrimitives.tsx:76-94`）；③**Block 动作顺序相反**：桌面 261116「说明在左、操作在右」右对齐（`compat.css:178`），移动 261109「能点的放前面」（`kit.css:346-349`、`BasicSettingsSections.tsx:65`）。建议：①② 维持现状（各有物理约束与用户定稿，把原因写进文档即可），③ 是唯一需要一次跨端裁决的差异（B4），裁决前不要单端偷改。

### 0.5 对 Lead 初查的核实

| Lead 初查项 | 核实结果 |
| --- | --- |
| `.mb-set-item` 是 flex 行（左名右控件） | **成立**：`display:flex; flex-wrap:wrap; align-items:center; min-height:60px; padding:12px 18px`（`src/mobile/kit.css:240-244`），实测行高 66–146（随说明行数） |
| `.mb-set-item--field` 是上下排 | **成立**：`align-items:flex-start` + 控件列 `flex:1 1 100%`（`kit.css:246-247`）；实测控件列宽 343（412）/321（390）吃满行宽 |
| v2 定稿有分组卡（`.mb-set-section` r16 + `--mb-shadow-card` + 0.5px 透明边） | **成立**：实测 `border-radius:16px`、`box-shadow: … 0.5px inset + drop`、`border-top-width:0.5px`（声明值）、白底；与文章②**直接冲突** |
| 分组标题已有 `.mb-set-section__title` | **部分成立**：实际在用的是 **`.mb-set-title`**（Group 的标题，15px/600，`kit.css:225`）；`.mb-set-section__title` 在本 12 个设置页 **0 次使用**（只有别的模块用 Section 的 title 变体） |

## 1. 方法与装置（可复现）

- 设备：`emulator-5554`（用户实例 `lake_mobile`；**不 pkill 模拟器/Electron**），App `com.lakexlocalnotes.android` 1.1.4 在跑。
- 连接：`bash scripts/emu-cdp.sh 9335` → CDP；驱动 = 自写 `/tmp/mobile-settings-audit/capture*.mjs`（只读导航 + 截图 + DOM 度量），复用仓库 `scripts/cdp-eval.mjs` 的 `Runtime.evaluate` 口径。
- 截图：每页 `Page.captureScreenshot`（= CSS 视口 × dpr，1082×2211）；另有 `adb exec-out screencap -p` 的整屏图（1080×2400）。
- 390 宽：`Emulation.setDeviceMetricsOverride({width:390,height:842,deviceScaleFactor:2.625,mobile:true})`，采完 `clearDeviceMetricsOverride`。
- 收尾：设置抽屉已关闭，App 回到原状态；**没有**改动任何设置值（本页所有开关/输入都是只读浏览）。
- 注意：手机快照门禁（`check:mobilesnap`）跑在 **`lake_gate` 5556 + 固定夹具**；本审计的 5554 是用户真实数据（例如 S3/AI 已配置），**截图只用于看版式，不用于比基线**。

## 2. 现状基线（实测 + 源码）

### 2.1 结构

- **根页**（=设置目录）：12 项 / **5 张卡**（`SETTINGS_MENU_GROUPS`，`src/mobile/settings/settingsMenu.ts:47-52`）：①常规·外观 ②云端与同步·备份与恢复 ③历史·导入 ④资源管理·清理缓存·回收站 ⑤AI 助手·更新中心·关于；行 `.mobile-settings-row`（`mobile.css:554-561`）左 icon + 名称 + 值（外观=浅色）+ chevron。
- **子页**：12 个（`SettingsView`，`settingsMenu.ts:16-28`）：常规 / 外观 / 云端与同步 / 备份与恢复 / 历史 / 导入 / 资源管理 / 清理缓存 / 回收站 / AI 助手 / 更新中心 / 关于；页头 = 返回 + 标题 + 空槽（`SettingsDrawer.tsx:302-317`）；内容 = `.mobile-settings-content`（`mobile.css:572-579`，padding 12/16/16、max-width 960 居中）。
- 骨架：`Group > (title + Section 卡 > 行)`（`src/mobile/ui/settingsPrimitives.tsx:18-34`）；行 = `Item`（左右）/ `Field`（上下）/ `Switch` / `Shortcut` / `Block`（整块）。

### 2.2 行语义统计（设备可见，412 宽；数字来自 `/tmp/mobile-settings-audit/view-*.json`）

| 页 | 行总数 | 左右排 | 上下排 | 其中 Field（内容输入） | 其中 Item-stacked | Switch | Block | 备注 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| 常规 | 8 | 6 | 2 | 0 | 2 | 3 | 0 | 2 行「最大同时打开标签数」「默认空间」= 长说明选择器 stacked |
| 外观 | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 主题分段控件 188px，右缘对齐 |
| 云端与同步 | 7 | 1 | 6 | 6 | 0 | 1 | 5 | 6 个 S3 字段全部 Field（正确） |
| 备份与恢复 | 0 | — | — | — | — | — | 3 | 全 Block（恢复/修复/迁移） |
| 历史 | 4 | 4 | 0 | 0 | 0 | 0 | 0 | 数字输入 96px 窄列，右对齐 |
| 导入 | 0 | — | — | — | — | — | 1 | 默认笔记本 |
| 资源管理 | 0 | — | — | — | — | — | 3 | 占用 / 未引用 / 云端 GC |
| 清理缓存 | 0 | — | — | — | — | — | 1 | 说明 + 统计 + 动作 |
| 回收站 | — | 列表行 | — | — | — | — | — | 空态；有数据时每行 = 恢复/彻底删除图标钮（`TrashList.tsx:110-111`） |
| AI 助手 | 7 | 4 | 3 | 3 | 0 | 1 | 3 | 模型行溢出（§5） |
| 更新中心 | 6 | 5 | 1 | 1 | 0 | 3 | 0 | 检查间隔 Field |
| 关于 | 0 | — | — | — | — | — | 2 | 关于 / 数据诊断 |
| **合计（设备可见）** | **33** | **21 (64%)** | **12 (36%)** | **10** | **2** | **8** | **15** | — |

> 源码全量（含当前条件未渲染的 4 行：自动同步模式/自动同步间隔 + 温度等）= **37 行：22 左右排 / 15 上下排 = 11 Field + 4 Item-stacked**。统计源：`grep -n '<Item\\|<Switch\\|<Field\\|<Block' src/mobile/settings/*.tsx`（Item 17 / Switch 9 / Field 11 / Block 8+）。

**「错的排法」判定**：
- **该上下排却左右排 = 0**：11 个 `Field` 全部是内容输入；`Item` 里的控件只有 PickerSheet / 按钮 / 开关 / 短数字（`NumField` 4 处都在历史页 `BasicSettingsSections.tsx:32-42`）。
- **该左右排却上下排 = 4**（文章判据下的偏差，但都是用户定稿）：`SettingsDrawer.tsx:328,347,534,545` 的 `Item stacked`；理由是说明太长、选择器当前值长（`settingsPrimitives.tsx:50-57` 注释「261113 用户点单」）。→ B3。
- 根页 12 行 = **100% 左右排**（名称左、值/chevron 右）。

### 2.3 组与间距（实测 px；设备 + 源码令牌）

| 项 | 移动端实测 | 桌面（对照） |
| --- | --- | --- |
| 组间 | **24px**（`.mb-set-group{margin-bottom:24}`，逐页 `gapToNext` 均 24） | 24px（`.config-group{margin:0 0 24px}` + `feature.css:46`） |
| 组内「标题 ↔ 卡」 | **8px**（group `gap:8px`，实测 `gapTitleToCard`=8） | 8px（`config-title margin-bottom:8`，`feature.css:48-49`） |
| 组内「卡 ↔ 卡」（多卡组） | **12px**（`.mb-set-items{gap:12px}`，`kit.css:226`） | 12px（`.config-items{gap:lg}`，`feature.css:57`） |
| 行间 | **0px + 0.5px 分隔线**（`.mb-set-item{border-top:.5px}`，首行去边 `kit.css:245`） | 同：0.5px 分隔（`feature.css:75-82`） |
| 行内距 / 行高 | padding **12 / 18**；min-height **60px**（`kit.css:242`） | padding 12 / 16；min-height **56px**（32 设置档 + 24，`feature.css:80`） |
| 卡 | **r16 + 阴影 + 0.5px 边 + 白底**（`kit.css:238`，实测 `box-shadow: 0 0 0 .5px inset + drop`；`overflow:hidden`） | r12 + **0.5px 边框、无阴影**（`feature.css:58-64`） |
| 根页列表 | 卡间 **24px**、行高 60、列表内距 8/16/24（`mobile.css:546,549,554`） | — |
| 页内距 | 16（`--mb-page-pad`） | 24（`config-block padding 16 24`） |

结论：**「组间多留白、组内少留白」已达成**（24 vs 0/8/12）——比文章要求还严格；组标题 15px/600（实测）也与 `MOBILE-DESIGN.md:177` 的定稿一致。

## 3. 三步法逐条结论

### 3.1 ①「左名称右控件、一项一行」→ **对齐**

- 覆盖率：设备可见 21/33 = 64% 左右排；剩下 12 处上下排里 **10 处是内容输入**（正确），2 处是长说明选择器（用户点单）。
- 逐行错排：0；该上下排却左右排：0（S3 6 个 URL/密钥字段、AI 4 个字段全部全宽上下排，390 宽下控件列 321px 仍完整）。
- 与文章的唯一偏差是 **4 处 Item-stacked**（见 §2.2）——文章判据下这 4 处应改成左右排，但它们是 261113 用户明确点单；**B3 待裁决**，不建议直接改。
- 设备截图：`10-root-menu.png`（根页 100% 左右排）、`20-editor.png`（2 处 stacked 与 6 处左右排同屏）。

### 3.2 ②「去掉最外层卡片框」→ **冲突，待用户裁决（B1）**

- 现状（实测）：子页每段一张白卡（r16/阴影/0.5px 边/白底，`overflow:hidden`）；根页每组合成一张卡（同参数）。卡片之外没有第二层框（页面底色 = 灰），**「最外层卡片框」指的就是这层白卡**。
- 冲突证据：
  1. v2 定稿：`MOBILE-DESIGN.md:104`（「设置：分组卡 r16 + 行高 60…」）、`:272`（「分组边界 = 0.5px --lake-border-2（设置页的分组卡 .mb-set-section 就是靠它从白底上显形）」）；`kit.css:227-238` 注释写着「261110 用户定稿：恢复灰底 + 白卡层次」。
  2. 桌面同款：`src/styles/feature.css:58-64`（260930 用户定稿「整页按 AI 页新风格统一：分组内容由灰底块改成一叠白卡」）⇒ 去框不是「移动端小改」，而是**两端视觉记忆点**。
  3. 成本：会改 5 个快照态（`settings` / `settings-appearance` / `settings-s3` / `settings-backup` / `settings-about`，`mobile-snap.mjs:90-105`）+ 根页卡；元素数会变（卡片元素仍在，但阴影/边框/底色变）⇒ 必须重烤这 5 态（或 10 態）。
- 两个可裁决子方案（都需要用户点头）：
  - **方案 B1-a（保守）**：保留卡片，但**降阴影/去阴影 + 底色改透明**，只留 0.5px 细线（文章②的折中）。改动 = `kit.css:229-238` + `mobile.css:549`（2 个文件、4–6 条声明）；门禁 = 5 个设置態重烤 + `check:mobileui` + 设备截图。
  - **方案 B1-b（激进）**：去卡，分组只靠标题 + 分隔线（文章②字面）。改动同上 + 卡片 `padding` 归位；**元素数/几何都会变**（行宽从 343→380，行高与折行全变）⇒ 5 态全重烤 + 逐页走查；**不建议在没有用户明确要求时做**。
- 我的建议：**B1-a 可讨论，B1-b 不做**；理由：卡片是 v2 用户点单的层次手段（`kit.css:227-238` 注释与 `MOBILE-DESIGN.md:104,272` 双处记录），去掉后「组」只能靠标题+间距区分，而当前组间 24px 已够，收益是「更像网页设置页」，代价是两端视觉分叉 + 5 态重烤。

### 3.3 ③「分组标题 + 组间距 + 删除类操作底部」→ **部分对齐**

**(a) 分组标题：有 ✓，但单组页与页标题重复（A2）**

| 页 | 页标题（h1） | 组标题 | 是否重复 |
| --- | --- | --- | --- |
| 常规 / 外观 / AI 助手 / 历史 / 导入 / 资源管理 / 清理缓存 / 更新中心 | 各自 | 同名（更新中心 vs「更新」） | **重复 ×8** |
| 云端与同步 | 云端与同步 | 服务说明 / S3 对象存储 / 配置迁移 / 同步策略 / 同步诊断 | 不重复 ✓ |
| 备份与恢复 | 备份与恢复 | 恢复 / 修复缺失数据 / 从桌面迁移 | 不重复 ✓ |
| 关于 | 关于 | 关于 / 数据诊断 | 首组同名（2 组，建议保留） |
| 回收站 | 回收站 | —（列表页） | — |

**(b) 组间距：达成 ✓**（§2.3：组间 24 vs 组内 0/8/12）。

**(c) 删除类操作位置：逐页判定**

| 页 | 危险/破坏性操作 | 位置（实测 DOM 顺序） | 判定 |
| --- | --- | --- | --- |
| 备份与恢复 | 从便携包导入（覆盖本机） | **第 3/3 组（末组）** | ✓ 符合文章 |
| 备份与恢复 | 从云端恢复（换机/损坏） | 第 1/3 组（首组） | **保留建议**：这是本页主功能（页面名 = 备份与恢复），下沉会让人找不到；且按钮 disabled 有「云同步已关闭」提示 |
| 资源管理 | 清理未引用文件 / 云端 GC | 第 2、3/3 个 Block（页面靠底） | ✓ 符合（页面本身=维护） |
| 清理缓存 | 清理缓存 | 页面唯一 Block（单功能页） | ✓ 不适用「底部」 |
| 回收站 | 彻底删除 / 恢复 | **每行右侧图标按钮**（`TrashList.tsx:110-111`） | ✓ 危险紧跟对象（比「底部统一按钮」更安全） |
| AI 助手 | 清除 API Key | **第 1/3 个 Block（页中，模型之前）**（`AiSettingsSection.tsx:46-61`） | **与文章冲突 → B2b** |
| AI 助手 | 清空全部对话 | 第 3/3 个 Block（末） | ✓ |
| 根页 | 资源管理/清理缓存/回收站 | **第 4/5 张卡**（最后一卡 = AI/更新/关于）（`settingsMenu.ts:47-52`） | **与文章冲突 → B2a** |
| 常规 | 退出时关闭全部标签 | switch（非破坏性） | 不适用 |

> 补充：桌面导航顺序同样把「数据维护」放在 AI/更新/关于之前（`useSettingsPanelScope.tsx:518-530`）⇒ 根页「危险操作不在最底」**两端一致**，是 261109 用户定稿的「按使用频率排序」，不是移动端漏做。若要按文章改，**必须两端一起改**（否则两端目录顺序分叉）。

**(d) Block 内部「动作 / 说明」顺序：三种写法（A3 + B4）**

| 写法 | 页面 | 证据 |
| --- | --- | --- |
| 手写 DOM：名称 → 动作 → 说明（用户 261109「能点的放前面」） | 备份与恢复 ×2 | `SettingsDrawer.tsx:683-699`、`704-718` |
| 原语 class：`mb-set-block--actions-first` | 关于·数据诊断 | `BasicSettingsSections.tsx:65` + `kit.css:349` |
| 原语默认：名称 → 说明 → 内容/动作 | 导入、资源管理、清理缓存、关于·关于 | `Block`（`settingsPrimitives.tsx:96-104`）、`SettingsDrawer.tsx:383,409-437,728-744` |

⇒ 同一语义三套实现；A3 建议先把「手写块」收进原语（零视觉变化），顺序方向本身（动作在前 vs 说明在前）留 B4 裁决。

## 4. 390 宽专项（文章判据「长名称不被挤/折行」）

覆盖方式：CDP `Emulation.setDeviceMetricsOverride(390×842)`，对 12 个页面重采「名称行数 / 横向溢出元素」（`/tmp/mobile-settings-audit/overflow-<view>-390.json`）。

| 检查 | 结果 |
| --- | --- |
| 名称折行（`nameLines>1`） | **0 处**；最长名称「最大同时打开标签数」在 390 宽下名称宽 **321px**（= 整行可用宽）仍单行 |
| 名称横向溢出（`scrollWidth>clientWidth`） | **0 处** |
| 内容横向溢出（右侧超出视口） | **仅 AI 页 3 个元素**（模型行的 ctl/按钮，right=416 > 390，见 §5）；其余 12 页 **0 offenders** |
| 滚动容器横向溢出（`contentScrollW > clientWidth`） | 0（横向溢出被卡片 `overflow:hidden` 裁掉，所以滚动条也不出现 —— 这也是 §5 难被发现的原因） |
| 说明折行 | 正常（1–4 行，行高随之长，无裁切） |

截图对照：`30-editor-390.png` / `30-s3-390.png` / `30-ai-390.png` / `30-backup-390.png`。

## 5. A1 真缺陷：AI「模型」行控件溢出（P0 布局 bug，非文章议题）

**现象**：AI 设置页「模型」行（`AiSettingsSection.tsx:63-78`）里是「输入框 +『获取模型列表』按钮」两个控件；按钮右侧被卡片边缘裁掉（`20-ai.png` 可见「获取模型列」被切；390 宽更严重 `30-ai-390.png`）。

**证据链（全部实测）**：

| 量 | 412 宽 | 390 宽 |
| --- | --- | --- |
| 行右边 / 卡片右缘 | 396 | 374 |
| 控件列 `.mb-set-item__ctl` 宽 / 右缘 | **382 / 416** | **382 / 416** |
| 溢出到卡外 | **20px** | **42px** |
| 行 `scrollWidth / clientWidth` | 400 / 379 | 400 / 357 |
| 控件列 `flex` / `min-width` | `1 1 100%` / `auto`（`kit.css:247`） | 同 |
| 卡片 `overflow` | **hidden**（`kit.css:238`）⇒ 静默裁切 | 同 |
| 用例元素 | `{"rowScrollW":400,"rowClientW":379,"ctlW":382,"sectionOverflow":"hidden","sectionRight":396,"ctlRight":416}` | `{"rowClientW":357,"sectionRight":374,"ctlRight":416}` |

**根因**：`.mb-set-item--field .mb-set-item__ctl { flex: 1 1 100% }`（`kit.css:247`）只按「单控件吃满」设计；但 `模型` 行塞了**两个**子控件（`TextField` 245px + 8px gap + 动作区 129px）。`--field` 的 `ctl` 没有 `flex-wrap`，子项 `min-width:auto` 让 `ctl` 的 min-content 宽 = 382 > 可用 343/321 ⇒ 溢出卡片右缘，被 `.mb-set-section{overflow:hidden}` 裁掉（所以 `scrollWidth` 也不报警）。

**修复方案（二选一，均不改语义）**：
- **A1-a（推荐，CSS 一处收口）**：`.mb-set-item--field .mb-set-item__ctl` 加 `flex-wrap: wrap`，并把 `--field` 内 `.mb-input` 从 `width:100%` 改成 `flex: 1 1 160px; min-width: 0`（允许按钮在窄屏换到下一行）。影响面：11 个 Field 行里只有「模型」行有两个子控件（其余 10 行单控件，视觉不变）；门禁：`check:mobileui`（`mobileLayers` 基线 +1～2 声明需登记理由）+ `tsc` + `vitest` + 设备 412/390 两档截图；**AI 页不在 10 態内 ⇒ 无需重烤快照**。
- **A1-b（局部结构）**：把「模型输入 + 按钮」包成一个自有行内 `div`（`flex-wrap: wrap`），不动共享 `--field` 规则。影响面最小，但会在 AI 页多一层 DOM；门禁同 A1-a。

**验收**：412 与 390 两档下，AI 页 `document.querySelector('.mb-set-item__ctl').getBoundingClientRect().right <= 卡片右缘`；用本次探针（`overflow.js`）跑「12 页 0 offenders」；截图人工复核按钮完整可见。

**顺带建议（可选）**：给 `.mb-set-section`（`overflow:hidden`）加一条开发期探针「子元素右缘 > 自身右缘即 warn」，否则这类溢出永远静默。

## 6. 分级建议（A 立即可做 / B 需裁决 / C 不建议）

> 每项：改动文件 / 门禁成本（`check:mobilesnap` 10 態 = lake_gate 5556 + 夹具；`check:mobileui` = 独立性 + 层基线 + ui-metrics）/ 验收方式。

### A 立即可做（零裁决风险；纯排版/缺陷）

| # | 事项 | 改动文件 | 门禁成本 | 验收 |
| --- | --- | --- | --- | --- |
| A1 | 修「模型」行控件溢出（§5） | `src/mobile/kit.css`（A1-a）或 `AiSettingsSection.tsx` + 局部 css（A1-b）；若加声明需同步 `src/mobile/mobileLayers.test.ts` 基线注释 | `tsc` + `vitest` + `check:mobileui`；**AI 页不在快照態** ⇒ 无重烤；**若改共享 `--field` 规则**，另跑 10 態（至少 5 个 settings 態）确认 0 差异 | 412/390 截图按钮完整 + `overflow.js` 探针 0 offenders |
| A2 | 去掉 8 个**单组页**的分组标题（常规/外观/AI/历史/导入/资源管理/清理缓存/更新中心），多组页保留 | 对应 `Group title` 调用点：常规 `SettingsDrawer.tsx:319`；外观 `BasicSettingsSections.tsx:16`；AI `AiSettingsSection.tsx:29`；历史 `BasicSettingsSections.tsx:30`；导入/资源管理/清理缓存 `SettingsDrawer.tsx:382,408,727`；更新中心 `UpdateCenterSection.tsx:131` | `check:mobileui` + `tsc/vitest`；**`settings-appearance` 態元素数会变 ⇒ 重烤 1 態**（`--states settings-appearance`）；其余页不在快照態 | 设备截图 8 页；页面不再渲染 `.mb-set-title`（`view-*.json` 的 `groups[].title` 为空） |
| A3 | Block 三套实现收口（零视觉）：备份页 2 个手写 `mb-set-block` 改用原语（需先给移动 `Block` 加 `actions-first` 变体）；其它手写块（缓存/同步诊断）逐步迁 | `SettingsDrawer.tsx:683-699,704-718,728-744,580-620`、`settingsPrimitives.tsx:96-104`、`kit.css`（若加变体 class 复用 `--actions-first`） | `tsc/vitest` + `settings-backup` 態 0 差异（不重烤）；`check:mobileui`（若动 CSS） | 备份/缓存两页截图逐像素比对（备份態 0 差异） |

### B 需用户裁决（与既有定稿/偏好冲突，不要擅自动）

| # | 事项 | 冲突点 | 若做：改动文件 + 成本 |
| --- | --- | --- | --- |
| B1 | **去/弱化卡片框**（文章②） | 移动 v2 定稿（`MOBILE-DESIGN:104,272`）+ 桌面 260930 定稿（`feature.css:58-64`） | `kit.css:229-238` + `mobile.css:549`（B1-a 保守：4–6 声明）；5 个设置態重烤 + 逐页截图；B1-b 去卡需全量走查，不建议 |
| B2a | 根页把「资源管理/清理缓存/回收站」从第 4 卡挪到**最后一卡**（或单独底部危险组） | 261109 定稿「按使用频率顺序对齐桌面」；桌面同序（`useSettingsPanelScope:518-530`） | `settingsMenu.ts:47-52`；1 个根页態（`settings`）+ 两端同改需桌面一起评审；只改移动会造成两端目录顺序分叉 |
| B2b | AI 页把「清除 API Key」移到页尾（与「清空全部对话」同段） | 261109「能点的放前面」；且「清除 Key 紧邻 Key 字段」更直观 | `AiSettingsSection.tsx:46-61` 块位置；AI 页无快照態 ⇒ 成本低；需用户点头 |
| B3 | 4 处 `Item stacked`（最大同时打开标签数/默认空间/自动同步模式/自动同步间隔）改回左右排 | 261113 用户点单（说明长/当前值长时上下两段）；改回后 390 宽下说明会折 2–3 行、选择器需 ≥120px 右列 | `SettingsDrawer.tsx:328,347,534,545`（去掉 `stacked`）+ 可能 `kit.css` 微调；`settings` / `settings-s3` 態重烤（2 態） |
| B4 | Block 内「动作/说明」顺序统一方向（文章③ ⇒ 危险/动作靠底；261109 ⇒ 动作在前） | 两种用户定稿互相矛盾（备份/关于=动作在前；缓存/导入/资源=说明在前） | 先定方向，再统一 8 个 Block；备份/关于/资源/导入 4 页中 2 页在快照態 ⇒ 重烤 `settings-backup` / `settings-about` |
| B5 | 两端「同名原语不同形」是否要统一（移动 Field stacked / 桌面 Field 单行；Block 顺序相反） | AGENTS §4 红线：移动端 UI 独立实现；两端各有用户裁决（261102 vs 261007、261109 vs 261116） | **建议不统一物理实现**；把差异原因写进 `MOBILE-DESIGN` / 审计文档即可（文档改动，零门禁） |

### C 不建议（会给现有判据/定稿引入倒退）

| # | 事项 | 理由 |
| --- | --- | --- |
| C1 | 把 S3（6 字段）/ AI（4 字段）等长表单压成左右排（文章「一项一行」的误用） | 违反 261102 3b 判据与文章自己的「表单类用上下排」；412/390 宽下 URL/密钥用 200–300 窄栏会截断；实测 Field 现在极稳（0 溢出、390 无折行） |
| C2 | 引入桌面 `.config-*`/`components/ui/settingsPrimitives` 或在移动端共享桌面样式层 | 违反 AGENTS §4 与 `src/mobile/mobileIndependence.test.ts`（桌面样式 import 白名单 / 桌面类名 token=0）；两端 DOM/尺寸模型不同（27/32 控件档 vs 44/48） |
| C3 | 把「关于/数据诊断」等纯信息 Block 改成左右排 | 无控件、无「名称-值」对照需求，左右排只会让长说明更窄（关于页有 5 条长免责说明） |
| C4 | 根页 12 项合并成一张卡 / 无卡（比 B1-b 更激进） | 破坏 5 组信息架构（卡 = 分组边界），12 行一卡会失去组间留白与图标分组语义 |
| C5 | 为了「一项一行」把 2–3 行说明压成单行省略号 | 丢失「不影响正文/仅本机/同步后传播」等关键前提；390 宽实测说明折行正常、无裁切，不需要压缩 |
| C6 | 把设置行高从 60 降到 `MOBILE-DESIGN.md:197` 表里的 48 | 60 是 v2 定稿（`MOBILE-DESIGN:104` 与 `kit.css:242` 同值）；48 是旧表述/别类列表行；改小会降可点性。若要一致，改文档不改代码 |

## 7. 两点补充（文档漂移 / 死原语）

1. **文档漂移**：`MOBILE-DESIGN.md:104` 写「组内距 18」，同文件 `:177` 写「组内间隔 8/12px」；实测组内是 **0（行）/8（标题→卡）/12（多卡）**、18 实际是行的**横向内距**。建议改文档措辞（代码不用动）。
2. **未被使用的原语面**：`Section` 的 `title` 变体（`.mb-set-section__title`，`kit.css:239`）在 12 个设置页 0 使用（组标题都走 `.mb-set-title`）。不是死代码（别的模块在用），但设置页不需要它——A2 改标题时别误动它。

## 8. 桌面对照（两端该不该一致）

| 维度 | 移动端 | 桌面 | 是否一致 |
| --- | --- | --- | --- |
| 行语义 | `Item` 左右排 / `Field` 上下排 / `Switch` 行 / `Block` 整块（`settingsPrimitives.tsx:42-134`） | 同名原语 `Item` / `Field` / `Block`（`components/ui/settingsPrimitives.tsx:37-90`） | 语义一致 ✓ |
| Field 布局 | 标签上、控件占满下一行（261102） | 标题+说明左、控件右单行（261007，`feature.css:99-116`） | **有意不同**（触屏窄屏 vs 鼠标宽屏） |
| 控件列 | 行式控件内容宽（86–118），字段全宽 343/321 | 控件列 min-width 200 右对齐；下拉固定 200、字段输入 300（`feature.css:96,105,112,114`） | **有意不同**（桌面 261116「下拉窄栏 200」只对桌面成立） |
| 组标题 / 组间距 / 行内距 | 15/600；组间 24；行 12/18 | 组标题 15/600（`feature.css:48-53`）；组间 24；行 12/16 | 一致 ✓（移动行高 60 vs 桌面 56，触屏 +4） |
| 卡片 | r16 + 阴影 + 0.5px 边 + 白底 | r12 + 0.5px 边框、无阴影 | 原则一致（白卡分组），细节有意不同 |
| Block 内动作位置 | 261109「动作在前」（备份/关于），其余页说明在前 | 261116「说明在左、动作在右」右对齐 | **需一次裁决（B4）**；物理实现保持独立 |
| 目录顺序 | 12 项 5 卡，数据维护在前（`settingsMenu.ts:47-52`） | 常规→外观→快捷键→云同步→备份→历史→数据维护→浏览器→AI→更新→关于 | 一致 ✓（261109 对齐桌面） |

> 桌面行号按本次采集时的工作树（261116 约 11:30）；`feature.css` / `compat.css` 当时有并行未提交改动，行号可能漂移几行，以规则名检索为准。

**结论**：**该一致的是「判据」**（行语义、组层次、间距模型、目录顺序），**不该强求「同形」**（Field 单行 vs 上下排、卡片阴影、控件窄栏）。跨端「统一」只能通过「同一条判据 + 各自实现」完成，不能共享 CSS/组件（AGENTS §4 + `mobileIndependence.test.ts`）。B4 是唯一需要一次跨端决议的差异（Block 动作顺序）。

## 9. 截图与原始数据（/tmp/mobile-settings-audit/）

| 文件 | 内容 |
| --- | --- |
| `10-root-menu.png` | 设置根页（5 卡 12 项） |
| `20-editor.png` / `20-appearance.png` / `20-s3.png` / `20-backup.png` / `20-history.png` / `20-import.png` / `20-resources.png` / `20-cache.png` / `20-trash.png` / `20-ai.png` / `20-update.png` / `20-about.png` | 12 个子页（412 宽，含 A1 溢出证据） |
| `30-editor-390.png` / `30-s3-390.png` / `30-ai-390.png` / `30-backup-390.png` | 390 宽（长名称/换行/A1 加重） |
| `00-current.png` / `01-settings-open.png` / `02-state.png` / `03-state.png` | 现场过程态（入口/抽屉动画/中间态） |
| `menu.json` / `view-<page>.json` | 每页组/行/控件/宽度/折行/危险操作位置的 DOM 度量 |
| `overflow-summary.json` + `overflow-<view>-<412/390>.json` | 两档宽度的横向溢出与滚动宽度扫描 |
| `measure.json` + `measure-menu.json` | 计算样式（卡 r16/shadow/border、组间距、行高、标题 15/600、Block 顺序） |
| `capture-log.json` | 采集步骤日志 |

采集脚本（可重跑）：`/tmp/mobile-settings-audit/capture.mjs / capture2.mjs / capture3.mjs / measure3.mjs` + 各 `dump-*.js` 表达式；设备侧 CDP 转发 = `bash scripts/emu-cdp.sh 9335`。

## 10. 边界与后续

- 本次**只审计**：没有改 `src/`（`git status` 里移动端设置相关文件无改动）、没 commit、没跑 `--write-baseline`、没 pkill 模拟器/Electron；设备只导航 + 只读测量，设置抽屉已关闭。
- A 项落地时的顺序建议：**A1（bug）→ A2（去重复标题）→ A3（Block 收口）**，每项单独提交；A2 需要重烤 1 態（`settings-appearance`），重烤按 `scripts/mobile-audit/README.md` 的「专用实例 + 夹具 + 暖态」配方。
- B 项在用户裁决前**不动代码**；B1/B2/B3/B4 任一落地都先出「前后截图 + 5 态（或对应态）门禁结果」再合并。
- 若后续想持续防「静默裁切」，把 §5 的 `overflow.js` 思路做成 `check:mobileui` 里的一条开发期断言（可选，不阻塞本次结论）。

---

## 11. 实施记录（261116 · A1 + A2 已落地，B 级未动）

> 依据用户「类似问题自己举一反三改掉」：只做 §6 的 A1（真 bug）与 A2（去重复组标题）；B1–B5 全部**未动**（取向问题，等裁决）。改动范围 = `src/mobile/**` 7 个文件 + 本文档；未 commit；未跑 `--write-baseline`。

### 11.1 A1：Field 多控件行溢出被卡片裁切（P0 真 bug）

**修法**（原语收口，不是单页补丁）：`src/mobile/kit.css`

| 选择器 | 改前 | 改后 |
| --- | --- | --- |
| `.mb-set-item--field .mb-set-item__ctl` | `flex: 1 1 100%;` | `flex: 1 1 100%; **flex-wrap: wrap**;`（多控件行允许换到下一行） |
| `…__ctl > .mb-input, > .mb-select--trigger` | `flex: 1 1 auto; width: 100%; min-width: 0;` | `flex: **1 1 160px**; width: 100%; min-width: 0;`（仍 grow 吃满；给同行按钮留空间） |

配套：`src/mobile/mobileLayers.test.ts` 的 `mobile/kit.css` 基线 **650 → 651**（+1 声明，注释写明 A1；棘轮「只许降」用登记理由放行，与既有做法一致）。

**设备实测（真机装包后；1080×2400 / CSS 412×842 @dpr2.625；390 用 CDP `Emulation.setDeviceMetricsOverride`）** —— AI 助手页「模型」行：

| 量 | 改前 @412 | 改后 @412 | 改前 @390 | 改后 @390 |
| --- | ---: | ---: | ---: | ---: |
| 控件列 `ctl` 宽 | 382 | **343**（= 可用宽） | 382 | **321**（= 可用宽） |
| `ctl` 右缘 vs 卡片右缘 | 416 vs 396（**溢出 20px 被裁**） | **378 vs 396（内缩 18px）** | 416 vs 374（**溢出 42px 被裁**） | **356 vs 374（内缩 18px）** |
| 行 `scrollWidth / clientWidth` | 400 / 379（溢出） | **379 / 379** | 400 / 357（溢出） | **357 / 357** |
| 页面横向溢出元素（右缘 > 视口） | 3 | **0** | 3 | **0** |
| 「获取模型列表」按钮 | 被卡片裁掉 | **完整可见**（右缘 374/356） | 被裁 | **完整可见** |

**未受影响的 Field 行**（证明是原语级等价修复）：S3 页 6 个字段的控件列仍是 **343 @412 / 321 @390**（与改前逐值相同）；接口地址 / API Key 同样 343/321；`rightGap` 均为 18。

截图：改前 `/tmp/mobile-settings-audit/20-ai.png`、`/30-ai-390.png`；改后 `/tmp/mobile-settings-audit/after/ai-412.png`、`/after/ai-390.png`。

### 11.2 A2：8 个单组页去掉与页标题重复的组标题

- 原语：`src/mobile/ui/settingsPrimitives.tsx` 的 `Group` **title 改为可选**，`{title && <h2 className="mb-set-title">…</h2>}`（保留 `<h2 className="mb-set-title">` 字面 ⇒ `settingsA11y.test.ts` 的「分组标题是 h2」契约与既有 h1→h2 层级不变；多组页仍必须给 title）。
- 去掉 title 的 8 页（调用点）：常规 `SettingsDrawer.tsx:319`、导入 `:382`、资源管理 `:408`、清理缓存 `:727`、外观 `BasicSettingsSections.tsx:16`、历史 `:30`、AI 助手 `AiSettingsSection.tsx:29`、更新中心 `UpdateCenterSection.tsx:131`；对应不再使用的 lucide 图标 import 一并清理（Pencil / Images / HardDrive / History / Sparkles / RefreshCw 各自仅被组标题使用；Palette 仍被「外观→主题」行图标使用，保留）。
- **多组页保留**（未动）：云端与同步（5 组）、备份与恢复（3 组）、关于（2 组）。
- 实测（装包后）：常规 / 清理缓存 / AI 助手页 `.mb-set-title` = **0**（页头 h1 仍在）；云端与同步 = **5**（未动）；组间距仍 24px，卡片直接贴到页头内距（每页少约 30px 顶部空行）。

截图：改前 `/tmp/mobile-settings-audit/20-editor.png`（有「✏ 常规」组标题）、`20-cache.png`；改后 `/tmp/mobile-settings-audit/after/editor-412.png`、`/after/cache-412.png`（组标题消失、卡片上移）；多组页对照 `/after/s3-412.png`。

### 11.3 门禁（本次实跑）

| 门禁 | 结果 |
| --- | --- |
| `npx tsc --noEmit` | **0 错**（`noUnusedLocals` 已把不再使用的图标 import 清干净） |
| `npm run check:mobileui` | **全部通过**（`mobileIndependence` / `mobileLayers`（kit.css 651 基线）/ `kernelStyleBootstrap` / `ui-metrics`） |
| `npx vitest run src/mobile` | **1725 passed / 3 skipped**，**1 failed**：`src/mobile/settings/settingsInputRows.render.test.tsx > SETTING_ITEMS 缺少 s3-endpoint` —— 该失败来自**并行任务对 `src/components/model/settingsSearch.ts` 的未提交改动**（把 s3-endpoint 等 9 条并成 `s3-config`，见当时 `git diff`），与本次 A1/A2 无关（本次没碰该文件，`INPUT_ROW_IDS` 一字未改）；该线落地后重跑即恢复。 |
| `bash scripts/android-build.sh --sync --install` | 成功（`vite build` 3.58s → `cap sync` → `gradle assembleDebug` BUILD SUCCESSFUL → APK 41,573,849 B → `adb install -r` Success → 启动）。**已 `git checkout -- android/capacitor.settings.gradle` 还原 cap sync 的生成差异**（`git status -- android` 干净）。 |
| mobile snap 10 态 | **未跑**（门禁在专用 `lake_gate`(5556)+夹具；本次只有 5554 用户实例；按任务要求不跑 `--write-baseline`）。影响见 §11.4。 |

### 11.4 mobile snap 影响（预计 2 态会红，其余 8 态 0 差异）

快照表达式采集 `flex` / `flexWrap` / `flexBasis` 等计算值（`scripts/css-audit/stylesnap.mjs:PROPS`）⇒ 即使几何不变，计算值变化也会改指纹；A2 直接改元素数。

| 態 | 影响 | 原因 |
| --- | --- | --- |
| `settings-appearance` | **-2 元素 + 几何上移** | A2：去掉 `<h2 class="mb-set-title">` 与其内 icon `<svg>`（2 个元素）；卡片上移约 30px |
| `settings-s3` | **指纹变化（元素数不变）** | A1：6 个 Field 行的 `__ctl` `flexWrap` nowrap→wrap、`.mb-input` `flexBasis` auto→160px（几何实测不变：343@412 / 321@390） |
| `settings`（根页） | 0 差异 | 根页用 `.mobile-settings-row`，不含 Field / 组标题 |
| `settings-backup` / `settings-about` | 0 差异 | 两页都是多组页（标题保留）且无 Field 行 |
| 首页 5 态 | 0 差异 | 不渲染设置原语 |

> 结论：重烤只需 **`settings-appearance`**（元素数变）+ **`settings-s3`**（计算值变）；重烤由 Lead 收口，本次未跑 `--write-baseline`。

### 11.5 复现（本次实际命令）

```bash
# 1) 改后装包（会自动改 android/capacitor.settings.gradle，跑完还原）
bash scripts/android-build.sh --sync --install
git checkout -- android/capacitor.settings.gradle

# 2) 设备取证（412 + 390；截图落 /tmp/mobile-settings-audit/after/）
bash scripts/emu-cdp.sh 9335
node /tmp/mobile-settings-audit/after-capture.mjs 9335

# 3) 门禁
npx tsc --noEmit && npm run check:mobileui
```

> 采集脚本 `after-capture.mjs` 与 `dump-view.js` / `measure-model.js` / `overflow.js` 均在 `/tmp/mobile-settings-audit/`；本次收尾已把设置抽屉关闭，App 回到首页。
