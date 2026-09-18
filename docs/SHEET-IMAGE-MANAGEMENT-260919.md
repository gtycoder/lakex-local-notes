# 表格图片独立管理 —— 方案（260919）

> 状态：**立项 / 待实施**（本文件是规范，其他会话按此落地，勿另起炉灶）
> 前置：表格已从 jspreadsheet-ce 换成 **FortuneSheet 1.0.4**（见 `docs/FORTUNESHEET-FEASIBILITY-260919.md`）
> 红线：遵 `AGENTS.md` §3——本地是真相；**开发版不考虑数据兼容（#7），旧表直接重建**；KISS、拒绝过度设计（#17）；多表写用事务（#9）。

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
- 建议 **存 filename**（如 `images[].asset = "1712345678-ab12cd.png"`），渲染时由渲染层拼成 URL。
  - 理由：换设备/换端口（A=19876 / B=19877）时 URL 会变，filename 不变；与 `manifest.assets` 的 filename 语义一致。
- `src` 字段策略：**开发版不做兼容**，直接把 `src` 改为资产 filename（去掉 base64 形态）；渲染层遇到 filename 拼 URL。

**正文版本**：`version: 2 → 3`（`docs/STORAGE-LAYERS.md`/`docs/SYNC-PROTOCOL.md` 同步回填）。旧 v2（base64）表**直接重建**，不写迁移。

## 3. 存储与协议

| 层 | 变更 |
| --- | --- |
| 文件 | `workspace-*/note-assets/{noteId}/{filename}`（已存在，复用） |
| 正文 | `sheets[].images[].src` = filename（不是 URL、不是 base64）；正文 `version:3` |
| 清单 | `manifest.assets` 需包含该 note 的表格图片 filename（与文档附件同一套声明） |
| 命名 | 复用 `buildAssetFilename`（时间戳 + hash 前缀）→ 内容寻址、同名即同内容（红线 #11） |
| 去重 | 同一图片重复插入 → 同 filename（内容寻址）；由现有差集逻辑天然处理 |

**TODO（实施前先核实）**：`manifest.assets` 目前是否只由「扫 `.lake` 正文」生成（`extractAssetRefs`）？表格正文不是 `.lake`，需要**新增一条**：序列化表格 body 时把 `images[].src`（+ 单元格图引用）声明进 `assets`。落地时以 `electron/` 里清单构建处为准，并补测试。

## 4. 插入流程（浮动图 P1）

1. 用户在 `SheetEditor` 点「插入图片」→ 选文件（**已修**：patch 后按实例定位 input，见 `patches/@fortune-sheet+react+1.0.4.patch`）。
2. 读文件 → 通过 IPC 写入 `note-assets`（新增 IPC：`assets.putImage(noteId, bytes, ext)` → 返回 filename；复用现有资产写入 + 审计）。
3. `insertImage` 前把 `image.src` 设为 **资产 URL**（渲染用），但在 `sanitizeSheetWorksheet`/`sheetsToBody` 落盘时**转成 filename**（正文只存 filename）。
   - 读回时 `parseSheetBody` → 渲染层把 filename 拼 URL。
4. `manifest.assets` 声明该 filename（见 §3 TODO）。
5. 保存走现有 `SheetEditor` 防抖 + `lastSerializedRef` 去重（不变）。

**粘贴图片**（可选并入 P1）：`SheetEditor` 挂 paste 拦截器，从 `clipboardData.items` 取 `image/*` → 同上的写入流程。FortuneSheet 自带 `onPaste` 只处理文本，需先在捕获阶段处理并阻止默认。

## 5. 单元格图片（P2，自研）

FortuneSheet **没有** in-cell 图片（`Cell` 无图片字段）。方案二选一：

- **方案 A（推荐，低成本）**：单元格存引用 `cell.img = { asset: filename, fit: "cover"|"contain" }`；
  - 渲染：在 `SheetEditor` 用绝对定位 overlay，按单元格的 `getCellRect`/行列宽高计算位置与尺寸，随滚动/缩放/冻结重算；
  - 缩放/对齐：`fit` + 单元格 padding；
  - 优点：不动内核；缺点：需自己处理滚动/冻结/打印。
- **方案 B（不推荐）**：patch 内核 canvas 渲染，在单元格绘制图片。成本高、升级脆弱，仅在 A 无法满足时考虑。

**P2 交付物**：`cell.img` 类型 + overlay 组件 + 滚动/缩放同步 + 单测 + 真机验收。

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
| **P1** | 浮动图独立资产：写文件 IPC + 正文改 filename + 清单声明 + 读回拼 URL + 粘贴图 | **1–1.5 天** |
| **P2** | 单元格图片（方案 A）：`cell.img` + overlay + 滚动/缩放同步 | **3–5 天** |
| **P3** | 移动端/浏览器渲染 + 对拍测试 + 压测（大图/多图） | **1 天** |

总计：**只做 P1 ≈ 1–1.5 天；P1+P2+P3 ≈ 1 周**。

## 9. 验收标准

- [ ] 插入 10MB 图 → `sheets/{id}.sheet.json` **不含 base64**，只有 filename；文件在 `note-assets/{noteId}/`。
- [ ] 断网重启后图片仍显示（filename → URL 解析正确，端口 A/B 都能用）。
- [ ] 删除图片后，经 GC + 年龄保护，文件被回收；仍被别的引用声明的不受影响。
- [ ] 双端同步：A 插图 → B 下载后可见；正文与资产都同步（`syncEquivalence`/`syncDualAB` 通过）。
- [ ] 粘贴图片（若并入 P1）走同一路径，不留 base64。
- [ ] 全绿：`tsc` 0 / `vitest` / build / `check:bundle` / `check:core` / `git diff --check`。

## 10. 涉及文件（实施时更新）

- `src/core/sheetDoc.ts`（body v3、`images[].src` 语义、sanitize）
- `src/features/sheet/SheetEditor.tsx`（插入/粘贴、filename↔URL）
- `electron/`（资产写入 IPC、`manifest.assets` 声明、`extractAssetRefs` 等价物）
- `src/lib/native.ts` + `electron/preload.cjs` + `electron/main.ts`（IPC 三处同步，红线 §7.9）
- `docs/STORAGE-LAYERS.md`、`docs/SYNC-PROTOCOL.md`、`docs/LAKEX-CONTRACT.md`（回填）
- `HANDOFF.md`（进度与踩坑）

## 11. 明确不做

- 不为旧 base64 表写迁移/兼容（#7）：旧表**删了重建**。
- 不为图片另造 GC/缓存/声明机制（#11、#17）：一律复用现有资产管线。
- 不在正文里存绝对 URL（换端/换端口会失效）。
