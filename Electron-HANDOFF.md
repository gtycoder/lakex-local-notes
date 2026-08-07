# Lake Notes Electron 会话交接文档

> 写给完全没有上下文的新会话。开始工作前请先通读本文，再查看 `git status` 和最近提交。
>
> 本文对应项目：`/Users/admin/file/local-lake/lake-notes-electron`

## 1. 当前快照

| 项目 | 当前信息 |
| --- | --- |
| 项目目录 | `/Users/admin/file/local-lake/lake-notes-electron` |
| Git 远程 | `origin = https://gitee.com/gtycoder/local-lake.git` |
| 本轮工作基线 | `95dcaf2 feat(lock): per-note read-only lock with native Lake Viewer + S3 manifest v3` |
| 当前任务 | 修复锁定态思维导图消失、画板新增元素跳顶部/闪烁，并保留此前代码块、图片下载和大纲修复 |
| 本轮目标 | 已提交并推送到远程 `origin/master`；新会话先确认远程和工作区状态 |
| Node | 必须优先使用 Node 24：`$HOME/.nvm/versions/node/v24.18.0/bin` |
| 开发数据 | `/Users/admin/Library/Application Support/lake-notes-dev`，禁止删除或清理 |
| 正式数据 | `/Users/admin/Library/Application Support/lake-notes-electron`，禁止触碰 |

### 绝对不能做的事情

- 不要执行 `git reset`、`git checkout -- .`、`git clean -fd` 等会丢弃工作区的命令。
- 不要覆盖或删除其他未提交修改；先看 `git status` 和 `git diff`。
- 不要修改 `node_modules`。
- 不要删除或直接修改开发/正式用户数据目录。
- 不要使用 `pkill -f Electron`；机器上还有 Trae、SiYuan、VS Code 等其他 Electron 应用。
- 清理测试笔记必须走应用 UI 删除流程，不能直接改 SQLite，否则可能被 S3 同步恢复。

## 2. 任务目标

本轮围绕以下问题展开：

1. 新建代码块时偶发只有空壳、没有可编辑空间；关闭文档再打开后才正常。
2. 用户粘贴的 `gw.alipayobjects.com/zos/skylark/...` 图片远程下载失败；不能把它误判为本地资源访问问题。
3. 文档锁定后必须使用真正只读的 Lake Viewer，同时保持页面位置、原生卡片和思维导图可见。
4. 桌面端禁用 Lake 原生大纲 UI、使用自建右侧大纲时，不能影响 TOC 数据和卡片水合。
5. 画板新增/删除元素、文本编辑和工具栏操作不能导致正文跳回顶部或明显闪烁。
6. 代码块的最小可视编辑空间约为一行，目标约 `24px`，而不是原来的约 `72px`。

## 3. 已完成内容

### 3.1 锁定态与原生 Viewer

相关文件：

- `/Users/admin/file/local-lake/lake-notes-electron/src/features/editor/EditorTab.tsx`
- `/Users/admin/file/local-lake/lake-notes-electron/src/features/editor/lakeRuntime.ts`
- `/Users/admin/file/local-lake/lake-notes-electron/src/styles.css`
- `/Users/admin/file/local-lake/lake-notes-electron/src/features/editor/MultiTabEditor.tsx`
- `/Users/admin/file/local-lake/lake-notes-electron/src/App.tsx`

已实现：

- 每个文档单独保存锁定状态；锁定后重建为 Lake 原生 Viewer，保证真只读。
- 锁定/解锁时记录并恢复真实滚动位置。
- 编辑态真实滚动容器是 `.ne-editor-wrap`，锁定态真实滚动容器是 `.ne-viewer`。
- 桌面锁定态 `.ne-viewer` 设置为 `height: 100%`、`overflow-y: auto`，避免锁定后无法滚动或滚动交给错误的外层容器。
- Viewer 关闭虚拟渲染，避免自定义卡片停留在 hole 空壳。

#### 思维导图问题的根因与修复

Lake 默认 `mindmap-card` 的 Viewer 内部会访问：

```ts
this.props.editor.theme.currentThemeSchema.colorScheme
```

但 `Doc.createOpenViewer()` 注入到自定义 `viewerComponent` 的 props 中没有 `editor`，因此锁定态会在 render 阶段抛出异常，整张思维导图消失。

当前 `prepareCustomCards()` 在注册配置边界做兼容包装：

- 识别 `mindmap-card`；
- 兼容 `custom-mindmap-card` 和 `slash.mainSearch === "/mindmap"`；
- 当 `props.editor` 缺少主题结构时注入最小的 `editor.theme.currentThemeSchema.colorScheme`；
- 不修改 `node_modules`。

### 3.2 画板不跳顶部、不闪烁

相关文件：

- `/Users/admin/file/local-lake/lake-notes-electron/src/features/editor/BoardCard.tsx`
- `/Users/admin/file/local-lake/lake-notes-electron/src/features/editor/EditorTab.tsx`

当前方案：

- `BoardCard` 在 `Drawnix.onChange` 前读取当前真实滚动位置。
- `updateCardValue()` 后派发 `lake-board-contentchange` 自定义事件给所属 `.lake-editor-tab`。
- `EditorTab` 监听画板专属事件，并结合以下位置来源计算稳定锚点：
  - 画板变更回调报告的位置；
  - 最近一次稳定滚动位置；
  - 最近一次观察到的滚动位置。
- 仅当滚动容器确实跳到顶部时恢复位置，不持续抢夺用户主动滚动。
- 恢复时重新解析 `.ne-editor-wrap` / `.ne-viewer`，兼容 Lake 更新卡片后替换滚动容器的情况。
- 恢复安排在布局完成后的延迟窗口，避免同一帧多次写 `scrollTop` 造成闪烁。
- 画板工具栏可能通过 portal 离开 host，因此额外监听 document 层 `.island` / `.tool-icon`。
- Drawnix 文本编辑、工具栏和 Delete/Backspace 事件在 `BoardCard` 内阻断向 Lake 外层冒泡；CardResizer 手柄保留放行。

这条专门的画板变更事件很重要：Drawnix 新增元素不一定触发 Lake 的 `contentchange`，不能只依赖 Lake 事件做滚动恢复。

### 3.3 代码块新建流程

相关文件：

- `/Users/admin/file/local-lake/lake-notes-electron/src/features/editor/lakeRuntime.ts`
- `/Users/admin/file/local-lake/lake-notes-electron/src/features/editor/EditorTab.tsx`
- `/Users/admin/file/local-lake/lake-notes-electron/src/styles.css`
- `/Users/admin/file/local-lake/lake-notes-electron/index.html`

已实现：

- CodeMirror 资源切换为新版资源：

```text
./vendor/cdn/as/g/larkgroup/lake-codemirror/7.1.3/CodeMirror.js
```

- `index.html` 和 Lake `codeblock.codemirrorURL` 使用同一套新版资源。
- 桌面端关闭原生 TOC 后，卡片水合不能再依赖原生 TOC watcher；当前有独立的可见卡片水合逻辑。
- 对视口内尚未 `$appear()` 的卡片主动执行水合，覆盖新建/粘贴代码块。
- 对编辑态仍没有 CodeMirror 实例的可见代码块提供收敛式重建兜底：
  - 使用最近一次拿到的文档内容，避免覆盖刚输入内容；
  - 连续重建没有改善时停止，避免死循环。
- 空代码块、`.CodeMirror`、`.cm-editor` 的最小高度调整为约 `24px`，保证至少有一行可点击/编辑空间。

### 3.4 图片下载与 CDN 重定向

相关文件：

- `/Users/admin/file/local-lake/lake-notes-electron/electron/main.ts`
- `/Users/admin/file/local-lake/lake-notes-electron/electron/cdnRedirect.ts`
- `/Users/admin/file/local-lake/lake-notes-electron/electron/cdnRedirect.test.ts`
- `/Users/admin/file/local-lake/lake-notes-electron/src/features/editor/resourceUpload.ts`

根因：

- `gw.alipayobjects.com` 不只是 Lake 运行时 CDN，也承载用户粘贴的远程图片。
- 如果按 host 全量重定向到本地 asset server，未镜像的用户图片就会被错误改写成本地 404。
- `cdn.nlark.com/yuque/...` 图片可正常下载；失败的是 `gw.alipayobjects.com/zos/skylark/...` 图片。

当前方案：

- 只把实际存在于 `public/dist/vendor/cdn` 的 Lake 运行时资源重定向到本地。
- 未镜像的 `gw.alipayobjects.com/zos/skylark/...` 请求保持原始网络请求，不做本地重定向。
- 保留远程资源下载的 SSRF 审计逻辑。
- `cdnRedirect.test.ts` 覆盖：
  - 已镜像 CodeMirror 可重定向；
  - `gw /zos/skylark` 用户图片不重定向；
  - 非目标 host、缺失资源、目录穿越路径不重定向。

### 3.5 自建右侧大纲与禁用原生大纲

相关目录：

```text
src/features/outline/
  OutlineController.ts
  OutlineList.tsx
  OutlineSidebar.tsx
  registry.ts
  useOutline.ts
  outline.css
```

已实现并保留：

- Lake 内核仍生成 TOC 数据和 `tocChange`，桌面端只关闭原生 TOC UI，不禁用 TOC 插件。
- 应用自建右侧大纲支持：
  - activity rail；
  - 悬停预览；
  - 固定/取消固定；
  - 宽度拖拽；
  - 标题层级标签和竖向层级线；
  - 折叠/展开；
  - 筛选；
  - 当前标题跟随；
  - 多标签注册与导航。
- `disableNativeToc` 只设置 `toc.enable = false`，不能改成 `disabledPlugins: ["toc"]`。
- 多标签下大纲控制器必须按 noteId 注册，不能共享旧 tab 的大纲状态。

### 3.6 生命周期、性能和安全修复

- React StrictMode 下 cleanup 不再使用 `host.replaceChildren()` 拔掉整个编辑器 host；只清理 mount 内容，并在必要时重新挂回 mount。
- TOC 刷新重试定时器可在 Editor/LakeEditor 销毁时清理，避免旧实例被异步回调触碰。
- 图片/资源 IPC、窗口导航和远程请求的安全审计改动继续保留。
- 保留性能 mark、长任务观察器和 Lake 初始化耗时埋点；需要时可在 DevTools 执行 `window.__lakePerfReport?.()`。

## 4. 当前问题 / 当前状态

目前没有已知 P0 阻塞。用户已确认以下两类问题恢复正常：

- 锁定后思维导图不再消失；
- 画板新增加元素不再跳到顶部。

本轮自动化验证已通过：

```text
npx tsc --noEmit
npm test -- --run
node node_modules/vite/bin/vite.js build
git diff --check
```

最近一次测试结果：

```text
8 个测试文件通过
126 个测试通过
```

构建仍会给出两个非阻塞提示：

1. Vite 提示 `index.html` 中新版 CodeMirror 脚本不是 `type="module"`，这是因为该脚本需要作为传统全局资源加载，当前不应贸然改成 module。
2. 生产构建提示部分 chunk 大于 500 kB；这是现有 Electron/Lake/Drawnix 依赖体积警告，不是本轮功能失败。

尚需新会话按真实 UI 做一次回归，尤其是：

- 锁定/解锁后滚动位置；
- 锁定态思维导图、画板、代码块、图片；
- 画板新增元素、删除元素、工具栏操作、画板内文本编辑；
- 画板操作是否在极端位置仍有闪烁；
- 新建多个代码块并立即编辑；
- 两类图片地址：`gw.alipayobjects.com/zos/skylark/...` 和 `cdn.nlark.com/yuque/...`。

## 5. 下一步计划

1. 新会话先执行：

```bash
cd /Users/admin/file/local-lake/lake-notes-electron
export PATH="$HOME/.nvm/versions/node/v24.18.0/bin:$PATH"
git status --short
git log --oneline --decorate -5
```

2. 确认远程 `origin/master` 已包含本轮提交；不要误把远程 master 再次回退到 `95dcaf2`。
3. 用开发数据做最小 UI 回归：
   - 打开包含思维导图和画板的笔记；
   - 滚动到中部后锁定/解锁；
   - 在画板中新增、删除和编辑元素；
   - 新建代码块并输入内容；
   - 粘贴两种远程图片地址。
4. 若发现新问题，优先添加最小诊断日志确认真实触发链路，再修改；不要继续无限叠加定时器。
5. 后续若要改大纲系统，先阅读 `src/features/outline/` 和本文件中的大纲约束，再确认不会重新启用原生 TOC UI 或破坏多标签注册。
6. 如果要继续做性能优化，优先分析 Lake/Drawnix 卡片重绘和大文档序列化，不要先牺牲只读正确性或资源安全检查。

## 6. 踩过的坑

1. **不要全量重定向 `gw.alipayobjects.com`。**它同时承载运行时 CDN 和用户图片；只能按本地镜像文件存在性精确重定向。
2. **不要禁用 `toc` 插件。**`disabledPlugins: ["toc"]` 会让内核 TOC 数据和 `tocChange` 一起消失；桌面端应使用 `toc: { enable: false }`。
3. **Viewer 不一定注入 `editor`。**默认思维导图 Viewer 直接读取 `props.editor.theme`，锁定态必须做兼容层或使用明确支持 Viewer 的组件。
4. **Viewer 和 Editor 的真实滚动容器不同。**编辑态使用 `.ne-editor-wrap`，锁定态使用 `.ne-viewer`；把滚动绑定到 `.lake-editor-main` 或 `.document-pane` 外壳会造成跳顶、虚拟渲染测量错位或锁定后无法滚动。
5. **画板新增元素不一定触发 Lake `contentchange`。**必须在 Drawnix `onChange` 路径传递画板专属事件。
6. **恢复 scrollTop 不能每个 scroll/RAF 都写。**过多恢复路径会和 Lake/Drawnix 布局竞争，造成闪烁；应记录交互前位置，只在确认跳顶后恢复一次或少量延迟恢复。
7. **工具栏可能是 portal。**只监听画板容器内部无法覆盖 `.island` / `.tool-icon`，需要 document 层补充，但必须限定当前可见 tab 且当前 host 确实有画板。
8. **CardResizer 事件不能被全部拦截。**画板文本和工具栏事件可以阻断外层 Lake 选区逻辑，但 resizer 手柄必须放行。
9. **React StrictMode 会双挂载 effect。**cleanup 不能把 host/mount 从 DOM 拔掉，否则第二次挂载时可能在脱离文档的节点上创建 Lake，引发空白或 DOM range 断言。
10. **不要用旧代码块资源。**旧 `./vendor/lakex-doc/codemirror.js` 会导致新建 Slash 代码块只有空壳；当前统一使用新版 Lake CodeMirror 7.1.3 镜像。
11. **不能因为自建大纲而让卡片水合依赖原生 TOC。**原生 TOC UI 被关闭后，新建代码块必须由独立的可见卡片水合逻辑处理。
12. **不要删除用户数据目录来解决单实例或测试问题。**遇到 Electron `SingletonLock`，先检查并正常关闭本项目进程；不要删除 `lake-notes-dev` 或正式目录。
13. **不要用默认 Node 18 跑 Vite/Vitest。**当前项目按 Node 24 验证。
14. **构建输出中的大 chunk 警告不是本轮失败。**先区分 warning 和真正的类型/测试/运行时错误。
15. **不要把“关闭再打开后恢复”误认为已解决。**这通常说明新建/初始化路径没有完成卡片水合，应优先检查 `$appear()`、viewer/editor 注册和真实滚动容器。

## 7. 关键命令

### 静态检查

```bash
export PATH="$HOME/.nvm/versions/node/v24.18.0/bin:$PATH"
cd /Users/admin/file/local-lake/lake-notes-electron
npx tsc --noEmit
npm test -- --run
node node_modules/vite/bin/vite.js build
git diff --check
```

### 启动开发版

```bash
export PATH="$HOME/.nvm/versions/node/v24.18.0/bin:$PATH"
cd /Users/admin/file/local-lake/lake-notes-electron
npm run dev
```

`npm run dev` 会启动 Vite `127.0.0.1:1421`，并由 Vite Electron 插件拉起开发版 Electron；若已有本项目实例，可能触发单实例锁。

### 关键排查文件

```text
src/App.tsx
src/features/editor/MultiTabEditor.tsx
src/features/editor/EditorTab.tsx
src/features/editor/LakeEditor.tsx
src/features/editor/lakeRuntime.ts
src/features/editor/BoardCard.tsx
src/features/editor/resourceUpload.ts
electron/main.ts
electron/cdnRedirect.ts
src/features/outline/
src/styles.css
```
