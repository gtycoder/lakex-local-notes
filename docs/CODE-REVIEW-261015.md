# CODE-REVIEW-261015.md — 全面代码 review（前端 + 后端）与整改方案

> **本文件是「讨论议程」，不是执行单。** 本轮**只读**产品代码，未改任何源码；按用户 261015 指令：
> 只出方案，逐项讨论后再动手。
>
> 复现基线：`HEAD = origin/master = fc87325`、`git status` 干净（0 改动）。
> 所有数字都可由 §0.2 的命令重跑得到；口径与现有护栏不一致处一律标注「口径差」。

---

## B0 进度（261016 · 已完成）

**B0 = 先把红线变成可执行判据，不清理存量。** 落地文件只有一个：`scripts/ui-metrics.mjs`（+124 行），
已随本文档一起提交并推送。**未改任何产品代码、未改任何 CSS。**

| B0 项 | 落地内容 | 基线（只许降） |
| --- | --- | --- |
| C4-2 口径统一 | 桌面「颜色字面量 / `!important` / 令牌护栏」的扫描集合从**入口图 33 个**改为**全部桌面 CSS 58 个**（与字号护栏同口径） | 桌面 `!important` 由口径修正后的 **11** 起算 |
| C4-3③ 移动颜色护栏 | 新增「移动端非主题颜色字面量」统计 + 门禁（`src/mobile/theme/**` 才是合法归属） | **28**（全在 `mobile.css`） |
| C5-3 判据 | 新增「文字色误用裸 `--lake-accent`」统计 + 门禁（规则：文字一律 `--lake-accent-text`） | **36** |
| C4-4 跨文件棘轮 | 新增「跨文件重复 (选择器,属性) 组数」统计 + 门禁（补上 `cssLayers/mobileLayers` 只看文件内的盲区） | **298** →（261016 口径修正后）**13**，见 §C4-4 |
| — 顺带 | 桌面「非主题颜色字面量 0」此前只报告不判失败 ⇒ 现在**硬判 0** | 0 |

**自证（必须做，本仓有探针静默失效 3 个月的先例）**：用两个临时探针文件注入 5 类违规，
实测 5 条护栏**全部咬人**（桌面颜色 0→1、桌面 `!important` 11→12、移动颜色 28→29、
accent 误用 36→37、跨文件重复 298→300，退出码 0→1），删除探针后逐项回到基线且退出码恢复 0。

**门禁实测（261016）**：`tsc` ✓ · 全库 vitest **258 文件 / 2010 例通过**（5 文件 16 例跳过）✓ ·
`check:core` 80 文件 0 违规 ✓ · `check:mobileui` ✓ · `check:bundle`（app-css 1.79MB ≤ 2MB）✓ · `git diff --check` clean ✓。

**B0 遗留（属 B2，不是 B0 缺陷）**：
① 基线本身**尚未清零**（移动颜色 28 / accent 36 / 跨文件 298）——B2 负责清理，B0 只保证**不再变多**；
② 桌面 `!important` 的**红线仍是 ≤10**，B0 只是把它从「不判失败」变成「≤11 的棘轮」，
   `AGENTS §3#14` 的文案未改；**Q2（放宽到 ≤11 还是删掉 `usheetEditor.css` 那条）仍待裁决**；
③ 跨文件重复的算法在 B0 实现时做了修正（旧的一次性脚本会把 `@media` 块内的规则整段漏掉），
   因此**基线数字由本文档初稿的 288 修正为 298**（分布：298 组全部是「恰好 2 个文件」）。

---

## 0. 方法、口径与纪律

### 0.1 扫描范围

| 范围 | 体量 |
| --- | --- |
| `src/**/*.ts,tsx` | 80,043 行 |
| `electron/**/*.ts,cjs` | 20,473 行 |
| `src/**/*.css`（含 1 个 vendor） | **73 个文件 / 11,586 行** |
| 模块数 | `src/core` 79 · `src/lib` 31 · `src/components` 31(+5 ui) · `src/hooks` 24 · `src/features/*` 8 个域 · `src/mobile` 91 个根条目 |

### 0.2 复现命令（本文件全部数字的来源）

```bash
export PATH="$HOME/.nvm/versions/node/v24.18.0/bin:$PATH"
cd /Users/admin/file/local-lake/lake-notes-electron

node scripts/ui-metrics.mjs                     # 官方硬指标（桌面/移动）
node scripts/check-core-boundaries.mjs          # core 平台泄漏
npx vitest run src/styles/cssLayers.test.ts src/mobile/mobileLayers.test.ts src/styles/geometrySources.test.ts

# 本次 review 的临时分析器（未入库，落在 /tmp）
node /tmp/review-css.mjs     # 去注释后统计 !important / 颜色 / 字号字面量（逐文件）
node /tmp/rev-cross.mjs      # 跨文件重复 (选择器,属性)
node /tmp/rev-state.mjs      # 跨端重复 + 状态类清单
node /tmp/rev-mod.mjs        # 模块依赖矩阵
node /tmp/rev-dup.mjs        # 同名函数跨文件定义
node /tmp/rev-accent.mjs     # 文字色是否误用裸 --lake-accent
```

### 0.3 判定纪律（AGENTS §3#17）

每条提案必须回答三问：**① 问题真实存在吗（有证据）？② 不做会付什么代价？③ 收益 > 新增复杂度？**
三问缺一即标「不做」，并在 §8 记录，避免下次重复提议。

### 0.4 一个重要的前提修正

用户担心「`!important` 滥用」与「层层套 CSS」。**实测结论是：红线基本没破**——
30 条 `!important` 全部有就地理由、跨文件重复只占 3.1%、73 个 CSS 全部被正确 import（0 孤儿）。
真正的欠账集中在三处：**移动端 `mobile.css` 的 28 个颜色字面量**、**护栏口径漏洞**、**状态样式仍有 41 处分散**。

---

## 1. 结论速览

| # | 议题 | 判定 | 真问题 | 建议动作 |
| --- | --- | --- | --- | --- |
| 1 | 公共函数/方法抽提 | 有真问题，量不大 | 7 组 | 直接抽，低风险 |
| 2 | 能力抽象与封装 | **大部分已具备**，别重做 | 3 项 | 只补缺口 |
| 3 | 模块划分/分层/分包 | 基本整齐 | 3 项 | 2 项纯搬迁（零行为变化） |
| 4 | 样式根位置 / 层层套 / !important | **红线达标** | 4 项（1 真违规 + 3 机制漏洞） | 先补护栏再清理 |
| 5 | 样式统一 / 选中态收归令牌 | 配对纪律好，但分散 | 3 项 | 补令牌族 + 收编 |
| — | 已用户定稿的边界 | — | — | **不讨论**（§8） |

---

## B1 进度（261016 · 已完成）

**B1 = 公共函数/方法抽提（零视觉变化）**：改 10 个文件 + 新增 5 个文件；**未改任何 CSS、未改任何 UI 行为**。

| B1 项 | 落地内容 | 验证 |
| --- | --- | --- |
| **C1-4 小记 S3 key**（最高价值） | 新建 `src/core/quickNoteKeys.ts` 作**唯一来源**；`quickNotePush.ts` / `quickNotesSyncEngine.ts`（逐字相同的两份内联 key）与 `electron/quickNotesSync.ts`（**第三处**，且重复定义了 `QUICK_NOTES_ROOT` 常量）全部改为引用；连 `quickNotePushSyncRace.test.ts` 里的手写副本也一并收编 ⇒ **全仓（含测试）已无手写布局** | 新 `quickNoteKeys.test.ts`：**字面量**钉死布线格式 + 源码级护栏（禁止再内联拼 key） |
| **C1-2 `formatBytes`** | 勘察发现三份**并不等价**：同步浮窗是「GB 档 + ≥100 取整」，与设置页「只到 MB + 恒一位小数」是**两个口径** ⇒ **没有强行合并**，而是把同步那份显式化为 `formatBytesCompact()` 收进 `src/lib/formatBytes.ts`（观感逐字节不变）；移动端设置页那份与 canonical **逐字等价** ⇒ 直接复用 | 新 `formatBytes.test.ts` **7 例**，含两个口径的**差异边界**（防止日后被误合并） |
| **C1-3 `escapeId`** | 三份逐字相同（`EditorTab` / `OutlineList` / `useOutline`）⇒ 收归 `src/lib/cssEscape.ts`；**保住 try/catch 兜底**（node 测试环境没有 `CSS` 全局，裸调用会抛） | 新 `cssEscape.test.ts` **3 例**：委托 `CSS.escape` / 无 `CSS` 时兜底 / `CSS.escape` 抛错时兜底 |

**B1 有意未做（并说明理由）**：

① **C1-1 `nowIso`（7 处）——不做**。它只是 `new Date().toISOString()` 的一行包装，收益仅"少 7 行"，
   代价却是触碰 7 个文件（其中 `electron/store.ts` 正被并行会话改动）。按 AGENTS §3#17
   「收益只停在代码更整洁」判定为**过度设计**；若将来时间戳口径真要统一，再单独立项。
② **C1-3b：另有 7 处直接调用 `CSS.escape`（无兜底）未收编**——那是「用法不同」而非重复定义，
   收编会改变其失败行为（属加固、不属抽提），单独立项。
③ **C1-5 / C1-6 / C1-7**（时间格式化、只读单元格、属性清单）不在 B1，见 §7 的 B2 与 §9 待裁决。

**门禁（261016）**：`tsc` ✓ · 全库 vitest **261 文件 / 2024 例通过**（跳过 5 文件 16 例）✓ ·
两条构建（桌面 + 移动）✓ · `check:core` 81 文件 0 违规 ✓ · `check:mobileui` ✓ · `check:bundle` ✓ ·
`git diff --check` clean ✓。**B0 护栏在 B1 之后仍停在基线**（移动颜色 28 / accent 36 / 跨文件 298 /
桌面 `!important` 11，`ui-metrics` exit 0）——即 B1 没有把任何一条存量指标推高。

**并发避让**：本批只提交自己的文件；并行会话的 `docs/KERNEL-REUSE-AUDIT.md` / `src/core/textStats*` /
`electron/store.ts` 等一律未 add、未提交。

---

## B2 进度（261016 · **两批均已完成**）

**口径**：本轮只做「令牌值与当前字面量**逐字节相同**」的搬迁 ⇒ 零观感变化；涉及取色的部分（Q3/Q4）等你裁决后再动。

| 内容 | 结果 |
| --- | --- |
| `src/mobile/mobile.css` 的 **28 处颜色字面量** | **→ 0**（8 个参与渲染的字面量收编进 `src/mobile/theme/tokens.css`：知识库 6 档装饰调色板 `--mb-nb-accent-1..6` / 纸卡投影 `--mb-shadow-paper` / 遮罩前景 `--mb-on-scrim`） |
| 同文件里 **13 处 `var(--token, #fallback)` 兜底** | **→ 0**（删除）。这 13 处是**不可达分支**——其令牌在移动端主题链里都有定义；且 **13/13 的兜底取值与真实令牌都不一致**（思源时代残留：如 `--lake-border-1` 真实 `#e6e8ec`、兜底却写 `#e3e6eb`）⇒ 是**误导性死值**，不是防御性代码 |
| `mobileLayers` 基线 | `mobile/theme/tokens.css` 181 → **189**（+8，合法新增；`mobile.css` 声明数不变） |
| `ui-metrics` B0 基线 | `mobileColorLiterals` 28 → **0** ⇒ 移动端与桌面同为**硬 0** |

**零观感变化的机械证明**（对拍 `git show HEAD:src/mobile/mobile.css`，脚本可复跑）：
```
【A 类】真正参与渲染的颜色字面量: 8 个 → #fff rgba(16,24,40,.05) #5b8def #dfa03c #48b07a #d96a97 #8f7be0 #3fb0c0
   ⇒ 有同值令牌定义: 8/8 ✓ 逐字节一致
【B 类】被移除的 var(token, #fallback) 兜底: 13 处
   ⇒ 其 token 在本端主题已定义（兜底不可达）: 13/13
   ⇒ 其中兜底取值 ≠ 真实令牌（过期值）: 13/13
```

**门禁**：`tsc` ✓ · 全库 vitest **261 文件 / 2024 例通过** ✓ · 双端构建 ✓ · `check:core` 81 文件 0 违规 ✓ ·
`check:mobileui` ✓ · `check:bundle` ✓ · `ui-metrics` exit 0（移动颜色 0 / 桌面颜色 0 / accent 36 / 跨文件 298 / 桌面 `!important` 11）✓ · `git diff --check` clean ✓。

### B2 第二批：Q2 决定 + Q4 落地（261016）

**Q2（用户授权我定）——结论：`!important` 的红线从"数字 ≤10"改成"逐条有理由的允许清单"。**

理由：`!important` 桌面实测 11 条，**逐条核过都成立**（压 JS inline 宽度 / 压内核 inline 高度 / 压 legacy 的 `!important` / reduced-transparency 契约）。
"≤10"这个数字**当前已被真实需要越过**，继续挂着只会让门禁失去意义；用户 261016 明确「确实有必要用 !important 可以保留，不是一点不能用」。
落地方式（比数字更硬）：

- `scripts/ui-metrics.mjs` 新增 `IMPORTANT_ALLOWLIST`（**11 条，每条写明"压的是谁"**）；
- 判据两条：**总数不得超过清单长度**，且**不得出现清单外的 `!important`**（即使总数没涨）；
- 清单里已找不到的条目会被列出来提醒同步删表（避免清单腐烂）；
- 移动端 `!important` 走棘轮（**19**，只许降）；
- **自证**：注入一条清单外 `!important` ⇒ 报 `清单外的 !important: styles/__q2_probe.css .q2-probe {color}` 且 exit 1；移动端注入 ⇒ 20 > 19 exit 1；清理后 exit 0。
（过程中护栏还当场抓出我把 `tokens.css` 的选择器顺序猜错成 `.context-menu, .create-menu`，实际是 `.create-menu, .context-menu` —— 正是它该干的事。）
- `AGENTS §3#14` 与 §3#21 的口径已同步改写（不再是"≤10"）。

**Q4（用户批准执行）——36 处文字色已全部换成 `--lake-accent-text`，护栏基线 36 → 0（硬 0）。**

| 项 | 结果 |
| --- | --- |
| 改动处数 | **36**（11 个文件、36 增 / 36 删） |
| 改动性质 | 逐行核对：**删除行全部是「属性恰为 `color` 的 accent」**，新增行全部是「属性恰为 `color` 的 accent-text」；其中 **35 处是纯令牌替换**，1 处（`document-status.css` 的 `var(--lake-accent, var(--lake-accent))` **自我兜底**）同时补了说明注释 |
| 未被误伤 | `border-color: var(--lake-accent)` **26 → 26**、`background: var(--lake-accent)` **29 → 29**（均保持不变） |
| 观感变化（按主题） | 浅色 `#3f5fa0 → #33497f`、深色 `#9aabce → #b9c6e2`、暖色 `#d45500 → #a8440a` |
| 达标影响 | **只有暖色从"不达 AA（3.61–4.12）"变为"达标（5.27–6.01）"**；浅/深本来就达标，只是颜色观感更收敛 |
| 顺带收编 | 其中含 `.ln-iconbtn.is-selected` / `.bottom-bar-btn.active` 等**选中态** —— 改完与 `kit.css` 的选中三元组（accent-tint 底 + accent-text 字）口径一致，属 C5-1 的一部分 |

**⚠️ 视觉门禁未跑（如实说明）**：本轮**没有**跑 `check:stylesnap` / `check:mobilesnap`（需 CDP + 跑起来的 Electron / 专用 AVD；本次尝试用 Electron 截图的路径在本环境超时）。
作为替代证据：改动是**纯令牌替换**（逐行配对可验）、影响面 = 上表列出的 3 个主题色值、且**属性边界证明**排除了 `border-color`/`background` 被误改。
**遗留**：正式验收前建议补跑一次受影响的桌面态与移动 6 态（Q4 只改颜色，不涉几何 ⇒ 快照应表现为"元素数不变、颜色指纹变化"）。

**⚠️ 并发会话的既有失败（不是本批引入）**：`electron/webApiServer.test.ts > WEB_METHODS 与 preload.cjs 的 invoke 通道完全一致` 失败 ——
内核会话给 `preload.cjs` 加了 `findInDocument → find_in_document`，但没同步 `electron/webApiServer.ts` 的 `WEB_METHODS`（AGENTS §7.6 的坑）。
本批为纯 CSS/脚本改动，不可能影响该断言；**按并发边界未由本会话修改**，留给该会话补。

---

## Q3 / Q4 取色实测（261016 · 给裁决用）

可视化：`.css-audit/q3-q4-261016/`（`q3-selected.html` · `q4-accent.html` · `q4-warm.html` 及其 PNG；证据目录 gitignored，
数字已固化在下表）。全部由源码令牌实时计算，对比度用 WCAG 2.x 相对亮度。

### Q4 —— 36 处「文字色用裸 `--lake-accent`」的真实代价（AA 门槛 4.5:1）· ✅ **已实施（261016）**

| 主题 | `--lake-accent` | `--lake-accent-text` | 面板底 | 窗口底 | 块面 | hover 底 |
| --- | --- | --- | --- | --- | --- | --- |
| 浅色 | `#3f5fa0` | `#33497f` | 6.26 → **8.75** | 5.69 → **7.95** | 5.78 → **8.08** | 5.54 → **7.74** |
| 深色 | `#9aabce` | `#b9c6e2` | 7.13 → **9.60** | 7.53 → **10.14** | 6.13 → **8.26** | 6.09 → **8.21** |
| **暖色** | `#d45500` | `#a8440a` | **4.12 ✗** → 6.01 | **3.75 ✗** → 5.46 | **3.71 ✗** → 5.41 | **3.61 ✗** → 5.27 |

**结论（修正了我先前的假设）**：浅色与深色下裸 `accent` 当文字**都还够 AA**（5.54–7.53）；
**只有暖色主题 4 项全部不达标**（3.61–4.12，均 < 4.5）。⇒ Q4 的真实收益 = **修好暖色的可读性**，
而不是"深色会掉到 3:1"（那是我未实测时的错判，已在本表纠正）。浅/深下的变化只是**颜色观感不同**，不涉及达标与否。

### Q3 —— `--lake-bg-selected-hover` 三个候选的真实合成值 · 🕓 **待你考虑（仅记录，未实施）**

| 主题 | 当前选中（tint） | 候选 A：tint 混 accent 12% | 候选 B：混 24% | 候选 C：改用 `--lake-bg-press` |
| --- | --- | --- | --- | --- |
| 浅色 | `#eef2fa` | `#d9e0ef` | `#c4cfe4` | `#e9ebee` |
| 深色 | `#31343d` | `#3d424e` | `#4a5160` | `#323337` |
| 暖色 | `#fff2e8` | `#fadfcc` | `#f5ccb0` | `#e9e8e4` |

- **A / B** 用 `color-mix(in srgb, var(--lake-accent-tint) N%, var(--lake-accent) (100−N)%)`：
  **不需要为三套主题各写一个色值、也不引入新的颜色字面量**（红线友好），且深浅自动跟随。
  A 更轻（推荐起手）、B 更明显（深色下 `#4a5160` 已偏"实"）。
- **C** 复用既有 `--lake-bg-press`：省一个令牌，但把"按压色"与"选中悬停色"两个语义合并；
  暖色下 `#e9e8e4` 反而比选中底 `#fff2e8` 更暗更中性，会丢掉"选中还是暖调"的暗示。
- 前两个待定令牌（`--lake-bg-selected` = `var(--lake-accent-tint)`、`--lake-fg-selected` = `var(--lake-accent-text)`）
  是**既有取值的别名** ⇒ 零观感，纯语义收口。

---

## 2. 议题一：公共函数与方法抽提

### C1-1 `nowIso` 在 7 个文件里各写一遍 ★低风险

**证据**：`new Date().toISOString()` 的包装被定义 7 次——
`src/core/bitableDoc.ts:446`、`src/core/bitableMutations.ts:35`、
`electron/{quickNotes.ts:42,schemaInit.ts:4,trashLifecycle.ts:10,syncReconciliation.ts:8,store.ts:107}`。

**定性**：真实但极低价值。风险不在重复本身，而在**时间戳精度/时区口径**将来若统一（如改 UTC 周口径），7 处要同步改。

**方案**：抽到 `src/core/time.ts`（纯函数，符合 core 无平台依赖），electron 侧从 core 引。
**代价/收益**：约 7 行改动 + 1 个新文件；收益 = 口径单点。**建议做，但可并入其他批次**。

### C1-2 `formatBytes` 已有共享实现，仍有 2 处本地重写 ★低风险

**证据**：`src/lib/formatBytes.ts` 存在且被 `components/SettingsPanel.tsx:28`、`components/AssetsBrowser.tsx:19` 正确引用；
但 `src/components/SyncStatusPopover.tsx:46` 与 `src/mobile/settings/SettingsDrawer.tsx:57` 各自又写了一份。

**定性**：**明确的 DRY 违规**——同一进程内有 3 套实现，显示口径可能不一致（如小数位/单位阈值）。

**方案**：两处改引 `src/lib/formatBytes.ts`；若移动端因「不共享桌面样式」而想独立，注意**本项共享的是纯函数不是样式**，
`mobileIndependence.test.ts` 只禁样式 import，不受影响。
**验收**：`formatBytes.test.ts` 覆盖三种实现口径一致（或删掉重复后跑原有 snapshot）。

### C1-3 `escapeId` 在 3 个文件里逐字相同 ★低风险

**证据**：`src/features/editor/EditorTab.tsx:52`、`src/features/outline/OutlineList.tsx:10`、`src/features/outline/useOutline.ts:12`
三份 `CSS.escape` + try/catch 完全同构。

**方案**：抽到 `src/lib/cssEscape.ts`（或并入既有 DOM 工具文件）。**建议做**。

### C1-4 小记的 S3 key 构造在两处重复 ★★有实际风险

**证据**：
```
src/core/quickNotePush.ts:54-56      objectKey / assetKey / manifestKey
src/core/quickNotesSyncEngine.ts:226-228  objectKey / assetKey / manifestKey   ← 逐字相同
```
**定性**：这是**数据布局**，不是显示逻辑。两处独立实现意味着：将来改小记的对象前缀/命名，
**改一处漏一处 ⇒ 单条推送与整轮同步指向不同的对象**（会造成重复上传或读不到）。
AGENTS §4 已把「小记保存并同步 = 单条推送」列为高危路径（清单是单文件覆盖写、无 CAS）。

**方案**：把 quick-notes 的 key 布局抽到 `src/core/quickNoteKeys.ts`（`cfg` 派生），
`quickNotePush` 与 `quickNotesSyncEngine` 共用；测试里的同名私有副本同步改为引用。
**验收**：新增 1 例断言两个引擎对同一 (id, hash, filename) 产出相同 key；现有 `quickNotesSyncContract.test.ts` 复跑。
**建议做（优先级最高的抽提项）。**

### C1-5 日期/时间格式化散落 20+ 处，各写各的

**证据**：`pad = (n) => String(n).padStart(2,"0")` 在 `components/QuickNotesWorkspace.tsx:104/961`、
`components/SettingsPanel.tsx:51`、`components/NoteInfoDialog.tsx:27`、`mobile/ui/NoteInfoSheet.tsx:24`、
`electron/quickNoteConversion.ts:33` 各写一遍；另有 `mobile/home/HomePage.tsx:93-105` 与 `mobile/home/NotebookGrid.tsx:20-24`
各自内联「MM-DD HH:mm」；`src/lib/formatTime.ts` 已存在但只服务一处。

**定性**：真实但**分层敏感**——「今天显示 HH:mm、昨天显示 MM-DD、更早显示 YYYY-MM-DD」是**产品口径**，
现在这个口径散在 4 个入口里，任何一处调整就会出现「同一列表两种时间格式」。

**方案（建议分两步，不要一次做）**：
① 先抽**纯格式化** `src/core/dateFormat.ts`：`formatHm` / `formatMdHm` / `formatYmd` / `formatDateTime`（无本地化副作用）；
② **不**抽「相对时间策略」（那是产品语义，且桌面/移动列表口径可能有意不同）——
只在 §9 议题里问用户「两端列表时间措辞是否要一致」。
**验收**：抽完对拍现有快照（桌面 stylesnap 相关态 + 移动 6 态）+ 时间显示逐字符断言。

### C1-6 移动端多维表只读单元格重写了桌面已有的只读形态 ★★值得做

**证据**：`src/mobile/bitable/MobileBitableViewer.tsx`（272 行）里重写
`AttachmentCell:63` / `RatingCell:111` / `ProgressCell:124` / `LinkCell:136` / `RelationCell:145`；
而桌面 `src/features/bitable/bitableCells.tsx` 的同名组件**本就带 `readOnly` 分支**
（`:349 AttachmentCell(readOnly…)`、`:1084 LinkCell(readOnly…)`、`:1140 RatingCell`、`:1158 ProgressCell`、`:1246 RelationCell`）。

**定性**：**同一「只读渲染」语义在两处实现**，且桌面那份已经支持只读 ⇒ 移动端是在复刻一条已存在的分支。
风险 = 字段类型新增/语义变化时两处不同步（移动端今日的「只读控件」清单是 260929 手工补齐的）。

**方案（需讨论，涉及共享边界）**：抽出**只读展示**层（纯函数或 `<ReadOnlyCell field value/>`），
桌面与移动各自套自己的外观类名。**注意**：这**不**违反「移动端不共享桌面样式」——
共享的是渲染**逻辑**，类名仍由两端各自提供（与 `ImageLightbox`/`AttachmentPreview` 的既有口径完全一致，
见 `src/mobile/features.css` 头部注释）。
**验收**：移动端只读清单（bool 禁用复选、link href/target、5 星、进度百分比、关联 chip、时间到分钟）逐项设备复跑
（HANDOFF §8「多维表只读」既有判据）；`check:mobilesnap` 6 态 0 差异。

### C1-7 `NoteInfoDialog` 与 `NoteInfoSheet` 是同功能两端实现

**证据**：`src/components/NoteInfoDialog.tsx`（268 行）vs `src/mobile/ui/NoteInfoSheet.tsx`（147 行），
共享同名私有辅助 `fmtTime` / `fmtSize` / `rect` / `openAsset` / `copyId`（见 `rev-dup` 输出）。

**定性**：**形态差异是有意的**（Dialog vs Sheet，用户 261012 定稿移动端交互形态可重做），
但**「文档属性要显示什么」这份清单**被写了两遍（元数据 + 字数 + 引用资产 + 历史快照）。

**方案**：抽 `src/core/noteInfo.ts`：`buildNoteInfoRows(info)`（纯函数，产出 [{label, value, kind}]），
两个壳只负责渲染与交互。**收益** = 属性清单单点；**风险** = 低（纯搬迁）。
**建议做**，但排在 C1-6 之后。

### 已定稿、**不要**抽的（写入 §8 防重开）

- `src/components/settingsPrimitives.tsx`（143）与 `src/mobile/ui/settingsPrimitives.tsx`（139）：
  两端**有意 fork**，只共享 `settingsSearch.ts` 的设置项语义（文件头注释与 `MOBILE-TECH-UI-REDESIGN` 口径已写明，用户 261012 定）。
- 桌面/移动的 S3 store、repository 实现：见 C2-3 讨论，但**合并实现**不在本轮。

---

## 3. 议题二：能力抽象与封装

> **总判定：这个项目的「能力抽象」已经做得比一般项目好，主要缺口集中在「契约单点」而不是「重新抽象」。**

### C2-1 已具备的抽象（先确认，避免重做）

| 能力 | 现有抽象 | 状态 |
| --- | --- | --- |
| 多端存储/S3/缓存 | `src/core/ports.ts`（`CachePort` / `AppInfoPort`）+ `syncEngineTypes.ts`（`SyncDbPort`）+ `quickNotesSyncEngine.ts`（`QuickNotesSyncDbPort`） | 已有「端口注入」，两端口各自实现 ✅ |
| IPC | `electron/ipc/registrar.ts` 单一注册表，**Electron IPC 与 HTTP web 客户端（`webApiServer.ts`）共用同一批 handler** | 设计良好 ✅ |
| 内核资料检索 | AGENTS §2 三级检索 + vendor pin + `LAKEX-CONTRACT.md` | 已制度化 ✅ |
| 表格内核触点 | `src/features/usheet/usheetKernelContract.ts` + `univerContract.test.ts` + 运行时探针 | 已制度化 ✅ |
| 互斥域 | `src/core/maintenancePolicy.ts` + `mobile/maintenanceLocks.ts` | 已有单一判据 ✅ |
| 云同步状态 | `src/core/cloudState.ts`（两端共用） | 已有单一判据 ✅ |
| 搜索 | `src/core/search/`（桌面/移动共享） | 已共享 ✅ |

**结论：不要新建「能力抽象框架」。** 下面只补 3 个真实缺口。

### C2-2 IPC 能力面：116 通道，注册/暴露 **0 漂移**，但被手抄 3 遍

**证据**（可复现）：
```
preload 暴露通道: 116       主进程注册通道: 116
注册了但未暴露: 0           暴露但未注册: 0        ← 当前完全一致
```
但同一个能力面被**手写**在：`electron/preload.cjs`（165 行 `invoke` 清单）、
`src/lib/native.ts` 的 `LakeNative` 接口（110 个方法签名）、`src/mobile/bridge.ts`（68 个实现方法）。

**定性**：目前**没有漂移**（有 `electron/ipc/*.test.ts` + `lakeNativeContract.test.ts` 兜底），
所以这是「**将来会疼**」而不是「现在疼」：新增一个通道要改 3 处，且类型只在 `native.ts` 有。

**方案（保守，二选一）**：
- **A（轻）**：把通道名抽成 `electron/ipc/channels.ts` 常量表，preload/native/register 都从它引 ⇒ 拼写漂移不可能。
- **B（重，不建议）**：从注册表反推 preload 桥。
**建议 A**；B 会动 preload 的 CJS/asarUnpack 边界（AGENTS §7.10），风险不成比例。

### C2-3 领域仓储（Repository）能力面缺一个显式契约 ★★本轮最值得讨论的一项

**证据**：
- 桌面：`electron/store.ts`（1364 行）+ `noteQueries/noteMetadataRepository/trashRepository/historyRepository/searchRepository/assetRepository/resourceRepository/settingsRepository`
- 移动：`src/mobile/` 下 `noteRepository / treeRepository / trashRepository / historyRepository / quickNotesRepository / notebookTreeRepository / orphanAssetRepository / gcRepository / diagnosticsRepository`（**9 个**）
- `src/core/ports.ts` 只有 `CachePort` / `AppInfoPort`；**没有 `NoteRepository` / `TreeRepository` 契约**。

**定性**：两端实现了**同一组领域操作**（建/读/存/移/删/恢复/历史），但**没有共享接口**——
所以「桌面支持的语义，移动端是否支持」只能靠人读代码比对。这正是 HANDOFF 反复出现
「移动端漏了 X」「两端行为不一致」类缺陷的**结构性原因**（如 F16 互斥域、只读闸门、墓碑语义）。

**方案（建议分两步，先证价值）**：
① **不重构实现**，只**把契约显式化**：在 `src/core/ports.ts` 增加 `NoteStorePort` / `TreeStorePort` 接口（
  方法签名 = 当前两端**都已实现**的交集，先求同不求全）；
② 用**类型断言**把桌面对象与移动对象各自 `satisfies` 该端口（不改运行时行为）；
③ 再补一个「能力矩阵测试」：对每个端口方法断言两端都实现 ⇒ **漂移立刻红**。
**代价**：接口文件 + 2 处 `satisfies` + 1 个测试；**收益**：两端语义差异从「靠人读」变成「编译期 + 单测」。
**风险**：若强行要求两端签名完全一致，会把移动端特有参数（如 native sqlite 批处理）挤进接口 ⇒
**因此第一步只收交集，差集单独列成「已知差异表」**（不塞进接口）。
**这一项建议先讨论、后动手**（改动面涉及 core 类型 + 两端实现文件）。

### C2-4 S3 客户端两端实现（`electron/s3Store.ts` 239 行 / `src/mobile/s3Store.ts` 168 行）

**定性**：传输层不同（Node SDK vs Capacitor HTTP），**分成两份是正确的**。
需确认的是**协议层**（manifest 布局、ETag/条件写、错误分类、并发上限 8）是否也各写了一套。
**✅ 已落地（261016）**：对拍表写进 [docs/SYNC-PROTOCOL.md](SYNC-PROTOCOL.md) **§7 S3 传输层：两端对拍**（端口面 + 16 个协议维度逐项判定 + 漂移清单）。
**不合并实现**（传输栈本就不同），只守协议面等价。对拍结论：

- **硬骨头两端一致** ✅：超时（30s/120s）、重试（3）、连通性检查方式（ListObjectsV2 而非 HeadBucket）、gzip 读（按魔数）、
  `maxBytes` 语义（解压后判）、prefix 归属、并发上限 8（在 core，单一来源）。
- **可选端口方法覆盖面不对称不是缺陷**：core 里**没有任何一处**调用 `listObjects`/`deleteMany`/`getObjectToFile`，
  调用方各在两端自己的编排层（移动 `bridge.ts` / 桌面 `s3Maintenance.ts`）。
- **真实漂移 4 处（P1）+ 2 处待决策**：D1 `assertSafeKey` 只在桌面（移动端非 ASCII key 可能让 ListObjectsV2 编码不一致 ⇒ GC 漏看）、
  D4 404 判定两端两套（桌面 `isNoSuchKey` 含 `NotFound`，而桌面注释明确记录七牛/AWS 会返回 `NotFound`）、
  D6 移动端**两套 client 工厂**且设置不同（测连通 vs 真同步口径不一致）、
  D2 `forcePathStyle` 移动端**写死 false**（自建 MinIO 用户在移动端用不了 —— 真实功能缺口，不只是观感）；
  另 D5（移动端 gzip PUT 不带 `Content-Encoding`，当前读侧按魔数兼容 ⇒ 需真云验证再动）、D3/D7 记录。
- **建议顺序**：D6 先让移动端内部自洽 → D1/D4 共用 core 判据 → D2+D3 一起定产品语义 → D5 走真云。
  （**本项只产出对照表，未改任何实现**——漂移修复属后续批次。）

### C2-5 提示/Toast 能力：4 套实现（已定「暂缓」，本轮不重开）

AGENTS §3#10 已登记：`.sync-toast` / `.quick-notes-toast` / `.document-notice-toast` / 移动 `.mobile-toast`。
**保持不做**（验收难 + 跨端写域）。列入 §8。

---

## 4. 议题三：模块划分 / 分层 / 分包

### C3-1 `src/mobile/` 根目录 91 个条目（46 个非测试源码）平铺 ★★最清晰的一项

**证据**：
```
src/mobile/*.ts(x) 非测试源码 46 个：bridge.ts(1095) s3Store.ts(168) noteRepository.ts treeRepository.ts
trashRepository.ts historyRepository.ts quickNotesRepository.ts schema.ts sqliteDb.ts nativeSqlite.ts
persistence.ts viewportShell.ts secretStore.ts keystoreSecretStore.ts … + 7 个 use*.ts
（另有 editor/ home/ notebook/ settings/ ui/ theme/ trash/ bitable/ board/ usheet/ 共 11 个子目录）
```
**定性**：**混合了 5 类职责**：数据仓储（9）、原生桥（5）、持久化/迁移（4）、hooks（7）、杂项（bridge、schema）。
新人无法从目录判断该往哪放。**这是纯组织问题，零行为风险**。

**方案（建议一次搬迁，纯移动文件）**：
```
src/mobile/data/      noteRepository treeRepository trashRepository historyRepository
                      quickNotesRepository notebookTreeRepository orphanAssetRepository
                      gcRepository diagnosticsRepository schema sqliteDb persistence
src/mobile/native/    nativeSqlite nativeSqliteDb nativeSqliteMigration keystoreSecretStore
                      secretStore nativeKeyboard nativeAssetSync sharedContent assetFs
                      s3Store bridge                     ← 或拆 bridge 见 C3-5
src/mobile/hooks/     useAutoSave useAutoSync useBackHandler useCaretIntoView
                      useHorizontalSwipe useKeyboard usePanelDrag viewportShell(→hooks 或 ui)
src/mobile/           MobileApp main（保留入口）
```
**代价**：~46 个文件 + 引用路径改写（大量 import）+ `mobileLayers.test.ts` / `mobileIndependence.test.ts` 路径更新。
**收益**：结构可读；**风险**：低（有 tsc + 全库 1998 例 + 6 态快照兜底）。
**判据**：`tsc` + 全库 vitest + `check:mobilesnap` 6 态 0 差异 + 移动构建。
⚠️ **不要顺手改任何文件名/导出名**（纯搬迁，便于 review）。

### C3-2 `src/components/` 混装「应用屏」与「通用原语」

**证据**：31 个文件里 `Sidebar.tsx(1218)`、`SettingsPanel.tsx(1055)`、`QuickNotesWorkspace.tsx(987)`、`TrashPanel.tsx`、
`AssetsBrowser.tsx`、`SearchPanel.tsx` 是**应用屏**；`settingsPrimitives.tsx`、`colorPalette.css`、
`nodeIcon.css`、`historySnapshotPreview.css`、`markdown/` 是**原语/组件资产**；`ui/` 才是真原语。
另外 `src/components → src/features/*` 有 9 处依赖（`editor` 6 + `quickNotes` 3）。

**方案**：拆 `src/components/app/`（屏）与 `src/components/ui/`（原语）——
但**收益只到「结构更整齐」**，而 AGENTS §3#17 明确把「收益只停在代码更整洁」列为过度设计信号。
**建议：列为「可做可不做」，等用户裁决**；若做，与 C3-1 同批（都是纯搬迁）以免重复付回归成本。

### C3-3 `src/lib/` 有 10 个「一行转发壳」转发 `src/core/`

**证据**（`wc -l` = 1 行）：
`concurrency docStats keyedAsyncQueue markdownClean quickNoteModel requestVersion retry tabLimit tree treeIndex`
全部形如 `export * from "../core/xxx.js";`。

**定性**：这是**历史迁移层**（逻辑从 lib 搬到 core 后留的兼容出口）。它造成「同一个函数有两个合法 import 路径」⇒
新会话容易在 lib 与 core 各建一份。**但每份都仍有消费者**（如 `quickNoteModel` 16 处引用、`tree` 9 处），
**不能直接删**。

**方案（分两步）**：① 先用脚本列出每个壳的实际 import 点；② 逐个把调用方改到 `core/`，
③ 空壳删除。**收益** = 单一 import 路径；**风险** = 低但要改很多文件（机械改动）。
**建议做，独立批次，不带其他改动**。

### C3-4 模块依赖矩阵：**健康，无需整改**（记录备查）

- `core → lib` 6 处**全部是 `import type` / `export type`**（逐条核实：`syncEngineTypes` / `cloudState` / `syncAssets` / `syncModes` / `types.ts` / `quickNoteQueries`）⇒ **无运行时反向依赖** ✅
- 未发现 `core → features/components/hooks` 等分层倒置 ✅
- 最重的边：`hooks → lib`(48) · `components → lib`(42) · `features/bitable → core`(32) · `mobile/bridge → core`(19) —— 都是**正向**。
- 唯一需留意：`mobile/editor → features/editor`(11)，即移动端复用桌面编辑器运行时（`lakeRuntime.ts` 1745 行）——
  **这是有意的**（AGENTS §4：内核运行时不重复造），但意味着**改桌面编辑器会同时影响移动端**，
  属于已知耦合，登记为「注意」而非「整改」。

### C3-5 大文件是否拆分

| 文件 | 行数 | 内部函数/组件 | 判定 |
| --- | --- | --- | --- |
| `src/core/bitableDoc.ts` | 2258 | 139 | 多维表文档模型（序列化/字段/视图/筛选），**高内聚**；拆成「模型 / 序列化 / 迁移」可能值，但它是被测试重度覆盖的单一来源（`bitableDoc.test.ts` 1313 行）⇒ 建议**不动**，除非有具体痛点 |
| `src/features/bitable/BitableEditor.tsx` | 2075 | 55 | 拆点明确（Grid / 视图 / 配置面板 / 拖拽），但 261014 刚接入行窗口、正在稳定期 ⇒ **建议缓** |
| `src/features/editor/lakeRuntime.ts` | 1745 | 23 | 内核接线单一来源，**拆分会分散内核知识** ⇒ 按 AGENTS「一个语义一套实现」**不建议拆** |
| `src/mobile/bridge.ts` | 1095 | 15 | 移动端能力面，**可以按域拆**（notes / tree / quicknotes / assets / sync），但它是 `lakeNativeContract` 的派生源 ⇒ 拆分需同步契约测试。**建议列为可选** |
| `src/components/Sidebar.tsx` | 1218 | 29 | 261013 刚做过 memo 优化 ⇒ **不要碰**（回归风险 > 收益） |

**结论**：**本轮不建议为「行数」拆文件**。只建议 C3-1/C3-2/C3-3 这类**目录级**重组。

---

## 5. 议题四：前端样式 review（根位置 / 层层套 / `!important`）

### C4-1 `!important` 现状：**30 条，全部有就地理由 —— 红线没破** ★澄清项

**证据**（去注释后精确统计，比 grep 的 83 命中真实得多——另有 53 处只是注释里的**讲解**）：

| 文件 | 条数 | 是否压内核/第三方/内联 |
| --- | --- | --- |
| `mobile/editor/edit-surface-kernel.css` | 15 | ✅ 压内核注入的未分层样式（文件头写明） |
| `styles/components.css` | 5 | ✅ 1 条压 JS inline 宽度；4 条 `.seg__item`（见下） |
| `styles/tokens.css` | 3 | ⚠️ 见 C4-2 的「疑似死规则」 |
| `styles/compat.css` | 1 | ⚠️ `.fn__none{display:none!important}` 见下 |
| `styles/app/quick-notes.css` | 1 | ✅ 压内核 legacy 的 `position:fixed!important` |
| `features/usheet/usheetEditor.css` | 1 | ✅ 压内核写进行内样式的 `height:36px` |
| `mobile/mobile.css` | 2 | ✅ 压内核 `.ne-ui-boundary-popover` 定位 |
| `mobile/theme/dark.css` | 2 | ✅ 深色内核变量覆写 |
| **合计** | **30** | 28 条理由成立 |

**逐条可再评估的 2 组**：
1. `styles/compat.css:57` `.fn__none{display:none !important}`：
   该文件在 `layer(legacy)`。若 `.fn__none` 的唯一来源也是 legacy 层/未分层，则**普通声明即可**（未分层 >
   分层；同层靠顺序）。**建议实测验证后去掉**（保留 JSX 类名契约不变）。
2. `styles/components.css:308-309` 4 条 `.seg__item`：
   注释自己写明「这两个面板已不是横向 tab」——**`.ln-tabs` 接管横向页签后，`.seg` 的受众已收窄到
   「取值选择/图标型开关」**（设置页主题三选一、小记列表·卡片版式）。受众收窄 ⇒ **是否还需要这 4 条 !important 值得重测**。
   注释还记着一条事实：`.is-active` 里的 `color/background/border-color` **是被上面 !important 压死的死声明**——
   即**当前存在「注释宣称的设计意图」与「实际生效值」不一致**。这属于**清理项**，不是新增抽象。

**建议**：本轮只做「**验证后删**」两处，不新增任何 `!important`。

### C4-2 护栏口径漏洞：`ui-metrics` 的**颜色/!important 只覆盖入口图 33 个文件** ★★机制问题

**证据**（`scripts/ui-metrics.mjs:68`）：
```js
const desktopGraph = desktopCss.filter(p => reachableCss("src/styles/index.css").has(p));
const d = scan(desktopGraph);          // ← 颜色字面量 + !important 用这个集合
const fontSizeLiterals = … fontScope … // ← 字号却用「全部桌面 CSS」
```
- 桌面 CSS 共 **58 个**（73 − 14 移动 − 1 vendor）；`desktopGraph` 只有 **33 个**（就是输出里那个「样式文件 33」）。
- **不在图里的 25 个**包括 `features/bitable/*.css`(15) · `features/usheet/usheetEditor.css` ·
  `components/nodeIcon.css` · `components/colorPalette.css` · `components/markdown/markdown.css` ·
  `features/board/boardEditor.css` · `features/editor/noteRefCard*.css` 等（**组件直接 import，不走 index.css**）。
- **口径差实证**：官方输出「桌面 `!important` 10 / 目标 ≤10」，而真实桌面是 **11**——
  漏掉的正是 `features/usheet/usheetEditor.css:82`。**该文件自己的注释已经发现这件事**。
- 同源问题：**颜色字面量**护栏也只覆盖这 33 个文件（本次全量扫描确认那 25 个文件当前恰好 0 违规，
  所以「数字没骗人」，**但护栏是漏的**）。

**方案**：把 `scan()` 的输入从 `desktopGraph` 改成 `fontScope`（即「全部桌面 CSS，排除仅移动端的 b3」），
与字号护栏口径统一；输出里「样式文件 N」保留入口图 + 另列「实际扫描 M」。
**代价**：1 处改动 + 基线数字从 10 → 11（需同步 AGENTS §3#14 的「≤10」表述为「≤11 或先删掉那 1 条」）。
**建议**：**先修护栏口径，再谈清理**——否则清理成果无法被守住。

### C4-3 `src/mobile/mobile.css` 有 28 个颜色字面量 —— **唯一真实违规** ★★★

**证据**（去注释、非主题文件）：
```
src/mobile/mobile.css  28 处  ["#fff","rgba(16,24,40,.05)","#5b8def","#dfa03c", …]
（其余非主题文件全部 0 —— 桌面 0，移动其他文件 0）
```
**定性**：AGENTS §3#14 红线「**颜色字面量只允许出现在 `src/styles/themes/*`**」——
移动端对应物是 `src/mobile/theme/**`（`tokens.css` 134 个令牌 + `light`/`dark`）。
`mobile.css` **不是**主题文件 ⇒ **28 处全部是违规**。桌面有硬护栏（目标 0），**移动端没有颜色护栏**
（`ui-metrics` 对移动只统计 `var(--b3-*)` 与 `!important`，不统计颜色字面量）。

**方案**：
① 先从 28 处里**分类**：a) 本该有令牌（`#fff` → `--lake-bg-panel`/`--lake-text-on-accent`）；
   b) 数据驱动的（如「＋」号专用绿 `#00B96B` —— 用户 261012 已定「只有 + 号用绿」，它是**有意偏离**，
   应在 `mobile/theme/tokens.css` 定义 `--mb-brand-add` 之类并注明偏离理由）；c) 阴影/半透明
   （`rgba(16,24,40,.05)` → 应走与桌面同源的阴影令牌）。
② 逐类换令牌；**不改变任何观感**（令牌值 = 当前字面值）。
③ **给移动端补一条颜色护栏**（与桌面同口径：非 theme 文件 0 字面量）。
**验收**：`check:mobilesnap` 6 态 0 差异 + 走查 23 屏五类探针全 0 + 新护栏恒 0。

### C4-4 「层层套」的真实规模：跨文件重复 288 组 / 9,199（**3.1%**）

**证据**：同一 `(选择器, 属性)` 出现在多个文件里共 **298 组**（全部对 9,190）；
分布 = **298 组全部是「恰好 2 个文件」**。
**其中最大的一块是跨端复制**（见 C4-5），**桌面内部**的跨文件重复很少。
（口径说明：初稿用「整块删除 at-rule」的粗略算法得 288，会把 `@media` 内的规则整段漏掉；
B0 已换成正确的规则提取器 `extractRules()`，基线随之定为 **298**。）

**⚠️ 261016 口径再修正（被 C4-5 修复当场逼出来的）**：补 `.editor-error` 到移动端时，这个棘轮**误报**了——
它把「桌面与移动写同一批结构类名」也算成「层层套」，而那是**设计允许**的（用户 261012「逻辑共享、外观各端自有」），
C4-5 护栏甚至**要求**两端都写。实测：全量 308 组里，**纯跨端 295 组、同一端内只有 13 组**。
⇒ 口径改为**只统计同一端内**（桌面 ≥2 文件 或 移动 ≥2 文件），基线 **298 → 13**；跨端组数单独统计、不判失败。
自证：同一端内造重复 ⇒ 14 > 13 失败；纯跨端造重复 ⇒ 13、不失败（不误伤）。

**关键机制问题**：现有护栏 `src/styles/cssLayers.test.ts` 的 `dupGroups` 是**按文件内**统计的
（`scan(css)` 每个文件独立跑，`props` 是局部 Map）——**跨文件覆盖完全不在围栏内**。
这正是用户担心的「一层层套 CSS」**唯一没有护栏的形态**。

**方案**：把「跨文件重复 (选择器,属性)」做成**只许降的棘轮**。**✅ B0 已落地**（并入 `scripts/ui-metrics.mjs`，
基线 298，新增跨文件覆盖即 exit 1）。**收益**：把红线变成可执行判据——这是本轮**性价比最高的机制补强**。

### C4-5 跨端 CSS 复制：141 / 79 / 55 组 —— **已定稿，不合并**

**证据**：
```
src/styles/app/quick-notes.css      <-> src/mobile/quick-notes.css      141 组
src/features/attachment/attachment-preview.css <-> src/mobile/features.css  79 组
src/features/editor/image-lightbox.css         <-> src/mobile/features.css  55 组
```
**定性**：**这是有意设计**（`src/mobile/features.css` 头注释 + `mobileIndependence.test.ts` 明令移动端不得 import 桌面样式；
用户 261012 定「逻辑共享、外观各端自有」）。⇒ **不合并、不抽共享 CSS**。
**✅ 护栏已落地（261016）**：判据改成「**共享组件发出的结构类名**」（比"两个 CSS 文件做 diff"精确得多）——
新建 `src/styles/crossEndClassCoverage.test.ts`，三件事：
① 移动端 import 到的 UI 组件里，凡会发出自有静态类名的**必须登记进 SHARED**（防清单腐烂）；
② 登记过的组件必须仍被移动端使用（防僵尸清单）；③ 每个结构类名**两端都必须有规则**，新增缺口直接失败、已知缺口只许减。

- 用**路径解析**（不是文件名匹配）得到真实的共享 UI 组件集合 = **5 个**：AttachmentPreview / ImageLightbox /
  LakeEditor / QuickNoteEditor / QuickNotePreview（共 34 个自有结构类名）。
- **当场查出 1 处真实且可达的缺口**：`LakeEditor.tsx:185` 在 error 态渲染 `.editor-error`，桌面有规则（`styles/app/misc.css:8`），
  但**移动端没有**；而移动端确实会挂 LakeEditor（`mobile/trash/TrashPreviewPage.tsx:7`，回收站预览）⇒
  内核加载失败时移动端会渲染成**裸元素**（无红底、无内距）。**当天即修（261016 用户批准）**：在 `src/mobile/features.css` 按移动端令牌补了 `.editor-error`（+10 声明，属新增样式非覆盖），`KNOWN_GAPS` 随之**清空**；并给护栏补了「**表项修好后必须从 KNOWN_GAPS 删掉**」判据，防止豁免清单腐烂。
- 只统计**字符串字面量**类名，条件/拼装类名一律跳过 ⇒ **宁可漏报也不误报**（自证：注入单向类名 ⇒ 失败；取消登记 ⇒ 失败；恢复 ⇒ 0）。
- 顺带说明为什么不能靠"两个 CSS 文件相似度"判据：那三对文件的重复本来就是**有意的**（用户 261012 定「逻辑共享、外观各端自有」），
  真正的不变量是**覆盖**而不是**一致**。

### C4-6 「根位置修改」纪律：**已在执行，无需新机制**

证据：`kit.css` 的 `.ln-*` 原语收编（260930 大统一，overlay −29 / chrome −39 / bitableEditor −63）、
`@layer` 层序替代特异性、`!important ≤10`、`styles/*` 单一来源注释遍布。
**结论：这条纪律是达标的**，问题只在**护栏覆盖**（C4-2）与**存量违规**（C4-3）。

---

## 6. 议题五：样式统一（选中态等收归令牌）

### C5-1 选中态仍分散在 41 处 / 17 个文件

**证据**：
```
.is-selected   17 处 / 9 文件    components/colorPalette nodeIcon; features/bitable(2 文件);
                                 outline; mobile/kit(2) mobile/mobile mobile/ui/nodeIcon; styles/kit(6)
.is-active     18 处 / 12 文件   nodeIcon bitableEditor mobile/kit(2) mobile/mobile mobile/quick-notes
                                 app/quick-notes app/shell chrome(2) components(2) dialog kit(4) overlay
.is-disabled    8 处 / 1 文件    styles/kit.css   ← 单一来源（样板）
```
**好消息**：`styles/kit.css:137-143` **已经是选中三元组的单一来源**（注释写明：260930 把 4 处收成一处的
`accent-text + accent-tint + 600`），且配对纪律良好——**`accent-tint` 底 + `accent-text` 字 = 15 处，
`accent-tint` 底 + 裸 `accent` 字 = 0 处**。

**方案（建议只做「补齐」，不做「重构」）**：
① `.is-selected` 剩余的 8 个文件逐个核对：能挂 `.ln-row.is-selected` / 移动 `.mb-row.is-selected` 的**就地改类名**，
   不能的（彩色色板、节点图标网格 —— 它们是**图形选择**不是「行选择」）在 §9 逐条裁决；
② `.is-active` 里 `mobile/*` 的一批（`.bottom-bar-btn.active`、`.mobile-drawer-tabs button.active`、
   `.mobile-bottom-bar__item.active`）**是移动端选中态**，应统一到移动端原语（`mb-*`），而不是各写各的。

### C5-2 建议补的令牌族（**这是「收归令牌管理」的核心动作**）

现状：状态语义靠**组合已有令牌**表达（`--lake-accent-tint` + `--lake-accent-text`），
且**没有 `--lake-bg-selected` / `--lake-state-*` 家族**。可用令牌（已定义，两端各 134/136 个）：

```
--lake-bg-{panel,window,block,subtle,sunken,raised,canvas}
--lake-bg-hover(95 次) --lake-bg-press          ← 有 hover/press，没有 selected
--lake-accent(180) --lake-accent-text(45) --lake-accent-tint(71) --lake-accent-ink(-hover/-press)
--lake-text-1..4 --lake-disabled-opacity --lake-focus-halo/ring
```

**建议**：新增 **3 个语义别名**（值 = 现有值，零观感变化）：
```
--lake-bg-selected:   var(--lake-accent-tint)
--lake-fg-selected:   var(--lake-accent-text)
--lake-bg-selected-hover:  <浅一档>      ← 需先确认设计取什么值
```
然后要求「选中态只用这 3 个 + 字重」，配合 C4-4 的跨文件棘轮把分散实现**只许降**。
**代价**：3 行令牌（桌面 + 移动 theme 各一份 = 6 行）+ 收编调用点；**收益**：选中态从 41 处降到可枚举的一处来源。
⚠️ **风险/需用户裁决**：`--lake-accent-tint` 在深色下是 `rgba(154,171,206,.15)`，
「选中底 + hover 底」叠加时是否需要单独一档浅色 —— **这是设计问题，须用户定**，我不擅自定值。

### C5-3 规则与实现冲突：文字色误用裸 `--lake-accent` **36 处** ★★

**证据**（精确统计，排除 `border-color`）：
```
文字色 = var(--lake-accent)      36 处   ← 违反规则
文字色 = var(--lake-accent-text) 45 处   ← 正确口径
border-color = var(--lake-accent) 28 处   ← 合法（图形/边框）
```
典型违规点：`mobile/editor/editor-dock.css`（`.med-btn.med-active`、`.med-f-btn.med-f-on`、
`.med-doc-item.med-active`）· `mobile/mobile.css`（`.bottom-bar-btn.active`、`.mobile-bottom-bar__item.active`、
`.mobile-trash-action`、`.mobile-search-snippet mark`）· `styles/app/quick-notes.css`（`.quick-notes-tool-btn.is-on`）·
`features/bitable/*`（`.bt-link-open:hover`、`.bt-add-round:hover`、`.bt-icon-btn.is-on`）。

**规则出处**：AGENTS §3#14 ——「**文字一律用 `--lake-accent-text`**；`--lake-accent` 只做图形/边框/焦点环/底纹」。
**定性**：真违反，且**移动端占多数**（与 C4-3 同源：移动端缺同类护栏）。
**方案**：36 处逐条换成 `--lake-accent-text`（**注意深色下两者取值不同**，换完必须跑移动 6 态 + 桌面相关态对拍，
不能盲改）；换完把该判据加入护栏（扫描：非 theme 文件里 `color: var(--lake-accent)` 必须为 0）。

### C5-4 移动端令牌与桌面令牌「同名不同源」

**证据**：桌面 `themes/base.css` 136 个 + `light/dark/warm` 各 52/62/52；
移动 `mobile/theme/tokens.css` 134 个 + `light/dark`。**同名令牌（`--lake-bg-hover` 等）在两个 theme 目录各定义一份**，
取值部分相同（`light` 下 `--lake-bg-hover` 两端都是 `#f0f1f3`）、部分不同（深色 `--lake-accent-tint` 两端相同）。

**定性**：**这是有意设计**（移动端自有取值层，`MOBILE-TECH-STACK §九` 与 `mobileIndependence.test.ts` 已固化）⇒ **不改**。
**唯一建议**：登记一张「同名令牌取值差异表」（自动生成即可），让「有意不同」与「漂移」可区分。

---

## 7. 建议批次顺序（**先护栏，后清理**）

| 批次 | 内容 | 风险 | 可独立验收 |
| --- | --- | --- | --- |
| **B0 护栏** ✅ **已完成 261016** | C4-2（ui-metrics 口径统一）· C4-4（跨文件重复棘轮）· C4-3③（移动颜色护栏）· C5-3 判据 | 低 | 是（只加指标与门禁） |
| **B1 抽提** ✅ **已完成 261016** | C1-2 `formatBytes`（拆成两个显式口径）· C1-3 `escapeId` · C1-4 **小记 key**（最高价值）· C1-1 `nowIso` **判定不做**（§B1 有意未做①） | 低 | 是 |
| **B2 样式合规** ✅ **261016 两批完成**（第一批：移动颜色 28→0 + 13 处过期兜底；第二批：Q2 允许清单 + Q4 36 处字色→accent-text）／仅剩 Q3 待裁决 | C4-3 ✅ · C5-3 ✅（基线 0）· Q2 ✅（允许清单）· C5-1/C5-2 🔶（选中态收编与语义令牌，随 Q3） | **中**（视觉） | 视觉装置待补跑 |
| **B3 结构搬迁** | C3-1 `src/mobile` 分目录 · C3-3 `src/lib` 转发壳 | 低（纯移动） | 是 |
| **B4 契约显式化** | C2-3 Repository 端口 · C2-2 IPC 通道常量表 | 中 | 是 |
| **B5a 跨端契约** ✅ **已完成 261016** | C4-5 跨端共享组件的**样式覆盖护栏**（3 判据 + 零误报自证；顺带查出 `.editor-error` 缺口） | 低（纯测试） | 是 |
| **B5 待裁决** | C3-2 `components` 拆分 · C3-5 bridge 拆分 · **C1-6 只读单元格共享** · C1-7 属性清单 · 是否修 `.editor-error` | — | — |

---

## 8. 已定稿、**不再讨论**的边界（防重开）

1. **移动端不共享桌面样式**（`mobileIndependence.test.ts`）⇒ 跨端 CSS 复制**保留**，只谈漂移护栏（C4-5）。
2. **移动端设置页原语自建**（`settingsPrimitives` 两端 fork，用户 261012 定）⇒ **不合并**。
3. **提示/toast 不统一**（AGENTS §3#10 已登记暂缓）⇒ 不重开。
4. **内核 vendor 只做最小改动**（`LOCAL-CHANGES.md`）⇒ 不动 vendor、不升级内核。
5. **不清理第三方/依赖侧死代码**（AGENTS §3#18）。
6. **不为行数拆大文件**（本文件 §4 C3-5 结论）。
7. **`!important` 不是「滥用」**——30 条中 28 条理由成立；只做「验证后删」，不批量去 important
   （`components.css:298-307` 已记录 260923 批量去 important 导致宽度 1000→840 的教训）。

---

## 9. 待裁决问题清单（逐项讨论用）

| # | 问题 | 我的建议 | 需要用户定什么 |
| --- | --- | --- | --- |
| Q1 | 先做哪些批次？ | **B0 + B1**（护栏 + 抽提，零视觉风险） | 是否同意「先护栏后清理」 |
| Q2 | ~~桌面 `!important` 从 10 → 11 怎么办？~~ | ✅ **已决（261016，用户授权我定）**：数字上限改为**逐条有理由的允许清单**（11 条，清单外新增直接失败）——用户定「确实有必要用可以保留，不是一点不能用」。见 §B2 第二批 | 无需再裁决 |
| Q3 | 是否新增 `--lake-bg-selected` / `--lake-fg-selected` / `--lake-bg-selected-hover`？后者取什么值？ | 🕓 **待你考虑（261016 用户要求先记录、暂不实施）**：三套主题的真实合成值 + 三候选对比见 §Q3；推荐 A = `color-mix(tint 88%, accent 12%)`（不引入颜色字面量） | 选 A/B/C；是否要 hover 变体 |
| Q4 | 36 处字色是否换成 `--lake-accent-text`？ | ✅ **已实施（261016 用户批准）**：36 处全换、基线 36 → **0**；实测**只有暖色从不达 AA 变达标**（浅/深本就达标，只变观感）。视觉装置未跑，已在 §B2 第二批如实登记 | 无需再裁决；正式验收前建议补跑受影响态 |
| Q5 | ~~是否加「跨端结构类名漂移护栏」？~~ | ✅ **已落地（261016）**：`src/styles/crossEndClassCoverage.test.ts`（3 判据、零误报自证），当场查出 `.editor-error` 移动端缺口并**当天修掉**（`KNOWN_GAPS` 已清空） | 无需再裁决 |
| Q6 | C2-3 Repository 端口是否只收「交集」、差集单列成表？ | 是（避免为统一而扭曲签名） | 是否同意这个克制的口径 |
| Q7 | C1-6 移动端只读单元格复用桌面只读渲染（共享逻辑、不共享样式）？ | 做（桌面已有 readOnly 分支） | 是否认可边界 |
| Q8 | C3-1 `src/mobile` 目录重组（46 文件纯搬迁）本轮做不做？ | 做（低风险，独立批次） | 排期 |
| Q9 | C3-2 `src/components` 拆 `app/` + `ui/`？ | **倾向不做**（收益只到「更整洁」） | 裁决 |
| Q10 | C1-5 时间格式：桌面与移动列表的时间措辞是否要求一致？ | 先只抽纯函数，不动产品口径 | 产品口径 |

---

## 10. 附：本次 review 的原始数字（便于复核）

- `!important` 真实声明 **30**（桌面 11 / 移动 19）· grep 命中 83（53 为注释讲解）
- 非主题颜色字面量：桌面 **0** · 移动 **28**（全在 `mobile/mobile.css`）
- 字号字面量：桌面 **0** · 移动 **46**（`mobile.css` 38 + `editor-dock.css` 8，基线 49）
- 跨文件重复 `(选择器,属性)`：**13** / 9,205（**同一端内**；261016 口径修正后。全量含跨端 308 组，其中纯跨端 295 组按设计允许 —— 见 C4-4）
- 跨端复制：quick-notes **141** · attachment-preview **79** · image-lightbox **55**
- 状态类：`is-selected` 17/9 · `is-active` 18/12 · `is-disabled` 8/1 · `is-on` 5 · `is-checked` 4 · `is-open` 2 · `is-current` 1 · `is-dragging` 3
- 字色误用：裸 `--lake-accent` **36** · `--lake-accent-text` **45** · `border-color` 用 accent 28（合法）
- IPC：注册 **116** = 暴露 **116**，漂移 **0**
- 同名函数跨文件定义 **147** 组（人工筛出真问题 7 组）
- 模块依赖：`core → lib` 6 处于**全部 type-only**，无反向运行时依赖
- CSS 孤儿文件 **0**（73 个全部被 import）
