# VirtualRendering 试验（branch: experiment/virtual-rendering）

> 试验目的：验证 Lake 1.6.0+ 的 `virtualRendering` 能否解决「大文档首屏图片
> hydration 被拖后 ~3.5s」的实测问题（详见下方背景）。**试验分支，不上 main。**

## 背景（已实测定位）

打开含 107 个 codeblock 卡片的文档（`a5744231`）时，图片请求比编辑器打开
晚约 3.5s，而纯图片文档（`c0c36900`，52 图）只要 ~70ms。已排除：

- 网络（全部 200、无重试）
- 主线程阻塞（Long Tasks 合计 <1s）
- Lake 渲染（docInitPerf renderTime 仅 136-226ms）
- 标签页可见性（全程 visible=true）
- 懒加载门控（image plugin lazyLoad 默认 false）

结论：Lake 首次渲染含大量重卡片（107 codeblock）的文档时，卡片 UI 的
提交/hydration 被统一推迟。`virtualRendering` 只渲染可视区渲染单元，
理论上可让首屏卡片（含图片）立即 hydration。

## 本次改动（src/features/editor/lakeRuntime.ts）

在 `customOptions` 注入（`VIRTUAL_RENDERING` 常量开关）：

```ts
virtualRendering: true,
scrollNode: () => document.querySelector(".document-pane") || document.scrollingElement || document.body,
cardLazyInit: true,   // = allowCardLazyInit 的配置键：视口外卡片懒初始化
```

- `scrollNode` 必须指向真实滚动容器 `.document-pane`（body 是 overflow:hidden，
  Lake 默认拿 `document.scrollingElement || document.body` 会错位）
- `cardLazyInit` 让视口外卡片（含 codeblock）懒初始化，进一步降低首屏开销

## 如何测试

1. `npm run dev`（Node 24：`export PATH="$HOME/.nvm/versions/node/v24.18.0/bin:$PATH"`）
2. 打开 `a5744231`，重点看：
   - 图片是否秒出（原来要等 ~3.5s）
   - `window.__lakePerfReport()` 的「长任务」「docInitPerf」「图片请求」三张表
3. 对比 `c0c36900`（纯图片文档，基线无此问题）

## 回归清单（逐项手测）

- [ ] TOC 大纲：高亮跟随滚动位置正确；点击大纲跳转位置正确（无偏移/遮挡）
- [ ] TOC 展开/收起
- [ ] 表格卡片：浮动工具栏、单元格编辑、hover 样式
- [ ] 画板（BoardCard）：在虚拟区内渲染、拖拽、缩放；滚动出区再滚回
- [ ] 图片：粘贴/拖入上传、复制（clipboardHtml 链路）、webp→png
- [ ] 代码块：折叠/展开、复制、mode 切换、滚动进入可视区后 CodeMirror 正常出现
- [ ] 多标签：切换标签、隐藏标签的编辑器状态
- [ ] 移动端 viewer 模式（如可用）
- [ ] 大文档滚动流畅度（对比非虚拟渲染）

## 已知风险 / 待观察

- 虚拟渲染下滚动时可视区外内容会重建 DOM，若高度测量/渲染单元边界有 bug 会抖动
- TOC 偏移（`boundaryTopOffset`）可能需微调
- 表格/画板等重卡片在虚拟区内的进出场行为需重点验证
- `allowCardLazyInit` 未在 README 文档化（dist 反编译确认配置键为 `cardLazyInit`）

## 试验结束

- 结论 OK → 合回 `audit/code-optimization` 前把 `VIRTUAL_RENDERING.enabled` 置
  false（或按结论再评估），并同步 Electron-HANDOFF.md
- 结论 NG → 保留本分支 + 文档记录原因，回到 audit 分支

---

# Phase A：TOC / 表格工具栏 去补丁基线

> 用户观察：虚拟渲染后图片/性能全部正常，但 TOC 不显示（留空白）、表格浮动
> 工具栏缺失、工具栏不保持顶部——这些是老补丁，用户提议回归 Lake 原生再修。

## 已移除（本 commit）

1. **表格浮动工具栏**：`styles.css` 里 `.ne-inner-overlay-container .ne-card-toolbar { display: none !important; }`
   ——当年 z-index 大战失败后主动隐藏的，现在放开，让 Lake 原生渲染。
2. **TOC 固定定位补丁**：
   - `--toc-top` / `--lake-toolbar-height` 变量（:root）
   - `.ne-toc-sidebar { position: fixed; top: var(--toc-top) ... }`（钉窗口坐标系）
   - `.ne-normal-toc .ne-engine` 的 `padding-right: 80px` / `margin-right: 300px` 预留
   - `.ne-toc-view { margin-top: 0 !important }`
   ——让 TOC 回归 Lake 原生定位（依赖我们新配的 `scrollNode: .document-pane`）。

## 保留（宿主布局适配，非 Lake 打架）

- `.document-pane` 滚动容器、`min-width:0` 宽度链、`.multi-tab-editor overflow:visible`
- `.ne-engine { padding-left: 40px; padding-right: 56px }`、`.ne-editor-body { display: block }`
- 移动端工具栏重排（Phase B 再评估）

## Phase A 测试点

- [ ] TOC 大纲：重新出现？位置/高亮/点击跳转是否正常（scrollNode 生效后原生定位）
- [ ] 表格浮动工具栏：hover 表格后是否出现、可点击（若仍消失，见 z-index 链，Phase B）
- [ ] 确认无回归：图片、画板、思维导图、多标签切换、粘贴/复制
