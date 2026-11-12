# 参与贡献（CONTRIBUTING）

> 本项目是**个人自持数据**的本地优先笔记应用（桌面 macOS + Android），与语雀官方无关。
> 主代码以 **AGPL-3.0-only** 发布；语雀 Lakex 内核为**闭源第三方产物、以 vendored 形式随仓库分发**（未获授权，见 [NOTICE](NOTICE)）——改动前请先接受这一点。

## 先读什么

按顺序读，20 分钟能建立完整上下文：

1. [README.md](README.md) —— 项目是什么、怎么装、怎么跑。
2. [docs/HANDOFF.md](docs/HANDOFF.md) —— **唯一交接文档**：当前基线（§1）、跨批次风险（§2）、真实待办（§3）。分支/版本/计数等易过期事实**只**看这里。
3. [AGENTS.md](AGENTS.md) —— **长期红线与机制**（必读）：单一来源、设计系统、门禁分层、依赖准入、踩坑记录。
4. 用户视角：[guide/README.md](guide/README.md)（19 章中文手册）；要改用户可见行为时先对照手册，改完同步更新。

安全问题的报告方式见 [SECURITY.md](SECURITY.md)（**不要**开公开 issue 贴可利用细节）。

## 环境与首次准备

- **Node.js 24（必须）**：低版本会让 Vite 8 失败。示例：`export PATH="$HOME/.nvm/versions/node/v24.18.0/bin:$PATH"`
- 移动端另需 JDK 21 + Android SDK（口径见 [docs/MOBILE-OPS.md](docs/MOBILE-OPS.md)）
- 首次 clone 后：

```bash
npm install
npm run setup:remotes     # 配双远端（remote 不入库，每个 clone 都要跑）
npm run setup:lakex       # 仅当闭源内核产物缺失时（仓库已 vendored，通常不需要）
```

## 门禁：提交前必须跑

**每次改动至少跑（≈31–36s）**：

```bash
npx tsc --noEmit
npx vitest run <你改到的测试文件>   # 本地迭代；提交前跑全量 npx vitest run
git diff --check
```

- **改样式**：额外跑 `node scripts/ui-metrics.mjs` 与 `src/styles/cssLayers.test.ts`（层序/单元格数只许降）
- **动视觉/设备层**：只跑受影响的 1–2 个态（桌面 `npm run check:stylesnap -- --states`；移动 `npm run check:mobilesnap`）；全量矩阵（桌面 42 态、手机/平板 10 态、23 屏）只在换夹具、改装置、发版前跑 —— 口径见 AGENTS §3#21
- **改外壳几何/构成或重灌夹具**：先按 `--from <warm>.json --write-baseline` 重烤基线，否则下次全量必红

**CI（PR 门禁，不含设备）**固定跑：`tsc` + 全量 `vitest` + 双 `vite build` + `check:core` + `ui-metrics` + `check:bundle` + `check:arch`。设备/视觉门禁不进 CI（无需 AVD/GPU），由维护者在发版前人工跑。

## 提交与 PR 规则

- **一批一个目的**：拆分/搬移、行为修复、文档更新分开提交，纯搬移的批次**不得改导出名与行为**。
- **只 stage 本批文件**：仓库可能多人/多会话共用工作树，**绝不用 `git add -A`**；提交前 `git status` 分辨。
- **不提交**：构建产物（`dist*`、`release/`）、真机数据、日志、密钥、`.env`、截图中间产物。
- **提交信息**：`type(scope): 中文摘要`（type = feat / fix / chore / docs / test / refactor / perf / build / ci），一个提交说清「改了什么、为什么」。
- **PR 描述**：现象/根因 → 修法（判据落点）→ 护栏（测试名）→ 门禁结果（命令 + 实数）。设备类改动附设备级截图。
- **分支/发布**：`master` 是唯一长期分支；只有推注解 tag 才触发发布（版本号单一来源 = `package.json`，流程见 [docs/RELEASE.md](docs/RELEASE.md)）。**不要移动已发布 tag**。

## 红线（摘要，细则以 AGENTS.md 为准）

- **单一来源**：同一个交互/机制只能有一套实现与一套样式。改前先 grep；权威原语在 `kit.css` 的 `ln-*`、浮层用 `components/ui/Overlay`、分隔条用 `SplitHandle`。
- **不写第二套样式范式**：不引 Tailwind / shadcn / CSS-in-JS；令牌只用 `--lake-*`，颜色字面量只允许出现在 `src/styles/themes/`；层序用 `@layer`，不靠特异性或 `!important` 取胜。
- **不为旧数据写兼容**：判据是「这些数据能否删了重建」（AGENTS §3#7）。能，就删迁移、删兼容分支，不写「以后可能有用」的兜底。
- **依赖准入四问缺一不加**：解决已验证痛点 / 不引入第二套样式 / 体积与许可算过 / 删得掉。新依赖先过 AGENTS §3#17。
- **不动 vendored 内核与补丁**：`vendor/lakex-doc-react/**`、`public/vendor/**`（禁清理）与 4 处 `patches/`（升级/新增要先登记作用、重建方式与验法）。
- **内核只经既有 lazy 边界**：桌面入口不得静态 import `features/editor/lakeRuntime`；清单以 `src/features/editor/desktopKernelLazy.test.ts` 为准。
- **改行为必须带护栏**：新增/更改行为 = 新增或更新测试；修 bug 先写能红的用例（或说明为何无法自动测并在 PR 里给设备证据）。
- **文档即代码**：用户可见变化同步 `guide/`；新失败面回填 `docs/RESILIENCE.md`；内核新观测回填 `docs/LAKEX-CONTRACT.md`；设置项逐条回填 `settingsSearch.ts` 的 `SETTING_ITEMS`；状态变化回写 HANDOFF §1/§3。

## 许可与署名

- 自有代码以 **AGPL-3.0-only** 授权（[LICENSE](LICENSE)）。提交即表示你有权按该许可提供该代码。
- **不要求签署 CLA**；鼓励 `git commit -s`（DCO 风格的 `Signed-off-by`）表明你同意以本仓库许可贡献，但**不是门禁**。
- 第三方组件与例外见 [NOTICE](NOTICE)；闭源内核不属于本项目版权，不能由本项目按 AGPL 再授权。
- 不要在贡献里引入与 AGPL 不兼容的代码/资源；参考实现要写清出处。
