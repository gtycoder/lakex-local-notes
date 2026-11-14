# PORTABLE-TRANSFER 规格（桌面 → 手机 一次性全量搬运）

> 261109 用户定稿：覆盖手机数据；含回收站/小记/标签；**排除历史快照**；不加密；单 zip；**上限 4GiB**；导出文件名后缀 **`.zip.lln`**（专属后缀便于筛选/避免误选普通 zip；**只接受该后缀，旧 `.zip` 不再兼容**）；
> 一次性 bootstrap（不做增量包）；**纯离线也可导出**（未配置/未开启 S3）；**云同步开启时导出前自动同步一次**，包内带云端基线；手机导入不强制先配 S3。

## 1. 目标

很多人 S3 首次全量同步贵（egress/请求）。允许：桌面把全部数据（不含历史）打成**一个 zip**，经网盘/USB 到手机；
手机导入后即拥有桌面全部数据，之后 S3 只需增量同步（首轮只读 pointer/索引）。

## 2. 格式（v1）

单个 zip（store-only，不压缩，读写快；**总大小 ≤ 4GiB**，超限直接失败并提示，未来再做分卷）。桌面导出文件名 = `lakex-portable-YYYYMMDD-HHmmss.zip.lln`。
包内布局（桌面工作区镜像 + 可移植清单）：

```
portable.json
desktop/metadata.sqlite3                 # VACUUM INTO 一致性快照
desktop/quick-notes/metadata.sqlite3     # 同上
desktop/notes/{id}.lake
desktop/usheets/{id}.usheet.json
desktop/bitables/{id}.bitable.json
desktop/boards/{id}.board.json
desktop/inks/{id}.ink.json
desktop/note-assets/{noteId}/{file}
desktop/quick-notes/items/{id}.qnote
desktop/quick-notes/assets/{quickNoteId}/{file}
desktop/sync-v3/baseline.json            # 有云端基线 = baseline.json.gz 解压 JSON；纯离线 = 仅内容哈希清单（localOnly，manifest.baseline=null）
```

**排除**：`history/`（历史快照）、`draft-journal/`、`logs/`、`backups/`、`settings.json`、`window-state.json`、
S3 密钥/seed、`sync-v3/state.json`（同步意图账本）以及任何设备本地 UI 状态。
允许包含：回收站（desktop tree_nodes 的 trashed 态）、小记、标签目录与关系。

`portable.json`：

```json
{
  "format": "lakex-local-notes-portable",
  "formatVersion": 1,
  "appVersion": "1.0.4",
  "exportedAt": "2026-11-09T12:00:00Z",
  "source": { "platform": "desktop" },
  "hasHistory": false,
  "limitBytes": 4294967296,
  "counts": { "notes": 0, "folders": 0, "quickNotes": 0, "tags": 0, "assets": 0, "bytes": 0 },
  "baseline": { "epoch": "...", "generation": 1, "lakeCommit": "...", "quickNotesCommit": "..." }  // 纯离线时为 null
}
```

- 桌面导出：**始终可用**。若云同步已配置且启用（`autoMode` manual/auto 均可），导出前自动跑一次 `syncNow` 并等成功；失败则停止导出。未配置/未启用时按离线包导出（不联网）。
- 手机端导入后会确保固定「回收站」目录，因此「目录」实际导入数可能比清单多 1（正常，不告警）。
- 导出用 VACUUM INTO 生成两份 DB 快照（复用 workspaceBackup 的注入回调），再逐文件写入 zip；写 zip 用**自研 store-only 流式写入**（不引依赖，CRC32 + 标准中央目录；总大小 < 4GiB 不需要 ZIP64）。
- 包内不写任何密钥；提醒用户包内是明文笔记。

## 3. 手机导入（覆盖）

入口：设置 → 备份与恢复 →「从便携包导入（覆盖本机）」。

1. 系统文件选择器选 zip；**原生解压**到 App 私有 cache（Kotlin `ZipInputStream`，校验条目路径无 `..`/绝对路径，防 zip-slip）。
2. 校验 `portable.json`：format/formatVersion=1、hasHistory=false、总大小与条目完整；不合法直接失败。
3. 二次确认（说明会覆盖本机全部笔记/小记/标签/回收站，历史快照不包含；建议先导出当前数据备份）。
4. **进入导入事务**：
   - 先把当前手机数据隔离到 App 私有 `portable-import/rollback-<ts>/`（主库/小记库/正文/资产；不删除）。
   - **只读打开包内两份桌面 DB**：优先用 Android 原生 `SQLiteDatabase.openDatabase(..., OPEN_READONLY)` 读取（可分页返回 JSON）；**不要为了运行时把 sql.js 提升为 dependency**（它现在是 devDependency，仅测试用）。把 `tree_nodes` + `notes` 映射为手机 `folders`/`notes`（含 notebook/group→folders、note→notes、回收站态→手机现行回收站语义、`kind`→`doc_kind`）；`quick-notes` 库映射 `quick_notes`/`tags`/`tag_links`/`tag_link_versions`。
   - 复制正文/资产/小记正文与小记图片到手机同名相对路径（`src/core/noteBodyPaths.ts` 契约）；资产按 `note-assets/{id}/` 原样复制。
   - 全部导入行 `is_dirty=0`；有云端 baseline 时写 `sync_v3_state.baseline`（形状转 `MobileV3Baseline`），intents/pending/remotePurged/restorePending/assetsHash 置空；**纯离线包（baseline=null）不写 baseline**（之后配 S3：空桶走首传，已有数据先按云端拉取）。schema 版本置为当前 `MOBILE_SCHEMA_VERSION`。
   - 清空 `note_history`（不含历史）与派生 text_cache；后台重建 FTS（复用现有 rebuild）。
   - 提交后清理 staging；失败则**回滚隔离目录**并保留现场。
5. 成功后提示计数（笔记/小记/标签/资源），并提示「如需增量同步，请到 云端与同步 配置 S3」。
6. 中断恢复：导入前写 `portable-import/pending.json`；启动时若发现 pending 且未提交，自动回滚隔离目录并提示上次导入未完成。

## 4. 失败面（单一判据）

| 场景 | 行为 |
|---|---|
| 非 zip / zip 损坏 / 缺 portable.json | 失败，提示文件无效；不改本机数据 |
| formatVersion 不支持 / hasHistory≠false | 失败，提示版本不兼容 |
| 解压超 4GiB 或条目数异常 | 失败，防磁盘打满；不改本机数据。条目上限 **250,000**（261114 10k 文档+100k 附件便携包实测 110,005 条；旧 100k 上限会误拒，已提高） |
| 导入中崩溃/断电 | 下次启动按 pending 回滚，本机数据回到导入前 |
| 桌面导出时云未启用/未同步完 | 导出入口禁用并说明；不生成包 |
| 包超出 4GiB | 导出失败，提示「数据超过 4GiB，暂不支持分卷」 |

## 5. 安全

- 包 = 明文全量数据：网盘中转视为已泄露风险；UI 明确提示，用户自行选择传输方式。
- 解压必须防 zip-slip（拒绝 `..`、绝对路径、符号链接）；只写 App 私有目录。
- 不包含 S3 密钥/迁移码；手机导入后仍需自行配置 S3。

## 6. 实现落点

- 共享：`src/core/portable/portableFormat.ts`（manifest 类型/校验/上限常量）。
- 桌面：`electron/portable/portableExport.ts`（DB 快照 + 文件遍历 + zip 写入；离线时生成内容哈希）、`electron/ipc/registerPortable.ts`、preload/native/WEB_METHODS、设置页「备份与恢复」入口（始终可用；云开启时先同步）。
- 手机：`android/.../PortablePackagePlugin.kt`（文件选择 + 解压 + 校验）、`src/mobile/portable/importPortable.ts`（sql.js 读桌面库 + 映射 + 文件复制 + baseline）、设置页入口与进度/确认 UI。
- 测试：format/校验、zip 写入/读取往返、桌面列→手机列映射（sql.js 夹具）、baseline 转换、回滚路径；真机走 3GB 级实际数据一次。

## 7. 非目标（v1）

分卷、加密、增量包、手机→桌面、导入时合并（只覆盖）、历史快照迁移。

## 9. 架构边界（261109 review）

- 导出前同步由**主进程**在 portable_export_run 内执行（beforeExport），渲染层只触发；Web/未来入口同一道门，不能绕过。
- 离线内容哈希由桌面主进程从快照 DB + 正文生成；手机只消费哈希，不重新扫描正文。缺正文直接在导出时报错，避免产出「无法首传」的包。
- baseline 语义：manifest.baseline=null 表示无云端血统；包内 baseline.json 此时仅为 localOnly 内容哈希清单（复用 Android staging 的读取路径，不写手机同步账本）。
- 有基线时行为不变；手机导入后仍按云端增量。
