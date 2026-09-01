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
1. **③④ 里残留的"死声明"删除**：迁移③④把部分**被 b3/lake 覆盖的死 color/border 声明**换成了令牌（应删除而非保留）。需**运行中的 dev 版**逐条判活/死（有的仅窄窗/深色下才活）后安全删除，不能盲删。**当前 dev 服务已停**，需先起（§4）。
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
