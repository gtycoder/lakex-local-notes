# UI-REDESIGN-REVIEW-260923.md — UI 重构（P0–P8 → 主题/几何 → 目录面板）全面评价 + 收尾审计

> **评价对象**：260921–260923 桌面 UI 重构全批次 —— §2.22（P0–P8：剥离思源层 + 自有设计系统）、§2.23（14 提交视觉回修）、
> §2.24–§2.27（主题 A/B/C、增强大纲进编辑区、目录触发条/浮层）、260923（面板契约 + `⌘]` + 垂直几何令牌化 + 红绿灯对齐 + 微调）。
> **口径**：结论只引**可复现证据**（门禁输出 / 实测数值 / 文件行号），不写无法验证的"更好看"。复现命令见文末。

## 一、评价

### 1. 视觉设计改进

| 维度 | 改前 | 改后 | 证据 |
|---|---|---|---|
| 样式来源 | 思源 `b3/*` 套壳 + 层层覆盖 | 自有设计系统：单入口 `styles/index.css` + 8 层 `@layer` | `ui-metrics`：入口 b3 import **0**、桌面 `var(--b3-*)` **0** |
| 主题 | 浅/深 + 散落字面值 | 主题即数据：`themes/{base,light,dark,warm}` 只定义变量，注册表驱动 `data-theme` | 三套主题逐屏 `getComputedStyle`（§2.22 P2/P5*） |
| 颜色字面量 | 各文件散落 hex/rgb | 只允许出现在 `themes/` | `ui-metrics`：非主题颜色字面量 **0** |
| 层次 | 字号偏小、深色下 panel 与窗底同色 | 字号阶梯 +1px；panel 实心；阴影四档（card/popover/dialog/drag）；主色提饱和 | §2.23 A/B |
| 可读性 | — | 对比度 **42 项全过 AA**（`text-3` 在卡内块上 4.21 → ≥4.5） | §2.22 P2 |
| 密度 | 顶栏 38 / 面包屑 32 / 工具条 38 | 顶栏 **32** / 面包屑 **30**（内距 16→12）/ 工具条 **34**；标签 28 与顶栏**解耦** | 隔离实例实测 |
| 几何一致性 | peek 顶 80、浮层顶 112、阅读态大纲 74 **写死** | 全部由 4 个令牌**派生** | `chrome.css` / `shell.css` / `editor.css` |
| 原生外壳 | 红绿灯写死 `y=13`（为 38px 顶栏调） | 由 `layoutMetrics.TOPBAR_HEIGHT` 计算 ⇒ 中心恒等于顶栏中心 | native `getWindowButtonPosition()={x:14,y:10}` |

### 2. 用户体验优化
- **键盘可达性**：`⌘]` 固定/收起目录栏（此前**只有鼠标**入口）；📌 补 `aria-keyshortcuts`；设置「快捷键」登记。
- **目录栏三态**（固定/悬浮/收起）：隐形 **10px** 热区 + 跟手把手 + **240ms** 驻留；面板贴左缘、贴底浮卡；顶边随令牌联动。
- **块编辑数据安全**：菜单/拖拽全走内核原生命令（`deleteByRange` 补空行、删节点前选区复位、列表父项 = 整块、多块批量）；块手柄图标贴正文而**命中盒不动**（不抢首字点击）。
- **目录树交互**：刷新按钮、点文档不自动展开子项、自动定位消除 **2 帧**错位、重命名单一焦点环、＋菜单 220×60 → 150×50。
- **深色/暖色体检**：主界面/设置/回收站/搜索/小记**五屏 0 异常**（§2.23 B）。
- **红绿灯与顶栏同轴**（用户 260923 报，已修）。

### 3. 技术实现质量
- **层序即优先级**：新样式写进对应 `@layer` 即压过 legacy，**不靠特异性 / `!important`**；全桌面 `!important` **9 条**（≤10），每条在代码里写明理由。
- **四条自动化围栏**：`cssLayers.test.ts`（逐文件声明数/重复组/空壳）、`scripts/ui-metrics.mjs`（五项硬指标）、`scripts/check-core-boundaries.mjs`、`scripts/check-bundle-budget.mjs`。
- **可复用审计法**：样式层删除后的「(选择器, 属性) 漏搬比对」（§2.23 F，71→15→5）——本次最值钱的方法资产。
- **vendor 治理**：`LOCAL-CHANGES.md` 21 条 + `npm run build:vendor`；内核契约 `docs/LAKEX-CONTRACT.md` §5.1–§5.13。
- **文档分工**：`AGENTS.md`（红线）· `README.md`（概览）· `HANDOFF.md`（唯一交接）· `PANEL-CONTRACT.md`（面板不变量）。

### 4. 过程中的问题（诚实记录）
1. **删样式层时漏搬**：P7-b 只搬了部分承重规则 ⇒ 菜单项图标贴字、同步浮窗与 `.tabbar-trailing` **完全没样式**、滚动条回落系统 15px。**教训：删层必须逐属性比对，"页面没坏"不算验证。**
2. **围栏基线没同步就提交**：本批曾两次在围栏红着时提交（事后 `--amend` 修）。
3. **验证借用了用户端口/别人的构建**（1442 实为用户会话的 preview）⇒ 若干"验证通过"验的是旧产物；后段改用独立端口 + `lsof cwd` 核对。
4. **画板打不开是既有 bug**（`TypeError: Wt is not a function`，已在 `origin/master` 未改动基线复现）⇒ 非本批引入，**仍未解决**；画板容器壳因此未做视觉验证。

## 二、关键成果（提炼）
1. **换掉整套 UI 底座**：从"思源层套壳 + 层层覆盖"→ **自有设计系统**（单入口 + 8 层 + 令牌 + 主题即数据 + 14 件 kit），桌面与 b3 **彻底解耦**。
2. **把"改不动"变成"改得准"**：几何/颜色/字号全部令牌化，**同一视觉只有一个来源**；改密度只改 4 个数字。
3. **补齐交互缺口**：目录栏键盘入口、块编辑原生化、目录树一批交互细节、macOS 原生外壳对齐。
4. **立起防回归体系**：4 条自动化围栏 + 漏搬审计法 + 面板契约 + 内核行为契约。
5. **留下可复现的验收材料**：`docs/UI-REDESIGN-260921/`（元素底账 56/56、验收口径、对比页 10 组、主题令牌、字体清单）。

## 三、260923 收尾审计（实跑）

```
tsc --noEmit                 → 0
npm test -- --run            → 1213 passed / 16 skipped (1229)
node scripts/ui-metrics.mjs  → b3 引用 0 · 颜色字面量 0 · !important 9 · 入口 b3 import 0 · 同名文件对 0
npm run check:core           → 65 文件 / 违规 0
npm run check:bundle         → app-js gzip 1.79MB/2.9MB · app-css 184KB/2MB · drawnix 408KB/1.4MB
git diff --check             → 干净
```

**本轮修掉（查漏补缺）**
- **围栏基线 10 个文件偏松 ⇒ 按实测收紧**。最严重：`styles/tokens.css` **83 → 6**、`styles/motion.css` **10 → 1**；
  其余 `b3/base.css` 16→13 · `b3/layout.css` 187→184 · `features/outline/outline.css` 290→277 · `styles/app/base.css` 39→33 ·
  `dialogs.css` 152→146 · `misc.css` 293→288 · `shell.css` 512→503 · `tabs.css` 204→202。**此前这些文件的围栏等于虚设。**
- **删掉全仓零引用的死令牌 8 类**：`--ease-in-out`、`--dur-press`、`--shell-toolbar`、`--shell-radius`、
  `--shell-card-shadow`、`--shell-micro-card`（连同空掉的 `:root` 块一起删，避免留空壳规则）、
  `--radius-lg`（过渡别名里唯一没人读的）、`--lake-pinned-border` / `--lake-pinned-tint-hover`（三套主题各 2 条）。
  > 审计脚本一度把 `.ln-tag--hoverable` 报成令牌 `--hoverable` ⇒ **误报**，已识别并保留（BEM 修饰符）。
- **修过期回退值**：`outline.css` 4 处 `var(--lake-editor-top, 112px)` → 由令牌派生（实际 64px）。
- **修过期注释/数字**：热区 8→10px、工具条 36→34px、`editor.css` 的"12px 热区"、HANDOFF「在途」→「已提交」。

**有意保留（有理由，非遗漏）**
- `--lake-shadow-drag`：在 `05-THEME-TOKENS-ABC.md:34` 的**阴影词表**里，属设计系统词表。
- `--lake-space-* / --lake-motion-* / --lake-ease-* / --lake-z-* / --lake-line-height-* / --lake-font-size-h1 / --lake-font-weight-bold`
  等约 20 项**全仓零引用但属尺度词表**（完整 ramp 是设计系统常态）⇒ 保留；要裁剪需先定"词表保留 vs 按需存在"的设计口径。

## 四、可继续优化（分级 + 触发条件）

**P0 安全（建议优先）**
1. **`W-10 dompurify`**：全仓仍无该依赖。W-8 的 ACAO **已在 `electron/assetServer.ts` 修复**（6 条测试），残余只在
   `webApiServer` 的 `/api/*`（不校验 Origin，见 HANDOFF §3.10④）——建议与下条一起定调。

**P1 机制 / 体验**
2. `library-changed` 广播（外部改动 / AI 写入自动刷新目录）。**触发条件**：AI 写入路径或浏览器端写功能落地；届时与 §3.10 的 SSE 一起做。
3. 目录树窗口化 / 按笔记本懒加载。**触发条件**：先造 5k/10k 合成数据量渲染耗时，量到卡再立项（现库 549 节点、`content-visibility` 已上）。
4. 分段控件段态 + 设置项说明字号被**双端共享层 `!important`** 阻挡 ⇒ 并入移动端批次。
5. **面板契约可执行化**：`PANEL-CONTRACT.md` 目前只是文档；建议把 **z 序**与**顶边口径**做成常量或单测
   （现在只有 `--topbar-height` ↔ `layoutMetrics.TOPBAR_HEIGHT` 有一致性单测）。

**P2 可维护性**
6. 设计词表裁剪（见 §三「有意保留」）。
7. **历史文档标注**：`docs/UI-REDESIGN-260921/03-ACCEPTANCE.md` / `04-LAYOUT-SPACE-SPEC.md` 里仍有旧几何（38px 顶栏、8px 热区），
   建议文首标注「**历史快照，现状见 `PANEL-CONTRACT.md` 与 HANDOFF §0**」。
8. **画板 bug**（`Wt is not a function`）单独立项 —— 它会挡住画板的任何视觉验证。

**P3 产品（长期，§3 已记）**
9. 画板 AI 助手接入；离线残余 3 处（外观级）；移动端表格只读渲染 + 缩略图真机验收；回收站首拉成本；导出（Word/PDF/分片）。

## 五、复现命令
```bash
export PATH="$HOME/.nvm/versions/node/v24.18.0/bin:$PATH"
cd /Users/admin/file/local-lake/lake-notes-electron
npx tsc --noEmit
npm test -- --run
node scripts/ui-metrics.mjs
npm run check:core && npm run check:bundle
git diff --check
```
