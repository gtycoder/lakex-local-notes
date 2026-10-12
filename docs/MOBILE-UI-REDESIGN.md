# 移动端 UI 重设计 · 执行方案（261012 立项，用户已确认）

> **给后续会话**：本文是这件事的**唯一执行方案**。长期口径见 `AGENTS.md` §3#14 与 `docs/MOBILE-TECH-STACK.md` §九；
> 逐项归属表见 `docs/MOBILE-DESKTOP-DECOUPLING.md`（桌面会话产出，本会话已评审通过）。

## 0. 口径（用户 261012 定稿，别读偏）

1. **保留当前布局** —— 这里的「布局」指**信息架构 / 页面层级**（§2 冻结清单），**不动**。
   ⚠️ **不是**「每个元素的像素几何冻结」：**页内交互形态与动效可以重做** ——
   例：弹层从「居中 Dialog」改「底部 Sheet / ActionSheet」**属于允许范围**（用户 261012 明确澄清）。
2. **移动端要有自己的设计语言**：不再复用桌面的设计原语与样式；但**技术方案与桌面同构**
   （令牌即数据 → 分层 → 原语库 → 浮层原语 → 护栏 → 规格文档），**在移动端内部同样「一个交互语义只有一套原语」**。
3. **只共享必要逻辑**（策略 / 判据 / 命令字典 / 颜色数据 / 应用语义），**不共享样式与 UI**。
4. **语雀 App 逆向资料仓**（`/Users/admin/file/local-lake/yuque-re/`）是**取值与交互形态的参考来源**，
   **不是布局基准**（我们的信息架构更好，不搬）。该仓是**证据仓**，产物**不要复制进本仓库**。

## 1. 范围（三层，动 / 不动一眼可查）

| 层 | 例 | 动 / 不动 |
| --- | --- | --- |
| **① 信息架构 / 页面层级** | 首页两 tab（小记 · 知识库）→ 笔记 → 笔记本内文档树 → 文档；设置；回收站；搜索 | **冻结**（§2） |
| **② 页内交互形态** | 弹层形态（Sheet / ActionSheet / Dialog）、面板升起方式、手势、触达尺寸与内距、动效时长与曲线 | **可重设计** |
| **③ 视觉皮肤** | 配色、字号/字重/行高、圆角、边框、阴影、材质纵深、图标、选中/禁用/焦点态 | **可重设计** |

## 2. IA 冻结清单（验收时逐条核对「结构没变」）

```
① 首页：小记 | 知识库（两个 tab）
② 知识库：笔记本列表 → 进入笔记本（文档树抽屉 + 文档区）
③ 文档区：顶栏（返回 / 标题 / 编辑·完成 / 同步）+ 正文 + 底部 dock + 抽屉（文档树 / 大纲 / 标签页 / 更多）
④ 小记：时间线列表 + 写作卡（工具条九项）
⑤ 设置：抽屉九页
⑥ 回收站 / 历史版本 / 文档属性（抽屉形态）
⑦ 搜索
```

**冻结判据** = 上述每条的**存在性与从属关系不变**；页内交互与外观**不在此约束内**。
每次提交都要能对着这张清单说「结构没动」。

## 3. 归属基线（谁定义什么）

| 面 | 归属 | 说明 |
| --- | --- | --- |
| **品牌与语义槽**（令牌的**名字与语义**） | **共享** | 分叉名字 = 两套词表，无收益；共享的是词表，不是取值 |
| **取值**（颜色 / 几何 / 动效 / 字号档） | **移动端自有** | `src/mobile/theme/**`；**桌面 `themes/**` 不再是移动端契约** |
| **行为与契约**（Overlay 的 portal/层序、浮层定位算法、焦点环与 a11y 契约、内核样式引入护栏） | **共享** | 分叉会成对出 bug |
| **视觉 / 几何 / 原语** | **移动端自有** | 类名前缀 `mb-*`；形态与密度按触屏 |
| **内核(lakex) 自己渲染的外观**（`.ne-*` / 卡片 / 表格 / 画板） | **分不了，共享** | 闭源内核 CSS 决定；我们只做变量桥接（`kernel-theme.css`） |
| **逻辑 / 数据** | **共享** | `src/core/**` · `src/lib/**` · `features/editor/editorCommands`（命令字典）· `core/colorPalette`（颜色数据）· `colorApplyCommand`/`colorMemory`/`linkEditor`（应用语义）· `lakeRuntime`（内核宿主） |

## 4. 命名与目录（单一来源）

- **类名前缀 = `mb-*`**（实测 `.mb-` 占用 **0**）。
  - 不用 `md-*`：与既有的 `.md-preview`（Markdown 排版）撞族；
  - 不用 `mobile-*`：外壳已占用 **278** 处（保留不动，只把**原语**放 `mb-*`）。
- **令牌名沿用 `--lake-*`**（共享词表），但**取值由移动端定义**：`src/mobile/theme/{tokens,light,dark}.css`。
- 目录：`src/mobile/theme/**`（令牌+主题）· `src/mobile/kit.css`（原语）· `src/mobile/components/ui/**`（React 原语）· `src/mobile/floating/**`（浮层件）。
- 层序（与桌面同构、独立层名）：`@layer mtokens, mkit, mshell, mfeature, moverlay, ma11y;`
  - 桌面现状：`@layer legacy, tokens, kit, shell, feature, overlay, a11y;`（`styles/index.css`）

## 5. 皮肤取值表（初稿 —— **待用户审数字**）

### 5.1 颜色映射（来源：`yuque-re` 静态提取的 `themeToken` / `themeDarkToken`，APK 1.2.2/710，sha256 可追溯）

| 语义 | 语雀（明） | 语雀（暗） | 我们的令牌 |
| --- | --- | --- | --- |
| 主题/强调（偏离项，见 5.2） | `#00B96B` | `#2ED790` | **只给 `+` 号** |
| 背景 primary / secondary / tertiary | `#FFFFFF` / `#FAFAFA` / `#F4F5F5` | `#141414` / `#1F1F1F` / `rgba(255,255,255,.04)` | `--lake-bg-panel` / `--lake-bg-window` / `--lake-bg-block` |
| 背景 hover / hover-light | `#EFF0F0` / `#E7E9E8` | `rgba(255,255,255,.12)` / `#333333` | `--lake-bg-hover` / `--lake-bg-press` |
| 浮层背景 foreground / card-dialog | `#FFFFFF` / `#FAFAFA` | `#1F1F1F` / `#292929` | `--lake-bg-panel`（浮层表面） |
| 遮罩 / toast 底 | `rgba(0,0,0,.65)` / `rgba(0,0,0,.65)` | 同 / `#292929` | `--lake-scrim` / `--lake-toast-bg` |
| 边框 primary / light / heavy | `#E7E9E8` / `rgba(0,0,0,.04)` / `#EFF0F0` | `rgba(255,255,255,.12)` / `.08` / `.12` | `--lake-border-1` / `--lake-border-2` / `--lake-divider` |
| 边框 active（选中） | `#00B96B` | `#29AD76` | 移动端选中边（**偏离项**：用我们的主题色） |
| 卡片边 hover / selected | `#81BBF8` / `#2F8EF4` | `#253C56` / `#1D4672` | 选择态边令牌 |
| 文本 primary / body / caption / disable | `#262626` / `#585A5A` / `#8A8F8D` / `#BEC0BF` | `#E2E2E2` / `#B3B3B3` / `#848484` / `#505050` | `--lake-text-1` / `--lake-text-2` / `--lake-text-3` / `--lake-text-4` |
| 链接 / 链接 hover | `#117CEE` / `#5FA8F6` | `#3B82CE` / `#245A94` | `--lake-link` / `--lake-link-hover` |
| 图标五档（primary/secondary/caption/disable/hover） | 同文本四档 + `#D8DAD9` | 同文本 + `#424242` | `--lake-icon-*` |
| 状态 success / info / warning / error | `#00B96B` / `#117CEE` / `#ECAA04` / `#DF2A3F` | `#51B88D` / `#3B82CE` / `#D2A638` / `#CA3F4F` | `--lake-status-ok` / `--lake-link` / `--lake-status-pending` / `--lake-status-error` |
| 徽标 badge | `#2F8EF4` | `#2B6BB1` | 徽标令牌 |

### 5.2 偏离项（显式登记，避免后人对照语雀以为抄错）

**唯一一条**：语雀 `@yuque-color-theme = #00B96B` 是**全端强调色**（选中态 / 按钮 / 边框 active 都是绿）；
**我们只在 `+` 号用 `#00B96B`**，其余强调色沿用本项目主题色（`--lake-accent`）。

### 5.3 几何档位（来源：反编译 RN bundle 全量数值分布 —— 字号 286 / 圆角 286 / 高度 1105 / 内距 152 处）

| 维度 | 语雀实测分布（主档加粗） | 建议档位 |
| --- | --- | --- |
| 字号 | **14**(91) · **16**(67) · **12**(39) · 15 · 20 · 13 · 24 · 10 · 11 · 18 | **7 档**：12 / 13 / 14 / 16 / 18 / 20 / 24（主用 14、16） |
| 行高 | **20** · 24 · 22 · 16 · 28 · 18 · 44 | 按 字号 x 1.45 生成 + 44（大标题） |
| 圆角 | **8**(110) · 12(46，卡片) · 4 · 6 · 2 · 3 · 16 · 20 | 主 **8** / 卡片 **12** / 小件 6 / 4 |
| 触达高度 | **48**(88) · **44**(49) · 40 · 42 · 60 · 72 · 96 | 主 **48** / 最小 **44** / 工具条 44 |
| 页面左右内距 | **16**(55) · 12 · 20 · 24 | 主 **16** |
| 垂直内距 | 20 · 16 · 12 | 主 **16** |

### 5.4 交互形态清单（② 层，允许重做）

| 现状 | 目标 | 备注 |
| --- | --- | --- |
| 居中确认对话框 | **底部 Sheet / ActionSheet** | 单手可达；含下拉关闭 + 安全区避让 |
| 桌面式右键/长按菜单 | 底部 ActionSheet | 移动端没有右键语义 |
| 文档属性 / 历史版本 / 大纲 / 文档树 | 统一为**同一套 Sheet 原语** | 现已是抽屉形态，收敛成一件原语 |
| toast | 移动端自有胶囊 toast | 与桌面 `.ln-toast` 无关 |
| 动效 | 统一时长/曲线令牌 | 面板升起 / Sheet 弹出 / 页面转场 |

## 6. 阶段任务书（每阶段独立可验收；**护栏基线只许降**）

| 阶段 | 动作 | 产出 | 验收 |
| --- | --- | --- | --- |
| **P0 立护栏（允许红）** | `src/mobile/mobileIndependence.test.ts`：① 移动端不得 import `styles/{kit,components,dialog,compat,themes/*}`；② `src/mobile/**/*.tsx` 的 `ln-*`/`b3-*`/`fn__*` 计数基线（现状 **56 + 8**，只许降）；③ 桌面 CSS 反向耦合基线（**19 行**，只许降）。`src/mobile/mobileLayers.test.ts`：移动端 CSS 逐文件声明数基线 | 两份护栏 + 现状数字报告 | 护栏可跑、数字与本文一致 |
| **P1 移动端令牌/皮肤层** | `src/mobile/theme/{tokens,light,dark}.css` + `index.css` 层序；取值按 §5；桌面 `themes/**` 停用 | 移动端自己的令牌来源 | 不再 import 桌面 themes；浅/深切换无回归 |
| **P2 移动端原语（`mb-*`）** | 行 / 列表 / 卡 / 按钮 / 图标按钮 / 输入 / 选择 / 开关 / 标签 / 分段 / 工具类 / 工具栏；**同时**把移动端自建的 `.ln-indent` 等换到 `mb-*` | `kit.css` + `components/ui/**` | `mobile-kit.css` 的「覆盖层」语义消失 |
| **P3 浮层原语** | `mb-sheet` / `mb-dialog` / `mb-actionsheet` / `mb-toast`；定位用共享算法（夹进视口） | `floating/**` | 触屏可关、避让安全区、单手可达 |
| **P4 样板屏 = 设置页** | 用 `mb-*` 重写设置抽屉（**IA 不动**，只换形态与皮肤） | 一屏样板 | 骨架够用的验证点；不够回改 P1–P3 |
| **P5 逐屏迁移** | 首页 → 笔记本工作区 → 文档外壳 → 编辑器 dock；**每屏迁完即删对应桌面 import** | 逐屏 PR | 每屏：走查 + IA 冻结清单核对 |
| **P6 组件变体化（6 个）** | `LakeEditor`（宿主类名）· `AttachmentPreview` · `ImageLightbox` · `QuickNoteEditor` · `QuickNotePreview` · `settingsPrimitives`（移动端自建）；`FileKindIcon` 无样式分叉 | 逻辑共享、外观/形态移动端 | **禁止 fork 组件逻辑** |
| **P7 收口** | 清桌面反向耦合；`MOBILE-DESIGN.md`（视觉与交互形态规格）定稿；移动端指标转**门禁** | 全绿 | 护栏全绿且基线降到目标 |

## 7. 护栏与验收

- **护栏**：`mobileIndependence.test.ts`（§6 P0）· `mobileLayers.test.ts` · 每阶段的 `check:mobilesnap` + `scripts/css-audit/mobile-walkthrough.mjs`（设备级截图）。
- **每阶段必跑**：`npx tsc --noEmit` · `npx vitest run` · `node scripts/ui-metrics.mjs`（移动端段）· `npm run check:mobilesnap` · **IA 冻结清单逐条核对**。
- **尺寸变化（② 层）必须重新走查**：行数、折行、截断都会变 —— 这是 §5.3 生效后的必然代价。

## 8. 与桌面会话的分工

| 侧 | 动作 |
| --- | --- |
| **桌面** | 收窄 `styles/kit.css` 的 `:is(.app-shell, .mobile-app)` 18 行 → 只留 `.app-shell`；`tokens.css` 注释改；提供 6 个组件变体化的接缝 |
| **移动端** | theme / kit / 浮层 / 逐屏迁移 / 护栏；`MOBILE-DESIGN.md` 定稿 |
| 归属表 | `docs/MOBILE-DESKTOP-DECOUPLING.md`（桌面产出，本会话已评审通过） |

## 9. 风险与注意

- **内核样式不能一起删**：移动端仍需要 `@dlient/lakex-doc-react/style.css`（内核 UI 属①层外的共享项）。
- **`compat.css` 的 `.b3-*` / `fn__*`** 移动端 JSX 还有 **6 处**引用，迁移时一并清。
- **迁移期两端样式并存** ⇒ 护栏基线**单调下降**，不许回升。
- **不留半成品**：每屏迁完**立即**删对应桌面 import，禁止「先留着回头删」。
- **语雀仓是证据不是仲裁**：写结论必须带出处（文件 + 采样方式）；冲突时以 vendor bundle + 运行时实测为准。
- **不要复制 `yuque-re` 的产物进本仓库**（仓库只放契约与代码）。

