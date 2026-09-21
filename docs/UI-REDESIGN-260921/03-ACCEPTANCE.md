# 03 · 验收报告（UI 重设计 · 260921）

> 依据：`docs/UI-REDESIGN-260921/README.md`（计划与硬指标）、`01-ELEMENT-LEDGER.md`（元素底账，**已全部打勾**）、
> `ui-design-inputs/out/design-system/`（设计规格）。
> 授权范围：**结构性换皮 (b)** —— 可调整 DOM 嵌套/包裹层，**不改业务逻辑/数据流/交互行为**；
> 验收口径：**逐屏截图对照 + 元素底账打勾**（用户明确把"0 像素差"改为这套）。

## 一、结论

**五项硬指标全部达成**，桌面端思源样式层已彻底移除，自有设计系统（令牌 + 主题即数据 + 14 件组件库 + 显式层序 + 可替换字体）落地。
**移动端零改动**（`src/mobile/**` 未动；`src/b3/*` 仅保留给移动端加载）。lakex 编辑器内核零改动。

## 二、硬指标（起点 → 最终）

| 指标 | 起点 | 最终 | 目标 | 状态 |
| --- | --- | --- | --- | --- |
| 桌面侧 `var(--b3-*)` 引用 | 604 | **0** | 0 | ✅ |
| 颜色字面量（非主题文件） | 394 hex + 234 rgb | **0 + 0** | 0 | ✅ |
| `!important` | 141（原始）/ 103（清点后） | **9** | ≤10 | ✅ |
| 入口 b3 import 行数 | 8 | **0** | 0 | ✅ |
| 同名 CSS 文件对 | 4 | **0** | 0 | ✅ |
| app-css gzip（预算 2 MB） | 197 KB | **182 KB** | ≤2 MB | ✅ |

度量口径见 `scripts/ui-metrics.mjs`：**「桌面侧」= 从 `src/styles/index.css` 沿 `@import` 可达的样式图** ——
`src/b3/*.css` 已只被移动端 import，因此不再计入桌面指标（否则"留给移动端的思源文件"会让指标永远归不了零）。

## 三、交付物

| 交付 | 位置 |
| --- | --- |
| 设计令牌 | `src/styles/themes/base.css`（主题无关：间距/圆角/动效/字号/字体/焦点环/媒体与调色板令牌）+ `{light,dark,warm}.css`（三套主题的取色） |
| 主题即数据 | `src/lib/themes.ts`（`LakeTheme` 注册表 + 预览色）、`src/lib/theme.ts`（`applyTheme` 写 `data-theme`）、`src/lib/settings.ts`；**只本机**（不进同步） |
| 自有组件库（14 件） | `src/styles/kit.css`（`ln-btn/ln-iconbtn/ln-row/ln-list/ln-menu/ln-modal/ln-scrim/ln-drawer/ln-toast/ln-input/ln-select/ln-switch/ln-tag/ln-card/ln-tip/ln-segment/ln-scroll/ln-form`） |
| 显式层序 | `src/styles/index.css`：`@layer legacy, tokens, reset, kit, shell, feature, overlay, a11y;`（a11y 最高 ⇒ 无障碍契约不需要 `!important`） |
| 逐屏迁移层 | `chrome.css`（外壳/顶栏/页签/目录树行）、`feature.css`（设置/大纲/小记/第三方容器壳）、`overlay.css`（对话框/菜单/遮罩/搜索面板）、`compat.css`（桌面兼容层：从 b3 收编的承重规则 + 仍在用的思源类）、`a11y.css` |
| 可替换字体 | `--lake-font-family` / `--lake-font-family-reading` / `--lake-font-family-mono` 三处令牌 + 开发期试用切换器 `src/lib/fontTrial.ts`（`window.__lakeFontTrial`；生产构建已 tree-shake，见 `02-FONTS.md`） |
| 元素底账 | `01-ELEMENT-LEDGER.md`（346 条复选框，**全部打勾**） |
| 截图矩阵 | `shots/`（19 张，见下） |

## 四、验证方法与证据（三种，逐条可复核）

### ① 运行时计算值对拍（主要方法）
6 屏 × ~15 选择器 × 18 属性（浅/深/暖），在**每次迁移前后**各取一次快照并逐项比较。
**判定标准**：要么**零差异**（证明该步是等价重构），要么差异**是有意的设计取值**（在提交信息与 HANDOFF 里逐条写明）。
- P7-b 删源：22 处差异 → 修完后 8 处，且全部是有意取值（侧栏圆角 12→10 按设计 radius md、`.note-row` 宽 −5px 是 P5 的行内距、`.b3-select` 由内阴影环改为真 1px 描边、设置项说明改设计小字号）。
- P7-c 合并同名文件：**0 差异**（先做"选择器/属性交集"静态证明，再做跑动对拍）。
- P7-d 令牌换血 / 调色板令牌化 / 页签与外壳清零：**0 差异**。
- P7-e 去 `!important`：17 处差异 → 定位并修掉 2 个真回归（设置面板宽度、分段控件），最终 **0 差异**。

### ② 无障碍契约的**运行时**验证
CDP `Emulation.setEmulatedMedia({features:[{name:'prefers-reduced-motion',value:'reduce'}]})`：

| 选择器 | 正常态 transition-duration | reduced 态 |
| --- | --- | --- |
| `.tab-item` | 0.13s ×4 + 0.09s | **0s** |
| `.sidebar` | 0.19s ×2 + 0.24s | **0s** |
| `.tab-item .tab-close` | 0.1s ×2 | **0s** |
| `.tree-row` | 0.25s + 0.12s ×2 | **0s** |
| `.dock-icon-btn` | 0.13s ×2 | **0s** |

⇒ 把契约搬到最高层 `a11y` 后，**不用一个 `!important`** 依然生效（这正是层序设计的目的）。

### ③ 元素底账的源码核对
脚本把底账里每条标签在当前 `src/**/*.tsx|ts` 里逐条查找：288 条未勾选中 **284 条直接命中**，
其余 4 条是**复合描述行**（如「进入专注模式 / 退出专注模式」），拆开后的组成标签全部命中。
其中「导出 ▸ 子菜单」一行因**过时**（漏记"导出为 Word（开发中）"与"导出为原生 Lake"）已**按现网更正为实际 7 项**。

## 五、截图矩阵（`shots/`）

| 屏 | 浅色 | 深色 | 暖色（第 3 套验证主题） |
| --- | --- | --- | --- |
| 主界面（文档 + 目录树 + 页签 + 状态栏） | `01-main-light.png` | `01-main-dark.png` | `01-main-warm.png` |
| 偏好设置（56 项 / 10 分类） | `02-settings-light.png` | `02-settings-dark.png` | `02-settings-warm.png` |
| 回收站 | `03-trash-light.png` | `03-trash-dark.png` | `03-trash-warm.png` |
| 全文搜索 | `04-search-light.png` | `04-search-dark.png` | `04-search-warm.png` |
| 小记工作台 | `05-quicknotes-light.png` | `05-quicknotes-dark.png` | `05-quicknotes-warm.png` |
| 表格（FortuneSheet）容器壳 | `06-sheet-light.png` | `06-sheet-dark.png` | — |
| 多维表容器壳 | `07-bitable-light.png` | `07-bitable-dark.png` | — |

（截图为 1300×860 归档版，原始 2600×1720 由 `/tmp/lake-ui-shot/p8/shots` 生成，脚本见 HANDOFF §2.22。）

## 六、已知问题与边界（诚实记录）

1. **画板（drawnix）打不开 —— 既有 bug，非本批引入**：打开画板会落进错误边界（`TypeError: Wt is not a function @ BoardEditor-*.js`）。
   已做归因：在 `git worktree` 里构建 **origin/master 未改动基线**并打开同一画板，**同样报错**；
   且本分支 diff 完全没碰 `src/features/board/**`、`editor/**`、`sheet/**`、`bitable/**`、`lakeRuntime.ts`。
   ⇒ 建议**单独立项**（可能与本项目 §2.15 记录过的 vendor 懒 chunk 打包问题同类）。因为画板渲染不出来，其容器壳**未能完成视觉验证**（表格/多维表已验证）。
2. **默认配置下的大纲是内核原生 TOC**（`editor-outline-enhance` 默认 false）—— 属**编辑器外观（第三方）**，不在本次重做范围；我们自建的大纲（增强态）已按设计迁移并通过实测。
3. **两项仍被"移动端也会加载的共享文件里的 `!important`"约束**（(`styles/components.css`)）：`.seg__item` 段态、设置项说明字号的原 `!important`。
   前者已确认**必需**（双端共享，移动端靠它压 `.b3-button--outline`）并保留；后者的 `!important` 随思源层删除而消失 ⇒ **设置项说明已能按设计显示小字号**（阻塞项 ① 已解除）。
4. 移动端（`src/mobile/**`）**零改动**，仍走思源组件层 —— 移动端批次另立。

## 七、门禁（收尾时全绿）

```
npx tsc --noEmit                  → 0 error
npm test -- --run                 → 1210 passed | 16 skipped (1226)
npm run check:core                → lake-core 边界检查通过
npm run check:bundle              → app-js 1.78MB/2.9MB · app-css 182KB/2MB
node scripts/ui-metrics.mjs       → 五项硬指标全部达标
git diff --check                  → clean
```

## 八、明确「不做」的事（避免过度设计）

- 不为旧数据/旧类名写兼容层（开发版数据可删可重建；b3 类在桌面走 `compat.css` 的**等价复刻**，不是兼容分支）。
- 不引入新的 UI 依赖、不做"名义上的统一抽象"；不重构业务逻辑与数据流。
- 不把移动端样式顺手改掉（本批范围外，需单独验证）。
