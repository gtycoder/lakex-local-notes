# 我们自己的样式层「按职责归并」施工简报（260916）

> 用户 260916 拍板：**做第二档**——把我们自己的样式文件按**职责**归并，而不是按"第几次发现不对"追加。
> 本文定目标结构、安全边界、施工顺序与验证口径；动工前后都以此为准。配套工具见 `scripts/css-audit/README.md`。

## 0. 为什么要做（现状证据，非观感）

对"我们自己的 12 个样式文件"做职责域统计（每条规则按选择器归属归类，260916 实测）：

| 文件 | 规则 | 职责域数 | 说明 |
| --- | --- | --- | --- |
| `styles.css` | 582 | **8** | 小记 94 / 侧栏 73 / 标签页 63 / 设置 30 / 编辑器 29 / 浮层 26 / 骨架 10 / 状态栏 7 + 未归类 250 |
| `styles/overlays.css` | 128 | 3 | 浮层 36 / 设置 24 + 未归类 66 |
| `styles/ui-polish.css` | 71 | 6 | 侧栏 31 / 标签页 9 / 设置 5 / 状态栏 4 …（典型"按响应追加"层） |
| `styles/dialog.css` | 55 | 1 | 只服务弹窗（好） |
| `features/outline/outline.css` | 61 | 3 | 侧栏 38 / 大纲 22（功能域，可接受） |
| `styles/shell.css` | 23 | 4 | 侧栏 14 / 编辑器 3 … |
| `styles/document-status.css` | 26 | 1 | 只服务状态栏（好） |
| `quick-notes.css` 6 / `editor-bridge.css` 5 / `layout-contract.css` 3 / `motion-contract.css` 2 | ≤6 | 1 | 单一职责，但名字是"契约/桥接"这类**意图名**而非职责名 |

结论：问题不在"文件多"，而在 **① 大文件里职责混杂（styles.css 一个文件 8 个域）；② 小文件按"响应/意图"命名**。
同一个元素（例如侧栏、设置面板）的声明分散在 3~4 个文件里，读代码时必须脑内做一遍层叠推演。

## 1. 目标结构（职责名 + 明确归属）

加载顺序 = 从通用到具体；**同域只留一处来源**。

| 目标文件 | 职责 | 入口 |
| --- | --- | --- |
| `styles/tokens.css` | 设计令牌 / 焦点环 / reduced-motion 令牌 | 双端 |
| `styles/base.css` | 复位与骨架：`:root` 字体栈、`*`、`html/body/#root`、`button/input`、`svg.lucide` | 桌面（移动端用 `mobile/mobile.css` 自己的骨架） |
| `styles/shell.css` | 应用外壳：`.app-shell` 网格、活动栏、侧栏、顶栏/标签页、状态栏、工作区、专注模式 | 桌面 |
| `styles/components.css` | 通用组件与浮层通用件：菜单/右键菜单/弹窗/`.ln-*`/徽章/分段控件/卡片 | **双端共享**（吸收现 `overlays.css`） |
| `styles/settings.css` | 设置面板版式（`.settings-*` 残部 + `config-*` 覆盖） | 双端共享 |
| `styles/editor.css` | 编辑器桥接与正文覆盖（`lake-editor` / `ne-*` / 代码块 / 表格 / 原生 TOC） | 桌面 |
| `styles/quick-notes.css` | 小记工作台 | 桌面 |
| `styles/document-status.css` | 状态栏胶囊 | 桌面 |
| `styles/motion.css` | 动效契约（吸收 `motion-contract.css` 与 `layout-contract.css` 里属于契约的部分） | 桌面 |
| `features/outline/outline.css` | 大纲（功能域，保留） | 桌面 |

**消失的文件**：`styles.css`（拆解）、`overlays.css`（并入 components）、`ui-polish.css`（按域归位）、`editor-bridge.css`（并入 editor）、
`layout-contract.css` / `motion-contract.css`（并入 motion）。

## 2. 安全边界（硬约束，违反就是回归）

1. **两套入口的样式集合不同**（§2.44 的结论）：移动端入口只加载 `tokens / components / dialog / mobile/*` 与主题层。
   因此「桌面独占」与「双端共享」必须显式标注——把桌面独占文件合并进共享文件 = 把桌面规则泄漏给手机。
2. **`src/b3/**`（思源移植件）与 `src/vendor/**` 本轮不动**：它们是被移植/第三方的层，改它等于改上游（AGENTS §3 #14 的类词汇就建在这层上）。
   本轮的"我们自己的层"只指上表里的文件。
3. **不改任何声明的内容**：只做"搬家"。除格式（缩进/空行/注释）外，每条声明的 属性/值/`!important`/所在媒体条件 必须逐字不变。
   唯一允许的变化是**相对顺序**——而顺序变化正是必须验证的对象。
4. **`@media`/`@supports` 块按整块搬**，不拆散内部规则。

## 3. 施工顺序（每阶段独立验证、独立提交）

| 阶段 | 内容 | 风险 | 验证 |
| --- | --- | --- | --- |
| **S1** | 单职责小文件归位：`quick-notes.css`→（保留但改名/并域）、`editor-bridge.css`→`editor.css`、`layout-contract.css`+`motion-contract.css`→`motion.css` | 低（同域，且这些文件在末尾加载） | 27 状态计算值 + 16 屏像素 |
| **S2** | `ui-polish.css` 按域拆解归位（侧栏 31 / 标签页 9 / 设置 5 / 状态栏 4 …） | 中（跨域重排） | 同上 + 逐条走查 |
| **S3** | `styles.css` 按域拆分——**但只在本层内拆**（见 §6 的重要修订） | 高（582 条、8 个域、且是**最先加载**的文件） | 同上，且**分域小批**做（每批 ≤80 条） |
| **S4** | 收口：删空文件、更新两个入口的 import 顺序、回填文档与围栏（`cssLayers.test.ts` 的文件清单） | 低 | 全量门禁 |

**为什么 S3 放最后**：`styles.css` 是最先加载的文件，它的规则被后面所有层覆盖过。拆它等于把"最早层"重排，
牵动面最大；等前面几步把"谁是谁的单一来源"理顺后再动它，验证的噪声最小。

## 4. 每阶段必须过的门禁（缺一不可）

```bash
# 0) 装置自检 + 对照组（证明装置能抓到真改动）——不通过就停
FILES=<本阶段涉及文件> node scripts/css-audit/drive.mjs 9222 scripts/css-audit/ab2.mjs "plain:1315:light" self
# 1) 磁盘 == 浏览器（dev 实例不重读样式表会伪装成 0 差异）
node scripts/css-audit/drive.mjs 9222 scripts/css-audit/sheetcheck.mjs
# 2) 整页计算值 A/B：注入 HEAD 版本，27 个状态必须 噪声 0 / 差异 0
FILES=<本阶段涉及文件> node scripts/css-audit/drive.mjs 9222 scripts/css-audit/ab2.mjs "" head
# 3) 像素批次：改前/改后各一轮（同一批、同一顺序），逐通道比对
node scripts/css-audit/drive.mjs 9222 scripts/css-audit/shotset.mjs <tag> "$(cat .css-audit/pixel-specs.txt)"
# 4) tsc / vitest / 双端 build / git diff --check
```

判定口径：**15/16 屏 0 差异 + 1 屏已知抖动**（设置面板固有抖动，用同源连跑两遍证伪）；计算值必须 27/27 全 0。

## 5. 已知空缺（本轮不解决，但要知道）

- 状态矩阵仍是 27 个：**多标签、大纲缩放中、编辑器内部态（代码块/表格/文件卡）、选区与粘贴态**未覆盖；
  动这几类样式前先补状态。
- `(prefers-reduced-motion: reduce)` / `(prefers-reduced-transparency: reduce)` 在矩阵里恒为假
  ⇒ 落在这些媒体块里的声明**当前不可验证**（§2.47 因此剔除了 11 条）；要动它们先给 `stylesnap` 补模拟偏好的状态。

## 6. 重要修订（260916 实测）：**跨层搬家不是免费的，S3 只在本层内拆**

S2 把 53 条规则从 `ui-polish.css`（壳层，位置 13→19 区间）搬进 `shell.css`（位置 12），实测惰性 —— 因为那批规则本来就是**靠特异性赢**的。
但 S3 的第一批试搬（小记 87 条 + 设置 14 条 → `quick-notes.css` / 新建 `settings.css`）**打破了 79 处计算值**，样本：

| 元素 | 属性 | 搬运前 | 搬运后 |
| --- | --- | --- | --- |
| `.quick-note-composer` / `.quick-note-entry` | `border-color` | `rgb(224,224,224)`（b3 的边） | `rgb(221,226,236)`（我们的 `--lake-border`） |
| `.settings-panel`（深色） | `box-shadow` | 面板阴影 | 被另一条覆盖 |
| 小记输入区 `textarea` | `border-color` | `rgb(243,245,248)` | `rgb(54,59,69)` |

**结论**：我们自己有一批规则是**有意"输给"后面 b3 / 壳层规则**的（写在前面 + 特异性不够 = 让 b3 说了算）。
把它们搬到更晚的文件，等于把"自愿认输"改成"强制获胜"，表现就变了。

**因此 S3 的做法改为**：把 `styles.css` 拆成按职责命名的域文件，但**全部加载在 styles.css 原来的位置**（b3 与 outline 之前），
即"同层内拆分"——层与层之间的先后关系一律不动，只在同一层内部重新按域组织。这样唯一的风险是**同层不同域之间的相对顺序**，
而这是可验证、也容易修的（调换两个域文件的加载顺序即可）。

**跨层合并**（把域文件并进壳层同名文件）降级为"逐条二分"：只搬"移了之后 27 状态 + 像素批次都 0 差异"的规则，
移了会变的（上面那张表就是）**原地不动**并在注释里写明"这条必须留在 b3 之前"。
