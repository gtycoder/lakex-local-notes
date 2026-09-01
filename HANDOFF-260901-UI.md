# HANDOFF-260901-UI · 桌面 UI 打磨 + 令牌化收口

> 承接 HANDOFF-260901.md（那份是同步性能/FTS 主线）。本文专记**桌面 UI 打磨**这一支。
> 写给零上下文新会话：先读 AGENTS.md（长期记忆）再读本文。

## 0. 基线
- 分支 **`polish/ui-260901`**，从 `master`(`0bd0d1a`) 拉出，**25 个提交**，**未合 master**。
- 三门槛全绿：`tsc --noEmit` · `vite build` · `vitest run` = **750 passed / 1 skipped**。
- 全程**只动 `src/` 前端（CSS + 少量 tsx）**，未碰 `electron/` 主进程、未碰 `src/core/` → 同步协议/DB 零影响。
- 验证方式：CDP 连运行中的 dev 版（Electron `--remote-debugging-port=9222`，见 §4）实测计算样式/几何，改前后对比。

## 1. 已完成（分组）
### Bug 修复
- 浮窗（设置/回收站/历史）入场"从右下飞入再弹回"卡顿：根因是 `.floating-dialog` 入场动画被 `ui-polish.css` 的 `lake-pop-in`（不含 `translate(-50%,-50%)`）覆盖了 `styles.css` 正确的 `floating-dialog-enter`。修法：从 `lake-pop-in` 选择器移除 `.floating-dialog`。CDP 实测入场全程居中偏移≤1px。

### 视觉/交互打磨（用户逐项验收过）
- 壳层左上对角渐变加深+加快（`b3/layout.css` 135° 层，alpha 抽 `--shell-tint-strong/soft`，浅 26/12、深 20/9）。
- 移除树行同步绿点（自动保存 1s 窗口内无意义）。
- 空工作区补图标+副提示+令牌配色。
- 文字渲染对齐思源（`:root` 加 `-webkit-font-smoothing:antialiased` + `text-rendering:optimizeLegibility`）；tertiary 达 WCAG AA。
- 左右浮层高度对齐（大纲浮层补 `top/bottom:72` 匹配侧栏）。
- 状态栏文字可选中复制（容器仍 `pointer-events:none` 不挡编辑器、零交互）。
- 浮层阴影统一更柔 + **切出动画不再 transition box-shadow**（避免逐帧重绘，保性能）。
- 弹窗遮罩加深（浅 `rgba(31,35,41,.30)`、深 `rgba(0,0,0,.55)`）+ **遮罩淡入动画**（消除突兀/闪烁）。
- 目录紧凑化（行高 31→27、笔记本 33→29）。
- 工具栏变窄：vendor `.ne-ui-toolbar` 默认 50px → 覆盖到 **38px**（仍 > 面包屑 32px，按钮 ≤32 不裁）。
- 浅主题文字再加深一档（secondary #54606f、tertiary #5f6a78）。

### 令牌化收口（为后续换肤/自定义字体打地基）
- 字体单一来源：UI 与编辑器正文都走 `--b3-font-family`（macOS=SF Pro+苹方，与思源一致）。
- 壳层背景、文字色令牌、遮罩：各自收敛到单一来源，删被覆盖的死声明。
- `.tab-item.active` 桌面块 6→4 收敛（逐属性等价，CDP 核对）。
- 颜色/圆角迁移：①遗留绿→蓝(38) ②状态色→语义色板(48，含 error/warning/success 的 base/strong/soft) ③文字灰→`--lake-text*`(38) ④边框灰→`--lake-border`(15) ⑤单值圆角→`--radius-*`(31)。
- 死代码删除：`styles.css` 的 `.mobile-*` 规则 33 条（桌面不渲染该标记、移动端不加载 styles.css → 两端皆死）。

## 2. 关键事实（勿踩）
- **死代码要删除，不要令牌化保留等复活**（用户明确原则）。迁移中把"被覆盖的死声明"换成令牌是错的——应删。`.mobile-*` 已按此删除。
- `styles.css` **只被桌面入口 `src/main.tsx` 加载**；移动端 `src/mobile/main.tsx` 不加载它（用 `mobile.css`）。→ styles.css 里的 `.mobile-*` 一律是死代码。
- 换肤现状：可见颜色已走 `--b3-*`/`--lake-*` 令牌（CDP 实测），改令牌即全局生效。

## 3. 剩余 TODO（按优先级）
1. ~~③④ 死声明~~ **已处理**：CDP 逐条判定——③④ 多数 color/border 只在 ≥761px 被桌面块覆盖、**窄窗(<761)下是活的响应式色**（令牌化正确，非死代码）；仅 `.search-box`/`.tree-chevron` 的 color 被 b3 非媒体规则全断点覆盖=真死，已删（`df6d01a`）。`.mobile-*` 整规则死代码 33 条已删（`68aa6f4`）。→ 死代码原则已落实，③④ 无需再查。
2. **用户肉眼验收**本分支全部改动（错误/危险按钮/删除/钉选/同步态、目录/设置文字边框圆角、浮层阴影/遮罩淡入/工具栏宽度）。
3. **未来触发式**（等真做换肤/自定义字号/插件时）：字号 `--text-*` 完全令牌化、深色改纯变量覆盖、公共令牌命名空间决策（`--b3-*` vs `--lake-*`）。**现在不提前设计插件系统**。

## 4. 环境与命令
```bash
export PATH="$HOME/.nvm/versions/node/v24.18.0/bin:$PATH"
cd /Users/admin/file/local-lake/lake-notes-electron
# 起 dev（vite 会自动拉起 Electron 并带 --remote-debugging-port=9222，见 vite.config.ts onstart）
npm run dev            # 需长驻 tty；结束后只 kill 具体 PID，禁 pkill -f Electron
# 三门槛
npx tsc --noEmit && npx vitest run && node node_modules/vite/bin/vite.js build
# CDP 实测（Node24 原生 WebSocket，无需 playwright）：连 http://127.0.0.1:9222/json 取 page 的 webSocketDebuggerUrl
#   注意：Electron 窗口在后台时 Lake 编辑器懒挂载(0×0)，量编辑器相关需先把窗口唤到前台
```
- 回滚任一条：`git revert --no-edit <hash>`（每条独立提交）。

## 5. 与主线 perf 的关系
本 UI 分支与 HANDOFF-260901.md 的 perf 主线（快照 gzip 异步化、P4-1 FTS 增量）**互不相干**，可各自独立验收/合并。

---

## 6. 移动端 UI 收口（分支 `polish/mobile-ui-260901`，从本 UI 分支拉出）

> 移动端是 Capacitor Android，`main.tsx` **不加载 styles.css**（桌面专用），此前完全无令牌、无深色。
> 真机验证回路：`adb` 连设备 → `cap sync` + `gradlew assembleDebug`（增量~7s）+ `adb install -r` →
> `adb forward tcp:9223 localabstract:webview_devtools_remote_<pid>` → CDP 连 http://127.0.0.1:9223。

| 提交 | 内容 | 真机 CDP 验证 |
|---|---|---|
| M1 `2bdd23f` | main.tsx import tokens.css；mobile.css 补 antialiased+optimizeLegibility、字体栈对齐桌面 | --lake-* 由 UNDEFINED→解析；smoothing=antialiased |
| M4 `ea5f811` | 删 M0 POC 死样式 42 行（仅留 .poc-center/.poc-error） | App 正常渲染无回归 |
| M2a `bbb38b7` | 单角色色→令牌 54 处（accent/error/文字灰/纯边框/正文底） | — |
| M2b `20bde4e` | 多角色色按属性上下文→令牌 31 处（背景#fff→panel、边框#f0f1f3→border、active底→shell；保留蓝底白字 color:#fff、禁用#c9cdd4） | body/顶栏/muted 解析为令牌值、fab 蓝底白字正确 |
| M3 `0d20890` | main.tsx 按 prefers-color-scheme 设 data-theme（跟随系统深色） | 设备切深色：body #17191e/#f3f5f8、accent→#78a5ff、muted→#9aa4b2 |
| M5 `aaa776a` | 动效：抽屉左滑入/sheet上滑入/遮罩淡入/tab过渡/按压反馈（transform+opacity，reduced-motion 兜底） | 关键帧 mobile-fade-in/drawer-in/sheet-in 注入 |
| M6 `7a9db57` | 触摸目标 icon-btn 36→44、qn-add 34→40、sortbar 28→36、删图角标 22→30 | icon-btn 44×44、顶栏 overflow 0 |

**移动端对比度**：随 M2 用 --lake-text-tertiary（#5f6a78）自动达到桌面同款 AA。

### 移动端剩余/待办
- **编辑器正文区深色**：DocumentPage 的 Lake 编辑器（lakex 内核自有主题）在 data-theme=dark 下正文区仍可能是白底——需单独处理内核主题（本次只做了移动端**外壳**深色地基）。真机切深色进文档页需复验。
- **主题手动切换**：当前移动端深色=跟随系统；若要 App 内手动切换（像桌面设置），需在移动端设置里加主题选项 + 覆盖系统偏好。
- **触摸手感**：M6 尺寸已提，实际手感（间距/滚动）建议真机再走查。
- **editor-dock.css**：编辑坞样式未纳入本次令牌化（可后续同样收口）。

---

## 7. 两端统一自检结论（2026-09-01 收尾）
全量门槛绿：`tsc` · 桌面 `vite build` · 移动端 `vite build --config vite.mobile.config.ts` · `vitest 750 passed/1 skipped`。代码内无 TODO/FIXME。改动全在 `src/`（未碰 electron/、src/core/）。

**自检中已补/已修**：
- ✅ **P1**：`.mobile-sheet`/`.mobile-sheet-mask` 双份冲突定义（fixed vs relative、z40 vs z70，靠加载顺序侥幸生效）→ 统一 `fixed-bottom`+z70/71，对 sheet 在 mask 内/外两种 DOM 结构都成立、不再依赖顺序。真机 CDP 复验 `.mobile-sheet` 仅剩 fixed。
- ✅ **P3**：`editor-dock.css` 21 色令牌化（补 M3 深色下编辑坞白岛缺口）；清 `empty-workspace-hint` 过时兜底 `#8993a1`。

## 8. P2 剩余（未做，需专项 + 双端 dev 复验）
桌面重复选择器 top：`.sidebar.sidebar-floating`×13、`.sidebar`×12、`.tab-bar`×11、`.app-shell`×10、`.sidebar.sidebar-docked`×10、`.settings-overlay`×7。**注意**：多数是同一选择器设**不同属性**（合法），只有"同属性被后置 !important/更高优先级覆盖"的才是冗余，须逐属性判活/死再合并（方法见 §1 的 tab-item 收敛）。建议切片顺序：
1. `.settings-overlay` 系（596 老 flex/z200 已被 1766 grid/z800 !important + b3 全遮 → 可删死基规则）。
2. `.sidebar` 背景/边框/圆角重复（b3/layout.css 与 styles.css 多处）。
3. `.tab-bar` 背景/定位重复（styles.css 多处 + b3/layout.css + shell.css）。
4. `.mobile-sheet` 子元素（head/title/body）彻底统一 DOM（当前两 pattern 并存）。
每片：改前后 CDP `getMatchedStylesForNode` 逐属性核对 + 桌面/移动真机各复验 + 独立提交。

## 9. 如何接手（给新会话）
- 先读：`AGENTS.md` → `HANDOFF-260901.md`（perf 主线，另支）→ 本文。
- 分支：`polish/ui-260901`（桌面，28 提交）、`polish/mobile-ui-260901`（移动，39 提交=桌面+移动）。**均未合 master**。
- 验收/合并：桌面需用户肉眼验收后合 master；移动分支从桌面分支拉出，桌面先合、移动随后 rebase 或一并合。
- 回滚：每片独立提交，`git revert --no-edit <hash>`。
- 验证回路：
  - 桌面：`npm run dev`（长驻 tty，自动拉起 Electron 带 `--remote-debugging-port=9222`）→ CDP 连 `http://127.0.0.1:9222/json`（Node24 原生 WebSocket 即可，无需 playwright）。
  - 移动：`adb` 连真机 → `cap sync android` + `cd android && ./gradlew assembleDebug`（增量~7s，需 `JAVA_HOME=jdk-21`）+ `adb install -r` → `adb forward tcp:9223 localabstract:webview_devtools_remote_<pid>` → CDP 连 `http://127.0.0.1:9223`。深色测试：`adb shell cmd uimode night yes/no`。
- 红线：`src/core/` 禁 node:；本地是真相、不改同步/DB；数据只用 lake-notes-dev；杀 Electron 只 kill 具体 PID；死代码删除不预留；未验收不合 master。
