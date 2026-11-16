# 移动端加载动效：6 个模式对标审计 + 首批落地（261116）

> 输入：用户给的加载动效提示词模板（骨架屏 / 进度条 / 延迟加载 / 乐观更新 / 下拉刷新 / 空状态）。
> 本文回答两件事：**哪些值得做**（含明确「不做」及理由），以及**首批已落地什么**（代码位置 + 设备验收）。
> 纪律：本文所有数值已换算成本仓动效令牌（AGENTS §3#14），**不照抄**模板里的 400/1200/1300ms 与弹簧参数；
> 未改 `src/mobile` 之外任何样式层（桌面 `kit.css`/`feature.css` 属另一条线）。

## 0. 结论先行

| 模式 | 现状（审计结论） | 判定 | 首批动作 |
|---|---|---|---|
| ① 骨架屏 | 已有 4 处：冷启动结构等价骨架、小记写作卡、AI 分页、内核就绪前盖层（§2.1） | **不加**（现有足够；列表来自本地 SQLite，加骨架只会多闪一次） | 无（只写结论） |
| ② 进度条 | 已有真实百分比先例（首拉同步条 `.mobile-sync-strip`，读真实 pct）；便携包导入只有 phase 文本 | **做「如实的阶段指示」**（无字节/行总数，不画假百分比） | ✅ C：7 段阶段条 + 「第 n/7 步」 |
| ③ 延迟加载 | **多处立刻闪「正在加载…」**：PanelLoading、5 处 Suspense 兜底、回收站预览、表格初始化（§2.3） | **最值得做**（移动端分包与本地读通常 <300ms，闪光最明显） | ✅ A：可复用 hook + 8 处接线 |
| ④ 乐观更新 | **已存在且已覆盖关键交互**：设置历史、tab 点击、目录拖拽重排、表格撤销计数（§2.4） | **不做**（不缺模式，缺的是统一改造收益） | 无（只写结论） |
| ⑤ 下拉刷新 | **无**；列表读本地 SQLite、同步是后台任务，手动刷新入口 = 云同步按钮 | **不做**（与「本地是真相」冲突，见 §2.5） | 无（只写结论） |
| ⑥ 空状态 | `.mb-empty` / `EmptyState` 已收口（图标+说明+CTA），**无入场** | **做**（一级空间空态补入场，动效只 1 条规则） | ✅ B：4 个一级空间空态 250ms 上浮+淡入 |

**一句话**：模板 6 条里，本仓真正缺的只有 **③ 延迟加载** 与 **⑥ 空状态入场**；② 只有「阶段指示」性价比够；①④⑤ 现状已覆盖或不适用 —— 不为迎合而加。

---

## 1. 用户模板数值 → 本仓令牌换算（偏差说明）

本仓动效唯一来源：`src/mobile/theme/tokens.css#L66-L76`（与桌面 `src/styles/themes/base.css#L72-L82` 同值同义）。

- 时长：`--mobile-duration-panel: 250ms`；`--lake-motion-fast/panel/slow = 250ms`；`--lake-motion-instant: 80ms` / `--lake-motion-press: 90ms` **只给按压物理反馈**。
- 曲线：`--mobile-ease-out: cubic-bezier(.22, 1, .36, 1)`（强 ease-out）；`--lake-ease-*` 在 261029 已统一为 `ease-out`，**不再有过冲/弹簧**。

| 用户模板 | 本仓落地值 | 偏差 / 理由 |
|---|---|---|
| 入场 400ms | **250ms**（`--mobile-duration-panel`） | −150ms（−37.5%）。红线：入场统一 250ms；400ms 在手机上会显得「拖」。 |
| 加载阈值 1200ms 才显示加载态 | **300ms**（`LOADING_DELAY_MS`） | −900ms。1200ms 是弱网 Web 口径；本仓列表/分包多数 <300ms，等到 1200ms 等于让用户对着空屏发呆。300ms ≈ 人类「瞬时」感知边界。 |
| 骨架/加载态最短 1300ms（模板保持时长） | **500ms**（`LOADING_MIN_VISIBLE_MS`） | −800ms（−62%）。1300ms 会把「其实已经好了」也按住；500ms 足够覆盖一次 250ms 入场且不拖沓。 |
| 入场 1200ms 大动画（模板） | 不采用 | 与「只保留入场与位移、统一 250ms」直接冲突。 |
| 弹簧 stiffness 320 / damping 10 | **不用弹簧**：`cubic-bezier(.22, 1, .36, 1)` 强 ease-out | 261029 动效收敛后全仓无弹簧/无过冲（`--lake-ease-overshoot` 已等于 ease-out）。弹簧的跟手感只保留在**按压**（90ms transform 微缩放），不用在入场。 |
| 骨架 shimmer 1.2s 循环 | 沿用现状 `.mb-skel` 的 **1.4s opacity 呼吸** | 不加第二套 shimmer（红线：不做装饰性过渡；现有呼吸已足够）。 |
| 进度条宽度过渡 | 沿用 `.mobile-sync-strip__bar > span` 的 **250ms ease-out width 过渡**（既有先例） | 本次 C 只做 7 段填充，不加新动画。 |

**行为阈值不是动画令牌**：300/500 是「显示/保持」的判据（写在 `src/mobile/ui/delayedLoading.tsx#L19-L22`），不占 `--lake-motion-*` 位；动画仍全部走令牌。

---

## 2. 逐项审计（file:line）

### 2.1 骨架屏 —— 已有 4 套，不扩展

| 场景 | 位置 | 说明 |
|---|---|---|
| 冷启动首页 | `src/mobile/mobile.css#L28`（`.mb-skel`）+ `src/mobile/MobileApp.tsx#L905-L915`（`.mb-route-skeleton__*`） | 结构等价、尺寸同源的静态骨架（261013），避免「启动中…」→首页整屏跳一次 |
| 小记写作卡 | `src/mobile/home/QuickNoteComposerSkeleton.tsx` | 懒加载壳与内核初始化共用同一份骨架（261019/261022），骨架→写作卡不白闪 |
| AI 分页 | `src/mobile/mobile.css#L1061`（`.mb-ai-pane-skeleton`） | 懒 chunk 未就绪 |
| 表格/多维表 | `src/mobile/usheet/*`、`src/mobile/bitable/*` 内部行骨架（`.mb-skel--row` 等） | 已有 |

**结论：不扩展到首页/小记列表。** 理由：移动端列表数据来自本地 SQLite + 已有首屏预热（`quickNoteDetailPrewarm` 等），首帧基本 1 帧内出数据；再加骨架 = 给「本来不慢」的路径加一层闪烁，且违反「不为迎合而加」。

### 2.2 进度条 —— 有真实数据的才画，本次只做阶段指示

- 已有**真实百分比**先例：首拉同步条 `src/mobile/home/HomePage.tsx#L795` + `src/mobile/mobile.css#L163-L176`（`.mobile-sync-strip`：读真实同步 pct；无 pct 时 `is-indeterminate` 走 40% sweep）。
- 便携包导入：`src/mobile/portable/importPortable.ts` 的 `PortableImportProgress` **只有 `phase` + `detail`**，没有字节数/总行数 ⇒ 画百分比就是编造。
- 本次落地：`src/mobile/settings/portableImportStep.ts`（7 阶段顺序单一来源 + 测试卡住顺序）+ `src/mobile/settings/PortableImportSection.tsx#L156-L166`（「第 n/7 步 · 阶段：detail」+ 7 段指示条，`aria-hidden` 装饰、语义只由文本给）。
- **没做**：为导入流程补「总行数/总字节」进度回调 —— 那要改 `importPortable` 的管线签名与回滚语义，超出「加载动效」范围；等有真实需求再立项。

### 2.3 延迟加载 —— 本次核心（A）

审计到的「立即闪加载态」清单（已接线 8 处，均在 `src/mobile/**`）：

| 位置 | 原行为 | 现在 |
|---|---|---|
| `src/mobile/ui/PanelLoading.tsx#L10`（设置/搜索面板懒加载壳） | 打开即显示「正在加载设置/搜索…」 | **壳立即出现**（标题/返回/关闭 = 即时反馈），正文延迟 300ms |
| `src/mobile/settings/SettingsDrawer.tsx#L832`、`src/mobile/MobileApp.tsx#L936`（回收站/文档预览懒加载，2 处） | 立即「正在加载预览…」 | `DelayedLoading` 300ms 后显示 |
| `src/mobile/notebook/NotePaneHost.tsx#L77/#L91/#L106`（手写板/多维表/表格分包，3 处） | 立即「正在加载手写板/多维表/表格…」 | `DelayedLoading` 300ms 后显示 |
| `src/mobile/trash/TrashPreviewPage.tsx#L31`（回收站预览读正文 + 补拉资源） | 立即 spinner +「正在加载资源…」 | `useDelayedLoading`：<300ms 直接出正文；显示后至少 500ms |
| `src/mobile/usheet/MobileUsheetViewer.tsx#L114`（Univer 初始化） | 立即「正在加载表格…」 | `useDelayedLoading`：快机直接出表格；显示后至少 500ms |

复用件：`src/mobile/ui/delayedLoading.tsx`（`LOADING_DELAY_MS=300` / `LOADING_MIN_VISIBLE_MS=500` / `useDelayedLoading(loading)` / `DelayedLoading`）。

- 状态驱动用 hook（能延住 500ms）；Suspense 兜底用 `DelayedLoading`（**组件被父级卸载即消失，无法延住**——不伪造「保持」）。
- 未接线的地方（`NoteInfoSheet`/`NoteTagsSheet`/`SearchSheet` 等「读取中…」）：它们各自有**立即断言加载态**的渲染测试，且本地读一般 <1 帧；本批不动，避免为动效改测试语义。后续要收口时走同一 hook。

### 2.4 乐观更新 —— 已有，不重复造

现有实现（审计到 4 类）：`src/mobile/settings/useSettingsSectionData.ts#L59`（历史设置乐观更新 + 失败回读）、`src/mobile/home/tabPager.ts`（tab 点击乐观置位）、`src/mobile/notebook/useTreeDrag.ts#L92`（拖拽乐观重排，松手即生效）、`src/mobile/usheet/MobileUsheetViewer.tsx#L377`（撤销计数乐观）。
**结论：不做。** 模式不缺；统一改造只会增加回滚复杂度（且本仓已有「失败回读真实值 + 提示」的护栏）。

### 2.5 下拉刷新 —— 不做

- 现状：无 `pull-to-refresh` 实现；列表读本地 SQLite（本地即真相），同步是后台任务（AGENTS §4：开/关应用各同步一次 + 手动同步入口）。
- 下拉刷新的语义 = 「向下拉 ⇒ 联网取最新」；本仓的「最新」由本地库决定，拉到网络数据只会与本地三方合并 —— 这是**同步**问题，不是列表刷新问题。真做 = 把同步语义伪装成手势，且会增加一次网络往返与冲突面。
- 已有替代入口：云同步按钮 + 同步状态条（`HomePage` 顶栏/`.mobile-sync-strip`）+ 设置页「立即同步」。

### 2.6 空状态 —— 本次落地（B）

- 现状：`src/mobile/ui/EmptyState.tsx`（唯一容器）+ `src/mobile/kit.css#L296-L304`（`.mb-empty` = 图标 + 说明 + CTA；`--inset` 变体）。全仓 40+ 处使用。
- 缺：入场。补：`kit.css#L303-L310` 新增 `@keyframes mb-empty-in`（`opacity 0→1` + `translateY(6px)→0`，250ms `--mobile-ease-out`，`both`）；`EmptyState` 新增 `enter` 属性（**默认关**，只有显式开启才动）。
- 接线 4 个一级空间空态（首次进入空空间时可见）：`HomePage.tsx#L902`（小记）、`NotebookGrid.tsx#L49`（知识库）、`TagsHomeTab.tsx#L404`（标签）、`DiaryPage.tsx#L301`（日记）。
- reduced-motion：`src/mobile/mobile.css#L447`（既有名单）关闭 `.mb-empty.mb-empty--enter` 的 animation；**不新增第二套 a11y 机制**。
- **没做**：用户模板里的「可选漂浮动效」—— 无限循环的装饰性位移 = 红线（不做装饰性过渡/动画），且对「刚进入空空间」没有信息价值。

---

## 3. 改动清单（全部在 `src/mobile/**`）

| 文件 | 改动 |
|---|---|
| `src/mobile/ui/delayedLoading.tsx`（新） | 延迟加载 hook + Suspense 兜底组件 + 两个阈值常量 |
| `src/mobile/ui/delayedLoading.render.test.tsx`（新） | 5 个用例：快操作不显示 / 到点显示 / minVisible 延住 / 已满立即消失 / 卸载清理；+ `DelayedLoading` 延迟渲染 |
| `src/mobile/ui/PanelLoading.tsx` | 正文延迟 300ms（壳仍即时） |
| `src/mobile/notebook/NotePaneHost.tsx`、`src/mobile/MobileApp.tsx`、`src/mobile/settings/SettingsDrawer.tsx` | 5 处 Suspense 兜底包 `DelayedLoading` |
| `src/mobile/trash/TrashPreviewPage.tsx`、`src/mobile/usheet/MobileUsheetViewer.tsx` | 状态驱动接 `useDelayedLoading` |
| `src/mobile/ui/EmptyState.tsx` | 新增 `enter` 属性 |
| `src/mobile/kit.css` | `.mb-empty--enter` + 关键帧；`.mb-import-steps*`（+9 声明，基线已登记） |
| `src/mobile/mobile.css` | reduced-motion 名单加 `.mb-empty.mb-empty--enter`（选择器刻意带 `.mb-empty` 前缀，避免与 kit 层形成「跨文件重复(选择器,属性)」——ui-metrics 基线 45 不变） |
| `src/mobile/settings/portableImportStep.ts`（新）+ `.test.ts`（新） | 7 阶段顺序单一来源；测试同时校验 `importPortable.ts` 实际发出的 phase 全部登记 |
| `src/mobile/settings/PortableImportSection.tsx` | 「第 n/7 步 · 阶段」+ 7 段指示 |
| `src/mobile/home/HomePage.tsx`、`src/mobile/home/NotebookGrid.tsx`、`src/mobile/tags/TagsHomeTab.tsx`、`src/mobile/diary/DiaryPage.tsx` | 4 个空态 `enter` |
| `src/mobile/mobileLayers.test.ts` | `mobile/kit.css` 基线 640→649（+9，已写明来由） |

---

## 4. 验收

### 4.1 门禁（本地）

- `npx tsc --noEmit`：通过。
- `npx vitest run src/mobile`：**335 文件 / 1726 用例通过**（3 skipped 为 integration/benchmark 的既有跳过）；含新增 8 个用例。
- `npm run check:mobileui`：**全部通过**（mobileIndependence 5 / mobileLayers 4 / kernelStyleBootstrap 2 + ui-metrics；跨文件重复 45/45、移动端 !important 19/19 均未涨）。
- `git diff --check`：通过。

### 4.2 设备验收（emulator-5554 / lake_mobile，已装包）

- 装包：`bash scripts/android-build.sh --sync --install` → `gradle assembleDebug BUILD SUCCESSFUL` + `adb install -r Success`（未动 Gradle 版本）。
- 设备截图（`adb -s emulator-5554 exec-out screencap -p` 原始 PNG，1080×2400），目录 `/tmp/loading-motion/shots/`：
  - **B（空态入场）**：`01-diary-empty-enter-adb.png`（日记空态）、`02-tags-empty-enter-adb.png`（标签空态）——两个一级空间在开发库上确实为空，进入后看到 `.mb-empty--enter` 稳定帧。
  - **B 动画令牌的设备侧证明**（同一会话 `getComputedStyle('.mb-empty--enter')`）：`animationName: mb-empty-in`、`duration: 0.25s`、`timing: cubic-bezier(0.22, 1, 0.36, 1)`、`fill: both` ⇒ 与 §1 的换算一致（250ms / 强 ease-out，不是模板的 400ms/弹簧）。
  - **A（延迟加载）**：冷 `location.reload()`（清掉懒 chunk）后点「设置」——tap 后 **80ms** 的 CDP 取证 = `{ shell: true, loadingText: false }`（面板壳已出现、**没有闪「正在加载设置…」**）；660ms 时 `mobile-settings-row = 12`（内容已出）。对应 `03-settings-immediate-80ms-cdp.png` / `04-settings-after600ms-cdp.png`（CDP 逐帧补充证据）+ `05-settings-stable-adb.png`（adb 稳定帧）。本轮分包命中磁盘缓存、加载 <80ms ⇒ 正是「快操作直接出结果」的目标行为；「>300ms 才显示」的慢路径由单测覆盖（§3）。
  - **C（阶段指示）**：`07-backup-subpage-adb.png` / `08-portable-import-adb.png` = 设置→备份与恢复→「从便携包导入（覆盖本机）」区块；**阶段条只在真实导入 busy 时出现**（无包无法触发，未伪造导入过程），其结构/文字由源码 + 单测保证。
- 说明：250ms 动画本身只能靠「设备侧 computed style + 稳定帧」证明；不录屏、不做逐帧比对（装饰性取证，收益低）。

### 4.3 mobile snap 10 态影响：**判定不受影响，未重烤基线**

- 快照装置取「元素数 + 计算几何指纹」（`scripts/mobile-audit/mobile-snap.mjs` + `snap-gate.mjs`）；10 态全部是**有数据的首页/工作区/设置**场景，本批 4 个空态（小记空/知识库空/标签空/日记空）不在 10 态内 ⇒ 元素数不变。
- 入场动画终态 = 未动画状态（`animation ... both` 且 `to { opacity:1; transform:none }`）⇒ 即使截到稳定帧，几何指纹与改动前一致。
- 纪律：本批**未执行** `--write-baseline`。若后续把 `enter` 加到 10 态覆盖的空态（或换空库夹具），装置首次截图可能撞上 250ms 动画 → 那时在探针里 `Emulation.setEmulatedMedia` 设 reduce，或等稳定再取。

---

## 5. 复现

```bash
# 类型 + 定向测试
npx tsc --noEmit
npx vitest run src/mobile/ui/delayedLoading.render.test.tsx src/mobile/settings/portableImportStep.test.ts \
  src/mobile/ui/EmptyState.render.test.tsx src/mobile/ui/DeferredPanel.render.test.tsx \
  src/mobile/trash/TrashPreviewPage.render.test.tsx
# 全量移动端 + UI 门禁
npx vitest run src/mobile && npm run check:mobileui
# 设备
bash scripts/android-build.sh --sync --install
adb -s emulator-5554 exec-out screencap -p > /tmp/loading-motion/shots/xx.png
```

---

## 6. 边界 / 未做

- 只做移动端；桌面加载态（`PanelLoading` 对应物/桌面 Suspense）不在本任务，且桌面样式层属另一条线。
- 未给 `NoteInfoSheet`/`NoteTagsSheet`/`SearchSheet` 的「读取中…」接延迟（它们有立即断言的渲染测试；语义上读本地 <1 帧，收益低）。
- 未给便携包导入加真实百分比（管线无字节/行总数回调；加 = 改 `importPortable` 签名，属独立立项）。
- 未做骨架屏扩展、下拉刷新、乐观更新、装饰性漂浮动效（理由见 §2.1/§2.4/§2.5/§2.6）。
- 快照 10 态**未实跑**（任务要求只报告影响；结论 = 不需要重烤，见 §4.3）；未执行 `--write-baseline`。
