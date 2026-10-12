# HANDOFF.md — Lake Notes 项目交接（唯一权威交接文档）

> 写给**完全没有上下文的新会话**。接手顺序：**README → HANDOFF → AGENTS**；之后按需读相关 `docs/`。AGENTS 是长期红线/机制/坑，每次自动加载。
> **本文件只保留「最新 §0（1–2 节）+ 当前基线 / 真正的待办 / 有价值的坑」。**
> 所有历史 dated handoff（旧 `§0 <日期>` 节、`§2.x` 各批会话）已从本文件**删除**，只在 git 历史可查：`git log -p --follow HANDOFF.md`（或 `git show <旧提交>:HANDOFF.md`）。文中残留的 `§2.x` / 旧 `§0` 引用是**历史指针**，去 git 查，**不要在本文件重建历史**。
> **§8 是移动端（安卓）专职交接**，由移动端会话维护；桌面会话不要改 §8，移动端会话不要改 §0-§7 之外的桌面文件。

## 0. 最新交接（261012 → 261010）

> 写给完全没有上下文的新会话。接手顺序 **README → HANDOFF → AGENTS**。**本节只保留最新 1–2 批（261012 / 261010）**；更早的 dated handoff 已删除，只在 git 历史可查（`git log -p --follow HANDOFF.md`）。文中提到的「专项文档」= 已删除的 `docs/BITABLE-OPTIMIZATION-HANDOFF.md`。**真正的待办看 §3，长期坑看 §4，移动端看 §8。**
>
> **在途（未完成）**：~~移动端文本增强面板（字号 / 字色 / 背景色 / 对齐 / 链接）~~ **已完成（261012 移动端批，见下）**；
> 仍缺的移动端文本格式 = **H5/H6、缩进、行高、清除格式、格式刷**（§3 的覆盖缺口表里其余项）。
>
> **下一会话焦点（261012 收尾 → 下一会话，用户定）**：① **移动端文本增强二级面板**（见上）；② **5 项画图插入项解禁**（画板 / 流程图 / UML / 思维导图 / 文本绘图，现为置灰占位；根因与修法见 §3#18）；③ **页面详细测试 + 优化细节**（逐页走查、查漏补缺）；④ 若继续表格，取 `docs/USHEET-UPGRADE.md` §7 的中期项。表格性能（含 5000 行档）已收口，**别再优化包装层**（实测见下面 261010 节）。
> **已定不再讨论**：「开始」工具收窄后**隐藏旧工具就是为了让折叠的出来**（用户 261010 定：不给白名单、保持现状）；canonical 快照挪空闲时段暂不做；移动端/桌面抽公共 runtime、单实例多 workbook 共享不做；公式栏收起方案仅存档；MiSans 桌面字体（暂缓）；
> **移动端小记工具条不加「＋」面板入口**（用户 261010 定："这个+号本来就不应该出现，在移动端太突兀"）——已知副作用：移动端小记插不了表格/代码块/公式/等高亮块等（显示不受影响），别再提议加回。；**Android 端"先保证能用"**。**唯一已知遗留** = 多标签切换时内核工具条 1~4 帧绘制空帧，见 §3#9（诊断与可行方向已写全，别重复试提层类改动）。

### 261012 · 移动端 UI 独立化 P0–P2（本批；用户授权全做 P0–P7，进行中）

- **用户 261012 定稿口径**（本会话确认）：全做 P0–P7 · 两端都由本会话负责（无并行会话）· 先在途改动已提交
  · mobilesnap **已重烤** · 模拟器/语雀 App/数据随意用 · **沿用本项目色阶 + MiSans，只模仿语雀的形态与密度**
  · 只有 `+` 号用绿 · 字号走令牌（7 档）· 浅/深先做、warm 后续补 · 修首页 tab 命中区 · 破坏性确认走 ActionSheet · 保留既有手势。
- **P0 护栏（已交付）**：`src/mobile/mobileIndependence.test.ts` + `mobileLayers.test.ts`（允许红、基线只许降、
  stale 条目必须同步删）。实测冻结：桌面样式 import 14 条、桌面类名 token 11 文件 / **150** 处、反向耦合 kit.css 18 处、
  移动端 4 个 CSS 基线。口径写进文件头（**与文档里 56+8 的 grep 口径不同，不可直接比**）。
- **P1 令牌/皮肤（已交付，验收=视觉中性）**：新增 `src/mobile/theme/{index,base,tokens,light,dark}.css`；
  main.tsx 不再 import 桌面 themes/tokens；editor-dark.css 的取值块并入 theme/dark.css（54→13 条）。
  **实测 check:mobilesnap 6 态 0 差异**（视觉中性达标）。
- **P2 原语 + 首批迁移（已交付）**：`src/mobile/kit.css`（mb-* 248 条）；tokens 就地改字号 7 档（body 14→16）/
  行高/动效 + 新增移动端几何槽；10 个组件迁到 mb-*（桌面类名 **150 → 109**，剩 SettingsDrawer 留 P4）；
  **首页 tab 命中区 36×25 → ≥44**（走查 smallTap 2 → 0）；新增 `src/mobile/floating.css`（P3 浮层原语，已登记未接线）。
  验收：mobilesnap 6 态**元素数不变**（1755/1840/1755/1755/1833/1833）· 设备走查 **22/22 ok** · tsc ✓ · vitest 231/1815 ✓。
- **装置修复（本轮真因，已入 README）**：① stylesnap 的「内核 u<hex> id 不入 key」阈值 6 → 参数化（移动端 4 位，
  否则 home-quicknotes 每次换 key 前缀）；② 首页态**冷/暖取样差 29 元素**（1784/1755）⇒ settle 收紧 + **基线必须
  `--from` 暖态快照再写**；③ 走查选择器同时匹配 ln-*/mb-*（改名后 7 屏 ERR）。
- **P3 浮层原语（已交付，commit dcad2b2）**：`src/mobile/floating.css` 接线（`mb-sheet` / `mb-actionsheet` / `mb-toast` /
  `mb-menusheet` + 两种遮罩进场）；9 处组件迁名（6 个 Sheet + 菜单 Sheet + ConfirmDialog 改 ActionSheet + Toasts）；
  **不建 mb-dialog**。验收：mobilesnap **6 态 0 差异** · 设备走查 **22/22 ok** · tsc/门禁全绿。
  旧浮层类在 mobile.css / mobile-kit.css 已无 JSX 施加 ⇒ 留 P7 交 audit-dead-css 一次性清。
- **P4 设置页样板屏（已交付）**：新增 `src/mobile/ui/settingsPrimitives.tsx`（**移动端自建**版式原语，
  `mb-set-*` 骨架 + `mb-switch` + `mb-segment` + `mb-input` 内嵌输入；**`data-set-id` 契约不变** ⇒
  `settingsSearch.ts` 的 SETTING_ITEMS 继续有效）；SettingsDrawer 换 import + 全部类名换 `mb-*`；
  走查查出的 `.config-empty` 2.86:1 换成 `.mb-set-empty`（走 --lake-text-3 = AA）⇒ **settings-资源管理 对比度告警消失**。
  ⇒ **移动端源码的桌面类名 token 归零（109 → 0）**；护栏升级为「不允许再出现」+ 新增「不得 import 桌面 UI 组件件」
  （只留 treeDrag 一条冻结项，P6 处理）。验收：mobilesnap 重烤后**两轮 0 差异**（仅 settings 两态指纹变、元素数不变）·
  设备走查 **22/22 ok** · 视觉复核 settings / settings-外观 两屏。
- **P5 逐屏迁移 / 摘桌面样式（已交付）**：移动端入口**摘掉 4 个桌面样式表**（compat / kit / components / dialog），
  删除 `src/mobile/mobile-kit.css`（覆盖层退场：活规则 = 4 条内核浮层/工具条修正，收编进 `mobile.css`；
  其余在 P2–P4 迁移后已无 JSX 施加）。**反向耦合归零**：桌面 `styles/kit.css` 的 18 行
  `:is(.app-shell, .mobile-app)` 收窄回 `.app-shell`，移动端那份勾选原语搬进 `src/mobile/kit.css`。
  ⇒ 移动端现在只引 **1 个桌面样式表**（`styles/app/quick-notes.css`，P6 消灭）+ 2 个 feature CSS（P6 变体化）。
  **验收（关键证据）**：摘掉 4 个样式表**渲染零变化** —— check:mobilesnap **6 态 0 差异**（与 P4 基线逐元素计算值相同）
  + 设备走查 **22/22 ok**。
- **P7 部分（已交付）**：移动端指标**转门禁** —— 新增 `npm run check:mobileui`（= 独立性/层/内核样式三道护栏 +
  ui-metrics，一条命令，实测通过）；**`docs/MOBILE-DESIGN.md` 定稿**（YAML 令牌前置 + 色彩/字体/几何/浮层/组件/动效/门禁八节，
  含「只有 + 用绿」「44 命中区」「无居中对话框」「基线只许降账本」等长期判据）。
- **P6b（已交付）**：小记编辑器宿主与只读预览改「移动端自有外观」—— 新增 `src/mobile/quick-notes.css`
  （自桌面 `styles/app/quick-notes.css` **按移动端实际用到的选择器抽取** 22 条规则 / 102 条声明；
  桌面小记写作卡外壳与列表版式移动端不用，故不搬）。⇒ **移动端入口现在只引字体资源
  `styles/fonts/**`，桌面样式表 import = 0**。验收：check:mobilesnap **6 态 0 差异**（含 home-quicknotes，
  说明抽取逐元素忠实）· 设备走查 **22/22 ok**（含 quicknote-editor）。
  遗留桥接（1 条，写在文件头）：共享组件 `QuickNotePreview` 仍发桌面工具类 `.ln-ellipsis`，
  移动端给了一条 `body.lake-mobile` 作用域的等价规则；组件改发 `.mb-ellipsis` 后即可删。
- **P6c（已交付）**：`LakeEditor` 增加可选 `hostClassName`（**宿主外观由各端自己的样式定义**，不在共享层写平台分支），
  移动端统一传 `mb-kernel-host`（`src/mobile/kit.css` 给几何）。⇒ **P6 六组件变体化完成**：
  settingsPrimitives（移动端自建）/ AttachmentPreview / ImageLightbox / QuickNoteEditor / QuickNotePreview / LakeEditor 宿主类。
  门禁：tsc ✓ · vitest 231 文件 / 1816 用例 ✓ · `npm run check:mobileui` ✓
- **未做（下一轮继续）**：
  P4 设置页样板屏（顺带清 SettingsDrawer 的 109 处 + `.config-empty` 对比度 2.86 不达 AA）· P5 逐屏迁移（首页/工作区/
  文档外壳/dock）· P6 六组件变体化 · P7 收口（MOBILE-DESIGN.md 定稿 + 指标转门禁 + 清反向耦合 18 行）。
- **已知遗留**：`mobile-kit.css` 仍是「桌面 kit 之上的覆盖层」（SettingsDrawer 还在用 ln-*），P4/P5 收尾才删除。

### 261012 · 移动端批：dock「Aa」面板改语雀式分组卡 + 文本增强五项**（本批；移动端会话交付）**

- **用户 261012 定稿（本轮）**：① 语雀 App **没有字号入口** ⇒ 字号自己设计、**放面板最底部**（用得不多）；
  ② 选中态**先保留我们自己的**（后续移动端 UI 全量重构时再改语雀绿，且**只有「+」号用绿色**）；
  ③ 色板与链接**一律内联展开**（"都是语雀的方式"），**不弹层、不做二级面板**；④ 分组按功能拆开（一卡一组、一行最多两卡）。
- **落点**：`src/mobile/editor/EditorDock.tsx` —— `Aa` 面板重排为 **7 行分组卡**：
  段落样式 ｜ 行内标记 ｜（同卡）行内代码+链接 ｜ 列表 ｜ 块级 ｜ 对齐 ｜ 历史 ｜ **字色行**（一排 A：默认 + 灰/红/橙/绿/蓝 + 末位背景色入口）
  ｜ **内联色板** ｜ **字号 12 档（最底）**；`editor-dock.css` —— `.med-f-card` 卡 + `data-count` 让**卡宽 ∝ 条目数**（同行各条目等宽）、`.med-f-sizes` 6 列 × 2 行。
- **单一来源（全部复用，未另造一套）**：色板 `LakeColorBoard` · 色语义 `colorApplyCommand`+`colorMemory` · 字号档 `FONT_SIZE_OPTIONS` ·
  链接 UI `KLinkEditor` · 色阶 `core/colorPalette.ts` 新增 `QUICK_TEXT_COLORS`；
  **新增 `selectionToolbar/linkEditor.ts`**（`isValidLink` / `captureLinkTarget` / `restoreLinkTarget` / `applyTextLink`）——
  桌面 `SelectionToolbar` 已切过去、移动 dock 同调，链接的"捕获→还原→判定"**两端只剩一份**（9 例护栏，现 11 例）。
- **设备验收（AVD `lake_mobile`，设备级截图）**：五项**全部实测生效** —— 字号 22（`queryCommandValue` 回 22）·
  对齐 center（落 `text-align: center`）· 字色 `#F5222D` · 背景色与取消（走 clearBgColor）·
  **链接端到端**（内联编辑行 → 确定 → 写入 `<a href="https://example.org/mobile-link">` 且编辑器自动收起）；色板 7 组 71 色内联展开。
- **顺手修掉一条真缺陷**：内核色卡「更多颜色」行的宿主尺寸规则只写在桌面 `selectionToolbar.css`（移动端不加载）⇒
  移动端渲染成**巨箭头**（实测占满整行）；已按同一几何补在 `editor-dock.css` 的 `.med-f-board` 作用域（事后 16×16 实测通过）。
  ⚠️ 这等于**双端各一份宿主规则**，待移动端 UI 重构时并回 `LakeColorBoard` 自身样式。
- **关键实测（已回填 `docs/LAKEX-CONTRACT.md` §5.32）**：`lake-fontsize-N` **不是 px**（实测 ≈px×0.75）⇒ 高亮只能读 `queryCommandValue('fontsize', false)`；
  **内核只认真实用户选区**（纯 DOM Range 下五项全返 false）；**从我们自己的输入框交还选区后内核要等一拍**（同 tick `link` 返 false、链接不落地；
  等一拍成功）⇒ 移动端链接确认**失败重试一次**（160ms，只加在移动端）；该时序下 `queryCommandEnabled` **会误报 false** ⇒
  共享实现改为「按选区形态决定 `link`/`insertLink` 先后 + 用**命令返回值**判成败」，**两端执行器都必须回传内核返回值**（否则退化成静默 no-op）。
- **门禁**：tsc ✓ · vitest **229 文件 / 1808 用例** ✓ · ui-metrics ✓ · cssLayers/uiPrimitives ✓ · check:core 76-0 ✓ · 双端构建 + bundle 预算 ✓。
- **`check:mobilesnap`**：**6/6 态差异，与 261012 既有记录完全同型**（`home-library 元素 51 → 1755`，全在首页/设置态、不含 dock）⇒ 仍是既有基线/数据漂移，**非本批引入**；重烤待用户定。
- **未做 / 待用户定**：① **面板高度** —— 内容实测 **875px**，而面板视口只有键盘区 **279px** ⇒ 必须滚动才能到字号；
  语雀那套是面板比键盘区高（工具栏随之上移）。要不要让面板跟内容长会动 260914「面板占键盘区、工具栏停在面板上沿不动」的定稿口径 ⇒ **待用户定**；
  ② `unlink` 在"整篇全选"下返 false（边缘态）未逐项复核；③ H5/H6、缩进、行高、清除格式、格式刷仍未接（本轮范围外）。
- **数据留痕（不清）**：261010 覆盖夹具被本批探针改过（字号/对齐/字色/背景色/链接各若干处）；
  新建探针文档 `zz 链接探针 <5位>`——**后续探针一律用 `window.lakeNative.createNote(title, parentId)` 建干净文档**，别再污染既有夹具。

- **色板改成「照抄语雀」**（用户 261012 定稿，同一批）：语雀 App 没有字号入口、色板是 **2 行 × 7 格圆形色块**
  （浅色行首格=无填充 + 6 淡色；实色行 7 实色），实测几何 直径≈37dp / 列距≈52dp / 行距≈48dp。**颜色一律取内核色阶**（用户明确
  「找内核相近用就行，不要自己造色」）⇒ 新增 `core/colorPalette.ts` 的 `MOBILE_BOARD_LIGHT`/`MOBILE_BOARD_SOLID` 并改写
  `QUICK_TEXT_COLORS`（逐色 Lab ΔE 就近，**ΔE 0.9–14.9**，实测里 `#262626`/`#BFBFBF` 逐字节等于内核值 ⇒ 语雀用的就是同一套 lakex 色板）。
  移动端**不再用 `LakeColorBoard`**，改为 `EditorDock` 自画 2×7 板（应用语义仍复用 `colorApplyCommand`+`colorMemory`）。
  实测值/映射表/装置见 **`docs/LAKEX-CONTRACT.md` §5.33**。**副作用：面板内容高度 875px → 489px**（原来要滚很久的问题基本解决）。
  设备验收：实色红 `#FF4D4F`、浅色蓝 `#DEE8FC`、无填充清空（`queryCommandValue('color')` 回 null）三项均生效。
  ✅ **与 AGENTS §19 的关系已由用户 261012 裁定（这不是冲突，是我读窄了）**：§19 那一整套（`LakeColorBoard` 适配器 / `--lake-*` 令牌 /
  `kit.css` 的 `ln-*` 原语 / Overlay 浮层原语 / `!important` 上限 / `@layer` 层序）**是桌面端的规则，不自动约束移动端**；
  **移动端要有自己的适配与 UI 规则，两端只共享"必要逻辑"（策略/判据/命令字典/颜色数据/应用语义），不共享样式与组件**。
  已落成长期口径：`docs/MOBILE-TECH-STACK.md` §一 新增「UI 与样式」层 + 「第二句」规则 + 本条为首个实例（用户明示"如果有后续也要做"）。
  **AGENTS 的同步等另一个会话的样式统一批次结束后再做**（避免与其活跃编辑撞车）。
- **「Aa」面板按用户 261012 的第二轮排布指令重排完毕**（同一批，设备验收通过）：
  · **删**：`引用 / 分割线`（＋面板已有）、`撤销 / 重做`（移到「更多」面板）、`链接`（**链接融合进「＋」面板**，点它在 ＋ 面板内联展开链接编辑行）。
  · **行内代码保留并回到「行内标记」那一行**（用户 261012 追加：先删后恢复，"我不知道这是行内代码"）⇒ 该行 = 加粗/斜体/下划线/删除线/**行内代码** 5 项。
  · **两个代码图标必须可辨**（用户 261012 要求）：行内代码 = `Code`（`</>`），「＋」的**代码块卡片** = `SquareCode`（方框内 code）。
  · **并**：`列表` 与 `对齐` 合成一行（两张卡）；`行内标记`（加粗/斜体/下划线/删除线）独占一行。
  · **字号**：由 6 列 × 2 行（12 档）改成 **一行 8 档、掐头去尾** = `MOBILE_FONT_SIZES = FONT_SIZE_OPTIONS.slice(2, -2)` ⇒ **[14,15,16,19,22,24,29,32]**（去掉最小的 12/13 与最大的 40/48；取值仍全部来自内核档位，不新增字号）。
  · **「＋」面板 18 项**（新增链接）· **「更多」面板 8 项**（公式 + 5 项灰占位 + 撤销/重做）。
  · **副作用：面板内容高度 875px → 489px → 397px**（面板视口 279px，仅剩约 118px 需要滚动）。
  · 门禁：tsc ✓ · vitest **229 文件 / 1808 用例** ✓ · ui-metrics ✓ · 移动端构建 + 装机 + 设备级核对 ✓。
- **「＋」面板按用户 261012 定稿做分组**（同一批，设备验收通过）：
  **5 组 / 6 行**（行数与改造前的平铺网格相同，但分组本身带来卡内距与组间距 ⇒ **内容 281px → 322px，多出约 43px 滚动**）：
  `图片与文件`（图片·拍照·附件）· `文本块`（表格·引用·分割线·代码块·高亮块·状态，2 行）· `媒体｜布局`（音频·视频 ｜ 分栏·折叠块，**一行两卡**）· `小工具`（日期·表情·日历）· `关联`（链接·文档引用）。
  判据 = **按功能类型分组、组序与组内序按使用频率**；词汇借内核/语雀既有分类（布局 / 小工具），不新造概念。
  落点：`EditorDock.tsx` 的 `INSERT_GROUPS` / `INSERT_ROWS` + `editor-dock.css` 的 `.med-ins-groups/.med-ins-row/.med-ins-card`（复用「Aa」面板那套卡片语言）；「更多」面板仍是平铺网格。
  ⚠️ **一处标签改名**：＋面板里「分栏卡片」→「**分栏**」——双卡行每格只有 85px，4 个字必截断（3 个字刚好）；桌面端仍叫「分栏卡片」（两端 UI 各自拥有，见 `MOBILE-TECH-STACK` §一）。
- **移动端 UI/样式独立性 review 已交付（261012，用户要求"落成文档"）**：口径 = **移动端要有自己的适配与 UI 规则，仅共享必要逻辑，不共享样式与 UI**。
  落点 = `docs/MOBILE-TECH-STACK.md` **§九**（三层拆解：① 内核 UI 必须共享 / ② 我们的逻辑数据应当共享 / ③ 我们的 UI 与样式不得共享）+ **§六 登记为新债**。
  **审计实测（现状是 ③ 被大面积共享）**：移动端入口 import **10 个桌面样式表**（themes×4/tokens/compat/kit/components/dialog/quick-notes + 2 个 features CSS）；
  组件里用桌面原语 `ln-*` **53** 处、`config-*` **61** 处；移动端自有样式仅 **4 文件 1359 行**（桌面 53 文件 8770 行）；
  `mobile-kit.css` 自述是"桌面 kit 之上的移动端覆盖层"。要拆的桌面 UI 件：`settingsPrimitives` / `quickNotes` 编辑器与预览 / `FileKindIcon` / `treeDrag`。
  **§9.4 给了重构顺序**：先立"只许变小"的护栏测试 → 移动端自有令牌层 → 自有原语（触屏尺寸，改名 m-*）→ 逐屏迁移（设置页→首页→工作区→文档外壳→dock）→ 收尾只留内核样式 + 移动端自有样式。
- **面板高度 A/B 问题 = A（用户判断正确，本轮作废了 B 建议）**：从用户提供的语雀录屏**客观量得** —— 工具栏在「面板态 / 键盘态」
  两帧位置**完全一致**（778 vs 779），面板占据的就是「入口行 + 键盘」那一块；且滚动态帧显示**语雀面板内部本身就在滚动**。
  ⇒ 我们的「面板占键盘区 + 内部滚动」与语雀结构一致，**不用改**；真差异只是**内容体量**（色板），已由上面的色板改造收敛。

### 261012 · 桌面批：逐页走查复跑（D）+ 文字色阶达标标定 + 走查装置三修（含探针假阴性）**（本批；桌面会话交付）**

- **装置复跑（用户定的 D：页面详细测试 / 逐页走查）**：`.css-audit/d1` —— 5 轮 = light/dark/warm×1315 + light/dark×1000（22 屏/轮，97 屏），对 261009 B1 基线做**签名级 diff**：
  **escape / clipped / fixedOut 新增签名 0**、`UA 焦点环` 0、`整页横向溢出` 0；**但 `contrast: 0` 是假阴性**（装置 bug，见下条 ③，**基线那一列同样不可信**）。基线时期装置只有 19 屏，本次多 3 屏（note-info / history-panel / split-view）。
- **装置修三条**（`scripts/css-audit/walkthrough.mjs`）：
  ① `split-view` 屏**窄窗必现** `no split candidate`（1000 宽重跑 2/2、1315 三宽全过）—— 该屏没像其它屏那样先 `closeAll()`，被上一屏（history-panel）残留浮层吃掉树行点击。
     独立探针定点复现：1000 宽下两标签时 `.split-entry` 按钮**可用**、菜单 1 候选 ⇒ **产品侧分屏正常，纯装置缺陷**，已补 `closeAll()`。
  ② **对比度探针扩容**：旧口径只扫组件族（`ln-/config-/bt-/tree/tab/toolbar/statusbar 外层`）且只看**元素自身** opacity ⇒ 两类盲区
     （状态栏内层「无类名 span」看不见；docked 下父级 `opacity:0` 的 `.edge-hotzone-handle__label` 反而误报）。改为扫**全仓自有文字** + **有效透明度**（祖先连乘）+ 排除 1×1 sr-only / 内核 / 第三方（`.ne-*` / univer / drawnix）。
  ③ **探针「正则被字符串吃掉」⇒ 静默假阴性（本轮最值钱的发现）**：探针把 `/rgba?\(([^)]+)\)/` 写在**单引号字符串**里，
     `\(` 被字符串字面量吃掉 ⇒ 运行期正则退化成 `/rgba?(([^)]+))/` ⇒ `m[1]` 捕获到 `"(31, 35, 41"` ⇒ `parseFloat("(31")` = **NaN**
     ⇒ 所有 ratio = NaN、`NaN < 4.5` 恒 false ⇒ **该探针自 261009 B1 起从不报任何对比度问题**（判据：`fg.r` 在 JSON 里是 `null`）。
     ⇒ **261009 B1 基线的 `contrast: 0`、以及第一遍复跑的「全 0」都是假阴性**；修好后才有真实数据（下条清单 + `.css-audit/d3`）。
     `scripts/css-audit/mobile-walkthrough.mjs:18` 是**同一份拷贝、同一个 bug**（**未修**：属移动端验收装置，动它前先与移动端会话对齐）。
- **清单与修复：`--lake-text-3` 标定错**。用**转义正确**的临时探针测出三主题共 **132 处**命中（light 42 / dark 39 / warm 51），聚成 2 类：
  · **text-3 铺在灰底/淡色底的小字号**（34/31/37 处：状态栏元信息 ×21、`.ln-tabs__count`、`.config-section__title`、`.bt-table-count`/`.bt-stat-index`/`.search-snippet`/`.ln-row2__meta`/`.asset-browser__size`/`quick-notes-count`/`note-info-crumb`…）实测 **4.00–4.44 < AA 4.5**。
    根因：旧值 `#6f7784` 是**按白底**标定的（白底 4.52 ✓），铺到 `--lake-bg-hover/-block/-window`（`#f0f1f3/#f4f6f8/#f3f4f6`）就掉下来。
    **修法 = 改令牌档位、不改使用处**：浅/暖 → **ink-3 ramp 深一档 `#5f6874`**（最严表面 4.95）、深色 → **提一档 `#9398a1`**（最严 4.86）；
    **色板 canonical 不动**（`#6f7784` 仍是 ink-3 的色板值，`#5f6874` 本就是该 ramp 既有档位）。落点 `src/styles/themes/{light,warm,dark}.css`。
  · **text-4 的 3:1 档**（8/8/14 处：`.badge`/`.search-panel-help`/`.history-hint`/`.trash-panel-hint`/`.config-empty`/`.asset-browser__gcount`）**设计有意**（注释写明「元信息/占位 3:1」）
    ⇒ **判定不动**（要合规得整档提亮并与 text-3 塌成一层，收益不明确）。口径已入 `AGENTS.md §3#14`「文字色阶口径」与 `DESIGN.md`「Colors」。
  · **warm 主题把 `--lake-accent`（橙 `#d45500`）当小字号文字**（light/dark 的 accent 恰好够深/够亮，所以只有暖色暴露）：
    `.note-info-crumb` 4.12、`.note-info-history-hint` 4.12、`.quick-notes-count` 4.12、`.bt-table-item.active`（即 `.bt-table-name`）**3.75** ＜ AA。
    仓库**已有专供文字的 `--lake-accent-text`**（warm `#a8440a`、被 20+ 处选中态/链接使用；DESIGN.md 也写明"链接用更深的 accent"）⇒ **4 处改用该令牌**
    （`styles/dialog.css` ×2、`styles/app/quick-notes.css`、`features/bitable/bitableEditor.css`；浅/深同步换用，比值更高、无回归）。
    ⚠️ **未做**：全仓还有 ~10 处 `color: var(--lake-accent)`（多为图标色/悬浮态），本轮**未逐一复核**；要彻底 AA 化需单独立项逐条量。
  · **内核悬浮提示的 1.1 假阳性**：`split-view`(1000) 里两条 `cls=""`（"清除格式" / "⌘ \"）白字被判 1.1 —— 内核提示气泡的底不是**不透明祖先前 8 层**，
    effBg 落到 window 底色 ⇒ 探针口径（最近不透明祖先）的已知近似误差，**非产品缺陷**；已记入装置头注释。
- **门禁**：`tsc` ✓ · `vitest` **229 文件 / 1808 用例** ✓（含移动端会话新增的 `linkEditor.test.ts`）· `ui-metrics` ✓（颜色字面量 0、`!important` 9）· `vite build` ✓ ·
  装置修好后复跑：`.css-audit/d3`（5 轮走查 + 3 主题加宽扫描）+ `.css-audit/d4`（accent 修后三主题复验）。
  **实测**：加宽扫描 light **42→8**、dark **39→8**、warm **51→13**（残留全为 text-4 的有意 3:1 档）；
  5 轮走查 `UA 焦点环 0 / 整页横向溢出 0 / 屏错误 0`，且 **`split-view` 在 1315 与 1000 宽均 ok**（修前 1000 宽必 ERR）。
- **批②（本轮追加，用户点单「做 2」）：暖色主题主色文字 AA 化**。全仓 `color: var(--lake-accent)` 实为 **55 处（桌面 41 / 移动 14）**（上一轮"~10 处"是 grep 截断造成的低估）：
  实测判定「文字 vs 图形」后，**17 处文字站点**切到 **`--lake-accent-text`**（含 `.badge--accent` 实测 3.75 ✗、`.edge-hotzone-handle` 的「目录」标签、`.bt-option-chip`/`.bt-tool-btn.is-active`/`.bt-panel-add`/`.bt-date-foot button`/`.quick-notes-link`/`.tab-gone-banner button`…），
  **24 处保留 accent**（`.ln-iconbtn*`/`check`/`chevron`/`pin`/`tree-row-icon`/`lock`/`bt-add-round`/`bt-link-open`/`draft-recovery-restore` 等**纯图形**，只需 3:1，暖色最差 3.61 达标；另有 `.activity-button`/`.sync-tab-action` **0 引用死 CSS**）。
  **不改令牌**的理由：暖色 accent 压到 AA 需 `#b84a00`，与 `--lake-accent-ink #b34900` 重合，会毁掉三令牌语义 ⇒ 只改用法。**移动端 14 处未动**（属移动端写域）。
  复验（`.css-audit/d5`）：warm **13 → 8**、light/dark 保持 8 —— 三主题**收敛到同一组残留**（全部是 `--lake-text-4` 的有意 3:1 档），屏错误 0。口径已入 `AGENTS §3#14`「主色文字口径」。
- **批③（用户点单「清死 CSS」）+ 新审计工具入库**：新增 `scripts/css-audit/audit-dead-css.mjs`（保守口径写进文件头：词边界引用扫描 + **动态拼接保护** + 内核命名空间/设计词表排除；0.8s 扫完 47 个 CSS / 1257 个类名）。
  结果：**桌面候选 0（已清零）**；移动端候选 24（`mobile-*` / `.med-b` / `.lv1-3` 等，交移动端会话）。
  删除（**约 20 个类名 / 约 160 行**，每条都过「零引用 + 无动态拼接 + DOM 实测」三重确认）：`.activity-button` 整族 · `.activity-rail-spacer/fill` · `.sync-tab-action` + `.sync-state-dot` + `shell-sync-pulse/dot` 关键帧 ·
  `.tabbar-action` 气泡 · 5 个 legacy 遮罩（`modal/history-panel/trash-panel/search-panel/emoji-picker-backdrop`）· `.save-label` · `.mode-toggle` · `.form-grid` · `.sync-progress-bar` · `.connection-message` ·
  `.quick-notes-filter` · `.quick-note-composer-tools` · `.quick-note-tool` · `.snapshot-preview`；并从 5 处**分组选择器**里摘掉死成员（保留 live 的 `.settings-overlay`）。
  **保留**：`kit.css` 全文（设计词表 = COMPONENTS.md 14 件、P5 迁移目标）· 内核命名空间（`ne-*`/`lakex-*`…）· 动态拼接类（`` `bt-file-icon--${kind}` `` 等）· `.activity-rail`（JS corridor selector 仍引用）· `sync-indeterminate` 关键帧（`.sync-toast-bar` 在用）。
  **验收**：3 主题 22 屏走查与清死前 `.css-audit/d5` 对拍 **探针 0 差异**（escape/clipped/contrast/fixedOut/focus/pageX 逐项相同）；DOM 实测这 20 个类名在 library 屏 **全部 0 个**；`.css-audit/d6`（批1）/`d7`（最终）/`d8`（同构建重跑）。
  ⚠️ **像素级 A/B 在本装置上不能用作此类判定**：实例状态跨轮累积（同一 CSS 的两次运行也会整屏差 239k 像素、hover 动作按钮时有时无）⇒ 正确判据 = **探针（DOM/几何/样式）对拍 + 零引用证明**。
  口径已入 `AGENTS §3#14`「死 CSS 判定口径」；工具登记在 `scripts/css-audit/README.md`。
- **协同（重要）**：本批 `dist/` 重建于 **10:26:38**，**包含移动端会话未提交的「抽共享链接编辑层」改动**（`src/features/editor/selectionToolbar/{linkEditor.ts,linkEditor.test.ts,SelectionToolbar.tsx}` + `src/core/colorPalette.ts`，**非本批**）。
  `dist/` 是**共享产物** ⇒ 谁构建谁负责，别在别人验收中途重建。
- **留痕**：合成夹具隔离实例 `/tmp/lake-walk-d1`（非真实数据，跑完按 CDP 端口精确 kill）+ `.css-audit/{d1,d1b,d1c,d2}`；`d1c` = 改前加宽扫描、`d2` = 改后验证。
### 261012 · 移动端 dock 扩展：`+` 面板收 6 项（改 3 列）+「更多」面板（公式可用 / 画图 5 项置灰）**（已交付，用户 261012 定稿）**

- **用户定稿**：除 5 项画图外，其余插入项全部进 `+` 面板并要求**每行 3 个**；`+` 面板共 **17 项** = 原 11 项 + **分栏卡片 / 折叠块 / 日历 / 日期 / 表情 / 文档引用**（**公式不在 `+`** —— 用户定「公式与图属于同一类」）。
- **主工具条新增「更多」**（位置 = 待办与键盘之间，用户指定）：面板 = **公式（可用）+ 画板 / 流程图 / UML 图 / 思维导图 / 文本绘图（disabled 占位）**，3 列 2 行；置灰走 `--lake-disabled-opacity`，`title` 提示「移动端暂未支持」。
- **落点**：`src/mobile/editor/EditorDock.tsx`（`PanelMode` 加 `"more"`；`DockItem` 统一 `+`/更多两个网格；`insertItems` +6；`moreItems` 5 项 `disabled`）· `src/mobile/editor/editor-dock.css`（`.med-ins-grid` 2→**3 列**、条目收紧、label 13px + 省略、`:disabled` 态）· `src/features/quickNotes/quickNoteToolbarWidgets.ts`（表情选择器改名并导出 `openEmojiPicker`，dock 复用**同一套**，AGENTS §3#14）· `src/mobile/MobileApp.tsx`（注册移动端 `noteRefHost`，让「文档引用」能列文档）。
- **内核调用口径**（沿用 261010(五) 抓取，未变）：分栏 `execCommand("columns", 2)` · 折叠 `execCommand("collapse")` · 日历 `insertCard("calendar", {currentDate: YYYYMMDD, colorIndex: 0, schedules: {}, __spacing: "both"}, true)` · 日期 `insertCard("dateCard", {date: Date.now()}, false)` · 表情 `insertAtSelection("text/lake", "<span>😀</span>")`（`unicodeEmoji` 是死卡，见 §5.29）· 文档引用 `insertCard("customBlock", {$name: "lake-note-ref", …}, true)` · 公式 `insertCard("math", null, true)`。
- **设备实测（AVD `lake_mobile`，设备级截图）**：主条 7 钮 = 插入 / 字体 / 加粗 / 列表 / 待办 / **更多** / 展开键盘；`+` 面板 **17 项**、网格 `117.39px ×3`；「更多」面板 公式 `disabled=false` + 另 5 项 `true`。
- **门禁**：tsc ✓ · vitest **228 文件 / 1797 用例** ✓ · ui-metrics（桌面字号字面量 0）✓ · check:core 76-0 ✓ · cssLayers/uiPrimitives ✓ · 移动端构建 + 装机 ✓。**`check:mobilesnap` 未过**：6/6 态差异但全在首页/设置态（如 `home-library 元素 51→1755`，**不含 dock**）⇒ 判定为**基线/数据漂移**（基线疑似空库时采集），与本批无关，重烤待用户定。
- **顺手修环境**：`npx patch-package` —— 此前 `@univerjs/ui` 补丁**未落到 node_modules**（`univerContract` 护栏因此一直红），补上后护栏绿。
- **未做（下一会话）**：① **文本增强二级面板**（字号 / 字色 / 背景色 / 对齐 / 链接，口径见 261010(五)）；② **5 项画图解禁**（根因与修法见 §3#18）；③ 6 个新插入动作未在设备上逐项点过（命令来自内核面板抓取，结构与接线已验）。
- **数据留痕（未清）**：探针「zz parent 测试」（父正常）与「zz 画板触摸实测」（**parent_id 为 null、打不开**，同另两篇「无标题文档」）—— 历史脏数据；当前 `createNote` 路径实测**正常**（新建即写父笔记本）。

### 261010(五) · 任务书：移动端 dock 12 项 + 文本增强面板（6 项已交付见上节；**12 项权威内核调用仍以本节为准**）

**任务（用户 261010 定）**
1. 把覆盖检测查出的 **12 个插入项**接进移动端 dock：分栏卡片、折叠块、画板、流程图、UML 图、思维导图、公式、文本绘图、日历、日期、表情、文档引用。
2. **文本增强二级面板**：字号、字色、背景色、对齐、链接。

**截至本节：`src/**` 零改动**（唯一提交 `53a0e5a` = 文档 + `scripts/mobile-lake-coverage.mjs`；用户 261010 特意确认过"没改代码吧"）。

**已确认口径（别重开）**
- 移动端输入面**只有** dock；`/` 不可用（`MOBILE-TECH-STACK` §八 · `LAKEX-CONTRACT` §5.30）。
- 入口形态提议（**待用户确认，换机后先问**）：dock **新增一个按钮**（如「更多」）承载这 12 项，**不**把 `+` 面板从 11 项撑到 23 项。
- **链接**：§5.10 七 记着 `link/insertLink/linkText` 在 `execCommand` 上多参数形态实测**均返回 false、正文无变化**；
  桌面走的是 `SelectionToolbar.tsx:391` 的**内核链接编辑层** `openLinkEditor` ⇒ 计划**抽成共享函数**两端复用（单一来源），
  **不要**自己写第二套链接 UI，也**不要**直接 execCommand 静默 no-op。
- **颜色**：必须复用 `selectionToolbar/LakeColorBoard.tsx`（AGENTS §19：内核色卡走该适配器，样式/渐变色入口不得改）。
- **字号**：内核 `fontsize` + `editorCommands.ts` 的 `FONT_SIZE_OPTIONS`（12 档）。**对齐**：内核 `alignment`（left/center/right）。
- **表情**：`insertCard("unicodeEmoji")` 是**死占位卡**（§5.29）⇒ 只能插文本 `insertAtSelection('text/lake','<span>😀</span>')`；
  若想复用现成选择器先看 `features/quickNotes/quickNoteToolbarWidgets.ts`（守「同一交互语义只有一套」红线）。

**已抓到的权威内核调用（本次实测，省下次摸索）**
- **自定义卡统一形态**（画板族，已实测画板/流程图）：
  `editor.execCommand("insertCard", "customBlock", { $name:"drawing-board", $htmlStr:"", version:2, engine:"drawnix", preset:"drawing", plaitValue:[], plaitViewport:{x:0,y:0,zoom:1}, cardHeight:560 }, true)`
  —— **不是** `insertCard("drawing-board")`（那样报 `schema.ts:396` 断言失败）；随后内核自己 `setCardValue(cardId, {…+previewImage})` 补预览。
- **简单卡（已实测可用）**：`insertCard("math")` · `insertCard("calendar")` · `insertCard("dateCard", {date: Date.now()})` · `insertCard("unicodeEmoji")`（见上面表情口径）。
- **命令式（面板走 execCommand，不是 insertCard）**：折叠块 `collapse` · 分栏卡片 `columns`（参数 = 列数，面板默认 2；子菜单有 2/3/4）· 表情 `unicodeEmoji`。
- **卡式 `insertCard(name, value, flag)`（flag 末位实测不统一，照抄）**：
  - `insertCard("math", null, true)`
  - `insertCard("calendar", { currentDate: 20261001, colorIndex: 0, schedules: {}, __spacing: "both" }, true)`
  - `insertCard("dateCard", {}, false)` ← ⚠️ 末位是 **false**（与 block 卡相反）
  - 画板族统一 `insertCard("customBlock", { $name, $htmlStr: "", … }, true)`，`$name` 与其余字段：
    - 画板 `drawing-board` / 流程图 `flowchart-board` / UML `uml-board` / 思维导图 `drawing-mindmap-board`（`preset` 依次 `drawing`/`flowchart`/`uml`/`mindmap`）
      ⇒ `{ $name, $htmlStr:"", version:2, engine:"drawnix", preset, plaitValue:[], plaitViewport:{x:0,y:0,zoom:1}, cardHeight:560 }`
    - 文本绘图 `{ $name:"text-to-diagram", $htmlStr:"", code:"flowchart TD\n    A[Start] --> B{Decision}…", type:"mermaid", cardHeight:500, showEditor:true, showPreview:true }`
    - 文档引用 `{ $name:"lake-note-ref", $htmlStr:"", noteId:"", title:"" }`（noteId 空值即占位，用户在卡片内选目标文档）
  - 插入后内核会自己再 `setCardValue(cardId, {…+previewImage})` 补预览（画板族）——**我们不需要重复调**。
- **抓取方式**：`node scripts/mobile-lake-coverage.mjs --capture-panel "画板,思维导图,折叠块,分栏卡片"`
  （桌面隔离实例；脚本在页面里 hook `editor/kernel/renderer.execCommand`，再 DOM 派发点击内核面板项，打印真实调用。）
- **抓取方法（已入库，换机可直接跑）**：`node scripts/mobile-lake-coverage.mjs --capture-panel "画板,思维导图,折叠块,分栏卡片"`
  （桌面隔离实例 + CDP；脚本在页面里 hook `editor/kernel/renderer.execCommand`，再 DOM 派发点击内核面板项，打印真实调用）。

**装置现状（换机后需重建；数据一律不清理 —— 用户明确"不用清理数据"）**
- 桌面隔离实例：`env -u ELECTRON_RUN_AS_NODE LAKE_RENDERER=scheme LAKE_USER_DATA="$TMPDIR/lake-detect" LAKE_ASSET_PORT=19891 LAKE_DEV_S3_* ./node_modules/.bin/electron --disable-gpu --no-sandbox --remote-debugging-port=9231 .`
- 移动端：AVD `lake_mobile` + `bash scripts/emu-cdp.sh 9335`（App 已配 `lake-notes-dev1` 前缀）。
- 夹具留痕：隔离实例 17 篇 + S3 `lake-notes-dev1` 对应对象 + 模拟器 App 内同名文档；「Lake 单卡 · 折叠块」被补过 `-body` 段。

**改完必须过的门禁**：`npx tsc --noEmit` · `npx vitest run` · `npm run check:mobilesnap`（6 态 0 差异）·
`node scripts/ui-metrics.mjs` · `cssLayers` 基线只许变小 · 设备级截图验收（`adb exec-out screencap -p`，按 §7.22）
+ `scripts/css-audit/mobile-walkthrough.mjs`。样式一律走 `--lake-*` 令牌与既有 `ln-*` 原语，**禁内联样式/禁新增 `!important`**。
### 261010(四) · 移动端 Lake 能力覆盖检测（桌面输入 vs 移动展示/编辑）+ 装置入库

- **用户命题**：桌面端 Lake 能输入的东西，移动端能不能**展示**、能不能**编辑**；用真实数据（S3 `lake-notes-dev1` + `~/Documents` 真实附件），不要造玩具数据。
- **口径（用户 261010 定）**：**`/` 斜杠面板在移动端不可触发（小记 + 文档都不能）**；**所有工具栏都走底部 dock 那条路**。
- **方法**：隔离桌面实例（scheme + dev1 前缀 + CDP 9231）造 **16 篇夹具**（覆盖 30+ 格式，图片/PDF/音频/视频用真实文件）→
  `syncNow` 上传 → **S3 真实链路** → 模拟器 App 拉取（应用 17 篇 / 4.55MB）→ 设备级逐项探针 + `adb screencap` 截图。
- **结论**：**展示无缺口**（H1–H6/粗斜下删/行内代码/字色/背景色/字号/对齐/上标下标/链接/三种列表/表格/代码块/分隔线/状态/
  公式/日历/日期/表情/折叠块/分栏/图片/附件/音频/视频/画板/流程图/UML/思维导图/文本绘图/文档引用 —— 全渲染正常）；
  **输入缺口很大**：文本格式缺 10 项（H5/H6、字号、字色、背景色、对齐、缩进、行高、清除格式、格式刷、链接），
  插入项缺 12 项（分栏/折叠块/画板/流程图/UML/思维导图/公式/文本绘图/日历/日期/表情/文档引用），
  块级操作（复制/剪切/删除/转化/拖拽/多选）**没有任何入口**，usheet/bitable/board 三类文档移动端**只读**。
- **装置入库**：`scripts/mobile-lake-coverage.mjs`（`--matrix` 静态矩阵 / `--dock` 实测输入面 / `--doc <标题>` 渲染探针），
  脚本头记了 6 条自动化坑（树行必须 DOM 派发事件、`el.click()` 不导航、`Runtime.evaluate` 不能传函数、
  keep-alive 8 标签页会串判据、移动端截图只能 `adb screencap`、开文档会重置树展开态）。
- **规格/契约**：`docs/MOBILE-TECH-STACK.md` §八（覆盖矩阵 + 缺口表）· `docs/LAKEX-CONTRACT.md` §5.30（五条实测结论）
  · `AGENTS.md` §4 新增「移动端输入面 = dock」长期机制。
- **待确认（1 项，别当结论）**：某篇以 `<h1>` 开头、缺 `-body` 段落的文档出现过「标题栏是该篇、正文空折叠块」；
  补 `-body` 段后正常、桌面一直正常、设备 DB 内容完好（无损坏）⇒ 自动化未稳定隔离，需人工复核一次。
- **数据留痕（未清理，用户 261010 明确不清）**：隔离实例 `$TMPDIR/lake-detect` 的 17 篇夹具 + S3 `lake-notes-dev1` 对应对象 +
  模拟器 App 内同名文档；「Lake 单卡 · 折叠块」被补了一个 `-body` 段。
- **下一步（用户 261010 定）**：① 把缺的 12 个插入项接进 dock；② 文本增强二级面板（字号/字色/背景色/对齐/链接）。

### 261010(三) · 小记写作卡工具条 = 用户指定九项 + 移动端不展开（**已提交 `daaa7fd` + 收尾整理，随本批推 origin/master**）

- **用户定稿**：工具条就是这九个图标 —— **日期 · 表情 · 图片 · 附件 · 待办 · 无序 · 有序 · 引用 · 分隔线**，
  **移动端一行放下、不要「展开」**。
- **日期/表情/附件没有内置工具项 id**（实测塞进去被静默丢弃）⇒ 走内核官方**自定义工具项**通道：items 里放**类**，
  内核 `new Cls(editor, id)` + `init()` 后按 `Cls.Type` 选控件。内核**没导出** `ToolbarUIDescriptor`
  （`dist/index.d.ts` 只有类型）⇒ 按 `Button` 控件实际调用面自实现最小基类（`quickNoteToolbarWidgets.ts`）。
- **三个实测坑**：① 漏 `enable()`/`disable()` ⇒ 工具条建好那刻整块**白屏**（`e.enable is not a function`）；
  ② `unicodeEmoji` 卡的内核 UI **写死只画占位图标、从不渲染 value**（插入面板的「表情」项同样如此）⇒ 插卡是死框，
  表情改为 `insertAtSelection('text/lake','<span>😀</span>')` 插**文本**（原生 `document.execCommand('insertText')`
  在本内核下不生效，实测）；③ 条目自带 `margin-left:12px` ⇒ 每项 44px、9 项 396px > 内容宽 363px ⇒ 最后两项被收进「···」，
  移动端收到 6px 即一行放得下（注意**桌面写作卡根类 `quick-note-composer`、移动端 `mobile-qn-composer`**，作用域写错静默不生效）。
- **移动端不展开**：`fullscreen.enable = isDesktop()`（桌面保留展开态完整工具条，插入面板入口在那里）。
- **设备验收（AVD `lake_mobile`，设备级截图）**：一行 **9 个图标、无「···」、无展开按钮**；
  日期 → 正文出现日期卡；附件 → 系统文件选择器（`com.android.documentsui/.picker.PickActivity`）；
  表情 → 自带 40 格选择器 → 选中后正文出现 😀（文本，非死卡）。
- **收尾整理（261010）**：表情面板的监听生命周期改**显式 attach/detach**（原实现靠 `MutationObserver` 观察 body 猜
  "什么时候该拆"，绕且脆）＋支持 Esc 关闭；两个内部 helper 收回非导出；4 处过期注释改正（解析器头部还写着"白名单"、
  composer 头部还列着旧 7 项、编辑器"展开"注释未区分端）。
- **能力边界（实测口径，写进 LAKEX-CONTRACT §5.29 与 MOBILE-TECH-STACK §七）**：紧凑条不含「＋」、移动端不展开，
  而 `/` 斜杠在本构建**不可靠**（§5.23 早先实测；本轮用 `keydown` + `Input.insertText` 两种注入复测**都没唤起面板**）
  ⇒ **移动端小记目前没有可靠的插入面板入口**：表格/代码块/公式/高亮块/分栏/折叠块/画板/思维导图/日历/文档引用插不了
  （**显示**不受影响）；桌面写作卡可展开进面板。用户已知并接受。
- **门禁**：tsc ✓ · vitest **228 文件 / 1797 用例** ✓ · check:core ✓ · ui-metrics 0 ✓ · check:bundle ✓ · 双端构建 ✓ · `git diff --check` ✓。

### 261010(二) · 小记预览改「快路径 + 内核只读兜底」+「+」面板全量（**已提交 `815ec91`，已合 master；推送待用户确认**）

- **先更正一条错误结论**：上一轮把「移动端小记没有日期/表情」判成「内核没这个能力」—— **错**。内核插入面板的
  「小工具」组里本就有 `calendar(/rl)` / `dateCard(/rq)` / `unicodeEmoji(/bq)`（vendor `configs/slash.ts:103-113` +
  `lakex.js` 三处 `registerCardSelect`）；是**我们自己的** `quickNoteInsertFilter` 白名单把它们裁掉了。
  用户口径：**同一个 lake 内核，什么格式都可能出现，都要能显示**；桌面端的只读渲染本来也是这条内核路径
  （`createLakeDocument(…, "viewer")` —— 锁定文档 / 回收站预览都用它）。
- **架构收口**：预览 = **快路径（自研解析器，纯文字小记零内核实例）+ 内核只读兜底**（解析器认不出的块 ⇒ 整条卡片交给
  内核 viewer）。判据 `hasUnsupportedNodes`（解析器自己的 `unsupported` 节点，**不另立清单**）。**整条白名单链删除**
  （`quickNoteInsertFilter.ts` + 钩子接线 + 测试）。⇒ 格式覆盖度由内核保证，「没有显示不出来的格式」。
- **顺手修掉两个真实缺陷**（拆白名单后暴露）：① 「+」面板全量 24 项 ≈1294px > 手机视口 842px，内核把它翻到 caret 上方
  （实测 `top=-558`）⇒ 顶部条目点不到；修法 = 夹高度 + `top:120px !important` 改锚点（`body.lake-mobile` 作用域，
  实测复位到 `y=120 / 642px` 且内部可滚）。② 内核浮层 portal 到 `body`（`.ne-overlay-container`）⇒ 移动端加 body 标记。
- **设备验收（AVD `lake_mobile`，设备级截图）**：面板全量可见可点（基础 / 布局和样式 / 程序员 / 小工具：表格 · 高亮块 · 分栏 · 折叠块 · 日历 · 日期 · 表情）；
  面板插入「日期 + 表情」→ 保存 → 时间线卡片**由内核渲染**（`ne-card[data-name=dateCard|unicodeEmoji]`，显示「📅 10月10日」）；
  同屏另 2 条纯文字小记仍走快路径（`.quick-note-kernel-preview` 计数 = 1，零内核实例）；残留占位条 **0**。
- **门禁**：tsc ✓ · vitest **228 文件 / 1792 用例** ✓ · check:core 76-0 ✓ · ui-metrics 0 ✓ · check:bundle ✓ · 双端构建 ✓ · `git diff --check` ✓
  （新增护栏 `quickNoteKernelFallback.test.ts` 5 例；`quickNoteToolbar.test.ts` 的「预览白名单」规则换成「兜底渲染」规则）。
- 规格与取证：`docs/MOBILE-TECH-STACK.md` §七（快路径 + 兜底两条路）· `docs/LAKEX-CONTRACT.md` §5.28（面板条目/别名/浮层定位实测）。
- 探针小记（按 AGENTS §4 不自动删）：`今天 日期`（含真实 dateCard + unicodeEmoji，可复看兜底渲染；插入面板「最近使用」会留痕）。

### 261010 · 移动端 F16 修复 + 互斥域上收 + 单一来源收口（**已提交 `10c84e9`**）

- **背景裁决**：一个「移动端架构重做」会话把 F16 冻住等架构方回话。核查后**不存在重做** —— 本仓库无新分支 / 无 worktree /
  无未提交改动，`1861a6b` 只加了 2 个文档文件。按 8 条业界判据体检（core 零依赖 / 平台差异集中 / 无自研跨端运行时 /
  共享粒度到组件级 = 4 条通过；收益有护栏无代价账 = 1 条半；大对象过桥 / 升级内核改两处 / 边界泄漏 = 3 条定点缺陷）
  ⇒ **判定不立项"重设计"**，按定点修复推进。承载方式属 Capacitor-WebView 范式（与 Obsidian/Logseq 同类）。
- **F16 已修**。根因比"锁粒度"更准：**本地写被并进了维护队列** —— 桌面 `enqueueMaintenance` 只有 **3** 个调用点（整轮同步/备份/GC 对账），
  移动端却有 **31** 个（其中 25+ 是纯本地写）。做法：
  · 判据单一来源 `src/core/maintenancePolicy.ts`（71 个桥操作全量登记：write **30** / maintenance **3** / none **38**）；
  · 两条队列 `src/mobile/maintenanceLocks.ts`（写域 / 维护域），`bridge.ts` 改 `runWrite(op,…)` / `runMaintenance(op,…)`（**带类别校验**，写错当场抛）；
  · 同步侧「DB 片段短锁」`syncDbPort` 的 `withWriteLock`（一次端口调用进出各一次，**网络往返不持写域**）；
  · `restoreTreeItem` 恢复不再等网络（原本被全局队列串在同步后面）。
- **I2 守卫补齐**（拆域的前置条件，否则丢编辑）：引擎优先用 `markSyncedIfUnchanged`（小记新增实现，移动端；对齐 Lake 侧 V5 §5.2）；
  下载侧 `flushNoteBatch` 批窗口守卫（批窗口跨网络取内容 ⇒ 窗口内被本机改过的笔记**推迟远端应用**，留给下一轮走正常冲突流程）。
- **单一来源收口**：移动 CSP 唯一来源 = `vite.mobile.config.ts`（`mobile.html` 只留 `%MOBILE_CSP%`，此前两份不一致）；
  `window.lakeNative` 改为**从实现派生**（`lakeNativeContract.ts`：49 = 47 bridge + 2 附带；此前手写 49 个包装、无护栏）；
  `ports.ts` 6 处悬空《移动端方案 §x》引用清除；`bridge.ts` 头注释 "POC / manifest v4" 改成事实（Manifest **V1**）；`POCNote*` → `LocalNote*`。
- **新增 7 道护栏**：`core/maintenancePolicy.test.ts` · `mobile/maintenancePolicyCoverage.test.ts`（含 **I3 同域嵌套静态卡死**）·
  `mobile/maintenanceLocks.test.ts`（**F16 机制回归，CI 可跑不必上模拟器**）· `mobile/syncDbPortBatchGuard.test.ts` ·
  `mobile/mobileCspSingleSource.test.ts` · `mobile/lakeNativeContract.test.ts` · `electron/maintenanceQueueScope.test.ts`（桌面反向护栏）。
- **规格与契约**：`docs/MOBILE-TECH-STACK.md` 重写为正式架构规格（三层边界 + **每层用哪种复用方式** + 互斥域 + 能力矩阵 121/71/49 + 运行时硬约束 + 未结项）；
  `LAKEX-CONTRACT.md` 新增 **§5.27**（`envAdapter` 官方 7 个口全量 + 我方覆盖率 **1/7**；桌面外链其实靠**壳层** `setWindowOpenHandler`→`shell.openExternal` 接管；`longPressCard` 取证待办）。
- **门禁**：tsc ✓ · vitest **227 文件 / 1778 用例** ✓ · check:core 76-0 ✓ · ui-metrics ✓ · check:bundle ✓ · 双端构建 ✓ · `git diff --check` ✓。
- **F16 弱网验收：已过（261010）**。口径照 §3#12 同一入口/同一量法（`window.lakeNative.syncNow()` → 等 250ms → 本地写 → 页内 `performance.now()`），
  模拟器 `adb emu network delay|speed gprs`（7.0 KB/s ↓ / 3.5 KB/s ↑ / 35–200ms）：
  **整轮同步 59.3s，同步中的本地写等待 32ms**（基线写 84ms）⇒ **写等待/同步时长 = 0.001**（旧实现 ≈1.00：152.0s / 152.3s）。
  同步正常收尾「拉取 68 条，应用 0，上传 2，发布 是；小记已同步」，文档 68 → 70。装置入库：`scripts/mobile-f16-acceptance.mjs`。
  ⚠️ 该次运行新建了 2 篇探针文档（按 AGENTS §4 不自动删）：`F16 验收 A` = `97756d6d-3ca0-42ea-8974-35128d0cd61b`、`F16 验收 B` = `c766a07f-131e-4272-920c-83b531145478`（父 `notebook-personal`）。
- **内核预热/复用：已测（261010，AVD `lake_mobile`）**：冷启动 Activity **490ms**（`am start -W -S` TotalTime）；**首次内核挂载 ≈1847ms**；
  keep-alive 复用下的**热切换 ≈73ms**（**25×**）⇒ 复用已在生效，剩下要优化的是"进程内第一次挂载"（1847ms 是端到端，纯挂载成本待细分）。装置：`scripts/mobile-kernel-perf.mjs [--cold]`。
- **261010 追加（未完成项清零）**：
  · **内核资源本地化收成单一来源** `scripts/lakexLocalize.ts`（此前桌面/移动各一份复制品）⇒ 升级内核只改一处；
    顺带让**移动端也拿到** CSS `@import` 内联兜底（此前只有桌面有）。护栏 `electron/lakexLocalizeSingleSource.test.ts`；
    两端口径核对：产物 `gw.alipayobjects.com` 残留 0、CSP 注入正常、index/preview 正常生成。
  · **桌面补 I2 守卫**（下载方向）：`syncAdapters.ts` 的 `beginNoteBatch` 快照 + `applyRemoteNote`「未变才应用」⇒
    两端语义一致（此前桌面该窗口是敞开的：并发编辑会被远端静默覆盖）。护栏 `electron/syncApplyGuard.test.ts`（2 例，含不误伤）。
  · **Move SecretStore 到 Android Keystore**：新原生插件 `SecureStorePlugin.kt`（AndroidKeyStore AES-256-GCM + 私有 SharedPreferences）、
    JS `keystoreSecretStore.ts` + 迁移层（native 优先、读到旧值迁一次、**native 有值时也一次性清掉残留旧副本**）；
    降级件降为 Web/vitest 后端。**设备验证（AVD `lake_mobile`）**：冷启动 692ms → `skLen 40` / `testS3Connection OK（对象数 ≥ 1）` /
    `localStorageSecretLen = null`（WebView 存储已无 secret）/ `keystore-ok`；`shared_prefs/lake-notes-secure.xml` 存的是 `base64(iv):base64(ct)`。
  · **`envAdapter` 取证收口（261010，结论＝不改行为）**：
    **外链**：端到端实测**正常**（点后前台从 `com.lakenotes.mobile` 切到 `com.android.chrome`）⇒ 壳层已接管，`openLink` 不必接。
    ⚠️ **判据必须看前台窗口**（`dumpsys window | grep mCurrentFocus`）—— Intent 场景下 `location.href`/CDP target 都不变，
    只看它们会误判「没反应」（本轮误判过一次，已在 CONTRACT §5.27 留修订记录）。
    **`longPressCard`**：官方语义是「使用方**自实现 UI** 并回传参数」，不是内核自带长按 UI ⇒ 我方自写手势等价，**保留**。
  · **契约面收窄（261010，用户定方向：不做纯文件拆分）**：`bridge` 71→**70**（删零引用死方法 `uploadObject`）；
    按「谁在用」把 70 个方法分成 **T1 移动端 UI 49 / T2 共享契约 `native.*` 9 / T3 自动化契约 5 / 待定 7**；
    护栏 `src/mobile/contractSurface.test.ts`：**新方法不写清用途直接红**、`PENDING_OWNER` 只许变小、`lakeNative` 必须是 `bridge` 子集。
    分类与判据写进 `docs/MOBILE-TECH-STACK.md` §三（含"静态扫描会漏别名调用、删除前须人工复核"的教训）。
  · **内核样式护栏（261010）**：`src/mobile/kernelStyleBootstrap.test.ts`（懒入口挂内核必须自带内核 CSS）——
    立护栏时发现并修掉真实遗留缺陷 **`TrashPreviewPage`（设置→回收站→预览）挂了 `LakeEditor` 却没引内核样式**（与小记同款 bug）；AGENTS §7.22/§7.23 固化。
  · **外链结论反转（261010）**：端到端实测移动端文档内链接**正常**（点后前台切到 Chrome）⇒ 上一轮"点了没反应"是**观测缺陷**
    （Intent 场景 `location.href`/CDP target 都不变，必须看 `dumpsys window` 前台窗口）；`envAdapter.openLink` **不必接**。
    `longPressCard` 取证：官方语义是"使用方自实现 UI"⇒ 我方自写手势等价，**保留**。两者均已入 `LAKEX-CONTRACT §5.27`（含修订记录）。
  · **冷开分解（261010，三条路径）**：`scripts/mobile-coldopen-breakdown.mjs`（每次 `Page.reload` 重置 keep-alive 后再量）——
    **深链小记（无内核）88/65/82ms** · 首页小记写作卡（内核）656/412/290ms · 打开文档（内核）427/366/347ms；**内核 chunk 加载/求值仅 27ms**。
    ⇒ **结论：不立项预热/池化**（单 WebView 无池可建；不挂内核的小记已秒开；内核路径瓶颈在实例化+首帧，复开已由 keep-alive 覆盖 73ms）。
  · **移动 CSP 已收紧（261010）**：`script-src` 去掉 `unsafe-inline` / `unsafe-eval`，内联 KITCHEN_URL 改 **sha256 hash**（与桌面 prod 同值）；
    设备验证**零 CSP 违规、零运行时错误**：reload + 首页 + 知识库/书架 + 笔记本 + 6 篇文档 + 搜索 + **画板**（canvas 300×150）+ **表格 Univer**（canvas 1081×1967）。
    护栏 `mobileCspSingleSource.test.ts` 重算 hash 比对（防「改了内联脚本忘改 hash ⇒ 白屏」）。
  · **7 个「待定归属」已定去向（261010）**：生产走 `gcRepository` 直调 / `dbPort`，这几个只是再暴露一份；单测借它做**播种+观测**验证真实行为（GC 分批删除 / 维护队列写 / 墓碑发布 / folder 防复活）⇒ **保留为 T4 测试观测/播种口**（`contractSurface.test.ts` 的 `TEST_SEAM`，只许变小）。
  · **mermaid/流程图路径已定性（261010）**：全产物含 `Function(` 的 5 个 chunk 经静态核对**全是 lodash/webpack 的「全局对象探测兜底」**
    （`freeGlobal || self || Function("return this")()` / `if (typeof globalThis=="object") return globalThis`）——Chromium WebView 里 `globalThis`/`self` 恒存在 ⇒ **永不执行**，webpack 那处还有 try/catch。
    加上设备实测（文档/画板/表格/搜索全路径零 CSP 违规；画板 canvas 300×150、表格 canvas 1081×1967 真渲染）⇒ **`unsafe-eval` 确实可去，无遗留风险**。
    ⚠️ **CDP `Runtime.evaluate` 绕过页面 CSP** ⇒ 不能用它测 CSP 行为（本轮踩过：`Function("return 1")()` 在 CDP 里照样成功）；CSP 验证必须走页面自身加载路径。

### 261009 B1 · 桌面逐页走查（页面详细测试）+ 3 条修复 + 走查装置入库

- **范围**：用户定的焦点①。隔离夹具（`make-fixture`，**不碰真实数据**）+ 新装置 `scripts/css-audit/walkthrough.mjs`，
  跑 **5 轮 × 19 屏 = 95 个屏态**（浅/深/暖 × 1315、浅/深 × 1000），每屏「截图 + 五类实测探针」（越界/截断/对比度/焦点环/整页横向溢出）。
- **修掉 3 条**（都实测复现、都改在单一来源、都留截图）：
  1. **树行焦点环是浏览器默认环**：树行是 `div[tabindex="0"]`，不落在 tokens.css 的焦点规范里 ⇒ 键盘聚焦时画的是 `outline: auto`（颜色随系统高亮色，实测 `rgb(153,200,255)/1px/auto`）→ 就地补令牌环 + 负 offset（`styles/app/shell.css`）。修复后 `2px solid`、颜色取当前主题 `--lake-accent`。
  2. **窄窗（1000px）小记写作区动作行把标签折进按钮里**：分栏是 `minmax(290px, 36%)` ⇒ 写作卡只有 ~346px，而四件套（小记一下/取消/⌘Enter 提示/可拖入提示）≈340px + 默认 `nowrap` ⇒ 标签在按钮内部折两行、第二行被行盒裁掉（实测按钮 70×40、行高 28）→ 动作行改「**整组不收缩 + 放不下就换行**」（`styles/app/quick-notes.css`）。1000px 下按钮回 70×28、行高 51、无裁剪；**1315px 截图逐字节相同**（零回归）。
  3. **「关于 → 运行时」文案写死 Electron 43**（实装 44.3.0）→ 去掉写死版本（"实际版本见下表"），避免与下表重复且必然过期。
- **探针结论（95 屏态）**：对比度告警 **0** · 整页横向溢出 **0** · UA 默认焦点环 **0** · 无错误屏。
- **候选（未修，理由已记）**：① `.sidebar.sidebar-docked` 的 `height:100%` 取的是**网格容器**高度而它在第 2 行 ⇒ 侧栏与其分隔条比可用高度**高 38px**（实测 820 视口下 bottom=858）。当前**无可见症状**（背景/命中带都被窗口裁掉，侧栏内也无底部锚定内容）⇒ 按 AGENTS §3#17 不动，记入 §3；② 富文本里插普通 2×2 表格时 `table.ne-table`(750) 宽于 `.ne-table-hole`(654) ⇒ 出现横向滚动条（夹具表格无固定宽度）；需一条**真实文档**数据才能定性；③ 画板画布内自带主题下拉（Drawnix 厂商 UI，与 App 主题控件并存）⇒ 观察项。
- **补屏（B1 收尾）**：走查脚本补到 **22 屏**（新增 **文档属性 / 历史版本 / 分屏**）+ 屏幕过滤参数（`walkthrough.mjs <theme> <width> <屏名逗号列表>`）。再跑 **light-1315 与 dark-760 各 22 屏**：三张新屏几何与层级都正确（分屏两栏 + 合并标签、属性对话框、历史快照面板），无新增缺陷。
  - 两条**装置备注**：① 分屏菜单项类是 `.tab-switcher-select`（`Menu` 的 `surfaceClassName="tab-switcher-menu"`，不是 `[role=menuitem]`，已写进脚本）；② 760 档下「属性 / 历史版本」取不到——窄窗是抽屉形态、右键菜单不在同一可见层 ⇒ 这两屏以 1315 档覆盖为准。
- 门禁：tsc ✓ · vitest **214 文件 / 1724 用例** ✓ · ui-metrics ✓ · cssLayers（两处基线按新声明上调并写明理由）✓ · `git diff --check` ✓。

### 261009 追加 · 表格内核 floating 层收口（黄叹号不再逃出标签宿主；@univerjs/ui 补丁 + 两道护栏）

- **用户报**：表格里那个**黄叹号**层级最高、切到别的文档也盖不住。
- **定位（只读取证，链已完整）**：它是内核 **CellAlert**（`@univerjs/sheets-ui` 的 `ForceStringAlertRenderController`：单选「文本格式的数字」单元格时弹的警告，菜单项「转换为数字」——截图里的 600010 列正是这种单元格；`sheets-numfmt-ui` / `sheets-formula-ui` 另有两个同类，都走这一个浮层）。承载它的 floating 层（`CanvasPopup`）被内核**无条件 portal 到 `document.body`**（`@univerjs/ui` 的 `DesktopWorkbenchContent` / `MobileWorkbench`，读的是新建 div + `document.body.appendChild`）⇒ **它不在标签宿主里**：`styles/app/tabs.css` keep-alive 的 `opacity/visibility` 隐藏（刻意保留布局尺寸）对它无效；内核自己"看不见就隐藏"的判据读**画布 rect**（`visibility:hidden` 的元素 rect 仍有效）⇒ 它认为还在屏幕上。只有它长期可见，是因为 CellAlert **随选区常驻**（下拉/日期/颜色都是瞬态）。
- **修法（用户 261009 选 A）**：`patches/@univerjs+ui+1.0.3.patch`（**唯一** Univer 补丁；两处 workbench 各 2 行）——floating 容器改挂实例自己的 `mountContainer`（`#univer-sheet-<noteId>`）+ 打 `data-lake-univer-floating` 标记（探针定位用）+ 卸载改 `portalContainer.remove()`（不再假定父节点是 body）。只改挂载点、不改内核逻辑 ⇒ 一次修掉**整类**浮层逃逸（CellAlert / 下拉 / 日期 / 颜色 / 选区），功能一个不丢。
- **护栏**：`usheetKernelContract.ts` 的 `UNIVER_PATCH_HOOKS`（触点 + 为什么 + 失效表现）；`univerContract.test.ts` **护栏③**（补丁文件在仓库里；实装产物里**必须没有** `document.body.appendChild(portalContainer)`、必须有挂载/remove/标记）；`usheet-kernel-probes.mjs` **+2 条**（容器在宿主内；切走后不可见）。升级处置与 **patch-package「本机安装失败不以非零码退出」的陷阱**写进 `docs/USHEET-UPGRADE.md` §4.7，`AGENTS.md` §2 加了一句（原文明写"不要给 Univer 打 patch"，已改成"仅此一处例外"）。
- **验证**：补丁对**上游原始 1.0.3** 可重放（`npm pack` + `patch --dry-run` + 真应用，结果与仓库内文件逐字节一致）；产物核对（`dist/assets/UniverSheetEditor-*.js` 内是 `setAttribute('data-lake-univer-floating'); s.appendChild(O)`，旧写法 0 处）；隔离实例探针 **退出码 0**（8/11 通过，3 项为既有"合成输入无 OS 焦点"提示；补丁两条全过：`{inHost:true,inUniverRoot:true,atBody:false}` / `{hostActive:null,visibility:"hidden"}`）。首轮那条 `工作表「＋」` 失败是**合成点击偶发**（复跑 PASS，且该路径与补丁无关）。
- 门禁：tsc ✓ · vitest **214 文件 / 1724 用例**（+2）✓ · ui-metrics ✓ · check:core 75-0 ✓ · 双端构建 ✓ · bundle 预算 ✓ · `git diff --check` ✓。
- **同批顺带（设置页文案，用户 261009 追加）**：`启用云同步` 行新增**隐私数据提示**（可见、琥珀色）——徽标「隐私数据 · 云端不加密」+ 说明「开启后笔记正文与附件会上传到你的 S3（按原样存储、不做加密）；请先确认该桶为私有、未开放公开读，且凭据只有你持有」。**用户追加口径（261009）**：**固定展示** —— 不开条件渲染，云同步关着、"还没测试连接通过"时也照常显示（"云端不加密"必须在开启前一直在眼前），也**不做**需要悬停才出现的隐藏提示。
  实现**零新增 CSS**：`settingsPrimitives` 的 `Switch` 加可选 `note`（渲染进既有 `.config-note`）+ 徽标复用 `.ln-tag--pending`（`--lake-status-pending` 琥珀）——两条都是既有单一来源；文案收在 `core/cloudState.ts` 的 `CLOUD_PRIVACY_NOTICE`（桌面/移动**共用一份**，照 `cloudStateHint` 先例）；`settingsSearch` 的 `sync-enabled` 关键词补「隐私 / 隐私数据 / 加密 / 不加密 / 私有」（搜得到）。
  **实机确认**：桌面（隔离实例 + CDP，把开关关掉 ⇒ 描述切到"先在上方…测试连接"变体）**提示仍在**；移动端（模拟器 + `emu-cdp`，同步设置页）徽标同样 `rgb(143,95,14)` / 软底 `rgb(247,240,226)`，380px 宽下 4 行显示正常；`npm run check:mobilesnap` **6 态 0 差异**（该子页不在基线态里）。
- **未做 / 注意**：① **dev 实例（vite dev server）仍跑预打包的旧依赖** —— `node_modules/.vite/deps/facade-*.js` 里还是 `document.body.appendChild(portalContainer)`，要看效果需重启 vite（必要时 `--force`）；本轮**没动**用户正在看的 9222 实例。② 本批代码改动**已提交**（`10c84e9`）。③ 移动端真机未跑（补丁同时覆盖 `MobileWorkbench`，移动端产物已重建）。

### 261010 · 表格（usheet）性能 + 粘贴落点 + 右键插图 + 默认尺寸 + 内核契约与升级规范（已交付）

- **性能（实测：隔离 userData + 真实 Electron + CDP，dev/scheme 双模式）**
  · 切标签空窗 0.69s（scheme）/1.83s（dev）→ **0.01s**：UniverSheetEditor 隐藏**不再销毁实例**（keep-alive），只在卸载（关标签 / 换文档）时 dispose；隐藏态无空转（3s 内 rAF 0 次），每实例净增 6–15MB，总量受 maxOpenTabs（默认 8）约束。
  · dev 首次打开 3.68s → **0.18s**：MultiTabEditor **仅 dev** 空闲预取表格分包（打包侧保持真懒加载）。
  · 大表格（打包构建，点击→画面）：1 万格 92ms / 5 万格 126–148ms / 10 万格 240–485ms / 40 万格 340–1712ms（**方差大**，同一夹具复测到过 340 与 1712）；我们自己的 JSON 往返只占 ~30ms@2.2MB ⇒ 瓶颈在内核渲染，不在包装层。编辑落盘主线程长任务 75ms@10 万格 / 221ms@40 万格。**结论：5000 行这一档没问题，不必再优化我们的包装层。**
- **粘贴图片落点**：单图 + 有活动单元格 ⇒ **单元格图片**（先上传成资产再插，从源头不产生 blob）；无选区 / 一次多图 ⇒ 放行内核默认（浮动图，**不静默丢图**）；只读封死；上传失败退回内联 data URL。为什么只能在 DOM 层（window 捕获）拦：见 docs/LAKEX-CONTRACT.md §5.25。
- **单元格右键「插入」子菜单**新增「插入单元格图片」（facade createMenu({ action: 命令 id }).appendTo([...])，**复用**已有命令；路径逐段单个 key）。
- **默认尺寸 = 50 行 × 16 列**（用户 261010）：新建表格文档（core/usheetDoc.ts 的 USHEET_DEFAULT_ROWS/COLUMNS，单一来源）与工作表标签「＋」（preset 的 footer.addSheetButtonConfig）两处同一口径；移动端 viewer 共用同一份 footer 配置。
- **底部计算条 36px → 30px**；文档状态栏改为**实测变量**跟随（--usheet-status-bottom，与多维表 --lake-bitable-status-bottom 同姿势），保持其上沿 4px 缝。内核把该高度写成**行内样式** ⇒ 这一条覆盖是全仓新增 !important 的唯一理由（理由写在规则处）。
- **架构/升级收口**：内核触点集中 src/features/usheet/usheetKernelContract.ts；静态护栏 univerContract.test.ts（版本一致性 + 触点符号存在性）；运行时探针 scripts/usheet-kernel-probes.mjs（升级后一条命令）；规范与路线 docs/USHEET-UPGRADE.md；@univerjs/* 全部**精确锁 1.0.3**（不许 caret/tilde 区间，避免两份 core 让 DI 静默失效）。
- **用户已定「不做」（别再提）**：① 「开始」工具收窄里**隐藏旧工具就是为了让折叠的出来** ⇒ 不给白名单、不改现状；② canonical 快照挪到空闲时段（只对大表有意义）暂不做；③ 移动端/桌面抽公共 runtime、单实例多 workbook 共享不做（理由见 docs/USHEET-UPGRADE.md §7）。
- 门禁：tsc ✓ · vitest **214 文件 / 1722 用例** ✓ · ui-metrics ✓ · check:core 75-0 ✓ · 双端构建 ✓ · bundle 预算 ✓ · git diff --check ✓ · 探针 **7 致命项全过**（2 项提示为「合成输入无 OS 焦点」偶发，不影响退出码）。

### 261009 收尾 · 移动端表格切换 + 三处移动端修复 + 跨端污染清理 + 手机口径适配（已合并并推送 master）

- **移动端表格组件切换（kind=usheet 只读查看器）**：新增 `src/mobile/usheet/MobileUsheetViewer.tsx` —— 与桌面**同一套 Univer 内核**；只读（`setEditable(false)`）、**不挂工具条/公式栏**、**不保存不写库**；首次可见才挂载；资源走本机 AssetServer canonical URL + token；**懒加载不进首屏**（入口 chunk 对 6.6MB 的 Univer 运行时零静态引用，由 `mobileLazyChunks.test.ts` 卡住）；接进 `NotebookWorkspace` 的 kind 分派（原为"暂不支持"占位）。
- **模拟器实测（Capacitor WebView；AVD `lake_mobile` Pixel6/API36）**：网格正常渲染；`[data-u-comp=ribbon-toolbar|headerbar|formula-bar]` 计数 **0**（只读）；**在格子上输入不落库**（回读 DB 正文未变）；heap ≈ 58MB；无崩溃。
- **三处移动端真问题（用户现场反馈，均已修）**：
  ① **层序被内核打穿**：Univer 给 canvas 写了 inline `z-index:8`，而移动端底栏 `z-index:3`、侧滑抽屉 `z-index:7` ⇒ 画布盖住二者（实测底栏按钮 `elementFromPoint` 全命中 CANVAS）→ 给 `.mobile-usheet` 建层叠上下文（`position:relative; z-index:0; isolation:isolate`）。
  ② **只读仍拉起输入法**：Univer 内部 `div[contenteditable]`（`#__editor___INTERNAL_EDITOR__DOCS_NORMAL`）自己抢焦点（实测 `mInputShown=true`）→ 只读查看器加**焦点闸门**（容器内 `[contenteditable]` 一律 blur）。
  ③ **跨端污染**：移动端借桌面 `components/NoteInfoDialog` → `HistorySnapshotPreview` → 懒加载**桌面** `UniverSheetEditor`/`BitableEditor`/`BoardEditor` ⇒ 桌面编辑器被打进移动端包、且移动端打开表格历史快照会挂**桌面**编辑器 → 新增 `src/mobile/ui/NoteInfoSheet.tsx`（移动端自有「文档属性」抽屉）替代；桌面 `NoteInfoDialog` 未动；`HistorySnapshotPreview` 另加移动端提示护栏（纵深防御）；护栏见 `mobileLazyChunks.test.ts`。
- **移动端「文档属性」按手机口径重排**：内容自带左右 16px 内边距（`.mobile-sheet-body` 本身是 0 内距）、信息**一行一项**（标签左/值右）、章节 1px 分隔线、空态紧凑左对齐（原误用为"整屏空"设计的 `.mobile-sheet-empty`）。实机几何：sheet 412×553、`.minfo` padding-left 16px、行宽 380。
- **移动端残留审计（专项，全清）**：源码 / kind 取值 / CSS / `doc_kind` schema / Android 原生层 / 产物 / 快照脚本 —— 无 `fortune`/`luckysheet`/`MobileSheetViewer`/`.mst-*`/旧 `sheet` kind；重建后 `dist-mobile` 里的**桌面编辑器 chunk 与桌面专属标识全部消失**（只剩 `MobileUsheetViewer`）。
- **未覆盖（后续/真机验收补）**：触摸滚动与双指缩放、软键盘弹出后的布局、移动端表格里的图片加载、真机；另有**首帧短暂空白**（画完即正常，未量化绘制耗时）。
- 门禁：tsc 0 · ui-metrics ✓ · vitest **210 文件 / 1703 用例** · check:core 75-0 · 双端构建 ✓ · `git diff --check` ✓。

### 261009 续 · 工具栏「收起 / 展开」+「开始」精简 + 右侧槽位 + 残留收尾 + 合并 master（已交付并合并）

- **工具栏「收起 / 展开」**：**不切 `ribbonType`**，保持 `classic`（工具行永远跟随**选中的大分类**），收起时只用宿主类藏掉**页签行** `[data-u-comp="ribbon-header-menu"]` ⇒ 双行 76px ↔ 单行 40px。按钮在工具行最右（24×24 / 圆角 4 / 图标色 `--lake-text-1`，与 Univer 工具按钮同规格；左侧 1px 分隔线成独立槽位），纵向位置由 `syncRibbonToggleTop` 量出工具行 top 写进 `--usheet-ribbon-toggle-top`（自动跟随；须扣 `host.clientTop` 的 1px 边框）。收起状态**设备本地记忆**（`lake-notes-v3.usheet.ribbon-collapsed`）。
- **关键实测（别再走弯路）**：Univer **没有**运行期"关公式栏 / 关页签"的公开 API（`formulaBar` 是创建时布尔；`setUIVisible('header-menu')` no-op；`updateMenuConfig({hidden:true})` 藏不掉页签）；原生 `simple`/`collapsed` 单行模式**会把工具重置回「开始」**；**`defaultEngine.resize()` 是 no-op**，必须用**渲染单元**的 `engine.resize()`（`IRenderManagerService.getRenderAll()`），否则收起后画布不跟（底部留空条）。CDP 依附窗口 `document.hidden` ⇒ `rAF` 不触发，重排触发用 `setTimeout`。
- **右侧槽位与「更多」**：Univer 的溢出判定读 `ribbon-toolbar` 的 **`contentRect.width`（不含 padding）** ⇒ `padding-right: 50px` 既让「更多」**更早出现并左移**，又给收起按钮让出槽位（不预留时实测「更多」占 gap 19–43、按钮占 9–33 ⇒ **重叠**）。
- **「开始」精简 5 项**：字体 / 粘贴 / 百分比 / 货币 / 快捷键面板，走公开 API `updateMenuConfig({ hidden: true })`。⚠️ **只列该位置专属的 id**：`sheet.command.paste` 同时挂在右键菜单（隐藏会连带干掉**右键粘贴**）⇒ 粘贴只藏 `sheet.menu.paste`。副作用：腾出的宽度会被原先挤在「更多」里的工具**自动补位**（缩小字体填充 / 文本旋转 / 合并单元格 / 常规 / 增加小数位）——要"真的变短"须继续点名或给「开始」定白名单（**待用户定**）。
- **依赖**：`@univerjs/engine-render` 显式声明并**锁 `1.0.3`**（＝ presets 的精确 pin；出现第二份会让 DI token 不一致 ⇒ 引擎重排**静默失效**）。
- **收尾**：旧表格残留全量复检并清零（见下条"残留审计"）；`master` 已 fast-forward 合并（`25ab081`）。spike 验证设施已按 AGENTS §2「已完成 spike 直接删」**全部删除**（`src/spike/`、`spike-univer.html`、`vite.spike.config.ts`、`scripts/spike-univer-cdp.mjs`、`scripts/usheet-stress.mjs`、`docs/UNIVER-SPIKE-261009.md`、`docs/USHEET-TOOLBAR-OPTIMIZATION.md`，连同 `.gitignore` 的 `/dist-spike`、`/spike-*.png`）；**移动端表格组件同步切换**——新增 `src/mobile/usheet/MobileUsheetViewer.tsx`（同一套 Univer 内核、只读、不挂工具条/公式栏、不保存；懒加载不进首屏，由 `mobileLazyChunks.test.ts` 卡住），接进 `NotebookWorkspace` 的 kind=usheet 分派。
- 门禁：tsc 0 · ui-metrics（未定义令牌 0）· cssLayers/uiPrimitives ✓ · vitest **209 文件 / 1698 用例** · check:core 75-0 · 双端构建 ✓ · `git diff --check` ✓。

### 261009 · usheet 转正为唯一表格 + 旧表格彻底移除（**已合并 master**：`25ab081`）

- **分支状态（261009）**：工作先落 `spike/univer-sheet`，工具栏工作落 `spike/univer-ribbon`；**两条分支均已 fast-forward 合并进 `master`**（用户 261009 指示"合并到 master"）⇒ master 现为 usheet 唯一表格版本，领先 `origin/master` 33 个提交（**尚未 push**）。
- **彻底移除旧 sheet**：删 `src/features/sheet/` 整目录、`core/sheetDoc.ts`/`sheetGeometry.ts`（+测试）、`mobile/sheet/MobileSheetViewer.tsx`、两个 `@fortune-sheet` 补丁、`scripts/sheet-icons.*`、`package.json` 的 `@fortune-sheet/react` 依赖；`NoteKind = doc|usheet|bitable|board`（旧 `sheet` 按 AGENTS §3#7 直接回退 doc，**无迁移**）。
- **UI**：状态栏 / 侧栏文案「表格（新）」→「表格」。
- **顺带**：大表格粘贴护栏「存为表格文档」改为产出 usheet 正文（`parseHtmlTableToUsheetBody` / `native.createUsheetIn`）。
- **门禁**：tsc 干净 · vitest **209 文件 / 1698 用例** · ui-metrics · check:core 75-0 · 双端构建 · `git diff --check`；应用侧冒烟：建表 → 开表 canvas 正常、状态栏「表格」、全页无「表格（新）」。
- **残留审计（合并前全量复检）**：依赖（`package.json`/`package-lock.json` 里 `@fortune-sheet` = 0、`node_modules/@fortune-sheet` 不存在）、`patches/` 只剩 `@plait+draw`、旧模块文件全不存在。**又清掉 3 处此前遗漏的残留**：① `electron/store.ts` 仍在**创建旧 `sheets/` 正文目录**（已删）；② `src/mobile/mobile.css` 里 **23 条零引用的旧表格只读视图样式 `.mst-*`**（已删，−127 行）；③ 旧 kind 的措辞全部中性化（`noteKind`/`syncDecisions.test`/`usheetDoc`/`boardDoc`/`noteQueries`/`historyRepository`/`mobile/noteRepository`，以及 STORAGE-LAYERS 与 LAKEX-CONTRACT 的 CSP 对比），`make-fixture` 的 `notes.sheet` key 改名 `notes.usheet`。`dist`/`dist-mobile`/Android assets 里的旧 `SheetEditor-*`/`MobileSheetViewer-*`/`sheetDoc-*` 产物已随重建清除。**现状：全仓 `git grep -i "fortune|luckysheet"` 只剩文档里的迁移记录与本批对比结论，代码 / 依赖 / 产物零残留。**
- **文档**：TROUBLESHOOTING 删旧表格章节 K/M/N/O/P/Q；HANDOFF 删旧表格 §0 小节与 §3 暗色任务书/补丁坑；AGENTS 删旧表格图标/换行/右键条目（保留通用「模块级单例串台」教训）。
- **遗留清理（261009 收尾已完成）**：spike 验证设施已全部删除（见上条"收尾"）。

## 1. 项目一句话 + 铁律（详见 AGENTS.md）
本地优先笔记应用（Electron 44 + React 18.3 + better-sqlite3 + 语雀 Lake 内核），S3（七牛 Kodo 兼容）同步。
**红线**：① 本地是真相、S3 只是镜像（云端备份绝不反噬本地）；② 目录/删除强一致（删除传播、墓碑权威）；
③ `src/core/` 禁 `node:` 导入（平台差异走端口注入）；④ 开发数据只用 `lake-notes-dev`，绝不碰正式数据；
⑤ 不为旧数据写兼容/迁移（能删重建就删重建）；⑥ 杀 Electron 只 kill 具体 PID，禁 `pkill -f Electron`；
⑦ 不擅自合 master（代码批次需用户验收；文档类清理可直接提交；**260928 多维表批次已由用户明确授权「提交代码」（仅提交、未推送）**）。移动端另有铁律见 **§8.0**。

## 3. 待办与已知问题（上线后 backlog）

> 多维表专项已收口；以下是专项之外真正保留的低优先项。

1. ~~**同步 warning 结构化**~~ **已完成（261007）**：core 直接产出 `SyncWarning`（`{kind, noteId?, title?, filename?, message}`，单一来源 `src/lib/types.ts`），控制器不再正则反解；同步浮窗展示「被跳过」列表 + 点击打开文档；`AssetMissingError` 结构化携带 `filename`。**同步语义未变**（仅报告契约）。
2. ~~**画板 AI 助手**~~ **已完成（261003）**：接的就是内核 `ai.generate` 钩子，转主进程既有 AI 通道（Key 不出主进程、不新增 IPC），只读不给入口。见 git 历史。仍不做的是**文内文本绘图卡片**（`TextToDiagram`，内核那支绿色徽标无注入点）。
3. ~~**UI 低优先：设计词表继续裁剪**~~ **已完成（261007）**：全仓零引用令牌 17 → 裁掉 **5 个被取代的 `--lake-media-*`**（`surface`/`btn`/`btn-hover`/`on-faint`/`on-dim`，消费者实际用 `scrim`/`toolbar`/`on`/`on-soft`/`-hover-2`）；其余 12 个按口径保留（尺度 ramp：`space-giant`/`motion-instant`/`motion-slow`/`ease-emphasized`/`ease-exit`/`font-weight-bold`；层序阶梯：`z-base`/`z-sticky` + 被护栏/文档引用的 `z-block-handle`/`z-overlay-lightbox`/`z-scrim`/`z-toast`）。口径见 AGENTS §3#14 与 `themes/base.css`。画板 `Wt` 已修复（`6b901bb`）；目录树窗口化不做。
4. **移动端剩余**：真机验收、数据导出/导入、粘贴与资源 URL、长文档大纲跳转；详细步骤见 §8。
5. ~~**搜索整体重构**~~ **已完成**（`984ccbc` 统一 FTS5+unicode61+CJK 单字预分词+增量账本、`d5ed6c0` 移动端纯文本源+拉丁前缀+多命中定位、`4fea72b` 设置页重建索引、`820305b` 标题-only upsert 保正文索引）：桌面/移动共享 `src/core/search/`。**剩余为可选增强（非缺陷）**：移动端索引源改 `getDocument("text/plain")`；拉丁子串检索（加 3-gram 列）；小记搜索（二期）；命中定位仍是 DOM 启发式（lakex 无公开查找 API）。
6. **历史快照恢复为新文档**：用户已明确先不做；恢复入口仍只覆盖当前文档，恢复前自动留档。
7c. ~~移动端 SecretStore 不跨重启 ⇒ S3 密钥丢失~~ **已修（261009）**：
   - **根因（实测澄清过一版）**：不是"整个 WebView 存储都不持久"——同批实验里 **localStorage 跨重启仍在**，而 **IndexedDB 被重建为空**
     （重启后探针库的 `onupgradeneeded` 再次触发；磁盘上 `app_webview/Default/IndexedDB/http_localhost_0.indexeddb.leveldb` 还在）。
     旧实现（`src/mobile/secretStore.ts`）把密文放 IndexedDB ⇒ 重启后 `getS3Settings().secretAccessKey` 长度 0，
     所有 S3 操作报 `The request signature we calculated does not match the signature you provided`。
   - **修法（保留原设计的降级语义，只换持久层）**：密文改存 **localStorage**（键 `lake-notes-mobile.secret.*`，仍是 WebCrypto AES-GCM 密文、**不是明文**）；
     并在 `read` 时**一次性兼容迁移**旧 IDB 值（读到就搬进 localStorage 并清旧条目）。
   - **顺带治理报错**：`bridge.ts` 在建 S3 客户端处加 `assertS3Credentials()`（单一来源，同步/测连通/上传三条路径共用）：
     密钥缺失时给「请到「设置 → 同步设置」重新填写 Access Key / Secret Key」，不再让请求去报签名错。
   - **护栏**：新增 `src/mobile/secretStore.test.ts`（4 例：往返、**落盘是密文**、**模拟重启仍可读**、缺失/删除返回 null）；
     `bridgeCloudState.test.ts` 增 1 例（密钥缺失 ⇒ 提示 + 不发请求）。两个既有测试的 `secretStore` mock 改成"已配置 S3"的真值语义。
   - **设备验收（AVD，决定性场景）**：保存 → 当场 `skLen 40` / 连通 OK → `am force-stop` 重启 → **`skLen 40` / 连通 OK / 同步成功**（原来必报签名错的场景）；
     空密钥档实测两条路径都回「S3 密钥缺失…请到「设置 → 同步设置」重新填写」且**不发请求**；落盘的 localStorage 值不含明文。
   - **遗留**：仍是"非硬件级安全"的降级实现（密钥材料固定派生、WebView 内存可读）——`secretStore.ts` 头注释与 §17.5 的"正式版换 Android Keystore-backed"未变，属后续项。
7. **低优先数据/性能**：附件哈希缓存仅在真实痛感出现后立项；回收站惰性下载暂缓；Word/PDF 大附件与历史 `lakex-contract.d.ts` 按需处理。
8. **已知外观**：离线残余资源、移动端缩略图仅覆盖 png/jpg/jpeg（失败回退原图）、多维表附件旧数据的体积展示边界。
9. **多标签切换时内核工具条 1~4 帧绘制空帧（261008 记录，未修）**：非活动宿主用 `visibility: hidden` 隐藏 ⇒ 浏览器**丢弃其绘制图层**，切回来整棵子树重新栅格化，内核工具条（子树最重）最后画完。**实测口径**：`.ne-ui` 切换瞬间已是 `opacity:1 / visibility:visible / transition-duration:0s`（不是 CSS 淡入）；标签高亮与可见宿主同帧、`--lake-editor-top`/`.tab-panels` 顶边不跳（rAF 逐帧 0 错位）。**方案 2（宿主 `will-change: opacity`）实测无效、已撤**。可行方向 = 方案 1：非活动宿主改 `opacity: 0` + `inert` + `pointer-events: none`（不再丢层），代价是非活动编辑器保持绘制，需按 10 万文档量级评估。**别再无证据试提层类改动**。 **261012 复测（用户定：暂不做，记录备查）**：用 CDP `Page.startScreencast` 抓**真实帧流**逐帧量工具条区域亮度标准差（15.55=富文本工具条 / 11.07=多维表工具条 / **2.29≈纯背景=空帧**）：切到「富文本」类重工具条 ⇒ **2 帧空窗（@262ms，本机 `--disable-gpu` ~7fps；60fps 真机即 §3#9 的 1~4 帧）**；切到多维表（工具条较轻）⇒ 0 帧。**根因坐实**：`tabs.css` 非活动宿主的 `visibility:hidden` 丢绘制图层 ⇒ 切回重栅格化。**修法实测**：① **F1 = 非活动宿主改 `visibility:visible` + `opacity:0`（保留层）⇒ 空帧 2 → 0**，6 标签实测空闲帧间隔 p50 17ms / p90 17–18ms、JS 堆 +1MB（**无可测代价**）；但 `visibility:hidden` 现在免费承担「退出 a11y 树 + 退出 Tab 序」，改 F1 必须补 **`inert`**（实测非活动宿主会多出 **161 个可聚焦元素**），落点 = `tabs.css` 1 行 + 4 个宿主各 1 行（`EditorTab`/`UniverSheetEditor`/`BitableEditor`/`BoardEditor` 的 `data-active`/`data-pane-visible` 旁）。② F2（工具条 `will-change:transform` 层提升）**实测仍 2 帧、无效**（与 261008 的 `will-change:opacity` 同结论）。③ **决定：暂不做**（用户 261012：闪烁可接受；F1 虽仅 5 行，但动的是 261005 统一过的隐藏机制，需逐项回归 fit-width 表格 / 画板滚动 / 工具条残留 + 焦点序 + 多标签性能）。

10. **样式大统一（260930 审计，三批已完成；③⑤ 已记录、暂缓不做的理由见下）**：用户要求「找出散落各处的相同操作模式，做成正式原语统一起来」。
    **已完成**（详见 AGENTS §3#14 的单一来源清单与 git 历史）：
    ① **菜单项** `.ln-menu__item`（顶栏下拉 / 右键菜单 / ＋菜单 / 多维表列菜单，legacy 选择器一并收编，overlay −29 条）；
    ② **图标按钮** `.ln-iconbtn`（新增 `--compact` 22×22 / `--accent` 主色 hover 两个正式变体；目录栏 12 处 + 目录行动作 + 多维表 6 处，chrome −39 / bitableEditor −63 条）；
    ③ **单行省略** `.ln-ellipsis`（新工具类，27 个调用点；**flex/宽度属于布局、仍留业务规则**）；
    ④ **选中行** 三元组收编进 `.ln-row.is-selected`（页签溢出菜单行 / 设置左导航，overlay 菜单 hover 随①）；
    ⑤ **图片填满裁切** `.ln-imgfill`（4 处；顺带删掉死代码 `.mobile-qn-img` 3 条）；
    ⑥ **输入框** 关联选择器搜索框 → `.ln-input__field`；面板头（回收站/历史）合并；卡片标题随③收编。
    **明确暂缓（已记录，不做）**：
    - **顶栏 `.toolbar__item` 并进 `.ln-btn`**：两者只差 1px 高与 padding（26/8 vs 27/11），但顶栏几何曾被 `--shell-*`/面包屑/窄窗 media 引用 ⇒ 原判「不抵回归风险」。
      **261012 实测（运行时候选实验，未改仓库）**：把 `.ln-btn` 的盒子（27px / `0 11px` / 1px 透明边 / 字重 500）注入 `.toolbar__item` 后，**1315 / 1060 / 760 三宽结果一致，且只动顶栏按钮自身**：
      首按钮 95×26 → **106×27**、右侧两枚图标钮 31×26 → **39×27**（整组左移 16px）、顶栏按钮高 26 → 27；**顶栏之外 0 位移**（`.top-menu` / 面包屑 / `.tab-bar` / `.tab-panels` / 状态栏几何全未变）。
      ⇒ 风险面比原记录小得多（只在顶栏内），但代价是**顶栏观感变化**（用户 260914 定的构图），收益仍是"少 ~10 条声明 + 顶栏按钮归一到 kit"。
      **261012 决定：维持不做**（构图冻结优先；若哪天要动顶栏，按上面三个宽度的数字直接做即可，无需再测）。
    - **toast 合一**（原记录写"三套 = `.ln-toast`/`.b3-snackbar`/`.mobile-toast`"，**261012 核实后已过期**）：`.ln-toast` **261006 就作为死原语删掉了**（`kit.css:236-238` 有留痕、需要时从 git 取回）；
      `.b3-snackbar`（`compat.css:163-177`）**全仓无 tsx 施加**，是思源契约的失效残留。
      **真正"各写一套"的是 4 处瞬时提示**：桌面 `.sync-toast`（chrome.css 20 条 / `SyncToast.tsx`，绑同步进度条+四态）、`.quick-notes-toast`（4 条 / 撤销按钮）、
      `.document-notice-toast`（8 条 / 嵌在**状态栏布局**里）、移动端 `.mobile-toast`+`-host`（8 条 / `mobile/ui/Toasts.tsx`+`toastBus`）。
      合一的真正含义 = 建一个 kit 层 toast 原语（表面/圆角/阴影/进出动效/错误态/关闭/可带动作），四处只留业务绑定。
      **仍暂缓**：验收难（瞬时浮层现有装置拍不到 ⇒ 要固定 `timeout=0` 造常驻态 + 计算值对拍 + 设备截图）、跨端（移动端那份属移动端写域）。
    - ~~**`.protyle-breadcrumb__item` / `.quick-note-index-main`**：审计把它们和输入框归为相似，收编前先定性~~ **261012 已定性（结案）**：
      两者都挂在 `<button>` 上、都是**行内可点击文本条目**，**既不是「行」也不是「输入框」** ——
      `.protyle-breadcrumb__item`（`EditorTab.tsx:1048/1057`）= 面包屑链接（`inline-flex / padding 0 / 无 hover 底 / text-overflow:clip`，产品既有决策）；
      `.quick-note-index-main`（`QuickNotesWorkspace.tsx:738`）= **列表行内的主区按钮**（行外壳是 `.quick-note-index-row`，它才是潜在的 `.ln-row` 候选）。
      ⇒ **不并入** `.ln-row` / `.ln-input`（审计的"像输入框"是误判）；今后审计再报到这两条，按此结案，别再立项。
    **工具（已入库）**：`scripts/css-audit/audit-lookalike.mjs`（找「像原语却没复用」，260930 命中 29 → 16）、`scripts/css-audit/audit-primitives.mjs`（跨文件规则体重复族，46 → 39）。改完样式重跑对比即可；判定只认这两份数据 + 实机几何，不认「看着像」。

11. **多维表行虚拟化（AR04 已证瓶颈；用户 260930 决定暂不做，留待后续）**：真实 Electron 压测（scripts/bitable-stress.mjs）——目标 5000×20 打开 **12.42s / 84.8 万 DOM / 395MB 堆 / 首次点选 2.25s**；10000×20 = 24.8s/169 万/1.34GB；20000×50（100 万格）200s 内未渲染完成；50000×50 因**正文 32 MiB 上限**根本无法保存。结论：CPU 热点（AR-F5/F6）已消除，**DOM 全量渲染是瓶颈**，支持 5000 级规模需行虚拟化/渲染策略；立项前先定「5000×20 滚动/编辑目标 + 验收口径」。**用户 261007 确认：长期待办、暂不做。**

12. **非多维表审计遗留（260930 会话决定）**：
    - **F16 安卓整轮网络同步持本地写队列 —— 已实测（261009，用户授权用 dev 前缀 `lake-notes-dev1` 直连 S3）**：结论 **立项** ⇒ **已修复（261010，见 §0 本批）**：写域/维护域分离 + 判据单一来源 + I2 守卫；**弱网实测已收尾（261010）：同步 59.3s 期间写等待 32ms（旧 152.0s），见 §0**。
  - **量法**：移动端调试契约 `window.lakeNative`（`saveNote` / `syncNow`）+ 页内 `performance.now()` —— 先起 `syncNow()`，等 150–300ms 让同步进入队列，再发一次本地写，量这次写完成耗时；同法先量"无同步时"的基线写。
  - **数据**（AVD lake_mobile；弱网档 = 模拟器 `-netdelay gprs -netspeed gprs`，≈80kbps / 500ms RTT）：

    | 库 | 网络 | 同步整轮 | **同步中写等待** | 基线写 |
    | --- | --- | --- | --- | --- |
    | 7 篇 / 全量 8 对象 | 正常 | 701ms | 551ms | 32ms |
    | 7 篇 / 增量 1 对象 | 正常 | 434–488ms | 283–332ms | 32ms |
    | 68 篇 / 全量 61 对象 | 正常 | 1828ms | 1628ms | 32ms |
    | **68 篇 / 全量 40 对象** | **弱网** | **152.3s** | **152.0s** | — |

  - **判定**（按之前定的口径：P95 数百毫秒 ⇒ 不做；上千毫秒或分钟级窗口 ⇒ 立项）：弱网下本地写要等 **~2.5 分钟**，且同一条队列上还有建/改/移/删笔记本、回收站/恢复/彻底删除、历史、GC ⇒ **立项**。
  - **方案（下一批）**：网络阶段不占主队列 + DB 片段内短锁；先跑跨端 sync 对拍（桌面/移动同序列改动结果一致）；并补「排队中的写尚未落盘 → App 被杀就丢」的兜底（移动端普通文档没有草稿位，小记有草稿位）。
  - **测过的现状（261009）**：移动端 `src/mobile/bridge.ts` 用一条 `KeyedAsyncQueue`（key 固定 `main`）把**整轮同步（含全部网络往返）**与本地写**完全互斥**；桌面**没有**该问题（维护锁只包 整轮同步 / 数据库备份 / 定期 GC 对账）。
  - **为什么思源没有（读 `siyuan-master`）**：① 文件是真相、DB 只是索引（`IndexNodeQueue` 入队 + 后台 `DatabaseIndexCommit` 攒批 + `index.queue` 落盘可恢复）⇒ 保存不等数据库；② 同步是 `dejavu` 文件/快照级，流程里是 `FlushTxQueue()` 排空而非持有本地写队列，`syncLock` 只防并发同步；③ 桌面与安卓共用同一个 Go 内核（APK 里跑内核 HTTP 服务，`KernelService` 保活）⇒ 一套并发模型两端通用。
  - **我们的差异（结论）**：仿的是前端壳 + 数据逻辑，没复制也无法复制「单一内核服务两端」的运行形态；移动端并发边界是自建的，桌面补过、移动端漏了 F16 —— 不是路线错，是两套持久化模型的一处已知欠账。
  - **测量留痕**：dev 前缀下多上传了约 70 个探针对象（`F16 探针 N`，可随时删）；一次性驱动脚本未入库，量法与数字已回填本条。

13. **AI 多轮对话记忆只保留最近 40 条（用户 261005 决定：先文档化、不做长期记忆）**：主进程 `electron/ai/aiChatMessages.ts` 的 `assertMessages` 只把**最近 40 条消息**发给供应商（更早的上下文丢弃；另有 `AI_MAX_TOTAL_CHARS=200000` 上限），面板关闭即清空、**无长期 / 跨会话记忆**，设置页「AI → 说明」已如实标注。若要长期记忆 / 摘要压缩 / 跨会话共享，需单独立项（涉及存储与成本，超出笔记软件当前范围）。
15. **表格（sheet）vs 云端 lake 语雀表格：体验对齐调研（261008，实机体验 Edge + 云端原文；按收益/代价排序）**
    > 体验地址：`https://todoo.yuque.com/ex813k/stock/kif3cv50apeg52za`（云端 edit 态 + 阅读态都走过一遍）。
    > 已在云端核实到的能力清单：工具栏 = 保存态/卡片 | 撤销重做 | 格式刷·清除格式 | **常规▾** | **小数位 ±** | 字号▾ | B I S U |
    > **字色▾ / 背景色▾（分体：点图标=上次颜色、点三角=选色盘）** | 边框▾ | 水平对齐▾ | 垂直对齐▾ | 换行 | 合并 | 筛选▾ | 排序▾ | 视图▾ | 更多（第二行平铺：链接 / 垂直对齐 / 换行 / 小数位 / 图片 / 保护 / 查找）；
    > **公式栏常驻（名称框 `C11` + 公式输入）**；单元格右键 = 剪切⌘X / 复制⌘C / 粘贴⌘V / **选择性粘贴** / 插入内容（子菜单：上下插行、左右插列）/ **删除第 N 行** / **删除第 E 列** / 清除 / **添加备注**；
    > 其余入口（更多/条件格式/公式库）：复选框、下拉列表、图片、链接⌘K、附件、备注、**图表**、公式（SUM/AVERAGE/COUNT/MAX/MIN + 数学·统计·财务·工程·逻辑·日期与时间·查找和引用·数据库·其他·全部）、
    > 数字格式（常规/文本/数字/百分比/货币/日期/时间/日期时间）、字号 12~48、对齐/溢出·切断·换行、升/降序、**条件格式（突出显示单元格/数据条/新建·管理·清除规则）**、
    > **冻结（至 N 行 / C 列 / 行列）**、**保护（所选行/列/单元格 + 管理保护范围）**。阅读态工具条 = 撤销重做·刷新 | 筛选▾ | 排序▾ | 视图 | 定位。
    - **P0（261008 已逐条处理完）**：① 公式栏 —— **用户决定保持隐藏、不做**（当初是他主动关的，`showFormulaBar={false}`）；
      ② **小数位 ± 已完成**（内核这版是死键 ⇒ 自建两个 custom item + `adjustDecimals`；`常规▾` 我们本来就有 = 工具栏「自动」下拉）；
      ③ 单元格右键三项**核查结论（都不做）**：剪切 —— ⌘X 内核**已支持**、但没有 `handleCut`（加条目得自实现「复制+清空」）；
      选择性粘贴 —— 内核**完全没有** `pasteSpecial`/`paste-special`（要做等于自建粘贴引擎）；添加备注 —— 内核「批注」下拉里**已有**插入/编辑/删除；
      ④ 删除项文案带目标 —— **已做后撤销（用户 261008）**，内核恢复原样。
    - **P1（中等代价，价值明确）**：⑤ **条件格式**（突出显示单元格 / 数据条 / 规则管理，内核 `conditionFormat` 已有）；⑥ **数据验证**（下拉列表 / 复选框，`dataVerification`）；⑦ 公式库完整版（Σ 按类别，现只有 5 个快捷函数）。
    - **P2（暂不做，需先立产品语义）**：⑧ **图表**（内核这版 react 单元格右键不认 `chart` key，要另做入口）；⑨ **表格内保护**（我们只有文档级锁定 `EditorTab.locked`，云端是行/列/单元格级保护，语义不同，要先定稿）；⑩ 分列 / 截图（低频）。
    - 对齐良好、无需改的：B/I/S/U、字号、字色/背景色（含**分体交互 + 记忆上次颜色**，刚对齐）、对齐/换行、边框、合并、筛选/排序（工具栏）、冻结、查找、格式刷/清除格式、自动行高、单元格图片、链接、批注、缩放、工作表标签菜单。
    - ⚠️ 改动口径不变：上述都要**先证真实价值**（AGENTS §3#17）；涉及内核能力的一律按 §2 三级检索（官方文档 → LAKEX-CONTRACT → vendor/补丁），别凭云端 UI 猜 API。

16. **大表格粘进「文档」会卡死（内核级，261008 用户实测；A+B 兜底，C 调研中）**：
    - **现象**：从本应用的「表格」文档复制 ~5500 行数据，粘进**文档** ⇒ 整个窗口卡死；用户实测**同一份内容在思源约 3s 完成**，
      而**云端语雀 Lake 同样卡死** ⇒ 判定为**闭源 lakex 内核的表格卡片问题**（不是我们这层能根治的）。
    - **本机实测**（[scripts/table-paste-stress.mjs](scripts/table-paste-stress.mjs)，合成 paste + 真实 text/html，等价真实粘贴）：

      | 粘贴内容（6 列） | 主线程**同步**阻塞 | DOM 节点 | 产物 |
      | --- | --- | --- | --- |
      | 1000 行 | 最大长任务 1,405ms | 43,400 | `ne-table-hole`（1001 行 / 6006 格） |
      | **5500 行** | **30.7s** | **269,108**（单个 render unit **225,612**） | `ne-table-hole`（5501 行 / 33,006 格） |

      5.5× 行数 → ~22× 时间（≈n^1.9，超线性）；CPU profile 34.6s 里 `value` 16.7s / `get` 5.9s / `e` 3.8s / **GC 2.8s**。
      我们的粘贴预处理（`clipboardHtml.ts` 的 `upgradePastedHtml`）只花 **146ms** ⇒ 不背锅。
      根因：**Lake 表格卡片整表全量渲染 DOM、没有虚拟化**，且粘贴在**一个同步任务**里建模型 + 渲染。
    - ✅ **A+B 已交付（261008）**：见 §0「大表格粘贴 A+B 兜底」——实测同步阻塞 **30,743ms → 2ms**，提示明确、剪贴板保留、一键存为表格文档并插入「文档引用」卡。以下为原始方案记录（保留作背景）。
    - **A（护栏，兜底方案）**：在 `clipboardHtml.ts`（本来就在处理每次 HTML 粘贴）量行列数/字节数，超阈值时不按表格卡片粘贴，
      并**明确提示**（"表格过大 N 行 × M 列，为避免卡死未直接粘贴；请改用表格文档或分批粘贴"）——**剪贴板内容保留、绝不静默丢弃**。
      阈值**已定稿为 ≤1000 行 / ≤5000 格**（用户 261008 上调；旧值 500/3000）。**边界实测**（隔离实例 + 合成 HTML，
      量的是 `dispatchEvent` 的同步耗时 = 主线程阻塞）：**1000 行 × 5 列 = 5000 格 → 1.93s / DOM +2.65 万**；
      100 行 × 50 列 = 5000 格 → 1.41s；旧上限 500 行 × 6 列（3000 格）→ 0.79s；**超限被护栏拦下时同步耗时 ≤1ms**（内核完全不接）。
    - **B（体验更好）**：超阈值时**自动落成「表格」文档**（表格侧性能已修好：共享 canvas + 400ms 静默窗口），
      文档里留引用/链接。需先定交互语义（落哪个笔记本、命名、是否跳转）。
    - **C（内核侧分批/异步粘贴）—— 261008 调研结论：本项目不做**（三条实证）：
      ① **既有的虚拟渲染帮不上**：文档级 `virtualRendering` 是**按 render unit（`ne-role="render-unit"`）**做虚拟化的
         （见 `src/components/BlockHoverHandle/BlockHoverHandle.tsx` 的判定），而一张粘贴进来的表格**整体就是单个 render unit**
         （实测一个 `ne-table-hole` = 225,612 个后代节点）⇒ 单测期内无法只渲染视口片段。
      ② **没有可用的增量插入口**：表格卡片的模型/渲染实现只在**闭源预构建 bundle** 里（`vendor/lakex-doc-react/src` 只有
         bookmark / imageToolbar 等少数插件源码），且 `.d.ts` 里没有 `insertTableRow`/`appendRow` 一类 API ⇒ 宿主侧
         「分 N 批往同一张卡里追加行、批间让出主线程」这条路**没有稳定接口**，只能反编译卡内部模型（高风险、随内核升级即失效）。
      ③ **上游同样卡**：用户实测同一内容在思源 ~3s、而**云端语雀 Lake 也卡死** ⇒ 是内核层面的已知限制，不是我们这层的实现问题。
      ⇒ 结论：**按 A+B 兜底**（护栏 + 大表自动落成「表格」文档），不改 vendor 的表格渲染。
    - **复现**：起隔离实例后 `SIZES=1000,5500 LAKE_CDP_PORT=9222 node scripts/table-paste-stress.mjs`（脚本头注释有完整启动命令）。

17. **表格（usheet / Univer）的取舍与已定「不做」（261010，别再提）**：① **「开始」工具收窄**——隐藏旧工具（字体/粘贴/百分比/货币/快捷键面板）**就是为了让原先挤在「更多」里的工具自动补位出来**，宽度变短不是目标 ⇒ **不给白名单**；② **canonical 快照挪到空闲时段**——只对大表有意义（40 万格约 130ms），50×16 规模无感，暂不做；③ **移动端与桌面抽公共 runtime**——差异是实质性的（只读闸门 / 焦点 / 资源 URL 带 token / 无工具条），抽出来只会变参数化分支；④ **单实例多 workbook 共享**——先保证不串台；⑤ 依赖侧冗余清理、运行时正文兼容层——不做（AGENTS §3#18 / §3#7）。升级内核依赖一律走 **docs/USHEET-UPGRADE.md**（静态护栏 `univerContract.test.ts` + 运行时探针 `scripts/usheet-kernel-probes.mjs`），**不要 npm update**。

18. **移动端内嵌画板卡「能插能看、但编辑不了」（261012 设备实测定性；5 项画图插入项因此置灰占位）**：
    内核侧其实**是可编辑的**（编辑态走 `editorComponent` → `DrawingBoardEditor` + `DrawnixBoardCore` **不传 readOnly**，与桌面同一套、同一懒加载 chunk），问题在移动端布局与手势：
    - **工具条容器盖住画布**：`@media (width<=720px)` 的 `.lakex-drawnix-core .draw-toolbar{top:auto;bottom:14px}` 与 `.drawnix--mobile .draw-toolbar{top:20px}` 叠加 ⇒ `top:20 + bottom:14` 把容器**上下拉满**（实测 351×524、`pointer-events:auto`、`z-index:20`）；`elementFromPoint` 在卡内任意点都命中它 ⇒ 画布 `svg` 收不到指针事件（鼠标/触摸都一样）。桌面是左侧窄条（36×288）所以没暴露。把容器临时压到 44px + `pointer-events:none` 后命中即回到 `svg` ⇒ 覆盖层是直接原因。
    - **触摸手势**：画布 `touch-action:auto`（无 `none`）⇒ 手指拖拽被判成滚动、`pointercancel`；且壳层「左滑开大纲 / 右滑开目录」会抢横滑（实测触摸拖拽把左抽屉滑开）。
    - **解禁需要两处定点改动**（内核 CSS + 壳层手势，单独立项；按 AGENTS §3#17 先证价值）：① 移动端让 `.draw-toolbar` 容器不拉伸 + 容器放行指针；② 画布 `touch-action:none`（至少工具激活时）+ 卡片区域内拖拽豁免抽屉手势。
    - 详录见 `docs/LAKEX-CONTRACT.md` §5.31。
19. **移动端 UI 重设计（皮肤 + 页内交互形态；信息架构冻结）—— 261012 立项，用户已确认，可开工**：
    - **口径**：保留当前布局（= 信息架构 / 页面层级不动：小记·知识库 第一层 → 笔记 第二层…）；**页内交互形态与动效可以重做**（弹层居中 Dialog→底部 Sheet 这类**允许**）；移动端**自己一套设计与原语**，技术方案与桌面同构；**只共享必要逻辑**，不共享样式/UI。
    - **执行方案（唯一）**：`docs/MOBILE-UI-REDESIGN.md` —— 三层范围 · **IA 冻结清单** · 归属基线 · `mb-*` 前缀 · **皮肤取值表**（39 个语雀语义槽映射 + 几何档位 + 偏离项 + 交互形态清单）· **P0–P7 任务书** · 护栏与验收。
    - **长期判据**：`docs/MOBILE-TECH-STACK.md` §九（三层拆解 + 不变量）；**逐项归属基线**：`docs/MOBILE-DESKTOP-DECOUPLING.md`（桌面产出，**已评审通过，含 4 处修改**）。
    - **关键决策已定**：类名前缀 **`mb-*`**（不用 `md-*`：与 `.md-preview` 撞族）· 令牌名沿用 `--lake-*` 但**取值由移动端 `src/mobile/theme/**` 定义** · **只有 `+` 号用绿 `#00B96B`**，其余强调色走主题色（**对语雀的显式偏离项**）· 深色做、暖色暂不做。
    - **起点 = P0 立护栏**（`mobileIndependence.test.ts` + `mobileLayers.test.ts`，**允许红、基线只许降**）。
    - **参考仓**：`/Users/admin/file/local-lake/yuque-re/`（语雀逆向证据仓，**取值与交互形态参考**，非布局基准；产物**不要**复制进本仓库）。
## 4. 关键坑（长期有效）

### 同步 / 数据
- **`purged_at` 不是永久墓碑**：前缀删除成功后会被 `markPurgeSynced()` 清空；永久判定看 `deleted_notes` 墓碑（folder 看 `node_type='folder'`）。
- **purge 必须无条件写墓碑**：`notes` 行缺失时从 `tree_nodes` 兜底；漏写会导致云端复活成不可见文档。
- **manifest.assets 永远全量声明**：上传差集只决定 PUT，不能裁剪声明；否则他端 GC 会误删在用资产。
- **资产存在性只看远端清单差集**，禁止逐对象 HEAD 和本机持久缓存；下载侧用实扫 size+sha256 判本地复用。
- **软删 = 移入回收站笔记本**；`deleted:true` 仅用于 purge 墓碑。混合两者会破坏恢复和删除传播。
- **任何打开文档入口先判 `isGoneNote()`**：回收站/已 purge 文档必须只读并显式提示，绝不允许静默丢保存。
- **静默丢弃用户输入是最坏失败**：拦截保存必须有可见原因和出口。
- **S3 并发峰值 ≤8**：正文 2×资源 4，不要为吞吐继续加。
- **Manifest V1 重置不是兼容模式**：只读写 `{1}`，所有端一起升级；旧 `sync.ts` 已删除。

### 渲染 / UI
- 浮层列布局的固定区用 `flex: 0 0 auto`，否则内容会被列表盖住。
- **表格行里的长文本会撑开 `table-layout: auto` 的列宽**（260929 实测）：多维表分组头是 `<tr>`，长分组值把**表头首列撑到 482px**、记录行仍 80px ⇒ thead/tbody 列错位（用户报的「错位」）。表格里要放"不该影响列宽"的内容，把它**移出流**（`.bt-group-inner` 绝对定位 `inset: 0`），列宽只交给表头/记录行决定；别用 flex/nowrap 直接写在 `<td>` 里。
- **浮层定位禁止用估算高度**（260929）：统一走 `src/hooks/usePopoverPosition.ts`（量真实尺寸 → 下方优先、贴底翻上方 → 夹进视口），垂直口径是 `topMenuPosition.ts` 的 `placeVertical`。历史多处按猜测高度夹 `innerHeight - N`（48/90/300…），贴底就被裁且不翻转；`Overlay` 原语只吃调用方给的 `style`，定位责任在调用点，**新增浮层必须走该 hook**。
- **多维表底栏（`.bt-stat-row`）上沿不是常数**（260929-UI2）：它贴的是**表格视口**底部，横向滚动条会吃掉内容盒高度（实测差 10px，列多时恒有）⇒ 把状态栏钉在它上沿**必须实测**，由 BitableEditor 写 `--lake-bitable-status-bottom`、`chrome.css` 消费（同 sheet 的 `--lake-sheet-status-w` 姿势）。在 CSS 里猜高度必然要么压住底栏、要么离得老远。**在隐藏窗口（CDP 依附）里不能用 `requestAnimationFrame` 做这种实测**：`document.hidden === true` 时 rAF 不触发（本轮踩过，变量永远写不进去）。
- **量这类「贴底栏」位置要取 `position: sticky` 的那个元素（`.bt-stat-row td`），不是它的 `<tr>`**（260929 修「一个数据表有状态栏、另一个没有」）：sticky 挂在 td 上，`<tr>` 仍是 static；内容纵向溢出时 `<tr>` 停在**内容底部（视口外）**，拿它算 `innerHeight - tr.top` 得负值（实测 -231px）把状态栏顶出屏幕；不溢出的空表恰好也贴底所以看着正常。
- 预览切换先 `img.decode()` 再替换，别 `setState(null)` 造成塌陷闪动。
- 改 CSS 先找单一来源和层序；不要靠继续加覆盖层解决。改后跑 `cssLayers` + `ui-metrics`。
- **`src/styles/cssLayers.test.ts` 的基线是硬上限（只许变小）**：`features/bitable/bitableEditor.css` 已顶满 **1081/1081**。新样式一律**新建文件**并登记 `FILES`+`BASELINE`，且**必须由使用它的组件 import**（漏 import 时元素在、样式空，很难发现）。
- `content-visibility`/`contain` 不要加到 Lake 引擎层。
- 内核/第三方 inline style 是唯一允许更高层覆盖或 `!important` 的例外，且要写理由。
- 多 tab keep-alive 下，CDP 查询必须过滤可见 tab（`.bitable-editor:not(.fn__none)`），否则会命中隐藏编辑器。
- **`HoverPopover` 的悬停监听只在「挂载时」读一次 `anchorRef.current`**（`Overlay.tsx` 的两个 effect 依赖里没有锚点元素）⇒ 锚点元素会在**不重挂**的情况下被换掉时（同一组件在"有链接 ↔ 纯文本"两种形态间切换），监听仍留在**已移除的旧节点**上，表现为"悬停再也不弹"。解法 = 让浮层在锚点变化时重挂（`key` 随形态/失效态变），**不要在组件外用 ref 硬改**。261008 引用卡踩到。
- **横向 tab 一律用 `kit.css` 的页签原语 `.ln-tabs`**（260929 用户在多方案对比里选定「B 墨线 + 计数徽标」：文字 + 选中项变强调色 + **与文字等宽**的 2px 下划线压住容器的 1px 分隔线；数量放 `.ln-tabs__count` 徽标；右侧动作放 `.ln-tabs__action`）。结构 = `.ln-tabs > .ln-tabs__track[role=tablist] > .ln-tabs__item[role=tab][aria-selected]`；**已全量落地**：关联选择器、回收站、历史面板、表单编辑·预览。`.seg` / `.seg__item` 只剩「取值选择 / 图标型开关」（设置页主题三选一、小记列表·卡片版式），**不要再拿它做横向 tab**。

### 多维表（自研）
- **图片预览范围 = 单个单元格**：两列图片就是两类，绝不跨列/跨行合并；表格/记录详情/表单/看板缩略图都只预览"本格"，画册只预览"封面字段该行那一格"。
- **磁盘名绝不外显、也绝不可编辑**：`uploadResource` 对图片只回**磁盘名**（main 侧忽略请求名）、对附件回**清洗后的原始文件名**；凡把响应 `filename` 当展示名的地方都会显示成 `17xxx_ab12cd34.png`。展示名必须用**用户原始文件名**，并有统一守卫（`bitableAttachments` / `buildAttachmentPreviewItem`：缺展示名或本身就是落盘名 → 中性文案）。
- **落盘名是随机唯一**（`buildAssetFilename` = 13 位毫秒 + 8 位随机 hex），全链路**无内容去重** ⇒ 同一张图上传两次必得两个文件，不会出现"多条引用共用一份文件、删一条把别人删没"。
- **系统时间字段（创建/修改时间）必须走记录级取值口径 `bitableFieldValue(record, field)`**：它们的值不在 `values` 里；筛选/排序/分组任何一处直接读 `record.values[field.id]` 都会得到 `undefined`（表现是"排序等于没排、筛选全空"）。展示走 `bitableFieldText`（到分钟）。
- **文档图片预览列表必须取正文**：编辑态开着虚拟渲染 + `cardLazyInit`，视口外卡片不在 DOM 里 ⇒ `querySelectorAll("img.ne-image")` 会少图、切不动；内核这个构建 `allowClickToMaximize`/`previewImgs` 不可用，列表用 `extractImagesFromContent`（正文解析）。
- **只读（锁定/回收站）必须封死所有写入口**：包括视图配置下拉、视图重命名、看板配置等"非单元格"的写入点（本轮修过泄漏）。
- **表格里的 `th` 默认是 `text-align: center`**（浏览器 UA 样式）：字段头靠 `.bt-th-inner { justify-content: flex-start }` 才左对齐；表尾「新增字段」那格 `.bt-th-add` 原先没有规则 ⇒ 加号被甩到**空白区正中央**（260930 用户报「不要总是居中」）。另外 `.bt-grid th { padding: 0 }` 是 (0,1,1)、裸类名 (0,1,0) **压不过** ⇒ 改这一格要写 `.bt-grid th.bt-th-add`。它同时是「吸收表格剩余宽度」的自动宽度格：**只对齐内容、别给固定宽度**（给了会把剩余宽度摊给数据列、把列宽撑开）。
- **不要用 `el.select()` 去「让用户直接覆盖输入」**（260930）：选项编辑给新行 `focus()+select()` 想省一次全选，结果屏幕上就是**一块系统蓝底**（用户：「为什么会有蓝色的底色」）。要「键入即新值」就让输入框**本身是空的**（默认名放 `placeholder`，保存时兜底），别用选区做交互暗示——选区是系统配色、不受我们的令牌控制，也没法只对它隐藏。`focusCell`（表格单元格键盘导航）仍保留 `select()`：那是网格里既有约定的「落到某格即覆盖」，与选项编辑不是同一个语义。
- **多维表列宽：`table-layout: auto` 下 `<col style="width">` 只是「至少这么宽」**（260930 用户：「所有的列都是根据内容长度算的左右宽度，我需要能自由设置」，附件 chip 实测把 180 撑到 413）。真正卡住列的是**每个格子的 `max-width`**（按列写行内 —— 宽度来自正文数据，CSS 无法按列取值；`<col>` 上的 max-width 被忽略，`contain: inline-size` 在 table cell 上同样无效）。改列宽相关的样式时**四处都要带**：表头 `th`、记录格 `td`、分组统计格、底栏统计格 —— 漏一处就被那处的长内容重新撑开。表尾「新增字段」那格是**吸收剩余宽度**的自动列，不要给它 max-width。
- **行高必须与内容无关**（260930 用户：「不能为了展示内容而自动扩大行高。例如日期缩短了就会导致换行，而行高变大」）：`td` 上的 `height` 只是最小值，**内容一折行行高就涨**（实测日期列 80px 时 36 → 48）。所以 `.bt-grid th/td` 统一 `white-space: nowrap`（永不折行），装不下由各自的 `text-overflow: ellipsis` / 裁切处理（日期/时间格在 `.bt-date-trigger > span` 上省略；文本格靠 `input` 的 `text-overflow: ellipsis`；chip/缩略图类没有省略号语义，就是裁切）。`overflow: hidden` 在 table cell 上**不裁剪**（Chrome），别指望它。
- **附件「文档类型图标」没有现成的内核图标可用**（260930 用户问「我们是否有对应的图标样式可以使用」——**没有**）：内核 sprite 实测 **325 个 symbol，无一个 file/pdf/doc/ppt 系**（只有 `icon-card-mention-doc`）；云端那套彩色「页」图标属于**语雀 App 自己的 sprite**，不在 kernel bundle 里（同 §2 的 `note-*` 图标问题）。⇒ 用**自己的图标库 lucide-react**（全站同一套线性图标）按类型分色，类型判定收敛到 `src/core/assetNaming.ts` 的 `fileKindOf()`（单一事实源，桌面/移动端共用），颜色新增 `--lake-file-*` 令牌（只在 `themes/base.css`，内容/品牌色不随主题分叉）。`hover 名称气泡 = kit 的 .ln-tip 表面 + usePopoverPosition 定位`（`position: fixed` ⇒ 不被 `.bt-grid-wrap` 的 overflow 裁掉）。**附件字段与图片字段就此分叉**：`attachment` = 类型图标（不显示名称/缩略图）、`image` = 缩略图（该字段的语义就是看图），分叉点是 `AttachmentCell` 的 `imageOnly`。

- **样式「收编到原语」时，必须把 feature 层里那份声明删掉**（260930 大统一踩到）：层序是 `@layer … kit, shell, feature, overlay …`，**kit 层低于 feature 层** —— 只在 JSX 挂上 `.ln-iconbtn`/`.ln-menu__item` 而不删掉 feature 文件里的同名视觉声明，旧的那份照样赢（同选择器比层序）。正确姿势 = 原语给「盒子/圆角/配色/状态」，feature 只留**本处特有**的布局（绝对定位、`visibility`、卡片上的白底药丸等）。
- **正文有 32 MiB 上限**（260930 压测实测）：saveNote 超过即 LAKE_IPC_CODE:INVALID_INPUT「正文不能超过 32 MiB」。因此 50000×50（250 万格）根本存不下去，不是渲染慢的问题。
- **网格是全量 DOM 渲染、无虚拟化**（260930 AR04 压测，真实 Electron）：DOM ≈ 8.5 个/格；目标 5000×20 打开 12.4s / 84.8 万节点 / 395MB 堆 / 首次点选 2.25s；10000×20 → 24.8s / 169 万 / 1.34GB；20000×50（100 万格）200s 内未渲染完。支持 5000 级规模前需要行虚拟化/渲染策略。压测工具 scripts/bitable-stress.mjs；CDP 依附窗口隐藏，量不到 FPS，只能量挂载/DOM/堆/交互延迟。

### 工程 / 环境
- Node 必须 24；better-sqlite3 是 Electron ABI，系统 Node 不能替代运行时。
- 改 `electron/**` 或 `src/core/**` 会触发 Electron 重启；验证前确认 CDP 端口连的是新实例。
- Vite dev server 必须长驻；`nohup` 起的进程会随会话回收。
- 杀 Electron 只按唯一 CDP 端口精确定位 PID；禁 `pkill -f Electron`、`killall`。
- DSH 宿主里启动仓库 Electron 要 `env -u ELECTRON_RUN_AS_NODE`；**跑 CDP 验收还必须加 `--no-sandbox`**（否则 Chromium sandbox 初始化报 `Operation not permitted`，连锁 NetworkService/GPU crashed，实例整体退出；userData/端口本就隔离）。
- 打包版写正式数据目录；试跑必须覆盖 `LAKE_USER_DATA`，发布 smoke 用独立端口。
- **scheme 模式验收前必须 `npx vite build`**（它服务 `dist/`，否则验收的是旧 bundle）。
- **CDP 依附的窗口是隐藏的**（`document.hidden === true`）⇒ `loading="lazy"` 图片不加载；验收图片要临时去掉该属性，别误判成产品 bug。
- **隐藏/被遮挡窗口里不要用「合成鼠标拖拽」做性能验收**（261008 实测教训）：`document.hidden === true` 时 Chromium 对 `Input.dispatchMouseEvent` 的 **`mouseMoved`** 要等到出帧才回包 ⇒ 连**非边界**位置的一次移动都要 ~5s（`mousePressed`/`mouseReleased` 只要 14~18ms）。用它量「拖列宽」会把 1.4s 的真实卡顿量成 46s 的假象。**正确姿势**：改用**同步动作**计价（例如右键列头 →「自动行高」会同步跑完整表重算，`Runtime.evaluate` 的往返时间 ≈ 该同步耗时），或直接在页面里微基准化目标函数。
- **要「仿照云端」时，优先读云端前端资源而不是一个个点 UI**（260929 用户提示，已实践）：`bsk evaluate` 里 fetch `performance.getEntriesByType('resource')` 找到 `gw.alipayobjects.com/**/lakex_table_yq.*.chunk.css|.async.js`（CORS 可读），配置表/样式规则直接 grep 就有（如统计项的 types 限制、占位 hover 规则）；点 UI 只用来交叉验证。
- **用户可能与测试实例共用同一个进程/窗口**（260929 用户明确交代）：我起的隔离实例（LAKE_USER_DATA=$TMPDIR/lake-accept + LAKE_RENDERER=scheme）用户会**直接在同一个窗口里看/操作** ⇒ **不要默认 kill 实例、不要 rm -rf 该 userData**（那是他正在看的数据）；只有用户明确说「清理/重建」时才收尾。同理，验证脚本不要顺手删掉自己建的测试笔记。
- **读落盘要轮询**：自动保存有防抖，改完立刻读会拿到旧值。
- **别用 `read` 的输出重写大文件（261008 连踩两次）**：`read` 对长行/大文件会**截断或省略**（实测 503 行的 HANDOFF 只读回 196 行）⇒ 拿它的输出 `write` 回去等于**静默删掉其余内容**。改大文件一律用 `edit` 定点替换；整份回滚用 `git show <commit>:<file> > <file>` 并**立刻 `wc -l` + `grep -c "^## "` 校验**。
- **新增 CSS 文件必须由使用它的组件 `import`（261008 踩过）**：只建文件 + 登记 `cssLayers` 的 `FILES/BASELINE` **不会**让规则进包 —— 漏 import 时"元素在、样式空"，而 `cssLayers`（只数声明）与 `ui-metrics`（只看令牌/颜色）**都照过**；判据只看**产物** `grep -o "\.某类[^}]*}" dist/assets/*.css`。
- **浮层选原语：`.ln-menu` 是"竖向菜单"，`.ln-popover` 才是中性表面（261008 踩过）**：横向动作条挂在 `Menu` 上会拿到 `flex-direction: column`；再写 `flex-direction: row` 压它是**加覆盖**（违背"改单一来源"）——正解是**换回 `Popover`**，本处只留自己的布局（间距）。
- **`Overlay` 的 `surfaceClassName` 是"覆盖"不是"追加"**（源码 `surfaceClassName ?? "ln-menu"`）：传它会把白底/边框/阴影一并替掉（浮层"透明、点不到"）；要加自己的类请用 `className`（源码是 `surfaceClass + " " + className`）。
- **AI 结果回写正文：绝不「纯文本重建原选区」，也不要用 `insertAtSelection` 折叠光标做块级插入**（261005）：只用 `insertAtPosition({id,offset}, "text/markdown", …)` 插新块，原块一个字节不动；`offset` 按模型 `_parent`/`_children` 算（DOM 的「某元素之后」映射少 1）。`applyModelRange` 一类模型选区命令必须走 `kernel.execCommand`（editor 层会抛且被 try/catch 静默吞掉）。详见 `docs/LAKEX-CONTRACT.md` §5.16。

### AI 多模态（261005-MM，长期有效）
- **附件内容跨 IPC 只传引用**（`{noteId, filename}`），字节读取 / 解析只在主进程（`electron/ai/aiContentResolver.ts`）：渲染层 CSP 读不了文件；base64 过 IPC 既翻倍内存又冲垮 20 万字符预算。附件**不落正文、不进 S3 / 同步**。
- **图片 / 文档块只能出现在 `user` 消息**（供应商对 system/assistant 带图直接 400），校验在 `electron/ai/aiChatMessages.ts`。
- **PDF 只能本地抽文本**（DeepSeek 的 file / Files API 只收图片）：`electron/ai/pdfText.ts`（unpdf）；扫描件无文字层 → 明确报错，不静默发空。**Office 与 AI 生图明确不做**。

## 5. 上线与后续建议
1. 多维表专项已收口；后续只从 §3 取项并单独立项，不要恢复已完成的研究/计划文档。
2. 改同步/GC 前先读 `AGENTS.md` 原则 11~13 + `docs/SYNC-PROTOCOL.md` + `docs/S3-GC-DESIGN.md`；写 Lake 正文前读 `docs/LAKE-CONTENT-WRITING.md`。
3. 编辑器/lakex 相关先按 AGENTS §2 的检索顺序查 vendor → 官方文档 → `LAKEX-CONTRACT.md` → 源码字典。
4. 上线收尾的真实环境验收仍待做：空库双端 V1 同步、Android 真机、发布说明（见 §8 与专项之外的 backlog）。

## 6. 环境与命令
```bash
export PATH="$HOME/.nvm/versions/node/v24.18.0/bin:$PATH"      # node 24（别用系统 node 18）
cd /Users/admin/file/local-lake/lake-notes-electron
# 门禁（合并前必过）
npx tsc --noEmit && npx vitest run && npx vite build && npx vite build -c vite.mobile.config.ts
node scripts/ui-metrics.mjs && npm run check:core && git diff --check
# 开发（CDP 9222；改主进程/src/core 文件会重启 Electron 并可能命中 GPU 崩溃，见 §4）
npm run dev                 # = vite --host 127.0.0.1 --port 1421（vite-plugin-electron 拉起 Electron）
# 压测（opt-in，默认被 npm test 跳过）
LAKE_RUN_BENCHMARK=1 npx vitest run src/core/syncEngine.benchmark.test.ts
LAKE_RUN_BENCHMARK=1 npx vitest run src/core/syncEngine.dualStress.benchmark.test.ts
# 多维表真实端压测（隔离 userData/CDP，跑完自清；见专项 §17.12）
STRESS_SIZES="5000x20,20000x50,50000x50" node scripts/bitable-stress.mjs
# Tier B 真实云（隔离前缀+自动清理；凭证仅环境变量，勿入库）
LAKE_RUN_BENCHMARK=1 LAKE_STRESS_S3_ENDPOINT=... _REGION=... _BUCKET=... _AK=... _SK=... npx vitest run electron/syncStress.benchmark.test.ts
# 云端对象查看
node scripts/s3-ls.mjs --count | --note <id> | --prefix <prefix>
node scripts/lake-roundtrip-check.mjs --note <id>   # 对拍「这篇一打开会不会被内核改写」（只建临时文档，退出码 1=会被改写）
```
- **UI 实测姿势（本轮全程使用，推荐）**：
  ```bash
  # 1) 必须先构建（scheme 模式服务 dist/）
  npx vite build
  # 2) 隔离开一个实例（独立 userData / 资源端口 / CDP 端口）
  env -u ELECTRON_RUN_AS_NODE LAKE_RENDERER=scheme LAKE_USER_DATA="$TMPDIR/lake-x" \
    LAKE_ASSET_PORT=19890 ./node_modules/.bin/electron --disable-gpu --remote-debugging-port=9230 .
  # 3) 取 page target，用 Node 24 内置 WebSocket 直驱 Runtime.evaluate / Page.captureScreenshot
  curl -s http://127.0.0.1:9230/json/list
  ```
  详见 `docs/CODEX-GUIDE.md`。注意 §4 的三条坑（重建、可见元素、lazy 图片）。
- 日志：A `~/Library/Application Support/lake-notes-dev/logs/lake-notes.log`；B `$TMPDIR/lake-device-b/logs/lake-notes.log`。数据目录见 `AGENTS.md §5`（**正式数据禁碰**）。
- 安卓/模拟器：全部命令与环境见 **§8**。

## 7. 文档索引（`docs/` 按需查）
- **契约/规格（单一来源）**：`STORAGE-LAYERS.md`（存储分层 + 设备本地契约）· `SYNC-PROTOCOL.md`（同步协议 V1 重置）· `S3-GC-DESIGN.md`（存储/删除 GC）· `HISTORY-DESIGN.md`（历史快照）· `TRASH-NOTEBOOK-DESIGN.md`（回收站）· `QUICK-NOTES-SPEC.md`（小记）。
- **内核**：`LAKEX-CONTRACT.md`（闭源 lakex 行为契约 + 速查表，编辑器相关**先读**）。
- **表格（usheet / Univer）**：`USHEET-UPGRADE.md`（内核触点清单 + 依赖升级 playbook + 路线图；配套 `src/features/usheet/usheetKernelContract.ts` · `univerContract.test.ts` · `scripts/usheet-kernel-probes.mjs`）。
- **正文写入（写 `.lake` 前必读）**：`LAKE-CONTENT-WRITING.md`（约定 + 反例 + 校验判据；配套 `src/core/lakeDocForm.ts` 与 `scripts/lake-roundtrip-check.mjs`）。
- **指南**：`CODEX-GUIDE.md`（CDP 驱动真实 Electron，动手前必读）· `DEVELOPMENT.md` · `ARCHITECTURE.md` · `TROUBLESHOOTING.md` · `RELEASE.md` · `SYNC-RELIABILITY-VERIFY.md`（数据完整性门禁）。
- **移动端**：`MOBILE-TECH-STACK.md`（当前唯一移动端架构规格；旧 `ANDROID-TECH-SCHEME`/`ASSET-URL-MOBILE-PLAN` 已删）。
- **UI/工程规范**：`scripts/css-audit/README.md`（样式层）· `PANEL-CONTRACT.md`（面板几何/层序契约）· `UI-PRIMITIVES-PHASE1-260926.md`（浮层原语）。
> 历史审计/研究/计划（`*-AUDIT`/`*-REVIEW`/`*-PLAN` 等）已删除（git 历史可查）；权威待办以本文件 §3 为准，移动端以 §8 为准。

## 8. 移动端速查（完整端）

> **「移动端架构重做」已结案（261010）**：核查确认本仓库**不存在重做**（无新分支/worktree/未提交改动）⇒ 不立项重设计。
> 原「重构输入」三问的答复：① F16 **已按当前架构修复**（写域/维护域分离，见 §0 本批）；② 走查装置**必须接进验收流程**（`check:mobilesnap` + 设备级截图）；
> ③ `window.lakeNative` **保留并改为从实现派生**（49 = 47 bridge + 2 附带，护栏 `lakeNativeContract.test.ts`）。
> 移动端规格与硬约束现在只在 `docs/MOBILE-TECH-STACK.md`（含「每层用哪种复用方式」判据、互斥域、能力矩阵、未结项）。

> **261009 B2（进行中）** 移动端逐页走查装置：scripts/css-audit/mobile-walkthrough.mjs（配合 drive.mjs 9335）。
> 覆盖：首页（知识库 / 小记 / 书架）、笔记本工作区、各文档（doc / usheet / bitable / board）、设置抽屉九页；每屏「截图 + 探针」
> （越界 / 截断 / 对比度 / 小点击目标 / 整页横向溢出）。
> **⚠️ 关键工具坑（261009 实测）**：**Android WebView 的 CDP Page.captureScreenshot 抓不到 GPU canvas 层** ——
> usheet 网格在页面截图里整片空白，但同屏画布 toDataURL() 有完整内容、设备级 adb screencap 也完全正常
> ⇒ **移动端截图一律用设备级 screencap**（脚本里已改）。别据 CDP 截图报「表格空白」这种假缺陷（本轮差点误报，A/B 撤掉表格补丁后同样空白才定位到是截图问题）。
> 已知观察（未改）：首页顶部 .mobile-htab 命中区 36×25 / 52×25（父容器 .mobile-home-tabs 仅 25 高），低于 48dp 建议；
> 抽屉态下「侧栏右键菜单（属性 / 历史版本）」不在同一可见层 ⇒ 移动端这两个入口需换驱动方式（本轮未完成）。
> **已修（261009 B2）**：小记写作卡的两字按钮（取消 / 保存）标签折成两行、按钮被撑到 62px 高（实测 57×62）——
> `.mobile-qn-btn` 加 `white-space: nowrap`（mobile.css），修复后 58×38 / 75×37；`check:mobilesnap` 6 态 0 差异。
> **已定位并修复（261009 B2 第二轮）**：小记编辑器在**冷启动后作为第一个内核消费者**时渲染成「大图标 + 原生 `<input type=file>`（Choose File / No file chosen）」——
> 根因＝**内核样式表缺席**：桌面由 `styles/index.css` 的 `@import "@dlient/lakex-doc-react/style.css"` 全局引入，移动端入口没引、此前只有 `mobile/editor/DocumentEditor.tsx` 引；
> 于是"先开文档"时正常（CSS 已随文档编辑器模块加载）、"先开小记"时内核图标按原生尺寸铺满。因果实测：坏态 `ne-icon` 规则 **0** 条 + 7 个 >60px 的 `ne-icon-symbol`；开过一次文档后 **76** 条、图标不再超大。
> 修法：在**移动端**写作卡模块 `mobile/home/QuickNoteComposer.tsx` 引同一份 `@dlient/lakex-doc-react/style.css`（引在移动端模块而不是共享的 `QuickNoteEditor`：后者会把 CSS 也打进桌面入口，实测 app-css 1.79MB → 3.07MB、超 2MB 预算）。
> 验证：重装后冷启动 → 小记 → 新建小记（首个内核消费者）`ne-icon` 规则 76 条、大图标 0、截图渲染正确；桌面 app-css 回到 1,791,242（预算 exit 0）。
> **装置备注**：force-stop 后 WebView socket 会变，冷启动脚本要先 `emu-cdp.sh` 轮询重连再 `drive.mjs`（本轮已按此跑通）。
> **261009 B2 收尾（覆盖面 + 结论）**：本轮覆盖 = 首页（知识库 / 书架 / 小记）、笔记本工作区（文档树抽屉）、
> doc×2 / 多维表×2 / 表格 / **画板**、文档属性抽屉、历史版本、大纲抽屉、小记编辑器、设置九页、资源管理。
> **画板**是模拟器上原先缺的数据，按本节上面的种子法补了一篇 `移动画板`（`notes.doc_kind='board'` + `emptyBoardBody()` 那份 JSON，
> id=`mobile-board-1`）——移动端 `MobileBoardViewer` 挂载正常（canvas 412×842、空板、底栏「大纲」如预期 disabled）。
> 每屏探针（越界 / 截断 / 对比度 / 小点击目标 / 整页横向溢出）全绿；`check:mobilesnap` **6 态 0 差异**。
> **未覆盖 / 边界（有理由，不是漏）**：① **缩略图** —— 模拟器上没有带图的小记或图片字段数据，且 png/jpg/jpeg 的边界已在本节记录；
> 要看图得先造带图数据（下轮或真机）。② **大纲左滑手势**的运行期驱动没做：门控逻辑（`swipeTargetSide` + `canOpen`）
> 已有单测 `src/mobile/gestureCore.test.ts` 明确断言「表格/多维表/画板没有大纲 ⇒ 左滑作废」；本轮在设备上又量到**同一个 `outlineAvailable` 判据的两侧**：文档（无标题文档）底栏「大纲」`disabled=false`、画板与表格 `disabled=true`。运行期用 CDP touch 驱动左滑没做成——壳是 keep-alive（隐藏视图元素仍在 DOM、rect 为 0），我的导航在"从文档回首页"这一步反复选到不可见元素；由于门控已有单测 + 状态侧实测，判定为**价值重叠、不再投入**（真要驱动得先给 walkthrough 的 goHome 加命中测试版可见性判据，那是装置改进、不是产品验证）。
> ③ 真机项（图片 / 附件、键盘安全区、同步后图片加载）仍待真机，与本节「当前剩余验收」合并。

- 正式端：Capacitor Android，包名 `com.lakenotes.mobile`；定位为完整端，桌面红线同样适用。
- 数据在模拟器 App 沙盒，不在 macOS 数据目录；开发可 `adb shell pm clear com.lakenotes.mobile` 重建。
- AVD：`lake_mobile`（Pixel 6 / API 36 / arm64）；SDK 在 `/opt/homebrew/share/android-commandlinetools`。
- Node 24；Android 脚本已内置 JAVA/SDK 环境。

### 常用命令
```bash
export PATH="$HOME/.nvm/versions/node/v24.18.0/bin:$PATH"
cd /Users/admin/file/local-lake/lake-notes-electron
npx tsc --noEmit
node node_modules/vite/bin/vite.js build --config vite.mobile.config.ts
bash scripts/android-build.sh --sync --install
bash scripts/emu-cdp.sh
bash scripts/emu-up.sh
bash scripts/mobile-preview.sh
```

### CDP / 编辑器
- App 重启后 WebView socket 会变化；重新 `adb forward` 后再连 `/json/list`。
- **CDP `forward` 会指向旧 PID 的 socket（261010 本轮踩到）**：App 重启后 `/proc/net/unix` 里**新旧 webview socket 并存**，
  `forward` 若还指着旧名，表现为 **`/json/list` 空** 或 node 侧 **`fetch failed: other side closed`** —— **不是 App 崩**（进程 `pidof` 仍在）。
  修法（按**当前** PID 精确重转）：`PID=$(adb shell pidof com.lakenotes.mobile | tr -d "\r"); adb forward --remove tcp:9335; adb forward tcp:9335 localabstract:webview_devtools_remote_$PID`。
- 活跃 Lake 实例暴露为 `window.__mobileEditor`；命令用 `renderer.execCommand`。
- 有效命令：`bold`、`unorderedList`、`orderedList`、`taskList`、`quote`、`code`、`underline`、`italic`、`insertLink`、`hr`、`color`、`style("p"/"h1"/"h2")`、`undo/redo`。
- 无效/易错命令：`insertUnorderedList`、`formatBlock`、`heading`、`strike`、`justify*`、`clearFormat`、`fontsize`。
- 工具栏按钮必须 `onMouseDown preventDefault`，否则抢焦点导致命令 no-op。
- 面板与 IME 必须用 visualViewport 实测状态互斥；不要跟内核异步重聚焦赛跑。
- 真机可能是 edge-to-edge，模拟器是 adjustResize，二者都要覆盖。

### 多维表只读（260929 补齐 + Android 模拟器验收）
- 单元格按字段类型给**只读控件**（不再是裸文本）：布尔=禁用复选框、链接=`<a target="_blank">`（外部 origin 走系统浏览器）、评分=5 星、进度=条+百分比、关联=目标记录主字段 chip、附件/图片=缩略图、单选/多选=色块；其余走 `bitableFieldText`（系统时间到分钟）。
- 非 grid 视图（看板/画册/日历/未知类型）仍走「明确提示 + 表格只读」，不空白、不改数据。
- **验收姿势**：`android-build.sh --sync --install` → `emu-up.sh --no-window` → `emu-cdp.sh 9335` → 连 `http://127.0.0.1:9335/json/list`（Node 内置 WebSocket 直驱 `Runtime.evaluate`）。
- **造数据**（模拟器是全新安装、库里 0 条）：DB = `databases/lake-notes-mobileSQLite.db`；`notes` 表写 `doc_kind='bitable'`、`content=<正文 JSON>`、`parent_id='notebook-personal'`（**必须挂到笔记本**，否则首页点开会提示「未找到该文档所属笔记本」）。改法：force-stop → `exec-out run-as … cat` 拉出 db/wal/shm → python sqlite3 写 + `PRAGMA wal_checkpoint(TRUNCATE)` → push 回 + 删 -wal/-shm → 重启 App。
- **点开笔记必须用真实点按**：首页最近文档是 `<button class="doc-card">`，CDP 里 `el.click()` **不触发**导航（页面不动），要用 `Input.dispatchMouseEvent` 在元素中心 mousePressed/Released。
- 已验收（模拟器 lake_mobile，Pixel 6 / API36）：`移动多维表`（全字段）断言 bool=[true,false] 且 disabled、链接 href/target 正确、评分星数=[4,2]、进度=60%/0%（条宽一致）、关联 chip=[目标A,目标B]/[目标B]、创建时间到分钟、只读徽标；`移动看板表` 显示「「看板视图」桌面已支持，移动端暂以表格只读展示。」

### 261008 续 · 本轮三修（移动端）

- **大纲手势按文档类型收敛**：表格 / 多维表 / 画板**没有大纲**，左滑不再拉出空面板 —— `usePanelDrag` 新增可选 `canOpen(side)`（只约束「打开」，已展开的仍可滑走关闭），判定走共享纯函数 `gestureCore.swipeTargetSide`；口径 = `(active.kind ?? "doc") === "doc"`（与顶栏「编辑」按钮同一条），切到无大纲类型时自动收起已展开的大纲抽屉，底栏「大纲」按钮同时置灰。**右滑开目录不受影响**。
- **「更多 → 新建文档」建好不跳转（真 bug）**：`NotebookWorkspace` 的组件 key 是 `notebookId`，同一笔记本内再指定文档**不会重挂载**，而「初次进入」那段 effect 有 `autoOpenedRef` 守卫 ⇒ 新的 `initialNoteId` 被忽略（现象：文档已进 DB、界面不动）。修法 = 加 `handledInitialRef`，在 `initialNoteId` 变化时显式 `openTab`（并按 `initialMode` 决定是否进编辑态）。
- **`emu-cdp.sh` 取错 WebView socket**：socket 名带的是**宿主进程 PID**，App 重启后旧 socket 仍挂在 `/proc/net/unix`，原来的 `tail -1` 会取到旧的 ⇒ `/json/list` 恒空、`check:mobilesnap` 直接报 `no page target`。改为优先按当前 App PID 精确取、取不到才回退，并在转发前 `forward --remove` 清旧映射。
- 门禁：`npm run check:mobilesnap` **6 态 0 差异**；桌面 tsc / vitest 全绿。

### 当前剩余验收
- V1 空库多端同步：创建/编辑/删除/恢复/GC。
- 真机：图片与附件、编辑保存、同步后图片加载、键盘安全区。
- 数据导出/导入、剪贴板粘贴、长文档大纲跳转。
- 缩略图目前仅 png/jpg/jpeg，失败会回退原图。
- ~~多维表只读控件（布尔/链接/评分/进度/关联/时间）~~ 260929 已在模拟器验收；真机复验仍可做。
