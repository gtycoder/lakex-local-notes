# PORTABLE-TRANSFER 规格（大统一迁移包 v2：各端互导）

> 261122 用户裁决（大统一）：**一份 `.zip.lln` 走天下** —— 桌面（mac/win）↔ 手机 ↔ 未来 iPhone 互导互通；
> **上限维持 4GiB**（不做 5GiB/ZIP64）；**历史快照不进导入导出**（仅本机数据）；**AI 会话不随包**（261116 本地专属裁决延续）；
> **数据覆盖全面**：除仅本机态外全部跨端（笔记本/文档/表格/多维表/画板/手写板/标签/小记/日记/回收站/**草稿**/**画板素材**/附件/**同步基线**）；
> 导入后 S3 可增量续传（**密钥仍不随包**）；**不写 v1 兼容**（formatVersion 1 直接拒，旧包用新版重导或走整库目录）。
> 技术架构做彻底：一份清单、一个校验器、每端一个导入编排，废弃路径删干净。

## 0. 决策记录（261122）

| 决策 | 内容 |
| --- | --- |
| 大统一 | 统一信封（portable.json v2）+ 两种布局（`desktop-workspace` / `mobile-snapshot`）；**每端都支持全量导出与全量导入任意布局** |
| 上限 | **4GiB 维持**（261109 定；261122 复核维持）。大库（>4GiB）桌面走「整库备份目录 + 整库导入」（无上限）；手机端大库已知边界 = S3 首拉 |
| 历史快照 | **不进包**（history/ 不收集；导出端把快照库 `note_history` / `history_fallback_state` 索引行一并清掉，包内自洽无悬空条目）。整库备份**目录**是本机归档，历史随目录保留 |
| AI 会话 | **不随包**（ai_writing_* / ai-attachments/ 维持本地专属；桌面整库目录恢复因是镜像天然带回） |
| 草稿/素材 | **随包**（draft-journal/、quick-notes/staging/、materials/ —— 用户内容，跨端不丢） |
| 密钥 | **永不进包**（S3/AI；safeStorage/Keystore 机器绑定）⇒ 导入端重配 S3 或导入 `LLN1.` 迁移码；包内 baseline ⇒ 配好即增量 |
| 兼容 | formatVersion **2**；v1 包拒绝（可执行提示：新版重导 / 整库目录） |
| 零基线合并底稿（261123） | 纯离线包（从未配 S3）导入 = **合成「合并底稿」基线（bootstrap baseline）**：以导出时刻内容快照当三方合并 base，谱系字段留空打 `bootstrap: true` ⇒ 配 S3 后首同步走**三方合并**（增量、不误删），不是拉全轮。详见 §3.1（261123 真机报障修复的设计决定） |

## 1. 目标

换机/迁移不必付 S3 首次全量同步的 egress 与时间：一端导出一个包，任意端导入即得全部跨端数据，
之后 S3 只做增量（首轮只读 pointer/索引）。纯离线（从未配 S3）也能导出/导入。

## 2. 格式（v2）

单个 zip（**store-only**，不压缩；条目 >65535 写 ZIP64 EOCD）；导出文件名 `lakex-portable-YYYYMMDD-HHmmss.zip.lln`。
**总大小 ≤ 4GiB**（按条目字节和 0.99 余量预检）；条目上限 **500,000**（导入端防炸弹闸，按目标量级 2 万文档/20 万附件放宽；超限直接失败）。

### 2.1 包内布局

`desktop-workspace`（source.platform = desktop；桌面导出）—— `desktop/` 前缀的工作区镜像：

```
portable.json
desktop/metadata.sqlite3                 # VACUUM INTO 一致性快照（历史索引行已清）
desktop/quick-notes/metadata.sqlite3     # 同上（小记库 + 标签域）
desktop/{notes,usheets,bitables,boards,inks}/…   # 正文
desktop/note-assets/{noteId}/{file}      # 文档附件/图片
desktop/quick-notes/items/{id}.qnote     # 小记正文
desktop/quick-notes/assets/{id}/{file}   # 小记图片
desktop/quick-notes/staging/…            # 未保存草稿图片（随包）
desktop/draft-journal/{id}.json          # 未提交草稿日志（随包）
desktop/materials/*.board.json           # 画板自定义素材（随包）
desktop/sync-v3/baseline.json            # 云端基线（gz 解开放入）；纯离线 = 仅内容哈希清单
```

`mobile-snapshot`（source.platform = mobile；手机导出）—— `mobile/` 前缀的手机数据镜像：

```
portable.json
mobile/databases/<主库及 wal/shm/journal>  # 关库后复制，保证一致（历史索引行已清）
mobile/files/{notes,usheets,bitables,boards,inks,note-assets,quick-notes,draft-journal,materials…}
```

**恒排除**（两种布局一致；DB 快照在**导出端**连行清掉，包内自洽）：

- 文件：`history/`（历史快照）、`logs/`、`backups/`、`settings.json`、`window-state.json`、
  `sync-v3/state.json`（设备同步意图账本）、S3/AI 密钥与任何设备本地 UI 状态、`ai-attachments/`；
- DB 行（仅本机数据，261122 裁决）：`note_history` / `history_fallback_state`（历史索引）、
  `ai_writing_conversations` / `ai_writing_messages`（桌面 AI 会话）、`ai_conversations`（手机 AI 会话）、
  `sync_conflicts`（同步记录账本，设备本地审计）、`s3_gc_*` / `orphan_assets`（GC 审计与派生表）。
  （`settings`/`device_state` 保留：含 seed_initialized 等防复活标记；密钥本身是机器绑定密文，导不走。）

### 2.2 portable.json

```json
{
  "format": "lakex-local-notes-portable",
  "formatVersion": 2,
  "appVersion": "1.5.5",
  "exportedAt": "2026-11-22T02:00:00Z",
  "source": { "platform": "desktop" },
  "layout": "desktop-workspace",
  "limitBytes": 4294967296,
  "counts": { "notes": 0, "folders": 0, "quickNotes": 0, "tags": 0, "assets": 0, "bytes": 0 },
  "baseline": { "epoch": "...", "generation": 1, "lakeCommit": "...", "quickNotesCommit": "..." }
}
```

- `layout` 必须与 `source.platform` 配对（desktop↔desktop-workspace、mobile↔mobile-snapshot），校验单一来源
  `src/core/portable/portableFormat.ts`（两端共用一个 `parsePortableManifest`，不再有第二套方言）。
- **无 hasHistory 字段**：v2 恒不含历史。
- `baseline`：纯离线导出为 `null`（包内 baseline.json 此时只是内容哈希清单）；有云端基线则原样随包。
- `counts` 六键（notes/folders/quickNotes/tags/assets/bytes）**必填整数**（core 严格校验；两端写方都给全）；
  `bytes` = 白名单文件 + DB 快照 + 基线的内容字节（不含 portable.json）。
- 导出端云同步已启用时，导出前自动 `syncNow` 一次（失败中止导出）；纯离线导出不联网。

## 3. 导入矩阵（每端全量导入）

| 导入端 \ 包布局 | desktop-workspace | mobile-snapshot |
| --- | --- | --- |
| **桌面** | 整目录镜像恢复（隔离当前工作区 → 拷回 → 重启） | 反向映射：移动行 → 桌面两库 + 文件搬运 + baseline 反转 |
| **手机** | 桌面行映射（`portableMapping.ts`，既有） | 原生整机恢复（隔离 → 拷回 → 提交） |
| iPhone（未来） | 同手机（复用移动布局与映射链，原生插件移植） | 同手机 |

共同语义：

1. **覆盖式导入**（不合并）：先把当前数据隔离为回滚点（不删除），提交后清理；失败自动回滚。
2. **事务式**：导入前写 `pending`；中断/崩溃下次启动自动回滚到导入前。
3. 交叉布局导入做**行映射**：全部导入行 `is_dirty=0`；`content_hash` 取包内基线索引（避免首轮全量重传）；
   回收站/日记（`space` 标记）/标签/小记语义两端对齐（判据见 AGENTS §3/§4、`docs/DIARY.md`）。
4. **同步基线**：包内有云端 baseline ⇒ 转成本端形状写入（桌面 `sync-v3/baseline.json.gz` / 手机 `baseline.json.gz.b64`），
   intents/pending/assetsHash 置空；**纯离线包（无云端基线）⇒ 合成「合并底稿」基线（bootstrap baseline，§3.1）**：
   以包内内容哈希清单（导出时刻快照）+ 导入行元数据为条目底稿写入本端基线文件，谱系字段留空并打 `bootstrap: true`。
   baseline 跨机 = 接管原设备同步身份（261109 裁决，沿用）。**基线损坏 ⇒ 按「无基线」处理并在结果消息里明说，不阻断迁移**（此后首同步走拉全轮，与既有一致）。
   迁移后的首同步语义 = **增量合并**（同 id 同内容零传输；云端后改的赢、本机后改的上传、两头都改远端赢留历史）——见 §3.1。
5. 清派生缓存（text_cache / FTS）并后台重建；`note_history` 恒空（包内就没有）。
6. 成功提示计数 + 「如需增量同步，请配置 S3（或导入迁移码）」。

### 3.1 零基线迁移的首同步语义（261123 设计决定）

**背景（261123 真机报障）**：桌面（从未配 S3）导出便携包 → 手机导入 → 桌面配 S3 并改文档上行 → 手机配同一 S3 点「立即同步」⇒ 报「移动端同步基线文件损坏或丢失…」。根因：零基线包导入写了「有 v3 信封、无基线文件」的状态，被同步路径判成「曾同步过但基线丢了」而安全中止（该中止防的是「拉全轮把从未同步过的小记物理丢弃」，判据 `SyncBaselineLostError`）。即便绕过中止，「无基线 ⇒ 拉全轮（云端是真相）」对迁移数据也不安全：导入后手机新建的小记会被物理丢弃（`discardQuickNote`）、文档被误标「云端已删除·仅本地」且排除发布（假删除）。

**设计（合并底稿 = bootstrap baseline）**：导入端在导入**纯离线包**时合成一份基线：**导出时刻的内容快照当三方合并的 base**（条目 = 包内内容哈希清单 + 导入行元数据：updatedAt / 位置三元组 / 标签版本；纯函数单一来源 `src/core/portable/bootstrapBaseline.ts`），谱系字段（epoch/generation/lakeCommit/quickNotesCommit）留空并打 `bootstrap: true`。配好 S3 后的首同步：

- **云端有 pointer ⇒ 血缘对齐后走正常三方合并轮**（把云端 epoch/generation/commit 采纳进基线，跳过谱系校验——从未同步过的设备本来没有谱系可校验，与新设备首连既有口径一致）：
  - 两端同 id 且内容同 ⇒ **零传输**（增量）；
  - 云端后改（导出后桌面改/删/移动）⇒ 云端赢：内容下载、**删除传播**（base 有、云端无 ⇒ 软删进回收站打「云端已删除·仅本地」，可恢复）、位置走 positionMerge；
  - 本机后改（导入后手机编辑/新建）⇒ 本机赢并**上传**（小记新建不再被丢弃——base 缺席 + 本地有 = 新增）；
  - 两头都改 ⇒ 远端赢 + 本地留历史快照（先提交者为真，既有语义）。
- **云端为空** ⇒ 与「无基线」同路径（空桶首传 / 用户选择，既有 UX 不变）。
- 首轮结束后落盘**真基线**（bootstrap 标记消失），此后与普通设备完全一致；小记「保存并同步」快路径在 bootstrap 期按既有口径回退整轮。

**为什么不用「无基线 = 拉全轮」**：拉全轮把「本地独有」当「云端已删」收敛——对真换机（云端是真相）成立，但迁移包内容从未上过云，判「云端已删」是假删除。合并底稿把这些条目正确判成「新增（上传）」，同时保住删除传播（墓碑权威不变）：导出后云端删掉的条目仍照常压编辑传播删除。

**安全不变量（均有测试钉住）**：① 绝不因缺基线/迁移误删本机数据（小记不物删、文档删除只在「base 有 + 云端确无」时传播且可恢复）；② 删除压编辑、恢复唯一例外；③ 本地是真相、S3 只是镜像。**真「基线丢失」（曾同步过、文件损坏/被删）的安全中止语义不变**——旧版导入造成的「有信封无基线」状态，重导一次便携包即可修复（导入覆盖式、幂等；合成来自行数据，对新旧包一致，不改包格式）。

**信封口径**：只有真的写入基线（云端基线或合并底稿）才写 `sync_v3_state` 信封；两者都没有时保持「从未同步」状态，不再制造「有信封无基线」的假丢失。

**适用面（迁入迁出矩阵）**：桌面↔桌面（便携包两条布局路线）、桌面↔手机、手机↔手机的零基线变体全部按本节语义；已配 S3 的变体（包内带云端基线）语义不变（接管同步身份、增量续传）。

## 4. 桌面整库备份 / 整库导入（目录模式；与包互补）

- **整库备份**（已有）= workspace **完整镜像目录**：两库 VACUUM 快照 + 正文/资产/历史/小记/草稿/素材 +
  settings.json + sync-v3 全部（含意图账本）—— **本机归档语义**，历史随目录保留，**无 4GiB 限制**。
- **整库导入**（261122 新增）：选备份目录 → 校验两库（quick_check + 关键表 + 外键）→ 整个工作区改名隔离
  → 备份目录拷回 → 重启生效；失败回滚。同机/同端大库迁移、含历史归档恢复走这条路。
- 分工：**同端/大库/含历史 → 目录；跨端/便携 → 包**。Batch4-A「从数据库快照恢复」保持轻量档（只换两份库，
  服务 userData/backups 的自动备份快照），不承担整库语义。

## 5. 失败面（单一判据）

| 场景 | 行为 |
| --- | --- |
| 非 zip / 损坏 / 缺 portable.json | 失败「文件无效」；不改本机数据 |
| formatVersion ≠ 2 / 布局与来源不匹配 | 失败「格式版本不支持（v1 请用新版重导或走整库目录）」 |
| 解压超 4GiB 或条目 > 500,000 | 失败，防磁盘打满；不改本机数据 |
| 磁盘可用空间不足（包 + staging + 回滚隔离） | 失败并给出需要的空间 |
| 导入中崩溃/断电 | 下次启动按 pending 自动回滚 |
| 导出时云启用但 syncNow 失败 | 中止导出，不产包 |
| 包内缺正文/基线不合法 | 失败可读原因；不改本机数据 |

## 6. 安全

- 包 = **明文全量数据**：网盘中转视为已泄露风险；UI 明示，传输方式用户自选。
- 解压防 zip-slip（拒 `..`、绝对路径、符号链接）；只写 App 私有 / 用户选定目录。
- 不含任何密钥/迁移码；导入后 S3/AI 凭据由用户重新配置（或导入 `LLN1.` 迁移码，仅防误读非安全边界）。

## 7. 实现落点

- **格式单一来源**：`src/core/portable/portableFormat.ts`（manifest v2 / 布局配对 / 4GiB / counts / baseline ref / 可用性）
  + `src/core/portable/portableRows.ts`（收窄助手与正文目录清单，正反向映射共用）。
- **桌面导出**：`electron/portable/portableExport.ts`（快照 + 清「仅本机」行 + 白名单收集 + 写 zip）；
  `electron/portable/zipStore.ts`（store-only 写）+ `electron/portable/zipRead.ts`（seek 读/流式解包，测试共用）。
- **桌面导入**：`electron/portable/portableImport.ts`（选包/校验/解包/分派）+ `importMobileSnapshot.ts`（手机快照解包/建库/资产重建）
  + 反向映射 `electron/portable/mobileToDesktopMapping.ts` + 目录模式恢复（`electron/workspaceBackup.ts`，
  隔离→换位→回滚唯一实现 `replaceWorkspaceWith`）。手机小记图片元数据（quick_note_assets）在反向导入时
  **从随包 .qnote 正文的资源清单重建**（width/height 不丢）。
- **手机**：`src/mobile/portable/importPortable.ts`（编排）、`portableMapping.ts`（桌面行→手机行）、`exportPortable.ts`；
  原生 `android/.../PortablePackagePlugin.kt`（选包/解压/快照/恢复；v2 校验 + 500k 条目 + 清历史行）。
- **测试**：format v2 校验、导出白名单/清历史、zip 往返、双向映射、回滚路径、IPC 门禁（`ipcChannelParity` 四面同步）。

## 8. 非目标

分卷、加密、增量包、导入时合并、**历史快照跨端**、**AI 会话跨端**、多设备并行导入冲突处理。
