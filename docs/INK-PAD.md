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
- **笔宽档位按工具分开（261103 十五批）**：笔 1.5/2.5/4/6，高亮 **10/18/26/34**。此前两种工具共用一组档位 ⇒ 在高亮态点任意档位会把 18 改写成 1.5~6，宽度面板的选中态也永远不亮（用户实测「高亮笔太细」的根因）。
- **笔迹渲染样式单一来源（261104 十六批）**：perfect-freehand 参数 + 不透明度/混合模式全部收进 `features/ink/inkStrokeStyle.ts`，画布静态层 / 正在写的笔 / 缩略图 / 导出 PDF 四处都从它取（此前「0.3 + multiply」抄了 4 份，缩略图已经漂成 0.35）。**用户定稿：不做更多笔工具类型**，只保留两个旋钮 —— 「锋利感」= `thinning` + `startTaper/endTaper`、「平滑感」= `smoothing`/`streamline`；改笔感只改这张表。护栏 `inkStrokeStyle.test.ts`（数值 + 四处不再出现字面量）。
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
- **v2（261102 T1：图片页）**：`version=2`（读 1|2、写 2）；每页可选 `backgroundImage`（必须是本笔记空间 canonical 本地资产 URL，末段磁盘名参与资产声明 / GC；`fit` contain|cover|stretch、`opacity`、`pixelWidth/Height`、`source` image|pdf-page、`pdf` {url,page,pageCount}），整篇可选 `sourcePdf` {url,pageCount}。**纸张底纹始终画在最底层，图片叠在其上**（261103 十五批改正：此前「有图就不画底纹」⇒ 图片页切网格/点阵毫无反应，只能永远白纸）；渲染 = InkPaper + SVG `<image>`（页面逻辑坐标、`pointer-events:none`）；缩略图取资产 `?w=256` 低清档。v1 文档打开不写盘，首次真实编辑写回 v2（无迁移脚本）。
- **PDF 导入边导边用（261104 十六批）**：栅格化 + 上传不再和「合并进正文」串行等整本。每攒够 `IMPORT_COMMIT_BATCH = 10` 页
  就把这批页交给 `InkPad` 立刻可撤销提交（**第一批不等满批**，首屏 ≈300ms 就能标注）。真实 335 页书实测：3.5s 时正文已 11 页、
  之后每 ≈2s 涨 10 页；用户翻到任何一页都能马上标注。
  · **不抢当前页**：第一批替换空白首页并切到第 1 页，之后每批只追加（`planPdfPageInsert` 的 `keepActivePage`）。
  · **取消/失败**：已交付的页留在正文并提示「已导入 N 页，可以继续标注」；未交付的页连资产一起清掉。
    清理**只删未交付的 URL**（`committedUrls`）——删到已交付页的图 = 正文里一堆坏页。
  · 代价：每批一次 500ms 防抖落盘（实测 0.1–0.3ms / 11→51 页时正文 21–32 KiB），可忽略。
- **图片导入入口（v2）**：移动端编辑态「全局预览」面板「导入图片」、桌面编辑态工具条「导入图片」；可多选，每张图各成一页（A4 794×1123 + fit contain），上限复用 `MAX_IMAGE_BYTES`(25MiB) / `MAX_IMAGE_PIXELS`(5000 万)；逐文件容错、错误走 `role=alert` 横幅。
- **PDF 导入（261102 T2）**：编辑态「导入 PDF」（移动端在全局预览面板、桌面在工具条）。原 PDF 先落 note-assets（正文 `sourcePdf` 引用、防孤儿清理）→ 逐页栅格化（桌面用仓内 unpdf 自带 pdf.js，动态懒加载 + `public/vendor/pdfjs/cmaps`；移动端用系统 `PdfRenderer` 原生插件）→ 每页 WebP 走资产通道 → 每页建 `backgroundImage`（`source:'pdf-page'`、`pdf:{url,page,pageCount}`、fit contain）+ `InkPage.width/height` = pt×4/3（A4 793×1123，与桌面同口径；页图 `pixelWidth/Height` 为栅格像素，宽=maxWidth 1600）。产品上限 **500 页**（261103 十五批由 300 上调：一本 300+ 页的书是常态；超出明示截断、原 PDF 保留），core 1000 页硬上限不变；进度/取消可见，加密/损坏/超 100MiB 给可读错误；当前文档只有 1 页空白 A4 时第一页替换而非追加。

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
## 手写板 v4 演进提案（页粒度存储 / 增量保存 / 虚拟加载）—— **未立项，先观测**

> 261103 十一批结论：**不需要重写 UI/几何/历史层**（core/inkDoc 纯数据 + 纯函数、渲染只画当前页、
> 缩略图视口虚拟化、页级 undo patch、500ms 防抖 + 未变不写盘都已就位）；真正的缺口在**存储/加载粒度**。

**缺口（事实）**
- 保存 = `inkToBody(整篇)` 全量 JSON 序列化；实测 300 页 × 10 笔（≈10.9 MiB）一次 **26.7ms**，大文档里每画几笔就付一次；字符串峰值内存 ≈ 2×。
- 打开 = `JSON.parse` 整个 body；**所有页笔迹常驻内存**（渲染省了，内存没省）。
- 同步 = body 变了就整篇上传（内容寻址只省「没变」的轮次，不省「改一笔 ≈ 传整篇」的字节）。
- 现有硬上限把最坏值锁住：1000 页 / 单页 2 万笔 / 总 10 万笔 / 30 万点 / 正文 **16 MiB**。

**v4 形态（页是天然边界：页内笔迹提交后不可变）**
```
manifest.json          # 版本 / 页序 / 页元信息 / 每页内容 hash（几十字节~几 KB）
pages/p-<pageId>.json  # 单页笔迹（不可变、内容寻址）
```
- **保存**：只序列化脏页 + 重写 manifest（O(当前页) 而不是 O(整篇)）。
- **加载**：manifest + 当前页 ± 预取相邻页，其余页 LRU 卸载（内存 ≈ 常数 × 单页）。
- **同步**：页对象内容寻址天然去重，改一笔只传那一页 + manifest；复用现有「资产声明差集」思路。
- **兼容**：沿用 v1→v2→v3 先例 —— **新端写 v4、旧端读到 v4 进只读保护**；不写迁移（按「能否删了重建」原则）。

**实测（261103 十五批：真实 335 页 PDF 书，Chromium 渲染进程，非合成夹具）**

| 指标 | 实测 |
|---|---|
| 原 PDF 87.5 MiB / 335 页，全量导入（栅格化 + 上传 43.05 MB WebP，池宽 3 重叠） | **64.5 s**（≈192 ms/页；首事件 295 ms） |
| 同一篇的开/存（335 页 PDF 页，无批注） | 正文 **114,051 B**，打开解析 **0.6 ms**，序列化 **0.2 ms** |
| 每页 10 笔 × 30 点（3350 笔 / 10.05 万点） | 正文 **1.67 MiB**，序列化 **7.4 ms**，解析 **7.0 ms** |

⇒ **一本 335 页的书 + 中等密度批注 = 1.67 MiB / 7 ms**。换算口径 ≈ **23 B/点、≈690 B/笔（30 点/笔）**；
4 MiB ≈ 6,100 笔，而 `MAX_TOTAL_POINTS = 30 万` ⇒ 真实正文上限 ≈ **6.6 MiB**（16 MiB 上限碰不到）。
页数**不是**成本变量：335 页纯 PDF 页文档正文只有 111 KiB。

**立项阈值（任一命中再做；261103 十五批按实测改口径）**
1. 单篇正文 > **2 MiB**（≈ 2000 笔）——「每次保存/每次同步要搬多少字节」开始与感知一致；
2. `inkToBody` 单次 > **16 ms**（一帧）；
3. 打开解析 > **100 ms**；
4. 真机观察到落笔掉帧，或同步侧证据（同一篇一天内累计上传正文 > 200 MiB）。

**已删掉的旧阈值「页数 > 50」**：成本 ∝ 字节不 ∝ 页数，真实 300 页文档（正文 111 KiB、打开 0.6 ms）也会触发它 ——
日志里实测到假警报（`[ink-perf] load 1ms 0.1MiB pages=300 ⚠ pages>50`），已删除。

**观测入口（已落地，默认零行为改变）**
- `window.__inkPerfStats()` → `{ enabled, samples, thresholds }`：每次 load/save 记录 `{kind, ms, bytes, pages, strokes?, points?}`，环形 40 条；`__inkPerfReset()` 清空。
- 开日志：`localStorage["lakex-local-notes-v3.ink-perf-debug"]="1"`（或 `window.__inkPerfDebug = true`）→ 每样本一行 `[ink-perf] save 26.7ms 10.9MiB pages=300`，超阈值打 warn。

**改动面与风险（立项后的估算）**
- 移动端 `BodyStorePlugin`/`bridge` 的「正文 = 单文件」假设、历史快照、回收站/purge、S3 v3 同步（body 单对象 → 多对象或 manifest 引用）、快照门禁与测试。
- 属**中等规模架构演进（1–2 天量级 + 真机验收）**，不是改几行；未达阈值前收益不抵复杂度（AGENTS §3#17）。

**明确不做**
- 半吊子「本地 journal 增量落盘、同步仍整篇」：本地省 CPU 但同步语义没对齐，复杂度不值。
- 页内笔迹级视口裁剪：一页 A4 整页可见，收益 ≈ 0。

## 背景图导入下采样（261103 十二批）

- **问题**：图片页背景只校验 25 MiB / 5000 万像素、**不限尺寸**；一张 48MP 照片当整页背景 ⇒ 渲染解码 ≈ 像素×4B ≈ **190MB**（移动端可能 OOM、桌面翻到该页会卡）。PDF 导入默认 `maxWidth=1600` 不受影响。
- **修法**：`importInkImagePages` 在导入前算 `inkBackgroundDownscaleTarget`（最长边 > **2400** 才缩，2400 覆盖 A4 2x 清晰度）；`inkImageDownscale.downscaleInkImageFile` 用 canvas 等比缩放（webp 0.9，失败退 jpeg），上传缩放后字节、正文记录目标像素尺寸。下采样失败 ⇒ 按原图导入（不阻断）。
- **收益**：最坏单页解码 ≈ **23MB**（2400×2400），48MP 图降到 1/8；drawing/翻页/多标签常驻内存都随之下降。
- **护栏**：`inkImageImport.test` 覆盖「大图缩放尺寸/上传字节/记录尺寸」「小图不缩」「下采样失败回退原图」「目标尺寸纯函数」。

## 翻页性能：预解码实测否决（261103 十三批）

- 20 页整页图背景文档的翻页耗时（点下一页 → 两帧到稳定，各 10 次）：**未预取 30.4ms / 预取相邻页后 32.0ms**。
- 结论：30ms 级成本来自 SVG / React 重渲染，不是图片 decode ⇒ **不做相邻页预解码**（已撤回实现，代码处留结论注释）。若以后翻页体感变差，先量化「渲染 vs decode」再决定，不要凭直觉加预取。
