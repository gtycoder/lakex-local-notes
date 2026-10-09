# usheet 工具栏优化 —— 方案记录（261009）

> 分支 `spike/univer-sheet`。目标：usheet 工具栏**逐步精简到一行**、不常用项收起。
> 本文先记录**「fx 公式栏收起为一个可点击工具」**的方案与实测证据（用户另有想法，待补充后可能调整）。
> 数字均来自 261009 真实 Electron + CDP（隔离 userData）。

## 0. 结论速览
- 当前单行工具栏（`ribbonType: "simple"`）16 个按钮里**没有公式/函数项** ⇒ 用户说的「公式栏」= 工具栏下方那条 **fx 公式栏**（独立 28px 一行）。
- Univer **没有**运行期"隐藏公式栏"开关：`formulaBar` 是创建时布尔（`IUniverSheetsUIConfig.formulaBar?: boolean`）；`FormulaBar` 组件只有 `{className, disableDefinedName}`；无 `toggle-formula-bar` 命令。
- 收起公式栏本身**可行**（实测），但**画布不会自动长**，需显式触发引擎 resize。

## 1. 实测事实（DOM / 机制）
| 项 | 结论 | 证据 |
| --- | --- | --- |
| 公式栏 DOM | `[data-u-comp="formula-bar"]`，高 28px，在 `<header>` 内 | 实机 dump |
| 内容区布局 | CSS grid `grid-template-rows: auto 1fr`（计算 `28px 675px`）；网格画布 `[data-u-comp="render-canvas"]`=675 | 实机 dump |
| 运行期开关 | 无（`RibbonType='collapsed'|'simple'|'classic'|'grid'` 是工具栏的，不是公式栏的） | 类型定义 + 命令枚举 |
| 内联 style 隐藏 | **不可行**：`style.display='none'` 被 React 重渲染擦除（实测 2.5s 后自动恢复 `flex`） | 实机 |
| 类隐藏 | **可行且稳定**：`.usheet-editor.is-formula-collapsed [data-u-comp="formula-bar"]{display:none}` ⇒ header 0 / section 703 | 实机 |
| 画布重排 | section 703 但 canvas 停 675（底部 28px 空条）；把 section `style.height` 直设 600 → canvas 跟到 600 ⇒ 引擎能重排，只是没吃到 CSS grid 变化 | 实机 |
| 重排杠杆 | `Engine.resize()` / `resizeBySize(w,h)`（`@univerjs/engine-render`）；组件已持有 `univer`，可 `univer.__getInjector().get(IEngine)` | 类型定义 |

## 2. 方案 A（推荐）
1. **状态**：设备本地偏好（localStorage，遵 AGENTS §4「编辑器本机视图=设备本地」），不进正文 / S3 / 历史。
2. **收起**：单一来源 CSS 放 `usheetEditor.css`（类挂在我们的 `.usheet-editor` 宿主，避免内联与 `!important`）。
3. **重排**：切换后 `requestAnimationFrame` 里调 `IEngine.resize()`，把画布 675↔703。
4. **可点工具**：注册自定义命令 + ribbon 菜单项（复用现有 `createMenu`/`registerCommand` 姿势），点一下收 / 展。
5. **验收**：收起 canvas 675→703、展开 703→675；`.usheet` 字节与 sha256 不变；无 undo 记录；刷新后状态保持。

## 3. 备选
- **B 重建 Univer**：切换时用 `formulaBar: true/false` 重新 `createUniver`。布局必对，但 ~3s 重挂、丢选区 / 滚动 ⇒ 不适合做开关。
- **C 永久隐藏**：`formulaBar: false`。零成本，但不是"可点击工具"。

## 4. 待定（用户确认）
- 工具放哪：一行工具栏按钮（推荐）/ 自有编辑器 chrome。
- 默认收起还是展开（建议默认收起）。
