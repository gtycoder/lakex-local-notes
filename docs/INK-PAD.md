# 手写板（kind=ink）

> 状态：**正式功能 v1**。桌面 Electron 与 Android Capacitor 共用一套纯 Web 实现；不接 Jetpack Ink / PencilKit，也未接 OCR。
>
> 技术选型原则：手写板是产品亮点而非主编辑器。优先复用 Web Pointer Events、SVG 与成熟的开源轮廓算法，避免为不同平台维护三套原生墨迹引擎。

## 1. 支持范围

| 平台 | 状态 | 说明 |
|---|---|---|
| Electron 桌面 | 正式支持 | 鼠标、触控板、数位板；压力可用时使用真实压力 |
| Android | 正式支持 | 手指/触控笔；编辑态关闭系统手写接管，退出后恢复 |
| iPad / iOS | 兼容预留 | 当前无 iOS 工程；代码不依赖 Electron，可直接跑在 WKWebView。真正上线时再评估 PencilKit |

v1 包含：画笔、高亮笔、整笔橡皮、撤销/重做、多页 A4、页面缩略图与排序、删除页二次确认、四种纸张、桌面/移动缩放、自动保存、历史、回收站、搜索类型分派和 S3 跨端同步。

v1 不包含：OCR/手写转文字、套索、局部像素橡皮、导出 PNG/PDF、原生 Ink API。

## 2. 技术路线

- 墨迹轮廓：`perfect-freehand@1.2.3`（MIT）。输入是矢量采样点，输出闭合轮廓路径。
- 渲染：SVG。静态笔迹层 memo 化，书写中的活动笔迹单独更新，不重复 reconcile 全部历史路径；纸张线条/网格/点阵也在 SVG 逻辑坐标中绘制，缩放时与笔迹同步缩放。
- 输入：Pointer Events。触控笔有压力时使用 `event.pressure`；鼠标/手指使用 0.5 的模拟压力。
- 页面：A4 固定逻辑尺寸 **794 × 1123**，等比适配容器；缩放范围 50%–300%，步进 25%。
- 正文：UTF-8 矢量点 JSON，不把 PNG 当正文，也不依赖画布位图作为唯一数据源。
- 撤销栈：最多 60 个版本，并额外限制总字符预算 24 MiB；单份大正文不会因撤销历史无限复制而打满 WebView 内存。
- 跨端：`InkPad` 控制器、数据模型、解析与边界校验全在共享层；桌面和移动端只维护各自样式层。
- Android 手写接管：编辑态调用 `StylusInput` 原生插件关闭 `View.setAutoHandwritingEnabled(false)`；离开手写板或退出编辑后恢复，避免系统手写板抢走笔事件。

## 3. 代码入口

| 位置 | 职责 |
|---|---|
| `src/core/inkDoc.ts` | 数据模型、严格解析、序列化、容量上限 |
| `src/features/ink/InkPad.tsx` | 双端共享控制器：工具、页面、缩放、输入、撤销/重做、自动保存 |
| `src/features/ink/inkGeometry.ts` | perfect-freehand 轮廓与 SVG path |
| `src/features/ink/InkPageStrip.tsx` | 页面缩略图、排序、删除确认 |
| `src/features/ink/DesktopInkPad.tsx` | 桌面标签页接线 |
| `src/mobile/ink/MobileInkPad.tsx` | Android 接线与系统手写开关 |
| `src/core/noteBodyPaths.ts` | `inks/{noteId}.ink.json` 单一路径来源 |
| `android/.../StylusInputPlugin.kt` | 编辑态系统手写接管开关 |

## 4. 数据契约

```json
{
  "kind": "ink",
  "version": 1,
  "pages": [
    {
      "id": "page-1",
      "width": 794,
      "height": 1123,
      "background": "blank",
      "strokes": [
        {
          "id": "stroke-...",
          "tool": "pen",
          "color": "#262626",
          "width": 2.5,
          "points": [{ "x": 100, "y": 120, "pressure": 0.72, "t": 13 }]
        }
      ]
    }
  ],
  "activePageId": "page-1"
}
```

- `background`: `blank | lined | grid | dot`。
- `tool`: `pen | highlighter`；橡皮不写入笔迹数据，直接删除命中的整条笔迹。
- `InkDoc` 严格解析；损坏正文返回 `null`，编辑器进入只读保护，不允许用空文档覆盖。重复页面 ID / 笔迹 ID 也一律拒绝，避免 React key 与整笔橡皮命中歧义。
- 单份正文上限 **16MiB**；全文档最多 **10 万条笔迹 / 30 万个采样点**。序列化与读取共用同一组上限；超限修改不会写入，编辑区会给出错误提示。
- 手写正文暂不进入全文搜索（无 OCR）；标题仍按 `notes.title` 搜索。
- 历史快照按页面/笔迹/采样点数量生成结构化预览，不尝试识别文字，也不把 ink JSON 误挂到画板预览器。
- **v2（261102 T1：图片页）**：`version=2`（读 1|2、写 2）；每页可选 `backgroundImage`（必须是本笔记空间 canonical 本地资产 URL，末段磁盘名参与资产声明 / GC；`fit` contain|cover|stretch、`opacity`、`pixelWidth/Height`、`source` image|pdf-page、`pdf` {url,page,pageCount}），整篇可选 `sourcePdf` {url,pageCount}。图片页不再画纸张底纹；渲染 = 在 InkPaper 之前加 SVG `<image>`（页面逻辑坐标、`pointer-events:none`）；缩略图取资产 `?w=256` 低清档。v1 文档打开不写盘，首次真实编辑写回 v2（无迁移脚本）。
- **图片导入入口（v2）**：移动端编辑态「全局预览」面板「导入图片」、桌面编辑态工具条「导入图片」；可多选，每张图各成一页（A4 794×1123 + fit contain），上限复用 `MAX_IMAGE_BYTES`(25MiB) / `MAX_IMAGE_PIXELS`(5000 万)；逐文件容错、错误走 `role=alert` 横幅。
- **PDF 导入（261102 T2）**：编辑态「导入 PDF」（移动端在全局预览面板、桌面在工具条）。原 PDF 先落 note-assets（正文 `sourcePdf` 引用、防孤儿清理）→ 逐页栅格化（桌面用仓内 unpdf 自带 pdf.js，动态懒加载 + `public/vendor/pdfjs/cmaps`；移动端用系统 `PdfRenderer` 原生插件）→ 每页 WebP 走资产通道 → 每页建 `backgroundImage`（`source:'pdf-page'`、`pdf:{url,page,pageCount}`、fit contain）+ `InkPage.width/height` = pt×4/3（A4 793×1123，与桌面同口径；页图 `pixelWidth/Height` 为栅格像素，宽=maxWidth 1600）。产品上限 300 页（超出明示截断、原 PDF 保留），core 1000 页硬上限不变；进度/取消可见，加密/损坏/超 100MiB 给可读错误；当前文档只有 1 页空白 A4 时第一页替换而非追加。

## 5. 存储与同步

- `NoteKind` 包含 `"ink"`；本地正文路径为 `inks/{noteId}.ink.json`。
- S3 仍复用内容寻址正文对象：`objects/{noteId}-{contentHash}.lake`。
- Manifest 当前版本为 **V2**。V2 相对 V1 的协议变化是正式支持 `kind="ink"`；读取端仍可读取 V1 清单用于升级。
- `kind` 随 manifest note 透传；旧端不得继续写包含 `ink` 的同一同步空间，所有访问该前缀的客户端必须一起升级。
- 移动端 gzip manifest 的 `Content-Type` 必须是 `application/octet-stream`、`Content-Encoding: gzip`。不能声明 `application/json`：CapacitorHttp Android 会优先走 JSON 文本分支，把 gzip 字节错误地当文本发送，最终表现为 `SignatureDoesNotMatch`。
- 移动端下载批窗口在 `flushNoteBatch` 时必须先写正文文件，再提交 `notes` 元数据；只写 DB 行会留下 `content_hash=synced` 但正文文件不存在的坏状态。

## 6. 验收记录

- 桌面 A → 桌面 B：真实 S3 隔离前缀上传/下载成功，`kind=ink`、页数、笔迹数一致。
- 桌面 B → Android：Android 下载后正文与桌面逐字节相同。
- Android 编辑 → 上传 → 桌面读取：新增笔迹跨端到达，正文逐字节相同。
- Android 回收站收到桌面删除传播；Android 恢复后桌面重新看到 active 条目，正文保持不变。
- 测试样本：2 页，第一页 34/35 条笔迹，第二页 2 条探针笔迹。
- 门禁：TypeScript、全量 Vitest、桌面构建、Android 构建、UI 指标、bundle 预算、`git diff --check`。

## 7. 已知限制与后续

- 尚未在真实 Android 手写笔设备上完成延迟、压感曲线、掌托和大文档专项验收；模拟器只验证了 Pointer Events 与跨端数据链路。
- OCR、手写转文字、套索选择、局部像素橡皮、PNG/PDF 导出未实现。
- iPad 仅保留纯 Web 兼容性，未创建 iOS 工程，也未接 PencilKit；如果将来要追求硬件级低延迟，再单独评估原生后端与数据桥接，不提前增加抽象。
- 手写板不是主打编辑能力；除非有明确产品价值，不因平台原生 Ink API 的吸引力而拆散当前共享实现。

## 手写板 v3（261103，P5–P7）

- **格式**：`inkDoc` 读 1|2|3、写 3。点编码扁平 `[x,y,p,(t)]` + 坐标/压力定点 0.01（真实样本 −52%；300 页批注 10.9MiB → 3.6MiB，−67%，16MiB 下每页批注量 ~15 → ~50 笔）。**旧端读到 v3 进只读保护**（与 v1→v2 同一先例）；v2 文件在新端照常打开、不编辑不写盘。
- **本机视图出正文**：`activePageId` 不再落盘到正文，改设备本地 `lakex-local-notes-v3.ink-nav.<noteId>`（同 bitable-nav）；翻页不再触发整篇保存/同步。
- **原 PDF 不再强制入库**：`sourcePdf` 只留 `{name,pageCount}`、页级 `pdf` 只留 `{page}`；移动端导入用 cacheDir 临时文件并在结束后删除（防孤儿靠既有扫描）。
- **坏页策略**：结构字段严格；单页坏/重复 id/超容量 ⇒ 丢该页 + `droppedPages` 计数 + 可见告警（不再整篇只读）；保存会永久丢弃坏页，告警文案已写明。
- **热路径**：`commit`/`undo`/`redo` 只换内存 doc + 标脏，序列化移到 500ms 防抖/保存时；`inkRenderCache`（id→轮廓，按页隔离）让新笔画只算一条；`pointercancel` 回滚擦除；`InkPageStrip` 视口虚拟化（±10 页）；Android `?w=` 支持 webp + 缩略图磁盘缓存（cacheDir/asset-thumbs，1024 条上限，键含 mtime+size）。
- **导入 IO**：`pdfImport` 流式（`onPage` 逐页 + 上传池 3 路与栅格化重叠）；进度分 raster/upload（UI「导入 PDF」→「正在写入页面」）；失败/取消按 URL 定向清理本轮已上传页图（桌面 `cleanNoteOrphans`，移动新增 `bridge.cleanNoteOrphans` 写域登记）；移动导入结束删暂存 PDF + 清原生渲染缓存；启动扫陈旧 cacheDir。
- **护栏**：`inkPerf.test`（500 笔新增 <5ms、300 页 serialize <35ms）、`InkPageStrip.test`（pageWindow）、`inkPadWiring`（v3 模型/导航/告警/池宽/清理静态契约）、`inkOpenReadOnly`（打开=只读不变）、`inkDoc.test`（v3 往返/坏页/旧版只读）。
- **设备待办**：Kotlin 侧（webp 缩略图、cleanupCache）只过 `compileDebugKotlin`，未真机；发版前需看一次 300 页导入进度与全局预览首开。
