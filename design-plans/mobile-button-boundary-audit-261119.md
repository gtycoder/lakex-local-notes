# 移动端按钮边界审计：贴边 / 命中区 / 底部几何专项（261119）

> 角色：**只读审计员**（不改产品代码）；唯一产出 = 本文。
> 用户点单：「设置里的弹窗按钮过分靠下，还有选择便携包之后的按钮也是同样的问题，我没有截图，整体审计一遍移动端按钮的各种边界问题」。
> 配图现场：「设置 → 备份与恢复」的弹窗（「从云端恢复…」按钮块）与便携包导入流。
> 范围：`src/mobile/**` 全部按钮表面（Sheet 底栏 / 对话框按钮组 / 设置行内按钮 / 弹窗内嵌按钮 / 表单动作行 / 悬浮按钮 / 底部 dock·动作条）；对照 `AGENTS.md` §3#14 观感红线、`docs/MOBILE-DESIGN.md`（44 Rule / Sheet 两件契约 / topChrome 契约）。
> 取证口径：CSS 几何算术 + 代码 file:line；**本轮无设备实测**（与 mobile-ui-jank-audit-261119 同一口径，模拟器 CDP 未起），jsdom 可断言项已逐条给出验证法，设备级留给修复流补截图。

---

## 1. 结论摘要

1. **用户点单的「按钮过分靠下」是同一几何根源的一类：Sheet「底栏账」有三套并存、其中一套是 0 内距 0 安全区**。底部弹窗的按钮区存在三种互不相认的几何：
   | 通道 | 底内距账 | 安全区 | 用例 |
   | --- | --- | --- | --- |
   | `.mb-sheet__foot`（契约，floating.css:92） | 8 / 16 / **20 + safe** | ✓ | SheetFooter 及 11 个标准面板 |
   | 裸 `.mb-set-block__actions` 当 footer（kit.css:359） | **0 / 0 / 0** | **✗** | 便携包导入确认（现场②）、更新中心弹窗 |
   | `.mb-actionsheet`（floating.css:105） | 8 / 8 / **8 + safe** | ✓（safe=0 时贴边） | 全部 confirmMobile 确认框（现场①的「从云端恢复…」确认） |
   另有两套域内平行账：`.mbt-drawer__foot`（**无 safe**，mobileBitable.css:936）与 `.ai-sheet__foot`（10/16/16+safe，ai.css:107）。**「过分靠下/贴边」= 0 内距那套**（按钮底缘 = 屏幕底缘，手势条直接压在按钮上）；**「留白过大」= 标准 foot 与 body 的双叠账**（见 B-3）。
2. **同一根因链的放大器 = 261110「Sheet 固定半屏（50dvh）」**（floating.css:41，用户定稿不改）：短内容弹窗的 body 被 flex:1 撑满，按钮被压到面板底、与内容之间隔着「body 底内距 16/20+safe + 8 + 发丝线」的大空档 ⇒ 「按钮沉底 + 留白过大」在同框出现。
3. **44 触控档有一类系统性缺口**：`.mb-btn--sm` / `.mb-iconbtn--compact` 视觉 36 但**没有扩区规则**，MOBILE-DESIGN 261105 写的「视觉 36px、有效命中 44px」承诺未落地；再加散点 28–40px 小目标（sheet 头关闭钮 40、数据表抽屉 ⋮ 28、toast 关闭 28）。扩区机制本身已存在（`.mb-tap`，kit.css:332）⇒ 修法是一次收口，不是一条一补。
4. **边界让位（键盘/dock/手势条）两条登记项**：输入类 Sheet 的底栏按钮被键盘盖住是既有契约（useKeyboardStableSheet「覆盖而不推动」+ 261117「点标题收键盘」出口），不改、只登记；编辑 dock / 表格 dock **不消费底部安全区**（与胶囊、首页 Dock、ink 工具坞不同源）——需设备实测定级。
5. **严重度分布**：P1×3（B-1/B-2 贴边、B-7 命中缺口类）、P2×8、无 P0。全部为只读登记 + 统一修法建议；`mobile-ui-jank-audit-261119` 的 F-G（子菜单安全区）已修，不重复。

---

## 2. 两个已知现场的根因链

### 现场①「设置里的弹窗按钮过分靠下」（截图点：设置 → 备份与恢复，「从云端恢复…」按钮块的弹窗）

设置内的弹窗按钮区不是一条账，根因链按用户实际打开的弹窗分三支，**同一根源 = MobileSheet footer 槽无契约 + 底栏几何三套并存**：

1. **主链（按钮沉底贴边）**：`MobileSheet` 的 `footer` prop 是「原样挂到 `.mb-sheet` 底部的 flex 子项」（src/mobile/ui/MobileSheet.tsx:92-93 契约注释、:173 渲染），**不强制包 `.mb-sheet__foot`** ⇒ 业务方拿页面级的 `.mb-set-block__actions`（kit.css:359：flex+wrap+gap8，**零内距、无发丝线、无安全区**）当 footer 用 ⇒ 按钮行底缘 = `.mb-sheet` 底缘 = 屏幕底缘（`bottom: 0`，floating.css:38）⇒ 手势条（safe ≈ 24–48px CSS，tokens.css:293 + safeAreaInsets.ts:33-36）直接盖在按钮下半截 ⇒「过分靠下」。现场同页的便携包导入确认就是这条（见现场②）；设置里同型还有更新中心弹窗（B-2）。
2. **副链（留白过大）**：标准 `.mb-sheet__foot` 弹窗的算术叠加 —— body 底内距 `16px/20px + safe`（floating.css:78 / :85）**与** foot 底内距 `20px + safe`（floating.css:92）**各消费一次安全区**，中间再叠 `space-md 8px` + 发丝线 ⇒ 短内容时「最后一个内容 ↔ 按钮」空档 = 20+safe+8、按钮下方 = 20+safe，在固定 50dvh 面板里两个空档都很显眼（B-3/B-4）。
3. **旁链（确认框档）**：「从云端恢复…」若走 confirmMobile（SettingsDrawer.tsx:212-217）⇒ `.mb-actionsheet`（ConfirmDialog.tsx:61-75），底距 = `8px + safe`（floating.css:105）——safe=0 环境（web 预览 / 部分 ROM env()=0 且原生注入未覆盖）只剩 8px = 贴边；与 `.mb-sheet__foot` 的 20px 档不同源（B-6 族）。

### 现场②「选择便携包之后的按钮」（便携包导入确认/取消）

- **症状**：选完包弹出的 Sheet（「从便携包导入 / 从手机快照恢复」）里「取消 / 覆盖本机并导入」按钮过分靠下、贴屏幕底。
- **根因链**：`PortableImportSection.tsx:96-111` 用 \`<div className="mb-set-block__actions">\` 组按钮、`:139` 经 `footer=` 挂进 MobileSheet ⇒ 走的是「0 内距 0 安全区」那套账（kit.css:359）⇒ 按钮底缘距屏幕底 **0px**，无 `--mobile-bottom-safe-area`、无 `.mb-sheet__foot` 的发丝线与 8px 上内距（floating.css:88-95 契约被绕过）⇒ 沉底 + 与内容粘连。与现场①主链**同一根源、同型**。
- **加重项**：确认按钮「覆盖本机并{导入|恢复}」用裸 `mb-btn--danger-text`（PortableImportSection.tsx:107，kit.css:64 纯红字无框），视觉权重比「取消」（`mb-btn--secondary` 中性框，:106）更弱 —— 主次倒挂（B-9）。
- **同型清单**：`UpdateCenterSection.tsx:209-240`（发现新版本/更新已下载弹窗 footer）逐字同款。

---

## 3. 逐条发现

> 严重度口径：**P0** = 数据/崩溃级；**P1** = 主路径高频、用户点单直指；**P2** = 次要路径/低频/潜伏/微差。

### B-1【实锤·P1】便携包导入确认按钮 0 内距沉底贴边（现场②）

- **表面**：设置 → 备份与恢复 → 从桌面迁移 →「选择便携包…」→ 选包后的确认 Sheet。
- **症状**：「取消 / 覆盖本机并{导入|恢复}」底缘贴屏幕底（0px），被手势条压住；与上方内容之间无发丝线、无间距。
- **根因**：`src/mobile/settings/PortableImportSection.tsx:96-111`（footer = 裸 `.mb-set-block__actions`）+ `src/mobile/ui/MobileSheet.tsx:173`（footer 原样挂载、不包 foot）+ `src/mobile/kit.css:359`（`.mb-set-block__actions` padding 缺省 0）。契约本应走 `src/mobile/floating.css:88-95` 的 `.mb-sheet__foot`（8 / 16 / 20+safe）。
- **修复方向**：footer 换成 `SheetFooter`（`src/mobile/ui/SheetFooter.tsx:59-66`）或至少包一层 `.mb-sheet__foot`；禁用/忙态语义（`disabled={!staged}` / `导入中…`）照旧。
- **验证法（jsdom）**：仿 `src/mobile/ui/SheetFooter.render.test.tsx` 渲染 `PortableImportSection` 触发 Sheet，断言 `footer` 子树根节点含 `mb-sheet__foot` 类（当前红）；再断言该节点 `getComputedStyle().paddingBottom` 非 `0px` 且类声明里含 `var(--mobile-bottom-safe-area)`。

### B-2【实锤·P1】更新中心弹窗 footer 同型（设置弹窗·B-1 的复制粘贴件）

- **表面**：设置 → 更新中心 →「发现新版本 / 更新已下载」Sheet 的按钮行。
- **症状**：同 B-1——「下载并安装/取消下载/安装/重试下载 / 前往发布页 / 忽略此版本」整排贴屏幕底、无安全区。
- **根因**：`src/mobile/settings/UpdateCenterSection.tsx:209-240`（footer = 裸 `.mb-set-block__actions`）。同一放大器：3 按钮时靠 `flex-wrap`（kit.css:359）换行，换行后第二行仍在 0 内距容器里。
- **修复方向**：同 B-1，迁 `SheetFooter`（多按钮走 children 自定义布局也必须外层 `.mb-sheet__foot`）。
- **验证法**：同 B-1 的 footer 类断言，对 `UpdateCenterSection` 的 Sheet 逐状态（available / downloading / downloaded / error）跑一遍。

### B-3【实锤·P2】`.mb-sheet__body` 与 `.mb-sheet__foot` 双叠底内距/安全区（留白过大）

- **表面**：所有「body + foot」并存的标准 Sheet（日期选择、改名、移动到此处、批量打标签、资源清理、表单视图、签名板等）。
- **症状**：短内容弹窗里「最后一行内容 ↔ 按钮」之间空档过大（20+safe+8 + 发丝线），按钮下方又留 20+safe；safe=48 的设备上两个空档各 ≈68px，在 50dvh 面板里占掉近 1/3。
- **根因**：`src/mobile/floating.css:78`（body `padding-bottom: calc(16px + safe)`）、`:85`（--form `calc(20px + safe)`）、`:92`（foot `calc(20px + safe)`）——**安全区被 body 与 foot 各消费一次**；foot 已在 body 之后，body 的底内距（含 safe）只剩「垫高空档」的作用。
- **修复方向**：有 foot 时 body 不再叠 safe（一条规则收口，例如 `.mb-sheet:has(> .mb-sheet__foot) .mb-sheet__body` 降底内距为纯间距令牌），或 foot 底内距降档——**二选一，只动一处**；数值建议保留 foot 的 `20+safe`（贴边口径与首页 Dock/胶囊同源），body 侧退回 8–12px 纯间距。
- **验证法（jsdom 算术）**：注入 floating.css 后读 `.mb-sheet__body` / `.mb-sheet__foot` 的 padding 声明，断言「两者之和的 safe 项计数 = 1」（当前 = 2，红）；设备侧在 safe>0 的 AVD 上量「末行内容 y → 按钮 y」的空档值。

### B-4【登记·P2】固定 50dvh 弹窗把短内容的按钮压到面板底（261110 定稿的观感副作用，不改高度策略）

- **表面**：内容不足半屏的 Sheet（便携包确认、更新弹窗、改名、日期选择……）。
- **症状**：按钮在面板底、与标题/内容隔一大段空白 —— 用户体感即「过分靠下」的一半成因。
- **根因**：`src/mobile/floating.css:41`（`height: 50dvh` 固定，261110 用户定稿「内容少也不缩成小条」）+ `MobileSheet.tsx:172-173`（body `flex:1` 撑满、foot 钉底）。
- **修复方向（保守）**：**不改 50dvh 定稿**。B-1/B-2/B-3 修完后（按钮不再贴边、空档回到 8–20px 档）此项大概率不再可感；若用户仍报「离内容太远」，再单独立项谈「短内容时按钮浮到内容末端」，那是产品形态改动、不是本审计可顺手做的。
- **验证法**：修完 B-1/B-3 后同一截图复评。

### B-5【实锤·P2】数据表抽屉底栏缺安全区（`.mbt-drawer__foot`）

- **表面**：多维表 → 数据表抽屉（左滑出）→「新建数据表」按钮行。
- **症状**：底栏 `padding: 8 16 20`、**无 safe** ⇒ 手势条（24px+）盖住按钮下缘（按钮底距屏底 20px < safe）。
- **根因**：`src/mobile/bitable/mobileBitable.css:936`（`.mbt-drawer__foot` 只写了 `--lake-space-xxl` 没写 `var(--mobile-bottom-safe-area)`）；使用点 `src/mobile/bitable/MobileBitableTableDrawer.tsx:74-79`。
- **修复方向**：底内距改 `calc(var(--lake-space-xxl) + var(--mobile-bottom-safe-area))`；或直接并入 `.mb-sheet__foot`（该抽屉不是 Sheet，建议只补 safe 项、保持发丝线样式）。
- **验证法**：CSS 声明断言（规则里必须含 `--mobile-bottom-safe-area`）；设备手势条截图。

### B-6【实锤·P2】第三套底栏几何 `.ai-sheet__foot`（同语义不同账）

- **表面**：AI 资料/发送/配图三个 Sheet 的底栏（AiCorpusSheet.tsx:85、AiSendSheet.tsx:61、AiImageSheet.tsx:112）。
- **症状**：与 `.mb-sheet__foot` 同一「Sheet 底栏」语义但账不同（10 / 16 / **16+safe** vs 8 / 16 / **20+safe**）；同页 body 底内距也只有 8px（ai.css:105），与 body 契约（16/20+safe）不同源——面板间切换时按钮底距跳档。
- **根因**：`src/mobile/ai/ai.css:107-111` 平行实现；`MobileSheet` footer 槽不强制（同 B-1 根源）。
- **修复方向**：并入 `.mb-sheet__foot`（需要自定义排版就传 children，见 SheetFooter.tsx:32 契约）；若保留差异须在 MOBILE-DESIGN 登记理由。
- **验证法**：AI 三面板与任一标准面板的按钮底缘 y 值对比（应同档）。

### B-7【实锤·P1】36px 紧凑档按钮无扩区 —— 44 Rule 的系统性缺口（一类，不是一条）

- **表面**：`.mb-btn--sm`（36 高）与 `.mb-iconbtn--compact`（36×36）的全部使用面：MobileFindBar.tsx:119-121（查找上/下/关闭）、MobileBitableViewConfigSheet.tsx:133/150/260/294（删筛选/排序/分组）、AI 页动作行（MobileAiPage.tsx:249,273-276）、AiSendSheet.tsx:40,56-57、NoteInfoSheet.tsx:123,152、MobileBitableDateField.tsx:66-67（清除/今天）、MobileBitableRecordPage.tsx:43（编辑）、MobileSignaturePad.tsx:347,356、DiaryPage.tsx:288、SearchSheet.tsx:180、UpdateCenterSection.tsx:148,199 等。
- **症状**：有效命中 36（部分宽度也 <44）< `--mb-tap-min` 44；MOBILE-DESIGN「属性操作……视觉36px、有效命中44px」的承诺没有对应 CSS。
- **根因**：`src/mobile/kit.css:70`（`.mb-btn--sm` 只有 min-height 36）与 `:82`（`.mb-iconbtn--compact` 36×36）均**无 ::after 扩区**；扩区机制 `.mb-tap`（kit.css:332-337）已存在但这些类没挂。对照：`.mb-chip::after{inset:-4px 0}`（kit.css:169）、`.mb-switch::after{inset:-8px}`（:350）已做。
- **修复方向（一类一次修）**：在 kit.css 给 `.mb-btn--sm` / `.mb-iconbtn--compact` 补同款 ::after 纵向扩区（36→44，横向不动防相邻命中区互叠，`.mb-chip` 先例）；或统一改挂 `.mb-tap`（改使用处 30+ 处，不如类内一处）。
- **验证法（jsdom）**：CSS 文本断言「`.mb-btn--sm` / `.mb-iconbtn--compact` 存在扩区声明」（regex on kit.css，注意 AGENTS §7#21 正则双反斜杠 + 已知命中样本自证）；设备走查 `mobile-walkthrough.mjs` 的 smallTap 探针应归零。

### B-8【实锤·P2】散点小目标（28–40px，扩区遗漏）

- **表面 / 根因**：
  · Sheet 头关闭钮 **40×40**：`src/mobile/floating.css:75`（`.mb-sheet__head .mobile-icon-btn`，261110 头部变薄时 52→40 后没有补命中）；
  · 数据表抽屉行尾 ⋮ **28×28**：`src/mobile/bitable/mobileBitable.css:942-953` + `MobileBitableTableDrawer.tsx:65`（对照 `BitableSelectControl.tsx:64` 的 `mbt-select__toggle` 已挂 `.mb-tap`，这处漏了）；
  · Toast 关闭 **28×28**：`src/mobile/floating.css:153`；
  · AI 三面板头部「完成」= `mb-btn--sm` 36 高（AiSendSheet.tsx:40 / AiCorpusSheet.tsx:55 / AiImageSheet.tsx:82），头部只有 44 高、无扩区。
- **修复方向**：随 B-7 同一批：`.mb-tap` 或类内 ::after 一次收口（sheet 头关闭钮建议直接回 44 或 ::after 补 4）。
- **验证法**：同 B-7；另加一条静态断言「视觉 <44 的可点类清单 ∪ 挂 `.mb-tap` 的使用处」对账（可做进 `check:mobileui`）。

### B-9【实锤·P2】主次按钮权重倒挂 / 多按钮排布（窄屏、大字号）

- **表面**：便携包确认行（PortableImportSection.tsx:105-110）：破坏性主操作「覆盖本机并{导入|恢复}」= 裸 `mb-btn--danger-text`（无框红字，kit.css:64），比「取消」`mb-btn--secondary`（中性框）更弱；更新弹窗（UpdateCenterSection.tsx:210-239）多按钮无主次（主操作与「前往发布页/忽略此版本」同宽排队，无 grow）。
- **根因**：`SheetFooter` 的 danger 变体走 `mb-btn--primary mb-btn--danger`（SheetFooter.tsx:39，实心红，kit.css:66）——业务手写时没走这档；`.mb-sheet__foot`（floating.css:91）**无 flex-wrap** + `.mb-btn` `white-space: nowrap`（kit.css:42）⇒ 双长标签/动态字号下窄屏溢出（B-11）。
- **修复方向**：破坏性主操作统一 `mb-btn--primary mb-btn--danger`（或 `mb-btn--danger` 红框档）；多按钮面板定一个「主 + 次 + ghost」排布模板（SheetFooter children）；顺序保持「取消左、主操作右」。
- **验证法**：render test 断言 confirm 按钮类名；360px 宽 + 200% 字体缩放的 jsdom/设备截图看是否溢出。

### B-10【登记·P2】输入类 Sheet 的底栏按钮被键盘盖住（既有契约 + 已有出口，不改）

- **表面**：带输入框的 Sheet（改名/新建知识库/S3 迁移码/字段编辑/视图改名…）的确认/取消。
- **症状**：键盘弹起时 foot 落在键盘后面，须先收键盘才能点确认。
- **根因**：`src/mobile/hooks/useKeyboardStableSheet.ts:8-12` 契约 =「弹窗 top/height 稳定、键盘覆盖下方」；261117 已给显式出口「点标题区 = 完成编辑（收键盘、露出底部确认钮）」（MobileSheet.tsx:165-166）。
- **修复方向**：维持现状（产品取舍已定）；若要根治 = 键盘态把 foot 抬到 `--kb-offset` 之上（需同改 editSurfaceModel 口径并跑编辑面不变量，**另立项**）。
- **验证法**：设备录屏键盘开合时按钮可见性；`dismissKeyboard.test.ts` / `keyboardSheetAudit.test.ts` 不回归。

### B-11【实锤·P2（潜伏）】`.mb-sheet__foot` 无换行 + 按钮 nowrap ⇒ 长文案/动态字号溢出

- **表面**：所有 SheetFooter 双按钮面板（「移动到此处/取消」「转为文档/取消」等）在 360 窄屏 + 系统大字号下。
- **根因**：`src/mobile/floating.css:91`（foot `display:flex` 无 wrap）+ `src/mobile/kit.css:42`（`.mb-btn` nowrap）；对照 `.mb-set-block__actions` 有 wrap（kit.css:359）。
- **修复方向**：foot 允许 `flex-wrap: wrap` 或给按钮 `min-width:0` + 标签省略；顺带定「两键时各 `mb-flex1`」的排布规则（SheetFooter 的 grow 参数已有）。
- **验证法**：jsdom 设 360px 容器宽断言不溢出；或 walk-through 加大字号态截图。

### B-12【登记·待实测 P2】编辑 dock / 表格 dock 不消费底部安全区

- **表面**：文档编辑态底部 dock（.med-toolbar）、表格（usheet）底部 dock，键盘收起时。
- **症状（推定，需实测）**：dock 底缘 = 屏幕底缘，手势条盖住 dock 下缘；44 高按钮在 56 高 dock 里底距屏底仅 6px < safe（24px+）⇒ 按钮下缘命中区被手势条吃掉。
- **根因**：`src/mobile/editor/editor-dock.css:26`（`bottom: var(--kb-offset, 0px)`）与 `src/mobile/usheet/usheet-chrome.css:325-336`（`bottom: var(--mb-usheet-kb-offset, 0px)`）均无 safe 项；对照组：ink 工具坞 `bottom: calc(8px + var(--mobile-bottom-safe-area))`（inkPad.mobile.css:43）、首页 Dock 高度含 safe（mobile.css:1015-1016）、胶囊（mobile.css:621）。安全区喂值通道本身健全（tokens.css:292-293 + safeAreaInsets.ts:25-44，documentElement 级）。
- **修复方向**：dock 底距并入 safe（`bottom: calc(var(--kb-offset, 0px) + var(--mobile-bottom-safe-area))` 一族）——**先实测**：若设备上 dock 按钮命中实测 ≥44（手势条只压空白圆角）则降为观感项。
- **验证法**：手势条 AVD 截图 + `getBoundingClientRect` 量按钮底缘与 safe 关系；`check:mobilesnap` 编辑态/表格态。

### B-13【登记·P3】编辑态让位账丢 safe 项（同源不同账）

- **根因**：`.mobile-bottom-bar--above-dock`（mobile.css:646-647）与 `.mobile-workspace--capsule-edit .mobile-doc-body`（mobile.css:655）的公式没有 `--mobile-bottom-safe-area`，而阅读态同族公式有（mobile.css:621 / :367）。当前被「dock 本来就在底部」掩盖，随 B-12 一起实测/一起修。
- **修复方向**：与 B-12 同批，把「底部让位」的 safe 项收进同一条 tokens 表达式。

### X-1【已排除/健康面，防止误报】

- 首页 Dock + FAB：Dock 高度含 safe（mobile.css:1015-1016）、滚动区让位 124+safe（:1081）、FAB 52 圆悬浮在 Dock 上方（:1052-1063）✓；
- 多选动作条/顶栏：`.mb-sel-actions` 三变体都消费 safe（mobile.css:523-525）、`.mb-sel-topbar` 走 topChrome inset（:519）✓；
- Sheet 末行裁切（维度⑥）：body 底内距 16/20+safe 已覆盖滚动末端（floating.css:78/85）、picker body 同款（kit.css:415）、设置内容 16+safe（mobile.css:579）、设置根列表 24+safe（:551）✓ —— 未发现「滚到底末行按钮被裁」实锤；
- 标准 SheetFooter 用例（DocListSheet / MoveTargetTreeSheet / NameSheet / NoteTagsSheet / BatchTagPickerSheet / TagsHomeTab / DefaultNotebookPickerSheet / ResourceCleanupSheet / FieldEditor / ViewActions / TableActions）foot 几何正确 ✓；ResourceCleanupSheet.tsx:74 手写 `.mb-sheet__foot` div（自定义布局、类名正确，可顺手迁 SheetFooter 但不是缺陷）；
- DocListSheet 的 footer = `SelectionActionBar`（DocListSheet.tsx:316-318）自带上内距+safe 的浮动卡形态（mobile.css:523）✓ 属另一语义，不并账；
- 小记写作卡动作行 = dock 占位账（mobile.css:225，bar + gap + safe）✓；
- ActionSheet 破坏性确认（`.mb-actionsheet__item` 48 高、`--mb-ctl-h-lg`）命中 ✓（几何档差见 B-6 族登记）。

---

## 4. 统一修法建议（优先修「同一几何根源」的一类）

**第一类 = 「Sheet 底栏账」一次收口（修 B-1/B-2/B-3/B-5/B-6，≈ 半天）**：
1. `.mb-sheet__foot` 为唯一底栏几何（8 / 16 / 20+safe）；`MobileSheet` 的 footer 槽**强制包 foot**（或 MobileSheet.tsx 内部自动包一层），`SheetFooter` 保持唯一按钮排布原语。
2. 两处裸 footer（PortableImportSection.tsx:96-111、UpdateCenterSection.tsx:209-240）迁 `SheetFooter`（多按钮走 children）。
3. body 与 foot 的 safe 叠账收成一份（B-3 的一条规则）。
4. `.mbt-drawer__foot` 补 safe 项；`.ai-sheet__foot` 并入 `.mb-sheet__foot`（或登记差异）。
5. 护栏：render test「footer 子树根节点必须含 `.mb-sheet__foot`」+ 静态审计「`position:fixed/absolute` 的 bottom 规则必须含 `--mobile-bottom-safe-area`/`--kb-offset` 或在允许清单」（topChromeContract 的 bottom 侧镜像）。

**第二类 = 「44 命中」一次收口（修 B-7/B-8，≈ 一小时）**：kit.css 给 `.mb-btn--sm` / `.mb-iconbtn--compact` 补 ::after 纵向扩区（`.mb-chip` 先例，横向不动）；散点 28–40px（sheet 头关闭钮 / drawer ⋮ / toast 关闭）挂 `.mb-tap` 或同类内扩区；把「视觉<44 的类 ↔ 扩区」对账写进 `check:mobileui`（防再漏，修 F-G/R-1 的「护栏看不见」教训）。

**第三类 = 排布与权重（B-9/B-11，随第一类顺带）**：破坏性主操作走 `mb-btn--primary mb-btn--danger`；foot 支持换行/省略。

**登记项（B-10/B-12/B-13）**：B-12/B-13 先设备实测再定级；B-10 不改。**B-4 不动 261110「固定半屏」定稿**，修完一/二类后复评。

**顺序**：B-1/B-2（用户点单）→ B-7/B-8（门禁 smallTap 直接受益）→ B-3/B-5/B-6 → B-9/B-11 → 实测 B-12/B-13。

## 5. 与既有契约的关系

- **`.mb-sheet__foot` 单一来源**（MOBILE-DESIGN「Sheet 内页内容的两件契约」261030；mobileLayers.test.ts floating 316 声明棘轮）：本审计的 B-1/B-2/B-5/B-6 全部是**绕过或分叉该契约**；统一修法 = 把调用方拉回契约，不是新造第四套。修法尽量零新增声明（换值/收编；新增声明须同批找等量删除或 lead 收口棘轮）。
- **44 Rule**（MOBILE-DESIGN：「唯一来源是 src/mobile/mobile.css 的触达补足注册表」）：**文档口径与实现已漂移** —— 实现是 kit.css 的 `.mb-tap`（:332）+ 类内 ::after（`.mb-chip`:169 / `.mb-switch`:350），mobile.css 里并没有「注册表」本体 ⇒ 建议文档改口到 `.mb-tap` 机制（或恢复注册表），否则下一个 36px 控件照样漏。
- **topChrome 契约**（data-mb-topbar / data-edge）：只管顶部；本审计全是 **bottom 侧**。建议对称地立「bottom 安全区消费口径」：任何贴屏底的 fixed/absolute 表面必须消费 `--mobile-bottom-safe-area`（dock 的 `--kb-offset` 族豁免时显式登记），护栏镜像 topChromeContract.test.ts。
- **261110「Sheet 固定半屏」与 261117「头部拖拽调高」用户定稿不动**（B-4 只登记）；**useKeyboardStableSheet 的「键盘覆盖」契约不动**（B-10 登记）。
- **与 mobile-ui-jank-audit-261119 的边界**：F-G（`.mb-menusheet__submenu` 安全区）已在 6ad4a108 修复（mobileLayers.test.ts 316 注册）；本审计不碰跳变/转场；`SelectionTopBar`/多选态换位（F-D）属 bitable 流。

## 6. 本轮审计覆盖说明

- 已扫：`src/mobile/**` 全部按钮表面 —— Sheet footer 槽 21 处（`footer=`/`SheetFooter`/`mb-sheet__foot`/`ai-sheet__foot`/`mbt-drawer__foot`）、`.mb-set-block__actions` 20+ 处（页面内/Sheet body/footer 三种挂法逐一分类）、ActionSheet/Toast/菜单 Sheet、设置九页行内按钮、弹窗内嵌表单动作行（S3 迁移码 / 缺正文 / 同步记录 / 视图·数据表操作）、悬浮按钮（FAB / 多选动作条 / ink 工具坞 / 页签条）、底部 dock 族（首页 Dock / 编辑 dock / usheet dock / 胶囊 / 小记写作卡动作行）、命中区缺口（44 触控档全类）。
- 几何取证：`--mobile-bottom-safe-area` 喂值通道（tokens.css:292-293、safeAreaInsets.ts）与全部消费点；bottom 锚定规则全量 sweep（fixed/absolute bottom 计 30+ 处逐条对 safe）；`.mb-sheet__foot` 算术（8/16/20+safe）与 body（16/20+safe）叠账。
- 未能实测：设备/模拟器未连（同 jank 审计口径）⇒ B-12/B-13 的像素级定级、B-1/B-2 的现场截图留给修复流补；jsdom 可断言项已逐条写进各发现的「验证法」。
