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

## 3. 构建期修复（非业务，记 LOCAL-CHANGES）
- vendor `DrawnixBoardCore.css` 3 行相对 `node_modules` 的 `@import` 改指仓库根（vendor 深了一层；`lakex-drawnix-react-board` 未导出 `./index.css`）。
- vendor `tsconfig.build.json` 加 `"types": []`（消除根 `@types/node` 的 `Timeout` 冲突）。
- vendor `vite.config.ts` **外部化重型卡片依赖**（mermaid/@plait/lakex-drawnix 等），`@xiangfa/mindmap` 保持内联：规避 rolldown “重新解析自己产物” 的 emit→parse bug（`Expected ) but found in`）；且 `@xiangfa` 内嵌 react@19，外置会双 React。
- 根 `.gitignore`：裸 `dist` → 锚定 `/dist`（否则 `vendor/.../dist` 与 `public/.../katex/.../dist` 都被忽略）。

## 4. 离线本地化（本次一并做掉）
- **P1 PlantUML**：vendor `TextToDiagramCore.tsx` 从 unpkg 动态 import → 本地 `@plantuml/core`（LOCAL-CHANGES #6）。
- **drawnix 默认图**：`mdn.alipayobjects.com` → 镜像 `public/vendor/lakex/misc/drawnix-default.jpg`，构建期 `MIRROR_EXACT` 精确重写。
- **katex/mhchem 镜像此前未被 git 跟踪**（被根 `.gitignore` 裸 `dist` 吞掉）→ 已补入。
- 结果（桌面 + 移动产物）：`unpkg.com`=0、`mdn.alipayobjects.com`=0、`gw.alipayobjects.com`=0。**仍缺** `mass-office.alipay.com` 的文本绘图卡 AI 按钮背景（该域名本机 HTTP 000 不可达）。

## 5. 回归（隔离冒烟，未碰其他会话）
- **桌面**（dev 1461 / CDP 9225 / asset 19879；数据复制到 `$TMPDIR/lake-device-lakex`）：大文档 40 标题 → 原生 TOC **40 条** + 点击跳转（scrollTop 0→13580）；虚拟渲染滚到底部 **3 卡全部水合**（drawnix 核心/导图 43 节点/文本绘图）；**锁只读 viewer**；**回收站重开只读 + "已删除"横幅**；全程 0 JS 异常 / 0 4xx。
- **移动端**（emulator-5554；`bash scripts/android-build.sh --sync --install`）：首页 + 文档编辑器渲染、`window.__mobileEditor` 就绪、**图片经 AssetServer 全部加载（naturalWidth>0）**、0 异常 / 0 4xx。
- 门禁：`tsc` 0 · `vitest` 969/16 · 桌面 + 移动 build 通过。

## 6. 遗留 / 注意
- `mass-office` 图标（网络可达时补进 `MIRROR_EXACT`）。
- PlantUML 现在打进 vendor 主 bundle（`@plantuml/core` 未被 external 匹配到子路径），首屏偏大；后续可外置/懒加载。
- 与 UI/Web 会话合并：仅 `src/main.tsx`、`.gitignore` 两处**行级重合**（不同 hunk，可自动合并）；`HANDOFF.md` 各会话追加，合并时按段落解冲突。
- 内核私有字段（`_tocSidebar` / `_virtualNode.$appear` / React fiber `cardData`）在 v1.99.0 上实测仍有效（见 §5）。

## 7. 关键提交（`feat/lakex-source-vendor`）
- `d90b390` 底层切换（vendor 源码 + 应用适配 + 门禁）
- `0a3b51d` katex 镜像补齐 + `LAKE_DEV_SERVER_URL` 冒烟钩子 + LAKEX-CONTRACT §5.3
- `7e8f489` PlantUML + drawnix 默认图本地化
- `9355337` 图标收集顺序 + v1.99.0 私有字段回归
