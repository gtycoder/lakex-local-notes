# LAKEX 底层迁移（2026-09-16）—— vendor 换源 + 内核 v1.99.0

> 分支 `feat/lakex-source-vendor`（基于 master）。目标：用 `@dlient/lakex-doc-react` **源码**替换旧 dist-only 的 `lakex-editor-react-component`，内核升到 v1.99.0，并借用其画板/导图/文本绘图卡片。
> 本地改动唯一清单：`vendor/lakex-doc-react/LOCAL-CHANGES.md`。

## 1. 做了什么
- 删除 `vendor/npm/lakex-editor-react-component`（旧 dist-only），换成上游 `Mueat/lakex-doc-react@4b068bd2`（MIT；包名 `@dlient/lakex-doc-react` 0.1.3）**整包源码**到 `vendor/lakex-doc-react/`（含内核转换管线 `scripts/convert-lakex.js`）。
- 根 `package.json`：`@dlient/lakex-doc-react: file:./vendor/lakex-doc-react`；`postinstall` patch 目录改指新 vendor；新增 `build:vendor`。
- 应用适配：`lakeRuntime.ts` 用 `Doc` + `GetDefaultEditorConfig('zh-cn')`；**删除自研 `BoardCard.tsx`**，改用其 6 张内置卡（`drawingBoardCard`/`mindmapBoardCard`/`flowchartBoardCard`/`umlBoardCard`/`mindMapCard`/`textToDiagramCard`）；移除第三方 embed 分组。
- 内核 v1.99.0（`lakex.js` 头部自证；与 `@lakex-react/core@0.2.1` 内核指纹 409/409 一致）。

## 2. vendor 产物怎么出（C1：产物入库）
- `npm run build:vendor`（= `npm --prefix vendor/lakex-doc-react run build`：`vite build` + `tsc -p tsconfig.build.json` + `postbuild`）。
- 产物 `vendor/lakex-doc-react/dist/{index.es.js,index.cjs.js,index.d.ts,style.css}` **已提交**；改了 vendor 源码必须重跑并提交产物。
- 移除 `inlineDynamicImports` 后还会产出懒加载 chunk（`DrawnixBoardCore-*.js` / `katex-*.js` / `MindMap*.js` / `icons-*.js` / `tree-ops-*.js`，ES+CJS 各一份），**同样必须提交**（漏提交 → 消费端动态 import 404）。

## 3. 构建期修复（非业务，记 LOCAL-CHANGES）
- vendor `DrawnixBoardCore.css` 3 行相对 `node_modules` 的 `@import` 改指仓库根（vendor 深了一层；`lakex-drawnix-react-board` 未导出 `./index.css`）。
- vendor `tsconfig.build.json` 加 `"types": []`（消除根 `@types/node` 的 `Timeout` 冲突）。
- vendor `vite.config.ts` **外部化重型卡片依赖**（mermaid/@plait/lakex-drawnix 等），`@xiangfa/mindmap` 保持内联：规避 rolldown “重新解析自己产物” 的 emit→parse bug（`Expected ) but found in`）；且 `@xiangfa` 内嵌 react@19，外置会双 React。其中 `@plantuml/core` **必须用正则**（`/^@plantuml\/core(\/|$)/`）才能匹配到 `plantuml.js`/`viz-global.js` 子路径——精确字符串匹配不到，7MB 的 `plantuml.js` 会内联进宿主主 chunk。
- 根 `.gitignore`：裸 `dist` → 锚定 `/dist`（否则 `vendor/.../dist` 与 `public/.../katex/.../dist` 都被忽略）。

### 3.1 首屏回归修复（自检发现）：vendor 画板卡必须懒加载
- **问题**：新 vendor 默认 `customCard` **静态**引入 4 张画板卡 → `DrawingBoardEditor/Viewer` 静态 import `DrawnixBoardCore` → `lakex-drawnix` + `@plait/*`（~4.2MB raw / 1.25MB gzip）随宿主**首屏**加载。master 上旧自研 `BoardCard` 本是 `React.lazy`，且 `scripts/e2e-electron-smoke.mjs` 有硬断言「普通文本启动不加载 Drawnix JS」——迁移把它打挂了。
- **修法（vendor）**：`DrawingBoardEditor/Viewer` 改 `React.lazy(() => import('./DrawnixBoardCore'))` + 局部 `Suspense`；移除 vendor `output.inlineDynamicImports`，产出 `DrawnixBoardCore-*.js` 懒加载 chunk（LOCAL-CHANGES #7）。
- **修法（app）**：`vite.config.ts` 的 `codeSplitting` 组加 `includeDependenciesRecursively: false`——默认 `true` 会把入口也需要的依赖并进 `drawnix` chunk，令入口**重新静态引用**它（对照实验：去掉该项后入口即出现 `from"./drawnix-*.js"`）。
- **效果**：入口不再静态引用 `drawnix-*.js`（`saveAsPng`/Drawnix 代码计数 0）；`app-js` gzip 1.89 → **1.82MB**；画板首次使用时才请求 `DrawnixBoardCore-*.js` + `drawnix-*.js` + `@plait_*.js`。

## 4. 离线本地化（本次一并做掉）
- **P1 PlantUML**：vendor `TextToDiagramCore.tsx` 从 unpkg 动态 import → 本地 `@plantuml/core`（**动态**导入，保持懒加载语义；LOCAL-CHANGES #6）。
- **drawnix 默认图**：`mdn.alipayobjects.com` → 镜像 `public/vendor/lakex/misc/drawnix-default.jpg`，构建期 `MIRROR_EXACT` 精确重写。
- **katex/mhchem 镜像此前未被 git 跟踪**（被根 `.gitignore` 裸 `dist` 吞掉）→ 已补入。
- 结果（桌面 + 移动产物）：`unpkg.com`=0、`mdn.alipayobjects.com`=0、`gw.alipayobjects.com`=0。
- **唯一残留**：内核 `lakex.js` 里 1 处 CSS `url(https://mass-office.alipay.com/design_kitchen/afts/img/Gb1wRJpalMUAAAAAAAAAABAADmmSAQBr/original)`（文本绘图卡某个 AI 按钮背景）。**已确认无法本地化**：`mass-office` 本机 HTTP 000 超时（内网域名），换 `mdn`/`gw` 同路径均 403（对象不在公开项目下），公开网络无镜像。**不造占位图**：CSS 背景加载失败只是不显示，无功能影响；手改内核违反红线，故保留原 URL 并记录在案（见 §6）。

## 5. 回归（隔离冒烟，未碰其他会话）
- **桌面**（dev 1461 / CDP 9225 / asset 19879；数据复制到 `$TMPDIR/lake-device-lakex`）：大文档 40 标题 → 原生 TOC **40 条** + 点击跳转（scrollTop 0→13580）；虚拟渲染滚到底部 **3 卡全部水合**（drawnix 核心/导图 43 节点/文本绘图）；**锁只读 viewer**；**回收站重开只读 + "已删除"横幅**；全程 0 JS 异常 / 0 4xx。
- **移动端**（emulator-5554；`bash scripts/android-build.sh --sync --install`）：首页 + 文档编辑器渲染、`window.__mobileEditor` 就绪、**图片经 AssetServer 全部加载（naturalWidth>0）**、0 异常 / 0 4xx。
- 门禁：`tsc` 0 · `vitest` 969/16 · 桌面 + 移动 build 通过 · `check:core` 0 违规 · `check:bundle` 通过（app-js gzip **1.82MB** / 预算 2.9MB、drawnix-js 408KB / 预算 1.4MB）。
- **画板懒加载复验**（隔离 dev 1461 / CDP 9225）：`scripts/e2e-drawnix-smoke.mjs` 通过——`drawing-board-resizer`=1、`.plait-board-container`=1，按需请求 `DrawnixBoardCore-*.js` + `lakex-drawnix.js` + `@plait_{core,common,draw,mind,text-plugins}.js`，0 fallback；**普通文本打开后 `drawnixJs=[]`**（`e2e-electron-smoke` 的关键断言通过；其 rail 宽恒 38px 断言在隔离窗口尺寸下失败，与本迁移无关）。
- **产物分包实渲染**：把构建产物里的 `viz-global-*.js` + `plantuml-*.js` 在带 DOM 的环境里真实加载，PlantUML 引擎跑通（`createDiagram ok` → `SequenceDiagramFactory`）并输出 `<svg>`（2878 字符）；确认懒加载分包可执行、离线可用。

## 6. 遗留 / 注意
- `mass-office.alipay.com` 那 1 处内核 CSS 背景：内网资源，本机不可达、无公开镜像（已试 `mdn`/`gw` 同路径均 403）。若将来能访问，走 `vite.config.ts` 的 `MIRROR_EXACT` 精确重写 + 镜像到 `public/vendor/lakex/misc/`（**不要手改内核**）。
- ✅ 已解决：PlantUML 曾因 `@plantuml/core` 精确匹配不到子路径而内联进主 chunk，导致 `check:bundle` 超预算；改用正则外置后拆为 `plantuml-*.js` / `viz-global-*.js` 懒加载分包（app-js gzip **3.93MB → 1.89MB**）。
- 与 UI/Web 会话合并：仅 `src/main.tsx`、`.gitignore` 两处**行级重合**（不同 hunk，可自动合并）；`HANDOFF.md` 各会话追加，合并时按段落解冲突。
- 内核私有字段（`_tocSidebar` / `_virtualNode.$appear` / React fiber `cardData`）在 v1.99.0 上实测仍有效（见 §5）。
- ✅ 自检一并清理：删掉随自研 `BoardCard` 变死的 CSS（`src/styles.css` 的 `.board-card-wrapper*` / `.board-card-guard`，并把「被动滚轮」规则重定向到现役 `.mindmap-interaction-gate`）；`e2e-drawnix-smoke.mjs` 旧写法依赖 `.board-card-wrapper` 与裸 IPC `createNote`（不刷新渲染层 store、点不到树节点）已重写。
- 文档同步：`LAKEX-CONTRACT.md`（内核路径/版本/画板卡 `$name`）、`README.md`、`AGENTS.md`、`DEVELOPMENT.md`、`electron/lakeProtocolProbe.test.ts` 注释都从旧包名/旧 bundle 行号更新到新 vendor。

## 7. 关键提交（`feat/lakex-source-vendor`）
- `d90b390` 底层切换（vendor 源码 + 应用适配 + 门禁）
- `0a3b51d` katex 镜像补齐 + `LAKE_DEV_SERVER_URL` 冒烟钩子 + LAKEX-CONTRACT §5.3
- `7e8f489` PlantUML + drawnix 默认图本地化
- `9355337` 图标收集顺序 + v1.99.0 私有字段回归
- （本次）PlantUML 子路径正则外置 → 懒加载分包，`check:bundle` 由红转绿
- （本次）自检修复：画板引擎首屏回归（vendor 懒加载 + app `includeDependenciesRecursively:false`）+ e2e 冒烟重写 + 死 CSS/过期文档清理
