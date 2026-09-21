# 表格图片独立管理 —— 方案（260919）

> 状态：**P1（浮动图）已落地 260920、P2（单元格图片）已落地 260921、缩略图（assetServer `?w=`，含多维表附件格 / 移动端封面 / 安卓 Java 侧）已落地 260921 续**（均未提交，等用户验收；移动端缩略图**真机未验**）；P3 移动端表格只读渲染与压测**未做**。
> 前置：表格已从 jspreadsheet-ce 换成 **FortuneSheet 1.0.4**（见 `docs/FORTUNESHEET-FEASIBILITY-260919.md`）
> 红线：遵 `AGENTS.md` §3——本地是真相；**开发版不考虑数据兼容（#7），旧表直接重建**；KISS、拒绝过度设计（#17）；多表写用事务（#9）。
>
> **P1 实现与本文原稿的差异（以实际代码为准，落地记录见 §12）**：
> 1. **不需要新 IPC**：复用内核插图同一条通道 `native.uploadResource`（`ResourceRepository.upload`，含图片格式/像素护栏 + 孤儿登记），
>    没有新增 `assets.putImage`；
> 2. **不 patch 内核、也不在 `insertImage` 前改 src**：内核照常插入 base64，宿主在 `onChange` 里**提升**（base64 → 资产文件）
>    并在保存时换写盘口径（与画板 `BoardEditor` 同一套路），**提升未落地前推迟保存**（正文绝不落 base64）；
> 3. **正文版本号不升**（仍 `version:2`）：结构没变，`src` 两种形态（filename / `data:`）读写两侧天然都支持，
>    升版本只会让既有表格静默变空表（零收益破坏）；
> 4. `manifest.assets` **无需新增声明逻辑**：清单声明本来就按磁盘实扫（`scanLocalAssets` → `listLocalAssets`），
>    文件落在 `note-assets/{noteId}/` 即天然被声明；GC 保护走同一条 `extractAssetRefs` 全文本正则（能命中 JSON 里的 filename）；
> 5. **粘贴图片仍未做**（内核 `onPaste` 只读文本，需要自研粘贴拦截 + 自己算落点几何），留待后续。
>
> **P2 实现与本文原稿的差异（原稿 §5 的「方案 A/B」都没采用，落地记录见 §12）**：
> 1. **数据的锚点放在 `images[].cell`，不是 `cell.v.img`**：单元格图片和浮动图**共用内核同一个 `sheets[].images[]`
>    通道**，只是多带一个 `cell:{r,c}` 锚点 ⇒ 滚动跟随 / 视口裁剪 / 缩放（内核渲染时乘 `zoomRatio`）
>    全部免费，**不需要自建 overlay**（原稿方案 A 的「绝对定位 overlay + 自己重算滚动」整块省掉了）；
> 2. **几何由宿主一直跟着单元格走**（`src/core/sheetGeometry.ts` 复刻内核 `calcRowColSize` 口径），
>    随列宽/行高/隐藏/合并/冻结变化重算 → 写回模型（`applyOp` 的 `replace` 整数组，`noHistory`）；
> 3. **「锁比例 + 不超过原图」交给 CSS `object-fit: scale-down`**（原稿打算自研 fit 数学）；
> 4. **指针事件关闭**（`[id^="cellimg_"] { pointer-events: none }`）：单元格图片是「单元格的内容」，
>    点击应命中单元格（否则会被内核当浮动图拖走/加缩放手柄）；
> 5. **冻结窗格**：内核的 DOM 图**不会**冻结（和内容一起滚），宿主给冻结区内的图补
>    `translate(scrollLeft, scrollTop)`（只写 DOM、不写正文）；
> 6. **删除**：`Delete/Backspace` 清空单元格时一并清掉该格图片（挂 document 捕获阶段——内核在
>    `.fortune-container` 上 `stopPropagation()` 会吃掉键）；**粘贴图片**也做了（剪贴板有图片就落成单元格图片）。
>    原稿设想的「单元格格式 → 图片」对话框入口没做（内核的单元格格式弹窗是 vendor React 组件，加 tab 要 patch 内核）。

## 1. 背景与问题

现在表格正文 `sheets/{noteId}.sheet.json` 里，图片存在 `sheets[].images[]`，其 `src` 是 **`data:image/...;base64,...` 内联字符串**。

问题（按量级 10 万文档 / 100 万附件的目标）：

| 问题 | 后果 |
| --- | --- |
| base64 内联进正文 | 1MB 图 → 正文 ~1.33MB；正文膨胀、解析变慢 |
| 图片随正文走同步/历史 | 每次快照/同步都带上整张图；`MANIFEST_CHAIN_KEEP=3` 也无法覆盖 |
| 无 GC 关联 | 图片删了不会回收文件；资产管线（年龄保护/引用声明）用不上 |
| 无法复用资产服务 | 移动端/浏览器要各自解析 base64，不能走 `note-assets` URL |

目标：**图片落到现有资产管线**（`note-assets/{noteId}/{filename}` + `manifest.assets` 声明），正文只存**引用**；浮动图与单元格图**都单独管理**。

## 2. 设计总览

```
插入图片
  └─ 写文件：note-assets/{noteId}/{buildAssetFilename(...)}   ← 复用现有资产写入
  └─ 正文引用：sheets[].images[].src = 资产URL（见 §3）        ← 不再 base64
  └─ 声明：manifest.assets 增补该 filename                     ← 同步/GC 权威
读取图片
  └─ 浮动图：img.src = 资产URL（本机 asset-server / 同步后同 URL）
  └─ 单元格图：自绘 overlay 锚定到单元格（见 §5）
```

**核心决策：正文存「相对 filename 引用」还是「绝对 URL」？**
- **存 filename**（`images[].src = "1789954950409_1a1b16c1.png"`），渲染时由渲染层拼成 URL。
  - 理由：换设备/换端口（A=19876 / B=19877）时 URL 会变，filename 不变；与 `manifest.assets` 的 filename 语义一致。
- 渲染侧：`core/sheetDoc.sheetImageSrc(src, noteId, port)`（桌面传本实例端口 `ASSET_PORT`，移动端默认 19876）；
  落盘侧：`sanitizeSheetWorksheet` 走 `sheetImageDiskSrc`（资产 URL 含 `?token=` 一律换回 filename）。

**正文版本**：**保持 `version: 2`**（原稿写的是 2→3，落地时否决）。理由：结构没有任何变化，`src` 的两种形态
（filename / 内核刚插入的 `data:`）读写两侧天然都支持（`sheetImageSrc` 放行 `data:`；编辑器打开时把遗留 base64 提升成资产）；
升版本只会让既有表格**静默变空表**（旧正文 parse 返回 null），是零收益破坏。原稿「旧 v2 表直接重建」的处置因此不再需要。

## 3. 存储与协议

| 层 | 变更 |
| --- | --- |
| 文件 | `workspace-*/note-assets/{noteId}/{filename}`（已存在，复用） |
| 正文 | `sheets[].images[].src` = filename（不是 URL、不是 base64）；正文 `version:3` |
| 清单 | `manifest.assets` 需包含该 note 的表格图片 filename（与文档附件同一套声明） |
| 命名 | 复用 `buildAssetFilename`（时间戳 + hash 前缀）→ 内容寻址、同名即同内容（红线 #11） |
| 去重 | 同一图片重复插入 → 同 filename（内容寻址）；由现有差集逻辑天然处理 |

**✅ 已核实（260920，原稿的 TODO 作废）**：`manifest.assets` **不是**从正文抽出来的，而是**磁盘实扫**
（`scanLocalAssets` → `db.listLocalAssets(noteId)` = `fs.readdirSync(note-assets/{noteId}/)` + 逐文件 sha256，`electron/syncAdapters.ts`）。
⇒ 图片只要落进 `note-assets/{noteId}/` 就**天然被声明**、天然进上传差集，**一行声明代码都不用加**。
GC/孤儿保护看的是正文引用集（`AssetRepository.getCurrentContentRefs` → `extractAssetRefs`，全文本正则 `{13ts}_{8hex}.{ext}`），
它读的就是 kind 感知的正文路径（表格 = `sheets/{id}.sheet.json`），JSON 里的 filename 一样命中。

**同步语义（已实测，见 §12）**：插入图片后 `notes.sync_state='local'` → 下一轮同步上传正文（内容寻址对象）+ 资源；
`orphan_assets` 里的写时登记会被 `saveNote` 的 `detectOrphans` 按正文引用撤销（实测查库为空）。

## 4. 插入流程（浮动图 P1）

1. 用户在 `SheetEditor` 点「插入图片」→ 选文件（**已修**：patch 后按实例定位 input，见 `patches/@fortune-sheet+react+1.0.4.patch`）。
2. 内核照常 `FileReader.readAsDataURL` → `insertImage`（**不动内核、不加新 patch**）。
3. 宿主在 `Workbook.onChange` 里扫描 `sheets[].images[].src` 的 `data:image/*`，调
   `uploadLakeResource({type:"base64", data}, noteId)` → 落 `note-assets/{noteId}/{filename}`，
   记进 `promotedRef`（data URL → 资产 URL，同一张图不重复上传；并发去重 + 失败保持内联不丢图）。
4. 保存（`flush`）：`withPromotedImageSrc` 把提升过的 data URL 换成资产 URL → `sheetsToBody` 的
   `sanitizeSheetWorksheet` 再统一换回 filename ⇒ **正文只有 filename**。
   - 读回：`initialSheets` 用 `sheetImageSrc(src, noteId, ASSET_PORT)` 拼 URL（内存 URL / 磁盘 filename）。
5. **提升未落地前 `flush` 直接推迟**（`promoteInFlightRef > 0` → 重排一次保存），所以绝不会有 base64 落盘。
6. 打开已有表格时先跑一次同一套提升 ⇒ 老正文/上次失败留下的 base64 **自愈**成资产（不写版本分支、不写迁移代码）。
7. 保存仍走原有防抖 + `lastSerializedRef` 去重（不变）。

**粘贴图片（未做）**：`SheetEditor` 挂 paste 拦截器，从 `clipboardData.items` 取 `image/*` → 同上的写入流程。FortuneSheet 自带 `onPaste` 只处理文本，需先在捕获阶段处理并阻止默认；且内核没有暴露 `insertImage`，落点几何要自己算 ⇒ 单独立项再做。

## 5. 单元格图片（P2）

目标：对齐语雀在线表格的单元格图片 —— 图**完全在单元格内**、**锁比例**、**随单元格等比缩放**、
**放大到原图尺寸后不再放大**。

FortuneSheet **没有** in-cell 图片（`Cell` 无图片字段），但它的**浮动图通道**（`sheets[].images[]`）已经具备
我们需要的全部渲染能力：DOM 图、跟内容滚动、被 `.fortune-cell-area` 裁剪、渲染时乘 `zoomRatio`。
原稿考过的两条路（A：自建 overlay；B：patch 内核 canvas 绘制）都更贵且更难维护，最终采用**第三条**：

- **数据**：图片仍在 `sheets[].images[]`，多一个锚点字段 `cell: { r, c }`（带它就是单元格图片）。
- **几何**：宿主按 `src/core/sheetGeometry.ts`（复刻内核 `calcRowColSize`：逐项 `round((len+1)*zoom)` 累加、
  隐藏行列不占空间）算出锚定单元格/合并块的矩形，写进 `left/top/width/height`；
  任何模型变化（`onChange` + `onOp`）后 rAF 内重算，值没变就早退。
  写回用 `applyOp` 的 `replace` 整数组（幂等；`opToPatch` 会把同一份 patch 同时打到
  `luckysheetfile[i].images` 与渲染源 `insertedImgs`；`applyOp` 内部 `noHistory`，不污染撤销栈）。
- **渲染**：`sheetEditor.css` 两条规则——`pointer-events: none`（点击命中单元格）+
  `object-fit: scale-down`（等比缩进格内、且不放大）。零数学。
- **插入**：自定义工具栏按钮「单元格图片」（`customToolbarItems`）→ 选图 → 走文档同一条资产管线
  上传 → 按当前选中格（合并则取整块）落在 `images[]`；同一格重复插入 = 替换。
- **删除 / 粘贴**：`Delete/Backspace`（未在输入时）清掉选中格的单元格图片；粘贴图片落成单元格图片。
- **冻结窗格**：内核 DOM 图不冻结 ⇒ 冻结区内的图补 `translate(scrollLeft, scrollTop)`。

**缩略图（260921 续，落地记录见 §14）**：显示尺寸只有几十像素的单元格，没必要让渲染进程解码整张原图
（解码内存 ≈ 像素 × 4B：一张 2400×1600 是 15.4MB 位图，而格子里只显示 81px）。做法**不是**落盘派生文件，
而是给 assetServer 加 `?w=<档位>` **按需缩放**：

- **为什么不落盘**：`manifest.assets` 是磁盘实扫、GC 保护是正文 filename 正则 —— 派生文件会被当资产声明/上传，
  却又不在正文引用集里，注定被判孤儿回收。按需生成「不落盘、不上传、可随时重建」，不碰数据格式/同步协议/GC。
- **档位离散**（`128/256/512/1024`，`core/assetUrl.ts` 与 `electron/assetServer.ts`、`android/.../AssetServer.java` 三处同口径）：连续值会把浏览器
  immutable 缓存与服务端内存缓存一起打散；超过最大档位就**不带参数**用原图（不为一张几乎等于原图的图白编码）。
- **选档**：`cellImageThumbWidth(模型宽度 × zoom × DPR)` 取「不小于目标的最接近档位」——宁可略大、绝不小到发虚。
  显示宽度由单元格矩形决定，本身离散稳定（列宽拖到 130 还是同一档），不会来回抖动。
- **落盘安全**：`parseLocalAssetUrl` 只取路径段、忽略 query ⇒ 带档位的 URL 存盘时照样换回 filename，
  正文里永远不会出现 `?w=`（实测确认）。
- **服务端**：`sharp(file).resize({ width, withoutEnlargement: true })`，**保持原格式**（目标是解码内存，
  而内存只取决于像素数，与编码格式无关；保格式还避开 alpha/动画/编解码器一堆边界）；GIF（多帧会被压成首帧）与
  SVG（矢量无解码问题）**跳过**，落回原图；解码失败也落回原图（缩略图是纯优化，不能让它把图弄没）。
  内存 LRU（64 项，键含 mtime+size）+ 并发闸 4 路（sharp 解一张大图峰值就是像素 ×4B，突发批量会打爆内存）。
- **触发点**：挂载期 `withRenderableImageSrc` 就按落盘几何带档位（阅读态也吃到，不用等几何同步）；
  插入时直接算好（省掉「先按原图加载再换缩略图」那次多余解码）；列宽/行高变化后由 `syncCellImageGeometry`
  一并改写 src（`image.src === sized` 也计入「变了没」，否则早退会把换代吃掉）。
- **浮动图暂不接**：它能被用户任意拖大，档位会随之连续变化，等有需求再说。
- **不止单元格图片**：同一套 `?w=` 已接到**多维表附件格**（26px 格子）与**移动端小记卡片封面**（最大档位 1024）；
  移动端的 AssetServer 是 Java 实现，已按同一语义补上（见 §14「扩展面」）。

**已知边界（未做）**：移动端只读渲染（P3，其 AssetServer 是 Java 实现，`?w=` 语义要对齐）；
「单元格格式 → 图片」对话框入口（要 patch 内核 React 弹窗）；等比例「保持在图内不裁」以外的 fit 选项；
浮动图缩略图。

## 6. 同步 / GC / 历史

- **同步**：图片走现有资产上传/下载（`scanLocalAssets`/`downloadNoteAssets`），正文只带 filename；`manifest.assets` 声明是权威（红线 #11）。
- **GC**：filename 不再被任何在留清单声明 → 现有 GC + 年龄保护回收；**不要**为图片另写一套 GC。
- **历史快照**：正文快照只含 filename；资产由引用集兜底（与文档附件同语义）。
- **删除/回收站**：随 note 走现有标签/回收站语义（不新增）。

## 7. 移动端 / 浏览器

- 渲染层统一「filename → URL」解析；桌面走本机 `asset-server`（19876），浏览器端走其宿主（后续 web 端），**正文不存 URL**（§2 决策）。
- 移动端表格目前是只读占位；若后续要展示图片，复用同一解析。

## 8. 分阶段与工作量（估）

| 阶段 | 内容 | 估 |
| --- | --- | --- |
| **P0（已完成）** | 图片按钮按实例定位（patch react） | 已做 |
| **P1 ✅（260920 已落地）** | 浮动图独立资产：复用 `uploadLakeResource` 落盘 + 正文只存 filename + 读回拼 URL（清单声明走磁盘实扫，无需改）· **粘贴图未做** | 已完成 |
| **P2 ✅（260921 已落地）** | 单元格图片：`images[].cell` 锚点 + 几何跟格走 + CSS 锁比例 + 插入/删除/粘贴 + 冻结偏移 | 已完成（见 §5/§13） |
| **P2+ ✅（260921 续）** | 单元格图片缩略图：assetServer `?w=` 按需缩放（不落盘/不上传/可重建）+ 档位随显示宽度换代 | 已完成（见 §5/§14） |
| **P2++ ✅（260921 续 2）** | 同一套 `?w=` 接到多维表附件格 + 移动端小记封面；安卓 Java AssetServer 同语义（**真机未验**） | 已完成（见 §14「扩展面」） |
| **P3** | 移动端表格只读渲染 + 对拍测试 + 压测（大图/多图） | **1–2 天** |

总计：**只做 P1 ≈ 1–1.5 天；P1+P2+P3 ≈ 1 周**。

## 9. 验收标准

- [x] 插入大图 → `sheets/{id}.sheet.json` **不含 base64**，只有 filename；文件在 `note-assets/{noteId}/`（实测 323B 正文 + 42319B 资源）。
- [x] 重启/reload 后图片仍显示（filename → URL 解析正确；实测用的是**非默认端口 19879**，即 B 端场景）。
- [ ] 删除图片后，经 GC + 年龄保护，文件被回收；仍被别的引用声明的不受影响。（机制复用现有 GC，未跑实测）
- [ ] 双端同步：A 插图 → B 下载后可见；正文与资产都同步（`syncEquivalence`/`syncDualAB` 通过）。（未跑 AB，见 §12 末）
- [x] 粘贴图片（260921 已做：剪贴板有图片就落成单元格图片，见 §12 P2 第 4–5 条）。
- [x] 单元格图片（260921）：完全在格内 · 锁比例 · 随单元格缩放 · 放大到原图尺寸后不再放大；插入/替换/删除/粘贴/冻结都对（§12 P2 实测）。
- [x] 单元格图片缩略图（260921 续）：2400×1600 原图在 81px 格里解码成 256px（15.4MB → 175KB 位图）；拖宽列后档位跟着换代；落盘正文不含 `?w=`；16 项断言的实测见 §14。
- [x] 同一套 `?w=` 覆盖多维表附件格（26px 格子解码 128px，放大预览仍是原图 2400）与移动端小记封面（最大档位 1024）；安卓 Java AssetServer 同语义实现 + 8 项 JVM 单测；**真机未验**。详见 §14「扩展面」。
- [x] 全绿 260921 续（缩略图 + 扩展面）：`tsc` 0 / `vitest` **1197 passed**·16 skipped / 桌面 `vite build` 绿 / Android `testDebugUnitTest`(AssetServerTest 8/0) + `assembleDebug` BUILD SUCCESSFUL / `check:bundle` app-js raw 6608560(1.78MB gzip) · drawnix 1488241 · app-css 1488851 / `check:core` 65 文件 0 违规 / `git diff --check` 干净。
- [x] 全绿 260921：`tsc` 0 / `vitest` 1177 passed·16 skipped / 桌面+移动 build 绿（Android `assembleDebug` BUILD SUCCESSFUL）/ `check:bundle` app-js 1.78MB(raw 6.6MB) · drawnix 0.41MB · app-css 0.19MB / `check:core` 0 违规 / `git diff --check` 干净。
- [x] 全绿 260921 续（缩略图）：`tsc` 0 / `vitest` **1195 passed**·16 skipped / 桌面 `vite build` 绿 / Android `assembleDebug` BUILD SUCCESSFUL / `check:bundle` app-js raw 6608455(1.78MB gzip) · drawnix 1488241(0.41MB) · app-css 1488851(0.19MB) / `check:core` 65 文件 0 违规 / `git diff --check` 干净。

## 10. 涉及文件

- `src/core/sheetDoc.ts`（`sheetImageSrc(src, noteId, port, width?)`、`sheetImageDiskSrc`、`sanitizeSheetWorksheet` 的 URL→filename、`SheetImageRef.cell`）
- `src/core/sheetGeometry.ts`（P2 新增：`sheetRangeRect`/`sheetCellRect` —— 复刻内核网格几何口径；`sheetZoom` —— 模型单位↔显示宽度换算的唯一入口）
- `src/core/assetUrl.ts`（缩略图档位的**纯逻辑**：`ASSET_THUMB_WIDTHS`/`assetThumbWidthFor`/`withAssetWidth`）
- `src/lib/assetPort.ts`（`assetThumbWidthForCss` —— 按 CSS 宽度 × DPR 选档；**它读 `devicePixelRatio`，属 DOM 依赖，
  只能放 lib 不能放 core**，`check:core` 会卡）
- `electron/assetServer.ts`（`?w=` 按需缩放：sharp + 原格式 + GIF/SVG 跳过 + 内存 LRU + 并发闸 4）
- `android/.../AssetServer.java`（同一 `?w=` 语义：BitmapFactory `inSampleSize` 缩略图 + 只认 png/jpg/jpeg + 失败落回原图）
- `src/features/bitable/bitableCells.tsx`（附件格取缩略图；放大预览仍走原图）
- `src/mobile/home/HomePage.tsx`（小记卡片封面取最大档位 1024）
- `src/features/sheet/SheetEditor.tsx`（`withRenderableImageSrc` / `withPromotedImageSrc` / `promoteInlineImages` / `flush` 推迟；
  P2：`syncCellImageGeometry` / `applyFrozenOffsets` / `insertCellImage` / `removeCellImageAtSelection` / 自定义工具栏项 / 隐藏 file input；
  P2+：`cellImageThumbWidth`，三处 src 拼装都带档位）
- `src/features/sheet/sheetEditor.css`（P2：`[id^="cellimg_"]` 的 `pointer-events: none` + `object-fit: scale-down`）
- `electron/assetServer.test.ts`（`?w=`）· `android/.../AssetServerTest.java`（档位白名单/格式规则/`inSampleSize`）
- `src/features/bitable/bitableEditorMount.test.ts`（附件格带档位 + 预览不带档位）
- `src/lib/assetPort.ts`（新增 `ASSET_PORT` 导出，供渲染层拼本实例端口）
- **未改**：`electron/**`（无新 IPC）、`src/lib/native.ts`、`preload.cjs`、`main.ts`、补丁、内核、正文版本号（仍 v2）
- 测试：`src/core/sheetDoc.test.ts`、`src/core/sheetGeometry.test.ts`（P2 新增）、`src/features/sheet/sheetEditorMount.test.ts`、`src/styles/cssLayers.test.ts`（基线 +2）
- 文档：`docs/STORAGE-LAYERS.md`、`docs/SYNC-PROTOCOL.md`、`HANDOFF.md`

## 11. 明确不做

- **不为旧 base64 数据写迁移/兼容代码**（#7）：不做版本分支、不做格式迁移脚本。旧正文里遗留的 base64 靠
  「打开时同一套提升路径」自然收敛成资产（**同一条代码路径**，不是为旧数据写的特例）。
- 不为图片另造 GC/缓存/声明机制（#11、#17）：一律复用现有资产管线。
- 不在正文里存绝对 URL（换端/换端口会失效）。
- 不 patch 内核 React 组件（单元格格式弹窗加「图片」tab）；不为单元格图片另造一套 overlay 渲染/滚动同步。
- **不落盘缩略图派生文件**（会被磁盘实扫声明成资产、却不在正文引用集里 ⇒ 注定被判孤儿回收），也不为图片另造一套缓存/GC；
  缩略图一律「按需生成、不落盘、不上传、可重建」（见 §5）。
- 不在正文里存 `?w=`（档位与 `?token=` 同性质，是运行时产物；`parseLocalAssetUrl` 忽略 query 保证这一点）。

## 12. 落地记录（260920 · P1）

**改动**：见 §10；核心是「内核照插 base64 → 宿主提升成资产 → 落盘只留 filename」+ 渲染侧 filename↔URL。

**实测（隔离实例：`LAKE_USER_DATA=$TMPDIR/lake-sheet-img-smoke` + `LAKE_ASSET_PORT=19879` + CDP，真实数据未读写）**：
1. 右键笔记本「新建表格」→ 表格编辑器挂载（host/input/canvas 齐、**无 Lake 编辑器**）；
2. 走真实插图链路（构造 1600×1200 PNG → 塞进 `#fortune-img-upload` → change）→
   正文 `sheets/{id}.sheet.json` **323B**，`images[0].src = "1789954950409_1a1b16c1.png"`，
   `base64`/`127.0.0.1` 均不出现；资源文件落 `note-assets/{id}/1789954950409_1a1b16c1.png`（42319B）；
3. 查库：`notes.kind='sheet'`、`sync_state='local'`；`orphan_assets` **为空**（写时登记已被 `saveNote` 按正文引用撤销）⇒ 该资源进声明/上传、不会被当孤儿清掉；
4. `Page.reload` 后重开该表格：图片从 `http://127.0.0.1:19879/{id}/1789954950409_1a1b16c1.png` 渲染
   （`naturalWidth > 0`），正文仍 323B 无 base64 ⇒ **filename→URL 解析 + 非默认端口都对**。

**已知未覆盖**：AB 多端 S3 往返回图片可达、删除图片后的 GC 回收、粘贴图片、单元格图（P2）。

**顺手确认的机制**：`manifest.assets` 是磁盘实扫（不需要在正文里声明）；GC 保护靠 `extractAssetRefs` 全文本正则命中 JSON 里的 filename。

## 13. 落地记录（260921 · P2 单元格图片）

**隔离实例**：`npx vite build` → `npx vite preview --port 1432` + `LAKE_DEV_SERVER_URL=http://127.0.0.1:1432`
`LAKE_USER_DATA=/tmp/lake-cellimage-iso` `LAKE_ASSET_PORT=19881` `--remote-debugging-port=9231`（CDP 驱动，全程未碰用户实例与正式数据）。

**正向实测（21 项断言全绿）**：
1. 工具栏出现「单元格图片」按钮（`customToolbarItems`，内核自定义项渲染在最左）；
2. 注入 400×200 PNG → 图片落成 **单元格图片**（`id=cellimg_*`），`src` 是本实例端口的资产 URL；
3. **几何 == 内核单元格矩形**：图片 `left/top/width/height` = 243.001 / 154 / 81.004 / 22 vs 内核选区 `style` 243 / 154 / 80(+1 网格线) / 21(+1) —— 误差 ≤0.5px
   （同一口径：逐项 `round((len+1)*zoom)` 累加。**踩坑**：最初按「先累加再取整」算，列号一大就漂十几像素，第 31 列实测差 12px）；
4. `pointer-events: none`（点图片 → 内核选区命中该单元格）+ `object-fit: scale-down` + 原图 400×200 已解码；
5. **拖宽列**（列头右分隔线 81 → 131）→ 图片几何跟着变宽且仍与内核一致；
6. `Page.reload` → 重开表格：几何**逐像素**一致（243×131，落盘模型值 220.91×119.09 × zoom1.1）；
7. **冻结窗格**：`frozen.range.row_focus=0` + 滚 3 屏（`scrollTop=66`）→ 第 1 行的图 `transform: translate(0px, 66px)`（钉住），非冻结行的图不加偏移；
8. **删除**：点中该格（穿透）→ `Delete` → 图消失（2 → 1）；
9. **粘贴**：剪贴板是图片 → 落成单元格图片（1 → 2）。

**落盘口径**（`sheets/{id}.sheet.json` 实测）：`images[0] = { id:"cellimg_…", src:"1789964532780_2c98163f.png", left:220.91, top:140, width:119.09, height:20, cell:{r:7,c:3} }`
—— `src` 只有 filename（无 base64/URL），几何是模型单位（= 引擎像素 ÷ zoomRatio，保留两位小数），
`cell` 原样透传（`sanitizeSheetWorksheet` 不碰未知字段），无任何运行时字段。

**踩坑记录（都写进了代码注释）**：
- 内核 `.luckysheet-cell-input` 是 **contenteditable div**（不是 `<input>`，没有 `.value`）⇒「在打字吗」只能看 `textContent`；
- 内核在 `.fortune-container` 的 keydown 里 `stopPropagation()` ⇒ React 合成事件收不到 `Delete`，必须挂 document **捕获阶段**；
- 内核只在 `window.resize` 时重算容器宽（无 ResizeObserver）—— 沿用 260921 的「宿主宽度变化补发 resize」修复；
- `.fortune-cell-area` 与 `globalCache.freezen` 都只在一次渲染后才存在 ⇒ 滚动监听挂**宿主 + capture**，不能挂该节点（挂不上就永远不生效）；
- 几何同步不能只靠 `onOp`：实测拖列宽**有时一个 op 都不发**（内核在 mouseup 直接改 config）⇒ 主触发点换成 `onChange`。

**已知未覆盖**：移动端渲染（P3；其 AssetServer 是 Java 实现，`?w=` 语义要对齐）、AB 多端同步、删除图片后的 GC 回收实测。

## 14. 落地记录（260921 续 · 单元格图片缩略图）

**隔离实例**：同 §13（`vite build` → `vite preview --port 1432` + `LAKE_DEV_SERVER_URL` + `LAKE_USER_DATA=/tmp/lake-cellimage-iso`
+ `LAKE_ASSET_PORT=19881` + `--remote-debugging-port=9231`；跑完按端口 PID 精确 kill，用户实例 9222/1421 未受影响）。

**端到端实测（16 项断言，`/tmp/lake-thumb-verify.mjs`，证据截图 `/tmp/lake-thumb-evidence/`）**：
1. 注入 **2400×1600** PNG → `src` 带档位 `?w=256`，`img.naturalWidth = 256`（不是 2400）
   —— 即浏览器解码的是缩略图：位图 **15.4MB → 175KB**（0.7MB → 0.2MB 量级以下）；
2. 几何仍与内核选区一致（`676.005/66/81.004/22` vs `676/66/81/22`，误差 ≤1px），`object-fit: scale-down` 仍在；
3. **拖宽该列 81 → 257** → 档位 `256 → 1024`、`naturalWidth 1024`，且几何仍跟单元格一致
   （这条路径会走 `applyOp` 改写 src —— 是最容易写成死循环的分支）；
4. **无死循环**：`?w=` 资源请求共 4 条 / 去重 4 个 URL（两张老图 + 新图的两个档位），600ms 内 rAF **38 帧**（≈63fps）；
5. **落盘正文 745B，不含 `?w=`**，三条 `images[].src` 全是裸 filename（`\d{13}_[0-9a-f]{8}\.[a-z0-9]{1,10}`）；
6. `Page.reload` → 重开：仍是缩略图（挂载期就带档位，不用等几何同步），几何逐像素一致。

**单测/集成**（+18 条，全量 1195 passed）：
- `electron/assetServer.test.ts`：真 PNG 缩到 128（且字节小于原图 + immutable 头）、`?w=1024` 在 400px 原图**不放大**、
  非档位值当没传（原字节直通）、GIF 直通（不能把多帧压成首帧）、解不了码的文件落回原图、同档位二次请求一致、
  换文件内容后同档位拿到新图（缓存键含 mtime+size）；
- `src/core/assetUrl.test.ts`：档位选取边界（宁可略大/超最大档位 → null/非法 → null）、`withAssetWidth` 保留 `token`、
  非本地资产原样、带档位 URL 仍能被 `parseLocalAssetUrl` 解析；
- `src/core/sheetDoc.test.ts`：带档位 URL 落盘仍只取 filename；`data:`/外部 http 不受档位影响；
- `src/core/sheetGeometry.test.ts`：`sheetZoom` 缺省/非法 → 1；
- `src/features/sheet/sheetEditorMount.test.ts`：档位按「模型宽度 × zoom × DPR」选、三处 src 拼装都带档位、
  `image.src === sized` 计入变更判定、浮动图不带档位。

**踩坑**：
- 同步函数的**早退条件必须把 src 也算进去**（`image.src === sized`）——只比几何的话，列宽变化后档位换代会被早退吃掉；
- 渲染层拿到的是**已经拼好的 URL**（不是 filename），所以 `sheetImageSrc` 对 `http(s):` 输入也要能改写档位
  （否则加载路径能带档位、几何同步路径带不上）；
- 服务端并发闸要**移交槽位**（`releaseThumbSlot` 直接把槽给下一个 waiter，`thumbRunning` 不变），
  先减后加会留下一个窗口让超量请求挤进来；
- 验证脚本忘了 `process.exit(0)`，WebSocket 让 Node 一直不退出（`tail` 缓冲不 flush ⇒ 看不到输出）；
  跑完全部断言后 kill 掉那个 PID 即可拿到输出。

### 扩展面 1：多维表附件格（桌面，260921 续 2）

`bitableCells.tsx` 的附件格 `<img>` 显示 26px（`bitableEditor.css` `.bt-attachment-chip img`），却会解码整张原图。
改法一行：`chipUrlOf = (f) => withAssetWidth(urlOf(f), assetThumbWidthForCss(ATTACHMENT_CHIP_PX))`。
**关键不变量**：`onOpen`（放大预览 → `ImageLightbox`）必须继续走原图 `urlOf` —— 预览借道缩略图就是糊的。

**实测（6 项断言全绿，`/tmp/lake-thumb-bitable.mjs`）**：用应用自己的 API（`lakeNative.createBitableIn`）建多维表
（正文结构由应用产出，只补「附件字段 + 一条记录 + 大图资源」，不手写 schema），然后
`src` 带 `?w=128`（token 保留）· `naturalWidth 128`（原图 2400×1600）· 格子仍是 26px ·
**放大预览 `naturalWidth 2400` 且 URL 无 `?w=`**。

### 扩展面 2：移动端小记卡片封面（260921 续 2）

`src/mobile/home/HomePage.tsx` 的卡片封面（`.qn-card__img`，整列宽 × 最高 210px）此前是原图 + CSS 压。
封面取**最大档位 1024**（不用 `assetThumbWidthForCss`：整列宽 ≈ 360 CSS px，dpr 3 需要 1080 设备像素，
按 `assetThumbWidthForCss` 会**超过档位表上限而退回原图**——这类"静默不优化"要避免）。一张 4000×3000 手机照片
（48MB 位图）降到 ~3MB。

**移动端必须改 Java**：`src/mobile/**` 走的是 `android/.../AssetServer.java`，不是桌面那个 Node 服务。
已按同一语义实现：`?w=` 白名单（与 `ASSET_THUMB_WIDTHS` 同值）+ `inJustDecodeBounds` 读尺寸 +
`inSampleSize`（只取 2 的幂，取"解出来仍不小于目标宽"的最大值）+ `createScaledBitmap` + `compress`，
**只对 png/jpg/jpeg 生效**（GIF 多帧/SVG 矢量/其余 Android 编解码支持不一的格式一律落回原图），
任何失败也落回原图。新增 JVM 单测（`thumbWidthFor` 白名单、`isThumbResizable` 格式规则、`sampleSizeFor` 不下冲）：
`./gradlew testDebugUnitTest` → AssetServerTest **8 项 / 0 失败**，`assembleDebug` BUILD SUCCESSFUL。
**⚠️ 真机未验**（缩略图生成走 `android.graphics`，JVM 单测覆盖不到）—— 需在设备上看一次小记封面/表格图片是否正常显示。

**扩展面实测里抓到的坑**：
- Java 里 `URI uri` 原本声明在 `try { ... }` **内部**，函数后半段引用不到（编译期报"找不到符号"）⇒ 提到 try 之前；
- `dist/` 忘了重建就跑去实测：改动在构建之后做的话，页面上看到的还是旧 bundle（表现为「代码明明改了但 `?w=` 没出现」）；
- 页面查询要挑**可见**元素：多 tab 会保留隐藏 DOM（`getBoundingClientRect().width === 0`），
  `querySelector` 会命中旧 tab 那份，点击坐标就成了 (0,0)；
- 窗口被别的 App 遮挡时 `document.visibilityState === "hidden"`：rAF 被节流到 ≈1 帧/600ms、
  列头 hover 拖拽也不落点（不是产品问题，但会让断言假红）⇒ 实测前先把窗口抬到最前；
- 列宽换代不一定要靠拖拽验证：把**落盘几何**改成与真实列宽不一致，挂载按落盘宽度取档、几何同步后必须改写成
  真实档位 —— 实测 `requested tiers=["1024","256"] final=256`，**两条请求即收敛**（确定性触发同一条 `applyOp` 改写路径）；
- **`check:core` 抓到过一次真违规**：`assetThumbWidthForCss`（读 `devicePixelRatio`）一开始写在 `src/core/assetUrl.ts`，
  DOM 依赖不许进 core ⇒ 挪到 `src/lib/assetPort.ts`（core 只留纯逻辑 `assetThumbWidthFor`/`withAssetWidth`），
  测试也一并挪到 `assetPort.test.ts`。**注意 `tsc`/`vitest` 都不会报这个错，只有 `npm run check:core` 会**。
