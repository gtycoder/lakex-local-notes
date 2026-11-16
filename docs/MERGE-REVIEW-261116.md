# 合并评审清单 · modernize/web-platform-261115（261116）

> 用途：**合并回 master 前的评审材料**。按模块列改动面、风险、验证证据与回滚点。
> **261116 更新：用户已批准，本分支已 fast-forward 合并回 master 并发布 `v1.2.0`（补充了合并后的一批：设置页体系、S3 弹窗、overlay 嵌套模态根因修复、图标 C 路径、移动端加载动效与设置页 A1/A2；共 72 commit / 276 文件）。** 本文保留为当时评审材料。
> 原始现状（落盘时）：分支 60 commit，master `7e2db298`，备份 tag `backup/master-261115` → `0f900a1a`，双远端同步。

## 0. 合并前必须知道的五件事

1. **视觉基线按本分支重烤过**：桌面 42 态（严格比对 34 + 跳过 8 窄窗 + `note-info`/`settings-about` 两个异步竞态）、移动 10 态、多维表 3 态。合并后跑门禁用本分支的基线文件（已在 `scripts/*/baseline/`）。
2. **`tsconfig` 已升 ES2024**，运行期由 `src/lib/es2024Fallback.ts` 在两个入口兜底老 WebView（`toSorted`/`toReversed`/`withResolvers`）。回滚 tsconfig 时这三处会立即 TS2550。
3. **AI 对话面只用 mock DOM 验过样式与分支交互**，没有真实 API Key 的流式对话；合并后建议人工点一轮（停止/重新生成/切版本/编辑提问）。
4. **A13 的取舍**：桌面 **13/13** 个下拉调用点已换原生 `<select>`（`appearance: base-select`，经 `AdaptiveSelect`）。原生弹层**不能**做按需滚动渐隐、图标只能是字符——有意接受的能力退化；`Select.tsx` 仍在（不支持 base-select 时的降级路径）。字号/资源类型/供应商/模型这几个调用方**闭态方向键会逐档写盘**（重排/重新筛选/重置默认值），用户 261116 明确接受。
5. **两个异步竞态态被移出严格比对**（`FLAKY_ASYNC`，脚本头有证据）：`note-info`（标签异步读回 2596↔2605）、`settings-about`（关于页依赖清单异步加载）。不是放过样式问题，是装置竞态。

## 1. 分模块清单

| 模块 | 主要 commits | 改动面 | 风险 | 验证证据 | 回滚点 |
| --- | --- | --- | --- | --- | --- |
| **审查/文档** | `8e6bbe03` `f334362a` `f4a6406c` `6f0dcce7` 等 docs | 审计 v2 + §11/§2.6 + 交接 | 低（纯文档） | analyzer 0/0 | 单独 revert docs 提交 |
| **IME 回车** | `f55bc35b` | 35 处 / 27 文件 + `core/ime.ts` | **中**（输入路径） | `ime.test.ts`、`imeEnterWiring.test.ts`（35 处清单钉死） | revert `f55bc35b` |
| **启动页/首帧** | `14dcdf15` | `boot.html` 476KB→1.9KB、图片外置、`color-scheme`/`light-dark` | 低 | `bootAssets.test.ts`（5 例）+ 打包 smoke | revert `14dcdf15`（`build.files` 三件套同回） |
| **CSS 现代写法** | `7a0dc111` `ea10e334` `fc31e534` | `field-sizing`/标准 `mask`/`text-wrap`/删 no-op、`forced-colors` | 低 | `modernCssGates.test.ts`、`cssLayers` 棘轮 | 独立提交 |
| **字号缩放（A03）** | `75153e8e` `60d851fe` `db793240` `6c0fdfa0` `8a828e74` `87b3dbc1` `bff0c792` `4cf6e783` | 字号 token 全 rem（rem×16=原 px）+ 28 条文字容器 `min-height` + 200%/400% 走查 | **中**（全局排版） | `textScale.test.ts`；100% 几何探针（逐批）；200% 扫描 2 处；400% 桌面 27→2 | 逐批倒序 revert（先批 4…批 1，再 token 化） |
| **容器查询（A17）** | `ceb1e150` | `.note-info-dialog` `container-type` + 折列改 `@container` | 低 | 实测 720=两列、560/500=单列；快照 0 差异 | revert `ceb1e150` |
| **浮层/对话框（A02/A23）** | `980a5619` `496744fb` `229e78ec` `64ef15b4` `b5e6fecd` `4181198c` | 菜单进 top layer；**26 处**对话框迁原生 `<dialog>`；模态内菜单改挂进 dialog | **高**（层级/焦点） | `NativeDialog.render.test.tsx`(6)+`overlayContainer.test.ts`(3)+overlay-matrix 实测 | 倒序回；`4181198c` 是修复须先回 |
| **焦点与 inert** | `84dc8005` `de4fb006` | 模态背景 inert（引用计数）+ 焦点回退 + 移动 Sheet 背景 inert | 中 | 4 例 focusRestore + 1 例 MobileSheetInert；实测 Esc → MAIN | revert `de4fb006` → `84dc8005` |
| **键盘/地标/图片/移动** | `4d6d9e39` `2d5f5b2d` `ef02a966` `c4b47e9b` `1d07fd60` `1eebd5bc` `81d95bd3` `bd790132` | 3 处键盘激活、2 处焦点环、`role=main`、`enterKeyHint`、图片 `decoding`、移动顶栏实底、漏收测试、午夜假红 | 低 | 各自护栏（keyboardActivation/focusRing/landmark/enterKeyHint/imageAttr） | 逐条 revert |
| **JS 现代 API（A21）** | `84af9e42` `69631b9c` | `cause`/`AbortSignal.timeout`；**tsconfig ES2024** + `toSorted` 73 处 + `withResolvers` + 老 WebView 兜底 | **中**（全仓运行时） | `es2024Fallback.test.ts`(3)；analyzer 0 findings | 先 revert `69631b9c`，再 `84af9e42` |
| **AI：流式与跟随** | `ddcff804` | `useThrottledMarkdown` + `useStickToBottom`（两宿主接线） | 中 | 8 例 hook 测试 | revert `ddcff804` |
| **AI：观感重排** | `8a8ff43c` | AI 弹窗/写作/移动 AI 页（760 列、气泡、大卡片） | 中（视觉） | 截图 `.css-audit/ai-reskin/`；棘轮登记 | revert `8a8ff43c` |
| **AI：消息版本/分支** | `c6d4d722` | 树 + 当前路径；重新生成/编辑分叉/切版本锚定 | **高**（会话模型） | 12 例纯函数 + 3 例组件；旧格式丢弃不迁移 | revert `c6d4d722` |
| **主题** | `95474f7e` | 新增「清爽（浅色）」（桌面+移动 token-only） | 低 | `themes.test.ts`(3) + 截图 | revert `95474f7e` |
| **代码块（P4）** | `c0a212ba` `5e7a8cd8` | 行号 + 复制（不引高亮库） | 低 | 2 例渲染测试 | revert `c0a212ba` |
| **原生下拉（A13）** | `fd39d1bd` `5e7a8cd8` + 本轮 | `NativeSelect`/`AdaptiveSelect` + `kit.css` 变体；**桌面 13/13 个下拉调用点**（设置 6 / AI 4 / 字号 / 发布目标 / 资源类型） | 中（交互细节：逐档写盘、原生 picker 图标） | 13 例 rollout 测试（支持/降级双路径）；实机 `appearance=base-select`、模态内菜单可点 | 先回调用点，再回 `kit.css`/`NativeSelect` |
| **脚本工具** | `4cf6e783` `bec6edab` | 窗口 smoke 摘 `ELECTRON_RUN_AS_NODE`；stylesnap `FLAKY_ASYNC`；基线重烤 | 低 | 窗口 smoke 通过（bounds 一致） | 独立提交 |

## 2. 建议合并顺序（若批准）

```bash
git merge --no-ff modernize/web-platform-261115   # 或按模块 cherry-pick
npx tsc --noEmit && npx vitest run && node scripts/ui-metrics.mjs
node scripts/css-audit/check-stylesnap.mjs --port 9222   # 桌面 42 态（本分支基线）
npm run check:mobilesnap && npm run check:bitablesnap    # 需 lake_gate(5556)+9336
```

人工点收（不可自动化）：IME 组合态回车不提交 · 设置里开下拉 Esc 只关菜单 · 原生 dialog 内菜单可点 · AI 真实 Key 一轮流式 + 停止/重新生成/切版本/编辑提问 · 系统 200%/400% 字号不裁字。

## 3. 回滚预案

- **整体回滚**：`git revert -m 1 <merge-commit>`（保留分支历史）。
- **分模块回滚**：按上表「回滚点」逐条 revert；同模块内按倒序。
- **基线回滚**：`git checkout <old> -- scripts/css-audit/baseline scripts/mobile-audit/baseline` 后**必须重烤**，不能只改数字。
- **数据影响**：本分支没有任何数据格式变更（AI 会话树只在内存；旧格式读取即空）。唯一持久化面 = 主题偏好（新增合法 id，旧版本读到回退 light）。

## 4. 明确不合并 / 不做

- 读屏（VoiceOver/TalkBack）实测：用户裁决不做，`PRODUCT.md` 已写明不承诺。
- A05 树窗口化：用户裁决不做（`content-visibility` + `contain-intrinsic-size` 已在位）。
- 状态栏成对改高：牵动 `--statusbar-reserve` 三处手算常量，风险 > 收益。
- 移动端 400% 固定高度 chrome 重构：超出 WCAG AA（200%），内容可见溢出非隐藏裁切。
- 正式发 beta：流水线只认 `vX.Y.Z` 且无 `prerelease` 标记，需先改两处。

## 5. 附：完整 commit 列表

`git log --oneline --reverse master..modernize/web-platform-261115`（本文件落盘时 59 条）。