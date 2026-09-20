# STORAGE-LAYERS.md — 存储分层与「设备本地」契约（单一来源）

> **目的**：把「哪些数据进 S3 镜像 / 哪些是本地真源与账本 / 哪些纯本机派生」收敛到这一处，避免再次出现"注释说本地、代码其实同步"的漂移。
> **权威待办**仍看 `HANDOFF.md §3`；同步协议细节看 `docs/SYNC-PROTOCOL.md`；本文只回答"某个持久化属于哪一层"。
> 参考实现：`electron/schemaInit.ts`、`src/mobile/schema.ts`、`src/core/manifestTypes.ts`、`electron/store.ts`、`src/mobile/bridge.ts`。

---

## 0. 铁律（新增任何持久化前先读）

1. **镜像层字段必须"三处同改"**：`src/core/manifestTypes.ts`（类型） + 两端 `build*Entry`/`applyRemote*`（桌面 `electron/syncAdapters.ts`/`syncReconciliation.ts`，移动 `src/core/syncDecisions.ts` 等共享核心） + `docs/SYNC-PROTOCOL.md`（协议）。漏一处 = 跨端不一致。
2. **设备本地态禁止进 manifest**：本机 UI、游标、基线账本、密钥一律不进清单。
3. **派生数据可重建**：索引/缓存类允许随时 DROP 重建（AGENTS §3 #7/#10）。
4. 改动后按第 6 节检查清单过一遍。

---

## 1. 三层定义

| 层 | 语义 | 云端 | 冲突语义 |
|---|---|---|---|
| **L1 镜像层** | 跨端需要的数据；本地是真相，S3 只是镜像 | 进 manifest 或对象 | 先同步者胜 + 墓碑权威 + 恢复例外 |
| **L2 本地真源/账本层** | 同步引擎/恢复所需的本地状态，跨端无意义或必须每端独立 | 不进 | 每端独立，互不影响 |
| **L3 纯本机/派生层** | UI 状态、历史、孤儿、GC 状态、可重建索引、日志 | 不进 | 每端独立 |

---

## 2. 桌面磁盘布局

工作区根 = `app.getPath("userData")/workspace-default`（`electron/main.ts:161`）；开发版 userData = `lake-notes-dev`。

```
~/Library/Application Support/lake-notes-dev/
├─ logs/lake-notes.log                 # 日志（不属于工作区）
└─ workspace-default/                   # 工作区根
   ├─ metadata.sqlite3 (+ -wal/-shm)    # 主库
   ├─ notes/{noteId}.lake               # 文档正文（kind=doc）        L1（对象）
   ├─ sheets/{noteId}.sheet.json         # 表格正文（kind=sheet，FortuneSheet v2）L1（对象）
   ├─ bitables/{noteId}.bitable.json     # 多维表正文（kind=bitable，自研 v1）L1（对象）
   ├─ boards/{noteId}.board.json         # 画板正文（kind=board，Drawnix/Plait 场景）L1（对象）
   ├─ note-assets/{noteId}/{filename}   # 附件/图片                    L1（assets/）
   ├─ quick-notes/
   │  ├─ metadata.sqlite3              # 小记独立库
   │  ├─ assets/{quickNoteId}/{file}   # 小记图片                    L1（quick-notes/）
   │  └─ staging/{draftId}/{file}      # 未保存草稿图片              L3
   ├─ history/{noteId}/*.lake.gz        # 历史快照（note_history.file_path）L3
   ├─ draft-journal/                    # 草稿恢复日志                L3
   └─ .s3-restore-seed.json             # A2 云恢复临时凭据 seed（0600，重启即删）L3
（云恢复时旧工作区被隔离为 ../workspace-pre-restore-<ts>/）
```

---

> **表格文档（`kind="sheet"`，260918 引入；260919 换内核）**：正文落 `sheets/{noteId}.sheet.json`，路径由 `notes.kind` 决定（`store.bodyPathFor`）。
> 正文格式 = **v2 FortuneSheet workbook**（`{kind:"sheet",version:2,sheets:Sheet[]}`；保存时剔 `luckysheet_select_save` 等运行时字段 + dense `data`→sparse `celldata`）。搜索文本由 `sheetToSearchText`（遍历 celldata）派生，**不进 Lake HTML 解析器**。见 `docs/SHEET-BITABLE-DESIGN-260918.md`。
>
> **多维表文档（`kind="bitable"`，260920 实现 v1）**：正文落 `bitables/{noteId}.bitable.json`，路径同样由 `notes.kind` 决定（`store.bodyPathFor`）。
> 正文格式 = **自研 record-based JSON**（`{kind:"bitable",version:1,tables[],activeTableId}`；一个文档可含多张数据表，为后期多表联合预留）。搜索文本由 `bitableToSearchText`（表名 + 各字段展示值）派生，**不进 Lake HTML 解析器**。附件字段存 filename，复用 `assets/{noteId}/{filename}` 资产管线。产品口径见 `docs/BITABLE-PRODUCT-SPEC-260919.md`。
> **画板文档（`kind="board"`，260920 引入）**：正文落 `boards/{noteId}.board.json`，路径同样由 `notes.kind` 决定（`store.bodyPathFor`）。
> 正文格式 = **Drawnix/Plait 场景 JSON**（`{kind:"board",version:1,engine:"drawnix",preset,elements[],viewport?}`）；`elements` 就是文档内画板卡的 `plaitValue`，两者可无损互搬。
> **不挂 Lake 内核**（编辑器直接挂 `DrawnixBoardCore`，零内核实例）；**不写卡片专用的 `previewImage`/`cardHeight`**（那张整幅 PNG 实测占带画板文档体积 90%+）。
> 搜索文本由 `boardToSearchText`（形状文字/文本块/思维导图节点/连线标签）派生，**不进 Lake HTML 解析器**。画板内的图片由引擎内联成 data URL，**不进 `manifest.assets`**。见 `docs/BOARD-DOC-FEASIBILITY-260920.md`。

## 3. 移动端磁盘布局

App 沙盒 `com.lakenotes.mobile`；`Directory.Data` = `/data/data/com.lakenotes.mobile/files`。

```
files/note-assets/{noteId}/{filename}    # 附件（bridge.ts:474）        L1（assets/）
databases/lake-notes-mobile              # 主库（Capacitor SQLite, WAL）
# 笔记正文存库 notes.content 列（不落 .lake）；小记与主库同库
```

> 两端形态差异：桌面正文在文件 + 小记独立库/独立前缀；移动正文在库 + 小记同库、图片纯文件。**分层归属一致。**

---

## 4. S3 对象布局（L1）

```
{prefix}/
  objects/{noteId}-{contentHash}.lake          # 正文（内容寻址，幂等）
  assets/{noteId}/{filename}                    # 附件
  manifests/latest.json                         # 可变指针（单写者）
  manifests/{commitId}.json                     # 不可变 commit 链（保留 8 层）
  quick-notes/manifests/latest.json
  quick-notes/objects/{contentHash}.qnote
  quick-notes/assets/{quickNoteId}/{filename}
```

manifest 字段（`src/core/manifestTypes.ts`）：
- `ManifestNote`：id/title/parentId/**sortOrder**/updatedAt/contentHash/isConflict/isLocked/lockedAt/**icon**/**kind**（doc|sheet|bitable|board，缺省 doc 不写）/assets[]/墓碑
- `ManifestFolder`：id/title/parentId/**sortOrder**/nodeType/**icon**/updatedAt/墓碑

---

## 5. 表 / 键清单（按层）

### L1 镜像层（喂 manifest，不带前缀的本地真源表）
- `notes`（桌面只存元数据，正文在 .lake；移动含 content）、`tree_nodes`（含 sort_order/icon；移动为 `notes`+`folders`）、`deleted_notes`（本地墓碑表）

### L2 本地真源/账本层
- `sync_base`（content_hash 基线 / last_synced_meta_at / last_uploaded_hash）
- `declared_assets`（"远端清单已声明"的本地镜像；上传跳过与 GC 依据）
- `device_state`（last_seen_commit_id / last_tombstone_sig / last_synced_at / seed 等）
- `settings`（S3/同步/GC/历史配置；S3 密钥经 SecretCipher/Keychain 加密）——**每端独立，不跨端**

### L3 纯本机/派生层
- `note_history` + `history/`（文档历史）
- `orphan_assets`（未引用资源）
- `s3_gc_pending` / `s3_gc_log`（GC 状态与审计）
- `notes_fts` / `search_index`（派生索引，可重建）
- `quick_note_*`（小记同步 journal / 转换 / 文件操作）
- localStorage（桌面+移动）：`lake-notes-v3.dialog-states`、`lake-notes-v3.sidebar-width`、`lake-notes-v3.outline-sidebar-width`、`lake-notes-v3.tab-switcher-width`、`lake-notes-v1.sidebar`、`lake-notes-mobile.tabs.*`、`libraryView`、`lake-notes-mobile.s3`（密钥另经 `src/mobile/secretStore.ts` AES-GCM）
- 移动历史快照表 `note_history`（与桌面同表名，语义一致）

---

## 6. 新增持久化检查清单

- [ ] **需要跨端吗？** 需要 → L1。改 `manifestTypes.ts` + 两端 build/apply + `SYNC-PROTOCOL.md`；想清冲突（updatedAt LWW）、墓碑、恢复例外。
- [ ] **同步/恢复需要但跨端无意义？** → L2。本地表即可，**不进 manifest**。
- [ ] **只是本机 UI / 缓存 / 历史？** → L3。禁止进 manifest；派生类要能重建。
- [ ] 是否触碰红线？`AGENTS.md §3 #11`（资产差集，禁逐对象 HEAD/本机缓存）、#12（兜底笔记本惰性）、#15（purge 永久判定）、#16（打开入口判定回收站）。
- [ ] 有没有把"每端独立"误做成"跨端同步"（或反之）？设置类默认每端独立。

---

## 7. 与 SiYuan 的对照（一句话）

SiYuan 按**目录**分层：同步 = 整个 `data/`（内含 `assets/`、每库 `.siyuan/sort.json`/`conf.json`、文档 IAL `icon`），`conf/`（配置）、`history/`、`repo/`（本地快照仓库）、`temp/` 仅本地，并用 `.siyuan/syncignore` + 内置忽略清单排除设备本地文件（`storage/local.json` 等）。
我们按**介质 + 表/字段**分层：L1 = manifest 声明字段 + 对象；L2/L3 = 本地库表/文件/localStorage（默认不上云，比"整树+忽略清单"更保守）。
两边结论一致：附件/排序/图标同步；历史/孤儿/GC/配置仅本地。

---

## 8. 已知漂移教训（防再犯）

- `electron/schemaInit.ts` 曾把文档/分组图标注释成"本地化，不进 manifest"，实际 `manifestTypes.ts` + `syncDecisions` 一直在同步 —— **注释会漂移，故本文作为单一来源**。
- `historyLifecycle.ts` 曾把"恢复前留档"注释成 `force=true`，实际调用是 `force=false`（走 24h 同 hash 防抖）。
