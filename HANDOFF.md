# HANDOFF.md — Lake Notes 项目交接（唯一权威交接文档）

> 写给**完全没有上下文的新会话**。接手顺序：**README → HANDOFF → AGENTS**；之后按需读相关 `docs/`。AGENTS 是长期红线/机制/坑，每次自动加载。
> **本文件只保留「最新 §0（1–2 节）+ 当前基线 / 真正的待办 / 有价值的坑」。**
> 所有历史 dated handoff（旧 `§0 <日期>` 节、`§2.x` 各批会话）已从本文件**删除**，只在 git 历史可查：`git log -p --follow HANDOFF.md`（或 `git show <旧提交>:HANDOFF.md`）。文中残留的 `§2.x` / 旧 `§0` 引用是**历史指针**，去 git 查，**不要在本文件重建历史**。
> **§8 是移动端（安卓）专职交接**，由移动端会话维护；桌面会话不要改 §8，移动端会话不要改 §0-§7 之外的桌面文件。

## 0. 最新交接（261020 → 261017）

> 写给完全没有上下文的新会话。接手顺序 **README → HANDOFF → AGENTS**。**本节保留最新批次（261020 / 261019 / 261017）**；更早的 dated handoff 已删除，只在 git 历史可查（`git log -p --follow HANDOFF.md`）。文中提到的「专项文档」= 已删除的 `docs/BITABLE-OPTIMIZATION-HANDOFF.md`。**真正的待办看 §3，长期坑看 §4，移动端看 §8。**
>
> **261019 最新基线**：移动端批次已推送 master —— `ae757584`（主页分页 / 转场+按压 / 动效+骨架 / 常用 / 小记加载壳等 5 批）+ **本轮收口 `§0(六)～(十一)`**（目录菜单去重 + 属性适配 / 转场落定修 fixed 包含块 / 收面板→键盘动效 / ⌨ 双态图标 / capture 预热收口 / native hint 原型已回退）；**提交树门禁 290 文件 / 2164 例**（条目里 291–293 是并行会话在途用例的工作区口径）。随后 **`ef7888fa`（多维表/存储 review）+ `a33bc093`（移动端正文文件化）已推 master**；提交树 **305 文件 / 2224 例（16 skip）**。前一条 261017：代码 review 全部结案、S3 配置导入导出已实现待验收（见 §0(十七)）。
> **⚠️ 261017 历史已重写**：旧 AK/SK 已从 git 历史清除（filter-repo）；旧 commit hash 全部失效，旧克隆/缓存请重新拉取。
>
> **在途（未完成）**：~~移动端文本增强面板（字号 / 字色 / 背景色 / 对齐 / 链接）~~ **已完成（261012 移动端批，见下）**；
> 仍缺的移动端文本格式 = **H5/H6、缩进、行高、清除格式、格式刷**（§3 的覆盖缺口表里其余项）。
>
> **下一会话焦点（261012 收尾 → 下一会话，用户定）**：① **移动端文本增强二级面板**（见上）；② **5 项画图插入项解禁**（画板 / 流程图 / UML / 思维导图 / 文本绘图，现为置灰占位；根因与修法见 §3#18）；③ **页面详细测试 + 优化细节**（逐页走查、查漏补缺）；④ 若继续表格，取 `docs/USHEET-UPGRADE.md` §7 的中期项。表格性能（含 5000 行档）已收口，**别再优化包装层**（实测见下面 261010 节）。
> **已定不再讨论**：「开始」工具收窄后**隐藏旧工具就是为了让折叠的出来**（用户 261010 定：不给白名单、保持现状）；canonical 快照挪空闲时段暂不做；移动端/桌面抽公共 runtime、单实例多 workbook 共享不做；公式栏收起方案仅存档；MiSans 桌面字体（暂缓）；
> **移动端小记工具条不加「＋」面板入口**（用户 261010 定："这个+号本来就不应该出现，在移动端太突兀"）——已知副作用：移动端小记插不了表格/代码块/公式/等高亮块等（显示不受影响），别再提议加回。；**Android 端"先保证能用"**。**唯一已知遗留** = 多标签切换时内核工具条 1~4 帧绘制空帧，见 §3#9（诊断与可行方向已写全，别重复试提层类改动）。

### 261020(五) · 小记标签 v1（桌面 + Android）+ 桌面按钮语义色收口 · **待用户验收**

- **数据口径**：标签写入 `.qnote.tags`，随正文内容同步；**不建独立标签表**。“已有标签” = 全部有效小记标签的并集，
  最后一条关联移除后标签自动消失。标签名 NFC + trim + 连续空白压缩；单条最多 20 个、单个最多 32 字符；`无标签` 保留给筛选。
- **时间语义**：仅改标签会更新 `contentHash`（正常同步），但保留原 `updatedAt`，不会把卡片按“最近更新”顶到最前。
- **桌面**：写作区标签行、已有标签选择/新建/移除、卡片标签、卡片菜单即时打标、标签筛选条（全部/单标签/无标签）。
  切换筛选前会先保存并退出正在编辑的小记，避免筛掉卡片时丢未保存正文。
- **Android**：卡片标签、筛选条、`⋯ → 添加标签` 底部 Sheet、编辑区标签行；草稿日志也携带标签。
- **原语/级联**：标签输入改走 `ln-input`；小记动作行改走 `ln-btn`（primary / secondary / ghost）。内核 antd 未分层
  `button { color: inherit }` 会在 dev 覆盖语义色，已在 `kernel-theme.css` 未分层补回按钮颜色，不新增 `!important`。
- **门禁**：tsc ✓ · 全库 vitest **2327 passed / 16 skipped** ✓ · 双端构建 ✓ · ui-metrics / core / mobileui / bundle ✓ · diff-check ✓。


### 261020(四) · 小记写作卡「Aa / ＋」二级展开错位（路由层常驻 will-change 改了 fixed 包含块）· **已提交 `295ef7b1`、已推送 master**

- **现象（用户报）**：小记写作卡里展开 Aa（文本增强）后，面板整体上移一个键盘高、下方空一片，工具栏也被写作卡盖住；
  用户原话「只要改移动端就会给我弄乱一次」。设备截图：`.css-audit/mobile-props-261020/before-panel-up.png`。
- **根因（同机 A/B 实测，不是猜）**：`.mobile-route-layer` **常驻** `will-change: transform`。它**即使 transform:none**
  也会把 `position:fixed` 的包含块从「视口」改成 layer 盒，而 layer 高 = `--mb-app-h`（面板期 842−312=530）⇒
  `.med-panel` / `.med-toolbar` 被钉在 530 下沿（实测面板 218–530、工具栏 162–218、下方 312px 空白）。
  261019(七) 只给**工作区层**补了 `is-settled`；**首页层（小记写作卡所在）从来没撤** ⇒ 一动壳层就复现。
- **决定性验证**：CDP 把 layer 的 will-change 临时改 `auto` ⇒ 面板立即回 **530–842**、工具栏 **474–530**（其余不变）；
  改回 `transform` 立刻复现。
- **修法（单一来源，最小）**：
  - `src/mobile/mobile.css`：layer 去掉常驻 will-change，只在 `.mobile-route-stage.is-animating` 期间挂
    （转场仍走合成层；落定后两层 `will-change:auto`）。
  - `src/mobile/hooks/useRouteTransition.ts`：新增 `animating` —— push 在 `requestAnimationFrame` 里与 `setOpen`
    **同一次 render** 置位（不白丢首帧），settled 后撤；pop 在 `close()` 置位、卸载时撤。
  - `src/mobile/MobileApp.tsx`：stage 挂 `is-animating`。
- **护栏**：
  - `useRouteTransition.test.ts`：layer base 规则不得含 will-change / 只在 `.is-animating` 期间挂 / animating 置位与撤位
    （断言取"行首 base 规则本体"，避免把 `.is-animating` 那条选选择器后缀误判）。
  - `scripts/mobile-audit/edit-surface-invariants.mjs`：新增 **I5 面板贴视口底**（`panel.bottom===innerHeight`、
    `toolbar.bottom===panel.top`），小记 + 文档两条路径都跑；装置对本条**与原因解耦**（任何让 fixed 包含块变成
    layer 盒的改动都会红）。`scripts/mobile-audit/README.md` 同步五条。
- **设备验收（emulator-5554，新包已装）**：小记 Aa 面板 280（未弹键盘）/312（键盘态）两档都贴底；关面板→键盘回
  （ih 530）；「＋」插入面板同；文档编辑态同；路由 push/pop 期间 `is-animating`+will-change，700ms 后 `auto`/
  `is-settled`；全量不变量装置 **exit 0**（I1–I5 全绿）。after 截图 `.css-audit/mobile-props-261020/after-panel-anchored.png`。
- **门禁**：tsc 0 · vitest **316 文件 / 2303 例（16 skip）**（含并行会话在途 2 例）· ui-metrics / check:core /
  check:mobileui / check:bundle / `git diff --check` ✓ · Android `assembleDebug` ✓（APK 40,122,324 B）。
- **长期纪律（已写入 `docs/MOBILE-TECH-STACK.md` §五#7④）**：**任何 route / shell 层都不得常驻
  `transform` / `will-change: transform`** —— 它们是 `position:fixed` 的包含块陷阱；动画期间挂、落定撤；新增层先按 I5 验。
- **状态**：已提交并推送 origin/master（`295ef7b1`；用户 261020 验收后授权推送）。

### 261020(六) · 桌面启动改为思源式 boot 窗口 + 14A 折纸加载 · 已提交

- **问题**：logo 原先在 React loading screen 里，主窗口先显示空 `index.html` ⇒ dev/打包都可能先白屏再出 logo。
- **修法**：主进程 `app.whenReady()` 立即创建本地 `electron/boot.html`（内嵌 128px APNG）；主窗口 `show:false`，React 在 `workspace`/启动错误渲染后发 `renderer-ready`，主进程再显示主窗口并销毁 boot 窗口。macOS 关窗后从 Dock 重开也会先重建 boot 窗口。
- **启动耗时**：boot 窗口在 app ready 后约 0.1s 出现；去掉此前 700ms 人为最短展示后，隔离空库实测热启动约 **1.1s**、冷启动约 **1.85s**。剩余耗时主要是 6.9MB 入口 bundle + workspace bootstrap，不是动画。
- **Android**：`android/app/src/main/res/drawable*/splash.png` 全量换成 14A 静态标识；移动端 WebView 启动覆盖层继续用 128 loop APNG，同样不加人为最短展示。
- **资源/代码**：`electron/boot.html`、`public/brand/*`、`src/styles/brand-launch.css`、`src/mobile/brand-launch.css`、两端 `BrandLaunchMark`；打包 `files` 已纳入 `electron/boot.html`。
- **门禁（暂存区隔离 worktree）**：tsc 0 · vitest **316 文件 / 2303 例（16 skip）** · 双端构建 ✓ · ui-metrics / check:core / check:bundle ✓ · `git diff --check` ✓。

### 261020 · 图标体系重做 + 表情面板（中文搜索/排布）+ 浮层外点 + 附件图标与压缩包打开 · 已提交、已推送

- **目录图标（用户点单，三轮收口）**：笔记本/分组改用**语雀知识库那套 17 个彩色插画**（值方言 `n:<id>`，整串 ≤16 字符，同步字段不变）；**旧「40 个 lucide 线性图标 + 8 档浅渐变底板 + `i:<id>:<色号>` 编码」整体删除**（只保留识别：旧值画中性图形、不回显原始串、不迁移）。**语雀品牌 logo 图标已移除**（用户 261020：涉及 logo 不能用）。文档/表格/多维表/画板**只有表情**、无「图标」类目；笔记本/分组保留「表情符号 ｜ 图标」两页（默认图标，维持第一版结构）。
- **表情面板**：9 列正方形格（42px，原来 47×32 被拉成"横向空、纵向贴"）、「最近」空态收成一行、底部分类页签等分、正文封顶 266 且按内容收缩；**新增中文搜索**——`lib/emojiZhKeywords.ts` 由 Unicode CLDR `annotations/zh` 生成（覆盖 1172/1421，缺的主要是 ZWJ 组合/肤色变体），判据单一来源 `lib/emojiSearch.ts`（英文短名 / 中文关键词子串 / 粘贴表情精确命中），悬停名也改中文。
- **浮层外点关闭（真 bug）**：`Overlay` 的外点监听从冒泡改 **capture** —— Univer 表格与内核会在自己子树里 `stopPropagation` 掉 mousedown（实测：点表格画布 document 冒泡监听收不到 ⇒ 浮层不关；点目录栏能关，正是用户报的现象）。一处修好所有 menu/popover；护栏 `components/ui/Overlay.test.ts`（4 例，含"改回冒泡必红"的自证）。
- **附件类型图标（用户点单）**：新增 `features/bitable/FileBadgeIcon` —— **≥28px** 画「类型色纸页 + 扩展名」（46px 附件卡片 / 40px 资源预览台），**<28px** 仍是线性图标：实测三套公开图标集在 18px 都读不出扩展名（字高只有 ~6px，3–4 字母必然糊），所以小的保留形状、大的才印字。颜色仍全走 `--lake-file-*` / `--lake-text-on-accent`，该 CSS 内无颜色字面量。
- **压缩包打开（真 bug）**：macOS 归档工具会把 zip **解压到压缩包同目录** ⇒ 目录堆进 `note-assets/{noteId}/`；它不在 `assets` 表（**不会上传 S3、不进 manifest**），也不进孤儿 GC（`detectOrphans` 只登记 `isFile()`）⇒ 永远清不掉。改：压缩包先**硬链接**（跨卷回落**异步**复制）到 `$TMPDIR/lake-open-attachments/{noteId}/` 再交给系统打开，每次打开先清该笔记上次产物。护栏 `core/attachmentOpen.test.ts` + `electron/attachmentOpen.test.ts`（6 例）。
- **门禁（提交树）**：`tsc` 0 · vitest 全绿 · `ui-metrics` / `check:core`（92 文件 0 违规）/ `check:mobileui` / `check:bundle` · 双端构建 · `git diff --check` ✓。
- **未做（如实记录）**：移动端表情面板仍**没有搜索框**（只有分类）；大尺寸徽章只在 ≥28px 生效；此前 macOS 里手工解压留在 `note-assets` 的残留目录需手工删（是否加"只报告不删"的体检项待定）。

### 261020(二) · 手写板正式 v1（桌面 + Android）· 已合并 master

- **工作树/分支**：`lake-notes-electron-worktrees/ink-pad-poc` / `feat/ink-pad-poc`；已合并 master（`308c6788`）。
- **产品决策**：手写板是亮点而非主编辑器；正式 v1 统一采用 Web Pointer Events + SVG + `perfect-freehand`，不接 Jetpack Ink / PencilKit / OCR。独立文档见 `docs/INK-PAD.md`。
- **能力**：`kind="ink"`；多页 A4；画笔/高亮/整笔橡皮；撤销重做；空白/横线/网格/点阵；50%–300% 缩放；页面缩略图、排序、删除确认；桌面/Android 自动保存、历史、回收站、搜索类型分派、S3 同步。
- **移动端手写**：Android 编辑态经 `StylusInputPlugin` 关闭系统手写接管，离开后恢复，避免系统手写板抢 Pointer Events。
- **真云验证**：隔离 S3 前缀下确认桌面 A→B、桌面→Android、Android 编辑→桌面回读；`kind=ink`、页数/笔迹数一致，正文逐字节相同；删除传播与 Android 恢复也通过。
- **同步真 bug 修复**：① 移动端 gzip manifest 不能声明 `application/json`（CapacitorHttp Android 会走文本分支导致 `SignatureDoesNotMatch`），改用 `application/octet-stream` + `Content-Encoding: gzip`；② `flushNoteBatch` 原先只提交 DB 行、未落正文文件，会产生 `content_hash=synced` 但正文缺失；现先写文件再提交元数据，并有批窗口回归用例。
- **正式 review 收口**：纸张线条/网格/点阵移入 SVG 逻辑坐标（缩放时密度不再漂移）；撤销栈增加 24 MiB 总字符预算；序列化与解析共用页数/笔迹/采样点/16 MiB 上限，重复页面/笔迹 ID 拒绝导入；页面切换会保存 `activePageId`；`flushSave` 只在确有 pending 时提交，避免只读/未编辑卸载产生虚假 dirty。另修状态栏把 ink 误标成“画板”、历史快照把 ink JSON 误喂给画板预览器、桌面创建接口漏回 `kind`，并抽出统一的建笔记开 tab 流程与核心 `normalizeNoteKind`。
- **门禁（合并后）**：tsc 0 · vitest **307 通过文件 / 5 skip；2247 例通过 / 16 skip** · 桌面/Android 构建 · ui-metrics / check:core（93 文件 0 违规）/ check:mobileui / check:bundle · `git diff --check` 全绿。
- **剩余验收**：真实 Android 手写笔设备验收压感/掌托/延迟。iPad 仍只保留 Web 兼容，无 iOS 工程。

### 261019(十三) · 多维表/存储 review 修复（桌面）· 已提交 `ef7888fa`、已推送

- **P1 真 bug**：渲染层对没有 Lake 实例的文档也传 `caches={markdown:null,plain:null}` ⇒ `Store.saveNote` 直接采用，把 `text_cache` / FTS 正文清空（多维表/表格/画板保存后记录正文搜不到）。修：**非 doc 一律按 kind 派生缓存**；护栏 `store.test.ts`（渲染层真实 caches 形态 + 搜索命中）。
- **P2 数据安全**：多维表正文解析失败（文件损坏 / 版本不兼容）此前静默显示默认空表，继续编辑会覆盖原文。修：挂载时判定 ⇒ **只读 + `.tab-gone-banner` 横幅**（复用既有原语）+ 全部写入口关闭；护栏行为用例。
- **历史快照命名**：新快照 `.lake.gz` → **`.body.gz`**（所有 kind 都是正文原文 gzip；旧文件仍按 `note_history.file_path` 读取，不迁移/不改名）；HISTORY-DESIGN / S3-GC / STORAGE-LAYERS / ARCHITECTURE 同步。
- **文档核对**：S3 正文键 `objects/{noteId}-{contentHash}.lake`；本地目录补 `usheets/bitables/boards/history`；L3 补登 5 个 `bitable-*` localStorage 键与 `notes.md_cache/text_cache` 派生口径；kind 列表 `sheet` → `usheet`。
- 门禁：tsc 0 · 全库 vitest · ui-metrics / check:core / check:mobileui · 双端构建。

### 261019(十四) · 移动端正文文件化（与桌面同构：BodyStore + gzip 历史 + 小记/草稿）· 已提交 `a33bc093`、已推送

- **口径（用户 261019 定稿）**：开发阶段数据可删；文档 / 小记 / 历史 / 草稿全部落文件，SQLite 只留元数据、hash、同步账本与**派生**缓存；旧库（`notes.content`）检测后**整库重置一次**，不做逐篇迁移。
- **原生 BodyStore**（`BodyStorePlugin.kt`）：原子写（tmp+fsync+rename）、UTF-8 读写、删除 + 空目录 prune、**原生 gzip 快照**、路径防穿越；MainActivity 注册。TS `bodyStore.ts` 原生/内存双后端——**浏览器预览（mobile-preview）是内存，刷新即丢，只用于看 UI**。
- **目录与桌面同构**（`src/core/noteBodyPaths.ts` 单一来源）：`notes/ usheets/ bitables/ boards/ quick-notes/items/ quick-notes/assets/ note-assets/ history/*.body.gz draft-journal/`；AssetServer 与 assetFs 把 URL `/quick-notes/{id}/{file}` 映射到 `quick-notes/assets`。
- **数据层**：noteRepository / syncDbPort（正文先文件后 DB；批窗口守卫前移到写文件前，**并同步丢弃被推迟笔记的 sync_base 语句**；墓碑透传 kind）/ searchIndex（text_cache 优先、缺失读文件）/ historyRepository（gz + refs_json + protected_until，清理尊重保护窗口）/ quickNotesRepository（`.qnote` + draft 文件 + 旧稿清理）/ quickNotesDbPort（可注入 bodyFs；失败回滚正文）/ trash purge 删除正文与历史文件。
- **设备验收（新 AVD `lake_body` / emulator-5558，独立于并行会话）**：文档/小记/图片/历史 gz（magic **1f 8b**）落盘；SQLite 三表**无 content 列**；大正文 2.75MB 保存 ~1.2s；软删保留正文、purge 删除正文+历史；重启持久化；**旧库加回 content 列 → 重启自动重置**（列消失/数据清零/旧文件清空）；capture 草稿 `draft-journal/*.json` + 杀进程重启自动恢复。
- **设备测试中发现并修**：`purgeQuickNote` 直接删未进回收站的小记会撞 `deleted_at NOT NULL`（SQL 加 COALESCE 兜底）。**遗留观感**：小记 purge 后 `quick-notes/assets/{id}/` 空目录残留（BodyStore 会 prune 正文目录，图片走 Filesystem 不 prune）。
- **未做**：真机复验；与真实 S3 的双端同步设备对拍（未用用户云配置，避免误同步/GC）。`MOBILE-TECH-STACK` 本批**未动**（并行会话有在途改动）；正文文件化口径已写进 `AGENTS §4` 与 `docs/STORAGE-LAYERS.md`，等并行批次落地后再补该规格文档。
- 门禁：tsc 0 · 全库 vitest **305 文件 / 2224 例（300 通过 / 16 skip）** · 双端构建 ✓ · ui-metrics / check:core / check:mobileui / check:bundle ✓ · Android `assembleDebug` + APK ✓。
### 261019(十二) · 桌面导出补齐：表格 CSV / 表格 Excel / 画板 PNG·SVG / Word · **已提交 `f6390745`、已推送（用户 261019 验收通过）**

- **用户点单**：把导出占位补齐，顺序 = usheet CSV → 画板菜单接线 → usheet Excel → Word。
- **① usheet CSV（活动工作表）**：core [usheetCsv.ts](lake-notes-electron/src/core/usheetCsv.ts)（BOM+CRLF、显示值 `m`→原始值 `v`、只导有效区域、超限报错）；主进程 `NoteExport.exportUsheetCsv`；新增 IPC `export_table_csv` **按 kind 分派**（bitable 活动数据表 / usheet 工作表）⇒ 渲染层只认一个「导出为 CSV」。
  - 活动工作表属**本机视图**（不进正文/不写 S3）：新增 [usheetActiveSheet.ts](lake-notes-electron/src/features/usheet/usheetActiveSheet.ts) 内存登记表，`UniverSheetEditor` 挂载时登记 getter；文档没打开时后端回退 `sheetOrder[0]`，提示里写明导的是哪张。
  - 空工作表 / 空表格**明确报错**，不产出空文件。
- **② 画板 PNG/SVG**：不另写画布渲染，复用画板内已有 Drawnix 导出（`lakex-drawnix` 的 `saveAsPng/saveAsSvg`，CSP 已放行 data:）。新增 [boardExport.ts](lake-notes-electron/src/features/board/boardExport.ts) 登记表：`BoardEditor` 挂载时登记触发器，菜单动作点开 vendor 导出菜单再点目标格式。**画板没打开 ⇒ 明确提示先打开**；文件落**系统下载目录**（画板工具栏本来就是这种行为）。
  - 坑：等待用 **setTimeout 而非 rAF** —— 隐藏窗口（CDP 依附/最小化）rAF 不触发会把导出 promise 永久挂住。
- **③ usheet Excel（261019 晚升级：改用 `write-excel-file@4.1.1`，用户确认「接受 oneCellAnchor + 补数字格式/列宽/合并/冻结 + 样式扩展」）**：core [usheetExcel.ts](lake-notes-electron/src/core/usheetExcel.ts) 只做 Univer 快照 → 中立模型（值/公式/数字格式/粗斜下划线删除线/字号/字色/底色/边框四边/对齐/换行/行高/列宽/合并/冻结/隐藏表照常导出/富文本 `p` 文字/图片引用与锚点），主进程 [usheetXlsxExport.ts](lake-notes-electron/electron/usheetXlsxExport.ts) 解析资产字节（webp 等 sharp 转 png）并调库写 xlsx。**图片两种形态都接**：单元格内图片取 `cell.p.drawings`（锚到本格、尺寸 `docTransform.size`），浮动图片取 `SHEET_DRAWING_PLUGIN`（`sheetTransform.from` + 像素偏移 + `transform` 宽高）；缺失/外链/不支持格式计入 skipped，不阻断导出。依赖只进主进程（`dependencies` 精确锁 4.1.1，+fflate 共 2 个包），core 保持零依赖；旧手写 `xlsx.ts` 已删除（单一实现）。IPC 仍为 `export_usheet_xlsx`，结果新增 `imageCount/skipped`。
- **④ Word（docx）**：core [docx.ts](lake-notes-electron/src/core/docx.ts) 手写极简 OOXML：H1–H6 / 列表（numbering）/ 引用 / 代码块 / 分隔线 / 基础表格 / 粗斜删除线·行内代码 / 外部链接 / 图片（主进程读本地资产，webp 等用 sharp 转 png，≤600px 宽）。走既有 `export_note`，`NOT_IMPLEMENTED` 已清空。图片缺失计入 skipped 并提示；远程图降级为「[图片] alt」。
- **已知边界（如实记录）**：Excel 图片为 **oneCellAnchor**（不随列宽缩放）、隐藏工作表/隐藏行列统一导出为可见（库无 API）、公式只写 `<f>` 无缓存值（Excel/WPS 打开重算）、**边框四边已补（对角线不支持）**、**字体族不搬（用户 261020 明确不需要）**；Word 不搬运行内 HTML/复杂嵌套/表格样式/页眉页脚（文本不丢，结构降级）；画板导出落下载目录且需画板已打开。
- **门禁**：tsc 0 · 全库 vitest **306 文件 / 2232 例（301 通过 / 5 skip 文件；16 skip 例）全绿** ✓ · 双端构建 ✓ · `dist-electron/main.js` 以 `import "write-excel-file/node"` 外置（主进程 external 从 dependencies 派生）✓ · ui-metrics ✓ · check:core **91 文件 0 违规** ✓ · check:mobileui ✓ · check:bundle ✓ · `git diff --check` ✓。新增测试：核心模型 7 例 + Store 级 xlsx 2 例（真实 zip 解包断言 media/drawing/numFmt/merge/pane/col/公式）。
- **IPC 基线**：`ipcChannelParity` 119 → **121**（`export_table_csv` / `export_usheet_xlsx`）。
- **review 补漏（提交前自查）**：CSV 补富文本 `cell.p` 纯文本（与 Excel 共用 `usheetDoc.usheetCellRichText`）；Word 有序列表**每段独立 numId + startOverride**（否则第二段接着上段编号）、表格补 `<w:tblGrid>`（缺了 Word 会报“需要修复”）；Excel 内联 `data:image/webp` 也走 sharp 转 png（原先只转文件）。补测试：CSV 富文本、Word 双有序列表/tblGrid、Excel 三图（含 data URL）。
- **验收**：用户已用 **Excel + WPS** 打开导出样例（数字格式/粗体底色/列宽/合并/冻结/公式/两张图片）确认无误；真实 UI 点按（系统目录框）未自动化。
- **261020 追加**：Excel 补**单元格边框**（四边线型/颜色；四边一致走通用属性、否则逐边；NONE/对角线忽略），commit `909dd951`；字体族按用户要求不搬。
- **未做**：真实 UI 点按验收（系统目录框无法在自动化里点）；Word 真机打开仍建议抽查。本批已提交 `f6390745`（代码/测试/依赖）+ `909dd951`（边框），HANDOFF 单独 docs commit。
- **相关文件**：`electron/{noteExport,store,usheetXlsxExport,export,preload.cjs,ipc/registerNotes,webApiServer}.ts` · `src/lib/native.ts` · `src/hooks/useNoteActions.ts` · `src/components/ui/ExportSubmenuItem.tsx`(+test) · `src/features/{board/boardExport,usheet/usheetActiveSheet}.ts` · `src/core/{usheetCsv,usheetExcel,docx,ooxml}.ts` · `package.json`（+write-excel-file 4.1.1）/ `package-lock.json`。

### 261019(十一) · 快捷 capture「同步 native hint」原型：实测只提前 ~0.1s，**已回退**（无代码变更）

- **做法（已实现、已设备 A/B、已回退）**：MainActivity 在 `super.onCreate` 后注入 `lakeLaunch.getUrl()`（与 `lakeAssetToken` 同一 `addJavascriptInterface` 模式），入口第一条 import 同步读它 → 命中就立刻 `import` composer 分包、React 首帧直接进 capture；插件接口缺失时退回原轮询。
- **实测（force-stop + deep link，3 次）**：composer/kernel chunk 的 `startTime` 只从 **DCL+14~64ms** 提前到 **DCL−12~−166ms**（约 0.1–0.16s；空闲机一次仅 **−12ms**），端到端可输入时间无可测改善。原因：**入口 chunk 的加载/求值本身就是 DCL 前的大头**，而 dynamic import 只能在入口模块求值到那条语句时才发起；hint 再早也快不过"入口还没跑"。
- **结论**：收益与复杂度不匹配（native 接口 + 入口 boot 模块 + 双路径 fallback + 测试），按 AGENTS §3#17 **回退**；源码已恢复原样（`MainActivity.kt` / `quickNoteShortcut.ts` / `main.tsx` / `MobileApp.tsx` / 测试均无本批残留）。
- **保留**：仍是 §0(十) 的「capture 会话跳过 4s 预热」（避免写作时再跑一次 1.7s 内核加载）。
- **若还要继续**：需要把判定/预取放到**入口 chunk 之外** —— ① index.html 独立小脚本按已知 chunk URL `modulepreload`（要处理 hash 注入）；② 原生预取 kernel chunk/预创建 WebView。属另一个量级，先立证据再动。
- **门禁**：**提交树单独验证通过** —— tsc 0 · vitest **290 文件 / 2164 例** ✓ · ui-metrics / core / mobileui ✓。⚠️ **工作区**因并行会话在途暂不可跑（tsc 报 `syncDbPort.ts`；gradle 因 `BodyStorePlugin`/`AssetServer` BUILD FAILED）；5554 上现装的仍是**含本次原型 hint** 的构建（源码已回退，下次成功构建即恢复）。

### 261019(十) · 长按图标「小记」快捷入口：响应速度实测与收口（**不立项大改**）· **待用户验收**

- **问题（用户问）**：长按桌面图标快捷创建小记，还有没有优化响应速度的空间。
- **实测（emulator-5554 冷启动：`am force-stop` + `am start -W -a VIEW -d lakenotes://quick-note`；AVD 空闲时）**：
  - Activity 首次显示 **TotalTime 503ms**；
  - WebView 页内：DCL **208ms** · composer 挂载 **576ms** · 正文可输入 **677ms**（分包与 lakeRuntime 就位后，内核实例化只占 ~100ms）；
  - 点击→可输入（含观测端 CDP 连接开销）≈ **1.1s**。
  - 负载高时（并行会话跑构建，host load ~6.9）：Activity 3–5s、页内到 composer 4–10s —— **不是 capture 业务路径慢，而是整机/WebView/内核 chunk 冷加载被放大**（慢机上 lakeRuntime chunk fetch+eval 实测 0.6–1.7s）。
- **试过并回退（无实测收益）**：入口第一条 import 做「最早 capture 判定 + composer 分包预取」（同步 `Capacitor.Plugins.App.getLaunchUrl`；插件代理未就绪时入口并行 dynamic import `@capacitor/app`）。资源时间线显示 composer/kernel chunk 的 `startTime` 改造前后都 ≈ **DCL+25ms**（现有 effect 本来就立即预取），**关键路径没有前移** ⇒ 按 AGENTS §3#17 回退，不留无证据的启动期复杂度。
- **保留一项（真实、低成本）**：capture 会话在 `phase="ready"` 后**跳过内核/小记分包预热**（`captureLaunchedRef` 判定）。否则就绪 4s 后的预热会在用户正在写作时再跑一次 6.1MB 内核加载+实例化（实测 ~1.7s 长任务）打断输入。
- **结论 / 剩余空间**：capture 业务路径已接近地板（页内启动 0.2s + composer/内核 0.5s，输入 677ms）。再快只能动 native：① WebView 预创建/预加载；② 把 launch intent 作为**同步 hint** 在 WebView 加载前传给 JS（用于提前拉 kernel chunk）；③ 原生 capture 面。空闲机估算 ≤100–200ms、慢机 0.5–1s，但改动面/风险都大 —— **本轮不做，等用户定**。
- **门禁**：tsc 0 · vitest **293 文件 / 2171 例**（含并行会话在途用例）· 双端构建 ✓ · ui-metrics / core / mobileui / bundle / diff-check ✓。
- **状态**：未提交/未推送（待用户验收）。

### 261019(九) · dock ⌨ 按钮改**双态图标**（收起 / 展开一眼可分）· **待用户验收**

- **需求（用户点单）**：最右侧 ⌨ 同时承担"收起 / 展开"两种动作、却一直是同一个键盘图标 ⇒ 分不出当前会收还是展。用户给了两个参照（思源「键盘+斜线」/ 语雀「键盘+向下标志」），让我们定。
- **定稿**：键盘**展开中** ⇒ **`KeyboardOff`（键盘+斜线，思源同款）** + title/aria「收起键盘」；键盘**收起** ⇒ `Keyboard` + 「展开键盘」；面板展开态仍是「收起面板」且图标保持 `Keyboard`（此时键盘本就是收起的，动作是"关面板 + 放回键盘"，用 KeyboardOff 会被读成"再收一次"）。
- **改法**：[EditorDock.tsx](lake-notes-electron/src/mobile/editor/EditorDock.tsx) 的 `.med-btn--kb` 内按 `keyboardOpen` 二选一；`aria-label` / `title` 继续用既有 `kbLabel`（三态文案不变）。
- **设备验收（emulator-5554）**：键盘展开（ih 530）实测 `svg.lucide-keyboard-off` + label「收起键盘」；点一下收起（ih 842）⇒ `svg.lucide-keyboard` +「展开键盘」；再点展开 ⇒ 回到 `keyboard-off`。实拍裁图 `.css-audit/mobile-props-261019/{kb-icon-open,kb-icon-closed}.png`。
- **门禁**：tsc 0 · vitest **292 文件 / 2167 例**（本批 +1 例）· 双端构建 ✓ · ui-metrics / core / mobileui / bundle / diff-check ✓。
- **护栏**：`dockPanelFocusGuard.test.ts` 增 1 例（KeyboardOff 映射 + aria-label/title）。
- **状态**：未提交/未推送（待用户验收）。

### 261019(八) · 收面板→键盘的闪烁优化（面板内容保持到被键盘盖住）· **待用户验收**

- **现象（用户报，附录屏）**：二级工具栏（Aa / ＋）收起转键盘输入时「有点闪烁、不够丝滑」；反向（键盘→面板）观感尚可。
- **取证（设备逐帧，不靠观感）**：`screenrecord` + 30fps 拆帧实测（emulator-5554 / 412×842）：旧实现在点 × 后**立刻**播 `.med-panel-inner` 滑出+淡出（160ms），而输入法真正上来要 ~300ms–1.3s（负载高时更久）⇒ 键盘还在升、面板先变成一块**空白面板**（实测空块约 200ms），随后视口才收缩、键盘盖上来。**不是原生窗口白条**：给 `html/body/#root/.mobile-app` 注红底后该区域仍是面板色 ⇒ 空块来自面板内容的提前退场。
- **修法**：`useEditSurface` 新增 `closingHold` —— restore 档（× / 点正文 / ⌨）收起时**面板内容保持原样**（`data-open=1`，不播滑出/淡出；`data-closing=1` 只关掉 pointer-events），键盘从面板上方滑上来把它盖住；`keyboardOpen`（视口收缩）后 150ms 再卸载。输入法迟迟不来（硬件键盘 / 焦点失败）时 **1800ms** 放行滑出（2.5s 兜底仍负责最终卸载）。
- **设备验收**：逐帧 DOM 采样（rAF）—— 收起全过程 `data-open` 保持 `1`、`.med-panel-inner` transform 恒为 identity / opacity 1，直到 `keyboardOpen` 后 150ms 才卸载（实测 t=831ms 视口 530、t≈970ms 卸载）；面板高度与工具栏位置全程不动（56px 工具条 474–530）。实拍：键盘上升时面板内容仍在、被键盘逐行盖住（`.css-audit/mobile-props-261019/{dock-hold-mid,dock-hold-end}.png`）。
- **护栏**：`dockPanelFocusGuard.test.ts` 新增 1 例（closingHold 置位/失效 + data-open/data-closing + pointer-events 规则）；`mobileLayers` editor-dock.css 257 → **258**。
- **门禁**：tsc 0 · vitest **292 文件 / 2166 例**（含并行会话在途用例）· 双端构建 ✓ · ui-metrics / core / mobileui / bundle / diff-check ✓。
- **未改（有意）**：反向（键盘→面板）没动 —— 用户说「看着还行」；要做逐帧对齐得接原生 IME 控制器，单独立项。
- **状态**：未提交/未推送（待用户验收）。工作区仍有并行会话未提交改动（`mobile/{bitable,board,usheet}` viewer preset、`usePanelDrag`/手势等）—— 验收与提交必须分开。

### 261019(七) · 修「工具栏展开跑到键盘上边」：路由层 transform 把 fixed 包含块改成 layer · **待用户验收**

- **现象（用户报 + 截图）**：文档编辑态点「Aa」/「＋」，面板停在键盘上方（实测面板 **282–562**），下面空 280px；正常应**覆盖键盘让出的区域**（面板 562–842）。
- **根因（设备实测）**：261019 的路由转场给 `.mobile-route-layer` 加了**常驻** `transform`（+ `will-change: transform`）⇒ `position: fixed` 的包含块从**视口**变成 layer 盒，而 layer 高度 = `--mb-app-h` = 稳定外壳高 − 键盘/面板占用（面板态实测 562，视口 842）。于是 dock 的 `.med-panel`（bottom:0; height:--kb-offset）与 `.med-toolbar`（bottom:--kb-offset）整体上移一个键盘高。**为什么此前没抓到**：面板装置（insert-panel-geometry 等）跑的是小记/首页层（无 transform），只有文档工作区层复现。
- **修法（最小）**：入场动画播完给工作区层挂 `is-settled` ⇒ `transform:none; will-change:auto`。`useRouteTransition` 新增 `settled`（240ms + 50ms 后置位；出场开始即失效），`MobileApp` 按 `wsSettled` 加类。**入场/出场期间仍保留 transform**（转场与抽屉裁切都依赖它）；出场时 `.is-open` 移除 ⇒ 自动回到 `translateX(100%)` 播出场。
- **设备验收（emulator-5554 / 412×842）**：面板 `rect=[0,562,412,280]`（bottom=842）· 工具栏 `[0,506,412,56]`（bottom=562）· `layer.transform:none` + `is-settled` 生效。入场实测 80ms 时 `matrix(…,412)`（动画在播），700ms 后 `none`（落定撤掉）。实拍 `.css-audit/mobile-props-261019/dock-fixed.png`（gitignore）。
- **护栏**：`useRouteTransition.test.ts` 新增 1 例（settled 置位/失效 + CSS 撤 transform + MobileApp 类名）；`mobileLayers` mobile.css 1340 → **1342**（+2，写明 fixed 包含块回视口）。
- **门禁**：tsc 0 · vitest **291 文件 / 2164 例**（含并行会话在途用例；本批 +1 例 / +2 声明）· 双端构建 ✓ · ui-metrics / core / mobileui / bundle / diff-check ✓。
- **状态**：未提交/未推送（代码批次待用户验收）。⚠️ 工作区同时存在**并行会话**的未提交改动（`mobile/{bitable,board,usheet}` 只读查看器 preset：`mobileUniverPreset.ts` 等）—— 验收与提交时必须分开，别混作一批。

### 261019(六) · 移动端两处点单：目录行菜单去重复「新建」+ 文档属性适配手机 · **待用户验收**

- **需求（用户点单，附设备截图）**：① 目录行 ⋮ 菜单移除「新建文档 / 新建分组」（行内 ＋ 已有同一份新建清单）；② 属性页面要适配手机。
- **① 改法**：[NotebookWorkspace.tsx](lake-notes-electron/src/mobile/notebook/NotebookWorkspace.tsx) 的 `treeMenuItems` 删掉 `new-note` / `new-group` 两项与 `onTreeMenuSelect` 的对应分支；创建通道不变（行内「新建子项」＋抽屉工具栏「新建」→ 同一份 5 项清单：文档/分组可建、表格/数据表/画板仍置灰）。菜单只剩「对这一行本身的动作」：重命名 / 设置图标 / 设为常用 / 移动到… / 历史版本 / 属性 / 移入回收站。
- **② 根因（设备实测，不靠目测）**：`NoteInfoSheet` 内容区 `.minfo` **没有横向内距** ⇒ 实测 `dt.left=0 / dd.right=412 / 操作按钮右缘≈412`，标签与数值/按钮全贴屏幕边，观感像"被裁掉"。修法：`.minfo { padding: 0 var(--mb-page-pad) }`（16px，与 sheet 头部同档）；行密度/字号/分区线不动（分区线随内容一起内缩）。
- **设备验收（emulator-5554 / 412×842）**：行 ⋮ 实测 **9 项 → 7 项**（新建两项消失、其余逐项一致）；属性页实测 `padding: 0px 16px`、`dt.left=16`、`dd.right=396`、`docScrollW=412`（无横向溢出）。实拍（before/after/菜单）见 `.css-audit/mobile-props-261019/`（gitignore，不入库）。
- **护栏**：`workspaceMenu.test.ts` 增「行 ⋮ 不再有新建」；新增 `ui/noteInfoSheet.test.ts`（内距必须用 `--mb-page-pad` + 清单必须来自 `core/noteInfo`）；`mobileLayers` mobile.css 1339 → **1340**（+1，写明是补缺失内距）。
- **门禁**：tsc 0 · vitest **290 文件 / 2161 例** ✓（+1 文件 / +3 例）· 双端构建 ✓ · ui-metrics ✓ · check:core ✓ · check:mobileui ✓ · check:bundle ✓ · `git diff --check` ✓。
- **AGENTS 合同同步**：§4「移动端入口分工」的行 ⋮ 清单改为「重命名/设置图标/设为常用/移动到…/历史/属性/删除」，并注明新建统一走 ＋。
- **未跑**：`check:mobilesnap` 6 态 —— 本次改的两个面都**不在 6 态覆盖内**，按 AGENTS §3#21② 只做定点设备验证。
- **状态**：**未提交 / 未推送**（代码批次待用户验收）。

### 261019(五) · 小记编辑器冷启动「正在加载编辑器…」闪一下（含长按新建小记）· **待用户验收**

- **现象（用户报）**：每次新打开 App，点「编辑小记」（长按新建小记同一条路）都会先闪一个「正在加载编辑器…」页，很快消失。
- **根因**：`QuickNoteComposer` 一直走 `React.lazy` 懒加载；冷启动没预取 ⇒ Suspense fallback。**而且即使分包已预取，
  React.lazy 首次渲染仍会抛一次 fallback**（实测仍有 4 帧 / 43–89ms）⇒ 光预取消不掉这一下。
- **修法**：
  1. 新增自研加载壳 [quickNoteComposerLazy.tsx](lake-notes-electron/src/mobile/home/quickNoteComposerLazy.tsx)：模块级缓存 + 订阅通知；
     **预取完成 ⇒ 同一帧同步渲染（零 fallback）**；没赶上则先画写作卡骨架、模块到即替换（不再走 Suspense）。HomePage 与 capture 两处共用。
  2. `scheduleComposerPrewarm()`：bridge 就绪 effect 里**立即排空闲**预取分包（只 import、不实例化内核；内核预热仍是 4s 独立排期，不合并）。
  3. 兜底从「正在加载编辑器…」文字页改为 `.mb-composer-skeleton`（写作卡骨架，复用 `mb-skel`）。
- **实测（AVD，三次）**：就绪后 500ms / 1000ms / 2000ms 再点开写作卡，**fallback（骨架）帧均为 0**；打开耗时 0.38–0.98s，
  差异来自"内核首次实例化是否已被 4s 预热覆盖"（分包加载已不在关键路径上）。
- **护栏**：新增 `composerPrewarm.test.ts`；`kernelPrewarm` / `quickNoteCapturePath` / `sharedContent` / `mobileLazyChunks` 的断言同步到新加载壳
  （仍钉住"分包只走动态 import、内核不进入口 chunk"）。
- **门禁**：tsc 0 · vitest **287 文件 / 2153 例** ✓ · ui-metrics / core / mobileui / bundle / diff-check ✓；
  快照因分包/样式预取时机变化改了 `home-doc` 指纹（元素数不变）⇒ **重烤基线**；随后返回键修复又因**重灌夹具产生新文档 id**
  （`home-doc` 指纹里带文档节点 id，README 已记录）再次重烤，冷启动两次 6 态 0 差异 ✓。
- **偶发空白修复（同日用户报「从常用进文档偶发一片空白」，重启后无法复现）**：定位到并发恢复 + LRU 淘汰的竞态——
  `openTab` 里淘汰判据传的是**刚加入的那条 tab 的 id**（`activeNoteId: id`），而恢复历史标签是并发的：用户点开的目标文档先落地后，
  随后到达的历史标签可能把它当成 LRU **淘汰掉** ⇒ `activeId` 还在、tab 已没了 ⇒ 正文空白/只剩骨架（能否触发取决于历史标签数量与读取完成顺序，
  所以是偶发）。修：① 淘汰一律保护 `activeIdRef`（当前活动页），不是刚加入的那条；② 自愈——活动页既不在 tabs、也没有在途读取时落到第一个标签；
  ③ `pendingIdsRef` 记录在途读取，供自愈判断。护栏 `lazyPaneMount.test.ts` 增 1 例。
  设备复现（给「个人笔记」预置 8 个历史标签，再点常用里的第 9 篇）：修复后 active 正常落在目标文档（多维表内容可见）、panes 稳定 8、无空白。
- **标签页「关闭全部」（同日用户点单）**：标签页抽屉标题右侧新增「关闭全部」按钮（有标签时才显示，位置在 × 左侧）。
  点击：清空 tabs、丢弃所有编辑器句柄（防泄漏）、活动页置空、关闭抽屉；localStorage 标签保持随之写为 `[]`。
  另加 `tabEpochRef` 代际守卫——在途 `readNote` 回来时代际不一致就丢弃，避免"关了又被异步加回来"。
  设备实测：8 个标签 ⇒ 关闭全部 ⇒ `panes 0` / 空态 / 抽屉关 / 键 `[]`；随后从目录重开一篇 ⇒ `panes 1` 且正文正常。
  护栏 `closeAllTabs.test.ts`（3 例）；`mobile.css` +12（按钮基样式 + 按压态）；快照 6 态 0 差异。
- **返回键修复（同日用户报）**：小记写作/编辑中按 Android 返回键会**直接退 App**。修：HomePage 在 composer 非空时往统一返回栈
  `pushBackHandler` 注册处理器 ⇒ 返回先**关闭写作卡**（与「取消」同语义），效果卸载时自动摘除；排序/「...」/新建面板等浮层仍在上层先消费。
  设备实测：编辑中按返回 ⇒ composer 关闭、回首页、App 仍在（mCurrentFocus 仍是本应用）。护栏 `composerBack.test.ts`。
- **仍存在的耗时（如实记录）**：内核**首次实例化**那段仍在（未预热时 0.6–1s；4s 预热后 62–73ms）。想再快只能把内核预热提前，
  但实测那是一次 ~1.7s 长任务、会砸在首屏交互上（见 `kernelPrewarm.ts` 头注释），本批**没有**动它。
- **状态**：已提交并推送 origin/master（ae757584）。

### 261019(四) · 移动端知识库改版：**常用**分组（仅设备本地）+ 删除「最近文档」· **待用户验收**

- **用户点单（4 条）**：① 知识库页顶部固定「常用」分组，带三角可收起/展开，展开用与"最近"相同的卡片、多个靠**左右滑动**；② 删除最近访问、手机端**不存**该记录；③ 目录行菜单加「设为常用」；④ **仅手机端**、不同步、不触发 S3、桌面零改动。
- **实现**：
  - 新增 [favorites.ts](lake-notes-electron/src/mobile/data/favorites.ts)：本机 `localStorage`（`lake-notes-mobile.favorites` / `.favoritesOpen`）+ 同端内存事件；**不 import bridge / S3 / 同步模块** ⇒ 不触网、不进 manifest、桌面不感知。
  - [HomePage.tsx](lake-notes-electron/src/mobile/home/HomePage.tsx)：删除「最近文档」（`recentNotes` 派生 + JSX 整体移除），顶部新增「常用」：标题 + 三角按钮（`aria-expanded`，本机持久化展开态），展开为横排纸卡（复用 `.doc-card`，容器 `.home-card-row` 横向滚动）；**没有常用时整个分组不渲染**；卡片只展示仍存在于库里的文档。
  - [NotebookWorkspace.tsx](lake-notes-electron/src/mobile/notebook/NotebookWorkspace.tsx)：目录行 ⋮ 菜单在「设置图标」之后新增 **「设为常用 / 取消常用」**（Star 图标，**只对文档行**，分组没有），点击写本地 + toast；首页通过事件即时刷新。
  - 顺带把 `.home-recent` 类名改为 `.home-card-row`（彻底告别"最近"语义）。
- **「最近访问」存储核查**：手机端**从未持久化**最近访问记录（原「最近文档」= 按 `updatedAt` 现算，不写库）；唯一沾边的本机持久化是**标签页保持**（`lake-notes-mobile.tabs.<notebookId>`，记录打开过哪些 tab），属另一功能，本批未动。
- **设备验收（lake_mobile / 5554）**：目录菜单「设为常用」两条 ⇒ 首页「常用」2 卡；收起（卡片 0 / aria-expanded=false / 键=0）→ 展开恢复（键=1）；**重启后仍在**；注入 6 个真实文档 id 验证横滑（`scrollWidth 524 > clientWidth 412`，scrollLeft 112）；首页已无「最近文档」；已收藏文档的菜单显示「取消常用」。
- **用户复验（同日）报「从常用进入文档会闪一下，退出也会」**：CDP screencast 逐帧定位到根因 —— 路由层自身带 transform，
  而工作区左右抽屉是 `position:fixed + translateX(±100%)`（fixed 因此以 layer 为包含块）；**layer 在 push/pop 整体位移时，
  off-canvas 的文档树抽屉会探进视口**（实测 push 到 layer x=58 时整块文档树可见，还带着「暂无文档，点右上新建」空态）⇒ 就是那一下"闪"。
  修法：`.mobile-route-layer { overflow: hidden }`（按 layer 边界裁切）；抽屉正常展开时在 layer 内，不受影响。
  复测同一流程 screencast：不再出现抽屉/空态帧；文档树仍可正常打开（x=0 / 宽 354）、文档正常加载。
- **性能追加（用户点单"只优先挂当前文档、其余标签后台加载"）**：
  - 工作区恢复历史标签时**只挂当前页的正文分量**（`mountedIds`）：历史标签先只读数据/登记、不激活，切到它时才挂（挂过就 keep-alive）；
  - 恢复顺序改成"**当前文档的 readNote 先发**"，别被其它历史标签的读取拖在队头；
  - `openNote` 改为**先起转场、再后台 refreshAll**（原先 `await refreshAll()` 挡在 `setRoute` 前 ⇒ 实测点击到 push 多等 ~700ms，观感像"点了没反应"）；
  - 活动页未挂载期间继续显示骨架（避免 tab 已就绪但正文未挂载时露出空白）。
  - 设备实测（同一台 5554）：改成初始只挂 **1** 个编辑器（原来恢复 8 个标签会同时起 8 个内核/Univer 实例）；骨架从 ~1s 缩到 **~150–300ms**，点击到内容约 **0.5s**（冷启动首次仍受工作区分包加载影响）。
  - 护栏：新增 `lazyPaneMount.test.ts` 3 例（挂载集合/渲染条件、历史标签不激活且活动页先读、活动页补挂载与回收）。
- **门禁**：tsc 0 · vitest **286 文件 / 2150 例** ✓（新增 `favorites.test.ts` 5 例 + `lazyPaneMount.test.ts` 3 例）· ui-metrics / core / mobileui / bundle / diff-check ✓；
  `mobile.css` 基线 1305→**1316**（+10 = `.home-section__toggle`；+1 = 路由层裁切）；快照基线**重烤**（「最近文档」删除 ⇒ 每态 **-29 元素**；layer 裁切 + 正文懒挂载另改 `home-doc` 指纹、元素数不变），冷启动两次 6 态 0 差异 ✓。
- **状态**：已提交并推送 origin/master（ae757584）。

### 261019(三) · 移动端阅读动效：顶栏/底栏自动收起 + 转场骨架/正文淡入 · **待用户验收**

- **需求（用户点单下一批）**：① 思源式「阅读时顶栏/底栏自动收起」；② 语雀式「转场骨架 + 内容淡入」（先测白闪）。
- **② 白闪实测结论**：正文是异步 `bridge.readNote` 读回；**旧文档会一直保留到新内容就绪**（切 tab 不会先白屏再蹦字）。
  真正会露出空白的两个窗口：**(a) 首次进入工作区**（工作区按需分包，Suspense 兜底原为「加载中…」文字）；**(b) 点到尚未读回的文档**（active 已切、tab 还没进 tabs）。
  ⇒ 两处都改成**文档骨架**（复用 `.mb-skel` 呼吸），并给刚读回的那一页加 **150ms 正文淡入**（`.doc-pane--fresh`，260ms 后清标记；切回旧 tab 不重播）。
- **① 实现**：
  - 新增 [scrollChrome.ts](lake-notes-electron/src/mobile/notebook/scrollChrome.ts)（纯函数判据，单一来源）：顶部 ≤24px 一律展开；**向下累计 ≥24 收起**；**向上累计 ≥12 展开**（回翻更灵敏）；反向滚动清零。
  - [NotebookWorkspace.tsx](lake-notes-electron/src/mobile/notebook/NotebookWorkspace.tsx)：用**捕获**监听 `.mobile-doc-body` 的滚动（scroll 不冒泡），**只对 kind=doc 且非编辑态**生效；
    顶栏加 `.mobile-topbar--auto-hidden`（高度 44→0 + margin/padding/border/opacity 过渡 150ms ⇒ 正文自然上移，不改 position），底部胶囊复用既有 `--hidden`；`aria-hidden` 同步；
    **切文档 / 进出编辑 / 打开任意浮层（目录、标签、大纲、切换笔记本）→ 复位展开**（要操作时导航必须在）。
  - **删掉旧的 8px 阈值 `navHidden` 监听**（上一版只藏胶囊、无顶栏、阈值过灵）——避免两套判据并存。
- **设备验收（lake_mobile / 5554）**：注入长内容造滚动（仅测试用，已清理）——
  下滚 120 ⇒ 顶栏高度 **44→0**、胶囊 `--hidden`、`aria-hidden=true`、正文高度 **790→842**（回收空间）；上滚 40 ⇒ **立即恢复**；回到顶部恢复；
  **编辑态下滚动不收**（顶栏恒 44，胶囊由既有编辑态逻辑隐藏）。
- **门禁**：tsc 0 · vitest **284 文件 / 2142 例** ✓ · ui-metrics / core / mobileui / bundle / diff-check ✓；
  新增 `scrollChrome.test.ts` 4 例（判据 + 接线 + CSS + 骨架/淡入）；`mobileLayers` mobile.css 1272→**1305**、dupGroups 4→**6**（reduced-motion 登记模式，已写理由）；
  快照基线**重烤**（元素数不变、指纹变化），冷启动连跑**两次 6 态 0 差异** ✓。
- **状态**：已提交并推送 origin/master（ae757584）。

### 261019(二) · 移动端动效：首页↔工作区**路由转场** + 按压反馈统一（对齐语雀/思源）· **待用户验收**

- **需求**：用户要求先实际体验语雀 / 思源 App，找可借鉴的动效，确认后「都做」= P0 页面转场 + P2 按压反馈。
- **取证**：
  - 语雀（真机操作 + 录屏逐帧）：列表点开文档 = **新页自右滑入 + 旧页 25% 视差**，帧时间 1.11s → 1.29s ⇒ **≈200ms**，到位前内容是骨架、随后淡入；返回反向。
  - 思源（真机操作 + 源码 `_mobile.scss`）：顶/底栏滚动收起用 `translate3d(0, var(--mobile-bar-translate-y),0)` + `opacity` + `will-change`；
    底栏条目 `:active { transform: scale(.92) }`、80ms ease；抽屉/弹层 150ms `cubic-bezier(0,0,.2,1)`（我们已是 150ms 口径，**不动**）。
- **落地**：
  - 新增 [useRouteTransition.ts](lake-notes-electron/src/mobile/hooks/useRouteTransition.ts)（状态机 + 单一来源）：工作区**按需挂载**、出场播完才卸载；
    首页层**常驻**（页栈语义 ⇒ 返回时列表滚动/数据都在）；非活动层 `inert` + `aria-hidden`；`prefers-reduced-motion` 下等待 0ms。
  - `MobileApp`：路由区改两层 `.mobile-route-stage / .mobile-route-layer`；返回统一走 `closeWorkspace`（**顶部返回按钮与 Android 硬件返回键同一条路**）。
  - [mobile.css](lake-notes-electron/src/mobile/mobile.css)：新页 `translateX(100%)→0`、旧页 `0→-25%`，240ms = `--lake-motion-slow` + `--lake-ease-standard`；
    reduced-motion 关闭位移。按压反馈统一：底色/颜色过渡 80ms（`--mobile-duration-press`）+ **紧凑条目** `scale(.98)`（整行列表只做底色，整行缩放不采用）。
  - 护栏 [useRouteTransition.test.ts](lake-notes-electron/src/mobile/hooks/useRouteTransition.test.ts) 4 例（时长/0ms、MobileApp 接线、hook 语义、CSS 位移与降级）；
    `mobileLayers` mobile.css 基线 1253 → **1270**（+17；dupGroups 3 → 4 = `.mobile-route-layer` 在 reduced-motion 里关 transition，沿用 `.mb-skel` 的无障碍登记模式）。
- **设备验收（lake_mobile / 5554）**：push 后首页层 `matrix(...,-103,0)`（= 25%×412）+ `inert=true`；返回（点按 / 硬件键）出场播完层数 2→1、首页 transform 复位；
  写作卡仍在首页层内（`inHome=true`）且 tab 横滑锁定不回归；设置抽屉 / 新建面板 / 返回键均正常。
- **设备快照门禁（已重烤）**：首页常驻 ⇒ `home-doc` 1880 → **2019**（+139 = 首页被盖住但仍在 DOM），其余态 +2（路由两层）；
  重烤 `scripts/mobile-audit/baseline/mobile-snap.json`，冷启动连跑 **两次 6 态 0 差异** ✓。
- **门禁**：tsc 0 · vitest **282 文件 / 2136 例** ✓ · ui-metrics / core / mobileui / bundle / diff-check ✓。
- **用户复验（同日）抓出两处问题，已在同批修掉**：
  1. **多维表页面透出首页卡片**：工作区层原本透明，而首页层常驻在它下面 ⇒ 表格/多维表页面内部的透明容器
     （`.mobile-bitable` / `.mbt-grid-wrap` / `TABLE` 都是透明底）把首页卡片透出来。修：
     `.mobile-route-layer--workspace { background: var(--lake-bg-canvas) }`（与多维表/表格 canvas 同一令牌，暗色主题同源）。
  2. **表格页底部重叠**：Univer 自带底部工具条（工作表标签 / 缩放 / 求和，**实测 36px**）贴着屏幕底，
     工作区胶囊把「Sheet1」压住。修：`active.kind === "usheet"` 时给胶囊加 `.mobile-bottom-bar--above-sheet`，
     `bottom` 增加令牌 `--mobile-sheet-bar-h: 36px`（不写魔法数字）；实测胶囊 y 718–774、Univer 底栏自 806 起（32px 间隙）。
  - 护栏：新增 `sheetBottomBar.test.ts` 2 例 + `useRouteTransition.test.ts` 补「工作区层必须不透明」断言；
    基线 `tokens` 192→**193**、`mobile.css` 1270→**1272**；快照基线因 `home-doc` 指纹变化（元素数不变）**再次重烤**并冷启动两次 0 差异。
- **未做（有意）**：语雀式"转场时先画骨架再淡入"（P1，需先测我们打开文档是否有可感知白闪）；思源式顶/底栏滚动收起（P1，涉及 dock/键盘互斥，另立项）。
- **状态**：已提交并推送 origin/master（ae757584）。

### 261019 · 移动端首页切换改**原生横向分页**（对齐语雀；含写作中误滑丢草稿修复）· **待用户验收**

- **同一轮解决两件事**：① 用户报「写小记时不小心左右滑了一下就切 tab」（写作卡被清 = 草稿丢失）；② 用户给语雀 App 录屏，要求「切换太硬，模仿一下」。
- **取证**：
  - 录屏（1220×2656 / 24.3fps / 11.4s）逐帧：两页**并排整体横移**（不是单页淡入/瞬切），约 0.6–0.7s 平滑落位；
  - 语雀 APK（`assets/index.jsbundle`，Hermes）字符串含 `react-native-tab-view` / `react-native-pager-view` / `swipeEnabled` / `onPageSelected`
    ⇒ 形态 = **原生 ViewPager2 跟手分页**（手指拖动跟手、松手吸附）。
  - 旧实现 = 自研 document 级 `touchstart/move` + 60px 阈值**到点即切**（无跟手、无吸附）= "太硬"；且切 tab 会触发父级 `useEffect([tab])` 清掉 composer。
    实测中招点不是正文（`contenteditable` 本就被排除），是**写作卡正文下沿到按钮之间的空白区**（100+px，y≈289–393）。
- **实现**：
  - `HomePage.tsx`：舞台改**两页常驻**的横向滚动容器（`.mobile-tab-pane` ×2），不再按 tab 条件渲染、不再 `key={tab}`；
    `scrollend`（+120ms 去抖兜底）把页码回写成 tab；tab 变化 → `scrollTo(smooth)`；宽度变化（ResizeObserver）立即重对齐；
    非活动页 `inert`；`prefers-reduced-motion` 下改为 `auto`。
  - 新增 [tabPager.ts](lake-notes-electron/src/mobile/home/tabPager.ts)（纯函数：`tabIndex / tabAt / pagerScrollLeft / settledIndex`，四舍五入 + 夹紧）——
    判据单一来源，DOM 交互只在 HomePage。
  - [mobile.css](lake-notes-electron/src/mobile/mobile.css)：`.mobile-tab-stage` = `overflow-x:auto` + `scroll-snap-type:x mandatory` + `overscroll-behavior-x:contain`；
    `.mobile-tab-pane` = 100% 宽 + `scroll-snap-align:start` + `scroll-snap-stop:always`。
  - **删除** 上午那版 `useHorizontalSwipe`（已被分页取代；`data-prevent-swipe` 仍服务抽屉手势 / 弹层右滑关闭）。
- **三个实测坑（修法均已验证）**：
  1. **ResizeObserver 不能每次 tab 变化重新 `new/observe`**：observe 会立刻回调一次，紧跟 smooth 之后执行 `auto` 对齐 ⇒ 点 tab **瞬跳**（实测 scrollLeft 直接 412→0）。改为独立 effect 只挂一次。
  2. **`.mobile-scroll` 的两轴 `overscroll-behavior: contain` 会吃掉横向手势链**：内层竖滚容器把"向左翻页"吃掉（实测负向手势完全不翻页、无 scroll 事件）。
     改为**只收纵向** `overscroll-behavior-y: contain`（纵向语义不变；舞台自己 `-x: contain` 防浏览器返回手势）。
  3. **写作锁不能只写舞台 `touch-action`**：touch-action 只按"最近滚动容器"取交集，内层 `.mobile-scroll` 才是最近容器 ⇒ 横向手势照样链上去翻页
     （实测锁定时左滑仍切走 + composer 被清）。锁定态 = 舞台 `overflow-x:hidden` **+ 内层 `.mobile-scroll` 也 `touch-action:pan-y`**。
- **用户复验反馈（261019 二次）**：「动效有了，但顶部切换有点慢，会瞬时出现"页面已经是小记、标签着重的还是知识库"」。
  修法（同一批内收口）：**① 回写时机从 `scrollend` 改为"滚动过半即回写"**（标签始终跟多数可见页，不再等吸附结束）；
  **② 程序化滚动期间压住回写**（`programmaticRef`：点 tab / 宽度重对齐的动画开头 `scrollLeft` 仍靠近旧页，
  实测会把标签弹回旧页再跳回来）；**③ 触摸期间不做程序化对齐**（`interactingRef`，避免跟手指抢滚动）。
  实测：点 tab 标签**立即**正确且全程不回弹；手势翻页（右滑）在手势结束前标签已切到目的小记。
- **设备验收（lake_mobile / 5554 / 412×842；原生滚动用 `Input.synthesizeScrollGesture`）**：
  - 左滑 260px ⇒ 412 / 知识库；右滑 260 ⇒ 0 / 小记；**短滑 120/160/200px（未过半、无惯性）⇒ 吸附回原页**；过半 260 ⇒ 翻页；
  - 点顶部「知识库」⇒ scrollLeft 平滑曲线 `0→1→7→19→38→64→96→134→175→218`（≈300ms），不再瞬跳；
  - 页面纵向滚动正常；两页 `inert` 正确切换；
  - **写作中**：`locked=true`（overflow-x hidden / pan-y），左滑、右滑都留在「小记」、composer 仍在（修复前：左滑 = 切走 + 草稿被清）；点「取消」后横滑恢复翻页。
- **设备快照门禁（已重烤）**：两页常驻 ⇒ 首页/设置态构成变化（home-library 1791→**1843**、home-quicknotes 1800→**1843**、home-library-list 1767→**1819**、
  home-doc 1880、settings 1878→**1921**、settings-appearance 1827→**1870**）⇒ 按 §3#21③ **重烤基线**（`scripts/mobile-audit/baseline/mobile-snap.json`），
  冷启动连跑 **两次 6 态 0 差异** ✓。（`lake_gate` / 5556 / CDP 9336；夹具 5 文档 + 4 小记。）
- **门禁**：tsc 0 · vitest **281 文件 / 2132 例** ✓（tabPager 3 例 + 首页分页护栏 1 例替换原横滑断言）· 双端构建 ✓ · ui-metrics / core / mobileui / bundle / diff-check ✓ ·
  `mobileLayers` mobile.css 基线 1235→**1253**（+18，分页交互形态新增，已写明理由）。
- **装置知识（已入库）**：`scripts/mobile-audit/README.md` 新增「原生滚动 / 横向分页的 CDP 验证」——
  `Input.dispatchTouchEvent` 只到 JS、不驱动原生滚动；原生滚动用 `Input.synthesizeScrollGesture`（复核"未过半吸附"要 `preventFling:true`）。
- **状态**：已提交并推送 origin/master（ae757584）。

### 261017(十七) · S3 配置导入导出（文件为主；桌面 → 手机）· **待用户验收**

- **需求（用户 261017）**：桌面端已有一份可用 S3 配置，导出一份到手机导入，省去安卓端逐项手填；做法参考思源「导入 / 导出 S3 同步配置」。
- **口径（用户二次定稿）**：**导出一个文件**——桌面写 `.json` 配置文件，发送到手机后手机选文件导入；迁移码降级为**备用**（手机「导出迁移码」→ 桌面「粘贴迁移码…」）。其余同思源：一键导出、导入覆盖本机 S3 配置（**同步策略不动**）。
- **单一来源** [s3ConfigTransfer.ts](lake-notes-electron/src/core/s3ConfigTransfer.ts)：迁移码 `LNS3.1.<base64url(iv||AES-GCM 密文)>`；文件 = 外层 JSON 元数据 + 内层迁移码（`encode/decodeS3ConfigTransferFile`，兼容直接放迁移码的 `.txt`）；AES-GCM 带认证；**固定种子只是防误读 / 防随手转发的封装，不是安全边界**（文件头写明；怀疑泄露请轮换 S3 密钥）。导出拒绝无 Secret / 非法配置；导入规范化 endpoint、region 缺省、强制 https，`forcePathStyle` 原样返回由端侧决定。
- **桌面**：IPC `export_s3_config_file` / `import_s3_config_file`（**主进程**弹系统保存/选择框 + 加密封装/解码/落库，渲染层不接触明文 Secret，延续 W-14）；保留 `import_s3_config` 作粘贴备用。主进程文件工具 [s3ConfigTransferFile.ts](lake-notes-electron/electron/s3ConfigTransferFile.ts)（0600 落盘、64KB 上限）；粘贴弹窗 [S3ConfigImportDialog.tsx](lake-notes-electron/src/components/app/S3ConfigImportDialog.tsx)（标准 `<Dialog>`）；S3 设置「配置迁移」Block = 导出到文件… / 从文件导入… / 粘贴迁移码…；IPC 三方一致性基线 118 → **119**（删 export_s3_config、加两个文件通道）。
- **移动**：同步设置「配置迁移」= **从文件导入**（`pickLocalFile` → core 解码 → `bridge.saveS3Settings` 同一路径；强制 `forcePathStyle:false`（D2）并在提示里说明）+ **导出迁移码**（备用；桌面粘贴导入）。多行输入修饰 `.mb-input--multiline`（kit 基线 511 → 517）。
- **测试 / 门禁**：core 12 例（往返 / 文件包装 / 兼容 .txt / 防泄漏 / 篡改 / 空 / 超长 / 非法配置 / 规范化 / 文件名 / 摘要）+ electron 文件助手 3 例；tsc 0 · 全库 vitest **280 文件 / 2127 例** ✓ · 双端构建 ✓ · ui-metrics 0（字号字面量 49/49）· core / mobileui / bundle / diff ✓ · cssLayers dialog 204→238、mobileLayers kit 517、settingsSearch 同步登记。
- **实测**：桌面隔离实例（scheme + CDP 9234）真实 UI：点「导出到文件…」弹出系统保存框，保存得到 **585B / 0600 / 无明文**的 `.json`；先把桶改成探针值，再点「从文件导入…」选中该文件 ⇒ 落库与表单都恢复为文件里的配置、状态栏提示正确。`lake_gate` 模拟器（5556 / CDP 9336）：真实文件选择器（CDP 注入 App 私有目录文件）导入成功，6 个字段回填、toast「S3 配置已导入」、Path-style 提示；「导出迁移码」仍可用且码内无明文。
  ⚠️ **遗留 / 环境问题**：该 AVD 上 `am force-stop` / 重启后 `localStorage` 只剩 `libraryView` —— 直接 `localStorage.setItem` 探针同样丢，**与本批无关**（既有 S3 手填保存 / 主题 / 排序同受影响），判断为该 `lake_gate` 实例的 WebView localStorage / leveldb 复现性问题；**冷启动持久化需真机复验**。
  该实例已重装 debug 包并留下探针 S3 配置 ⇒ **跑移动快照门前按 README 重灌夹具**。
- **同日追加（用户点单）**：S3 设置页顶部新增「**第三方 S3 服务说明**」（对齐思源：浅底提醒块 + 标题 + 计费/技术限制/条款清单 + 免责声明），并按用户要求加一句**着重提醒**：笔记正文/附件按原样上传、云端不加密，务必确认桶为私有且未开放公开读（amber 文字 + `TriangleAlert` 图标）。桌面 `.s3-service-notice`（[feature.css](lake-notes-electron/src/styles/feature.css) +22，基线 266→288）、移动 `.mb-s3-notice`（[kit.css](lake-notes-electron/src/mobile/kit.css) +22，基线 517→539）；两端各自样式层、不共享。设备实测：桌面设置页与 `lake_gate` 设置页均显示完整说明 + 3 条清单 + 着重提醒；证据 `.css-audit/s3-transfer-261017/notice-{desktop,mobile}.png`。门禁同批全绿（合并后 280 文件 / 2128 例）。
- **状态**：已合并 master 并推送 `origin/master`（merge commit `d3e17f74`；同批带上 261017 B 批 + 固定目录高度修复）；本地 `feat/s3-config-transfer` 分支保留。

### 261017(十六) · Git 历史重写（清除旧 AK/SK）

- **范围**：`git filter-repo --replace-text` 全历史替换两个旧七牛 AK/SK 为 `***REMOVED***`；`master` 已 force-push 到重写后的 `e4a3c007`；`origin/main` 基线分支经检视不含该密钥，未重写。
- **验证**：`git log -S/-G` 两个密钥均为空；`git fsck --unreachable` 空；`git reflog expire --expire=now --all && git gc --prune=now`；全部 **8811 个 git blob** 内容扫描 **leaks=0**。
- **注意**：所有 261017 之前的 **commit hash 已变化**，文档里的旧 hash 仅作历史叙述；新克隆/协作者必须重新拉取，不要用旧 reflog/bundle。
- **未能保证**：远端旧对象/其他克隆/服务器缓存可能短时间仍可访问 ⇒ **旧 key 仍应轮换**（唯一彻底办法）。
- **备份**：重写前 bundle 已生成，验证通过后**已删除**（含旧密钥，不留在仓库/临时目录）。
- **状态**：已提交（见 git log）。

### 261017(十五) · D3/D7 收口（移动端 endpoint 规范化/校验 + region 缺省）

- **D3**：移动端复用 core 的同一套 S3 配置边界：
  - client 工厂 `createMobileS3Client` 对 endpoint 走 `normalizeEndpoint`（补 https / 去尾斜杠 / 修重复协议）；
  - 原生资产配置 `NativeAssetSync.configure` 同样规范化；
  - `saveS3Settings` 落库前 `normalizeEndpoint + validateS3Settings`（非空 + **强制 https**，localhost 例外），失败抛错；
  - `getS3Settings` 读取旧值时也规范化（设置页显示 / 测连通 / 真同步同一口径）；
  - 设置页保存/测试连接改为 `try/catch`，失败在「测试连接」行显示「保存失败: …」。
- **D7**：`region?.trim() || "cn-east-1"` 统一到 client 工厂 / 原生配置 / 保存 / 读取四处，与桌面一致。
- **护栏**：`s3PortGuards` 新增 D3/D7 源码级检查（保存必须 normalize+validate、工厂必须 normalize endpoint + region 缺省）。
- **说明**：D2 已定稿不做 path-style，强制 https 不会误伤自建 MinIO（本来就不在移动端支持范围）；localhost 例外保留给开发。
- **门禁**：tsc 0 · 全库 vitest **276 文件 / 2098 例** ✓ · 双端构建 ✓ · ui-metrics 0 · diff-check 0；纯配置边界，无视觉/设备门禁。
- **状态**：已提交（见 git log）。

### 261017(十四) · 收尾审查（全量改动复核 + 安全清理）

- **复核范围**：C3-2 四桶搬迁 / C3-5 六域拆分 / C1-5 时间措辞 / C1-6 只读共享 / D2/D5 / 移动基线重烤 / 全部文档回填。
- **全量门禁**（最终一次）：tsc 0 · vitest **276 文件 / 2097 例** ✓ · 桌面+移动双构建 ✓ · ui-metrics 0 · check:core/check:mobileui/check:bundle ✓ · diff-check 0。
- **发现并修复的安全项（重要）**：`scripts/verify/qiniu-stream-head-verify.mjs` 曾把七牛 **AK/SK 硬编码在 tracked 文件**里（历史版本已进 git 历史）。
  已改为 `QN_AK/QN_SK` 环境变量、缺失即退出；工作树已 grep 确认无明文密钥。⚠️ 旧 key 仍在 git 历史的问题已另行处理：261017(十六) 已用 filter-repo 重写历史清除（force-push master）；旧 key 仍建议轮换。
- **文档查漏**：HANDOFF 的 8 处「待提交」改为已提交、C3-2 后的旧 `components/*` 路径、D2 的旧 TODO 全部更新；CODE-REVIEW §11.3 从「待用户决策」改为「已裁决记录」，Q3/D2/D5/C1-5/C1-6 均标结案；§0 加 261017 最新基线。
- **未发现功能缺口**：桥 51 键/契约面、C1-6 设备实测、D5 真云读回、列表时间单测、C3-2 结构护栏均绿。
- **状态**：收尾提交（见 git log）。

### 261017(十三) · D2 结案（不做 path-style）+ D5 真云验证并修复

- **D2 产品定稿（用户 261017）**：移动端**只支持虚拟托管风格的 S3 兼容服务**。理由（官方口径）：
  阿里云 OSS 仅支持虚拟托管（path-style 会被拒绝）；腾讯云 COS 2024-01-01 后新建桶不支持 path-style；AWS S3 / 七牛 Kodo 也用虚拟托管。因此不做 `forcePathStyle` 开关、不扩 `SyncConfig`：自建 MinIO/路径风格 + http 内网端点与 **D3 一起**另立项。
  代码：`s3Store.ts` 的 `forcePathStyle:false` 从 TODO 改成**有意约束**注释；`SettingsDrawer` 保存处同步注释。
- **D5 真云验证 + 修复**：用用户提供的七牛桶 `local-lake-hebei` / prefix `lake-notes-dev1` 实测（AWS SDK v3，验完即删）：
  - gzip 体**不带** header → 读回 `ContentEncoding=null`、字节是 gzip 魔数；
  - gzip 体**带** `Content-Encoding: gzip` → 读回 `ContentEncoding=gzip`、GET 返回压缩字节（SDK 不解压）；
  - 读侧按魔数解压的兼容路径仍成立；对象列表/删除/清理到 0 均正常。
  修复：移动端 `putObject` 的 gzip 分支补 `ContentEncoding: "gzip"`（+ `ContentType: application/json`，与桌面一致）；`s3PortGuards.test.ts` 新增 D5 护栏（移动端/桌面端都必须带 header）。
- **文档**：`docs/SYNC-PROTOCOL.md` 的 D2/D5 行、§7.3 结论、P1 进展全部回填；CODE-REVIEW §9/§11 标记结案。
- **门禁**：tsc 0 · 全库 vitest（含新增 D5 例）· 双端构建 · ui-metrics · diff-check；D5 变更只影响对象元数据，不跑视觉门禁。
- **状态**：已提交（261017，见 git log）。

### 261017(十二) · C1-6 多维表只读单元格共享（Q7：共享逻辑、不共享样式）

- **新模块** [bitableReadOnly.ts](lake-notes-electron/src/core/bitableReadOnly.ts)：只依赖 core/bitableDoc 的纯函数，零 React/DOM —— `readOnlyAttachments`（file/name/image）、`readOnlyOptions`（按存储顺序）、`readOnlyBoolean`、`readOnlyLink`（仅 http(s) 给 href）、`readOnlyRating`（0..5 clamp）、`readOnlyProgress`（0..100 clamp）、`readOnlyRelation`（target/invalid/chips）。样式仍由两端各自类名提供，**不共享桌面 CSS**。
- **移动端**：`MobileBitableViewer` 的 Attachment/Option/Boolean/Link/Rating/Progress/Relation 全部改用共享语义，删掉本地 clamp/解析实现。
- **桌面端**：`bitableCells.tsx` 的 Rating/Progress/Link/Boolean 改用同一组 helper（交互态逻辑未动）。
- **护栏**：`bitableReadOnly.test.ts` 6 例（布尔/链接/评分进度 clamp/选项顺序/附件图片标记/关联失效）+ 源码级「两端都必须 import 且移动端不得再自写 clamp/关联解析」。
- **设备验收**（lake_gate + 自建全字段多维表）：`bool=[true,false] disabled`、`link href=https://example.com target=_blank`、`stars=[4,2]`、`bars=60%/0%`、`relation=[目标A,目标B,目标B]`、无失效误报；截图 `.css-audit/c1-6-261017/bitable-readonly.png`（gitignored）。验完已删自建文档、复核 6 态快照 **0 差异**。
- **门禁**：tsc 0 · vitest **276 文件 / 2096 例** ✓ · 双端构建 ✓ · ui-metrics 0 · diff-check 0。
- **状态**：已提交（261017，见 git log）。

### 261017(十一) · C3-5 第③步：抽 notes / quickNotes / tree 域，bridge 只做组合

- **最终结构**（合计 1030 行，原 bridge 1095 行）：
  - [bridge.ts](lake-notes-electron/src/mobile/bridge.ts) **31 行**——只 import 6 个域并展开 + `init()`；
  - `bridge/context.ts` 122 · `bridge/assets.ts` 96 · `bridge/sync.ts` 344 · `bridge/notes.ts` 233 · `bridge/quickNotes.ts` 134 · `bridge/tree.ts` 70。
- **跨域调用**只剩 notes 内部 3 处（`restoreHistory/createNote → notesDomain.saveNote`、`restoreNote → notesDomain.restoreTreeItem`），全部是**同域自引用**，无需 getBridge 注入；其余域之间零直接调用。
- **新增结构护栏** [bridgeStructure.test.ts](lake-notes-electron/src/mobile/bridge/bridgeStructure.test.ts)：bridge.ts 除 `init` 外不得再定义方法；6 个域文件必须存在且被展开。
- **护栏更新**：三份契约/互斥域解析器的 `DOMAIN_MODULES` 补齐 notes/quickNotes/tree；`quickNoteCapturePath` / `quickNotePushSyncRace` / `quickNoteSyncGate` 的源码护栏改为读「bridge + 对应域」。
- **验收**：tsc 0 · 全库 vitest **274 文件 / 2087 例** ✓ · 双端构建 ✓ · ui-metrics 0 · diff-check 0；**lake_gate 设备门禁 `check:mobilesnap` 6 态 0 差异**；运行时 smoke：`window.lakeNative` **51 键**，`listTreeNodes/listNotes/listQuickNotes/getCloudState` 均 function。
- **状态**：已提交（261017，见 git log）（C3-5 三步骤全部完成）。

### 261017(十) · C3-5 第②步：抽 assets / sync 域（行为保持）

- **②a assets**（commit a47a21c3）：`bridge/assets.ts`（96 行）—— `readAssetPreview` / `openAttachment` / `saveAssetAs` / 孤儿资源列表/删除/清理 / `uploadResource`；bridge 用 `...assetsDomain` 组合。
- **②b sync**（本批）：`bridge/sync.ts`（344 行）—— 云状态/下载已声明资产/单条推送/推送后回核 4 个 helper + GC 账本 / 同步设置 / S3 设置 / 测连通 / 深度 GC / 诊断 / `syncNow` / 墓碑调试只读方法；bridge 用 `...syncDomain` 组合。
- **bridge.ts 857 → 540 行**；`context.ts` 122 行；域文件总 440 行。跨域调用已消除：sync/ assets 域内方法直接调本域 helper（`syncDomain.getS3Settings`），bridge 只 import 4 个供剩余方法用的 helper（`mobileCloudState` / `downloadDeclaredAssetsFor` / `pushSingleQuickNote` / `scheduleQuickNoteVerify`）。
- **护栏更新**：`lakeNativeContract` / `contractSurface` / `maintenancePolicyCoverage` 的解析器改为「bridge 方法 + 域模块展开方法/方法体」；`s3PortGuards` 改为检查 sync 域调 `createS3Client`、bridge 不再直接建 client；`quickNoteCapturePath` / `quickNotePushSyncRace` 的源码护栏读 bridge+sync 两份。
- **验收**：tsc 0 · 全库 vitest **274 文件 / 2087 例** ✓ · 双端构建 ✓ · ui-metrics 0 · diff-check 0；**移动设备门禁**（lake_gate + 固定夹具）：`check:mobilesnap` **6 态 0 差异**；运行时 smoke：`window.lakeNative` **51 个键**，`getCloudState/syncNow/getS3Settings/uploadResource` 均为 function。
- **剩余 ③**：`notes` / `tree` / `quickNotes` 三域；跨域调用（`bridge.saveNote` / `bridge.restoreTreeItem`）需先加 `context` 后置绑定的 `getBridge()`，再拆。
- **状态**：已提交（261017，见 git log）。

### 261017(九) · C3-5 第①步：抽 `src/mobile/bridge/context.ts`（零行为变化）

- **动机**：C3-5 按风险分三步。第①步只把**域无关上下文**从 bridge.ts 抽出来，给后续域拆分做准备。
- **新文件** [context.ts](lake-notes-electron/src/mobile/bridge/context.ts)（122 行）：DB 单例/初始化（`db`/`ensureDb`/迁移+索引对账）、运行期资源缓存（`assets`）、互斥域包装（`runWrite/runMaintenance/runPriority` + `assertOpClass`）、S3 客户端工厂（`assertS3Credentials/createS3Client`）、同步设置读取（`readSyncSettings` + 三个默认常量）、`dbPort` 与字节上限断言。
- **bridge.ts 1095 → 948 行**；方法体**一行未改**，只改 import 来源。仍留在 bridge 的跨域 helper：`mobileCloudState` / `downloadDeclaredAssetsFor` / `pushSingleQuickNote` / `scheduleQuickNoteVerify`（它们要 `bridge.getS3Settings()`，先不引入循环依赖）。
- **护栏更新**：`src/mobile/native/s3PortGuards.test.ts` 的 D6 检查从「bridge.ts 调共用工厂」改为「context.ts 调工厂 + bridge 只经 createS3Client」；`contractSurface.test.ts` 49+2 方法面不变。
- **验收**：tsc 0 · 全库 vitest **274 文件 / 2087 例** ✓ · `contractSurface` / `maintenancePolicyCoverage` / `s3PortGuards` 全绿 · 桌面/移动双构建 ✓ · ui-metrics 0 · diff-check 0。纯抽取、无行为变化（未跑设备门禁；②③改运行时代码时才跑）。
- **剩余**：② `assets`/`sync` 域 → ③ `notes`/`tree`/`quickNotes` 域。跨域调用（`bridge.getS3Settings` 等）需先定注入方式（推荐 `context` 内 `getBridge()` 后置绑定，避免 ESM 循环）。
- **状态**：已提交（261017，见 git log）。

### 261017(八) · C3-2 `src/components` 拆 4 桶（纯搬迁）

- **落地**：`src/components` 根目录 31 文件 → **`app/`(14) · `ui/`(16) · `hooks/`(2) · `model/`(16)**（含测试/CSS；`markdown/` 并入 `ui/markdown/`）。`git mv` 保历史 + 全仓说明符重写 **216 处**（含 `import()` / `vi.mock` / `new URL(..., import.meta.url)`）；`App.tsx` / `desktop/` / `features/` / `mobile/` 的引用全部改到新路径。
- **新增护栏**：[componentsStructure.test.ts](lake-notes-electron/src/components/model/componentsStructure.test.ts) —— 根目录只允许 4 个桶、每桶非空、桶内不再嵌套同名桶。
- **口径修正**：`mobileIndependence.test.ts` 的允许清单 `../../components/model/treeDrag` → `../../components/model/treeDrag`（纯决策件，仍在白名单）。
- **⚠️ 踩坑（本次真踩）**：一次性 codemod 里把 `String.replace` 回调的第 4 个参数当 `post` 用了 —— 对 3 组正则它其实是 **match offset**，导致 51 个文件的 import 尾部被追加 2~6 位数字（`"path"123`），tsc 报 `; expected`。已用「引号后数字」清理自证通过；**以后写批量 replace 一律按正则分组数对齐回调签名（或命名组）**。
- **验收**：tsc 0 · 全库 vitest **274 文件 / 2087 例** ✓（含新结构护栏 2 例）· 桌面/移动双构建 ✓ · `ui-metrics` 0 ✓ · `git diff --check` 0。纯搬迁、零视觉变化（CSS 内容与 import 顺序未改，未跑 stylesnap）。
- **文档**：AGENTS / DESIGN / ARCHITECTURE / LAKEX-CONTRACT / MOBILE-* / CODE-REVIEW 的 `components/*` 路径已批量改到新桶；`src/styles/cssLayers.test.ts` 的 FILES/BASELINE 键同步。
- **状态**：已提交（261017，见 git log）。

### 261017(七) · C1-5 第二步（Q10 = B 加强版）：列表时间措辞统一

- **用户定稿（261017）**：Q10 选 **B 加强版**——列表时间统一为 **今天 → 昨天 → 本周X → 上周X → 本月D日 → 上月D日 → 其余默认 `YYYY-MM-DD`**；"其他跨年了就默认就行"。**261017 二次调整：去掉「今年更早」分类**（其余含今年更早/跨年都走默认绝对）。
- **具体口径（唯一来源 = [core/dateFormat.ts](lake-notes-electron/src/core/dateFormat.ts) 的 `formatListTime`）**：
  - 优先级：今天 → 昨天 → 本周（周一为周起点）→ 上周 → 本月 → 上月 → 默认绝对；**年初的"上周"不会被默认吞掉**。
  - 今天/昨天：`今天 HH:mm` / `昨天 HH:mm`（紧凑列表也带时刻）。
  - 本周/上周：`本周X` / `上周X`（紧凑列表不带时刻；卡片 `withClock` 追加 ` HH:mm`）。
  - 本月/上月：`本月D日` / `上月D日`；**其余（含今年更早、跨年）默认 `YYYY-MM-DD`**（卡片带 ` HH:mm`）。
- **落点**：桌面小记列表（补"昨天"与本周/上周/本月/上月/今年）· 桌面小记卡片（`withClock`）· 移动小记卡片（原 `MM-DD HH:mm` 改为同口径）· 移动最近文档卡 · 移动知识库列表。**详情/属性/回收站/历史/同步状态保持绝对**：`lib/formatTime.ts` 由 `toLocaleString` 改为固定 `YYYY-MM-DD HH:mm[:ss]`（原实现随系统区域变化，英文机会成 `10/17/2026, 6:40 PM`），桌面同步浮层与移动同步状态行同步收口。
- **测试**：`dateFormat.test.ts` 9 例（8 个分类 + 年初跨年边界 + 非法日期）；`quickNotesView.test.ts` 源码护栏改为「必须 import core/dateFormat + 不得再出现 padStart(2」。
- **门禁**：tsc 0 · vitest **273 文件 / 2085 例** ✓ · ui-metrics 0 ✓ · diff-check 0。
- **视觉**：桌面 `check-stylesnap --states "quicknotes:1315:light,quicknotes:1315:warm"` **0 差异**；移动设备截图确认首页小记卡显示 `今天 18:49`（`.css-audit/time-wording/mobile-home-quicknotes.png`，gitignored）。
- **移动快照门禁（261017 已重烤并复跑）**：新建 `lake_gate` AVD 后按 README 暖态配方重烤 6 态（`scripts/mobile-audit/baseline/mobile-snap.json`）；复跑 **6 态 0 差异**。基线绑定「该实例 + 该夹具」，换实例/重灌夹具仍需重烤。
- **状态**：已提交（261017，见 git log）（9 文件 + 2 文档；并行会话在途文件未纳入）。

### 261017(六) · C5-4 同名令牌差异表 + C1-5 第一步（时间格式化单一来源）

- **C5-4（review §C5-4）**：新增只读脚本 [token-parity.mjs](lake-notes-electron/scripts/token-parity.mjs)（`--md` 输出表；不是门禁）；审计结果 **177 个同名令牌完全一致 / 10 个有意不同 / 桌面独有 2 / 移动独有 0**；差异表与逐条意图登记到 [MOBILE-DESKTOP-DECOUPLING.md §7](lake-notes-electron/docs/MOBILE-DESKTOP-DECOUPLING.md)。脚本内 `INTENT` 表：未来新增差异会显示「待确认（新增差异）」。
- **C1-5 第一步（review §C1-5）**：新增 [core/dateFormat.ts](lake-notes-electron/src/core/dateFormat.ts)（`formatHm / formatMd / formatMdHm / formatYmd / formatDateTime / sameLocalDay`；纯本地、无 locale 副作用）+ `dateFormat.test.ts` 3 例；收编 8 处重复：
  - 小记列表/卡片（QuickNotesWorkspace，去掉 2 处 pad）· 设置页（SettingsPanel，删本地 formatDateTime）· 移动首页/知识库（HomePage/NotebookGrid：只换原子格式化，**今天/昨天措辞策略仍留各自入口**）· 小记转正式笔记标题（electron/quickNoteConversion）· 属性面板（core/noteInfo）· 多维表本地日期/时间（core/bitableDoc）· 日历格（bitableCells）。
  - 输出逐字符不变（单测覆盖补零/边界/同日）；`quickNotesView.test.ts` 的旧断言（夹带 pad 实现）改为「必须 import core/dateFormat + 不得再出现 padStart(2」。
- **未做**：Q10「两端列表时间措辞是否统一」仍待产品决策（本批刻意只抽纯函数，不动措辞）；`lib/formatTime.ts`（toLocaleString）与移动同步状态（中文月日）属不同口径，未合并。
- **门禁**：tsc 0 · vitest **273 文件 / 2079 例** ✓ · ui-metrics 0 ✓ · diff-check 0。
- **状态**：已提交（261017，见 git log）（脚本 + 文档 + 9 处代码；并行会话在途文件未纳入）。

### 261017(五) · Q3 选中态语义令牌 + 选中+hover（裸 .active 收编第一刀）

- **口径（用户 261017 定，Q3 = A）**：UI 选中继续用主题色，但只经 3 个语义令牌；**不重命名 JSX 类名**（避免结构性大改），只把颜色与选中+hover 收口到单一来源。内容选中另有口径（见 261017(三)），互不替代。
- **令牌**（桌面 [themes/base.css](lake-notes-electron/src/styles/themes/base.css) + 移动 [mobile/theme/tokens.css](lake-notes-electron/src/mobile/theme/tokens.css)）：
  `--lake-bg-selected: var(--lake-accent-tint)` · `--lake-fg-selected: var(--lake-accent-text)` · `--lake-bg-selected-hover: color-mix(in srgb, var(--lake-accent-tint) 88%, var(--lake-accent))`（实测浅 #d9e0ef / 深 #3d424e / 暖 #fadfcc）。
- **落点**：kit 三元组（`.ln-row` / 菜单项 / 页签切换器 / 设置左导航）· `.ln-btn--secondary.is-selected` · `.ln-iconbtn(.is-selected|--accent.is-selected)` · `.ln-tabs__item.is-active` 及其计数 · chrome `.note-row.active` + `.tree-row-icon` + `.pin-btn.is-active` · 多维表 `.bt-table-item.active` / `.bt-tool-btn.is-active` · 移动 `.mb-row.is-selected` / `.mb-list-item.is-selected` / `.mobile-model-body .mb-row.is-selected` / `.bottom-bar-btn.active` / `.mobile-bottom-bar__item.active` / `.mbt-table-tab.is-active`。
- **选中 + hover（新增状态，解决「选中后 hover 无反馈」）**：`.ln-row.is-selected:hover` / `.tab-switcher-item.active:hover` / `.ln-menu__item.is-selected:hover` / `.ln-iconbtn(.is-selected|--accent.is-selected):hover` / `.ln-btn--secondary.is-selected:hover` / `.note-row.active:hover` → `--lake-bg-selected-hover`；页签/分段**不加上底色**（仍是文字 + 下划线 / raised）。
- **实测**：选中目录行 + 鼠标悬停 ⇒ `background-color = color(srgb 0.85098 0.879843 0.938039)`（= #d9e0ef，候选 A）、字色 accent-text；截图 `.css-audit/q3-261017/selected-row-hover.png`（gitignored）。
- **护栏**：新增 [selectionTokens.test.ts](lake-notes-electron/src/styles/selectionTokens.test.ts)（5 例：两端令牌定义 / 桌面语义迁移 / hover 档 / 移动端 / 内容选区边框仍是 accent，防「内容选中去主题色」误伤）。
- **基线**：`cssLayers` kit **642 → 646**（+4 = 选中+hover 规则）；`mobileLayers` tokens **189 → 192**（+3 令牌）。
- **视觉门禁**：旧基线只有 **2 态**差异（`hover-row:1315:light` / `:warm`，正是选中+hover 生效）⇒ 全量重烤：两个全新实例 **42/42 逐字节一致**；live gate **34 态严格 0 差异**（8 窄窗态按既有 UNSTABLE 跳过）。
- **未做（登记）**：裸 `.active` 只做颜色令牌化、未重命名 JSX 类名；settings 左导航仍是「`bg-hover` 灰」现状（未改观感）；页签/分段保留自身选中语义。
- **状态**：已提交（本批；并行会话在途文件、以及 `mobileLayers.test.ts` 里它们的 hunk 均未纳入）。

### 261017(四) · 画板默认工具 = 选择工具（261017 用户要求）

- **用户定稿**：画板选中框颜色**不动**（Drawnix 有自己的逻辑，不同级）；只做一个优化：**进入画板默认选中「选择工具」**（不要手型/上次绘图工具）。
- **落地**：vendor 适配层 [DrawnixBoardCore.tsx](lake-notes-electron/vendor/lakex-doc-react/src/cards/DrawingBoard/DrawnixBoardCore.tsx#L1273) 给 `<Drawnix initialToolState={{ pointer: PlaitPointerType.selection }}>`；独立画板与文档内嵌画板卡共用该适配层 ⇒ 都生效。`Drawnix` 的 `initialToolState` 只在挂载时合并，不覆盖用户本次会话里后续切换的工具。
- **护栏**：`boardEditorMount.test.ts` 源码级断言该 prop 存在。
- **实测（隔离实例 + 合成夹具）**：打开 `合成·画板` ⇒ `.plait-board-container` 的类为 **`pointer-selection`**（重建前是 `pointer-hand`）。
- **⚠️ 踩坑（vendor 工作流）**：改 `vendor/lakex-doc-react/src/**` 后**必须** `npm run build:vendor`（产物入库）；本次第一轮只改 src 就启动 ⇒ 应用仍用旧 dist，实测还是 `pointer-hand`，重建后才对。本次提交同时包含 vendor dist 的新旧 chunk 换名（`DrawnixBoardCore-*.js/.cjs`）。
- **边界**：画板选中框仍是 Drawnix 自带蓝 `#6698ff`（用户 261017 明确「画板不同级、不用动」）；内核正文原生 title 也明确不动。
- **状态**：已提交 `46ea1212`（并行会话在途文件未纳入）。

### 261017(三) · 内容选中口径：文字选区中性灰 / 表格选区边框保留主题色 / hover 长预览宽版

- **用户定稿（261017）**：① **文字选中背景不能是主题色**；② **表格（内容）选区的边框用主题色**（暖色下橙框是有意的）；③ "hover 弹窗"= **内容 hover 预览**（附件/图片名、长文本/MD/AI 整段内容），不是选区工具条/菜单浮层。
- **落地（8 文件）**：
  - `--lake-select-bg` 由 `rgba(63,95,160,.16)`（主色系蓝）改为**主题无关中性灰 `rgba(128,130,134,.38)`**（桌面 [themes/base.css](lake-notes-electron/src/styles/themes/base.css#L166) + 移动 [mobile/theme/tokens.css](lake-notes-electron/src/mobile/theme/tokens.css#L179)，一套值跨主题）；影响全局 `::selection`（文档正文 / 输入框 / 多维表文字）、内核选区令牌、AI 自绘高亮、树箭头 hover 底色。
  - 表格/多维表单元格选区环**继续用 `--lake-accent`**（[bitableEditor.css](lake-notes-electron/src/features/bitable/bitableEditor.css#L341) 加注释锁定，防以后被"内容选中去主题色"误改）。
  - `.ln-tip` 新增 **`--wide`** 变体（≤460px / max-height 50vh / 内滚 / pre-wrap）；[NativeTitleTips.tsx](lake-notes-electron/src/components/ui/NativeTitleTips.tsx) 对 **>80 字或含换行**的 `title` 自动启用 ⇒ 长内容预览不再被挤成 260px 竖条，短提示不变。表面仍只用 `--lake-tooltip-bg/fg`（主题无关）。
- **实测（隔离实例 + 合成夹具）**：多维表文字选中背景 = 中性灰；单元格选区环浅色=墨蓝 / 暖色=橙；长 title 预览实测 `460×127`、class `ln-tip--wide`。证据 `.css-audit/selection-261017/`（gitignored）。
- **护栏/基线**：`cssLayers` 的 kit.css 声明基线 **635 → 642**（+7 = `.ln-tip--wide`，一次性新增原语变体，已写理由）。
- **门禁**：tsc 0 · vitest **270 文件 / 2065 例** ✓ · ui-metrics 0 ✓ · diff-check 0（全库跑时并行会话在途文件未纳入本批提交）。
- **边界**：内核正文内的原生 `title` 仍被 `NativeTitleTips` 跳过（系统 tooltip），未动；夹具里没有真实 MD/AI 字段，长预览用 title 探针实测（同一路径）。
- **状态**：已提交 `f0970e02`（并行会话在途改动未纳入）。

### 261017(二) · 多维表列宽回归修复（复选框列被拉宽 / 新建行缺边框）

- **用户报**（截图）：新建的**单字段多维表**里，复选框/编号列被拉得很宽、新建行左右很长、编号列右侧**缺边框**（与选中色无关）。
- **根因（261014 行窗口引入）**：`bitableViewport.css` 给 `.bt-grid-windowed` 加了 `table-layout: fixed`，但表宽仍是**固定 px**、且 `.bt-grid` 有 `min-width: 100%` ⇒ 固定布局把「表宽 − 列宽和」的剩余**按比例摊给所有列**（实测窗口 864：80/180/40 → **230/518/115**）。编号格 `.bt-td-index` 是 `display:flex`（非 table-cell），只画自己 80px 的框 ⇒ 被摊宽的列里那 150px **没有单元覆盖、没有边框**。
- **修法（2 文件 + 2 护栏）**：① 表宽改成 **`max(100%, 80 + 末列 33/40 + Σ字段宽)`**（[BitableEditor.tsx](lake-notes-electron/src/features/bitable/BitableEditor.tsx#L1271)）；② 末尾 `<col class="bt-col-empty">` **不再给宽度**，由 fixed 布局的 auto 列吸收剩余（[bitableViewport.css](lake-notes-electron/src/features/bitable/bitableViewport.css)）。表宽 ≥ 窗口时末列自动回到 33/40，不改变原有横向滚动。
- **实测（隔离实例 + 合成夹具，`合成·多维表`，窗口 864）**：修前 `230 / 518 / 115`（复选框列宽、编号格右侧无边框）；修后 **`80 / 180 / 604`**，边框连续、末尾 + 与添加行正常。截图 `.css-audit/bitable-width-261017/{before,after}.png`（gitignored）。
- **护栏**：`BitableEditor.behavior.test.ts` 断言表宽 `max(100%, 293px/300px)` + 末列无行内宽；`bitableEditorMount.test.ts` 源码级断言（表宽 max、末列 auto、`bitableViewport.css` 不得给 `.bt-col-empty` 固定宽）。
- **门禁**：tsc 0 · vitest **269 文件 / 2057 例** ✓ · `ui-metrics` 0 ✓ · `git diff --check` 0。
- **状态**：已提交（只含多维表 4 文件 + 2 文档；并行会话的 `editorCommands` / 移动 dock 等改动未纳入）。

### 261017 · 文档/门禁清账（ui-metrics 文案 + 桌面 stylesnap 基线重烤）

- **背景**：上会话（代码 review）遗留的两项「文档/门禁」清账。**并行会话**正在做内核能力审计（`KERNEL-REUSE-AUDIT.md` / `LAKEX-CONTRACT.md` / `AGENTS.md`）——本批**未触碰**这些文件。
- **① `ui-metrics` 文案口径**：桌面侧摘要行仍打印 `!important 11 / 目标 ≤10`，与 Q2「11 条允许清单」冲突 ⇒ 改为「/ 允许清单 11 条（逐条有理由；清单外新增直接失败）」。**门禁逻辑未变**（`node scripts/ui-metrics.mjs` exit 0）。
- **② 桌面 `stylesnap` 基线重烤**（`scripts/css-audit/baseline/stylesnap.json`）：
  - 旧基线最后更新 = **261014 (`1f44d4de`)**，其后的 `df3983f3`（分屏浮动条删除）/ 261015（目录密度 + 节点图标）/ 261016（Q4 字色）都没烤。实测：旧基线**按 `1f44d4de` 原提交重建也不可复现**——同夹具同参数下每态稳定 **−2 元素**、指纹不同（dev/scheme 只差 1 元素）⇒ 判为**基线世代陈旧**，不是本轮环境噪声。
  - 重烤配方（已跑通）：`npx vite build` + **scheme 模式** + 合成夹具（只拷 `workspace-default` / `Local Storage` / `Preferences`，与 README 一致）+ 两个**全新独立实例**（CDP 9231 / 9232）各采一轮 42 态 ⇒ **两轮 42/42 态逐字节一致**；以 r1 写基线；再在第二实例上跑 live gate ⇒ **34 态严格 0 差异**（8 个窄窗态按脚本 `UNSTABLE` 跳过，两轮同样一致）。
  - 结论：新基线 = 当前 `master`（`1dfe2887` + 本批脚本改动）的**可复现世代**；后续桌面视觉门禁只按它比对。
- **③ 环境修复（非仓库改动）**：本机 `node_modules` 缺 `@tanstack/react-virtual`（`package.json`/lock 有、目录没有 ⇒ 桌面构建直接失败）⇒ `npm install` 补 2 包（**未改** `package.json`/lock）。换机/清依赖后先跑一次构建自检。
- **未做**：C4-1 两处验证删除、C5-4 同名令牌差异表（已登记 §3 头注与 review §11.7，待用户裁）。
- **状态**：本批只改 `scripts/ui-metrics.mjs` + `HANDOFF.md` + `docs/CODE-REVIEW-261015.md` + `scripts/css-audit/baseline/stylesnap.json`；**已提交、待推送**（并行会话的文件未纳入）。

### 261016 · 内核能力复用批次（B1 字数内核化 · 移动端文档内查找 · A 批次实测）

- **方案与进度总表**：`docs/KERNEL-REUSE-AUDIT.md`（A/B/C/D 四类共 28 条；§6 A 批次实测结果；§8 文档漂移；§9 进度日志；§10 与并行会话边界）。本批**只读码 + 探针 + 少量定点改动**，无大规模重构。
- **B1 字数统一走内核（`af27bd94`）**：新增 `src/core/textStats.ts`（内核 `DM()` 同语义移植：非 ASCII 按字素、`--` 补 1、余下按空白分词 + `countChars`），桌面状态栏**优先** `queryCommandValue('wordCount')`（`src/hooks/useDocumentStats.ts` + `src/core/docStats.ts`；拿不到内核实例才用正文兜底，内核返回 0 而正文非空时兜底防闪 0），并收口另外两处自研正则（`electron/store.ts`、`src/mobile/bridge.ts`）。
  **用户可见变化（已定稿）**：字数从"去标签后的字符数（含空格标点）"改为**内核/云端语雀口径**（同夹具 30 → 8）；用户 261016 定：**保持现状**（状态栏不并列字符数）。
- **移动端「文档内查找」（`8fc55632`）**：内核查找面板在移动端**不存在**（只随工具栏 `search` descriptor 挂载，而移动端关了工具栏插件）⇒ 自研 `src/mobile/editor/MobileFindBar.tsx` + `mobileFind.ts` + `mobile-find.css`：DOM 文本节点扫描（移动端文档 `disableVirtualRendering:true`，整篇在 DOM）+ **CSS Custom Highlight API 双高亮** + `n/m` + 上/下一个 + 关闭清高亮；正文被编辑**自动重扫**；命中上限 600 显示 `600+`。
  **入口 = 工作区顶栏右上角**（工作区胶囊是定稿四格、且不许放搜索）。**桌面不加入口**：内核自带 ⌘F 面板已够用；我一度加的桌面入口已按用户要求整体回滚（`ebb70864`）。
  设备实测（lake_gate / emulator-5554，真实点按 + 真实 `Input.insertText`）：`1/3` → 下一个 `2/3` → 正文再插一处 ⇒ **自动 `1/4`** → 关闭后 `CSS.highlights=0`。
- **A 批次实测结论**：B5 `wordCountSelection` 可用（选区=全文）；**B8 结案：本构建点击 inline 图片卡不派发 `previewImgs`**（接不接 `envAdapter` 都不发）⇒ DOM 点击 + 正文取图的图片预览是**必需路径**；**B4 结案：不做**（move 族 = 目标侧插入 / 需要内核内部 position / 容器内重排；公开面驱动不了，非卡片块无接口）；C3 先不做待讨论、A5 不做、B6 不着急（用户定）。
  契约回填：`docs/LAKEX-CONTRACT.md` **§5.39**（查找面板：只认真实按键）/ **§5.40**（previewImgs 不派发）/ **§5.41**（move 族语义 + 宿主不入）。
- **门禁与装置**：`tsc` ✓ · `vitest` **266 文件 / 2050 例** ✓ · `git diff --check` ✓ · `ui-metrics` ✓ · `check:mobileui` ✓。移动 **6 态快照基线已重烤**（顶栏多一个按钮属构成变化），连跑两次 **0 差异**。
  ⚠️ **装置新知识**（已写入 `scripts/mobile-audit/README.md`）：`home-doc` 的**指纹 row key 里带文档节点 id**（形如 `ne-p$<uuid>-body#0`）⇒ `pm clear` + 重灌夹具会换 id，**元素数相同也会红**，必须重烤；只盯元素数会误判成"没变"。

### 261016(十七) · 本会话收尾与**交接**（代码 review 16 项已交付；剩 2 项已批准待实施）

- **用户点单**：会话收尾 —— 更新文档状态、已完成推送 `origin/master`、把未完成项写成交接，确保新会话可直接上手。
- **本会话做了什么**：按 `docs/CODE-REVIEW-261015.md`（全面代码 review 方案）**从方案落到执行**，5 个议题共 **16 项已交付**，
  每项单独提交、全部已推 `origin/master`：**B0 护栏 · B1 抽提 · B2 样式合规（含 Q2 允许清单 / Q4 36 处字色）·
  C4-5 跨端护栏（+修 `.editor-error`）· C2-4 S3 两端对拍 · P1 漂移 D6/D1/D4 · C2-3 能力矩阵 · C1-7 属性清单 ·
  C1-3b escapeId · C2-2 IPC 三方护栏 · C3-3 清壳 · B3 `src/mobile` 重组**。
  ⇒ **完整清单（含提交号）+ 逐项待办 + 新增护栏清单 + 踩坑**都在 `docs/CODE-REVIEW-261015.md` **§11「交接清单」**，
  **新会话从那里开始**。
- **只剩 2 项已批准待实施（方案已定，可直接开工）**：
  · **C3-2** `src/components` 拆 4 桶（`app/` `ui/` `hooks/` `model/`）—— 方案与成员清单见 review §C3-2；风险低（纯搬迁），但引用面比 B3 大 ⇒ 单独一批。
  · **C3-5** `src/mobile/bridge.ts` 按域拆（`context/notes/tree/quickNotes/assets/sync`）—— **非纯搬迁**（方法闭包共享 `db`/port），
    建议先抽 `context.ts`（零行为变化）；验收**必须含** `lakeNativeContract.test.ts`（`window.lakeNative` 方法数 49+2 不变）与**移动端设备级**（`check:mobilesnap` + 走查）。
- **5 项待用户决策（别擅自做）**：**Q3**（选中态取色，C5-1/C5-2 随它）· **D2**（MinIO 移动端，与 D3 联动）· **D5**（gzip ContentEncoding，需真云）·
  **C1-6**（只读单元格共享，需设备验收）· **C1-5**（列表时间措辞）。
- **本会话改了三处「长期口径」（AGENTS 已同步）**：① `!important` 桌面红线 = **11 条允许清单**（不再写"≤10"）；
  ② 跨文件重复棘轮**只算同一端内**（跨端重复按设计允许）；③ `src/mobile` 分 4 桶 + 根目录白名单；另 `src/lib` 不得再有"一行转发 core"的壳。
- **新增 11 个护栏**（清单见 review §11.4）—— 新会话改动前先看它们，**别把护栏当成"要我删的东西"**。
- **踩坑 6 条**（review §11.5）：最要紧的是**纯搬迁的相对路径有四种形态**（import / 被搬文件自身相对深度 / 测试替身 `vi.mock` /
  普通字符串字面量与文档引用），只改 import 会剩几十个失败；以及**重写脚本不能用"当前磁盘"解析旧路径**（只查搬迁表）。
- **门禁现状**：`tsc` exit 0 · 全库 vitest **269 文件 / 2057 例 0 失败** · 双端构建 ✓ · `check:core` / `check:mobileui` /
  `ui-metrics` / `check:bundle` / `git diff --check` 全绿；工作树干净。
- **状态**：文档更新随本项提交并推送 `origin/master`。

### 261016(十六) · B3/C3-1 `src/mobile` 目录重组（52 源码 → data/native/hooks/sync）

- **用户点单**：并发会话收工后做 B3（此前唯一阻塞 = 对方在改 `src/mobile`）。
- **落点**（纯搬迁，**零行为改动**，不改任何文件名/导出名）：
  · `data/`（15）= 仓储 9 + `schema`/`sqliteDb`/`persistence` + `syncDbPort`/`quickNotesDbPort`/`searchIndex`；
  · `native/`（20）= 原生/平台适配（`nativeSqlite*` / `nativeKeyboard` / `nativeAssetSync` / `keystoreSecretStore` / `secretStore` / `assetFs` / `assetWrites` / `assetPerf` / `capacitorHttpHandler` / `s3Store` / `sharedContent` / `systemBars` / `appInfoPort` / `cachePort` / `quickNoteShortcut` / `lakeNativeContract` / `kernelPrewarm`）；
  · `hooks/`（9）= `use*` 7 + `viewportShell` + `gestureCore`；`sync/`（3）= `syncSettingsStore`/`syncStatusStore`/`maintenanceLocks`；
  · 根目录只留**应用外壳/入口**：`main.tsx` / `MobileApp.tsx` / `bridge.ts` / `testSetup.ts` / `wasm-url.d.ts`（+ 横切护栏测试）。
- **做法**：`git mv` **76 个文件**（源码 + 同名测试；主体明确的孤儿测试也跟着走）→ 脚本重写全仓说明符 → 再补三遍：
  ① 指向被搬文件的 import（60 处）；② **被搬文件自身所有相对导入的深度**（`../core/*` → `../../core/*`，63+11 处）；
  ③ **测试替身说明符**（`vi.mock`/`doMock`/`unmock`/`importActual`/`importMock`，20 处）；
  最后修**硬编码路径字面量**（护栏测试的 `read("...")`/`new URL(...)` 与断言模式 ~12 处，含 3 个 android `.kt` 与 `scripts/` 的注释）与文档里的路径引用（19 文件 / 52 行）。
- **踩坑（值得记）**：① 重写脚本第一版用**当前磁盘**解析旧路径 ⇒ 文件已搬走、解析全失败（0 处改写）；正确做法是"只查搬迁表"。
  ② `s3PortGuards.test.ts` 的 `SRC = dirname(import.meta.url)+".."` 在文件下移一层后从 `src` 变成 `src/mobile` ⇒ 基准要改 `../..`。
  **教训：纯搬迁不是"`git mv` 就完事"——相对路径有三种形态（import 说明符 / 测试替身 / 普通字符串字面量），必须分别覆盖。**
- **护栏**：新增 `src/mobile/mobileStructure.test.ts` —— ① 根目录源码必须在外壳白名单内（新增根级源码 ⇒ 失败，提示放桶里或登记）；
  ② 四个桶必须存在且非空。自证：往根目录塞一个 `.ts` ⇒ 失败；删除 ⇒ 通过。
- **门禁**：`tsc` exit 0 ✓ · 全库 vitest **269 文件 / 2057 例 0 失败** ✓ · **双端构建** ✓ · `check:core` ✓ ·
  `check:mobileui` ✓ · `ui-metrics` exit 0 ✓ · `check:bundle` ✓ · `git diff --check` clean ✓。
  **未跑设备/视觉装置**：纯文件搬迁、无样式与几何改动 ⇒ 按 AGENTS §3#21 分层口径不触发。
- **状态**：随本项单独提交并推送 `origin/master`。

### 261016(十五) · C3-3 `src/lib` 清掉 10 个一行转发壳（**纠正了 review 的一处错判**）

- **背景**：`src/lib` 长期留着 10 个 `export * from "../core/x.js";`（`concurrency` / `docStats` / `keyedAsyncQueue` /
  `markdownClean` / `quickNoteModel` / `requestVersion` / `retry` / `tabLimit` / `tree` / `treeIndex`）——
  逻辑搬去 core 后的兼容出口，危害是**同一函数两个合法 import 路径**。
- **⚠️ 纠正 review 初稿的错判**：初稿写"每份都仍有消费者（quickNoteModel 16 处、tree 9 处），不能直接删"——
  **那是统计时把 `lib/` 与 `core/` 的引用混在一起数了**。本项用**三种独立方法**复核（路径解析脚本 / 全仓 grep / 逐名 grep，
  并确认无 vite alias / tsconfig paths 兜底）⇒ **这 10 个壳零引用**。
- **实际做法比原方案更省**：既然零引用，**不需要**"逐个改调用方"这一步，直接 `git rm` 10 个文件；
  删除后 `tsc` exit 0、全库 vitest **267 文件 / 2054 例全绿** ⇒ **反证它们确属死文件**。
- **护栏**：新增 `src/lib/libStructure.test.ts`——`src/lib` 下不得再出现"整个文件只有一行 `export * from '../core/...'`"的壳
  （要复用的东西直接从 core 引；lib 只放真正属于渲染层/平台适配的模块）。自证：造一个壳 ⇒ 失败；删除 ⇒ 通过。
- **门禁**：`tsc` exit 0 ✓ · 全库 vitest **267 文件 / 2054 例** ✓ · `check:core` ✓ · `check:mobileui` ✓ ·
  `ui-metrics` exit 0 ✓ · `git diff --check` clean ✓。
- **状态**：随本项单独提交并推送 `origin/master`。

### 261016(十四) · C2-2 IPC 通道三方一致性护栏（**原方案实测不可行，已改法**）

- **原方案**：把通道名抽成 `electron/ipc/channels.ts` 常量表，preload / native / register 都从它引。
- **实测不可行**：`electron/preload.cjs` 是**原生 CJS**——`package.json` 的 files/asarUnpack **直接列该文件、不进 Vite 构建**，
  它无法 import TS 常量表；要让它消费常量表就得引入 codegen/打包步骤，为省几张字面量引入构建复杂度不划算（AGENTS §3#17）。
  （方案 B「从注册表反推 preload 桥」同样要动 preload 的 CJS/asarUnpack 边界，不动。）
- **改成的做法（零运行时改动）**：新增 `electron/ipc/ipcChannelParity.test.ts`，把**三方一致**变成判据：
  ① 注册侧（`electron/ipc/register*.ts` 的 `handle`/`handleEvent`）↔ ② 暴露侧（`preload.cjs` 的 `invoke`）↔
  ③ HTTP 侧（`webApiServer.ts` 的 `WEB_METHODS`）；另含"通道被重复注册"检查与规模钉死（116/116/116）。
- **为什么这才是真缺口**：原先只有 `webApiServer.test.ts` 钉了 **②↔③**，**①↔② 与 ①↔③ 无人守**。
  后果：只在 preload 暴露却忘了注册 ⇒ 运行时报 "No handler registered for ..."（用户点下去才知道）；只注册不暴露 ⇒ 死通道。
  **261016 真实发生过同类事故**：并发会话给 preload 加了 `find_in_document` 却漏了 `WEB_METHODS`，被 ②↔③ 抓住 —— 当时 ①↔② 仍无人守。
- **实测基线**：注册侧 116 = preload 116 = WEB_METHODS 116，当前完全一致（含无重复注册）。
- **自证**：只在 preload 加一个通道 ⇒ 2 例失败；只在注册侧加 ⇒ 3 例失败；还原 ⇒ 通过（3 例）。
- **门禁**：`tsc` exit 0 ✓ · 3 例 ✓ · 全库 vitest 见汇总 ✓ · `git diff --check` clean ✓。
- **状态**：随本项单独提交并推送 `origin/master`。

### 261016(十三) · C1-3b 把 7 处裸 CSS.escape 收编进 escapeId（判据只留一份）

- **背景**：B1 建 `src/lib/cssEscape.ts` 的 `escapeId`（带兜底）时发现仓内另有 **7 处直接调 `CSS.escape`**（无兜底），
  当时判定"用法不同、属加固不属抽提"而单独立项。本项把它做完。
- **7 处实测**：`MultiTabEditor:395` · `EditorTab:551/735`（原本各自 try/catch）· `Sidebar:260/433` ·
  `AssetsBrowser:220` · `desktopDerivedState:54`；全部改用 `escapeId`，并给 4 个文件补 import。
- **收益**：① 判据只留一份（不会再出现"某处忘了兜底"）；② 去掉一条**静默降级**路径——原先 `CSS.escape` 不可用时
  选择器构建会抛，被 `try/catch` 吞成"找不到元素"（表现为滚动定位/高亮静默失效），现在退回属性选择器转义。
  `CSS.escape` 正常时行为**逐字不变**（`escapeId` 直接委托它）。
- **护栏**：`src/lib/cssEscape.test.ts` 增源码级 1 例——扫描 src 下自有源码（排除 helper 自身与测试），
  出现 `CSS.escape(` 即失败。自证：往 `desktopDerivedState.ts` 注入一处 ⇒ 失败；还原 ⇒ 通过（4 例）。
  同时把 `cssEscape.ts` 里"另有若干处未收编"的过期注释改写成现状。
- **门禁**：`tsc` exit 0 ✓ · 全库 vitest **266 文件 / 2051 例** ✓ · `check:core` ✓ · `check:mobileui` ✓ ·
  `ui-metrics` exit 0 ✓ · `git diff --check` clean ✓。
- **状态**：随本项单独提交并推送 `origin/master`。

### 261016(十二) · C1-7 文档属性清单收归 core（两端同一份）

- **背景**：桌面 `components/app/NoteInfoDialog`（Dialog）与移动端 `mobile/ui/NoteInfoSheet`（底部抽屉）形态差异是**有意的**
  （用户 261012），但**「属性要显示什么」这份清单**与两个格式化函数被逐字写了两遍。
- **落地**：新建 `src/core/noteInfo.ts`：`noteInfoRows(info)`（5 行主清单）+ `formatNoteInfoTime` + `formatNoteInfoSize` + `SYNC_STATE_LABEL`；
  两端组件改为只负责渲染与交互（桌面 `cells`、移动端 `rows` 都直接调 `noteInfoRows`）。
- **实测重复比初稿说的更多**：`fmtTime` / `fmtSize` / `SYNC_LABEL` / 5 行清单**全部逐字相同**（连格式串都一样）。
  另外发现移动端 `ITEM_LIMIT=100` 的注释写着"与桌面同口径"（桌面是 200）——**注释是错的**，已改正（值不动，移动端有意更小）。
- **只收纯逻辑**：位置/文档 ID/文件路径/附件网格/历史列表与内联快照预览**仍各端自有**（不动形态）。
- **三份体积口径刻意保留**（B1 结论）：`formatNoteInfoSize`（B 档不带小数）≠ `lib/formatBytes`（只到 MB、恒 1 位）
  ≠ `lib/formatBytesCompact`（到 GB、≥100 取整）；模块头注释写明，**不合并**。
- **与 C1-5 的区别**写进模块头：这里的绝对时间 `YYYY-MM-DD HH:mm` 是属性面板专用口径，不是待裁决的"列表相对时间措辞"。
- **护栏**：`src/core/noteInfo.test.ts` 6 例（清单标签/顺序、取值拼装、状态叠加、时间与体积边界、源码级"两端不得再内联"）。
  自证：把清单内联回桌面组件 ⇒ 失败；还原 ⇒ 通过。
- **门禁**：`tsc` exit 0 ✓ · 6 例 ✓ · 全库 vitest 见本批汇总 ✓ · `git diff --check` clean ✓。
- **状态**：随本项单独提交并推送 `origin/master`。

### 261016(十一) · C2-3 领域仓储能力矩阵 + 对账测试（**落法与初稿不同，有实测依据**）

- **原方案**：在 `core/ports.ts` 加 `NoteStorePort` / `TreeStorePort`，两端 `satisfies`。
- **实测后改法**：两端签名**不可直接统一**，硬做就是**扭曲签名**（Q6 明确禁止）——
  桌面是**一个 `Store` 类**（`createNotebook(title)` / `readNote(id): NoteDocument` / `saveNote(id,title,content,caches?)`）；
  移动端是**按域拆的模块级函数**（`createNotebook(d, input)` / `readNote(d, id): LocalNote|null`）；
  移动端复合门面 `bridge` 形状最接近，但返回类型/参数表/名称仍多处不一致。
  ⇒ 若硬 `satisfies`，要么给两端加适配层（运行时改动），要么改签名（Q6 禁止）。
- **落地**：`src/core/repositoryCapabilities.ts`（能力矩阵数据）+ `src/core/repositoryCapabilities.test.ts`（对账测试）。
  · **34 条能力** = 移动端 5 个仓储文件（note/tree/trash/history/notebookTree）的**全部导出函数**，逐条登记
    「移动实现 ↔ 桌面 `Store` 方法 ↔ 差异说明」；另有 `DESKTOP_ONLY_CAPABILITIES` 把**差集单列成表**（Q6 口径）。
  · **守 6 件事**：① 移动实现存在；② 桌面方法存在；③ **移动端仓储文件新增函数不登记 ⇒ 红**（真正的漂移检测）；
    ④ `core` 判据路径存在；⑤ `DESKTOP_ONLY` 不许虚报（必须"桌面有、移动端没有"）；⑥ 交集行数 **34** / 有桌面实现 **28** 钉死。
  · **不夸大**：这是**存在性对账**，不是编译期约束；"语义是否真一致"仍需读差异说明 + 实机验证。
    行数断言当场纠正了我"24"的错估（实际 28）。
- **自证**：① 移动端加未登记函数 ⇒ 失败；② 表里编造桌面方法 ⇒ 失败；③ 把移动端真实有的函数列进 DESKTOP_ONLY ⇒ 失败；恢复 ⇒ 6 例通过。
- **顺带记下的两端差异（矩阵的"note"列，供后续判断）**：`createNotebook` 参数形态不同（input vs title）、
  `readNote` 返回类型不同（`LocalNote|null` vs `NoteDocument`）、`saveNote` 参数表不同、
  多处**改名**（`listNotes`↔`listNoteSummaries`、`trashNote`↔`deleteNote`、`reorderSiblings`↔`reorderTreeNodes`、
  `restoreTreeItem`↔`restoreTrashItem`、`purgeTreeItem`↔`purgeTrashItem`、`trashTreeItem`↔`deleteTreeNode`、
  `readHistory`↔`previewHistorySnapshot`、`historyAssetRefs`↔`getCurrentContentRefs`）；
  判据其实在 core 的两条（`noteGoneState`→`syncDecisions`、`noteWriteState`→`noteSaveDecision`）已在表里标注 `core` 字段。
- **门禁**：`tsc` exit 0 ✓ · 对账测试 6 例 ✓ · 全库 vitest 见本批汇总 ✓ · `git diff --check` clean ✓。
- **状态**：随本项单独提交并推送 `origin/master`。

### 261016(十) · P1 漂移修复之三：D4 移动端 404 判定改用 core 的 isNoSuchKey

- **背景**：C2-4 对拍（SYNC-PROTOCOL §7.3 D4）查出 404 判定两端两套：桌面 `isNoSuchKey()` 认
  `NoSuchKey` / `NotFound` / message 含 404；移动端只认 `$metadata.httpStatusCode === 404` 或 `name === "NoSuchKey"`。
  而桌面代码注释**明确记录**：「缺失对象的错误名随操作/供应商不同：GetObject=NoSuchKey，部分操作（AWS/七牛 Kodo）返回 NotFound」
  ⇒ 移动端可能把「对象缺失」当错误**抛出**（首次同步判定失败，而不是返回 null）。
- **落地**：`src/mobile/native/s3Store.ts` 的 `getObject` catch 改为 `if (isNoSuchKey(e)) return null;`
  （从 core 引同一判据，删掉自拼的 404 判定）。**判据只允许有一份，就在 core。**
- **护栏**：`src/mobile/native/s3PortGuards.test.ts` 增 1 例：必须从 core 引 `isNoSuchKey` 且调用它，
  并断言**不得再出现** `httpStatusCode === 404`（防回退）。自证：写回旧判定 ⇒ 失败；还原 ⇒ 通过。
- **P1（D6/D1/D4）至此全部修完**；剩余 D2（forcePathStyle 移动端写死 false，真实功能缺口）/ D5（gzip ContentEncoding，需真云验证）
  需产品决策，D3/D7 记录备查 —— 见 SYNC-PROTOCOL §7.3。
- **门禁**：`tsc` exit 0 ✓ · 护栏 4 例 ✓ · 全库 vitest 264 文件 / 2035 例 ✓ · `git diff --check` clean ✓。
- **状态**：随本项单独提交并推送 `origin/master`。

### 261016(九) · P1 漂移修复之二：D1 移动端补 assertSafeKey（键校验两端对齐）

- **背景**：C2-4 对拍（SYNC-PROTOCOL §7.3 D1）查出——桌面 `ObjectStore` 在 get/put/putStream/delete/deleteMany 上
  都调 `assertSafeKey`（`SAFE_KEY_RE = /^[A-Za-z0-9._/\-]+$/`），而移动端端口**一个都没有**。
  该判据的注释写明目的：「防非 ASCII 键导致 ListObjectsV2 编码不一致（fail fast）」⇒ 移动端缺这道闸，
  非 ASCII 键会让 GC 的 list 与写入侧的键编码不一致（列不到对象 ⇒ 漏删/误判）。
- **落地**：`src/mobile/native/s3Store.ts` 的 **5 个校验点**统一调用 core 的 `assertSafeKey`：
  `getObject` / `putObject` / `deleteMany`（逐键）/ `putObjectStream` / `getObjectToFile`；
  `listObjects` 的 prefix **按桌面同样不校验**（桌面 `list()` 也不校验前缀）——口径逐点对齐，不是"顺手多加"。
- **护栏**：`src/mobile/native/s3PortGuards.test.ts` 增 1 例（必须从 core 引 `assertSafeKey`，且校验点 ≥5）。
- **顺带**：`13628cb9` 修掉了 D6 提交里的一处 tsc 未过（护栏测试的未用导入）——当时的校验命令让 tsc 的失败被
  vitest 输出盖住；今后 tsc 一律**显式打印退出码**再继续。
- **门禁**：`tsc` exit 0 ✓ · 护栏 3 例 ✓ · 全库 vitest 见本批汇总 ✓ · `git diff --check` clean ✓。
- **状态**：随本项单独提交并推送 `origin/master`。

### 261016(八) · P1 漂移修复之一：D6 移动端 S3 client 工厂合并

- **背景**：C2-4 对拍（`docs/SYNC-PROTOCOL.md` §7）查出移动端**内部不自洽**——`bridge.createS3Client`（只服务「测连通」）
  与 `mobile/s3Store`（服务全部同步）各建一套 client，且**设置不同**：前者**没有**七牛 checksum 绕行。
  后果 = 「测连通报 Checksum mismatch，真同步却正常」这类难查的不一致。
- **落地**：`src/mobile/native/s3Store.ts` 新增并导出**唯一**工厂 `createMobileS3Client(opts)`；
  `s3Store` 内部与 `bridge.createS3Client` 都改走它 ⇒ 传输分层（Capacitor 原生 HTTP）/checksum 绕行/凭证形态只有一处；
  checksum 绕行随之上移，测连通路径也拿到它（这正是本项要修的）。`bridge.ts` 顺手删掉不再使用的 `CapacitorHttpHandler` 导入。
  **缓存语义保持**：`s3Store` 每实例缓存 client（原样），bridge 每次新建（原样）。
- **未纳入本项**：`forcePathStyle` 的**取值**差异（同步侧仍固定 false）属 **D2**——需给 `SyncConfig` 扩字段 + 与 D3（https 强制）
  一起做产品决策；261017 已定稿**不做 path-style**（移动端只支持虚拟托管），详见 SYNC-PROTOCOL §7.3。
- **护栏**：新增 `src/mobile/native/s3PortGuards.test.ts`（源码级）：`new S3Client(` 在 src/mobile 下只能**一处**、
  `responseChecksumValidation:` 只能**一次**、两处调用点都必须走工厂。自证：注入第二处 `new S3Client(` ⇒ 失败；还原 ⇒ 通过。
  （为什么用源码级：这两个端口在内部动态 import SDK 并 new client，**没有可注入点**，为测试拆注入点属过度设计；
  判据本身 `assertSafeKey`/`isNoSuchKey` 已在 core 单测覆盖。）
- **门禁**：`tsc` ✓ · 护栏 2 例 ✓ · 全库 vitest 见本批末次汇总 · `git diff --check` clean ✓。
- **状态**：随本项单独提交并推送 `origin/master`。

### 261016(七) · C2-4 S3 传输层两端对拍（**只出对照表，未改实现**）

- **产出**：`docs/SYNC-PROTOCOL.md` 新增 **§7 S3 传输层：两端对拍**（原「记录」顺延为 §8）——
  端口面表 + **16 个协议维度**逐项判定 + 漂移清单 + 建议顺序。
- **对拍对象（这是关键澄清）**：不是直接比 `electron/s3Store.ts` 与 `src/mobile/native/s3Store.ts`。
  桌面是 `ObjectStore`（Node SDK）经 `electron/syncAdapters.ts` **适配**成 core 的 `S3Store` 端口；
  移动端**直接实现**同一个端口 ⇒ 要守的是**端口协议面等价**，不是实现相同。
- **两端一致的部分（硬骨头都对上了）** ✅：超时 30s/120s（移动端注释显式对齐桌面常数）、重试 3、
  连通性检查用 ListObjectsV2 而非 HeadBucket（两岸注释都写了七牛理由）、gzip 读按魔数、`maxBytes` 解压后判定、
  prefix 归属（桌面 adapter 剥、移动端收完整 key）、并发上限 8（在 core，单一来源）。
- **可选端口方法不对称 ≠ 缺陷**：`listObjects`/`deleteMany`/`getObjectToFile` 桌面适配层**都没实现**，
  但——**core 里没有任何一处调用它们**；调用方各在两端自己的编排层（移动 `bridge.ts` / 桌面 `s3Maintenance.ts`）。已实证。
- **真实漂移（P1，低风险可立即修）**：
  · **D1** `assertSafeKey` 只在桌面执行（其注释写明目的是「防非 ASCII 键导致 ListObjectsV2 编码不一致」）⇒ 移动端缺这道 fail fast；
  · **D4** 404 判定两端两套：桌面 `isNoSuchKey`（含 `NotFound`；注释明确记录"部分操作/七牛会返回 NotFound"），移动端只认 404 状态码或 `NoSuchKey`；
  · **D6** 移动端有**两套 client 工厂**且设置不同：`bridge.createS3Client`（用 `cfg.forcePathStyle`、**无** checksum 绕行）只服务「测连通」，
    `mobile/s3Store`（**硬编码 false**、**有**绕行）服务全部同步 ⇒ 「测连通」与「真同步」口径不一致，难查。
- **真实功能缺口（P2，需产品决策）**：**D2** `forcePathStyle` 移动端写死 false（`s3Store` 与 `SettingsDrawer` 保存路径都写死）
  ⇒ 自建 MinIO（需 path-style，桌面设置页有开关）在移动端**无法使用**；且与 D3（移动端没有 `validateS3Settings` 的 https 强制）联动——
  若同时补 https 强制会拒掉内网 http MinIO，两者要一起定。**D5** 移动端 gzip PUT 不带 `Content-Encoding`（读侧按魔数兼容，但要动就得真云验证）。
- **本项未改任何实现**（用户口径：先出对照表）；漂移修复建议按 D6 → D1/D4 → D2+D3 → D5 的顺序另开批次。
- **门禁**：纯文档改动 ⇒ 未跑构建/视觉；`git diff --check` clean ✓。
- **状态**：随本项单独提交并推送 `origin/master`。

### 261016(六) · 修 `.editor-error` 移动端缺口（C4-5 查出的第一处）

- **用户点单**：「1修」（修掉 C4-5 刚查出的那处缺口）。
- **落地**：`src/mobile/features.css` 新增 `.editor-error`（**10 条声明**，全走移动端令牌：`--mb-gap` / `--mb-page-pad` /
  `--mb-radius` / `--lake-status-error(-soft)` / `--lake-font-size-small`），几何与桌面同构但用 mb 档。
  这是**新增样式**（该元素此前在移动端完全没有规则），不是覆盖；`mobileLayers` 的 `mobile/features.css` 基线 142 → **152**。
- **护栏随动**：`KNOWN_GAPS` 清空；并给 `crossEndClassCoverage.test.ts` 补了「**表项修好后必须删除**」判据
  （否则豁免清单会腐烂成"永久豁免"）。护栏复跑确认缺口已修（3 例通过）。
- **⚠️ 移动端观感未经设备验收**（属移动端视觉新增；正式验收前建议在 `lake_gate` 上看一眼回收站预览的出错态）。
- **并发处理（重要）**：`src/mobile/mobileLayers.test.ts` 当时含并发会话**未提交**的改动（登记他们新加的 `mobile/editor/mobile-find.css`）。
  为避免把他们的 WIP 卷进本批，用 `git stash push -- src/mobile/mobileLayers.test.ts` 临时隔离 → 只改我这一行基线 → 提交 → `git stash pop` 还原他们的改动。
  隔离期间 `mobileLayers` 的唯一失败是他们的 `mobile-find.css` 未登记（预期），`features.css 152` 本身通过。
- **顺带修正一处护栏口径（这次修复当场逼出来的）**：B0 的「跨文件重复」棘轮**误报**了本次修复 ——
  它把「桌面与移动写同一批结构类名」也算成"层层套"，而那是设计允许的（用户 261012），C4-5 甚至**要求**两端都写。
  实测全量 308 组里 **纯跨端 295 组、同一端内只有 13 组** ⇒ 口径改为**只统计同一端内**，基线 **298 → 13**；
  跨端组数单独统计、不判失败。自证：同端重复 ⇒ 失败；纯跨端重复 ⇒ 不失败。
- **门禁**：`tsc` ✓ · 跨端护栏 3 例 ✓ · `ui-metrics` exit 0 ✓ · `git diff --check` clean ✓（其余见下一节的批次门禁）。
- **状态**：随本项单独提交并推送 `origin/master`。

### 261016(五) · C4-5 跨端共享组件「两端都要有样式」护栏（**当场查出 1 处真实缺口**）

- **用户点单**：B3（`src/mobile` 目录重组）改动大、等另一个会话；问「除了 B3 别的有什么能做的」⇒ 先做零风险、纯测试的 B5a（C4-5）。
- **判据设计（比原计划更准）**：原方案是"对三对跨端 CSS 文件断言一致"，但那三对的重复**本来就是有意的**
  （用户 261012 定「逻辑共享、外观各端自有」）⇒ 真正的不变量是**覆盖**而不是**一致**。
  改为以「**共享组件发出的结构类名**」为判据：新建 `src/styles/crossEndClassCoverage.test.ts`，三条判据：
  ① 移动端 import 到的 UI 组件里，会发自有静态类名的**必须登记进 SHARED**（防清单腐烂）；
  ② 登记过的组件必须仍被移动端使用（防僵尸清单）；③ 每个结构类名**两端都必须有规则**（新增缺口直接失败、已知缺口只许减）。
- **共享组件集合用路径解析得出（不是文件名匹配）= 5 个**：`AttachmentPreview` / `ImageLightbox` / `LakeEditor` /
  `QuickNoteEditor` / `QuickNotePreview`，共 **34 个自有结构类名**。
- **当场查出 1 处真实且可达的缺口**：`LakeEditor.tsx:185` 在 error 态渲染 `.editor-error`，桌面有规则（`styles/app/misc.css:8`），
  但**移动端 CSS 里没有**；而移动端确实会挂 `LakeEditor`（`mobile/trash/TrashPreviewPage.tsx:7`，回收站预览）
  ⇒ 内核加载失败时移动端会渲染成**裸元素**（无红底/无内距）。已登记进 `KNOWN_GAPS` 并写明修法（属移动端视觉，需设备验收）。
- **只统计字符串字面量类名**（条件/拼装类名跳过）⇒ **宁可漏报也不误报**；自证：注入"只在一端"的新类名 ⇒ 失败；
  取消登记一个共享组件 ⇒ 失败；恢复 ⇒ 0、无残留。
- **门禁**：`tsc` ✓ · 全库 vitest **263 文件 / 2032 例通过（0 失败）** ✓ · `check:core` 81 文件 0 违规 ✓ ·
  `check:mobileui` ✓ · `ui-metrics` exit 0 ✓ · `git diff --check` clean ✓（纯测试新增，无产品代码/CSS 改动，未跑构建与视觉装置）。
- **状态**：随本批提交并推送 `origin/master`（只提交本会话文件；并发会话的移动端查找批次未触碰）。

### 261016(四) · B2 收口：Q2 决定（!important 允许清单）+ Q4 落地（36 处字色）+ Q3 仅记录

- **用户裁决**：Q3「需要详细考虑，先文档记录」· Q4「可以做」· Q2「你决定，确实有必要用 !important 可以保留，不是一点不能用」。
- **Q2 落地（本会话定）**：`!important` 红线由「数字 ≤10」改为**逐条有理由的允许清单**——桌面实测 11 条逐条核过都成立
  （压 JS inline 宽度 / 压内核 inline 高度 / 压 legacy 的 `!important` / reduced-transparency 契约）；「≤10」这个数**已被真实需要越过**，
  继续挂着只会让门禁失去意义，而"清单化"比数字更硬。
  · `scripts/ui-metrics.mjs` 新增 `IMPORTANT_ALLOWLIST`（11 条，每条写明"压谁"）；判据 = 总数不超清单长度 **且不得出现清单外的 `!important`**；
    清单里已找不到的条目会被列出提醒同步删表；移动端走棘轮 **19**（只许降）。
  · **自证**：注入清单外新增 ⇒ 报 `清单外的 !important: styles/__q2_probe.css .q2-probe {color}` 且 exit 1；移动端 20>19 ⇒ exit 1；清理后 exit 0。
    过程中护栏当场抓出我把 `tokens.css` 的选择器顺序猜错（实际是 `.create-menu, .context-menu`）——正是它该干的事。
  · `AGENTS §3#14` 与 §3#21 的口径已同步改写（不再是"≤10"）。
- **Q4 落地**：**36 处**文字色 `var(--lake-accent)` → `var(--lake-accent-text)`（11 个文件、36 增/36 删），护栏基线 36 → **0**（硬 0）。
  · 逐行核对：删除行**全部**是"属性恰为 `color` 的 accent"，新增行全部是 accent-text；其中 **35 处为纯令牌替换**，
    1 处是 `document-status.css` 的**自我兜底** `color: var(--lake-accent, var(--lake-accent))`（同类噪声，一并修掉并补注释）。
  · **未误伤**：`border-color: var(--lake-accent)` **26→26**、`background: var(--lake-accent)` **29→29** 均不变（属性边界证明）。
  · **观感**：浅 `#3f5fa0→#33497f` · 深 `#9aabce→#b9c6e2` · 暖 `#d45500→#a8440a`；实测**只有暖色从不达 AA（3.61–4.12）变为达标（5.27–6.01）**，
    浅/深本就达标（此前"深色会掉到 3:1"是**我的错判**，已按实测纠正）。
  · 顺带把 `.ln-iconbtn.is-selected` / `.bottom-bar-btn.active` 等**选中态**对齐到 kit 的选中三元组（属 C5-1 的一部分）。
- **Q3 仅记录（未实施）**：三候选的真实合成值与对比度已固化进 `docs/CODE-REVIEW-261015.md` §Q3
  （推荐 A = `color-mix(in srgb, var(--lake-accent-tint) 88%, var(--lake-accent) 12%)`，不引入颜色字面量）。
- **⚠️ 视觉装置未跑（如实登记）**：本轮**未跑** `check:stylesnap` / `check:mobilesnap`（需 CDP + Electron / 专用 AVD；本次 Electron 截图路径在本环境超时）。
  替代证据 = 纯令牌替换的逐行配对 + 属性边界证明 + 三主题色值表。**正式验收前建议补跑受影响态**（Q4 只改颜色、不涉几何 ⇒ 预期"元素数不变、颜色指纹变化"）。
- **⚠️ 并发会话的既有失败（非本批引入）**：`electron/webApiServer.test.ts > WEB_METHODS 与 preload.cjs 的 invoke 通道完全一致` 失败——
  内核会话给 `preload.cjs` 加了 `findInDocument → find_in_document`，但未同步 `electron/webApiServer.ts` 的 `WEB_METHODS`（AGENTS §7.6 的坑）。
  本批为纯 CSS/脚本改动，不可能影响该断言；按并发边界**未由本会话修改**，留给该会话补。
- **门禁**：`tsc` ✓ · 全库 vitest **2023 例通过 / 1 例失败（即上面那条并发会话的）** · 双端构建 ✓ · `check:core` 81 文件 0 违规 ✓ ·
  `check:mobileui` ✓ · `check:bundle` ✓ · `ui-metrics` exit 0 ✓ · `git diff --check` clean ✓。
- **状态**：随本批提交并推送 `origin/master`（只提交本会话文件）。

### 261016(三) · B2（第一批：不涉及观感）移动端颜色清零 + Q3/Q4 取色实测

- **用户点单**：先做 B2 里**不涉及观感**的那部分，然后给 Q3/Q4 做可视化。
- **落地（值逐字节相同 ⇒ 零观感变化）**：
  - `src/mobile/mobile.css` 的 **28 处颜色字面量 → 0**：8 个参与渲染的字面量收编进 `src/mobile/theme/tokens.css`
    （知识库 6 档装饰调色板 `--mb-nb-accent-1..6` + 纸卡投影 `--mb-shadow-paper` + 遮罩前景 `--mb-on-scrim`）。
  - 同文件 **13 处 `var(--token, #fallback)` 兜底 → 0**（删除）：它们是**不可达分支**（令牌在移动端主题链都有定义），
    且 **13/13 的兜底取值与真实令牌都不一致**（思源时代残留，如 `--lake-border-1` 真实 `#e6e8ec`、兜底却写 `#e3e6eb`）
    ⇒ 属**误导性死值**，删掉比留着更安全。
  - 基线：`mobileLayers` 的 `mobile/theme/tokens.css` 181 → **189**（+8 合法新增，`mobile.css` 声明数不变）；
    `ui-metrics` 的 `mobileColorLiterals` 28 → **0**（硬 0，与桌面同口径）。
  - **零观感变化的机械证明**（对拍 `git show HEAD:src/mobile/mobile.css`，脚本可复跑）：A 类 8/8 有同值令牌；
    B 类 13/13 兜底不可达、且 13/13 取值过期。
- **Q3/Q4 实测（纠正了我此前一处未实测的错判）**：可视化在 `.css-audit/q3-q4-261016/`（HTML + PNG，gitignored），
  数字固化进 `docs/CODE-REVIEW-261015.md` §Q3/Q4：
  - **Q4（36 处文字色用裸 `--lake-accent`）**：浅色 5.54–6.26:1、深色 6.09–7.53:1，**都还够 AA**；
    **只有暖色主题 4 项全部不达标（3.61–4.12 < 4.5）**，换 `--lake-accent-text` 后全部达标
    ⇒ 真实收益是**修暖色可读性**，不是"深色掉到 3:1"（原假设错误，已改）。
  - **Q3（`--lake-bg-selected-hover` 取色）**：给出 3 个候选的真实合成值。推荐
    **A = `color-mix(in srgb, var(--lake-accent-tint) 88%, var(--lake-accent) 12%)`**——
    不需要为三套主题各写色值、也不引入颜色字面量；B（24%）更重；C（复用 `--lake-bg-press`）会合并"按压/选中悬停"两个语义。
- **门禁**：`tsc` ✓ · 全库 vitest **261 文件 / 2024 例** ✓ · 双端构建 ✓ · `check:core` 81 文件 0 违规 ✓ ·
  `check:mobileui` ✓ · `check:bundle` ✓ · `ui-metrics` exit 0 ✓ · `git diff --check` clean ✓。
- **状态**：随本批提交并推送 `origin/master`。

### 261016(二) · B1 公共函数抽提（小记 key / formatBytes / escapeId 收归单一来源）

- **用户点单**：按 `docs/CODE-REVIEW-261015.md` §7 的批次表**直接开工 B1**；并提醒"小心另一个会话的并发改动"。
- **落地（零视觉变化；改 10 文件 + 新增 5 文件，未动 CSS/UI 行为）**：
  - **C1-4 小记 S3 key（最高价值）**：新建 `src/core/quickNoteKeys.ts` 作唯一来源。原先同一套布局写在 **3 处**——
    `quickNotePush.ts`（单条推送）与 `quickNotesSyncEngine.ts`（整轮同步）是**逐字相同的三行内联 key**，
    `electron/quickNotesSync.ts` 是第三处（且 `QUICK_NOTES_ROOT` 常量在 core 与 electron **各定义了一次**）。
    风险是实打实的：改布局只改一处 ⇒ 单条推送与整轮同步会指向**不同对象**（重复上传，或他端读不到刚推的那条）。
    现在三处统一引用；桌面侧按"相对 key"（`ObjectStore` 自套前缀）、core/移动侧按 `quickNoteKeys(prefix)`。
    连 `quickNotePushSyncRace.test.ts` 里的手写副本也一并收编 ⇒ **全仓（含测试）已无手写布局**（`grep` 可验）。
  - **C1-2 `formatBytes`**：勘察后确认三份**并不等价**——同步浮窗是「GB 档 + ≥100 取整」，与设置页
    「只到 MB + 恒一位小数」是**两个口径** ⇒ **没有强行合并**（那会改观感），改为把同步那份显式化为
    `formatBytesCompact()` 收进 `src/lib/formatBytes.ts`；移动端设置页那份与 canonical **逐字等价** ⇒ 直接复用。
  - **C1-3 `escapeId`**：`EditorTab` / `OutlineList` / `useOutline` 三份逐字相同 ⇒ 收归 `src/lib/cssEscape.ts`，
    **保住 try/catch 兜底**（node 测试环境无 `CSS` 全局，裸调用会抛）。
  - **新增护栏**：`quickNoteKeys.test.ts`（字面量钉死布线格式 + 源码级禁止再内联拼 key）·
    `formatBytes.test.ts`（7 例，钉住两个口径的**差异边界**，防误合并）· `cssEscape.test.ts`（3 例，委托/无 CSS/抛错三条路径）。
- **有意未做（写明理由，别再提）**：① **C1-1 `nowIso`（7 处）不做**——一行 `new Date().toISOString()` 包装，
  收益仅"少 7 行"却要动 7 个文件（含并行会话正在改的 `electron/store.ts`），按 AGENTS §3#17 判为过度设计；
  ② 另有 **7 处直接调 `CSS.escape`（无兜底）**未收编——属"用法不同"而非重复定义，收编是加固不是抽提。
- **门禁**：`tsc` ✓ · 全库 vitest **261 文件 / 2024 例通过**（跳过 5 文件 16 例）✓ · 桌面与移动两条构建 ✓ ·
  `check:core` 81 文件 0 违规 ✓ · `check:mobileui` ✓ · `check:bundle` ✓ · `git diff --check` clean ✓。
  **B0 护栏在 B1 后仍停在基线**（移动颜色 28 / accent 36 / 跨文件 298 / 桌面 `!important` 11，`ui-metrics` exit 0）。
- **并发避让**：本批只 add 自己的文件；并行会话的 `docs/KERNEL-REUSE-AUDIT.md` / `src/core/textStats*` /
  `electron/store.ts` 等一律未 add、未提交。
- **状态**：随本批提交并推送 `origin/master`。

### 261016 · 代码 review 全面方案 + B0 护栏落地（**review 只出方案；B0 只改护栏脚本，未动产品代码/CSS**）

- **用户点单**：功能开发告一段落，做一次**全面代码 review（前端 + 后端）**，覆盖 5 个方向（公共抽提 / 能力抽象 / 模块划分 / 样式根位置与 `!important` / 样式统一收归令牌）；**只出方案、逐项讨论**，不改代码。并提醒**另有会话在做 lake 内核功能优化**，改动需避让。
- **方案文档**：`docs/CODE-REVIEW-261015.md`（5 议题 / 20 项 / 10 个待裁决问题 + 可复现命令）。**结论速览**：用户担心的两件事**实测基本不成立**——`!important` 真实仅 **30 条**（28 条理由成立；grep 的 83 命中里 53 处只是注释在讲解）；跨文件重复仅占 **298 / 9,190 ≈ 3.2%**；73 个 CSS **0 孤儿**；桌面颜色/字号字面量 **0**。真问题集中在 **移动端 `mobile.css` 28 个颜色字面量**（唯一真违规，移动端此前无颜色护栏）· **护栏口径漏洞** · **选中态仍分散 41 处 / 17 文件** · **文字色误用裸 `--lake-accent` 36 处**。
- **B0 护栏已落地**（用户授权开工；**只改 `scripts/ui-metrics.mjs`**）：
  - C4-2 **口径统一**：桌面「颜色字面量 / `!important` / 令牌护栏」的扫描集合由**入口图 33 个**改为**全部桌面 CSS 58 个**（与字号护栏一致）。实证：桌面 `!important` 入口图口径报 10、真实 **11**，漏掉的正是 `features/usheet/usheetEditor.css:82`（该文件注释早已自行记录此事）。
  - C4-3③ **移动端颜色护栏**（`src/mobile/theme/**` 才是合法归属）基线 **28** · C5-3 **文字色误用裸 accent** 基线 **36** · C4-4 **跨文件重复 (选择器,属性)** 基线 **298** · 桌面非主题颜色字面量改为**硬判 0**。四条新基线**只许降**，超基线即 `exit 1`。
  - **自证**（本仓有探针静默失效先例，必须做）：临时探针注入 5 类违规 ⇒ 5 条护栏**全部咬人**（0→1 / 11→12 / 28→29 / 36→37 / 298→300，退出码 0→1），删除后逐项复位、退出码回 0、无残留。
  - **算法修正**：跨文件重复的初稿脚本会把 `@media` 内规则整段漏掉 ⇒ 换用正确的规则提取器 `extractRules()`，基线由 288 修正为 **298**（分布：298 组全部是「恰好 2 个文件」）。
- **门禁**：`tsc` ✓ · 全库 vitest **258 文件 / 2010 例通过**（跳过 5 文件 16 例）✓ · `check:core` 80 文件 0 违规 ✓ · `check:mobileui` ✓ · `check:bundle` ✓ · `git diff --check` clean ✓。
- **遗留（属 B2，不是 B0 缺陷）**：基线**尚未清零**（B0 只保证不再变多）；桌面 `!important` 红线仍是 **≤10**，B0 只是把「不判失败」变成「≤11 棘轮」，**Q2 待用户裁决**（放宽到 11，还是先删掉 usheet 那条）。
- **并发避让（已执行）**：本批**只提交自己的文件**（`scripts/ui-metrics.mjs` + `docs/CODE-REVIEW-261015.md` + 本文件）；内核会话在途的 `electron/store.ts` / `src/core/docStats*` / `src/core/textStats*` / `src/hooks/useDocumentStats.ts` / `src/mobile/bridge.ts` / `docs/KERNEL-REUSE-AUDIT.md` **一律未 add、未提交**。
- **状态**：随本批提交并推送 `origin/master`。

### 261015 · 桌面目录密度试调（**复核后定稿：字号 14px / 行上下 2px**）

- **用户点单**：目录过于密集、文字明显小于图标；字号略增、各文档之间间距略增，先试一版。只改桌面目录，不动图标与移动端。
- **实现（当时）**：`styles/chrome.css`唯一来源的`.note-row-copy strong`从body14→bodyMd15；`app/shell.css`树行屏外占位28→32px。**⚠️ 复核更正**：本节原文写"`.note-row`上下内距2→`--lake-space-xs`4"**并未落地**（代码里内距一直是 `2px 8px`，也从未引用过 `--lake-space-xs`），"普通行31.57px"是在内距按4px估算下得出的数，实际是 **27.57px**；"没有新增令牌"属实。字重500/选中600、图标17.82px、层级缩进/行内操作/裁切语义确实保留。
- **261015 二次试调与最终定稿（用户逐档看真实截图后裁定）**：15px（偏大）→ 14.5px（仍偏大）→ **回到 14px 定稿**。目录行高由 `min-height` 下限兜底（普通行 27px / 笔记本行 29px），**字号半档不会改变行高**；只改字号时实测普通行 27px、笔记本行 29px，文本未被裁。
  结论：**只保留 14px 与屏外占位 32px**；专用令牌 `--lake-font-size-sidebar` 试调后删除，不占通用档位。
- **复核实测（隔离实例 `lake://app`、1280×820、目录 220px、合成夹具）**：标题 14px / line-height 22px / copy 盒 22px；普通行 **27px**、笔记本行 **29px**；图标 17.82px（`.tree-node-custom-icon` 自带 15.5px 字号上下文，不吃行字号）；三主题行几何相同。
- **视觉基线**：曾按 14.5px 重烤过整份 42 态基线，回滚 14px 后**已恢复成旧基线**（`scripts/css-audit/baseline/stylesnap.json`，与 14px 代码对拍一致；未留备份文件）。
- **证据/预览**：`.css-audit/sidebar-density-261015/{before.json,results.json,before.png,after-selected.png,stylesnap*.log}`（当时那版）；本轮三态对照截图在 `/tmp/density-{pt1,pt2,mid,final14}.png`（临时目录，不入库）。

### 261015 · 节点图标（桌面 + Android）：浅渐变 / 独立选择器 / 按节点类型默认资源页

- **用户点单**：清除键放面板右上角；图标颜色着底，保留线性轮廓，避免与表情相比太轻。随后按用户新截图：动作改「眼睛斜线图标 + 移除」文字，底色按飞书预制色换浅渐变。**已由用户追加授权扩到移动端**，承接下节未提交的图标类目与面板解耦改动。
- **落地**：`Sidebar.tsx` 顶部 `.ln-tabs__action` + `.ln-btn--ghost`（EyeOff +「移除」，aria-label「移除图标」）；底部清除条及CSS已删。表情分组跳转仍在底部；搜索和图标页不留空footer。
- **连续试选（用户同日第三轮）**：点击目录更换图标时，选图标/表情/移除**不关闭面板**；`onPick` 调原保存并更新picker当前值，保留分类/选色/搜索与原面板DOM，选中格立即跟随。按节点id给picker key，换目标重新落座；关闭仍走Overlay外部点击/Esc，`closeOnNestedOverlay`让点其他浮层也视为离开。公共Sidebar新增1例（连续星标→心形→移除的回调与即时选中态）。隔离Electron实测6项通过，含连续选择落库、表情保持与正文外点/Esc关闭；证据`.css-audit/node-icon-stay-261015/{results.json,after-selection.png}`，数据`/tmp/lake-node-icon-stay-261015-RKvSm3` / CDP9239 / 资源19839。未改移动端。
- **图形单一来源**：选择器网格也使用 `NodeIconGlyph`；**浅渐变圆角底块 + 白色lucide线性轮廓**，选色后全部40枚同步预览。**尺寸已于同日第七轮收拢**（见下）：底块1.15em / 轮廓.85em；目录两类共用约17.8px、标签约14.9px、选择器底块23px，描边仍1.75。色板32×32 / 圆角6，顺序=暖橙/珊瑚/粉红/浅紫/靛蓝/柔蓝/青绿/浅绿。按用户飞书截图左上/中间/右下像素采样近似重建三站135°渐变，共用`themes/base.css`，三主题同色。**旧实色白线3.75–5.45:1结论不适用于浅色方案，不再沿用该声明。**
- **进一步提浅（用户同日第四轮）**：八档渐变的三个色站在飞书采样版基础上统一向白色混合18%，直接改`themes/base.css`，保留色相/色号/轮廓/几何/连续试选行为。tsc、相关21例、cssLayers/ui-metrics、桌面构建/bundle/diff通过；隔离Electron实测八档渐变有效、目录/标签同源、浅深主题与选后面板保持。当前色值以源码为准；证据`.css-audit/node-icon-paler-261015/{results.json,light.png,dark.png}`，数据`/tmp/lake-node-icon-paler-261015-rvYKg4` / CDP9240 / 资源19840，未提交。
- **继续提浅（用户同日第五轮，上一档配色）**：在上一档再混合15%白色（相对飞书采样版累计约30%），仍只改八档渐变色站。tsc/相关21例/cssLayers/ui-metrics/桌面构建/diff通过；已刷新隔离CDP9240，八档选色与40枚预览同源、选后面板保持。截图与计算值`.css-audit/node-icon-pastel-261015/{picker.png,palette.png,results.json}`；未提交。
- **弹出不遮挡 + 再浅一档（用户同日第六轮，当前方案）**：从鼠标点击点改成真实`.tree-row-icon`元素锚点，复用`usePopoverPosition({anchor,side:"right",gap:8,width:418})`，沿整枚图标右缘弹出；不写估算高度/新定位函数。底部向上夹在视口内时仍靠水平间距避开图标。八档渐变再混白15%（采样版累计约41%）。隔离Electron实测：点同枚图标上/下缘位置一致、真实底部目录项在1315×860/760×600/560×600下与面板相交面积0、右缘间距8px，连续选择后仍不相交；八色与40枚预览同源。tsc/相关28例/cssLayers/ui-metrics/全库255文件1976例/桌面构建/bundle/diff通过。证据`.css-audit/node-icon-anchor-261015/{results.json,anchor-visible.png,picker.png,palette.png}`，数据`/tmp/lake-node-icon-anchor-261015-TnjXbA` / CDP9241 / 资源19841；独立测试库有28篇位置探针，不触碰正式数据。移动端在途改动保留，未提交。
- **图标/表情大小收拢（用户同日第七轮）**：用户对照飞书指出图标大、表情小，要求都向中间尺寸靠。`NodeIconGlyph`的emoji分支改为共用`.node-icon-glyph`居中槽，字符不变；新增主题令牌`--lake-node-glyph-size:1.15em`给槽宽高和表情字号，底块从1.3em缩到1.15em、表情从1em放到1.15em，白色轮廓.9→.85em。目录20.15/15.5→**两类17.82px**（中心误差<.01px）；标签16.90/13→**两类14.95px**。选择器图标26→23px、白色轮廓18→17px；表情选择格仍26px字号，未改变面板格/行几何与8px锚点间距。相关30例/tsc/cssLayers/ui-metrics/桌面构建/全库255文件1980例（含同工作树移动端在途变更）/bundle/diff通过；cssLayers nodeIcon102→104（+2 emoji字号/行高）。实机浅深主题+目录/标签/选择器几何证据`.css-audit/node-icon-size-261015/{before.json,results.json,directory.png,tabs.png}`，隔离数据`/tmp/lake-node-icon-size-261015-53PLh0` / CDP9242 / 资源19842。未提交。
- **色号与显示顺序解耦**：`NODE_ICON_TINTS` 每项显式`code`，encode按code、parse按code查询。蓝0/青绿2/绿3/紫7保留，旧青1换靛蓝、黄绿4换暖橙、琥珀5换珊瑚（用户整体换色板），重排后不串码；字段/同步/历史emoji分支不变。新增1例锁住全部色号唯一0..7与原四色编码。
- **真实 Electron / lake://app 验收**：表情页418×392，正文266高 / 1055格 / 26px；图标页418×358。八档选色、目录与标签渲染、重开时色号落座、浅/深/暖、两页移除落库null均通过；面板内核类0。验收使用隔离数据`/tmp/lake-node-icon-soft-261015-UukvhI` / CDP9238 / 资源19838；实例是否仍在运行以端口现状为准（此前9237在收尾时已不可连接），不触碰正式数据。**最新证据**`.css-audit/node-icon-soft-261015/{results.json,*.png}`；旧实色证据在`.css-audit/node-icon-tile-261015/`。
- **移动端接入 + 默认页（用户同日追加，当前决定）**：40枚lucide图标/8档浅渐变/共享`i:<id>:<色号>`编码已接入Android。**节点选择器与文内输入表情彻底解耦**：移动`ui/NodeIconPicker.tsx` + `ui/nodeIcon.css`自有表情分类/网格/移除，不import输入态`EmojiPanel`，也不使用`mb-emoji-*`；只共享表情表、最近使用逻辑、图标目录/编解码。输入态`EmojiPanel.tsx`与dock本批未改。图形由移动端`MobileNodeIconGlyph`自有渲染，知识库书架/列表、目录（笔记本行/分组/文档）、标签列表、新建知识库预览不再显示原始串。三个选择入口=知识库长按→设置图标 / 目录行菜单→设置图标 / 新建知识库。选图标/表情/移除后保持面板，外点/关闭/原有滑动关闭继续生效；可滚到最后一枚图标。
- **两端共同默认规则**：`src/lib/nodeIcons.ts`的`nodeIconPickerMode(nodeType)`唯一来源：**notebook/group→图标；note（文档/表格/数据表/画板）→表情符号**。按节点用途初始化，即使已有资源是另一类也遵守该规则；当前保存的色号仍带出。不是新增持久化偏好，不改库表/同步协议。桌面公共Sidebar+移动组件测试均锁住该语义，桌面真实四种节点亦验过。
- **最新桌面弹出位置 / 颜色（261015追加）**：用户要求能看见当前图标与文档名，**面板贴齐当前修改行的左边缘（跟随层级缩进），从整行底边下方8px弹出**；不是目录栏左缘，也不再贴图标右侧。`setTreeIcon`取真实`.tree-row`作锚点，共用`usePopoverPosition`新增显式`side:"below-fixed"`：不翻到行上方，按剩余视口限制maxHeight；面板整面可滚，子区不收缩，滚动不穿透。其他浮层默认定位与AI原有allowFlip口径不变。颜色回调深一档到飞书采样版累计混白约30%，桌面/移动主题同档，保留17.8px节点图形/14.9px标签图形。实测笔记本/分组/文档左缘5/22/39px与面板一致，行与面板相交0；1315×860/760×600/560×600靠底均不遮当前行，可滚到最后一枚加密图标并选中。tsc/相关40例、最终相关30例/全库257文件1998例/两端构建/Android安装（仅5556）/ui-metrics/bundle/diff通过；移动六态0差异与八色令牌实测通过。CSS nodeIcon104→107（整面滚动/阻止穿透/子项不收缩）。证据`.css-audit/node-icon-below-261015/{results.json,final.png,mobile-colors.json,*.log}`；隔离桌面数据`/tmp/lake-node-below-261015-BVNh7w` / CDP9244 / 资源19844。早期位置探针使用鼠标移动时错误带left按钮，曾误触拖拽；已改真实buttons状态后整套复跑。未提交/未推送。
- **本批门禁**：tsc / 全库257文件1997例（跳过5文件16例）/ 相关41例 / 两端构建 / Android assembleDebug / core / mobileui / bundle / ui-metrics / diff通过；新移动CSS101声明，theme tokens171→181（8色+图形尺度+独立表情字号）。专用AVD lake_gate（5556/9336）六态快照0差异、知识库/目录选图标两屏走查五类探针0；另8项业务实测（默认页、选色落库、持续选择、图形展示、标签图标、移除、新建预览）与创建面板末行可达/深色图形通过。设备截图一律adb screencap，证据`.css-audit/mobile-node-icons-261015/{results.json,desktop-defaults.json,create-scroll.json,*.png,*.log}`。临时验收分组已按正常删除移回收站、夹具文档/笔记本图标已复原；用户5554设备未重装。本批未提交/未推送；同期其他移动端批次已独立提交`b778dca`，勿把这部分混作本批。
- **本次实测教训**：曾额外把组件CSS包进 `@layer feature`，构建时组件CSS早于入口层序声明，feature反而成为首层，表情字号被legacy的font继承压到14px；已撤回额外分层调整，复核恢复26px。重载探针需等待旧document替换，隐藏实例要开启CDP焦点模拟才会完成目录淡入与真实命中。

### 261014 · 目录「设置图标」新增**图标**类目（桌面）+ 选择器与内核面板**解耦**

- **用户点单**：目录的「设置图标」在**表情符号**之外增加类目**图标**（"增加一些给笔记本使用的图标，文档之类的也可以使用"）；参考飞书/钉钉的图标选择器（**彩色图标 + 选色行**）。**只做桌面**（用户明确"先不动移动端"）；**表情符号那一页不动**。
- **值方言（不动库表、不动同步协议）**：`tree_nodes.icon` 一直是一个 **≤16 字符的字符串**（表情符号就是它的历史值）⇒ 新类目只扩展值的方言：`i:<短id>:<色号0-7>`（例 `i:zap:5`）。**短 id 是硬要求**（lucide 长名如 `graduation-cap` 编码后 18>16 ⇒ 两端 `assertNodeIcon` 直接抛"无效的图标"）；`src/lib/nodeIcons.ts` 内置 **40 个图标 + 8 档色**，单测逐条断言编码 ≤16。历史 emoji 值原样走 emoji 分支 ⇒ **旧数据观感零变化**。
- **渲染形态**：本批最初为彩色线性字形；**261015 用户要求增加底色后，已改为彩色圆角底块 + 白色线性轮廓**，选择器/目录/标签共用图形，详见上节。旧「不着底块」取舍不再是当前方案。
- **面板与内核解耦（用户："这两个面板可以分离了，做到互不影响"）**：过去「选图标」浮层**借用内核**的 `.ne-ui-unicode-emoji-*` 类 ⇒ 只能靠在未分层文件写**全局覆盖**（`-item > button` / `-tabs` / `-search input`）并给该表面**钉 5 个 `--lakex-editor-*` token**，而这些规则**同时命中文档里内核自己的表情面板**。现在它是一等自有面板：表面走 Overlay 默认的 `.ln-popover`、输入走 kit 的 `.ln-input`、类型页签走 kit 的 `.ln-tabs`（横向页签唯一来源），两页网格在 `src/components/ui/nodeIcon.css`；那 3 条全局覆盖与 5 个 token **全部删除**。契约回填：`docs/LAKEX-CONTRACT.md` **§5.35**（标题与 ③④⑥ 已标注作废/教训）。
- **实现位置**：`src/lib/nodeIcons.ts`（目录 + 编解码 + 默认页规则 + 单测）· `src/components/ui/NodeIconGlyph.tsx` + `nodeIcon.css`（图形与面板）· `Sidebar.tsx`的`EmojiIconPicker`（顶部双tab/右上移除/选色/图标网格；emoji分组跳转在底部）· `MultiTabEditor.tsx`的4处`tab.icon`统一走图形组件。**当前打开按节点类型默认页，已保存色号仍带出**（最初按当前值决定页的方案已被用户改定）。移动端组件与实测见上节。
- **门禁**：`tsc` ✓ · 全库 vitest **255 文件 / 1974 例** ✓ · `ui-metrics`（非主题颜色 0 / 字号字面量 0 / `!important` 10 / 未定义 token 0）✓ · `check:core`/`check:mobileui`/`check:bundle` ✓ · 两条构建 ✓ · `git diff --check` ✓ · `cssLayers`：新增 `components/ui/nodeIcon.css`（104），`kernel-theme.css` 69→**64**、`app/misc.css` 顺手按实测收紧到 **113**。
- **261014旧版设备实测**（隔离 userData + `lake://app` + CDP；证据 `.css-audit/icon-picker-261014/`，gitignored）：面板 = `.ln-overlay-surface.ln-popover.node-icon-picker`、**全页无内核面板类**、418×401、正文 266 高、40 图标 / 8 色；表情页 **9 组 / 1055 格 / 26px 字形**（原观感未变）；点「紫 + 闪电」落库 `i:zap:7` ⇒ 目录行与标签页都渲染彩色字形（tab 那枚 `i:rocket:3` = 绿 / 13.6px）；深色主题取 `#b39cf0`、面板底 = `--lake-bg-panel` `rgb(30,31,35)`（**不再依赖内核 token**）。最新底块形态与尺寸见261015节。
- **未做 / 待跟进**：① ~~移动端新图标编码显示成原始串~~ **261015已接入自有选择器/图形，详见上节**。② 图标集是**数据表**（40个，可加/换/调色）；③ 钉钉那套实心图标资源未引入（仍用lucide、描边1.75）。

### 261014 · 分屏：复合标签右键菜单（取消分屏 / 左右互换）

- **用户点单**：分屏优化的重点原本是那条浮动控制条；用户先问"能不能真正骑着边线"，随后改为 **"算了不做骑边线，直接做复合分屏 tab 的右键功能"**。
- **落地**：合并标签（`data-split-group`）加 `onContextMenu` → `tabCtx.split = true`；`TabContextMenu` 新增 `split` 模式，
  **只给两项**：取消分屏（`onExitSplit`）/ 左右互换（`onSwapSplit`，都复用 App 既有回调），**不混入**单页的关闭/钉住那一套
  （合并标签代表两页，单页语义在这里不成立）。
- **随后用户同批再次点单：「去掉浮动条吧，彻底清除了」** ⇒ 浮动药丸 `SplitPaneControls` **整体删除**，
  `splitView.css` 里那 5 条规则（`.tab-split-controls` / `.is-dragging` / `.tab-split-grip` / `.tab-split-btn` ×2）一并删掉，
  CSS 基线 34 → **9**；打包性能脚本的"两栏态"探针改看 `.ln-split-handle`（控件没了）；`docs/PANEL-CONTRACT.md` 的对应几何条目同步删除；
  `GripVertical` / `MoreHorizontal` 两个只服务于它的图标 import 也删了。
  ⇒ 分屏动作现在**只有两个入口**：合并标签**右键**（取消分屏 / 左右互换）+ 合并标签上的 **×**（取消分屏）。
- **实现位置**：`src/features/editor/MultiTabEditor.tsx`（合并标签 JSX + `TabContextMenu`）；护栏 `src/features/editor/splitView.test.ts` 新增 1 例。
- **门禁**：`tsc` ✓ · `vitest src/features/editor` 196 例 ✓（全库另跑）；纯 JSX/无几何变化 ⇒ 未跑设备/视觉装置（按 AGENTS §3#21 分层）。
### 261014 · 桌面小记工具条精简（去掉「引用」「有序列表」，9 项 → 7 项）

- **用户点单**：桌面小记做一下精简 —— 去掉「引用」和「有序列表」。
- **改法**：只动**唯一来源** `src/features/editor/lakeRuntime.ts` 的 `QUICK_NOTE_TOOLBAR_ITEMS`（删 `"orderedList"` / `"quote"`）⇒
  顺序 = 日期 · 表情 · 图片 · 附件 · 待办 · 无序 · 分隔线；两处护栏同步（`quickNoteToolbar.test.ts` 的权威顺序、
  `quickNoteNoteUi.test.ts` 的"该有的在/禁的不在"），AGENTS §4 的长期口径一并改成"七项"。
- **影响面**：桌面小记写作卡（pane/inline）立即生效；**移动端小记不渲染内核工具条**（`showToolbar:false`，走底部 dock）⇒ 无可见影响。
- **门禁**：`tsc` ✓ · `vitest src/features/quickNotes` 48 例 ✓（全库另跑）；未跑设备装置（纯条数变化、不动几何）。
### 261014 · 多维表行窗口正式接入（纳入master提交，发行包未发布）

- **用户接入标准**：5000×20主要加载/交互不到秒级可接受；33ms滚动/50ms输入等精细目标只作优化参考，不再阻止接入。正确性、只读/保存、缓存有界与正常回收仍守住。
- **已整合主树**：主Grid与关联选择器共用BitableVirtualBody（viewport+上下6行缓冲+最多1编辑/IME pin），完整5000记录不裁剪；默认memo(BitableViewportCell)、仅key/size/source拓扑复用、直接Map索引、选择器共享标量展示。默认锁定主表选字复制不改；拖拽/隐藏/换表/卸载清监听和帧。没有第二套运行期Grid/自动GC/扩大堆/GPU或安全配置改动。
- **依赖/许可**：`@tanstack/react-virtual`精确3.14.19，virtual-core在lock为3.19.4（前轮“两包同为3.14.19”不准确，以lock/包许可为准），仅新增两包；`public/third-party/tanstack-virtual.LICENSE.txt`已确认随包。core/正文v1/mutations/history/session/Lake与Univer内核/附件/S3不改。
- **主项目真实.app两轮**：首开约0.31–0.38s/重开0.17–0.22s，25行500格/完整模型5000、可到第5000行；最后48输入p95 39.7ms/max54.2ms，滚动p95 35.8ms。旧全量同冻结源23.09/16.79s；此前探索约15s不是最新包。之前长序列100–450ms尾部仍观察，不宣称全场景无卡顿。
- **内存主树复核**：300长距离滚动/120真实输入/6重开/8标签；8标签总工作集采样峰两轮约1.84–1.88GiB，完整模型保留且只约25挂载数据行；全部关表正常15s堆均约103MiB/行0，最后总工作集检查点约709MiB。GC诊断102MiB分列，未加入产品；未发现新增无界缓存。工作集含共享页/采样有短峰盲区，不是private/单表精确增量，也不保证4/8GiB/数小时/真实大图无OOM。
- **门禁**：接入主树曾251文件/1945例通过；本批性能提交的精确暂存快照另验250文件/1936例通过（均跳过5/16，计数差来自未带入的其他在途改动）· tsc/桌面+Android构建/ui-metrics/core/mobileui/bundle/diff通过；主树真实默认GPU/sandbox/contextIsolation包23项业务复跑通过，主表24态288几何一致，未重烤基线。新增`npm run test:bitable:packaged`显式真实包与合成/tmp夹具，端口占用即拒绝，独立实例/页内剪贴板/owned child收尾。
- **装置坑**：初次连续Enter只固定等80ms、没有等待屏外异步焦点，包检查一度失败；补真实hover/可见命中与每步等实际focus（≤1s）后全套复跑。逐步r0→r30诊断正常，失败原始记录保留；不把工具等待/人工IME与产品帧回执混为一谈。
- **当前契约/证据**：`docs/BITABLE-VIEWPORT.md`（AGENTS/架构已登记）；`.css-audit/bitable-integration-261014/RESULTS.md`与`evidence/{integrated.json,interaction.json,business.json,memory/integrated.json,verified-main-package.json}`。测试.app在同目录`package/mac-arm64/`，未签名公证/DMG；本批纳入master性能提交，不restart用户实例或触碰正式数据。
- **剩余仅发布前补验/观察**：低内存设备与数小时、多应用共开；真实大图/高扇出关联/更多组合；完整历史导出真实云发布矩阵；签名公证/发行包。旧PoC/调研在`.css-audit/bitable-virtual-poc-261014/`留历史证据，**“未接入/预算未齐不能接入”不再是当前决定**。
- 本批提交范围：目录最小性能优化、多维表窗口化、对应测试/正式包验收脚本与契约文档。图标/AI动效/桌面几何与安卓在途改动未混入。并行移动端会话期间的提交和交接均保留。

### 261013 · 大目录最小优化正式落地（用户授权；两处产品改动）

- 实现：`App.tsx` 的 `onBlockedSave` 提成 `useCallback([showNotice])`，保持文案/保存失败语义；`Sidebar.tsx` 的原 `div[role=treeitem]` 内容拆成本文件 `memo(TreeRowFace)`，只传本行状态与原回调。递归/筛选/展开/定位逻辑不动，不新增DOM包装/CSS/依赖，不做Set优化/自定义memo比较器/虚拟化。保留了同文件在途图标面板改动。
- **正式非插桩包对照**（5000文档/20000合成附件，默认GPU/sandbox；每场景12次）：同组中位 **208.5→73.9ms**，跨笔记本 **231.2→74.8ms**；两组修改后均未观察到>50ms长任务。目录DOM数量和行结构/文字/class/几何hash一致。递归结构仍检查全树，不夸称彻底解决。
- 新增 `src/components/app/sidebarRendering.test.ts` **9例**：真实公共Sidebar的深层高亮/旧高亮清除、行图标不全量重建、新回调不旧闭包、重命名图标锁、折叠定位、文档不自动展开子项、过滤、刷新增删移动、新建菜单与上游回调护栏。
- 新增可复跑 `scripts/packaged-performance/sidebar-regression.mjs`（真实packaged+鼠标事件，独立/tmp数据）。**17场景通过**：文档/子项展开语义、跨组跟随、重命名、锁/解锁、筛选清除、新建子文档、跨级拖拽/释放、同级重排、确认删除+恢复刷新、新组刷新、浮出目录、浅/深/暖×1280/680宽窗。恢复/刷新部分走既有IPC，拖拽与菜单走真实点按；无真实S3。
- **验证**：tsc ✓ · 全库vitest **242文件/1891例**（跳过5/16）✓ · ui-metrics/check:core/check:mobileui ✓ · build:web/check:bundle ✓ · 真实默认GPU包stylesnap **6相关态0差异**（plain浅/深/暖、hover-row、drag、menus；**未重烤**）✓ · diff --check ✓ · detector空报告。桌面dist已重建；候选.app在 `.css-audit/tree-implementation-261013/package-after/mac-arm64/`，未发DMG/未签公证/未提交/未推送。
- 证据（gitignored）：`.css-audit/tree-implementation-261013/evidence/{before.json,after.json,stylesnap-gate.log,regression/sidebar-regression.json}`及截图/构建日志。测试只改合成库；自起实例已结束，不碰正式数据。
- 装置踩坑（不是产品缺陷）：隐藏行按钮需真实hover；“新建文档”会打开标题弹窗，要先关闭再拖；重载后不能马上把旧 `__desktopEditor` 当就绪信号。已修驱动后全部复跑通过。

### 261013 · 大目录最小方案 + 隔离实验（现已正式落地，见上）

- 用户要求先出方案，可小范围试验；**主工作树 App/Sidebar 产品代码未修改**，只在 `.css-audit/tree-perf-261013/source` 的冻结副本试验真实默认GPU包。
- 已证引用根因：每次切标签，5061树行共约10122次重型行面渲染；诊断所有行的onSelect都变化，实际active/context各只影响2行。链 = App内联onBlockedSave → persistTab → openNote → sidebarSelect。
- **推荐两处**：① App把onBlockedSave变为useCallback（依赖showNotice）；② Sidebar保留递归TreeRow，把原div[role=treeitem]内容拆成本文件memo(TreeRowFace)，只传本行active/context/open/locked/drag/drop等状态与原有回调。不加DOM包装/不改CSS/不做自定义比较器/虚拟化。单做Set保引用、单拆行面或单稳回调均无收益，**展开Set改动不纳入推荐**。
- 最后真实包对照（每场景12次）：同组中位 **226.6→75.1ms**、p95 **264.1→99.7ms**；跨笔记本中位 **231.6→82.0ms**、p95 **257.3→128.2ms**。重型行面 **10122→4次**；递归结构仍10122次检查、DOM节点104604不减。候选同组0长任务，跨组3个51–75ms长任务，不夸称无卡顿。
- 已验：active/context唯一、折叠分组从别标签返回自动展开定位；强制排除屏外content-visibility记忆高度差后，行结构/文字/class/几何hash与原包一致。候选副本tsc+**6文件29例**（行面8例与既有保存/淘汰/索引/拖拽相关测试）通过。真实跨级拖拽/过滤/新建/刷新/删除恢复/浮动与窄窗多主题等**未回归，正式落地前必做**。
- 方案/原始数据/去计数器候选补丁：`.css-audit/tree-perf-261013/evidence/{PLAN.md,candidate.patch,baseline.json,lean-combined.json}`；补丁基于旧冻结源码，**不能覆盖主树在途图标面板改动**，要就地整合。实验进程已结束，未提交/未推送；§3#22已由用户授权正式实现，验收结果见上。

### 261013 · 正式包性能验收（默认 GPU；只测量，不改产品）

- 用户授权做正式包性能验收。冻结当前 HEAD `04a22b3` + 当时工作树（源码/vendor 产物 hash 已保存），由副本构建真实 macOS arm64 `.app`。**不是 dev/scheme 冒充 packaged**：`app.isPackaged=true`、`lake://app`，Electron44.3.0 / Chromium152.0.7977.78 / Node24.20.0；Apple M3 /16GiB / macOS27.0.1。保留默认 GPU / sandbox / contextIsolation，未加 disable-gpu/no-sandbox/实验加速参数。
- GPU **确实启用**：ANGLE Metal Apple M3 + GraphiteDawnMetal；Code Cache 46 文件约6.4MiB落盘。没有证据需要新增“GPU加速开关”或改 v8CacheOptions/no-store。
- 固定合成库：**5000文档 /20000附件**（正文约27.6MiB、附件约78.1MiB，每份4KiB），媒体卡字段取自真实内核插入附件的序列化；不是20GB传输。正常已建索引，搜索不纳入本轮。
- **最后一轮前台确认数据**（小样本，不作跨设备保证）：空应用缓存启动3次中位 **2.10s**（2.06–3.51），同目录保留缓存3次中位 **1.69s**（1.65–1.91）；程序化长文滚动中位16.7ms；保存ack普通约1–2ms、2MB约30ms；四类型首开/长正文/多标签/分屏均已测。完整数值与测量定义看下面报告（例如分屏313ms含250ms驱动等待，不能当纯应用耗时）。
- **最强热点证据 = 大目录**：同库同对标签，目录展开 **105385 DOM /标签→帧中位241ms/p95 289ms/23长任务**；仅点“全部收起”后 **8480 DOM /26ms/p95 43ms/0长任务**。CPU profile包含React/lucide重建与布局/几何读取。**并未改默认展开语义，也未做已否决的目录窗口化**；最小修法需先定位activeId/context变化是否整树重渲染，列为 §3#22。
- 多维表 **5000×20** 仍不流畅：探索/确认轮12.7–15.9s，最终 **14.86s**，最大长任务 **3.71s**；该档JS heap约0.47GiB，进程工作集合计约2.15GiB（共享页不能当private footprint）。该旧包基线后已获261014用户确认并正式接入行窗口，当前看§0/#11。
- **同步响应验证**：真实 packaged主进程 + core + S3 SDK，只接127.0.0.1测试服务（每请求1500ms）；整轮 **23.67s /18请求 /5文档增量上传**，全程85次切标签中位 **36.6ms/p95 63.8ms/max248ms**、保存ack **7.4ms**；没有被整轮写锁阻塞。目录已收起；不是七牛真网络/全附件上传验收。
- 验收结论：**测量完成，不是“上线性能全部通过”**。大目录/大多维表存在真实卡顿；真实云/20GB附件、Windows与低配机、Developer ID签名公证后的首装启动未测。本包未签Developer ID、未公证、未生成或发布DMG。
- **可复跑装置**：`scripts/packaged-performance/{seed.mjs,make-fixture.py,run.mjs,cdp.mjs,loopback-s3.mjs,README.md}`（默认检查真实.app/隔离数据/端口，run默认清理运行库，进程按owned child退出）。**证据不入库**：`.css-audit/packaged-perf-261013/evidence/REPORT.md` / `results.json` / `source-manifest.json` /截图/CPU profile/日志；冻结包在同目录的 `package/mac-arm64/`，夹具 `/tmp/lake-packaged-perf-fixture-261013`。不要把过程文件变成第二份待办。
- **门禁如实**：冻结副本tsc与build/package成功；真实package基础/Drawnix烟测exit0；桌面范围vitest **199文件/1684例通过**（跳过5/16）。冻结全库vitest **4文件/5例失败**：4例缺Android原生文件（桌面副本未复制），1例是冻结时移动kit声明466→476超基线；未改移动端/未宣称全库绿。源码冻结后其他会话继续改Sidebar/theme等，**本包结果不覆盖后续改动**。

### 261013 · 安卓端小记重做：去掉顶部工具条、复用文档编辑的 dock（**待用户验收**）

- **用户点单**：安卓端小记不要和桌面一套样式；**顶部不要工具栏**；**直接复用文档编辑的工具栏**（"是复用"——文档侧以后改了这边要跟着变），"更符合移动端输入习惯，也是语雀 App 的方式"。
- **落地（复用而非照抄）**：
  · 抽出 `src/mobile/editor/EditorDockHost.tsx` = **EditorDock + 插入接线**（隐藏 `input[type=file]` → 内核 `insertFiles`；表格走 `table` 命令）。
    **文档编辑器与小记写作卡共用这一份**（`DocumentEditor` 里原有的一份就地接线已删）⇒ 文档侧 dock 的任何变化两端自动一致，不会再漂移。
  · 小记 `QuickNoteComposer`：新增「内核实例 state」+ 用 `QuickNoteEditor` 新开的 `onEditorInstance` 口拿实例（桌面不传、完全不受影响），底部挂 `<EditorDockHost editor={editorInstance} editing />`。
    ⚠️ 实例**必须是 state**：ref 变化不触发重渲染 ⇒ dock 会一直拿到 null、命令静默失效（与 `DocumentEditor` 同一个坑，注释里已写明）。
  · **关掉顶部工具条用的是内核既有开关** `showToolbar:false`（`disabledPlugins` 去掉 `toolbar`，与文档编辑器编辑态同一做法），**不是另做一套隐藏**；note 版式与正文排版不变。
  · 布局：小记页内联写作时**首页胶囊底栏让位**（两条都贴底会打架，胶囊 z-index 更高会盖住 dock），滚动区改按 dock 占位留白（`.mobile-scroll--with-dock`）；capture 浮层同理（`.mobile-qn-composer-wrap` 底距）。
- **顺带消掉一条旧缺口**：移动端小记现在与文档**输入能力一致**（「＋」全量面板 18 项 + 「Aa」+「更多」+ 表格/音频/视频/拍照）⇒ 早先记的"移动端小记插不了表格/代码块/公式/分栏/画板"**不再成立**。
- **两端形态有意不同**：桌面小记仍用它自己的九项工具条（用户只要求改安卓端）。
- **同批两条用户点单（移动端表情面板）**：
  ① **去掉「搜索」入口**（用户："这个没啥意义在移动端"）⇒ 移动端面板没有搜索 tab、也没有输入框（`EmojiPanel` 里的 filter/searching 状态一并删除）。
  ② **分类条压缩成一屏放得下、不再横向滚动**（用户：横划会被外壳手势抢走 —— 小记里触发"小记/知识库"切 tab，文档里触发大纲抽屉）。
     去掉搜索后是 **9 个分类**，在 412px 上每个 **≈45.8px** ⇒ 既不横滚、又满足 44 命中区（`flex: 1 1 0` + 去掉 gap）。
     另给面板根挂 **`data-prevent-swipe`**：`useHorizontalSwipe` / `usePanelDrag` 本来就排除这类元素 ⇒ 偶发横划不会再被外壳抢走（既有约定，未新造机制）。
- **状态：已提交** `fed89e3`（移动端那批；桌面部分见「选图标」那条说明）。

### 261013 · 「选图标」面板两端复用内核表情面板（桌面 + 移动）

- **用户点单**：目录/文档的「设置图标」选择器（图1）能不能复用**内核插入表情那个面板**（图2）的样式；移动端也照桌面重做。
- **为什么可行（先证后做）**：① 内核那套面板的 21 条 CSS（`.ne-ui-unicode-emoji-*`）**已随 `@dlient/lakex-doc-react/style.css` 进我们的产物** ⇒ 复用不新增样式；
  ② 面板**不是公开组件**（`dist/index.d.ts` 无 emoji/picker 导出），但**类名即契约**、结构可从 CSS 反推；③ 与 `noteRefCard` 复用 `.ne-link-editor` 同一姿势：
  `surfaceClassName="ne-ui-unicode-emoji-panel"` + `className="lakex-default-theme"`（**必须**：浮层在编辑器树外，不加则面板背景透明，实测 `rgba(0,0,0,0)`）。
- **落地**：桌面 `Sidebar.tsx` 的 `EmojiIconPicker` 重写（搜索 + 分组标题 + 8 列 32px 格 + **底部 tab** + 清除行；定位改走 `usePopoverPosition`，**顺手去掉**历史上那处"估算高度自夹"）；
  移动新增 `src/mobile/ui/EmojiIconPanel.tsx`（移动端自有组件），接进 `NotebookWorkspace` 与 `CreateNotebookSheet` 两个入口；两端共用 `src/lib/emojiRecents.ts`（设备本地「最近使用」，已登记进 STORAGE-LAYERS）。
- **行为对齐内核**：内容按分组平铺 + 分组标题、底部 tab 跳转/高亮、**有最近记录才出现「最近」**；搜索态隐藏 tab。
- **移动端最终形态 = 微信样式（用户 261013 第二轮定稿，推翻上面的"复用内核面板"）**：用户看过后说"移动端这个也不行，直接做成微信样式、**分类放顶部**"⇒
  移动端 `EmojiIconPanel` 改为**自有微信样式**：**顶部**分类条（🔍搜索 · 🕐最近 · 8 组图标按钮，选中给浅底）+ 正文**浅灰底大格子**（8 列 51×44、表情 28px、无边框）+ 底部「清除图标」；
  **不复用内核类**，配套那 3 条内核 token 桥也从 `mobile/theme/light.css` **撤回**（`mobileLayers` 账本回到 61）。桌面那份仍是内核面板样式（两份视觉不同是用户明确选择，见 LAKEX-CONTRACT §5.35）。
- **移动端入口在哪（用户问过两次，记下来）**：工作区目录树**每行右侧的 ⋯** → sheet 菜单 →「**设置图标**」（文档与分组都有；移动端没有"点图标即改"的手势）；
  另一处是**新建知识库** sheet 左侧的图标按钮。⚠️ **笔记本（知识库）本身建完之后没有改图标的入口**（只有建库时能选）——既有缺口，非本次引入；桌面则可以（点目录行首图标本身就改）。
- **两处内核 CSS 坑就地纠偏**（不碰 vendor）：`-tabs` 被内核写成 `overflow-y`（横向行笔误，9 个 tab 会溢出面板）⇒ 补 `overflow-x: auto`；搜索框是内核内部输入组件，我们渲染原生 input ⇒ 自己补盒子。
- **验证**：`tsc` ✓ · `vitest` **241 passed / 5 skipped（1897 例，新增 6 例 emojiRecents）** ✓ · `ui-metrics` ✓（移动端字号字面量 49 → **47**）· `check:core` ✓ · `check:mobileui` ✓ · `check:bundle` ✓；
  **设备**：桌面三主题实拍（418×266 / 32px 格 / 26px 表情 / 选中 tab 700；面板底 `#fff`·`#1e1f23`·`#fff`）+ 移动 AVD 实拍（372 宽 / 命中区 44×44 / 表情盒 32）+ `check:mobilesnap` **6 态 0 差异** + 22 屏走查。
- **⚠️ 用户实拍抓到一真缺陷（已修）**：**桌面面板会偶发没有背景（透明）** —— 根因是面板底色取 `--lakex-editor-background-foreground`，而那些 token 由**内核在编辑器挂载时注入的 schema `<style>`** 提供；
  **没有编辑器时 tag 数 0 ⇒ token 缺失 ⇒ `background-color` 失效 ⇒ 整块透明**（复现：全新实例 `panelBg=rgba(0,0,0,0)`；把内核那两份 style 禁掉同样复现）。等有编辑器挂载它又"自己好了"，所以是间歇的。
  **修法**：在**未分层**的 `styles/kernel-theme.css` 给该表面钉 5 个 token（`.ne-ui-unicode-emoji-panel.lakex-default-theme`，值走 `--lake-*`；未分层 + 0-2-0 才压得过内核的 0-1-0 声明，且不进编辑器树）。
  修后实测：**禁掉内核 schema，面板依旧实心白底**；`cssLayers` 账本 `kernel-theme.css` 64 → **69**（已写理由）。
  ⚠️ **通用教训**：我们自己渲染却依赖内核注入 token 的表面（本例、以及 `noteRefCard` 那两个浮层）都要显式兜底 —— 已写进 LAKEX-CONTRACT §5.35 ⑥。
- **「最近」= 常显（用户 261013 二次定稿，有意偏离内核）**：内核是"有最近记录才前置「最近」"，用户要求**始终显示、空的也留位置**（否则会怀疑这功能到底有没有）⇒
  tab 与分组恒定存在，为空时给一句「用过的图标会出现在这里」。实测：空态下 tab = 最近/表情/…、选中 = 最近、该分组 0 个格 + 提示；选一个 😀 后填入并落盘 `localStorage["lake-notes-v3.emoji-recents"]=["😀"]`。两端一致。
- **261013 第三轮（用户点单，移动端 + 第三个选择器）**：
  ① **「清除」并入「最近」首格**（对照色板里那块"默认/无填充"首格；用户要求），**底部整幅「清除图标」条取消** ⇒ 少一行高度；只在「最近」分类出现（最近是默认且常显 ⇒ 一步可达）。
  ② **第三个表情选择器也改成微信样式**（`quickNoteToolbarWidgets.ts` 的 `openEmojiPicker`：小记写作卡工具条 + 移动 dock 共用）：顶部分类条（搜索 / 最近 / 8 组）+ 浅灰底大格子 + 空态；
     表情表由原来写死的 40 个改为**与图标面板同源的 `LAKE_EMOJI_GROUPS`**（全仓不再有第二份表情表），并支持按名称搜索。
  ③ **「最近」按入口分桶**（AGENTS §3#14）：`icon`（设置图标）/ `input`（输入态）两个 localStorage 键，已登记 STORAGE-LAYERS。
  ④ 字号不写 px：移动端新增 `--mb-emoji-cat-size` / `--mb-emoji-glyph-size` 两个令牌（字号字面量 51 → **47**，回到基线内）。
  ⑤ **移动端 dock 的「＋ → 表情」改成"在面板里占满"**（用户 261013：*保持固定高度不要跳动，就和输入法输入面板一样*）：
     原来它弹的是**锚定浮层**（高度随内容变、盖在插入面板上）；现在新增 `PanelMode = "emoji"`，把表情面板**就地渲染在 `.med-panel` 里**（该容器本就是固定高：`--kb-offset` / ≤60dvh）⇒ 占满展开区、高度不跳、可连续点选（`runPanel` 本来就保持面板打开）。
     ⇒ 由此**移动端 dock 不再走 `openEmojiPicker`**（那个浮层只剩小记写作卡工具条在用）。
  ⑥ **面板组件通用化 + 改名**：`mobile/ui/EmojiIconPanel.tsx` → **`mobile/ui/EmojiPanel.tsx`**，props = `{ bucket, onPick, onClear?, fill? }` ——
     「选图标」（传 `onClear`，最近首位是清除格）与「输入表情」（传 `fill`，撑满宿主）**共用同一份移动端面板**；
     ⚠️ 改名牵动 `NotebookWorkspace` / `CreateNotebookSheet` / `EditorDock` 三处 import（已同步）。
  ⑦ **固定高度**（消"跳动"）：图标 sheet 的内容区由 `min/max-height` 区间改成**固定 `height: 42vh`**（切分类不再变 4vh；空态就留白，像输入法）；移动浮层那份同理固定 `40vh`。
  账本随之更新：桌面 `app/quick-notes.css` 521 → **543**、移动 `quick-notes.css` 98 → **153**、`theme/tokens.css` 168 → **170**。
- **账本**：移动 `kit.css` 441 → **466**、`theme/light.css` 61 → **64**（合法新增，理由写进 `mobileLayers.test.ts`）；桌面 `misc.css` 删旧 14 条规则、`overlay.css` 把 `.emoji-picker` 从表面清单摘掉。
- **新观测回填**：`docs/LAKEX-CONTRACT.md` **§5.35**（类名族 + 复用姿势 + token 作用域 + 两处内核 CSS 坑 + 设备实测数）。
- **状态：移动端部分已提交**（`fed89e3`：`EmojiPanel`/`kit.css`/移动 `theme`/`emojiRecents`/`STORAGE-LAYERS`）；**桌面部分仍未提交**（`Sidebar.tsx` 的 EmojiIconPicker、`styles/{overlay,misc,kernel-theme,app/quick-notes}.css`、`quickNoteToolbarWidgets.ts` —— 与桌面会话改动同文件）。

### 261013 · 云同步浮层「同步设置」按钮折行修复（同步中偶发排布错乱）

- **用户报**：云同步图标浮层在**同步过程中偶发排布错乱** —— 「同步设置」按钮换行，很快就恢复（没截到图）。
- **真因（设备级机制复现）**：`.sync-status-actions .b3-button` 是**可收缩的 flex 子项**（没写 `flex` / `white-space`）。同步中 footer 文案会变长
  （`上次同步 … · 未同步 N 项`）⇒ 行内空间被挤、按钮被压缩、**标签折成两行**（`Range.getClientRects().length` = 2），而基座 `line-height:1` + 固定高 ⇒ 行盒错位；同步一结束文案变短即恢复，与"偶发、很快就好"完全吻合。
  复现实测：正常 `121px / 1 行` → footer 变长 `109px / 2 行` → 注入修法 `121px / 1 行`。
- **修法（单一来源，`src/styles/components.css` 一条规则）**：`.sync-status-actions .b3-button { flex: 0 0 auto; white-space: nowrap; min-height: 30px; }`
  —— 动作行的按钮是**固定区、不可压缩**（§4「浮层列布局的固定区用 `flex: 0 0 auto`」既有口径）；左侧文案本就有 `min-width:0 + ellipsis`，长文案改走省略号。
  顺带删掉与 kit 层 `.b3-button` 基座**同值的 3 条冗余声明**（`display`/`align-items`/`gap`；kit 层高于本文件的 legacy 层，本来就赢）⇒ 本文件声明数 **-1**（护栏只许降）。
- **验证**：修后重建 dist 设备实测 —— footer 常见长度与极端长度下按钮均 **121px / 1 行**、动作行高恒定 41px；同浮层统计行（注入 `dd` 超长值 232px）仍 1 行、无溢出 ⇒ **未做投机改动**。
  ✅ tsc / vitest（含 `cssLayers` 声明数护栏）/ `ui-metrics` / `check:core` / `check:mobileui` 全绿。
  ⚠️ 该浮层**不在 `check:stylesnap` 的 42 态矩阵内**，视觉门禁覆盖不到它 ⇒ 本条的判据就是上面的设备级前后对比（别以为"门禁绿了"就验过它）。
- **状态：未提交**（与门禁批次同属本会话；并发会话正在改 `chrome.css`，本批只碰 `components.css`，写域不重叠）。

### 261013 · 门禁批次：`check:stylesnap` 装置根治（抖动归零，严格覆盖 17 → 34 态）+ 门禁分层口径

- **触发**：用户「上一个会话跑了 40 多分钟失败；门禁到底是什么、每次改动都跑很久」。先量化、再根治（不是继续加名单）。
- **量化（本机实测）**：**强制代码门禁总共 ≈21s** —— `tsc` 5s · `vitest` **8s（244 文件 / 1882 例）** · `vite build` 3s ×2 · `ui-metrics`/`check:core`/`check:mobileui`/`check:bundle`/`git diff --check` 均 ≤1s。
  **那 40 分钟全部来自设备级视觉门禁 `check:stylesnap`**：单轮 42 态 **≈294s**，且**一有差异就自动重跑第二轮**（≈×2），再加换实例 / 整份重烤 / 多份快照互拍 ⇒ 上一次会话就是这么烧掉的（与用户改动无关的假红）。
- **真因（离线实证，非猜测）**：5 份完整快照两两对拍 —— keyed 行 **7234 处翻转**，两层：
  ① 裸 SVG 图元（无 id、无 class 的 rect/path/g/circle）「位置即身份」⇒ index → hash 的对应关系在换（元素数不变）；
  ② **行序漂移**：内核图标 sprite 注入顺序跨实例不同（实测 **459 个 key 换位、集合完全一样**）。
- **修法（`scripts/css-audit/stylesnap.mjs` 的 `snapExpr`，两端共用）**：① 裸图元改为 `(tag, 自身指纹)` 的**排序多重集**（信号不丢：图元自身变了指纹仍会变；
  反向对照已否决 —— "整片剔除"会让每态少 **1444 / 2411** 个元素、把画板 SVG 场景一起丢掉）；② 落地前**按 key 排序**，指纹不再反映 DOM 顺序（顺序跨实例不可复现，本来就不能当基线）。
  `check-stylesnap.mjs` 的 **`UNSTABLE_1315` 已删除**（不再需要）。
- **验证**：桌面跨实例两轮（实例 A/B，各 42 态）**0 差异** ⇒ `check:stylesnap` **`GATE_EXIT=0`、34 态严格比对全恢复**（旧 17 态）；
  移动端 `check:mobilesnap` **两次冷启动复跑 6 态 0 差异**（基线已按同一表达式重烤，表达式两端共用）。
- **留档**：旧桌面基线 `.css-audit/baseline-stylesnap-261013-UNSTABLE1315-backup.json`；判据链与两条坑写进 `scripts/css-audit/README.md` 坑 C；**门禁分层口径见 §6**。
- **顺带纠正一条**：上一轮重烤用的 `dist/`（13:34）**比 `src/App.tsx` 还旧** ⇒ 那次基线建在陈旧构建上；本批先 `vite build` 再采（scheme 模式本就要求先构建）。
- **状态：未提交**（装置/脚本 + 基线改动，按 §1 铁律等用户验收）。

### 261013 · 桌面小记「展开」不再覆盖顶栏 / 红绿灯

- 用户截图复现：小记写作卡右上角展开后，内核工具条跑到窗口顶端，与 macOS 红绿灯重叠。根因是 vendor `.ne-ui-fullscreen{position:fixed!important}` 压过了已有桌面 `position:absolute` 适配，计算值仍 fixed、top=0。
- 唯一落点 `src/styles/app/quick-notes.css` 的现有 `.quick-notes-pane .lake-editor-mount.ne-ui-fullscreen`：`position:absolute!important`（必要第三方例外，原因就地注释；全桌面 important 9→10、仍达门禁），其余几何 / 层序不改。不改 vendor / 移动端。内核新观测回填 `LAKEX-CONTRACT.md` §5.12，新增 `quickNoteNoteUi` 反向护栏。
- 真实 Electron 隔离 `/tmp/lake-qn-expand-261013`（CDP 9269）前后对拍：展开层 top **0→38px**，offsetParent 回到小记面板；顶栏 0–34px（含 4px 拼接缝）保留；底边 **820px 不变**，三枚动作按钮整盒几何逐项不变，真实点按退出展开成功。截图 `/tmp/lake-qn-expand-after-261013.png`（页面截图不含 macOS 原生红绿灯，以 mount 不再进入头区验证）。
- 验证：定向 **4 文件 / 27 例** ✓ · tsc ✓ · vitest **240 文件 / 1875 例**（跳过 5 / 16）✓ · ui-metrics ✓ · build:web + check:bundle ✓ · diff --check ✓。桌面产物已重建；未提交 / 未推送。

### 261013 · 桌面 AI 等待 / 生成动态反馈

- 用户要求：AI 思考或等待输出时给动作，避免静态「…」被误判无响应。三个桌面入口共用 `AiAssistantDialog`，只在该面板改。
- 请求发出立即显示 `LoaderCircle.spin + 正在等待回复…`；收到非空白正文后改为「正在生成…」，保留流式正文。成功 / 失败后移除；主动停止当场隐藏（不等取消请求返回）。不捏造「真实思考阶段」：当前协议只有正文 delta，没有 reasoning 信号。
- 无新依赖 / 无等待计时器；复用全应用 spin。状态独立 `role=status / aria-live=polite / aria-atomic=true`，图标装饰性隐藏；`prefers-reduced-motion` 下静止、文字保留。局部 CSS 合法新增 6 声明，cssLayers 账本 8→14、重复组仍 0。
- 验证：真实 Electron 隔离实例 `/tmp/lake-ai-progress-261013`（CDP 9268），仅 mock 渲染层 AI 端口（不读 Key / 不调用真实模型 / 不消耗额度）驱动实际面板；验证等待 → 转圈矩阵变化 → 输出 → 减少动效 → 完成 / 停止。截图 `/tmp/lake-ai-waiting-261013.png` / `/tmp/lake-ai-streaming-261013.png`。新增组件运行测试 6 例（含空白 delta / 返回失败 / 抛错）。
- 门禁：tsc ✓ · vitest **240 文件 / 1874 例**（跳过 5 / 16）✓ · ui-metrics ✓ · build:web / check:bundle ✓ · diff --check ✓。桌面产物已重建；未提交 / 未推送。已有目录栏与并发 css-audit / 移动基线改动均保留。

### 261013 · 桌面目录浮层顶边改为顶栏下缘（底部不变）

- 用户定稿：目录浮出从顶栏以下开始，不再从面包屑以下开始；底部保持现状。
- 唯一落点 `src/styles/chrome.css`：`--lake-dir-peek-top = topbar + 4px 拼接缝`；高度仍 `100vh - peek-top - 12px`。固定目录 / 大纲 / 左缘触发热区 / 浮层层序不改；`docs/PANEL-CONTRACT.md` 与 `geometrySources.test.ts` 同步。
- 真实 Electron 隔离实例（`/tmp/lake-dir-peek-261013`，CDP 9267）前后对拍：富文本 / 表格 / 多维表的 peek 顶部 **64→38px**、底边 **808px 不变**（820px 窗口，底缝 12px）；固定目录整盒几何与热区顶部逐项不变。截图 `/tmp/lake-dir-peek-after-261013.png`。
- 验证：tsc ✓ · vitest **239 文件 / 1867 例**（跳过 5 / 16）✓ · 几何/样式/层序定向测试 **4 文件 / 12 例** ✓ · ui-metrics ✓ · build:web + check:bundle ✓ · diff --check ✓。桌面产物已重建；未提交 / 未推送。并发中的 css-audit 脚本与基线改动不属于本批，未触碰。

### 261013 · 收尾批：同步可用性置灰 + 启动就绪信号 + 移动端同步可观测性 + 并发真交错护栏

- **A2「保存并同步」在云同步关闭时置灰 + 给理由**（用户定稿「改回置灰」）：
  · 桌面：判据在 `App.tsx` 用 cloudState 的 **UI 判据** `isCloudActive(cloudConfigured, cloudEnabled)` → `cloudReady` 经 `DesktopQuickNotes` 透传给工作区；按钮 `disabled={busy || !cloudReady}` + `title`（全局 title→`.ln-tip` 拦截，所以是真提示）。
  · 移动：`bridge.getCloudState()`（复用 `mobileCloudState()`，登记进 `NONE_OPS`）→ 写作卡 `cloudReady` 状态（挂载读一次 + `subscribeSyncSettings` 跟随设置页改动）；按钮置灰 + **一行可见说明**（`.mobile-qn-hint` —— 移动端没有 hover，光置灰用户不知道为什么）。
  · 护栏：新增 `src/components/app/quickNoteSyncGate.test.ts`（两端：判据走 cloudState、按钮按 cloudReady 置灰、置灰必须给理由）。
- **C7「开启应用对齐一次」改用显式就绪信号，不再猜 3s**（用户定稿）：`useAutoSync(ready)` 由 `MobileApp` 传 `phase === "ready"`（= `bridge.init` + `refreshAll` 之后）驱动那次对齐；
  旧实现 `setTimeout(…, 3000)` 的问题：快设备白等、慢设备可能在桥没就绪时就触发（会走「未配置/密钥缺失」的假失败路径）。护栏在 `quickNoteCapturePath.test.ts`（断言不再有 3s + 就绪 effect 存在）。
- **C6 移动端同步可观测性**（用户定稿）：新增 `src/mobile/sync/syncStatusStore.ts`（设备本地、不参与同步；**不塞**两端共用的 `lib/settings.ts`）；
  **写入点唯一** = `bridge.syncNow()`（成功 / 失败 / 未配置 / 密钥缺失各一处；离线这种"根本没尝试"不写）；设置页「连接与同步」新增**常驻一行**「上次同步：<时间> · 同步成功/失败：<原因>」，云同步关闭时追加一句说明。
  **它修掉的真问题**：自动同步失败此前只走 `console.warn`（`reportNativeActionError` 只 warn），**界面上完全看不到**。手动同步的 toast 保留（当场反馈），常驻行负责事后自查。
- **B4 引擎层端到端并发护栏**：新增 `src/core/quickNotePushSyncRace.test.ts`（**真交错**，非等价复现）：把**真实引擎**停在"上传阶段已完成、清单尚未 PUT"的那次 `listDeferredDeletedQuickNotes` 上，窗口内跑**真实 `pushQuickNote`**，再放行引擎落地，断言：
  ① push 后清单含目标条；② 引擎落地后**目标条从清单消失**（覆盖确实发生）、其余条目含墓碑仍在；③ 回核（再 push 一次）⇒ 目标条回来、其余条目与「引擎落地那份」**逐字节相同**、正文/图片对象都在；另有一条 I2 真交错（推送网络窗口内本地又编辑 ⇒ 不标 synced、新内容不丢）。
  **证据等级（如实）**：真交错 + **引擎层**端到端（S3 与本地库仍是内存假件，与两个既有 core 测试同款）；**不是**跨进程/真网络 E2E。既有 `quickNotePush.test.ts` 那例「并发防覆盖」是等价复现，两者都在。
- **验证**：`tsc` ✓ · `vitest` **239 文件 / 1866 例全绿**（跳过 5/16）· `check:core`/`check:mobileui`/`check:bundle` ✓ · `git diff --check` clean · 设备：A2 置灰 + C6 状态行实机核对 · 桌面 `check:stylesnap` **17 态 0 差异 exit 0**（见 B5）。
- **设备核对（门禁实例 emulator-5556，未配 S3）**：
  · **A2 置灰 ✓**：capture 动作行三钮 = 取消(first-class, disabled=false) / **保存并同步(disabled=true)** / 保存(disabled=false)，并显示可见说明「云同步已关闭：不会联网。「保存」只存到本机，开启云同步后可再同步。」
  · **C6 状态行 ✓**：设置 → 同步设置 → 点「立即同步」⇒ 常驻行由「本机还没有同步记录」变为 **「上次同步：13:43 · 同步失败：未配置 S3」**、localStorage 落盘 `ok:false`。
- **⚠️ 设备核对抓到我实现里的真 bug（已修）**：修复前那一行显示 **「同步成功（未配置 S3）」** —— 因为外层把"正常返回"一律记成成功，而「未配置 S3」「密钥缺失」是**没跑成**的正常返回。
  修法：成功判据改为"**真的跑了引擎**"（`result.notes !== null`），写入点仍唯一（`bridge.syncNow` 一处 + catch 一处）；护栏同步改为断言该判据。**这条正是"设备级核对"的价值** —— 单测与静态护栏都发现不了。

- **B5 桌面 `check:stylesnap`：装置修好 + 基线整份重烤 ⇒ 门禁**已重新可用（绿）**，代价 = **严格比对覆盖 34 → 17 态**（用户 261013 定："简单处理"）。五层结论：
  ① **装置自 261012 起一跑就炸**：`snapExpr` 改名漏改调用点（`stylesnap.mjs:339` 仍读 `SNAP`）⇒ `ReferenceError`（**已修**，一行）。
  ② **基线陈旧六天，归因 = 代码漂移（外壳层），不是数据**（子 agent 实测，**我去掉了最初"夹具换代"的错误归因**）：用与基线同构的合成夹具仍 **42/42 全红**、形态每态 **+19 元素**（settings 组 +20）；
     夹具配方相对基线唯一改动（`createSheetIn`→`createUsheetIn`）实测最多解释 **±2** 个元素；增量在**所有态**恒定（含无编辑器的 `settings-about`）⇒ 只能是全局外壳。**"陈旧"被 ① 的崩溃盖住了六天。**
  ③ **真拦路 = 装置抖动**：5 份完整 42 态快照（跨 3 实例）两两对拍 ⇒ **1315 宽态 17/34 翻转**；315 个翻转 key 里 **314 个是「无 id、无 class 的 SVG 图元（rect/g/path）」**，只有 1 个是 `div.list-heading`（`snapdiff` 实测，元素数不变）。
     之前实测过"烤了也过不了"：第 1 轮差 7 态、第 2 轮差 8 态、交集 6 态 ⇒ exit 1（两轮集合互不相同 = 随机抖动，与本批 UI 无关）。
  ④ **处理**：17 个抖动 1315 态写进 `check-stylesnap.mjs` 的 **`UNSTABLE_1315`**（照常采集入库、只跳过严格比对，与窄窗态同款），从一份完整快照整份重烤基线，
     再在**全新实例**（CDP 9255、scheme、冻结合成夹具）自证：**`[gate] 17 态整页计算值 0 差异 … GATE_EXIT=0`**（另有 1 态 `settings-editor:1315:light` 只在一轮出现，被去抖机制按 flaky 排除）。
     **代价如实**：严格比对 34 → 17 态。**正确修法留给专门一批**：在 `snapExpr` 里剔除「无 id 无 class 的 SVG 图元」能**保住全部 34 态**，但那份表达式**两端共用** ⇒ 必须桌面 + 移动端一起整份重烤（做完就删 `UNSTABLE_1315`）。
  ⑤ **交付物**：**冻结合成夹具** `~/Library/Caches/lake-notes-css-audit/fixture`（与基线数据态同构，可直接复用；生成器第 0 步"删欢迎笔记"因 `bootstrap()` 只返回 `notes` 而**静默空转**这件事已记进 README）；
     候选/备份基线在 `.css-audit/baseline-stylesnap-*-261013.json`（gitignored）。判据、三条坑（含 `--states` 不能配 `--write-baseline`）见 `scripts/css-audit/README.md`。
  ⚠️ **环境坑**：两个 agent **同时**起桌面门禁实例会互相踩（`bind() failed: Address already in use (48)` + 门禁连到别人的实例 ⇒ CDP 超时/元素数莫名），起实例前先 `lsof -nP -iTCP:<port> -sTCP:LISTEN` 查。
  ⚠️ **顺带记录一条环境坑**：两个 agent **同时**起桌面门禁实例会互相踩（`bind() failed: Address already in use (48)` + 门禁连到别人的实例 ⇒ CDP 超时/元素数莫名），起实例前先 `lsof` 查端口。

### 261013 · 小记「保存并同步」（单条推送，两端）+ 移动端进后台 best-effort 触发

- **用户 261013 点单**：小记写作卡加「保存并同步」，**只把当前这条小记推到 S3**（不管其他小记），两端都要。
  **按钮形态（用户 261013 第二轮定稿，两端同构）**：**主按钮保持原来的「小记一下 / 保存」不动**，「保存并同步」做成**普通按钮**夹在主按钮与「取消」之间；
  不再有单独的「仅保存」按钮（主按钮本身就是只写本机）。桌面 pane＝`[小记一下][保存并同步][取消][提示]`、inline＝`[取消][保存并同步][保存]`；移动端＝`[取消][保存并同步][保存]`（主按钮仍 `.mobile-qn-primary`）。
  **桌面主按钮改为"恒强调色"**（用户 261013 第三轮："桌面端的小记一下应该有颜色吧"）⇒ **260915 的"新建空态＝中性描边、有内容才强调"就此作废**：
  动作行现在有两个同族描边按钮，主按钮再走中性就分不出主次（移动端本来就是恒实心，两端这下一致了）。
  **无远端清单时退回一次完整小记同步**并如实提示。
  **一处有意的偏离（方案说"云同步关闭时按钮禁用"，实现改成"仍可点、点了给明确原因"）**：移动端没有 hover 提示，
  一个**置灰且不解释**的主按钮比"点了告诉你为什么"更差；两端同行为、不搞两套。出网判据仍在服务端一侧（桌面 IPC / 移动 bridge 都走 `cloudStateOf`+`canTouchNetwork`，UI 不直接读 `enabled`），
  且**本地保存永远成功**、失败提示写明"已保存到本机 · 同步失败：云同步已关闭…"。若你要置灰 + 说明，两端都得补一个"离线提示位"。
- **红线：必须"先读远端清单 → 只 upsert 这一条 → 写回"**。小记清单是**单文件覆盖写、没有 CAS**（`quick-notes/manifests/latest.json`），写一份"只含当前小记"的清单 = 向他端声明"小记全集就这一条" ⇒ 他端按未声明处理（墓碑/GC 误删）。其余条目**逐字段原样保留**（护栏 `quickNotePush.test.ts` 的"逐字节不变"那例）。
  - 内容对象按 contentHash 寻址（`objects/<hash>.qnote`）⇒ 单条 PUT 幂等；已是最新（同 id、同 hash、同图片集）⇒ **不写清单**（不给多端 GC 添噪声）。
  - 两条**退回完整同步**的路径（不静默降级）：① 云端还没有清单（首次）② 远端是墓碑且本机无恢复标记（墓碑权威，不许复活）。
  - 记账 `setBaseHash` + `markSyncedGuarded`（I2 守卫）。
- **落点**：新增 `src/core/quickNotePush.ts`（+7 例护栏）· 桌面 `electron/quickNotesSync.ts` 的 `pushQuickNoteToS3` + IPC `sync_quick_note`（main/preload/native 三处 + `webApiServer` 的 `WEB_METHODS`）+ `QuickNotesWorkspace`（`saveDraft` 改返回 `{ok,id}`——"没改动"路径也要回传**小记 id**，因为编辑草稿 id ≠ 小记 id）· 移动 `bridge.syncQuickNote`（走高优先域 `PRIORITY_OPS`）+ `lakeNativeContract` + `QuickNoteComposer`。
- **互斥域 = 新立的「高优先域」（用户 261013 第二轮点单，判据在 `src/core/maintenancePolicy.ts` 的 `PRIORITY_OPS`）**：
  先按我上一轮的方案做成了"入维护域与 `syncNow` 串行"，用户指出**这不行** —— 本功能面对的就是"长按小记 → 写完 → 要让桌面端及时看到"，而长按从桌面图标进入会触发**回前台整轮同步**，排队等它跑完（弱网实测整轮可到分钟级）正好砸在这个高频路径上。
  ⇒ 另立**第三条队列** `priorityQueue`（移动 `maintenanceLocks.ts` / 桌面 `main.ts` 的 `enqueuePriority`）：**彼此串行、但绝不排在整轮同步后面**。
  代价是它与整轮同步可并行 → 唯一交叉风险 = 整轮同步拿**旧快照**写清单时覆盖掉我们刚写的条目 ⇒ 用**"推送后回核"**兜底：推送成功后往**维护域队尾**排一次幂等回核（远端不缺该条就只多读一次清单）。两端同款，护栏 `maintenancePolicy.test.ts` + `maintenancePolicyCoverage.test.ts`（`runPriority` 也纳入"取锁类别一致 / 同域不嵌套"检查）。
- **移动端进后台 best-effort 触发（同批，对齐思源安卓壳）**：`useAutoSync` 在 `appStateChange(isActive=false)` 也补一次（"离开设备前最后一次推送"）；**失败静默、不做任何等待**（WebView 可能随即被冻结/杀掉）；自动触发之间**在途去重**（对齐思源壳侧 `AtomicBoolean syncing`），手动「立即同步」不受影响。
- **文案如实**：两端「自动同步间隔」行写明"**App 不在运行时不会再按间隔触发**，下次打开或回到前台会对齐一次"——上线的诚实要求。
- **快捷入口（长按桌面图标「小记」）两条定稿（用户 261013 第五轮）**：
  · **这次冷启动不跑整轮同步**：`quickNoteShortcut` 暴露 `whenQuickNoteLaunchResolved()`（命中 `lakenotes://quick-note` ⇒ true；其它深链 / 无深链 / 超时 ⇒ false，**绝不永久挂起**），
    `useAutoSync` 的冷启动那一次先等它 ⇒ 是快捷入口就跳过。理由：写作区本来是秒开的（`captureOpen` 同步置位），但 3s 后的整轮同步跑在 **WebView 主线程**上（读/写清单 JSON、算 hash、遍历条目），正好抢"开始打字"那几秒。
    **代价（已与用户确认）**：这次进入不拉远端新小记；数据上云靠 ① 点「保存并同步」② 进后台 best-effort ③ 下次普通启动/回前台的对齐。
  · ~~保存后退出 App~~ **已撤回（用户 261013 第六轮定稿）**：思源是"提交后可继续提交、手动退出"，语雀是"创建后留在小记页" ——
    两家参考产品都不自动退出，随手记也常常一次记几条 ⇒ **保存后留在小记页**（可接着记下一条），退出交给系统返回/Home。
    额外好处：不再代劳"离开 App"，那次**进后台 best-effort 同步**因此还在（「保存」的小记也有机会上云）；随之删掉了只为它存在的 `suppressBackgroundSyncOnce()`（避免留死代码）。
    **口径已裁定（用户 261013，别再提"补一次兜底同步"）**：点主按钮「保存」= 只落本机，**这就是它该有的语义**。
    我们已经提供了「保存并同步」按钮；**不点它 = 用户不着急同步** —— 这时候再替他偷偷补一次推送是"想当然"（用户原话）。
    ⇒ **不做任何退出时/隐式的兜底同步**；这条小记交给下次普通启动 / 回前台的正常对齐带走（以及用户自己点「保存并同步」）。
    **顺带堵掉一处我自己漏掉的隐式同步**：`App.exitApp()` 会让 Android 分发一次**进后台**事件 ⇒ 那条 best-effort 同步会被拉起来、随即随进程被杀（半截请求）。
    现在退出前调 `suppressBackgroundSyncOnce()`（`useAutoSync` 的一次性开关）忽略紧随其后那次后台触发 ⇒ **快捷入口这条路径只在用户点「保存并同步」时碰 S3**。
- **入口形态核实（用户 261013 提问，读思源两个仓库核实）—— 结论：我们走的是语雀的路，不是思源的路**：
  · **思源「闪念速记」是独立的原生轻量模块**：桌面快捷方式**直指** `ShortcutActivity`（`res/xml/shortcuts.xml`：action=VIEW / data="shorthand" / targetClass=…ShortcutActivity），
    Manifest 里 `launchMode="singleTask"` + **`taskAffinity="org.b3log.siyuan.shorthand"`** ⇒ 跑在**自己的任务栈** ⇒ **返回键退的是这个速记模块**（回 launcher / 原来的应用），**不落进主 App**。
    这正是"手动退出"的真身：**退的是闪记模块，不是整个 App**。
  · 它的界面**纯原生、没有任何小记预览/列表**：`activity_shortcut.xml` = 标题 + 「添加到桌面」+ 提交按钮 + 一个全屏 `EditText`，**无 WebView、不挂内核**。
  · 提交后**清空输入框、界面留着**（源码注释原话："使速记作为常驻速记本存在"）⇒ **可连续提交**；内容**原子写成一个 .md 文件**（`<externalFilesDir>/home/.config/siyuan/shortcuts/shorthands/<ts>.md`，`.tmp`→rename）。
  · **数据不依赖 App 是否运行**：内核 `model/shortcuts.go` 的 `consumeShorthands()` 由 `AutoConsumeShorthandsJob` **每 3 秒**（仅 mobile 容器，`job/cron.go:54`）捞该目录建/追加文档；启动同步成功后也会消费一次。
  · **语雀 = 打开整个 App、留在小记页（有列表、能看到已有小记）**；**我们走语雀的路**（长按 `lakenotes://quick-note` → 拉起 MainActivity → 小记 tab + 写作浮层）。
    ⇒ 上一轮"提交后留在原地、退出交给系统"的定稿**在这条路下正确**；**思源的"手动退出"不能直接类比**（它退的是独立模块，我们退的是整个 App）—— 我上轮把两者并列叙述**不严谨**，此处更正。
  ⇒ **不学思源那条路**（独立原生 Activity + 极简视图 + 文件桥 + 内核侧消费）：我们的 lakex 跑在 WebView 里，没有"原生 Activity 直接写文件给内核捞"的结构，要走等于另立一条产品线；
    若将来"零冷启动成本的速度记录"成为明确诉求，再单独立项（当前不做）。
- **方案 D 定稿并交付（用户 261013 第七轮）：把快速小记做成"假单独模块"**（模仿思源闪念速记，但**不做**独立原生 Activity —— 成本/收益账见上一条）：
  · **三个决策点（用户拍板）**：① 手动退出后 = **直接退 App 回桌面**（只对快捷入口会话；首页底栏「新建小记」不受影响）；② 「取消」= **丢弃当前草稿并退出**；③ 不同步的抑制范围 = **会话级**（这次从快捷入口进来，整次会话不主动同步；副作用：这次会话里若还编辑了文档，那部分也要等下次普通启动才对上云 —— 本地是真相，不丢）。
  · **实现**：`MobileApp` 的 capture 分支 —— 保存后不再关界面，而是 `setCaptureNonce(n+1)` **重挂一条新的空小记**（草稿在提交时已清）⇒ 可连续记；新增 `closeCapture()` 统一"手动退出"（系统返回键 + 「取消」都走它）：关界面 → 快捷入口会话 `exitApp()`，否则刷新列表；
    `useAutoSync` 新增 `isCaptureSession()`（复用 `whenQuickNoteLaunchResolved()`，判定一次）⇒ **入口 / 回前台 / 进后台三处全跳**，只有「保存并同步」走高优先域单条推送。
  · **护栏**：`quickNoteCapturePath.test.ts` 在原 261010 四条之上新增三条（提交后重挂而不是关闭 / 手动退出统一走 `closeCapture` 且快捷入口会话退 App / capture 会话两处都过判定）；261010 那四条（共用 composer、独立入口在启动门之前、draft、seed）**全部保持**。
  · **证据等级（如实）**：UX 流程在**专用实例**上做过设备级核对（冷启动走 lakenotes://quick-note → 点进编辑器 → 真实输入 → 点「保存」⇒ **小记 +1 且写作界面仍在**；返回键 ⇒ **topResumedActivity = 桌面**）；
    **"确实没出网"只有静态护栏 + 代码路径**（门禁实例不配 S3，无法观测真网络；要看真网络得在配了 S3 的机器上试）。
  · **设备核对暴露的一处体验缺口（待用户定）**：每条提交后编辑器是**重挂的新实例、焦点丢失** ⇒ 连续记要再点一下才继续输入（思源是同一个输入框所以不需要）。可补"提交后自动聚焦"（内核有 focus 命令；编辑器 API 现只有 getBody/getText，要加一个暴露）。
  · **自动聚焦已补（用户 261013 第八轮点单）**：编辑器 API 暴露 `focus()`（内核官方命令 focus），写作卡在**创建时**（editNote 为空）
    就绪后**立即 + 150ms 各聚焦一次**（内核"要等一拍"口径）⇒ **快捷 capture 与页面「新建小记」两条路共用同一实现**；提交后重挂的下一条也自动续上焦点。
    护栏：`quickNoteCapturePath.test.ts` 新增一条（API 暴露 focus / 写作卡自动聚焦 / 补一拍 / 编辑已有小记不抢焦点）。
  · **最终设备门禁（261013 收尾，专用实例 5 文档夹具）**：`check:mobilesnap` **6 态 0 差异**（含原生键盘改造后两轮复跑）· 22 屏走查 **22/22 ok · 四类探针全 0** · 快捷 capture 键盘 **842→530** ✓。
    装置口径两处更新：① 夹具从 3 篇文档补到 **5 篇**（走查要 doc-0..doc-4 五行，3 篇时 doc-3/doc-4 会 ERR）；② README 记「走查必须单独冷启动跑」（紧跟快照门禁之后跑会 22/22 ERR，因为 App 停在设置子页）。
  · **设备实测（专用实例）**：页面路 **焦点+键盘都 OK**（innerHeight 842→530）；**快捷冷启动深链路 = 焦点 OK、键盘不弹**（842→842）——
    Android 只允许**用户手势**触发软键盘，深链冷启动没有手势（思源的闪念速记是原生 EditText 所以没这个问题）。
    ⇒ **待用户定**：要不要加一个原生插件方法（InputMethodManager.showSoftInput）来在 capture 打开时主动弹键盘（约 15 行 Kotlin + 插件注册 + TS 封装；**不动版式**）。
  · **快捷 capture 自动弹键盘（原生补齐，用户 261013 第九轮定）**：WebView 里程序化 focus 不弹软键盘（冷启动无用户手势，AGENTS §7.28）⇒ 新增原生插件 `ShowKeyboardPlugin`（InputMethodManager.showSoftInput）
    + `src/mobile/native/nativeKeyboard.ts`；写作卡加 `raiseKeyboard`（**只 capture / 系统分享传**，页面路有手势不传），聚焦后 300ms 请原生弹一次。
    **设备复核**：普通启动首页无键盘 **842** vs 快捷 capture **530**（键盘已弹 + 焦点在内核编辑器）。护栏：capture 传参 / 写作卡调用 / MainActivity 注册插件（漏注册时 JS 只会 reject）。
  · **版式差距（用户 261013 提供思源录屏，已逐帧核对）**：思源闪念速记 = **一行标题（左「闪念速记」+ 未固定时「添加到桌面」）+ 右上蓝色主按钮「提交」+ 全屏纯文本输入**，键盘占下半屏；
    我们 = 顶部内核工具条（九项）+ 底部三连按钮。**建议只对齐版式（加顶部栏），输入区仍用内核富文本**（退成纯文本=方案 B，实测不更快且要重做九项能力）。
- **未做（明确不做，别再提）**：**「关掉 App 也保证 N 分钟内同步」** —— 同步引擎在 WebView JS 里（依赖 Capacitor SQLite/文件系统与完整应用上下文），App 被杀后没有运行时可言；要做只有把同步引擎**下沉原生层**（= 第二套实现）或 headless runner，属独立立项；**桌面端同样没有后台常驻**（关窗口不退进程时定时器还在，真退出就停）。
- **验证**：`tsc` ✓ · `vitest` ✓ · `check:core` ✓ · `check:mobileui` ✓ · `check:bundle` ✓ · `git diff --check` clean（计数见当轮输出）。
- **设备级重建 + 设备级验收（用户 261013 第三轮要求"看看效果"，全部已做）**：
  · 模拟器：`emu-up.sh --no-window` → **emulator-5554**（AVD `lake_mobile`）；装完按 §8 重跑 `emu-cdp.sh`（socket 名带新 PID）。
  · 安卓包：`android-build.sh --sync --install` → **APK 39,058,148 B / 10:10、`adb install` 输出 `Success`、已 `Starting`**（按 §7 的"静默失败"教训核对了时间戳与 Success，不只看"命令跑完"）。
  · `check:mobilesnap`：**6 态 0 差异**（写作卡不在这 6 态里，**基线未动**）。
  · 22 屏设备走查：**22/22 ok**，四类真探针 **escape / clipped / contrast / smallTap 全 0**（`fixedBars` 是**清单型**探针 —— 记录固定定位元素，不是违规；本轮 50 条 = 顶栏/胶囊底栏/dock 等）。
  · 实机截图确认移动写作卡动作行 = **[取消][保存并同步][保存]**（主按钮仍是实心「保存」），三按钮未溢出、命中区达标（smallTap 0）。
  · ⚠️ **模拟器必须带窗口**：本批第一次用了 `emu-up.sh --no-window`（无界面，用户看不到）⇒ 已 `adb emu kill` 后用 `emu-up.sh`（**不带** `--no-window`）重启，进程确认无 `-no-window`，App 已启动。以后给用户"看效果"一律带窗口。
  · 桌面 `dist/` 已重建（`npm run build:web`），dev/打包产物都能看到新按钮。
- **"没做的"这三条的处理（用户 261013 第四轮点单）**：
  · **① 桌面 `check:stylesnap`：先修了装置的真 bug，但本轮仍不可判定**。装置缺陷：261012 的 `snapExpr(kernelIdMinLen)` 重构把表达式改名成 `SNAP_EXPR`，**漏改调用点** ⇒ `stylesnap.mjs:339` 仍在读已不存在的 `SNAP`，**自那次起桌面快照装置一跑就 `ReferenceError`**（已修：`SNAP` → `SNAP_EXPR`）。
    修好后用**隔离实例**（`LAKE_RENDERER=scheme` + `$TMPDIR/lake-snap` + CDP 9231）跑出 **34/42 态差异**，但**差异形态是"每个态都少约 150 个元素"** ⇒ **是数据不同构（我用的是全新空库，基线那份带夹具），不是本次 UI 改动**。⇒ **判不了，也不该据此重烤基线**（重烤会把数据差异烤进基线）。
    要跑通必须先按 `scripts/css-audit/README.md` 造/复用与基线同构的夹具；跑完实例已按 CDP 端口精确 kill（0 残留）。
  · **② 并发防覆盖护栏：已补**（core 属性级，`quickNotePush.test.ts` 第 8 例）：复现"整轮同步拿推送前的旧快照落地 ⇒ 把我们刚写的条目覆盖掉"，再跑一次推送（= 回核）断言**条目补回来**且其他条目**逐字节不变**。**仍缺**端到端的真并发实测（真实整轮同步在途时点按钮）——列为真机/后批次项。
  · **③ "回核只在维护在途时才排"：评估后不做**（据实说明）：门控只能看"推送那一刻队列是否忙"，而**漏掉的恰是最该兜的那一瞬** —— 推送正在进行、整轮同步紧接着启动（它读清单发生在我们 PUT 之前）⇒ 覆盖后没人修。一次清单 GET（几十~几百 ms、后台）换确定性，值。若哪天嫌它费流量，正确做法是给清单加 CAS 或让整轮同步"落地前重读本地条目"，不是收紧这个门控。
  · **④ 真机复验：无设备**（`adb devices` 只有 emulator-5554）⇒ 仍待真机（与 §8「当前剩余验收」合并）。
- **待办（本批之后）**：① 桌面 stylesnap 夹具化后重跑（见上）；② 端到端并发实测（整轮同步在途时点「保存并同步」）；③ 真机复验；④ 见上（①讨论项）"快捷入口冷启动是否跳过自动整轮同步" —— **待用户定**。

### 261013 · 桌面+移动端批：自动同步补「开/关应用各一次」（含 interval 档）+ 文案说明

- **用户 261013 定稿**：「如果选择了固定时间同步，也要在开启和关闭的时候同步一下子数据」⇒ 口径 = **只要云同步开着（`autoMode ≠ "manual"`），打开与关闭应用都各同步一次**；两端同一语义，且设置页文案要写明。
- **裁定的一处边界（用户 261013 选「不要」）**：**「完全手动」不补** —— 保持真正不出网（只有手动同步 / 恢复补拉才联网）。故「完全手动」维持现名与现义，未改。
- **改动前现状（真差距）**：`interval` 档**只起定时器**、开/关应用都不补 —— 桌面 `electron/main.ts` 的就绪块与 `before-quit` 都写死 `autoMode === "onOpenClose"`；移动端 `useAutoSync` 的前台处理器走 `shouldSyncOnForeground`，也只在 `onOpenClose` 档成立。
- **落点（判据单一来源 + 两端执行）**：
  · `src/core/syncModes.ts`：`shouldSyncOnForeground` → **`shouldSyncOnOpenClose`**，判据改为 `enabled && autoMode !== "manual"`；新增**共用文案** `SYNC_OPEN_CLOSE_NOTE`（与 `cloudState.ts` 的 `CLOUD_PRIVACY_NOTICE` 同一做法：文案存 core、无 UI 依赖）；文件头补 261013 语义表。
  · 桌面 `electron/main.ts`：应用就绪块与 `before-quit` 两处都改走 `shouldSyncOnOpenClose`。**两条判据各守一段**：能不能出网 = `canTouchNetwork(cloudStateOf(...))`，该不该在开/关补一次 = `shouldSyncOnOpenClose(...)`。退出前同步仍有 `QUIT_SYNC_DEADLINE_MS = 60s` 兜底，不会挂死退出。
  · 移动端 `src/mobile/hooks/useAutoSync.ts`：只换判据函数 ⇒ interval 档也走「冷启动就绪 + 回到前台」各一次。**移动端没有 before-quit**（Android 可能直接杀进程）⇒ 不假装能"关闭时同步"，在文案里如实说明以「回到前台」代替。
  · 文案：桌面 `SettingsPanel` 的「自动同步模式」行加 `desc={SYNC_OPEN_CLOSE_NOTE}`；移动 `SettingsDrawer` 同一行用共用文案 + 一句移动端等价口径。
- **护栏**：`src/core/syncModes.test.ts` 改为断言「interval / onOpenClose 都补、manual 与关开关都不补」+ 共用文案含三档语义（旧断言 `interval → false` 正是旧口径，已按新语义翻转）。
- **未做 / 边界**：① 这里的「开启/关闭」= **应用**开/关（沿用 `onOpenClose` 档的既有含义），**不是**拨「启用云同步」开关时立刻同步（开关行文案仍写"重新开启后下次同步会自动补拉"）；② 移动端冷启动那次仍固定等 3s 再判（等桥/引擎就绪），时机未改；③ 桌面 dist/ 未重建（代码批次待用户验收后再构建）。
- **验证**：`tsc` ✓ · `vitest` ✓（计数见本批运行时输出）；两端设置页文案共用同一常量（grep `SYNC_OPEN_CLOSE_NOTE` 可核）。

### 261012 · 桌面批：分屏体验修复（宽度重夹 / 浮条遮挡 / 合并标签状态）+ 三路调研（本批）

- **触发**：用户「优化分屏体验；分屏当初没立项，现在有点粗糙」。三路调研（Edge 一手实测 / 本仓库静态审计 / 同类产品+架构选项）产物在 `.css-audit/split-research/`（gitignore，**不入库**）。
- **架构结论（回答「要不要引技术架构/依赖」）**：**不需要新依赖、不需要组模型**。现有「全部标签宿主常驻挂载 + `.tab-panels` 两列 grid + `tabs.css` 唯一隐藏规则」已能承载两栏；**内核实例在打开标签时就已经创建**（`EditorTab` 大 effect 不含 `visible`）⇒ 分屏只是让第二个实例同时可见，不新增实例。**否决**：① 布局树/组模型 = 要引入 Group 实体 + tab 身份 `noteId→tabId` + 宿主跨组移动（= React 卸载重建内核，丢滚动/撤销/IME），参照量级是思源 `app/src/layout/` 一整个目录；② 第三方布局库（react-resizable-panels / allotment / flexlayout-react / golden-layout）自带 unlayered CSS 或不可覆盖的 inline style，撞 `@layer` 层序与「分隔条唯一实现 `SplitHandle`」，而它的增量能力（多栏/嵌套）恰是无证据需要的部分。
- **本轮修掉 5 项（每条都有修复前实测）**：
  1. **D1/D2 容器变窄后宽度不重夹（真缺陷）**：旧实现把左栏拖到 776px 后缩窗到 760 ⇒ 两列实测 **760px / 0px**（右栏内容消失、分隔条被 `.tab-panels` 的 `overflow:hidden` 裁掉、鼠标拖不回来，唯一恢复 = 退出再进分屏）。新增纯函数 `src/features/editor/splitGeometry.ts` 的 `clampSplitLeft()`（+ `splitGeometry.test.ts` 6 例），`MultiTabEditor` 用 ResizeObserver 量 `.tab-panels` 后重夹 ⇒ 实测 760 宽两列 **480 / 280**（右栏保住 `minRight`），再放宽**恢复用户原宽度 776**（期望值与显示值分离）。
  2. **D3 分屏浮动工具条盖住焦点栏工具条按钮（真缺陷）**：`splitView.css` 顶边只加 `--editor-toolbar-height`、漏了宿主内的**面包屑** ⇒ 浮条落进工具条带，实测盖住右栏工具条最后一枚按钮（交集 20×18px）。改为 `calc(--breadcrumb-height + --editor-toolbar-height + --lake-space-md)`（与 PANEL-CONTRACT §1 垂直几何同源）⇒ 1280/1315 遮挡 **0**；280px 极窄栏下只剩 0 面积边界接触（诚实记录，未再优化）。
  3. **D7 进分屏时顶栏「更多」菜单失锚**：分屏会隐藏两栏面包屑右端的「更多」触发钮 ⇒ 锚点元素被卸载、浮层停在旧坐标。`App.enterSplit` 里补 `closeMenus()`。
  4. **D4 合并标签丢状态**：合并标签两半此前不显示 pin / 「已删除」徽标 ⇒ 组成员被软删时右栏**静默只读**。按独立标签同一套类补 `Pin` + `.tab-deleted-badge`，并给合并标签补 `aria-label`。
  5. **D6 死 CSS**：`.tab-item.in-split` 恒不渲染（组员各自的 `<button>` 不进 DOM）⇒ 删 `splitView.css` 那条规则与 JSX 拼接；顺带让分隔条在**未拖过**时也有 `aria-valuenow`（传生效宽度）。
- **门禁**：`tsc` ✓ · `vitest` **236 文件 / 1840 用例** ✓（含本批新增 `splitGeometry`/`tabOrder` 与扩展后的 `splitView` 护栏）· `ui-metrics` ✓（颜色字面量 0 · `!important` 9 · 桌面字号字面量 0）· `check:bundle` ✓ · 桌面走查 light-1315 + dark-1000（本批产物在 `.css-audit/walkthrough/`）。
- **用户点单续做（同日第二轮，已交付）——只做了「分屏后标签仍可拖拽排序」这一项**。
  用户 261012 追加裁定：**合并标签右键菜单**与**标签右键「在右侧分屏打开」都不做**（"Edge 都没有，撤销了，删除彻底"）
  ⇒ 已写的那部分**彻底回滚**（组件/state/props/透传/护栏断言全删；仓库 grep `SplitGroupContextMenu|onSplitRight|在右侧分屏打开|canSplit` = 0）。
  - **① 拖拽排序（真 bug）**：旧实现 `beginTabDrag` 一见 `splitPair` 就早退 ⇒ 分屏后完全拖不动；且合并标签**只占一个槽位**（两页只渲染一个按钮），直接拿 DOM 槽位顺序回写会**丢掉组内另一页**。修法：新增纯函数 `src/features/editor/tabOrder.ts`（`moveSlot` + `expandTabSlots`，+ `tabOrder.test.ts` 8 例）——先在**槽位**上算移动，再把槽位展开成真实顺序，**组内两页整块落回同一槽位**（保持组内次序）；合并标签补 `data-note-id` + 指针事件。**实机实测**（4 标签，组 = 富文本+多维表）：拖前 `[组, 第二篇, 表格] / 模型 [富文本, 第二篇, 表格, 多维表]` → 拖到最右后 `[第二篇, 表格, 组] / 模型 [第二篇, 表格, 富文本, 多维表]` ⇒ **4 页都在、组仍相邻**。
  - **补一项（用户 261012 当天第三点单）**：**合并标签两半各自带上自己文档的图标** —— 此前只左半有 tab-custom-icon、右半只有分屏标记 ▯ ⇒ 右栏文档带 emoji 图标时丢图标。改法：右半补与左半/独立标签**同一份** icon 渲染；护栏 splitView.test.ts 加两行断言。**实机复验**（两篇夹具分别设 🤡/😠）：合并标签 = 「😠 合成·第二篇 ⎸ ▯🤡 合成·富文本 ×」，两半图标齐全（分屏标记 ▯ 仍在右半首位，未动位置）。
- **未做（用户 261012 明确不做）**：分屏宽度/分屏对持久化 · 合并标签右键菜单 · 标签右键「在右侧分屏打开」与分屏快捷键 · 同文档分屏 · 多栏/上下分屏（逐条代价见 §3#21）。**以上都不要再提**（用户已裁定，理由是 Edge 也没有这些形态）。

### 261012 · 移动端 UI 独立化 P0–P7 全量交付 + 收尾 review（本批收尾；已推送 origin/master）

- **总览**：本轮把「移动端要有自己的设计语言、只与桌面共享必要逻辑」从口径落成了可执行、可验收的工程状态。
  **成果三件套**：移动端入口的桌面样式 import = **0**（只余字体资源）· 移动端 JSX 的桌面类名 token = **0**（不允许回涨）
  · 桌面为移动端开的分支（`mobile-app`）= **0**。规格见 `docs/MOBILE-DESIGN.md`（定稿）；门禁 `npm run check:mobileui`。
- **交付脉络（每阶段都有设备证据）**：P0 护栏 → P1 令牌/皮肤（视觉中性 0 差异）→ P2 `mb-*` 原语 + 首批迁移
  → P3 浮层原语（Sheet/ActionSheet/Toast/菜单 Sheet；不建居中对话框）→ P4 设置页样板屏（桌面类名 109→0）
  → P5 摘 4 个桌面样式表 + 删 mobile-kit.css + 反向耦合归零 → P6 六组件变体化（含 Lightbox/附件预览/小记/宿主类）
  → P7 门禁 + MOBILE-DESIGN.md 定稿 + IA 冻结清单逐条核对。
- **收尾 review 又补掉 4 项（本轮）**：① 死 CSS 清理（旧 `mobile-sheet/toast/dialog/menu`、`.ln-*` 残留、
  `.lv1-3` 等：**删 29 条规则 + 38 个分组内死成员 + 1 个空 @media**，mobile.css 1349→1266、floating 256→255；
  删后设备快照 **0 差异** + 走查 22/22 = 反证无人施加）；② 小记预览的 `.ln-ellipsis` 桥接改为**组件变体**
  （`QuickNotePreview` 新增 `ellipsisClassName`，移动端传 `mb-ellipsis`）⇒ 移动端 CSS 里再无 `ln-*`；
  ③ 「关于」页协议版本 V4→V1 并改为从 `MANIFEST_VERSION` 派生 + 取值护栏；④ 「用户可见版本号字面量」全仓扫描护栏。
- **本轮追加的用户点单**：设置选择器改底部 Sheet（`PickerSheet`，去掉原生 `<select>` 系统弹层）·
  同步策略补齐（自动同步模式 + 间隔：选项/判据上收 `src/core/syncModes.ts`，桌面同源；移动端
  `useAutoSync` 真正执行 interval/onOpenClose，写策略走单一入口 `syncSettingsStore`）。
- **验证基线**：`tsc` ✓ · `vitest` **234 文件 / 1822 用例** ✓ · `check:core` 77-0 ✓ · `check:mobileui` ✓ ·
  `check:bundle` ✓ · 设备 `check:mobilesnap` **6 态 0 差异** · 设备走查 **22/22 屏 ok** · `git diff --check` clean。
- **过程中修掉的装置/自身缺陷（值得记）**：mobilesnap 基线是空库态（重烤）· 内核 `u<hex>` id 让快照每轮换 key
  · 首页态冷/暖取样差 29 元素（基线必须 `--from` 暖态写）· 走查选择器在类名改名后失配 ·
  **CSS 注释里写了星号+斜杠导致移动端构建静默失败**（`| tail` 吞退出码 ⇒ 那几轮设备验证打在旧包上，已重跑更正）。
- **仍需后续（按 §3 登记）**：① 待办 #20 桌面端摆脱 `b3-*`/`fn__*` 类名契约（含 AGPL 署名红线，**不动署名**）；
  ② `components/model/treeDrag` 仍是移动端唯一冻结的共享「逻辑+DOM」件；③ Lightbox / 附件预览缺设备级探针
  （22 屏走查不打开这两个浮层，目前是"按规则搬迁 + 触屏几何"级证据）。

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
- **P7d 终验 + IA 冻结清单逐条核对（已完成，本批收尾）**：
  **门禁全绿**：tsc ✓ · vitest **231 文件 / 1816 用例** ✓ · `npm run check:mobileui` ✓（独立性 + 层 + 内核样式 + ui-metrics）
  · `check:bundle` ✓（app-css 1.79MB / 2MB、drawnix 725KB / 1.4MB）· 设备级 `check:mobilesnap` **6 态 0 差异** ·
  设备走查 **22/22 屏 ok**。
  **IA 冻结清单逐条**（判据 = 存在性与从属关系不变；证据 = 22 屏设备走查 + 1 次定点探针）：
  ① 首页两 tab —— home-library / home-quicknotes / home-library-shelf ✓
  ② 知识库：笔记本列表 → 文档树抽屉 + 文档区 —— notebook-workspace ✓
  ③ 文档区：顶栏 + 正文 + dock + 抽屉 —— doc-0..4 / quicknote-editor（顶栏与 dock）/ doc-outline（大纲）/ doc-note-info（属性）/ doc-history ✓
  ④ 小记：时间线 + 写作卡九项工具条 —— home-quicknotes / quicknote-editor ✓
  ⑤ 设置：抽屉九页 —— settings + settings-{编辑器,外观,历史,资源管理,同步设置,清理缓存,回收站,关于} ✓
  ⑥ 回收站 / 历史版本 / 文档属性（抽屉形态）—— settings-回收站 / doc-history / doc-note-info ✓
  ⑦ 搜索 —— 定点探针：点首页底栏「搜索」⇒ `.mb-sheet` 打开、标题「搜索」、输入框在、`.mb-scrim` 在 ✓
  **结论：移动端 UI 独立化 P0–P7 全部交付并验证**（移动端桌面样式 import = 仅字体资源；桌面类名 token = 0；反向耦合 = 0）。
- **⚠️ 261012 收尾自查：移动端构建曾静默失败（已修；含一处验证口径更正）**：
  **真因** = P6a 新增的 `src/mobile/features.css` 头注释里写了星号加斜杠的路径通配（`**` + `/*.css`）⇒ **注释提前闭合**、
  lightningcss 报 `Invalid dangling combinator` ⇒ `vite build -c vite.mobile.config.ts` **在写盘前中止**
  （表现：日志像正常、`dist-mobile/` 只剩 `vendor/`）；而 `android-build.sh` 在调用处接了 `| tail`，**退出码被吞**，
  于是后续几次 `--install` 实际**没换包**（APK 一直停在 16:16）。
  **影响与更正**：P6a / P6b / 思源痕迹清理那几轮报的「设备快照 0 差异 + 22 屏 ok」是**打在上一版包（16:16 = P5 时期）**上的，
  不足以证明当轮改动。修复后已**重装真包重跑**：APK 时间 16:59、install 明确 `Success`/`Starting`，
  `check:mobilesnap` **6 态 0 差异**（基线未动）+ 走查 **22/22 ok** ⇒ P6 各项的"视觉中性"这回是真的。
  **顺带加固**：`vite.mobile.config.ts` 收尾插件由 `closeBundle` 改挂 `writeBundle`（+enforce post，保证在产物落盘后复制；
  注释里写明它**不是**本次根因）。
  **教训**：① CSS 注释里不要出现星号 + 斜杠组合；② 构建脚本外面套 `| tail` 会吞退出码 —— 换包后必须核对
  **APK 时间戳**或 install 的 `Success`，不能只看"命令跑完了"。
- **登记为本批之后的小额遗留（不影响 P0–P7 结论，按 §3 续做）**：① 死 CSS 清理（旧 `mobile-sheet*/toast*/dialog*/menu*`
  与部分 `mobile-settings-*` 已无 JSX 施加 ⇒ 交 `scripts/css-audit/audit-dead-css.mjs` 扫 + 删后对拍探针 0 差异）；
  ② `components/model/treeDrag` 仍是移动端唯一冻结的共享「逻辑+DOM」件（要按「逻辑上收 + 移动端自有 DOM」改造，护栏允许清单里只剩它一条）；
  ③ 小记预览的 `.ln-ellipsis` 桥接（组件改发 `.mb-ellipsis` 后可删）；④ Lightbox / 附件预览缺设备级探针（走查不打开这两个浮层）。
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
  · 两条队列 `src/mobile/sync/maintenanceLocks.ts`（写域 / 维护域），`bridge.ts` 改 `runWrite(op,…)` / `runMaintenance(op,…)`（**带类别校验**，写错当场抛）；
  · 同步侧「DB 片段短锁」`syncDbPort` 的 `withWriteLock`（一次端口调用进出各一次，**网络往返不持写域**）；
  · `restoreTreeItem` 恢复不再等网络（原本被全局队列串在同步后面）。
- **I2 守卫补齐**（拆域的前置条件，否则丢编辑）：引擎优先用 `markSyncedIfUnchanged`（小记新增实现，移动端；对齐 Lake 侧 V5 §5.2）；
  下载侧 `flushNoteBatch` 批窗口守卫（批窗口跨网络取内容 ⇒ 窗口内被本机改过的笔记**推迟远端应用**，留给下一轮走正常冲突流程）。
- **单一来源收口**：移动 CSP 唯一来源 = `vite.mobile.config.ts`（`mobile.html` 只留 `%MOBILE_CSP%`，此前两份不一致）；
  `window.lakeNative` 改为**从实现派生**（`lakeNativeContract.ts`：49 = 47 bridge + 2 附带；此前手写 49 个包装、无护栏）；
  `ports.ts` 6 处悬空《移动端方案 §x》引用清除；`bridge.ts` 头注释 "POC / manifest v4" 改成事实（Manifest **V1**）；`POCNote*` → `LocalNote*`。
- **新增 7 道护栏**：`core/maintenancePolicy.test.ts` · `mobile/maintenancePolicyCoverage.test.ts`（含 **I3 同域嵌套静态卡死**）·
  `mobile/sync/maintenanceLocks.test.ts`（**F16 机制回归，CI 可跑不必上模拟器**）· `mobile/data/syncDbPortBatchGuard.test.ts` ·
  `mobile/mobileCspSingleSource.test.ts` · `mobile/native/lakeNativeContract.test.ts` · `electron/maintenanceQueueScope.test.ts`（桌面反向护栏）。
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
  ③ **跨端污染**：移动端借桌面 `components/app/NoteInfoDialog` → `HistorySnapshotPreview` → 懒加载**桌面** `UniverSheetEditor`/`BitableEditor`/`BoardEditor` ⇒ 桌面编辑器被打进移动端包、且移动端打开表格历史快照会挂**桌面**编辑器 → 新增 `src/mobile/ui/NoteInfoSheet.tsx`（移动端自有「文档属性」抽屉）替代；桌面 `NoteInfoDialog` 未动；`HistorySnapshotPreview` 另加移动端提示护栏（纵深防御）；护栏见 `mobileLazyChunks.test.ts`。
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

> **261016 代码 review 的待办**见 `docs/CODE-REVIEW-261015.md` **§11 交接清单**：**全部结案（261017）**——C3-2 / C3-5 / C1-6 / C4-1 / C5-4 / Q3 / C1-5 均完成；D2 定稿不做（移动端只支持虚拟托管）、D5 真云验证后已修；无待决策项（D3/D7 仅记录）。
> **261017 复核补充的 3 项低优先遗留**（详见 review §11.7）：① **C4-1** 两处 `!important`「验证后删」已被 Q2 允许清单收编 ⇒ 是否还要验证删除待裁；② **C5-4** 同名令牌取值差异表未建（自动生成即可）；③ **桌面 `stylesnap` 基线**已按 261017 全量重烤（旧基线在 261014 后未更新且实测不可复现，见 §0）。

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
     旧实现（`src/mobile/native/secretStore.ts`）把密文放 IndexedDB ⇒ 重启后 `getS3Settings().secretAccessKey` 长度 0，
     所有 S3 操作报 `The request signature we calculated does not match the signature you provided`。
   - **修法（保留原设计的降级语义，只换持久层）**：密文改存 **localStorage**（键 `lake-notes-mobile.secret.*`，仍是 WebCrypto AES-GCM 密文、**不是明文**）；
     并在 `read` 时**一次性兼容迁移**旧 IDB 值（读到就搬进 localStorage 并清旧条目）。
   - **顺带治理报错**：`bridge.ts` 在建 S3 客户端处加 `assertS3Credentials()`（单一来源，同步/测连通/上传三条路径共用）：
     密钥缺失时给「请到「设置 → 同步设置」重新填写 Access Key / Secret Key」，不再让请求去报签名错。
   - **护栏**：新增 `src/mobile/native/secretStore.test.ts`（4 例：往返、**落盘是密文**、**模拟重启仍可读**、缺失/删除返回 null）；
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

11. ~~**多维表Grid行窗口接入（5000×20）**~~ **已完成主树整合（261014用户确认亚秒即可接受）**：主Grid/关联选择器共用窗口，首开0.31–0.38s/重开0.17–0.22s；全库1945例与23包检查通过、正常关表回收。契约`docs/BITABLE-VIEWPORT.md`，最新§0与`.css-audit/bitable-integration-261014/RESULTS.md`为当前状态。**发布前待补**：低内存/长时/真实大图高扇出关联/完整发布矩阵；精细毫秒级尾延迟继续观察，不为33/50ms参考目标重新阻止接入。旧AR04的12.4–24.8s/百万格全量DOM数据只是历史，不再描述当前实现。

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
20. **桌面端彻底摆脱思源类名契约（用户 261012 登记为待办；移动端已完成，桌面未做）**：
    - **背景**：用户核对「不是已经没有思源的事了吗」。核查结论（261012，已有实测）：**运行期零思源代码/资源**
      （`src/b3/**` 已整体删除、无任何 import 指向 `siyuan-master`）；移动端 P5 起连桌面的 `compat.css` 也不引，
      移动端里 `--b3-*` 定义与 `.b3-*`/`fn__*` 类名均为 **0**（P7b 顺带删掉了移动端 theme 里那 44 条已无人消费的
      `--b3-*` 过渡桥接，删后设备快照 6 态 0 差异 = 反证无人消费）。
    - **桌面还剩什么**：桌面 JSX 仍把 `.b3-*` / `fn__*` 当**类名契约**在用（历史快照行、设置页骨架、菜单/列表等），
      承重规则收编在 `src/styles/compat.css`（279 行，含从原 `b3/siyuan.scss` **复刻**的段落）；另有
      `features/outline/ExpandLevelIcon.tsx` 的图标路径取自 siyuan `icon.js`。
    - **要做的事（桌面批次，工作量不小）**：① 把桌面 JSX 的 `b3-*`/`fn__*` 换成自有命名（`ln-*` 或新前缀）；
      ② 把 `compat.css` 的承重规则迁进对应层/原语（单一来源）；③ 逐屏走查对拍（桌面 stylesnap 基线只许降）+
      `ui-metrics`/`cssLayers` 基线同步；④ **许可**：只要仍有从思源移植的规则/图标（AGPL-3.0），
      README 要求的 NOTICE / 「关于页」署名就**必须保留**——这与"改名"是两件事，不能顺手删（合规红线）。
    - **判据**：做完后全仓 `grep -rn "b3-\|fn__"` 只剩「许可署名 + 历史说明」两类注释，代码与选择器为 0。
    - **登记出处**：`AGENTS.md §3#14`「思源层已整体移除（`src/b3/**` 已删除；仅类名作为 JSX 契约保留）」——
      本条即是把"仅类名保留"这一步也做完。
21. **分屏（261012 三路调研后的候选清单；本轮只做了缺陷修复，下列等用户定）**：调研产物 `.css-audit/split-research/{edge-split,code-audit,peers-arch}.md`（gitignore，**不入库**；要复现就重跑探针脚本，脚本也在同目录）。逐条「不做会付什么代价」见 peers-arch §5。
    - **Edge 一手实测（261012，Edge 155.0.4283.45）**：Edge 的「拆分视图」**不是合并标签** —— 当前标签变左半（标题加「- 左视图」）、并**新增**一个右半标签（`edge://newtab`，后缀「- 右视图」，各占约半宽、**两者同时 selected**），原标签不被吞并；**同窗口可并存多组**拆分对（实测 2 组）；关闭任一侧 ⇒ 分屏**自动解散**、另一侧回落全宽；切到别的标签**不销毁**（重新选中即恢复）；分隔条可拖、最小 **~141px**、**双击复位 50/50**、Esc 无效；入口 = 菜单「标签页 → 将选项卡添加到新的拆分视图」= **⌥⌘N**（窗口 ≥2 标签才可用；工具栏按钮/右键链接/垂直分屏/持久化均**未验证**）。⇒ 我们的「一个合并标签」是**对 Edge 的简化**（261008 用户定稿），不是照抄；要不要改成「两个半宽标签」属产品决策。
    - **候选状态（261012 用户裁定 + 261014 修订，别再重提）**：① 分屏宽度持久化 ❌ 不做；② 分屏对跨重启恢复 ❌ 不做；③ **合并标签右键菜单 —— 261014 用户点单恢复**：只放**分屏专属两项**（取消分屏 / 左右互换），**不混入单页的关闭/钉住语义**（实现 = `TabContextMenu` 的 `split` 模式；当年是"整套单页菜单"被回滚，这次是分屏专属菜单）；④ 入口补齐（标签右键「在右侧分屏打开」/ 快捷键）❌ **不做**（同上，已回滚）；⑤ 同文档分屏 ❌ 不做（要动 tab 身份模型）；⑥ 多栏/上下/嵌套 ❌ 不做（无证据；第三方布局库亦已否决）。**其余理由（用户原话）：「Edge 都没有」**。
    - **分屏浮动工具条：261014 用户点单彻底删除**（组件 `SplitPaneControls` + `splitView.css` 5 条规则 + `PANEL-CONTRACT` 几何条目；
      分屏动作只剩「合并标签右键」与「标签上的 ×」）。**不要再加回浮动条。**
    - **分屏期间标签拖拽排序** ✅ **已修（261012，见 §0）**：旧实现分屏即禁用拖拽，且合并标签只占一个槽位会让「拿 DOM 顺序回写」丢页；现在走 `tabOrder.ts` 的「槽位 → 真实顺序」两步，组内两页整块移动。

22. ~~**正式包大目录切标签性能（261013）**~~ **最小优化已落地**（见最新§0）：App稳定保存失败回调 + Sidebar本行内容memo；真实默认GPU包同组209→74ms、跨笔记本231→75ms，结构/几何不变，17场景与6态样式门禁通过。递归仍遍历全树，进一步优化仅按新热点证据立项；**不做目录窗口化**，多维表5000×20按#11已正式接入主树。

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
- **主Grid与关联选择器已是行窗口（261014正式接入）**：完整模型不裁剪，挂载仅viewport+缓冲+1编辑pin；屏外复制/粘贴、统计、筛选/排序等按全投影处理，修改先读`docs/BITABLE-VIEWPORT.md`。旧260930 AR04全量DOM压测是历史性能对照，不再按“无虚拟化”定位当前瓶颈；非Grid视图不随本批重做。

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
# 门禁（合并前必过）—— 261013 实测总共 ≈21s（tsc 5s / vitest 8s / 两条构建各 3s / 其余 ≤1s）
npx tsc --noEmit && npx vitest run && npx vite build && npx vite build -c vite.mobile.config.ts
node scripts/ui-metrics.mjs && npm run check:core && npm run check:mobileui && npm run check:bundle && git diff --check
# 门禁分层（261013 定，避免"每次改动都跑很久"）：上面这 5 条 = 日常/每次改动，就是"门禁"的正式含义。
#   ② 动了 CSS/UI 要证"视觉中性"时：**只验改到的那 1~2 个态**（秒级，态自包含）——
#        node scripts/css-audit/drive.mjs 9231 scripts/css-audit/stylesnap.mjs after "resources:1315:light"
#        node scripts/css-audit/check-stylesnap.mjs --port 9231 --states "resources:1315:light"
#      完整 42 态（≈294s）只在换夹具 / 改装置 / 发版前跑；跑前先 npx vite build（scheme 模式服务 dist/）。
#   ③ 设备门禁（移动端 check:mobilesnap 6 态 / 走查 22 屏）只在改动涉及移动端时跑，且只跑专用 AVD lake_gate（5556 / CDP 9336）。
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
> ③ `window.lakeNative` **保留并改为从实现派生**（261020 起 52 = 50 bridge + 2 附带，护栏 `lakeNativeContract.test.ts`）。
> 移动端规格与硬约束现在只在 docs/MOBILE-TECH-STACK.md（含「每层用哪种复用方式」判据、互斥域、能力矩阵、未结项）。

### 261020(五) · 移动端表格 chrome 重做（**方案 A：底部 dock**）· 已过设备验收并**推送 master**

- **用户定稿**（两个原型里选 A）：不照抄语雀顶部条，改用我们文档端已磨合的编辑语言 —— 顶部只留 **21px 薄公式栏**，
  底部 **32px 页签/缩放栏 + 56px dock**，二级能力全部走**底部面板**。逐条：① 撤销/重做**留在主条**；
  ② 「常规」用**文字**回显当前数字格式；③ Aa 面板**只留文字样式**（字号 / B I U S + 清除格式 / 对齐 / 字色 / 底色）；
  ④ ＋ 插入面板**都做但只放支持的**（插入行/列、合并）；⑤ 阅读态**先保留一条 40px 轻工具条**（工作表 + 缩放）。
  **追加定稿（同日第二轮）**：⑥ **网格默认只在移动端生效**（B 方案，桌面保持原样，见下）；⑦ 二级面板要**向下占键盘区**展开、
  dock 停在面板上沿（与文档编辑一致，原先做成了 panel 压在 dock 上方）；⑧ Aa 面板**去掉「文字颜色 / 背景色」两行说明**；⑨ 撤销/重做**跟随撤销栈置灰**；⑩ Aa 面板**字号挪到最底**（逐行同序：行内标记 → 对齐 → 字色 → 底色 → 字号）；
  ⑪ **面板定高 = 捕获的键盘区高度**（内容多则内部滚、少则留白；`capturePanelHeight` 与文档 dock 同一份算术），
  实测键盘 312 ⇒ 面板 top 530 / h 312；⑫ 展开的类别键（＋/Aa/常规/⋯）**变 ×** 且高亮，再点一次 = 关面板 + 放回键盘；
  点网格 / ⌨ = 只关面板、不拉键盘；⑬ **面板开/关必须走 facade**（`endEditingAsync(true)` / `startEditing()`）——
  只 blur 会让内核停在编辑态、移动 footer 变成「取消/确定/公式」，「开始编辑」按钮消失 ⇒ ⌨/× 再也弹不回键盘（设备实测）；
  两个符号已登记 `univerContract.test.ts` 的 facade 清单；
  ⑭ **收起过渡（closingHold）**：面板关闭先进 `closing`（期间不接点击），restore 档内容保持到键盘真的上来，
  键盘回 150ms / 迟迟不来 1800ms / 兜底 2500ms 再卸载；退场沿用 `renderedPanel` —— 与文档 dock 同口径（实测无空白帧）。
  规格与实测全量落在 **`docs/MOBILE-SHEET-PARITY.md` §14**（原研究文档升格为产品文档）。
- **落地（单一来源）**：`usheetChromeModel.ts`（清单唯一来源：dock 顺序/字号档/色板/插入·更多分组/数字格式）·
  `UsheetChrome.tsx`（公式栏 / dock / 面板 / 页签栏 / 阅读条，只渲染）· `usheet-chrome.css`（190 声明）·
  `MobileUsheetViewer.tsx`（动作入口走 Univer facade：底色/字色/字号/B I U S/对齐/合并/插入行列/冻结/行高列宽/数字格式/常用公式/缩放/工作表）。
  **面板原语不复制**：直接用 `editor-dock.css` 的 `.med-f-*`（`mobile/main.tsx` 全局引入）；旧自绘顶栏与 `mobile.css` 里 121 行表格样式整体删除。
- **设备验收（本批起用**专属 AVD `lake_sheet` / 5562 / CDP 9338**，不再占 `lake_gate`；新包，像素级）**：行 24 / 列 120 / 行头 40 / 列头 24（截图像素量化 63 device=24 CSS、316 device=120.4 CSS）；
  公式栏 21、dock 8×49×44、页签栏 32 均 DOM 实测；面板四项与动作链（底色 / 数字格式 0.25→25.00% / 撤销重做 / 缩放 110% / 新建工作表 / 阅读态 / 键盘 842↔530）全部生效；
  force-stop 重启后单元格值/格式/底色/工作表结构全部还原。
- **网格默认（B 方案，用户 261020 定）**：`core/usheetDoc.ts` **保持桌面口径**（列宽 88、不写行头/列头）；移动端新建表走
  `src/mobile/usheet/mobileSheetGrid.ts` 的 `emptyMobileUsheetBody()`（24/120/40/24），「＋新建工作表」也把同一份
  `MOBILE_USHEET_GRID` 传给 `insertSheet`（否则新页签按内核默认 88 出来）。网格写进正文后跟着文档走 ⇒ 手机上建的表在桌面打开也是这套。
  护栏 `mobileSheetGrid.test.ts`（core 保持 88 / 移动端 24·120·40·24 / 覆盖所有工作表且不动 cellData）。
- **撤销/重做置灰**：`IUndoRedoService.getUndoRedoStatus`（令牌从 `@univerjs/presets` 转发拿，不新增依赖、不直连 core 包），
  `__getInjector()` 读 `undos/redos`；服务缺席时退回常亮（不锁死）。触点登记 `UNIVER_FEATURE_NAMES.getUndoRedoStatus`。
  设备实测三态：新建空表两键灰 → 填一次底色「撤销」亮 → 撤销后「撤销」灰「重做」亮。
- **代码 review 补的 3 处**：① **对齐回显**：Univer `getHorizontalAlignment()` 的右对齐是 `normal`（setter 也只收 left/center/normal）
  ⇒ 读出时必须映射成 UI 的 `right`，否则「右对齐」永远不高亮（`alignOf` + 单测）；② 下划线/删除线在部分内核版本是裸 `1` 而非 `{s:1}`
  ⇒ `lineFlagOf` 两种形状都认；③ 删掉未使用的 `USHEET_READING_ACTIONS` 死代码。
- **本批修掉的两个真 bug**：① 面板 9 项一行 ⇒ 中文标签被省略号吃掉（数字格式改 5+4、常用公式 3+2，标签压到 ≤4 字，护栏加了长度断言）；
  ② **⌨ 收起后弹不回来**（原判据「焦点是否在宿主内」，而关键盘后 Univer 会把焦点留在编辑器 div）⇒ 改**视口收缩 >200px** 判据（AGENTS §7.17）+ 双态图标（Keyboard/KeyboardOff）。
- **面板位置（用户 261020 报）**：DOM 顺序改为 footer → dock → **panel** ⇒ 面板向下占键盘区、dock 停在面板上沿；
  实测 footer.bottom=452 / dock 452–508 / panel 508–842（视口底）。
- **门禁（提交树）**：tsc 0 · vitest **320 文件 / 2325 例（16 skip）** · ui-metrics（移动端字号字面量回基线）· check:core 93-0 · check:mobileui · check:bundle（app-css 1.79MB）· 双构建 · `git diff --check` ✓。
- **残留（如实）**：数字格式/字号在混选时回显「常规」· 筛选/排序/条件格式/数据验证/保护/查找替换 = P2（要补插件，
  走 `USHEET-UPGRADE.md`）· 阅读态轻工具条只做工作表+缩放 · 桌面新建表仍是 88/24 的旧口径（与移动端移动端新建的 120 不同，
  这是 B 方案的有意结果；同一份文档跨端看到的一致）。

### 261020(三) · 表格（usheet）P1：布局动作 + 数字格式 + 常用公式 · **已合入并推送 master（见 `git log`：`fc6d3a77` / `0a7c2990` / `0462df6b`）**

> 前置：master 已含 origin/master 合并（ink 手写板 v1 等）与本会话 261020 移动端批次（`eff2cae1`）。
> 本批在**干净分支**上做，按用户要求「合并推送 master 之后再推进 P1」。

- **交付**：表格「更多」面板新增三组布局动作 —— **冻结窗格**（冻结至当前行 / 至当前列 / 取消冻结）、
  **行高**（+8 / -8 / 自动行高）、**列宽**（+24 / -24）。全部走 Univer facade
  （`setFrozenRows/Columns` / `cancelFreeze` / `get,setRowHeight` / `autoFitRow` / `get,setColumnWidth`）。
- **架构**：动作清单与实现收敛到 `src/mobile/usheet/usheetLayoutActions.ts`（单一来源、可单测；
  组件只做菜单分派）；行高/列宽有下限（16/32），Univer facade **没有"自动列宽"**（只做 ± 步进）。
- **设备验收（emulator-5554）**：新建空白表格 → 冻结至当前行 ⇒ 正文 `freeze.ySplit=5`；
  行高 +8 ⇒ `rowData[4].h=32`；列宽 +24 ⇒ `columnData[1].w=112`；自动行高 ⇒ `rowData[4].ia=1`；
  取消冻结 ⇒ `xSplit/ySplit=0`。测试表格已 purge，`测试笔记本` 回到 4 篇。
- **门禁**：tsc 0 · 全库 vitest **314 文件 / 2294 例** · 双端构建 · ui-metrics/check:core/check:mobileui · diff-check。
#### 追加：数字格式（P1 第二批，同批已入 master）

- **交付**：「更多 → 数字格式」9 档：常规（清除）/ 文本 / 数字（两位小数）/ 整数 / 百分比 / 货币（¥）/ 日期 / 时间 / 日期时间。
- **架构**：选项表与注入式调用收敛到 `src/mobile/usheet/usheetNumfmt.ts`（单一来源、可单测）。能力来自
  `@univerjs/sheets-numfmt` 给 `FRange` 追加的 `setNumberFormat(pattern)`（facade mixin）：
  调用前判 `typeof setNumberFormat === "function"`，**缺失时明确 toast、不静默 no-op**。
- **设备验收（emulator-5554）**：种入数值网格后，B1=1.5 选「数字」⇒ 正文
  `styles[...].n.pattern="#,##0.00"` 且格 `s` 指向该样式；B3=21.5 选「百分比」⇒ **公式栏显示值实测 `2150.00%`**、
  正文 pattern `0.00%`（渲染链路与落盘都正常）。测试表格已 purge，`测试笔记本` 回到 4 篇。
- **门禁**：tsc 0 · 全库 vitest **315 文件 / 2296 例** · 双端构建 · ui-metrics/check:core/check:mobileui · diff-check。

#### 追加：常用公式快捷插入（P1 第四批，已入 master）

- **语义（对齐 Excel/Sheets 的 Σ）**：选中**一个单元格** →「更多 → 常用公式 → 求和/平均值/计数/最大值/最小值」，
  在它**上方同一列**自动找**连续数值块**，向该格写入 `=SUM(A1:A3)` 这一类完整公式（不覆盖既有数据、不猜语义）。
- **架构**：`src/mobile/usheet/usheetFormulaQuick.ts`（选项表 + 列名 A1 记法 + 纯计划函数，可单测）；
  条件不满足（多格选区 / 上方无连续数值 / 第一行）一律 **toast 明说**，不写盘。
- **设备验收（emulator-5554）**：A1=10/A2=20/A3=30，选中 A4 → 求和 ⇒ 公式栏显示 **60**、正文
  `A4 = {f:"=SUM(A1:A3)", v:60, t:2}`；选中 A7（上方为空）⇒ toast「这个单元格上方没有可统计的连续数值」。
  测试表格已 purge，`测试笔记本` 回到 4 篇。
- **门禁**：tsc 0 · 全库 vitest **316 文件 / 2301 例** · 双端构建 · ui-metrics/check:core/check:mobileui · diff-check。

- **未做（下一刀）**：**排序/筛选**（当前 Univer 预设**没有** sort/filter 插件，只有 numfmt；要做需另装
  `@univerjs/sheets-sort`/`sheets-filter` 或自研）、填充柄与批量操作、CardResizer 触控调高、行高列宽"记住上次"；
  公式库的**完整版**（按类别浏览 + 参数提示）与「先选区域再插公式」没做（移动端选区易误拖，先只做单格 Σ 语义）。
- **剪贴板三键：试过并回退（261020，有设备证据）**：用 `univerAPI.executeCommand` 派发
  `sheet.command.copy/cut/paste`（与桌面快捷键同一条内核命令）—— 实测命令返回 true、**无报错也无效果**
  （A1 复制 → C3 粘贴后正文 C3 仍是原值），说明这套命令依赖内核自己的剪贴板 data 通道，移动 WebView 里
  拿不到原生 copy/paste 事件 ⇒ **不放假按钮，已整体回退**（不进代码）。要支持需接原生剪贴板桥
  （Android ClipboardManager + 内核可编程剪贴板服务），单独立项。
- **状态**：已合入并推送 master；远程分支 `feat/mobile-usheet-p1` 已删除（用户要求不再开新分支）。

### 261020(二) · 移动端多维表编辑 P0（本会话）· **已合并 master（261020 批）**

> 上一批（表格/画板收口）仍待验收，见下方「261020」；本批接的是它列的 **P0：多维表移动端编辑**。

#### 交付范围（P0，按用户 261020 定的最小可用）

1. **新建数据表解禁**：目录「新建 → 新建数据表」可点；`bridge.createBitable()` 用 core `emptyBitableBody()`
   （1 文本列 + 3 条空记录）、`doc_kind=bitable`，建完直接进编辑态（与表格/画板同一条创建通道 + 空父兜底）。
2. **查看/编辑**：`MobileBitableViewer` 扩成双态（阅读态渲染与旧版逐项一致）。
   交互定稿：**点单元格 → 记录底部面板**逐字段编辑（文本/数字/日期/单选/多选/评分/进度/链接），
   **布尔单击直切**（不开面板）；表尾「＋ 新增记录」、面板底部「删除记录」（确认）。
3. **字段基础增删改**：顶部「字段」面板 —— 重命名（inline 输入）/ 删除（确认；只剩一列拒绝）/ 新增（P0 九种类型）；
   单选/多选可在记录面板里新建选项（同名复用、新建即选中）。
4. **只读字段明说**：附件/图片/关联/系统时间/AI/Markdown 在面板里只读并写理由（不做"建得出来改不了"的入口）。
5. **正文语义**：与桌面共用 core 写入纯函数；序列化恒写 **canonical 导航**（第一表/第一视图）⇒ 切表/切视图是设备本地状态，
   不写正文、不进 S3；**bitable 正文绝不给 Lake 编辑器**。
6. **行窗口**：记录全集留在模型，挂载 100 条/页 + 显式「加载更多」（不静默裁剪）；真实虚拟滚动留 P1。

#### 顺带修掉的两处真 bug（都在验收路径上，有设备证据）

- **`saveNote` 把 `parent_id` 写成 NULL**（`noteRepository`，10-01 起就存在）：自动保存/「完成」只传正文不传 parentId，
  UPDATE `parent_id=?` ⇒ 每保存一次就把文档从笔记本摘出来（目录里找不到、**笔记本计数下降** —— 正是用户报过的「计数不涨」）。
  修：`parent_id=COALESCE(?, parent_id)`；显式移动仍走 `moveTreeNodeOrdered`。护栏 `bridgeTree.test.ts`「保存不改树归属」。
- **返回首页列表不刷新**（`MobileApp`）：首页是 keep-alive 常驻层，`refreshAll` 只在冷启动/首页自身操作时跑 ⇒
  在工作区新建/编辑后回首页，计数与「最近文档」仍是旧值。修：route **notebook → home** 时补一次 `refreshAll()`（不挡转场）。
  护栏 `homeCreateFlow.test.ts`。

#### 门禁（提交树实测）

- `tsc --noEmit` 0；`vitest` **306 files passed / 5 skipped（311）；2249 tests passed / 16 skipped（2265）**；
  双端构建 ✓；`ui-metrics` ✓（mobile.css 基线 1428 → **1504**，新增编辑态部件逐条写明理由）· `check:core` ✓ ·
  `check:mobileui` ✓ · `check:bundle` ✓ · `git diff --check` ✓。

#### 设备验收（emulator-5554；APK 40,120,175 B）

- 新建数据表 → **目录立即出现**、进入编辑态（1 表 / 3 记录）。
- 单元格：点格 → 记录面板 → 输入 → 关面板，网格即时回显；force-stop 重启后仍在（`files/bitables/{id}.bitable.json`）。
- 落盘体已核对：`{"kind":"bitable","version":1,…,"activeTableId":"<第一张表>","tables[0].activeViewId":"<第一个视图>"}`（canonical ✓）。
- 字段：新增「单选」→ 记录面板里新建选项「进行中」并选中 → 网格显示；重命名 → 表头同步；删除字段 → 表头/网格收敛。
- 记录：新增（自动开面板）→ 删除（确认框）→ 计数 4 → 3。
- **父节点**：编辑保存后 `listNotes` 仍显示 `parentId=<测试笔记本>`（修复前为 null）。
- **计数**：测试笔记本 4 篇 → 新建数据表并编辑 → 返回首页 **5 篇**（无需重启）；清理测试文档后回到 **4 篇**。
- 回归：既有 usheet 打开正常；既有画板阅读态正常（`.draw-toolbar` display:none）；doc 路径未改。
- **清理**：本会话创建的 3 篇测试数据表已 `trashNote + purgeTreeItem`（body 文件已随 purge 删除）；
  `测试笔记本` 已回到 4 篇。残留 `files/bitables/mobile-bitable-1.bitable.json` 是**更早会话**的无行孤儿，未动。

#### 本批文件

- 新增：`src/mobile/bitable/mobileBitableEdit.ts`（纯逻辑：canonical 序列化 / 字段记录选项写入 / 分页窗口 / 取值口径）、
  `MobileBitableRecordSheet.tsx`、`MobileBitableFieldSheet.tsx` + 两份护栏测试。
- 修改：`MobileBitableViewer.tsx`（双态 + 工具栏 + 分页）、`NotebookWorkspace.tsx`（编辑放行 / bitable 双态接线 /
  `createChildBitable` / 新建项解禁）、`bridge/notes.ts`（`createBitable`）、`core/bitableMutations.ts`（+addBitableField /
  renameBitableField / deleteBitableRecords；桌面 `deleteRecords` 改用同一函数）、`core/maintenancePolicy.ts`(+createBitable)、
  `native/lakeNativeContract.ts`(+createBitable)、`data/noteRepository.ts`（parent_id COALESCE）、`MobileApp.tsx`（回首页刷新）、
  `mobile.css`(+76)、对应测试与基线。

#### 追加：画板视口记忆（P1，本会话同批）

- **问题**：`MobileBoardViewer` 每次打开都 `fitOnInit`，用户拖/缩到的位置不记（重开回到默认）。
- **修**：复用桌面同一份 `features/board/boardViewStore`（localStorage，L3 设备本地）：有记忆 ⇒ `fitOnInit=false`
  并把 `plaitViewport`（缩放）喂给引擎；平移 = **滚动画布容器**，盯 `.viewport-container`（滚动合并 200ms + 松手立即落盘）；
  恢复用重复贴位（≤1.2s）。**视口不进正文、不标脏、不进 S3**。
- **设备验收（emulator-5554）**：新建画板并 seed 一块 3000×2000 大画布 → 滚到 800/499.8（store 写入
  `lake-notes-v3.board-views`）→ **force-stop 重启**后重开 ⇒ `scrollLeft/Top = 800/499.8`（`scrollWidth 3618`）；
  期间 `boards/*.board.json` **逐字节未变**。测试画板已 purge 并清掉其 store 条目。
- 护栏：`mobile/board/mobileBoardViewer.test.ts`（有记忆不 fit / 缩放回写 / 滚动回写）+ `boardEditorMount.test.ts`
  （宿主必须传 `noteId`、视口不经正文）。
- **没搬的**：桌面"收敛后再显示（visibility 门控）"未搬（移动端打开即见内容优先，允许一次轻微跳位）。

#### 追加：画板内联图片资产管线（P1，本会话同批）

- **问题**：画板里插入的图片被 Drawnix 内联成 `data:image/…` 写进正文 ⇒ 正文膨胀、每次编辑都整份上传、
  图片不进 manifest.assets（跨端拿不到）。
- **修**：与桌面共用 `features/board/boardImageAssets` 的纯函数（新增 `boardAssetHydrationMapping` /
  `boardInlinePromotionMapping` / `decodeInlineImageDataUrl`），移动端只注入两个能力：
  读回 `native.readAssetPreview`（资产 URL → data URL，内存口径）、上传 `bridge.uploadResource`
  （data URL → `note-assets/{noteId}/`，磁盘口径 = canonical 资产 URL）。
  **提升在途不保存**（`promoteInflightRef`，避免把 `data:image` 写进正文）；单张失败保持内联（不丢图），完成后补一次保存。
- **踩到的坑（已修）**：移动端 `bridge.uploadResource` 返回的 `filename` 是**展示名**（用户原始名），
  磁盘名只在 `url` 末段 ⇒ 一开始按 filename 拼 URL，正文写成 `…/board-image.png`（图片 404）。
  现在映射**优先用 `url`**，只有 filename 时才拼；单测覆盖两种回执。
- **设备验收（emulator-5554）**：种入内联 PNG 的画板 → 进编辑态 ⇒ 正文变为
  `http://127.0.0.1:19876/{noteId}/1792467882307_d310ced1.png` 且该文件落盘；**再切两次编辑态** ⇒ 资产仍 1 个、
  正文逐字节不变（不重复上传）；重开后引擎 DOM 里是 `data:image`（hydrate 生效，磁盘仍是资产 URL）。
- 护栏：`boardImageAssets.test.ts`（解码扩展名 / hydrate 跳过读不到 / 提升优先 url、已知不重复、失败不丢图）+
  `mobileBoardViewer.test.ts`（hydrate 换回 data URL / 提升后写盘是 canonical URL 且无 `data:image`）+
  `boardEditorMount.test.ts`（移动端复用同一套映射、提升在途不保存）。
- **观测**：移动端 `purgeTreeItem` **不清理 `note-assets/`**（正文/历史会删；本机图片目录残留），验收时已手动清理测试残留；
  是否在 purge 时一并删资产属产品语义（会牵连同步/孤儿账本），先记录不改。

#### 收尾 review（提交前自查，261020 会话批次）

- **单一来源收敛**：新增 `features/bitable/bitableNavStore.ts` —— 多维表设备本地导航（当前表/每表当前视图）的
  读写与 `applyBitableNav` 从桌面 `BitableEditor` 内联实现上收，**桌面与移动端共用**（localStorage 键不变
  `lake-notes-v3.bitable-nav.<noteId>`；移动端切表只写导航、重开回到上次那张表）。桌面行为不变（behavior test 通过）。
- **创建通道收敛**：`NotebookWorkspace` 里 文档/表格/数据表/画板 四个几乎相同的 create 处理器合成
  **一个 `createChildDocument(kind, parentId)`**，清单 id → kind 由 `CREATE_MENU_KINDS` 单表映射（group 另走
  `createChildGroup`）。行为保持：文档建完停在阅读态，其余三类建完直接进编辑态；建完都刷新目录 + 收抽屉。
- **清理**：`MobileBoardViewer` 删掉未读的 `viewportRef`（只写不读的死状态）；`boardImageAssets` 的
  `core/assetUrl` import 从文件末尾移到顶部。

#### 未做（P1，别当遗漏）

复制/剪切/粘贴、公式库、数字格式、排序/筛选/分组、填充柄、附件/关联编辑、撤销重做、视图切换/视图配置、真实虚拟滚动；
**画板 AI 徽标**（阻塞：移动端还没有 AI 通道，首页「AI 助手」仍是"尚未接入"）；
表格（usheet）与画板剩余的 P1 见下方「261020」原清单。**未提交、未推送，等用户验收。**

### 261020 · 移动端表格/画板收口（本会话）· **已合并推送 master（c65b889e / afe9d3f9）**

> **接手提示**：先读 README → HANDOFF → AGENTS；本批只动移动端表格/画板，不要回退其他并行会话的
> Sidebar / NodeIcon / 导出 / 存储改动。工作树是**多会话共用**的，禁止 `git add -A`、`git checkout -- .`。

#### 基线 / 工作树 / 安装态

- 分支 `master`；**写交接时** HEAD `b21bec5d`（其他会话的 Excel 导出批次已提交并推送）。新会话请以 `git log -1` 为准；
  本会话改动**全部未提交、未推送**。
- 工作树含大量并行会话在途文件（Sidebar、NodeIcon、导出、存储等）。本会话直接相关文件：
  - `src/mobile/usheet/MobileUsheetViewer.tsx`（语雀式工具条/公式栏/保存）
  - `src/mobile/usheet/mobileUniverPreset.ts`（**untracked，前一会话已做**：桌面 UI 插件族 → 移动 UI 插件族）
  - `src/mobile/board/MobileBoardViewer.tsx`（阅读/编辑双态）
  - `src/mobile/notebook/NotebookWorkspace.tsx`（新建入口、编辑态、capture 管线、父节点兜底）
  - `src/mobile/bridge/notes.ts`（`createUsheet` / `createBoard`）
  - `src/mobile/data/noteRepository.ts`（`createNote` 支持 `kind`）
  - `src/mobile/mobile.css` / `src/mobile/mobileLayers.test.ts`（表格顶栏、公式栏、画板工具条、FAB 校位、CSS 基线）
  - `src/core/maintenancePolicy.ts` / `.test.ts`（新增委托型写操作登记）
  - `src/features/board/boardEditorMount.test.ts`、`src/mobile/board/mobileBoardViewer.test.ts`、`bridgeTree.test.ts`、`workspaceMenu.test.ts`
- 设备：`emulator-5554` 是用户实例；另有 `emulator-5556`（并行会话）。**所有 adb 命令必须带 `-s emulator-5554`**。
- 当前安装包：`android/app/build/outputs/apk/debug/app-debug.apk`，**38.1 MB**，`versionName 1.2`，
  安装时间 `2026-10-20 10:23:09`。只有 debug APK，未做 release 签名。
- 用户数据：`测试笔记本` 现有 **4 篇**验证文档（2 表格 + 2 画板）；`个人笔记` 显示 **53 篇**。
  历史孤儿 `c4dcaa…`（表格）与 `3f44ca0f…`（画板）已移回测试笔记本；早期测试表格 `7508e07f…` 已移入回收站。

#### 已完成（设备实测）

1. **新建表格解禁**：目录「新建 → 新建表格」可点；`bridge.createUsheet()` 用共享 `emptyUsheetBody()`（50×16），
   `doc_kind=usheet`，建完直接进编辑态；数据表仍置灰。
2. **新建画板解禁**：目录「新建 → 新建画板」可点；`bridge.createBoard()` 用 `emptyBoardBody()`，
   `doc_kind=board`，建完直接进编辑态；绘制矩形后落盘 `boards/{id}.board.json`，重启阅读态仍能看到。
3. **表格语雀式编辑面**（`MobileUsheetViewer`）：
   - 顶部常驻工具条：插入（行/列/合并）、撤销/重做、粗/斜/下划线/删除线、文字格式（对齐/字体色/填充色/清除）、
     更多（删行/删列/打开官方动作面板）；右侧绿点 = 自动保存。
   - 自绘公式栏：选区地址 + 显示值（移动 UI 插件不渲染内置 formula-bar）。
   - 官方 Univer 动作面板仍可从「••• → 更多表格工具」打开（隐藏的 FAB 用程序 click）。
   - 编辑态只保留「键盘」一颗浮动钮；官方两颗 FAB 用 `transform: translateY(-40px)` 校位。
4. **画板阅读/编辑双态**（`MobileBoardViewer`）：
   - 阅读态 `readOnly`；编辑态 `readOnly={!editing}`，CSS 恢复 `.draw-toolbar`。
   - 800ms 防抖 + `onCapture`；与 usheet 共用 `liveBodyCapturesRef`，完成/关标签/返回首页都会同步取最新 body。
5. **父节点修复（用户 261020 报「新建后目录不出现、计数不涨」）**：
   - 根因：`createParent` 为空串时，落库 `parent_id=''`；`listNotebookTree` 只收挂在笔记本子树下的行 ⇒ 树里不可见、计数不涨。
   - 修：`createChildDoc/Sheet/Board` 用 `parentId || notebookId`；`bridge.createNote/createUsheet/createBoard`
     把空白 parentId 视为缺失并走 `defaultNotebookId()`；`noteRepository.createNote` 支持 `kind` 参数。
   - 已验证：新建后目录立即出现，笔记本计数从 0 → 4。
6. **手势**：表格内容区 `data-prevent-swipe` + `usePanelDrag` 的 `Element` 命中；设备实测 A–D ↔ D–G 横滑、
   左右拖均不拉目录抽屉。画板同样挂 `data-prevent-swipe`。
7. **门禁**：`tsc --noEmit` ✓；`vitest` **301 passed / 5 skipped，2216 tests passed / 16 skipped** ✓；
   桌面/移动端构建 ✓；`ui-metrics` / `check:core` / `check:mobileui` / `check:bundle` / `git diff --check` ✓。

#### 关键实现/坑（改前先看）

- **移动端 Univer 必须用移动 UI 插件族**：`mobileUniverPreset.ts` 把 `UniverUIPlugin` / `UniverSheetsUIPlugin` 等
  成套替换为 `UniverMobileUIPlugin` / `UniverSheetsMobileUIPlugin` + docs/numfmt/formula/drawing 的 mobile 版；
  桌面 UI 的 selection service 会把单指横拖判成扩选。不要只换 `sheets-ui`（依赖会启动失败）。
- **不要用 pointerdown preventDefault 做工具条按钮**：Android WebView 会连 click 一起吞掉（实测 B 按钮无反应）。
  按钮保留普通 `onClick`；点格式时键盘可能收起，属已知取舍。
- **FAB 位置**：Univer 移动 Workbench 的 `bottom-14` 会被视觉视口推到容器下沿（只露半颗、点按落网格）；
  用 `transform` 上移，不要改 `bottom`（越改越往下）。官方动作面板从顶栏「•••」打开。
- **父节点**：`parent_id` 空串与 NULL 都要当缺失处理；`bridge` 与 UI 双层兜底。不要在树查询里做兼容式“把空父挂到默认笔记本”，
  否则会掩盖数据错误；修复应发生在创建边界。
- **capture 管线**：usheet/board 的正文在实例内，父级 `tab.content` 可能落后于防抖；关闭/切换/完成必须调用
  `liveBodyCapturesRef` 的同步 capture，不要只读 React state。
- **CSS 基线**：`mobileLayers.test.ts` 的 `mobile/mobile.css` 基线已到 `1428`；新增样式必须同步改基线并写明理由。
- **构建/安装**：`scripts/android-build.sh --install` 在有两台设备时会报 `more than one device/emulator`；
  先跑 `--sync`，再手动 `adb -s emulator-5554 install -r ...`。

#### 尚未完成（下一会话按优先级）

**P0：多维表移动端编辑 —— 已交付（261020(二)，见 §8 顶部本批记录）**
- 新建 / 记录面板编辑 / 字段增删改 / 记录增删 / 分页窗口已完成并设备验收；剩余项（视图切换、排序筛选、复制粘贴等）见该节的 P1 清单。

**P1：表格编辑完整度**
- 复制/剪切/粘贴移动交互、公式库/函数选择、数字格式、排序筛选、冻结窗格、填充柄/批量操作。
- CardResizer 触控调高（文档内画板卡）。
- 表格行高/列宽的移动端调优（当前默认 24px 行高偏紧）。

**P1：画板剩余**
- Drawnix 工具栏 AI 徽标尚未接移动端 AI 通道（目前未传 `ai` prop，点击可能无反应）。**阻塞项**：移动端还没有 AI 通道。
- 画板内图片资产：移动端未做 `hydrateBoardAssets` / `promoteInlineImages`（桌面 `BoardEditor` 有）。
- ~~画板视口（缩放/平移）未持久化~~ **已做（261020(二) 追加：boardViewStore 本机记忆）**。

**P2：其他**
- 文档插入的「文本绘图」仍置灰（画板/流程图/UML/思维导图已可用）。
- 历史 `parent_id=''` 孤儿没有全库自动修复；本批只修了 2 个测试孤儿 + 1 个测试表格入回收站。
- release/签名包未做。
- 全库提交/推送未做；工作树仍与其他会话共用。

#### 数据/同步红线（不要碰）

- 之前记录的 S3 `Unexpected stream implementation, expect Blob or ReadableStream, got undefined` 仍未收口；
  **不要执行同步/GC/深度清理**，等正文文件存储重构的并行会话完成。
- 早期丢失的图片/附件尚未从 S3 镜像补回；本地是唯一真相，S3 只是镜像。
- 测试数据：`测试笔记本` 4 篇验证文档保留；不需要再创建重复测试文档。

#### 下一会话建议开场命令

```bash
export PATH="$HOME/.nvm/versions/node/v24.18.0/bin:$PATH"
cd /Users/admin/file/local-lake/lake-notes-electron
git status --short              # 先确认并行会话改动，禁止整体回退
npx tsc --noEmit && npx vitest run
npx vite build && npx vite build -c vite.mobile.config.ts
```

### 261019 · 移动端 usheet：新建表格解禁 + 语雀式编辑面 · **待用户验收**

- **新建表格 / 画板**：目录「新建」里的表格、画板均不再置灰；`bridge.createUsheet()` / `createBoard()` 分别落
  `emptyUsheetBody()`（50×16）与 `emptyBoardBody()`，建完直接进编辑态。仅数据表仍只读置灰。
- **父节点兜底（261020 用户报「新建后目录不出现」）**：`createParent` 空串回退 `notebookId`；bridge 把空白
  parentId 视为缺失并走 `defaultNotebookId()`。此前空串会建出 `parent_id=''` 的孤儿（树里不可见、计数不涨）。
- **编辑面**（对齐语雀 App）：Univer 移动 UI 插件族不变（单指横拖 = 滚动画布），顶部自绘常驻工具条：
  插入（行/列/合并）、撤销/重做、粗/斜/下划线/删除线、文字格式（对齐/字体色/填充色/清除）、更多（删行/删列/官方动作面板）；
  右侧绿点 = 自动保存。自绘公式栏 `地址 + 显示值`（移动 UI 插件不渲染内置 formula-bar）。
- **FAB 校位**：官方两颗浮动钮被视觉视口推到容器下沿（只露半颗、点按落网格）⇒ `translateY(-40px)`；顶栏已有插入/格式后
  只保留「键盘」一颗，完整官方面板从「••• → 更多表格工具」打开。
- **手势**：内容区 `data-prevent-swipe` + `Element` 命中；设备实测 A–D ↔ D–G 横滑、左右拖均不拉目录抽屉。
- **保存**：`Event.CommandExecuted` 600ms 防抖；完成/关标签/返回首页用 `onCapture` 同步 `book.save()`。阅读态无工具条/公式栏。
- **设备实测**：新建即编辑；双击单元格进公式栏 + 键盘；粗体/插入行落盘到 `usheets/{id}.usheet.json`；画板矩形工具可绘制并落盘
  `boards/{id}.board.json`；官方动作面板可开。已把 3 个历史孤儿测试文档移回测试笔记本验证目录/计数恢复。
- **未做**：CardResizer 触控调高、复制粘贴/公式库移动专有交互、多维表编辑（详见下方 261020 交接）。

### 261015 · 移动端「＋」插入面板重排（**4 列方块网格** / 单一列宽 / 一屏放下）· **待用户验收**

- **起因**：用户报「＋ 面板排布乱」，并要求"加分组、做适当分隔"。**先取证再改**（CDP 读真实 DOM）：面板视口 **311px** / 内容 346px；
  旧结构 5 行里混着**两档列宽（3 列行 116.1 与双卡行 84.8）**、末行只 2 项（右 1/3 空）、**组间距 = 行间距 = 5px** ⇒ 没有层级；
  且 `.med-ins-card` 注释写"浅灰圆角面"、实现却用 `--lake-bg-panel`（浅色下 = `--lake-bg-window` = #fff）⇒ **"卡"从来没画出来过**（真缺陷）。
- **改法**：`EditorDock.tsx` 把 6 组并成 **4 组（3/6/6/3）** ⇒ 3 列下 **组界=行界、零空洞**；删掉只服务旧双卡行的
  `INSERT_ROWS` / `.med-ins-row` / `--split`（净 **−11 声明**）；`editor-dock.css` 组间 8px + 1px `--lake-border-2` 细线，
  并给「＋」面板**单独**收紧 `.med-panel-inner` 内距（12/14 → 6/6，**高度预算必须算它**）。
  **分隔按 `MOBILE-DESIGN`「The White Rule」用细线、不用灰底衬托白卡**（该规则是用户 261013 定稿 —— 我先写成"灰底 + 白块"、已纠正）。
- **设备实测**（emulator-5554 = 用户实例；`android-build.sh --sync --install` 后按 **APK 内容哈希 + `lastUpdateTime`** 核对确实换包）：
  **311 = 311（不再溢出）** · 18 项 / 4 组 / 6 行 `[3,3,3,3,3,3]` · 条目统一 **117×44** · 零截断 · 组间细线在、组内无 ·
  浅色实拍 + 深色实拍（深色用运行时 `data-theme` 切换，**未改用户设置、已还原**）。
- **判据已固化**：新装置 `scripts/mobile-audit/insert-panel-geometry.mjs`（G1–G6，**ALL PASS**），注册进 `scripts/mobile-audit/README.md`；
  ⚠️ **快照 6 态与走查 23 屏都不覆盖这个面板** ⇒ 没有这个探针就等于没量过。
- **门禁**：tsc ✓ · vitest **255 文件 / 1976 例** ✓ · 双端构建 ✓ · ui-metrics（移动端字号字面量 46 ≤ 49、桌面 `!important` 10/10）✓ ·
  `check:core` 78-0 ✓ · `check:mobileui` ✓ · `check:bundle` ✓ · `git diff --check` clean。**未提交/未推送**（代码批次待用户验收）。
- **未做/待定**：① 若用户想要**更多分组**：5 组 `{3,3,3,6,3}`（把「文本块」拆成「基础块」+「代码与标注」）或 **6 组 × 3 项**
  同样能保持零空洞，但「媒体/布局/关联」要重切；② 走查装置尚未覆盖该面板一屏（可补，需 `lake_gate` 实例）。
- **方法学坑（回填）**：CDP `Page.captureScreenshot` + `clip` 在本机 **dpr 2.625** 下**画面被错误平铺**（每个条目画两遍），
  差点误判成"DOM 重复渲染" ⇒ 移动端出图一律 `adb exec-out screencap -p`（既有红线，这次再次验证）。
  再补一条：**截图裁切要算状态栏** —— 页面 CSS `y=0` ↔ 设备 `y=128`，按 CSS 值直接裁会把面板最后一行切掉、看着像"产品裁切"（本轮差点再次误判，已记进 `scripts/mobile-audit/README.md`）。
- **261015 追加（同日，用户改口径 → 本批最终形态）**：看过候选图后用户点单"改成方块样式（图1）"，随后又定"先做 52，不用太大"、"可以做上下滑动，不一定要局限在这个键盘位置"：
  · 面板改为 **4 列方块网格**：列宽统一 **93**、方块 **93×52**（图标 22 在上 / 文字 13 在下 / 居中 / 圆角 12）、**浅灰面板底 + 白块**；
  · **一屏放下**（5 行 × 52 + 4×6 + 面板内距 12 = 296 ≤ 311，**溢出 0**）；内部滚动能力保留（用户已授权，当前尺寸用不上）；
  · 分组容器 / 卡片 / 细线 / `INSERT_ROWS` **整体退场**（4 列下 18 项做不到"组界=行界"）⇒ 分组只保留在 `INSERT_GROUPS` 的**顺序**里；末行 2 项（用户接受）；
  · **The White Rule 的面板级例外**（用户为这个面板明确选了"灰底 + 白块"）已写进 `MOBILE-DESIGN.md`；常驻页面不变；
  · 探针判据同步为 G2「每行填满·仅末行可不足」/ G3「溢出可滚 + 末行完整可达」/ G6「方块形态」⇒ **ALL PASS**（面板 311 = 内容 311；末行底 821 ≤ 面板底 842）；
  · 证据（设备级、已按正确裁切偏移重出）：`.css-audit/insert-panel-261015/{tile-light.png,tile-dark.png}`。
- **261015 三改（用户当天第三次点单：分组与顺序）**：`＋` 面板改为**两组各 9 项**（① 拍照 图片 附件 音频 视频 表情 状态 日期 日历；② 表格 引用 分割线 代码块 高亮块 分栏 折叠块 链接 文档引用），列数 **3** ⇒ **9 = 3×3，组内零空洞、组界 = 行界**，格宽 **125**；组间 **16px**（组内行距 6px 的 2.7 倍）**靠留白分隔**（不画线）；「更多」面板仍 4 列（8 项 = 2 行排满）。
  实测：6 行 `[3,3,3,3,3,3]` / 内容 **364 > 311 ⇒ 溢出 53px 走面板内滚动**（末行「折叠块 / 链接 / 文档引用」需下滑才见；**想一屏放下就把方块降到 44px**）；探针 **ALL PASS**，并新增 **G7 组间分隔（组间 ≥ 组内 2 倍）**；证据 `.css-audit/insert-panel-261015/{regroup-light.png,regroup-dark.png}`。
  门禁：tsc ✓ · vitest **255 文件 / 1976 例** ✓ · 双端构建 ✓ · ui-metrics（移动端字号字面量 46 ≤ 49）✓ · `check:core` 78-0 ✓ · `check:mobileui` ✓ · `git diff --check` clean。
- **261015 四改（最终形态，用户定："还是一行 4 个，把日历放到第二组"）**：`＋` = **4 列 / 两组（8 + 10）**（① 拍照 图片 附件 音频 视频 表情 状态 日期；② 表格 引用 分割线 代码块 高亮块 分栏 折叠块 链接 文档引用 日历）
  ⇒ 5 行 `[4,4,4,4,2]`、格宽 **93**、组间 **16px 留白**分隔（组内行距 6）；① 两行**零空洞**、② 末行 2 项；
  **高度 306 ≤ 311 ⇒ 一屏放下（溢出 0，不再需要滑）**。探针 **ALL PASS**，并新增 **G8 组界落在行界**（`groupSizes=[8,10]`，8 = 2×4）；证据 `.css-audit/insert-panel-261015/{final-light.png,final-dark.png}`。
  门禁：tsc ✓ · vitest **255 文件 / 1976 例** ✓ · 双端构建 ✓ · ui-metrics（移动端字号字面量 46 ≤ 49、桌面 `!important` 10/10）✓ · `check:core` 78-0 ✓ · `check:mobileui` ✓ · `check:bundle` ✓ · `git diff --check` clean。
- **261015 五改（用户点单：「Aa」面板压缩上下间距 + 图标凝实）**：面板视口 311px、内容 **417 → 354px（−63；仍需下滑约 43px 才看到最底部「字号」行）**：
  行间距 8→6 · 卡内距 3→2 · 条目视觉高 **44 → 40**（按 44 Rule **回到触达补足注册表**，命中区由 `::after` 补回 44）· 色板内距 8→6 · 两行色块间距 11→8 · 色块 **37 → 34** · 面板内距 12/14 → 6/6；
  **图标 17 → 20px**、图标与文字色 `--lake-text-2` → **`--lake-text-1`**（白底上"发虚"的根因 = 尺寸偏小 + 二级灰；**stroke 未动** —— 实测移动端本就是 lucide 默认 2px，比桌面 `svg.lucide{stroke-width:1.75}` 还粗，所以不是描边问题）。
  实测：`scrollH 417→354` · 行高 50→44 · 色板行 101→88 · 图标 20px · 文字色 `rgb(31,35,41)` · 色块 34px；`＋` 面板探针复跑 **ALL PASS**（零回归）。
  证据 `.css-audit/aa-panel-261015/{after-light.png,after-dark.png}`；口径（44 Rule 回例）已入 `MOBILE-DESIGN.md`。
  门禁：tsc ✓ · vitest **255 文件 / 1976 例** ✓ · 双端构建 ✓ · ui-metrics（移动端字号字面量 46 ≤ 49、桌面 `!important` 10/10）✓ · `check:core` 78-0 ✓ · `check:mobileui` ✓ · `git diff --check` clean。
- **261015 六改（用户点单：「Aa」面板里「列表 ｜ 对齐」两块左右对调）**：`EditorDock.tsx` 该行两张卡交换顺序 ⇒ **对齐在左、列表在右**（两卡 data-count 都是 3 ⇒ 宽度不变，纯顺序改动）；注释同步。
  实测（设备级截图）：对齐卡 x 在左、列表卡在右；`tsc` ✓ · vitest **255 文件 / 1976 例** ✓ · 「＋」面板探针复跑 **ALL PASS**（零回归）；证据 `.css-audit/aa-panel-261015/swap-light.png`。
- **261015 七改（用户报 bug：「⌨ 有键盘能收、没键盘点不出来」）** —— **两层根因，都在设备上量出来**：
  · **① 展开路径漏了"摘抑制"**：收键盘走 `suppressImeNow(true)`（给正文宿主写 `inputmode="none"`，这是"留住光标"的关键），
    展开时只 `focusEditor()`、**没摘掉该属性** ⇒ 系统认定该宿主不接受软键盘、`focus()` 也不弹（修复前两连点实测：`ih` 仍 842、`inputmode` 仍 none、按钮仍写「展开键盘」）。
    ⇒ `showKeyboard()` 改成 **先 `restoreIme()` 再 `focusEditor()`**，并补 `showNativeKeyboard()` 作兜底；`onKbToggle` 的无面板分支由 `closePanel("hide")` 改走 `dismissIme()`（避免留下永远为真的 `closing`）。
  · **② 稳定外壳高被污染 ⇒ `keyboardOpen` 永久为真**：`viewportShell` 的"单调取历史最大值"会被 **IME 过渡里单独失真的 `window.innerHeight`** 记牢
    （反推：基准 **866**、真实稳定值 **842**；由 `--mb-app-h`/`--kb-offset` 两组读数 + `capturePanelHeight` 下限 280 解出）⇒ `keyboardOpen = shell - ih > 8` 恒真 ⇒ ⌨ 永远走「收键盘」。
    ⚠️ **这个污染在几何上看不出来**（`--mb-app-h = shell − occupation` 两项互相抵消、恒等于 `ih`）—— 纯行为缺陷，截图/Stylesnap 都发现不了，只有"点一下没反应"能看出来。
    ⇒ 修法：`noteViewport(innerHeight, visualViewport.height)` —— **只在两通道一致（差 ≤8px）时才抬高基准**（adjustResize 下恒等、edge-to-edge 只差键盘高，正好做校验，不引入新机制）。
  · **判据**：新装置 `scripts/mobile-audit/keyboard-toggle.mjs`（状态驱动：K1 收+留光标 / K2 弹+摘属性 / K3 可反复开合）⇒ 设备 **ALL PASS**；
    同时联跑 `edit-surface-invariants.mjs`（基准是它的地基）⇒ **ALL PASS**，数字与 261014 基准逐项一致（ch 306 · st 735 · firstY −642 · caret 363 < tb 474）。
  · 单测：`viewportShell.test.ts` +3、`dockPanelFocusGuard.test.ts` +1；契约回填 `LAKEX-CONTRACT.md` **§5.38.1**；装置注册进 `scripts/mobile-audit/README.md`。
  · 门禁：tsc ✓ · vitest **255 文件 / 1980 例** ✓ · 双端构建 ✓ · ui-metrics ✓ · `check:core` 78-0 ✓ · `check:mobileui` ✓ · `git diff --check` clean。
- **261015 八改（用户报 bug：「点了 ＋ 或 T 展开之后再点键盘 ⇒ 一块空白」）** —— 期望是"点键盘要**连带展开区域一起收起来**"：
  · **根因**：⌨ 在面板开着时走的是 `closePanel("hide")`（语义 = "**无面板时**只收键盘、留住光标"）⇒ 面板虽然关了，
    但**占位要等 2.5s 兜底才释放、键盘也不回来** ⇒ 用户看到一块空白（复现实测：点后 0.3s / 1.2s 仍是
    `--kb-offset:280px / --mb-app-h:562px / inputmode:none`，直到 3.0s 才复位）。
  · **修法**：面板开着时 ⌨ 改走 `closePanel("restore")`（与 × / 点正文同一条路：关面板 + 放回输入法），并删掉已无人调用的 `dismissKeyboard`。
  · **修复后实测**：点 ⌨ 后 **0.3s 内**即 `ih 530（键盘回来）/ --kb-offset 0 / inputmode null / 面板无`，工具栏回到键盘上方，1.2s / 3.0s 保持稳定 ⇒ **无空白**。
  · **三套装置复跑全绿**：`keyboard-toggle.mjs` ALL PASS · `insert-panel-geometry.mjs` ALL PASS（G1–G8）· `edit-surface-invariants.mjs` ALL PASS（ch 306 · st 735 · firstY −642 · caret 363 < tb 474，开/关面板 resize 各 1 次）。
  · 护栏 `dockPanelFocusGuard.test.ts`：该分支断言为 `closePanel("restore")`，并断言仓内**不再有** `dismissKeyboard`（防止"只收不还"的路子回来）。
  · 契约回填 `LAKEX-CONTRACT.md` §5.38.1 第 3 条；门禁：tsc ✓ · vitest **255 文件 / 1980 例** ✓ · 双端构建 ✓ · ui-metrics ✓ · `check:core` 78-0 ✓ · `check:mobileui` ✓ · `git diff --check` clean。
- **261015 九改（用户点单：移动端小记加**创建时间排序**）**：排序面板从 2 档扩到 **4 档** —— 最近更新 / 最早更新 / **最新创建 / 最早创建**。
  · **字段必须一路带上来**：`quickNotesRepository.listQuickNotes` 的 SELECT + `QuickNoteListItem` 加 `created_at/createdAt`；
    `bridge.listQuickNotes` 返回类型同步；`MobileApp` 的 state 改用 `HomePage` 导出的 `MobileQuickNote`（**原先这里另写了一份内联类型** ⇒ 加字段时漏改、tsc 当场抓到 —— 这类"同一条链两份类型"是再次踩的坑）。
  · `HomePage`：`QuickSort` 四值 + `isCreatedSort/isDescSort` 两个纯函数；排序键按当前档取 `createdAt` 或 `updatedAt`。
  · **卡片日期跟随排序口径**：按创建时间排序时显示**创建时间**（否则"按创建排 + 显示更新时间"看起来像没排序）。这是本批唯一超出字面要求的一处，用户可否决。
  · 设备实测（emulator-5554）：面板 4 档文案正确；`最新创建` ⇒ DOM 顺序 = createdAt 降序、`最早创建` ⇒ 升序，**与 `listQuickNotes()` 数据逐条一致**（9 条样本）；卡片日期同步显示创建时间。
  · 门禁（本批文件）：tsc ✓ · 定向 vitest 6 文件 / 48 例 ✓ · 双端构建 ✓ · ui-metrics ✓ · `check:core` 78-0 ✓ · `check:mobileui` ✓ · `git diff --check` clean。
  · ⚠️ **全库那 1 个失败不属于本批**：`src/mobile/notebook/workspaceMenu.test.ts` 断言 `NotebookWorkspace.tsx` 里的 `mb-tree-icon … {nbIcon ? nbIcon : <Book size={16}/>}`，
    而**并行会话**正在做移动端图标选择器（新增 `src/mobile/ui/NodeIconPicker*.tsx`、`nodeIcon.css`，改了 `NotebookWorkspace.tsx / NotebookGrid.tsx / CreateNotebookSheet.tsx / theme/tokens.css`）⇒ 那段 markup 已被他们替换。
    我**未触碰**这些文件；提交/验收时请把两批分开。
- **261015 十改（用户点单：排序偏好**持久化** + **桌面与移动统一**，都只存本机）**：
  · **单一来源**：新增 `src/core/quickNoteSort.ts`（四档类型 / 菜单文案 / 比较器 / 旧值归一 —— **纯逻辑、不碰 DOM**）
    + `src/lib/quickNoteSortPref.ts`（本机读写，两端共用同一个键 `lake-notes-v3.quick-notes-sort`）。
    ⚠️ 第一版把 `localStorage` 写进了 core，被 `npm run check:core`（core 禁 DOM/electron/node）**当场拦下** —— 分层规矩的用处正在于此。
  · **桌面**：`QuickNotesWorkspace` 删掉自己那份 `QuickSort`/`SORT_KEY`/`readSortPref`/`writeSortPref`，菜单改由 `QUICK_NOTE_SORT_OPTIONS` 渲染（**2 档 → 4 档**）；
    **置顶优先级保留**（先置顶、组内沿用所选排序，用 filter 保序）；列表行时间戳跟随排序口径（`quickNoteSortTime`）；排序按钮 title 由档位文案派生。
  · **移动**：`HomePage` 同样改用共享模块（`useState(() => readQuickNoteSort())` + 选中即 `writeQuickNoteSort`），卡片日期同口径。
  · **旧值迁移**：桌面 260915 起存的 `updated`/`created` 读到时映射为 `recent`/`createdNew`（都曾按降序）⇒ 用户既有偏好不丢。
  · **实机验证**：
    - **移动**（emulator-5554）：面板 4 档 ✓；选「最早创建」⇒ 落盘 `createdOld`、卡片按 createdAt 升序；
      **`am force-stop` + 重启后仍是 `createdOld`**，顺序与面板「当前」标记都保持 ✓。
    - **桌面**（隔离 userData + `lake://app` + CDP 9235，⌘2 切小记）：菜单 4 档 ✓；选「最早创建」⇒ 落盘 `createdOld`、按钮 title 变「排序：最早创建」；
      `Page.reload` 后偏好保持、菜单勾选在「最早创建」✓。实例已按 CDP 端口精确 kill、临时 userData 已删。
  · **文档/护栏**：`docs/STORAGE-LAYERS.md` §5 的 L3 localStorage 清单**补登**该键（桌面其实早就在用却**漏登记** —— 正是该文档要防的漂移）；
    新增 `src/core/quickNoteSort.test.ts` **10 例**（四档语义 / 不改入参 / 旧值迁移 / 写读往返 / **两端源码级护栏**：都必须 import 共享模块、且不得再出现那个键字面量）。
  · 门禁：tsc ✓ · vitest **256 文件 / 1995 例** ✓（唯一失败仍是上面那条并行会话的）· 双端构建 ✓ · `check:core` 79-0 ✓ · `check:mobileui` ✓ · `git diff --check` clean。

### 261014(八) · 本会话批次收口（移动端入口重组 / 冷启动 / 装置漏改）· **已推送 origin/master**

- **入口重组（用户逐条点单，全部是"别再搬回去"型契约；长期口径已写进 AGENTS §4「移动端入口分工」）**：
  · 首页：默认进小记；胶囊 = 搜索 · ＋ · AI；顶栏右上 = 排序|视图 + 云同步（上一批）
  · 首页「＋」短按 = 新建面板（六项，无模板/无 OCR）；整块长按上滑 = 速记（上一批）
  · 工作区胶囊 = 文档树 / 标签页 / 大纲 / **切换笔记本**（原「更多」删 —— 编辑在顶栏、新建在抽屉与行内）
  · 工作区菜单里**搜索与设置都删了**（设置 = 首页齿轮；搜索 = 首页胶囊，且是全库范围而非"笔记本内搜索"）
  · 目录抽屉：笔记本行 = **图标 + ＋**（**不放 ⋮**、图标只展示）；每行 = `[⋮][＋]`，行 ⋮ 菜单不变
  · **笔记本编辑入口 = 首页「知识库」长按卡片**（重命名 / 设置图标 / 删除笔记本；**不含**新建文档·新建分组）
  · 长按唯一实现 = `src/mobile/ui/useLongPress.ts`（卡片 10px 取消；目录行 `moveCancelPx:0`）
- **冷启动（上一批，已实测）**：内核退出入口静态图 ⇒ 真首页 **6123 → 533ms**、DCL 3943 → 119ms、modulepreload 45 → 12；
  S3 冷启动同步与内核预热都排到首屏之后；探针 `scripts/mobile-audit/boot-timeline.mjs`（`--no-idle` 做 A/B）
- **本批 code review 的漏改（已补）**：装置里两处仍按旧文案找首页「＋」（`aria-label` 已由「新建小记」→「新建」）⇒
  `scripts/mobile-audit/edit-surface-invariants.mjs` 与 `scripts/mobile-coldopen-breakdown.mjs` 改成"先开新建面板、再点空白小记"；
  顺带核对：目录行 ⋮ 仍在 ＋ 之前（`querySelector(".nb-tree-action")` 拿到的是 ⋮，装置不受影响）
- **同会话桌面批次**：小记写作卡工具条精简为七项（见 §0 261014）；分屏浮动条彻底删除 + 复合标签右键菜单（见 §3#21）
- **门禁**：tsc ✓ · 全库 vitest **254 文件 / 1966 例** ✓ · 两条构建 ✓ · ui-metrics / check:core / check:mobileui ✓；
  设备（专用 AVD lake_gate）：**快照重烤后 6 态整页计算值 0 差异**（本次只有 home-doc 变化：n 1848 → 1876）· **走查 23/23 屏 ok** ✓
- **AGENTS.md 已精简**：64449 → ~29.3KB（-56%，规则零丢失、148 锚点回查），新增 §3#21 门禁分层 / §7.29–31 三条长期坑
### 261014(七) · 移动端冷启动修复：内核退出入口静态图 + 后台工作让位首屏（**已实测**）

- **用户报**："移动端冷启动好像有点慢，是不是先 S3 在加载页面？应该优先加载页面，然后后台再做 S3。"
- **排查（设备实测，AVD 5556 + CDP 探针）**：S3 **并没有**挡首屏（`bridge.init` 只开本地库；整轮同步本来就在 ready 之后）；
  真凶是**入口静态图里有内核**：`HomePage → QuickNotePreview → QuickNoteKernelPreview → lakeRuntime(6.1MB)` ⇒
  `dist-mobile/index.html` 挂了 **45 条 modulepreload**（含 1.25MB 内核 CSS），冷启动先拉+解析整个内核。
  时间线（改前）：DCL **3943** / 入口长任务 **1821ms** / first-paint 4224 / FCP 6356 / 桥就绪 5891 / **真首页 6123ms**。
- **改法三条**：① `QuickNoteKernelPreview` 改 `lazy()`+Suspense（并自带内核样式，守 §7.23）；
  ② 冷启动那次整轮同步：ready 后**第一段空闲**再发（idle, 兜底 2s）；③ 内核预热：ready **4s 后**再排空闲（原来 idle timeout=3000 实测 2.4s 就砸下来）。
- **改后实测**：DCL **119ms** / FCP **556** / 桥就绪 **478** / **真首页 533ms**（≈11.5×）、modulepreload **45 → 12**；
  前 7.3s **无长任务**，预热在 7296ms 以 1903ms 的背景任务出现（A/B：把 requestIdleCallback 变空 ⇒ 长任务消失、首页 798ms，确认它就是预热）。
- **护栏**：`quickNoteKernelFallback.test.ts` 新增 1 例（内核兜底必须 lazy + 自带内核样式）；AGENTS §7.31 记长期口径。
- **探针已入库**：`node scripts/mobile-audit/boot-timeline.mjs 9336`（`--no-idle` 做 A/B）；量的是 navigation/paint/longtask + 骨架/桥就绪/真首页三个里程碑。
- **未做/可选项**：想彻底关预热就删掉那段排期（代价 = 首次开文档/小记多付"内核分包加载+实例化"）；真机数据待补（本机是 AVD）。
### 261014(六) · 首页改版：默认小记 / 胶囊重排 / 统一「＋」+ 新建面板 / 长按上滑速记（**待用户验收**）

- **用户点单（四条）**：① 打开默认进**小记** tab；② 底部胶囊里**云同步恒定在最右**，小记的排序 / 知识库的视图**顺势放到云同步左侧**（原本在顶栏右上角）；③ 底部那个「＋」做成**统一加号**，点击后出**新建面板**（新建小记 / 新建文档知识库），**长按上滑快速记小记**（照语雀 App 手感，用户给了录屏）；④ 明确**不做模板**；OCR 识图**有能力才做**；新建文档**要选笔记本**。
- **OCR 结论 = 不做（没有能力）**：`src/**` 里 `ocr` **零命中**；Android 原生只有 9 个插件（AssetServer / AssetSync / OpenFile / PinShortcut / SecureStore / SharedContent / ShowKeyboard / AwsV4Signer / MainActivity，**无相机与 OCR View**）；Capacitor 只装了 sqlite / app / filesystem；**移动端没有任何 AI 通道**（`electron/ai/*` 是桌面主进程的）。⇒ 按用户口径「没有就不做」，面板里**没有 OCR 格**。
- **落地**：
  · 默认 tab：`MobileApp` 初始 route `library` → **`quick`**（快捷 capture 那条本来就落小记）。
  · 布局（用户 261014 两轮定稿）：**顶栏右上角固定挂两枚图标 = 排序（小记）/ 视图（知识库）+ 云同步**（云同步恒在最右、不随 tab 变），左上补一格等宽空槽 `.mobile-topbar-gap` 让 tab 仍居中；**底部胶囊 = 搜索 | ＋ | AI**（排序/视图与云同步都**不在**胶囊里）。
  · 「＋」= 统一 `Plus`（不再按 tab 换成「新建知识库」的 FolderPlus）；`src/mobile/ui/CreateSheet.tsx` = 新建面板（两组六项，表面复用 `.mb-sheet`，**不新造弹层**）。
  · 动作分派（唯一来源 `HomePage.runCreateAction`）：空白小记 → 开写作卡；拍摄/图片 → `ui/pickFile.ts` 取文件 → composer `initialInsert.files` → **内核 `insertFiles`**（与 dock 同一条插入通道）；待办 → `initialInsert.command="taskList"`（内核命令，**不手拼正文**）；空白文档 → **只列已有笔记本**（用户定）再建并进编辑态；知识库 → 既有 `CreateNotebookSheet`。
  · 长按上滑手势：判定全在纯函数 `src/mobile/ui/createPress.ts`（`CREATE_LONG_PRESS_MS=260` / `CREATE_SLIDE_PX=36` / 轴锁复用 `gestureCore.GESTURE_AXIS_THRESHOLD`）：短按 = 开面板、长按到点浮出「小记」气泡、**上滑过线松手才速记**、浮出后不上滑松手 = **取消**（用户明确"长按容易误触"，所以不做"长按即建"）。CSS 侧 `touch-action:none`（否则上滑被当页面滚动、pointercancel）。
  · AI 位只**占位**（点击如实提示"尚未接入：已立项"）—— 用户定"先加图标，接入方案另行立项"。
- **验收（本地全绿）**：`tsc` ✓ · 全库 vitest **253 文件 / 1958 例**（跳过 5/16）✓ · `vite build -c vite.mobile.config.ts` ✓ · `ui-metrics` ✓（移动端字号字面量 46/49 未涨）· `check:core` ✓ · `check:mobileui` ✓ · `check:bundle` exit 0 ✓ · `git diff --check` ✓。新增护栏：`ui/createPress.test.ts`（5 例，手势边界）+ `home/homeCreateFlow.test.ts`（8 例，源码级：默认 tab / 胶囊顺序与云同步最右 / 顶栏不再挂排序视图 / 面板六项且无 OCR 无模板 / 三条动作通道 / capture 路未被动）。CSS 基线按约定上调并写明理由（mobile.css 1208→**1252**、floating.css 250→**284**）。
  ⚠️ 同批踩坑：测试里的 `code()` 注释剥离器不能用**通用块注释正则** —— 代码里有 `accept="image/*"`，会被它一路吃到下一个 `*/`、静默删掉整段代码，断言随之假失败（与 AGENTS §7.25 探针假阴性同类）。已改成只剥 JSDoc + 整行注释。
- **设备验收（专用 AVD `lake_gate` / emulator-5556 / CDP 9336；装的 APK 就是本次构建）**：
  · 功能实测（CDP 真实输入）：默认落小记 ✓ · **顶栏右上角两枚**（排序/视图 + 云同步，云同步最右）✓ · **胶囊三项**（搜索 / ＋ / AI）✓ ·
    ＋ 短按 → 新建面板六项（无 OCR / 无模板）✓ · 待办 → 内核 `<ne-tli>` 待办列表新小记 ✓ ·
    **长按浮出「小记」气泡（设备截图在案）→ 上滑松手 → 速记写作卡** ✓ · 空白文档 → 只列已有笔记本 ✓ ·
    知识库 → 新建知识库面板 ✓ · 知识库 tab 下第 3 格变「切换到书架 / 切换到列表」且能切视图 ✓。
  · 门禁：重灌夹具（4 小记 / 1 树节点）→ 采暖态 → **重烤 `scripts/mobile-audit/baseline/mobile-snap.json`** → 连跑两次
    **6 态整页计算值 0 差异** ✓；走查 **23/23 屏 ok、五类探针全 0**（escape / clip / contrast / smallTap / pageOverflowX）✓。
- **验收装置同步更新（UI 契约变了，装置必须跟着走单一来源）**：
  · `scripts/mobile-audit/mobile-snap.mjs`：`clickText` 改**真实点按**（＋ 走 pointerdown/up，`el.click()` 对它无效）；
    两个知识库态与 `home-doc` **自己切回「知识库」tab**（默认 tab 已改成小记，原来靠"默认恰好是知识库"）；
    「切换到列表」改从**胶囊**取（`.mobile-bottom-bar__item`）。
  · `scripts/css-audit/mobile-walkthrough.mjs`：视图切换按钮同理改胶囊；`quicknote-editor` 屏改走 **＋ → 空白小记**（短按 = 新建面板）；
    `goHome()` 把**写作卡开着**也算"未在首页"并可直接点「取消」退出 —— 否则该屏留下的写作卡让下一屏找不到笔记本入口。
- **本轮装置/环境坑**：`adb shell input tap / swipe` 在本机模拟器上对**两个 App（本应用与语雀）都不生效**（`keyevent` 正常）
  ⇒ 设备级点按一律走 CDP `Input.dispatchMouseEvent` / `Input.dispatchTouchEvent`（长按上滑必须用 touch 事件才验得出）。
- **布局第二轮（用户 261014 用标注截图纠正）**：上一版把「排序/视图 + 云同步」放进了胶囊（把"右上角"误读成胶囊最右端）⇒ 已改回**顶栏右上角两枚图标**、胶囊压到三项；
  骨架同步改成"左 2 槽（设置 + 空槽）/ tab / 右 2 槽"；装置也回到从顶栏取视图按钮。改完重烤基线并复跑：**6 态 0 差异**、走查 **23/23 ok · 探针全 0**。
- **门禁跑法口径（用户 261014 明确："不用每次小改动都跑门禁"）**：日常改动只跑 HANDOFF §6 的前 5 条（tsc / vitest / 两条 build / ui-metrics 等，≈20s）；
  **设备门禁只在"动了移动端外壳/布局/手势"时才跑**，且优先**只跑受影响的那几个态/屏**（`check-mobile-snap.mjs --states a,b`、走查第三参传屏名列表），
  不必 6 态 + 23 屏全量；**但一旦动了外壳几何，必须重烤基线**（否则下次全量门禁必红）。
- **第三轮（用户 261014：要语雀那种"整块触发"）**：速记手势从「只挂 ＋ 按钮 + 上方气泡」改成**挂在整条胶囊上** ——
  按住**任意处** ≈260ms，条目淡出、**整块**变成强调色的「小记」（`.mobile-block-quick` 常挂载，靠 `.is-revealed/.is-armed` 过渡）；
  没长按到点 = **pass**（条目自己的 onClick 照常，短按语义不变）；上滑过线松手 = 速记，不上滑 = 取消。
  踩到并已记进 **AGENTS §7.30**：容器上 `setPointerCapture` 会把随后的 click 重定向到容器 ⇒ 子按钮 onClick 全失效（"点 ＋ 没反应"），
  改成 window 级 move/up/cancel 监听 + 长按后吞掉那次 click。
  设备实测：短按 ＋ → 面板 **6 项** ✓ · 短按 搜索 → 搜索面板 ✓（整块手势不吃条目点击）· **按住胶囊中部（非 ＋）→ 整块变「小记」（截图在案）** ·
  **按住上滑 → 速记写作卡** ✓；重烤基线后门禁 **0 差异**、走查 **23/23 ok**。
- **胶囊收窄（用户 261014 追加）**：只剩 3 项 ⇒ 首页那条宽度上限 6 槽 288 → **4 槽（设备实测 192×56、每项 64px，对齐语雀 App 紧凑度）**；
  第二层工作区那条（4 项）**不跟着缩**（变体类 `.mobile-bottom-bar--home` 只落在首页）；冷启动骨架同步带该类 ⇒ 数据到达不跳。
  重烤基线后门禁单跑 **6 态 0 差异**、移动端 235 例测试全绿。
- **状态：已提交 `1f44d4d` 并推送 origin/master**（用户 261014 授权"全部提交"；本次一并入库的还有其它会话残留的在途批次 ——
  桌面 stylesnap 装置与样式层、AI 助手进度、Sidebar / quickNotes 等）。提交前跑过完整本地门禁：tsc ✓ · vitest **253 文件 / 1958 例** ✓ ·
  桌面与移动两条构建 ✓ · ui-metrics ✓ · check:core ✓ · check:mobileui ✓ · check:bundle ✓ · git diff --check ✓。
- **未做 / 待验收**：拍摄·图片的系统选择器只做了代码级核对（真机相册/相机路径没在模拟器上走完）；
  "格子配色要不要照语雀上多色"与 AI 位的最终形态待用户验收。
### 261014(五) · 「Aa」面板颜色两行**解耦**（用户报「文字色与背景色串联」）

- **用户报**：工具栏「Aa」里的颜色两行 —— 第一行（A 排）是文字颜色、第二行（色板）是背景颜色，「这俩不冲突也没有关联，现在好像串联到一起去了」。
- **实测确认（设备逐步骤）**：两行确实**共用同一个 `colorVariant` 变体状态**：变体=文字色时色板回显的是**字色** ⇒ 点一下 A 排的红色，色板也跟着标红（就是用户看到的「串联」）；A 排的回显也带 `colorVariant === 'text'` 前置 ⇒ 切到背景色后 A 排整排不再高亮。
  同时确认**功能本身是好的**：点色板浅色格 ⇒ 背景色生效且回显（`ne-text` 带 `background-color` + 该格 `is-on`），后续打字继承 ✓。
- **改法（按用户定义：两行各自独立）**：A 排 = 文字色（只按 `activeValues.color` 回显、点选走 `pickColor(c, "text")`，并**删掉末位那个「背景色入口」按钮** —— 它就是切换变体的开关、耦合源）；色板 = 背景色（只按 `activeValues.bgColor` 回显、点选走 `pickColor(hex, "bg")`、首格=无填充）；`colorVariant` 状态整个删除，`pickColor` 的 variant 改为**必填**。
- **护栏**：新增 `src/mobile/editor/dockColorRows.test.ts`（5 例：无共享变体 / 两行各自的内核值与变体 / `pickColor` variant 必填；断言前先去注释 —— 文件里保留了「当年为什么错」的说明）。
- **设备复核**：点 A 排第 3 个（文字色红）⇒ **只有 A 排亮、色板保持「无填充」**；点色板浅色格 ⇒ 只有该格标亮、A 排不动 ✓。
- **顺带观测（用户 261014 定：滚动是正常的，保持现排布）**：「Aa」面板内容实测 **417px > 面板 311px** ⇒ 末两行（色板第二行、字号行）要在面板内滚动才看得到 —— 这是**预期行为，不改**。
- **状态：已提交** `2b91398`（并已推送 origin/master）。
### 261014(四) · P1 重构：编辑面算术抽成纯函数（本批移动端已提交 `fed89e3`）

- **已提交**：移动端那批（编辑体验/表情面板/装置/文档）作为一个提交 `fed89e3` 落 master；**提交态自洽已验**（临时 worktree 按提交内容跑 `tsc` ✓ + `vitest` 242 文件 / 1882 例 ✓）。
  未含（仍留工作树，属其他会话/批次）：`Sidebar.tsx`+`App.tsx`+`scripts/packaged-performance/`（大目录优化）· `src/features/ai/**` 与桌面样式/装置（`styles/{chrome,components,overlay,app/misc,app/quick-notes,kernel-theme,cssLayers,geometrySources}`、`scripts/css-audit/{stylesnap,check-stylesnap,README,baseline/stylesnap}`）· 桌面表情面板那一半 · 多维表 PoC。

- **P1 落地**：新增 `src/mobile/editor/editSurfaceModel.ts`（纯函数、无 React/DOM）+ `editSurfaceModel.test.ts`（**9 例**）：
  `bottomOccupation`（面板/键盘互斥占用，含收起过渡）· `shellSurfaceHeight`（外壳高 = 稳定高 − 占用 ⇒ 键盘态与面板态**相等**）·
  `dockKbOffset`（工具栏底距，含「过渡期跟着视口长、屏幕 Y 恒定」的机制）· `capturePanelHeight`（打开瞬间捕获 + 下限）。
  `EditorDock` 里那四处内联算术改为调用它们（行为不变，已用设备时间线/逐步骤复跑核对）。
  **为什么值得**：这四条迁移正是过去反复出 bug 的地方（跳动/塌陷/工具栏掉底/面板自关），现在进 CI —— 不再只能靠设备上人眼看 GIF。
- **下一步**：P0 设备不变量脚本（编辑面 4 条不变量，作为 P2 的验收闸）→ P2 `useEditSurface` 收口 + 内核几何归一化单点 → P3 拆 EditorDock 大文件。
- **P0 装置（已落地）**：`scripts/mobile-audit/edit-surface-invariants.mjs` —— 把这次手写的设备检查固化成**可执行不变量**，两条编辑器（小记 / 文档）各跑一遍：
  **I1 几何恒定**（键盘/面板/收回三态的 kernCh·kernSt·firstY 逐项相同）· **I2 光标存在**（面板态 activeElement 仍是正文、选区在、inputmode=none）·
  **I3 光标在工具栏上方**（caret.bottom < tb.top）· **I4 不自关/无闪**（点＋后 1.2s 面板仍在；每次开/关 resize ≤1）。
  用法：`node scripts/css-audit/drive.mjs <port> scripts/mobile-audit/edit-surface-invariants.mjs`。
  ⚠️ 装置自身的坑（已修）：驱动脚本的场景参数在 `ctx.args`，我一开始读 `process.argv[3]`（= 脚本路径）⇒ 两个场景都没跑却打印 ALL PASS（**假绿**）；现在未选中场景直接 exit 2，且逐条打印取样值（看得见才可信）。
- **P1 纯函数模型**：`src/mobile/editor/editSurfaceModel.ts` + `editSurfaceModel.test.ts`（**9 例**）：`bottomOccupation` / `shellSurfaceHeight`（键盘态与面板态算出同一个外壳高）/ `dockKbOffset`（过渡期屏幕 Y 恒定）/ `capturePanelHeight`。
- **P2 收口**：`src/mobile/editor/useEditSurface.ts` 成为**编辑面唯一 owner**（外壳高度 + 面板状态机 + 输入法抑制 + 焦点守卫）；内核几何归一化**合成一份** `src/mobile/editor/edit-surface-kernel.css`（doc/note 共用 `data-mb-edit-host` + `data-mb-kernel` 契约，原先散在 mobile.css / quick-notes.css 两处 ⇒ 内核升级时不会只补一边；`mobileLayers` 已登记新文件）。
- **P3 拆大文件**：`EditorDock.tsx` **768 → 616 行**（面板状态机与输入法/焦点策略全部移出），dock 只剩渲染 + 命令 + 选区簿记。
- **验证（P0–P3 全量）**：`tsc` ✓ · `vitest` **250 文件（245 过/5 跳）· 1927 例（1911 过/16 跳）** ✓ · 两条构建 ✓ · `ui-metrics`/`check:core`/`check:mobileui`/`check:bundle`/`git diff --check` ✓；
  **设备不变量 ALL PASS**（两条编辑器；数字与重构前逐项一致：小记 ch 306·st 735·firstY −642；文档 ch 719·st 0·caret 417–438 < 474）· 设备 `check:mobilesnap` 6 态 0 差异 ✓ · 走查 23/23 · 五类探针全 0 ✓。
- **状态：已提交** `d52ddd5`（P0–P3 一次落 master；移动端那批在 `fed89e3`）。**已推送 origin/master**。

### 261014(三) · 点 ＋ 后**光标消失** / 点正文**键盘闪烁** / 面板**自己关掉**（用户点单，**待用户验收**）

- **用户报**：① 点 ＋ 之后编辑区**光标消失**；② 再点一下编辑区会**键盘闪烁**；③ 文档偶发"光标跑到下半部分被键盘盖住"；小记与文档都有。
- **根因（设备逐帧 + 状态时间线实测，三条）**：
  ① 收输入法用的是 `blur()` ⇒ **焦点与光标一起没了**（"光标消失"）；要打字得再聚焦一次 ⇒ 表现为闪烁；
  ② 判断"用户点了正文"用的是**一个布尔量**：它会被上一次点击留下 `true`，再被**我们自己**抑制输入法时的 blur/focus 触发
     ⇒ 误判成用户点击 ⇒ **面板开了 ~630ms 自己关掉**（时间线实测：`mode=insert/panels=1` 只维持 630ms 就回 `none/0`）；
  ③ 顺带发现我自己那轮的漏洞：抑制输入法用 blur+focus 会**同步触发 focusin**，focusin 分支又调抑制 ⇒ **无限递归**风险。
- **改法（全部收口在 `EditorDock`）**：
  · 收输入法 = `setbackIme(true)`：给正文宿主加 `inputmode="none"` 再 `blur() → focus()` ⇒
    **键盘收起但焦点/选区/光标矩形逐项保留**（实测 530→842、activeElement 仍是 `.ne-engine`、光标 [130,148] 不变）；
  · 放回输入法 = `setbackIme(false)`；`setbackIme` 内部有重入保护 `inSetback`；
  · "用户点正文"判据从 focusin **挪到 pointerdown**（面板期正文一直有焦点、点它不再触发 focusin）+ 只用当次事件；
  · focusin 分支**只写 `inputmode`、绝不 blur、也不再调 setbackIme**；
  · 收面板收敛成 `closePanel()` **唯一出口**（× / 再点 ＋ / 点正文三处共用：先 `setPanel(null)` 再 `focusEditor()`）；
  · ⌨ 按钮（收键盘）同样**保留光标**。
- **设备实测（逐步骤，两处编辑器）**：
  · **小记**：键盘开 530/光标[130,148] → **点＋** 842/inputmode=none/**面板 insert**/**光标[130,148]** →
    **再点＋** 530/**键盘回来**/光标[130,148] → 切表情 → **插一个表情（面板不塌、光标仍 [130,148]）** → 点正文 530/面板关/光标[97,114]（内容变但没消失）。
  · **文档**（18 行长文）：530/光标[388,410]/工具栏 474 → **点＋ 842/光标[388,410] 不变、仍在工具栏上方** →
    关闭同样不变 → 点正文下半部 光标[353,374] **仍在工具栏上方（不再被盖）**。
  · 面板时间线：点 ＋ 后 **37ms 就位并保持**（改前 630ms 后自关）。
- **护栏**：`dockPanelFocusGuard.test.ts` 重写为 **7 例**（hook 顺序 / 输入法抑制含重入保护 / 光标保留口径 / 面板唯一收口 / setPanel 唯一写入口）；
  原先单独的 `dockHookOrder.test.ts` **并入**该文件（避免两份读同一源）。
- **验证**：`tsc` ✓ · `vitest` **249 文件（244 过/5 跳）· 1916 例（1900 过/16 跳）** ✓ · 两条构建 ✓ ·
  `ui-metrics` ✓ · `check:core` ✓ · `check:mobileui` ✓ · `check:bundle` ✓ · `git diff --check` ✓ ·
  设备 `check:mobilesnap` **6 态 0 差异** ✓ · 走查 **23/23 ok · 五类探针全 0** ✓。
- **口径回填**：`docs/LAKEX-CONTRACT.md` **§5.38**（inputmode=none 收键盘保光标的实测表 + 三条坑：blur 丢光标 / 布尔量误判导致面板自关 / 抑制函数必须防重入）。
- **状态：已提交**（`fed89e3`，只含移动端那批；桌面/多维表会话的改动未含）。

### 261014 · 移动端编辑体验：点 ＋/× 编辑区跳动 + 光标必须始终在工具栏上方（用户点单，**待用户验收**）

- **用户点单**（两条，实为同一根因）：① 点 dock 的 **＋/×** 时**小记与文档的编辑区都会跳**；② **光标必须稳定保持在工具栏上方**、
  不被工具栏/键盘盖住（对标语雀 App：它的正文区域在「键盘 ⇄ 面板」切换时一动不动）。
- **根因（四条，逐条设备实测）**：
  ① **面板不让视口变矮**（adjustResize 只被输入法触发：842→530）⇒ 任何**以视口高为基准**的盒子在切换时都变形（实测写作卡 320→428）。
  ② 小记页容器链是**自动高度**：`.mobile-home` 根本没规则 ⇒ 里面的 `.mobile-tab-stage/.mobile-scroll`（都是 flex:1）退化成
     "内容多高就多高、永远不滚"（实测 scroller `scrollHeight == clientHeight`）⇒ **文字一多光标一路跑出屏幕**（实测跑到 y=1080）。
  ③ 内核 note 版式给引擎写了 **`min-height: 40vh`**（vendor `lakex-doc.css:6205`）——40vh **跟视口走**（输入法态 212 / 面板态 337）。
  ④ 收起面板时**太早清占位**（固定 220ms）⇒ 键盘还没上来，工具栏掉到屏幕底部再弹回（实测 `toolbarTop 474 → 786 → 474`）。
- **修法（都是单一来源、无新机制）**：
  · **稳定外壳高** = 新模块 `src/mobile/hooks/viewportShell.ts`（单调取历史最大值 = 键盘收起时的高；方向变化重置）；
  · `useKeyboard` 的 `base` 改用它（跨实例共享，避开 keep-alive 隐藏实例 / 挂载时键盘正开着的时序坑）；
  · `EditorDock` 用 **`useLayoutEffect`** 把 `--mb-app-h = 稳定高 − 底部占用`（面板高 或 键盘高）写到 `:root`，
    `html, body, #root, .mobile-app` 都用它（**必须 layout effect**：写在 paint 之后，vh 系的内核规则会先按旧视口算一次并被内容撑住）；
  · 编辑面滚动容器**只留工具栏的固定留白（80px）**，删掉 padding 里的 `--mobile-dock-space`（占位改由外壳承担）；
  · `.mobile-home` 补 `flex:1; min-height:0; display:flex; flex-direction:column`（与 `.mobile-workspace` 同口径）；
  · 小记写作卡改**定高（`height:100%`）+ 内部滚动**（与 `.mobile-doc-body` 同口径）；
  · 收起面板改为**等输入法真的回来**（`keyboardOpen`）再清占位，兜底 2500ms；
  · 小记接上**文档那份** `useCaretIntoView`，并给它加 `resize` 复核（浏览器自己的"把光标滚进视口"是按**视口**算的，
    面板一开它会停在被面板盖住的位置，实测 y=585）。
- **设备实测（前后对比，AVD lake_mobile）**：
  · **小记（短内容）**：写作卡 **320→428（跳）⇒ 恒 398**；连续输入 680 字符时**光标最小间距从 −624（5 次被盖）⇒ +111px、0 次被盖**；工具栏全程恒 474。
  · **小记（长内容 = 用户点出的关键场景）**：真正滚动的内核滚动口 `.ne-editor-wrap-content` 的
    `clientHeight` 原为 **260（键盘态）⇄ 572（面板态）**、`scrollTop 1264 → 978`、**正文首块位移 285px**；
    钉住容器链 + 解除内核按视口写的 `max-height` 后，**键盘态 / 面板态 / 收回态三者
    `clientHeight=306 / scrollTop=1218 / engTop=-1141 / firstBlockY=-1125` 逐项完全相同 ⇒ 位移 0**。
  · **文档**：连续输入 **98 行**，光标恒 **417–438**、工具栏恒 **474**（间距 36px、0 次被盖）；点 ＋/× 全程 **0 位移**。
  · ⚠️ 中途踩到并已修的坑：① 我又给 `.quick-note-editor` 加了第二个滚动容器 ⇒ 两层滚动打架（外层 st 0→239、sh 318→584），已撤；
    ② `interactive-widget=resizes-visual` 在本 App **无效**（Capacitor 的 adjustResize 在原生层就改了窗口尺寸，实测 ih 仍 530）——
    这条记在这里，别再当抓手。
- **顺带修掉一个我自己引入的真崩溃**：为"等键盘回来再清占位"把三个 hook 写到了 `if (!editing) return null;` **之后** ⇒
  文档**从阅读态切编辑态**时 React 抛 "Rendered more hooks than during the previous render" ⇒ 整块面板崩、**dock 永不出现**
  （小记那条路 editing 恒 true，所以只有文档炸）。已挪回早退之前；护栏见下（**已并入 `dockPanelFocusGuard.test.ts`**，不再单独一个文件）。
- **护栏**：`viewportShell.test.ts`（外壳高单调/重置）· `dockPanelFocusGuard.test.ts`（**7 例**：hook 顺序 / 输入法抑制 / 光标保留 / 面板唯一收口 / setPanel 唯一写入口）。
- **验证**：`tsc` ✓ · `vitest` **250 文件（245 过 / 5 跳）· 1917 例** ✓ · 两条构建 ✓ · `ui-metrics` ✓ · `check:core` ✓ · `check:mobileui` ✓ ·
  `check:bundle` ✓ · `git diff --check` ✓ · 设备走查 **23/23 ok · 五类探针全 0** ✓（含 `quicknote-editor` 屏）· 设备 `check:mobilesnap` **6 态 0 差异** ✓（**基线已按本次有意的几何变更重烤**：`.mobile-home` 由
  "自动高度"改成受约束的 flex 列 ⇒ 5/6 态**元素数不变、指纹变**＝纯计算值变化；重烤后连跑两次 0 差异）· 设备走查 **23/23 ok · 五类探针全 0** ✓。
- **口径回填**：`docs/LAKEX-CONTRACT.md` **§5.37**（内核 `min-height:40vh` 的机制与收口 + 一般化教训："内核按 vh 写的定高在移动端要换基准"）·
  `docs/MOBILE-TECH-STACK.md` **§五-7**（三条口径：稳定外壳高 / 滚动容器只留工具栏留白 / vh 定高换基准；光标跟随统一走 `useCaretIntoView`）。
- **快捷入口那条路也验了**（长按桌面图标「小记」深链 `lakenotes://quick-note`，走的是另一个容器 `.mobile-qn-composer-wrap`）：
  键盘态/面板态/收回态**逐项完全相同**（appH 530 / wrap 530 / 卡片 442 / 内核滚动口 ch 350 · st 521 / 首块 Y −472 / 工具栏 474 / 光标 346–363）。
- **本轮查漏补缺（用户 261014 要求）**：① 撤掉无效的 `interactive-widget=resizes-visual`（Capacitor 的 adjustResize 在原生层就改窗口，实测无效 ⇒ 不留无效改动，结论留在 LAKEX-CONTRACT §5.37）；
  ② 修掉**首帧风险**：`useKeyboard` 的 `base` 初值原本是 0，而写 `--mb-app-h` 的是 `useLayoutEffect`（比测量更早跑）⇒ 挂载首帧外壳会变 0px；改为初值取当前视口高 + 写前判空；
  ③ 删死 CSS `.mb-emoji-search input`（261013 去掉搜索入口后的残留，JSX 已无该元素）；
  ④ 陈旧文案（"9 个分类 ≈45.8px"）与基线注释同步到"一屏 8 格 + 横滑"；
  ⑤ hook 顺序护栏扩到 `QuickNoteComposer`（同一批也在那里加了 hook）；
  ⑥ `max-height: none !important` 收窄到真正需要的那个元素（`.ne-editor-wrap-content`）。
- **已知未做**：横竖屏只做了"重置外壳高"，没有横屏专门验收（D 项，用户定：留待办）。
- **状态：已提交**（`fed89e3`，只含移动端那批；桌面/多维表会话的改动未含）。

### 261014 · 表情面板分类条：末尾动作键（返回 / 清除）+ 行高压缩（用户点单，**待用户验收**）

- **用户点单**：分类条末尾加一个键 —— 小记/文档**输入态 = 返回**（退出表情选择）；**目录/选图标 = 清除**（去掉图标）；并把分类这一行再压一压。
- **落地（单一来源 = `mobile/ui/EmojiPanel.tsx`）**：新增 `onBack`；分类条末尾渲染 `.mb-emoji-cat--action`
  （输入态 = ChevronLeft「返回」→ `EditorDock` 传 `togglePanel("insert")` 回「＋」面板；选图标态 = Ban「清除图标」→ 原 `onClear`）。
  **「最近」首格那块清除格随之撤掉**（同一动作只留一个入口）；两处 `onClear` 调用点（工作区「设置图标」/ 新建知识库）零改动。
- **形态（261014 二次定稿，用户：一行 10 个可点目标太多）**：**一屏 8 格 + 横滑**（对标微信，它的表情行也是 8 个）。
  每格固定 **--mb-tap-min(44)** ⇒ `9 格 × 44 = 396 > 轨道 368` ⇒ 8 格整屏 + 第 9 格露 28px 提示可滑；
  **末尾动作键钉在轨道右侧、不参与滚动**（返回/清除必须永远够得着）。横滑安全性靠面板根既有的 `data-prevent-swipe`
  （外壳 `useHorizontalSwipe`/`usePanelDrag` 本就排除它，261013 约定，未新造机制）。
  另：`--mb-emoji-cat-h: 36`（视觉 44 → 36）、`--mb-emoji-cat-size: 24 → 22`；命中区只差高度 ⇒ 注册表 ::after 竖向补到 44，
  **不再有横向重叠**（先前的"10 格挤一屏"方案已废弃）。口径已登记进 `MOBILE-DESIGN.md`「The 44 Rule」。
- **装置补一屏**：走查新增 `notebook-icon-sheet`（目录行 ⋯ →「设置图标」）—— 这一屏**此前 22 屏从未覆盖**，
  而本次恰好改在它上面（判据＝探针看不见就等于没量过）。
- **设备实测（5554 新构建）**：轨道 **368 宽 / scrollWidth 396 / 每格 44×36 / 整屏 8 格 / smallTap 0**；
  **真手指横滑**（CDP touch 序列）⇒ `scrollLeft 0 → 28`、**外壳左右抽屉都没被触发**（`side-panel--left.on` 与大纲均 false）、动作键仍钉在 x=368..412；
  滑到底后点最后一个分类「符号」⇒ 选中成功（可达）。点「返回」⇒ `data-panel` emoji→insert、＋面板回来；再插表情仍 **0 次 resize**、面板恒 312（不闪）。
  选图标 sheet：同构（行 376 ⇒ 8 格 + 钉住的「清除图标」）；先选 👕（图标生效、面板关）→ 重开点「清除图标」→ 图标清空（回 Book 图标）、面板关；
  **全程未创建任何数据**（最后直接关 sheet）。
- **验证（全绿）**：`tsc` ✓ · `vitest` **248 文件（243 过 / 5 跳）· 1913 例（1897 过 / 16 跳）** ✓
  （另记一笔：设备门禁并发跑时 `syncEngine.test.ts` 的 D8 曾因机器负载 **5s 超时**，空闲单跑 63 例全过 —— 别误判成回归）·
  两条构建 ✓ · `ui-metrics` ✓（移动端字号字面量 47 ≤ 49）· `check:core` ✓ · `check:mobileui` ✓ · `check:bundle` ✓ · `git diff --check` ✓ ·
  设备 `check:mobilesnap` **6 态 0 差异** ✓ · 走查 **23/23 ok · 五类探针全 0** ✓（门禁夹具仍 5 文档 + 4 小记，无需重烤）。
- **账本**：`theme/tokens.css` 170 → **171**（+`--mb-emoji-cat-h`）、`kit.css` 509 → **511**（+`.mb-emoji-cats__track` −首格清除格；理由写进 `mobileLayers.test.ts`）；
  移动端字号字面量仍 47。
- **状态：已提交**（`fed89e3`，只含移动端那批；桌面/多维表会话的改动未含）。

### 261014 · 安卓端「插入表情时表情栏闪烁」修复（用户报 → 设备实测 → 已修，**待用户验收**）

- **用户报**：安卓端插入表情，表情栏会闪烁，"体验非常的差"（GIF：每次点表情 = 面板消失 + 输入法闪出 + 面板滑回）。
- **根因（AVD lake_mobile 事件日志实测，非猜测）**：内核在每条面板命令后**抢回正文焦点**（一次点按 2–3 次 `focusin`）⇒
  Android 弹输入法（innerHeight 842→530）⇒ 面板高度 `--kb-offset`（= `max(0, innerHeight - base + panelHeight)`）
  从 **312px 塌到 0** ⇒ 面板整块消失再恢复；原兜底（`keyboardOpen` 的 effect）**晚约 1s**（t+1247 才 blur，resize 已发生）。
- **修法（1 处、无新机制）**：`EditorDock` 既有的 focusin 守卫里，**面板开着时对程序性聚焦同步 blur**（面板态 ref 镜射；
  ⚠️ 面板态改为**同步写 ref 且只有 `setPanel` 一个写入口** —— 否则收起面板的 `setPanel(null) → focusEditor()` 同一 tick 会漏判、把键盘又收掉，见 LAKEX-CONTRACT §5.36）。
  落点 `src/mobile/editor/EditorDock.tsx`；**不改** `--kb-offset` 公式（公式是对的，错的是"键盘被弹出"这件事发生了）。
- **修后设备复核**：小记写作卡 —— focusin 每次 5–20ms 被吞、**0 次 resize**、innerHeight 恒 842、panelH 恒 312；
  文档编辑器（自建探针文档，测完已 `trashNote`）—— panelH 恒 280、0 次 resize ⇒ **两处入口都不闪**；
  **顺带复核"收起面板"没被修坏**：点 ＋ 关闭面板后 innerHeight 842 → **530**、焦点回 `ne-engine`、面板 `data-panel=none`（键盘正常回来）。
- **护栏**：`src/mobile/editor/dockPanelFocusGuard.test.ts`（**6 例**；自证：改回旧写法 / 把 `setPanel` 换回裸 `setPanelMode` ⇒ 2 例变红）。
- **验证（全绿）**：`tsc` ✓ · `vitest` **248 文件（243 过 / 5 跳）· 1913 例（1897 过 / 16 跳）** ✓ · 两条构建 ✓ · `ui-metrics` ✓（移动端字号字面量 47 ≤ 49）·
  `check:core` 78 文件 0 违规 ✓ · `check:mobileui` ✓ · `check:bundle` ✓ · `git diff --check` ✓ ·
  设备 `check:mobilesnap` **6 态 0 差异**（新构建 + gate 实例 5556）✓ · 设备走查 **22/22 ok · 五类探针全 0** ✓。
- **数据卫生**：5554 的测量走「新建小记 → 测完取消」；文档路径用 `createNote` 建探针文档、测完 `trashNote`；
  门禁实例（5556）夹具仍为 **5 文档 + 4 小记**（走查未写脏）⇒ **无需重烤基线**。
- **状态：已提交**（`fed89e3`，只含移动端那批；桌面/多维表会话的改动未含）。

### 261013 · 移动端「必要项」批：装置四修 + 目录层失效修复

> 用户点单的落地顺序：**先 §6 必要项 → 再 A**。本批只做 §6；A 未开始，B 不做，D（平板/横屏新布局）留待办。

- **装置四修 —— 三处「静默少测 / 测错」，正是「门禁全绿却漏掉整类问题」的根因**：
  ① **走查 smallTap 探针一直是瞎的**：它要求「无滚动祖先 **且** 原生 button **且** 有文字」——而首页/目录/卡片全在 .mobile-scroll 里、
     行内图标是 span[role=button] ⇒ **该探针从未报出过任何问题**（22 屏全 0）。现改为：inScroll 只约束 escape；smallTap 覆盖全部可点元素；
     **算上 ::after 后的有效命中区**；跳过 disabled；排除内核/第三方（ne- / ant- / lakex- / univer / drawnix）。修好后首次产出 **22 类 / 42 处** <44。
  ② check:mobilesnap 的 **settings-appearance** 选择器停在 .b3-list-item（行早已是 .mb-row.mobile-settings-row）⇒ 与 settings 同屏。
  ③ 同装置 **home-doc** 用 el.click() ⇒ Android WebView 里**不触发导航**，且 .doc-card 只在书架视图存在 ⇒ **该态从未离开首页**
     （元素数与 home-library 完全相同就是铁证）；加上开发库「最近文档」6 张全是 parent_id 为空的探针文档 ⇒ 改走走查里已验证的
     「笔记本 → 目录抽屉 → 文档行」路径。
  ④ 同装置 **home-library-list** 找「切换到列表」，而按钮在列表视图下写的是「切换到书架」⇒ 与 home-library 同屏。
  **⇒ 6 态里原本只有 3 态有效**。现改为**每态钉住书架/列表 + 真实点按 + 到达断言**（到不了就抛错，不再静默沿用上一屏）。
  **基线已按新语义重烤**：6 态 = 1784 / 1840 / 1755 / **2943** / 1862 / 1811（home-doc 1755 → 2943 = **首次真的覆盖到工作区**）；改后复跑 6 态 0 差异。
- **目录层真缺陷（P2–P5 改名留下的）：一批 CSS 仍挂在 .ln-row 上，而 JSX 早已是 .mb-row ⇒ 整组静默失效**：
  **拖拽落点线 · 拖入分组高亮 · 真机 touch-action（拖拽会被 WebView 判给滚动而 touchcancel）· 长按禁选字** 全部不生效；
  另外 .drop-line-before::before 只写了 top、**没有 content** ⇒ 即使选择器对了，「插到上方」那条线也画不出来。已回接 .mb-row 并补齐 content
  （设备实测 ::before 已渲染 3px accent 线）。全屏标签页列表同理（.mobile-model-body .ln-row 失效 ⇒ 标签页退化成裸行）；已回接（实测 1px 边 + 10px 圆角 + 48 高）。
- **目录树缩进**：data-depth 一直在写，但 --indent **全仓从未被赋值** ⇒ 父子孙同一缩进、层级只能靠箭头猜。已在 kit.css 补 1–4+ 级档（14/28/42/56px），
  落点线左端改用同一变量（不再读已死的 --ln-indent）。设备实测 0/1/2/3/4 级 = padding-left 16/30/44/58/72px ✓。
  **⚠️ 开发库的树是平的**（74 篇全在根、depth 全 0）⇒ 真实数据上暂时看不出差别，需有嵌套分组才可见。
- **命中区（44 Rule）**：新增**唯一注册表**（src/mobile/mobile.css 顶部注释块）—— 视觉尺寸刻意 <44 的类统一用 ::after 补到 --mb-tap-min，
  **不改视觉盒子**（因此整页几何快照不受影响）；另把文档标题输入框 30→44、小记卡片按钮 40→44、.mb-input 内层 input 25→42→44
  （外壳 44 减 1px 边框，负 margin 收回）。走查 smallTap：**22 类 / 42 处 → 0**。
- **新增护栏**：mobileLayers.test.ts 增「移动端 CSS 不得再出现 .ln- / .b3- / .fn__ / .config- 选择器」（恒 0，防止再次静默失效）；
  ui-metrics.mjs 增移动端**字号字面量**基线（52，只许降；桌面是硬 0）。MOBILE-DESIGN.md 增 44 Rule 的实现口径与账本两条。
- **验证（全绿）**：tsc ✓ · vitest **235 文件 / 1829 用例** ✓ · check:mobileui ✓ · check:core 77-0 ✓ ·
  设备 check:mobilesnap **6 态 0 差异** ✓ · 设备走查 **22/22 屏 ok 且五类探针全 0** ✓ · git diff --check clean ✓。
- **未做（下一批）**：**A**（语雀对齐精修：顶栏 44 / 文字 tab / 胶囊底栏 56 / dock 条目 44 / 行高档收敛到 44-48-56）·
  6.1 启用内核 -mobile 排版家族（156+203 条现成规则，当前零使用）· 6.2 阅读态 ne-doc-major-viewer（**改的是两端共用的 lakeRuntime.ts，
  会同时改桌面观感 ⇒ 需单独实验 + 两端各自验收**）· 6.3 内核桌面几何残留（min-width:500 / min-height:1024 / padding 90px，先量再改）· 6.9 冷启动骨架。
- **⚠️ 并发提醒**：本批期间**桌面会话在同一工作树并发改动**（HANDOFF.md / PANEL-CONTRACT.md / src/App.tsx / MultiTabEditor.tsx /
  src/features/editor/splitView.css / 新增 splitGeometry.ts(+test)，时间 18:20–18:26）。**本批未提交** ⇒ 两部分改动现在混在同一工作树里，
  提交前需按文件分开。dist/ 是本批未重建的共享产物（只重建了 dist-mobile/）。

### 261013 · 移动端 A 批（形态对齐语雀）：顶栏 44 / 文字 tab / 胶囊 56 / dock 44 / 行高收敛

> 承接上一批：用户点单「先 §6 必要项 → 再 A」。本批即 A（**纯形态 + 令牌**，不动 IA、不碰路由与数据）。B 不做、D 留待办。

- **落地内容**：
  · **顶栏 48 → 44**（`--mobile-topbar-height`；连带 `.mobile-icon-btn` / `.toolbar__button` / `.mobile-model-head`）。
  · **首页 tab 改语雀式纯文字 tab**：选中 = 加粗 + `--lake-text-1`、未选 = 常规 + `--lake-text-3`，**去掉下划线指示线**；
    随之删除已无消费者的 `@keyframes ln-indicator-in`（不留死代码）。
  · **底部胶囊 48 → 56、圆角 28**；宽度上限**改为独立槽位令牌**（`--mobile-bottom-bar-slot: 48px`）——
    原来宽度由高度推导（`height × 6 = 288`），胶囊一加高就会连带被撑宽。实测宽度仍 **288** 不变。
  · **dock 条目 40 → 44**（`.med-btn` / `.med-ins-item` / `.med-f-btn` / `.med-f-sizes` / `.med-outline-item` / `.med-doc-item`），
    并从**触达补足注册表里移除**（口径：调大了就不该再补足，不许两套并存）。
  · **行高档收敛到 44 / 48 / 56**：搜索/文档行 40 → 44、设置根页行 52 → 48（原先 40/44/48/52/56 五档并存）。
  · **空态三套 → 一件**：`.mobile-empty`（外壳，padding 32/16 + 字号字面量 14）/ `.mb-set-empty`（设置卡内 20/0）/
    `.mb-sheet__empty`（浮层内 24/0）收敛为 **`.mb-empty` + `.mb-empty--inset`**，21 个 JSX 站点改名（装置与测试均未引用旧类名，已核对）。
  · **计数措辞统一**：列表副标题「共 N 篇文档」→「**N 篇**」（与书架视图同单位）；顺带把 `.nb-shelf-count` / `.nb-row__sub` /
    `.mobile-empty` 三处字号字面量换成令牌 ⇒ 移动端字号字面量 **52 → 49**（基线同步调小）。
- **本批唯一一次回归（已修）**：tab 横向内距收到 2px 后，「小记」宽度只剩 **36px**（<44）⇒ 走查 `smallTap` 从 0 弹到 **13 处**。
  修法 = `min-width: var(--mb-tap-min)` 兜底（纯文字 tab 的宽度由字数决定，单字标签必然掉档）；修后 `smallTap` **回到 0**。
  教训：**改视觉尺寸后必须重跑走查** —— 这正是上一批把探针修活的直接收益（否则这次回归会被静默放过）。
- **设备实测（AVD lake_mobile）**：顶栏 **412×44** · 胶囊 **288×56 / 圆角 28** · tab 选中 **56×44 / 600 字重 / `--lake-text-1` / `::after = none`** ·
  tab 未选 **44×44 / 400 字重 / `--lake-text-3`**。
- **验证（全绿）**：`tsc` ✓ · `vitest` **235 文件 / 1829 用例** ✓ · `check:mobileui` ✓ · `check:core` 77-0 ✓ ·
  设备 `check:mobilesnap` **重烤后 6 态 0 差异**（重烤前 6/6 态指纹变化但**元素数全部不变** = 纯计算值变化、无结构变化：1784/1840/1755/2943/1862/1811）·
  设备走查 **22/22 屏 ok · 五类探针全 0 · 横向溢出 0** ✓ · `git diff --check` clean ✓。
- **账本（`mobileLayers` / `ui-metrics`）**：tokens 167→**168**（+slot）· kit 439→**440**（+`.mb-empty--inset`）·
  floating 255→**250**（−`.mb-sheet__empty`）· mobile.css 1218→**1220**（空态与指示线净减、tab 补 2 条 44 兜底）·
  移动端字号字面量 52→**49**。`MOBILE-DESIGN.md` 已同步：YAML 加 topbar/bottom-bar、Layout 表加行高档收敛与 tab 形态、
  Components 登记 `mb-empty`，并把「补足注册表 vs 真调大」的取舍写成 44 Rule 的补充口径。
- **仍未做**：6.1 启用内核 `-mobile` 排版家族 · 6.2 阅读态 `ne-doc-major-viewer`（跨端共用 `lakeRuntime.ts`，需单独实验）·
  6.3 内核桌面几何残留（先量再改）· 6.9 冷启动骨架 · **B**（首页「最近优先」权重重排，用户定：暂时不动）·
  **D**（平板/横屏双栏新布局，用户定：留作待办）。
- **⚠️ 并发仍在**：桌面会话的 `HANDOFF.md §0` / `PANEL-CONTRACT.md` / `src/App.tsx` / `MultiTabEditor.tsx` / `splitView.css` /
  `splitGeometry.ts(+test)` 仍在同一工作树里；**本批同样未提交**。提交时必须按文件分开。

### 261013 · 移动端 6.1–6.9 收口：内核两族 mount 类实测（不做）+ 引擎几何修复 + 冷启动骨架 + 装置确定化

- **6.1 内核 `-mobile` 排版家族（156 / 203 条）⇒ 实测零收益，不做**：这族几乎全部（156/156、201/203）挂在
  `.ne-paragraph-spacing-relax.ne-typography-classic` 上，而我们运行的实例是 `ne-typography-traditional`（设备实测 `.ne-viewer` 类名）
  ⇒ 选择器根本不匹配；给宿主加上该类后 h1/p 的 font-size/line-height/margin **逐项不变**。已回填 `LAKEX-CONTRACT §5.34`，
  并写明「它不是现成的移动端排版，别再当低成本抓手提」。
- **6.2 阅读态 `ne-doc-major-viewer`（19 条）⇒ 移动端不做，留给桌面**：读码核对「160 条非 -mobile 的 `.ne-doc-major-editor` 规则里
  **0 条**指向 `ne-viewer`」（换类不丢东西），但那 19 条是按**桌面 750 版心**写的：`.ne-viewer-body{padding:0 50px}`（412px 屏正文只剩 312）、
  `ne-table-hole.ne-full-width ne-table-wrap{min-width:750px}`、`ne-root-card-hole.ne-full-width > ne-card{min-width:750px}`
  ⇒ 手机上必然溢出，且会被 `.ne-editor-wrap{overflow-x:hidden}` **静默裁掉**。要换必须同时中和这三条 ⇒ 收益不抵复杂度。
  桌面端换类才可能吃到「750 版心」的正当收益 ⇒ **登记给桌面会话单独验收**（§5.34 ②）。
- **6.3 引擎几何残留（已修）**：内核按桌面写死 `.ne-layout-mode-fixed/.adapt .ne-engine{min-height:1024px; padding:20px 70px 90px 70px!important}`，
  我们原先只压了左右内距 ⇒ 手机（视口约 790）上短文档多出约 230px 幻觉滚动 **再叠加** 90px 重复底内距。
  已压回 `min-height:0 / padding-bottom:0`（设备级联实测 1024/90 → **0 / 0**）。小记走 **note 版式**（`.ne-doc-note-editor`，16/8/24、min-height 实测 336.9）不受影响。
- **6.9 冷启动骨架（已做）**：原冷启动只画满屏「启动中…」；现改为**与首页同构的静态骨架**（顶栏 + 内容块 + 胶囊底栏，尺寸同源）
  ⇒ 数据到达原地填充、不整屏跳。设备时序实测：**~200ms 出现 11 个骨架节点 → ~250ms 接上真实首页**，「启动中」**0 次**出现。
  新增 `.mb-skel` 原语并登记进 `prefers-reduced-motion` 名单。
- **6.4–6.8 已在上一批「必要项」交付**（目录树缩进 / 命中区 44 / 走查探针 / 死 CSS 与目录层失效 / 文档数字）。**6.1–6.9 至此全部有结论**。
- **装置第二处确定化（本轮附带，价值大）**：`check:mobilesnap` 每态先**清掉 `lake-notes-mobile.tabs.*`** 再 reload ——
  整页快照把 keep-alive 的**隐藏 pane 也数进元素数**，而标签集随使用历史变 ⇒ 同一份代码得到不同计数
  （历史 `home-library` 1784/1755 抖动、本轮 `home-doc` 2943/2937/2926 漂移，根因都是它）。清掉后**连续 3 次复跑 0 差异**。
  同时把 `home-doc` 断言收紧到「**活动** pane 里真的有 `.ne-viewer` / `.ne-engine`」（此前只查 `.mobile-doc-body`，会被隐藏 pane 蒙混）。
- **⚠️ 过程中我污染过开发库（已清理，留档当教训）**：探针点了目录菜单的「新建文档」，在「欢迎来到 Lake Notes」下建了一篇「无标题文档」，
  并把那一行变成**分组行**（`hasChildren` ⇒ 点击只展开不打开），连带 `home-doc` 语义漂移。已用 `lakeNative.trashNote` 移入回收站（93 → 92 篇）。
  **教训**：探针不要走「新建」类 UI 入口，要用 `createNote(title, parent)` 建独立文档（§0 早有此约定），跑完即清。
- **验证（全绿）**：`tsc` ✓ · `vitest` **235 文件 / 1829 用例** ✓ · `check:mobileui` ✓ · `check:core` 77-0 ✓ ·
  设备 `check:mobilesnap` **连续 3 次 0 差异** ✓ · 设备走查 **22/22 ok · 五类探针全 0 · 横向溢出 0** ✓ · `git diff --check` ✓。
- **账本**：`mobile.css` 1220 → **1240**（骨架 ×20）· dupGroups 2 → **3**（`.mb-skel` 在 reduced-motion 名单里关 animation，
  与主块同选择器同属性成一组 —— 本文件既有的无障碍登记模式，不是多层覆盖）· 移动端 `!important` 16 → **18**（6.3 的两条，压未分层内核 CSS）·
  字号字面量仍 **49**。

> **261009 B2（进行中）** 移动端逐页走查装置：scripts/css-audit/mobile-walkthrough.mjs（配合 drive.mjs 9335）。
> 覆盖：首页（知识库 / 小记 / 书架）、笔记本工作区、各文档（doc / usheet / bitable / board）、设置抽屉九页；每屏「截图 + 探针」
> （越界 / 截断 / 对比度 / 小点击目标 / 整页横向溢出）。
> **⚠️ 关键工具坑（261009 实测）**：**Android WebView 的 CDP Page.captureScreenshot 抓不到 GPU canvas 层** ——
> usheet 网格在页面截图里整片空白，但同屏画布 toDataURL() 有完整内容、设备级 adb screencap 也完全正常
> ⇒ **移动端截图一律用设备级 screencap**（脚本里已改）。别据 CDP 截图报「表格空白」这种假缺陷（本轮差点误报，A/B 撤掉表格补丁后同样空白才定位到是截图问题）。
> ~~已知观察（未改）：首页顶部 .mobile-htab 命中区 36×25 / 52×25~~ **已于 261012 修复（现 48×44 / 64×44）**；
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
> 已有单测 `src/mobile/hooks/gestureCore.test.ts` 明确断言「表格/多维表/画板没有大纲 ⇒ 左滑作废」；本轮在设备上又量到**同一个 `outlineAvailable` 判据的两侧**：文档（无标题文档）底栏「大纲」`disabled=false`、画板与表格 `disabled=true`。运行期用 CDP touch 驱动左滑没做成——壳是 keep-alive（隐藏视图元素仍在 DOM、rect 为 0），我的导航在"从文档回首页"这一步反复选到不可见元素；由于门控已有单测 + 状态侧实测，判定为**价值重叠、不再投入**（真要驱动得先给 walkthrough 的 goHome 加命中测试版可见性判据，那是装置改进、不是产品验证）。
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
