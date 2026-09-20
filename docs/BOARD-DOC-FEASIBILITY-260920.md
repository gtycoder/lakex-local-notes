# 独立画板文档（kind=board）可行性验证 —— 260920

> 起因：用户问「当前 lake 资源下，画板和思维导图能不能做成一个单独的目录，新建一个画板、只做画图」。
> 本文 = 调研结论 + 本分支（`feat/board-document`）已落地的 v1 实现 + 实测数据 + 剩余风险。
> 相关：`docs/SHEET-BITABLE-DESIGN-260918.md`（新增 kind 的通用蓝图）· `docs/STORAGE-LAYERS.md` · `docs/LAKEX-CONTRACT.md` §5.13 · `vendor/lakex-doc-react/LOCAL-CHANGES.md` #18。

## 一、结论（一句话）

**可行，而且比表格/多维表更轻**：画板引擎（`lakex-drawnix` + `@plait/*`，MIT）是**独立于 Lake 内核**的 npm 包，
vendor 里的 `DrawnixBoardCore` 只吃 `{ value, readOnly, locale, theme, ai, onChange }`，
**运行时不 import 内核**（零内核实例、零 `.lake` 正文、无卡片上下文），因此「文档树里新建一个画板、打开就是一张整屏画布」
可以直接按既有 `kind` 机制接上（与 `kind=sheet` / `kind=bitable` 同构）。

顺带核实：**语雀自己的内核也把 board/mind 当文档类型** —— 内核 `getIconClassName` 白名单是
`['doc','sheet','design','thread','board','mind']`，CDN 镜像里也有 `doc-type-board.svg` / `doc-type-sheet.svg` /
`doc-type-table.svg`（`dist/vendor/lakex/alipay/`）。我们做 `kind=board` 是与官方形态对齐，不是自创。

## 二、证据（本仓库现有资源，均可复核）

| 事实 | 证据 |
|---|---|
| 画布内核可脱离内核独立挂载 | `vendor/lakex-doc-react/src/cards/DrawingBoard/DrawnixBoardCore.tsx` 的 props 只有 `value/readOnly/locale/theme/ai/onChange/onViewportPersist`；其 5 个本地子组件（ShapeCatalog / ExportMenu / MaterialLibrary / ContextMenu / AIBoardAssistant）只 import `@plait/*` + `lakex-drawnix` + `react-dom`，**无 `lakex.js`/`Doc`** |
| 「只做画图」是既有设计 | `.lakex-drawnix-core .app-toolbar { display: none !important }` —— 上游的文件/分享菜单在**卡片**阶段就被隐藏，剩下的就是工具条 + 画布 |
| 工具条内容（实机截图 + DOM） | 手型 / 选择 / 思维导图 / AI 助手 / 文本 / 画笔 / 箭头 / 形状 / **图片** / 导出（PNG·SVG）；点「形状」开图形库（矩形/圆角矩形/圆形/流程图符号/UML 符号…） |
| 场景数据可搬运 | 卡片值 `{version:2, engine:'drawnix', preset, plaitValue, plaitViewport, previewImage, cardHeight}`；`plaitValue` 就是 `BoardDoc.elements`，`src/core/boardDoc.ts` 的 `boardDocFromCardValue` / `cardValueFromBoardDoc` 双向无损（已单测） |
| 分包已存在且懒加载 | `DrawnixBoardCore-*.js` 343KB raw / **118KB gzip** + `drawnix-*.js` 1488KB / **415KB gzip**，**不在首屏 index chunk**（首屏 app-js gzip 1.78MB / 预算 2.90MB） |
| CSP 相容 | `lakex-drawnix` / `lakex-drawnix-react-board` / `@xiangfa/mindmap` 三个包内 `eval`、`new Function` 计数均为 **0**（不会重演 FortuneSheet/CE 那类 CSP 崩） |
| 文档内画板卡未被影响 | `npm run test:drawnix` 在隔离实例上通过（`drawnixModuleRendered:true`、`fallback:false`、按需请求 `DrawnixBoardCore-*.js` + `@plait_*`） |

## 三、本分支已落地的 v1（`feat/board-document`，基于 `feat/bitable` 检查点）

**数据层** `src/core/boardDoc.ts`（纯核心、可单测）
```
BoardDoc = { kind:"board", version:1, engine:"drawnix", preset:"drawing|flowchart|uml|mindmap",
             presetInitialized?, elements: unknown[], viewport?: {x,y,zoom} }
```
工厂 / `parseBoardBody`（坏数据一律退化成空白画板，不抛错）/ `boardToBody` / `boardToSearchText`（抽形状文字、文本块、思维导图节点、连线标签）/ 卡片互搬。

**主进程与协议**：`store.createBoardIn` + `bodyPathFor` 加 `boards/{id}.board.json` + 构造时 `mkdir boards/` + `searchTextFor` 分派；
IPC `create_board_in`（`registerNotes.ts` + `preload.cjs` + `webApiServer.ts` + `src/lib/native.ts` 桥接三处齐）。

**渲染层**：`Sidebar` 右键「新建画板」（`PenTool` 图标 + 行图标按 kind 区分）→ `useNoteLifecycle.createBoardIn`（显式给 `OpenTab.kind`）→
`MultiTabEditor` 按 `kind` 懒加载 `src/features/board/BoardEditor.tsx`（与 SheetEditor/BitableEditor 同一个错误边界隔离，只读/回收站/锁定统一走 `readOnly`）。

**BoardEditor 的四条硬约束**（都有护栏测试 `src/features/board/boardEditorMount.test.ts`）
1. **零内核实例**：只挂 `DrawnixBoardCore`，不 import `lakeRuntime`/`EditorTab`。
2. **只存场景 + 视口**：卡片的 `previewImage`（整幅 PNG data URL）与 `cardHeight` 收到即丢，绝不落盘。
3. **视口不回灌**：pan/zoom 走 `onViewportPersist` 存 ref，只在真的保存时写进正文（保住 260916「拖一下画布不该触发保存」的结论）。
4. **首次可见才挂载画布**（keep-alive 下隐藏态量到 0 尺寸会画不出来，与 SheetEditor 同因）+ 自动保存 800ms 防抖 + 与上次序列化比较（不会「打开即标脏」）。

**协议安全闸**：`kind` 新增取值 ⇒ `MANIFEST_VERSION 6 → 7`（`READABLE_MANIFEST_VERSIONS` 加 7）。
原因：旧端 `normalizeNoteKind` 对未知取值**静默回退 `doc`**，会把画板 JSON 当 Lake 文档导入并保存 = 毁正文；
升版本后旧端按既有「版本不兼容」整轮拒绝（代价：所有端一起升级，与 v5→v6 的取舍一致）。

**移动端**：`doc_kind` 映射、`noteRepository.normalizeDocKind`、`NotebookWorkspace` 占位文案、回收站预览
（`TrashPreviewPage` 原先无条件挂 LakeEditor ⇒ 现在非 doc 一律挡住）全部按新 kind 收口。

## 四、实测（260920，隔离 userData `$TMPDIR/lake-board-smoke-a1` + CDP 驱动真实 Electron）

起法：`LAKE_USER_DATA=$TMPDIR/lake-board-smoke-a1 LAKE_ASSET_PORT=19879 npm run dev`（真实数据未被读写）。

| 验证项 | 结果 |
|---|---|
| 右键「新建画板」→ 目录出现 + 打开的是画板（无可见 Lake 编辑器） | ✅ 树行图标 `lucide-pen-tool`；`.board-editor` + `.lakex-drawnix-core` 挂载，画布 1082×778 铺满 tab 格 |
| 懒加载 | ✅ 首次打开才请求 `DrawnixBoardCore-Bik8zsN_.js` + `drawnix-*`，首屏不含 |
| 画图 | ✅ 点「形状」→ 图形库选「矩形」→ 画布拖拽 → 落盘 `elements:[{type:"geometry"}]` |
| 落盘形态 | ✅ `boards/dca27e3e-….board.json`，正文 **271 字节**，键 = `kind/version/engine/preset/elements`，**无 previewImage / 无 data:image**（对照：文档内画板卡的 `.lake` 实测 455KB，其中 413KB 是那张 PNG 预览，占 91%） |
| DB | ✅ `notes.kind='board'`，正文目录只落在 `boards/`（`sheets/`、`bitables/` 未污染） |
| 关标签 → 从目录重开 | ✅ 场景从盘上恢复（`elements` 回来、画布重新渲染），0 报错 |
| keep-alive 切标签 | ✅ 切走面板 `fn__none`（画布 0×0）、切回**自动恢复 1082×778 且图像还在**，无需重挂 |
| 只读（锁定 → 重开） | ✅ 只读时自研工具（素材库/AI/导出）不注入；尝试画矩形后 `elements` 仍为 1（正文长度不变）⇒ 画布真的不可编辑 |
| 状态栏 | ✅ 非 doc 走 kind 分支，显示「画板」 |
| 多实例内存 | 开 4 个画板：4 个 board 实例，渲染进程 JS 堆 251MB → 249MB（无明显增长；引擎模块级共享）。**仍需一次开/关 soak 才算定论** |
| 报错 | ✅ 全流程 `Runtime.exceptionThrown` = 0 |

证据截图：`/tmp/lake-board-evidence/board-4-rect.png`（画了矩形 + 完整工具条）、`board-8-locked.png`（锁定态）、
`board-6-multi.png`（多画板）。脚本 `/tmp/board-smoke{1..7}.mjs`（临时件，未入库）。

## 八、移动端只读查看器实测（260920，Android 模拟器 lake_mobile / API36）

起法：`bash scripts/emu-up.sh --no-window` → `bash scripts/android-build.sh --install` → `bash scripts/emu-cdp.sh`
（WebView socket 会变，按 HANDOFF §8.1 逐个 forward 到 9335 再校验 `/json/list`）。
**测试数据构造**：模拟器上是真实 dev 数据（555 篇，含用户笔记）⇒ **只插一条临时笔记**
（`doc_kind='board'`、正文 419B = 一个矩形 + 一段自由文字，parent = 「Native SQLite Test」测试笔记本），
验证完**已删除**，并清掉探查时误建的空库文件。

| 验证项 | 结果 |
|---|---|
| 打开画板笔记 | ✅ 走 `MobileBoardViewer`（`.mobile-board-viewer` 存在），画布 412×786 铺满文档层 |
| 只读 | ✅ 活动面板内 **0 个 Lake 编辑器**；画布工具条 `display:none`；顶栏「编辑」按钮 `disabled`（title「该文档类型在移动端只读」） |
| 渲染内容 | ✅ 矩形 + 两段文字（「移动端只读画板」/「平板/手机只看不改」）正常显示；`fitOnInit` 生效（打开即自适应到内容） |
| 不动数据 | ✅ 全程正文长度 419B 不变（移动端不保存、不写库） |
| 证据 | 截图 `/tmp/lake-board-evidence/mobile-3-board.png`；另有 jsdom 挂载护栏 `src/mobile/board/mobileBoardViewer.test.ts`（2 条） |

> 两端复用同一份 `DrawnixBoardCore-*.js` 懒加载分包（移动产物里 738.8KB raw / 232.9KB gzip，只在真的打开画板时请求）。
> **顺带发现的既有缺口**：浏览器版预览页（`scripts/mobile-preview.sh`）跑不起来 —— Capacitor SQLite 的 web 实现要求
> `<jeep-sqlite>` 元素，而 `mobile.html` 里没有它（DevTools 报 “The jeep-sqlite element is not present in the DOM!”），
> 应用停在「启动中…」。与画板无关；要不要补上让移动端浏览器速测恢复可用，可另立小项。

## 五、门禁（本分支实测，全绿）

`tsc` 0 · `vitest` **1112 passed / 16 skipped**（新增 `boardDoc.test.ts` 7 条、`boardEditorMount.test.ts` 6 条、
`store.test.ts` 2 条、`syncDecisions.test.ts` 2 条）· 桌面 + 移动 `vite build` 全绿 ·
`check:bundle` app-js gzip **1.784MB / 2.90MB**（+2KB）· `check:core` 0 · CSS 围栏含 `features/board/boardEditor.css`（11 声明 / 0 重复组）· `git diff --check` 干净。

## 六、剩余风险 / 未做（按优先级）

1. **AB 多端 S3 往返未测**：正文与 `kind` 走既有对象管线（`buildUploadEntry` 已单测带 `kind`、`rowToLocalState` 已认 `board`），
   但没跑过 A→B。v7 清单在旧端会整轮拒绝——**升级期必须所有端一起升**。
2. **图片仍不进资产管线**：画板工具条自带图片入口（文件选择 / 粘贴 / 拖放），引擎把图**内联成 data URL**
   写进 `elements`（`data/image.d.ts` 的 `insertImage`/`buildImage`，代码级证据；未做运行时核对）。
   对同步/GC **无害**（引用都在正文里、`ASSET_NAME_RE` 也匹配不到 data URL ⇒ 不会污染 `manifest.assets`），
   代价是正文变大、图片不能单独预览/重命名。要接资产管线属 P2，需另设计（对齐 `docs/SHEET-IMAGE-MANAGEMENT-260919.md` 的思路）。
3. **画布实例内存 soak**：建议正式合入前跑一轮「连续开关 20 个画板」看堆/DOM 是否释放。
4. **preset 没有 UI**：数据层已支持 `flowchart | uml | mindmap`（起始模板由 `DrawnixBoardCore` 的 `afterInit` 插入、`presetInitialized` 落盘防重复），
   但入口只建空白画板。**用户 260920 定稿：不做模板 UI（空白就行）**；将来要「新建 → 选模板」再加二级菜单即可（≈0.5 天，未排期）。
5. ~~思维导图要不要独立 kind~~ **用户 260920 定稿：就在画板里做，不要独立 kind** —— 画板 = 自由画布（什么都能画），
   思维导图用画布工具条自带的「思维导图」工具（`@plait/mind`）画。**不新增 `kind=mindmap`**；`preset` 字段与四条起始模板保留在数据层（已单测）。
6. ~~移动端只做占位~~ **已做（260920）**：`src/mobile/board/MobileBoardViewer.tsx` —— 移动端 `kind=board` 走进**只读画板查看器**
   （同一份懒加载引擎分包、`readOnly` + `fitOnInit`、隐藏工具条、不保存不写库）；顶栏「编辑」对非 doc 类型统一禁用。
   真机（Android 模拟器）实测见 **§八**。

## 七、关键文件

- 数据模型：`src/core/boardDoc.ts`（+ `boardDoc.test.ts`）
- 编辑器：`src/features/board/BoardEditor.tsx`、`boardEditor.css`（+ `boardEditorMount.test.ts`）
- 路由：`src/features/editor/MultiTabEditor.tsx`（`tab.kind === "board"` → 懒加载）
- 主进程：`electron/store.ts`（`createBoardIn` / `bodyPathFor` / `searchTextFor`）、`electron/ipc/registerNotes.ts`
- 协议：`src/core/noteKind.ts`、`src/core/syncUtils.ts`（`MANIFEST_VERSION = 7`）
- vendor：`vendor/lakex-doc-react/src/index.ts` 的 `loadDrawnixBoardCore()`（**必须懒加载导出**，见 LOCAL-CHANGES #18）
