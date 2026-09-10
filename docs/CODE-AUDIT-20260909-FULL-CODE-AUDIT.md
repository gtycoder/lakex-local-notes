# 代码审计报告：桌面端、安卓端与共享逻辑

> 审计时间：2026-09-09  
> 审计分支：`audit/20260909-full-code-audit`  
> 基线提交：`0498bb6`  
> 审计方式：只读静态审计，未修改源码，未运行测试  
> 用途：供 GPT 二次复核。复核时应先验证证据链，再评估严重级别和修复顺序。

## 0. 审计范围与基线

本次覆盖桌面 Electron 主进程、Android 原生层、移动端 WebView/Capacitor 层，以及 `src/core` 共享同步逻辑。已按项目要求阅读 `HANDOFF.md`、`README.md`、`AGENTS.md`、安卓技术方案和 `docs/LAKEX-CONTRACT.md`。

分支状态：

```text
branch: audit/20260909-full-code-audit
HEAD:   0498bb6 docs(handoff): 更新交接文档 —— 本会话移动端首层+工具栏移交、知识库排序移除决策、最新踩坑
```

工作区中已有未提交改动和未跟踪文件，包括 `AGENTS.md`、`README.md`、若干 docs 文件和 `", v)"`。这些是审计前遗留，不属于本次产出，未触碰。

## 1. 结论摘要

本次未发现明显的 SQL 注入、桌面 SSRF 主链路漏洞或搜索结果 XSS 主链路漏洞。主流 SQL 均为参数化查询；桌面对象存储的私网 IP、DNS 解析、重定向和连接钉定处理较完善；搜索片段渲染做了 HTML 转义。

主要风险集中在三类：

1. **数据正确性**：移动端假变更数、未持久化写操作、资源落盘吞错、目录子树漏嵌套文档、桌面远端导入回滚缺陷。
2. **Android 安全边界**：本地资源服务器无认证、FileProvider 根目录过宽、备份与明文 HTTP 策略过宽。
3. **目标量级不可扩展**：移动端全库导出、同步加载全部正文、SQL `IN (...)` 无分批、FTS 启动全量重建。

建议复核优先级：P0 数据丢失/数据错误，P1 安全边界与规模性能，P2 维护性。

## 2. P0：数据正确性

### 2.1 移动端 SQLite 返回假变更数

**证据**：`src/mobile/sqliteDb.ts:57`，`SqlJsStatement.run()`。

```ts
run(...params: unknown[]) {
  this.runWith(params);
  this.stmt.step();
  return { changes: 0, lastInsertRowid: 0 };
}
```

`changes` 与 `lastInsertRowid` 均硬编码为 0。依赖 `changes` 的目录改名、历史清理等逻辑会误判失败；测试桩若复刻该行为，现有测试无法发现。

**建议**：`SqlJsStatement` 持有 `Database` 引用，用 `stmt.getRowsModified()` 返回真实变更数，用 `SELECT last_insert_rowid()` 返回 rowid。

```ts
run(...params: unknown[]): { changes: number; lastInsertRowid: number | bigint } {
  this.runWith(params);
  this.stmt.step();

  const result = this.db.exec("SELECT last_insert_rowid() AS rowid");
  const rowid = result[0]?.values[0]?.[0] ?? 0;

  return {
    changes: this.stmt.getRowsModified(),
    lastInsertRowid: typeof rowid === "bigint" ? rowid : Number(rowid),
  };
}
```

**复核点**：确认当前 sql.js 版本的 `getRowsModified()` 语义，以及 `last_insert_rowid()` 是否会被其它语句影响。

### 2.2 移动端多个写操作未持久化且绕过维护队列

**证据**：

- `src/mobile/bridge.ts:1043` `deleteHistory`
- `src/mobile/bridge.ts:1065` `saveHistorySettings`
- `src/mobile/bridge.ts:1071` `snapshotNote`
- `src/mobile/bridge.ts:1079` `cleanupHistory`
- `src/mobile/bridge.ts:1101` `deleteOrphanAsset`
- `src/mobile/bridge.ts:1111` `cleanOrphanAssets`
- `src/mobile/bridge.ts:1122` `addS3GcPending`
- `src/mobile/bridge.ts:1128` `removeS3GcPending`
- `src/mobile/bridge.ts:1142` `recordS3GcLog`

这些方法直接修改内存库，没有调用 `saveSnapshot(d.exportBytes())`，也没有统一进入 `maintenance.run("main")`。

最明确的缺陷在 `syncNow()`：

- `src/mobile/bridge.ts:1510` 先保存快照
- `src/mobile/bridge.ts:1511` 再执行历史清理

清理后的数据库变更不会再保存。

**精确表述**：`restoreHistory()` 会调用 `bridge.saveNote()`，恢复后的正文可间接保存；但前置“当前正文快照”和主保存不在同一互斥事务中，仍有失败边界和竞态。

**建议**：引入统一写入口，把维护队列、事务、快照保存变成机制：

```ts
async function persistedMutation<T>(mutate: (db: SqlJsDb) => T): Promise<T> {
  return maintenance.run("main", async () => {
    const db = await ensureDb();
    const result = db.transaction(() => mutate(db))();
    await saveSnapshot(db.exportBytes());
    return result;
  });
}
```

所有移动端 DB 写操作应迁移到该入口；`syncNow()` 的清理应发生在最终快照保存之前。

### 2.3 移动端远端资源落盘 fire-and-forget

**证据**：

- `src/mobile/bridge.ts:581` `saveAsset`
- `src/mobile/quickNotesDbPort.ts:105` 远端小记图片
- `src/mobile/quickNotesDbPort.ts:131` 墓碑图片
- `src/mobile/quickNotesDbPort.ts:143` 冲突归档图片

资源写入内存后异步落盘，错误只 `console.warn`。失败后内存层认为资源存在，但持久化文件缺失，同步状态可能被推进为已处理。

**范围修正**：本地 `uploadResource()` 已等待落盘并回滚；问题集中在远端下载资源、小记远端图片、墓碑图片和冲突归档图片。

**建议**：

```ts
async saveAsset(noteId: string, filename: string, bytes: Uint8Array): Promise<void> {
  const key = `${noteId}/${filename}`;
  const hadInMemory = assets.has(key);
  assets.set(key, bytes);

  try {
    await saveAssetBytesFs(key, bytes);
  } catch (error) {
    if (!hadInMemory) assets.delete(key);
    throw error;
  }
}
```

若覆盖旧文件后写入失败，还需恢复旧文件或不能推进同步状态。小记端口应采用同一策略。

### 2.4 桌面远端导入回滚缺陷

**证据**：`electron/remoteImportRepository.ts:96`、`:98`、`:104`、`:116`。

问题一：DB 提交成功后删除旧正文备份；DB 失败时 catch 分支尝试恢复备份但吞掉恢复失败，随后 `finally` 仍会删除仍存在的备份。恢复失败时可能删除唯一旧正文。

问题二：资产用 `renameSync(staging, destination)` 覆盖旧文件；失败回滚只删除新文件，不恢复旧资产。DB 失败时可能永久破坏已有资源。

**建议**：统一 staging → backup → place → DB transaction → commit/rollback：

1. 每个目标文件覆盖前先 rename 到备份路径。
2. 记录 `destination` 与 `backup` 映射。
3. DB 失败时逆序恢复备份。
4. 只有 DB 提交成功，或备份恢复完整成功后，才允许删除备份。
5. 备份恢复失败时保留备份并抛出含路径的错误。

```ts
interface FilePlacement {
  destination: string;
  backup: string | null;
}

function placeFile(staged: string, destination: string): FilePlacement {
  let backup: string | null = null;
  if (fs.existsSync(destination)) {
    backup = `${destination}.previous-${crypto.randomUUID()}`;
    fs.renameSync(destination, backup);
  }
  fs.renameSync(staged, destination);
  return { destination, backup };
}

function rollbackPlacements(placements: FilePlacement[]): boolean {
  let complete = true;
  for (let i = placements.length - 1; i >= 0; i--) {
    const placement = placements[i];
    try {
      fs.rmSync(placement.destination, { force: true });
      if (placement.backup && fs.existsSync(placement.backup)) {
        fs.renameSync(placement.backup, placement.destination);
      }
    } catch {
      complete = false;
    }
  }
  return complete;
}
```

### 2.5 目录子树操作漏掉嵌套文档

**证据**：

- `src/mobile/bridge.ts:367` `collectFolderSubtree`
- `src/mobile/bridge.ts:1191` `trashTreeItem`
- `src/mobile/bridge.ts:1230` `restoreTreeItem`
- `src/mobile/bridge.ts:1269` `purgeTreeItem`

`collectFolderSubtree()` 只遍历 folder，但项目支持“文档套文档”，note 也可以作为父节点。`listNotebookTreeImpl()` 已经按 folder + note BFS 展开，证明数据模型允许 note parent。

因此目录删除、恢复、purge 会漏掉挂在 note 下的子 note，可能产生不可见但仍参与同步的幽灵文档、删除残留、恢复不完整和 purge 墓碑缺失。

**建议**：

```ts
type ParentedNode = { id: string; parent_id: string | null };

function collectSubtree(
  folders: ParentedNode[],
  notes: ParentedNode[],
  rootId: string,
): Set<string> {
  const children = new Map<string, string[]>();
  for (const node of [...folders, ...notes]) {
    if (!node.parent_id) continue;
    const list = children.get(node.parent_id) ?? [];
    list.push(node.id);
    children.set(node.parent_id, list);
  }

  const ids = new Set<string>([rootId]);
  const queue = [rootId];
  while (queue.length > 0) {
    const parentId = queue.shift()!;
    for (const childId of children.get(parentId) ?? []) {
      if (ids.has(childId)) continue;
      ids.add(childId);
      queue.push(childId);
    }
  }
  return ids;
}
```

### 2.6 附件同步使用错误的大小常量

**证据**：

- `src/core/syncEngine.ts:101`
- `src/core/storeLimits.ts:1`
- `src/core/storeLimits.ts:9`
- `electron/resourceRepository.ts:141`
- `electron/resourceRepository.ts:155`

附件协议上限是 `MAX_ATTACHMENT_BYTES = 100MB`，但共享同步引擎下载所有资源时使用 `MAX_IMAGE_BYTES = 25MB`。25MB 到 100MB 的合法附件无法同步下载。

**建议**：资源下载统一使用 `MAX_ATTACHMENT_BYTES`；图片专属限制只在图片处理路径生效。

## 3. P1：安全与可扩展性

### 3.1 Android 本地资源服务器无认证

**证据**：`android/app/src/main/java/com/lakenotes/mobile/AssetServer.java:183`、`:228`。

响应使用 `Access-Control-Allow-Origin: *`，请求无 token、Origin 或调用方校验。同设备其它 App 可访问本地端口读取笔记图片或附件。

**建议**：服务器启动时生成高熵随机 token；原生层仅向应用内部注入；请求必须携带匹配 token；校验 Origin 为 Capacitor WebView 固定 origin（如 `https://localhost`）；错误响应也不放宽 CORS。

### 3.2 Android FileProvider 暴露范围过宽

**证据**：`android/app/src/main/res/xml/file_paths.xml:3`。

配置暴露 `note-assets/` 之外，还暴露整个 cache 与 external storage。一旦 URI 构造或权限逻辑出错，暴露面会扩大到应用 cache 与外部存储。

**建议**：只保留 `files-path path="note-assets/"`；删除旧分享缓存与 external-path；打开文件前做 canonical path 校验。按项目红线，不为旧分享缓存保留兼容层。

### 3.3 Android 备份与明文 HTTP 策略过宽

**证据**：

- `android/app/src/main/AndroidManifest.xml:5`：`allowBackup=true`
- `android/app/src/main/res/xml/network_security_config.xml:4`：base-config 全局允许 cleartext

`allowBackup=true` 可能将私有笔记数据带入系统备份；全局明文 HTTP 超出本地资源服务所需。

**建议**：关闭 `allowBackup`；明文流量仅限本地资源服务所需地址，若配置无法精确表达，应评估 Android 版本能力与替代方案，而不是全局放行。

### 3.4 移动端 SecretStore 使用硬编码派生密钥

**证据**：`src/mobile/secretStore.ts:13`、`:34`。

```ts
const KEY_MATERIAL = "lake-notes-mobile.secret-key.v1";
```

密钥由固定字符串 SHA-256 派生，算法与密钥材料都在代码中可见。这只能防直接明文读取，不能防本地攻击者。

**建议**：迁移到 Android Keystore 或成熟 SecureStorage，保持 `SecretStore` 接口不变。开发阶段可删除旧 IndexedDB 密文，要求重新输入 S3 Secret，不做解密迁移。

### 3.5 gzip 炸弹检查发生在完整解压之后

**证据**：

- `electron/sync.ts:168`
- `src/mobile/s3Store.ts:55`

两端都是先完整解压，再检查解压后长度。恶意 gzip 对象可在检查前耗尽内存。

**建议**：桌面端用 `createGunzip()` 流式读取并累计长度，超限立即销毁流；移动端用 `DecompressionStream` reader 分块读取，超限立即 cancel。

```ts
async function gunzipWithLimit(input: Buffer, maxBytes: number): Promise<Buffer> {
  const gunzip = zlib.createGunzip();
  const chunks: Buffer[] = [];
  let size = 0;

  try {
    for await (const chunk of Readable.from(input).pipe(gunzip)) {
      size += chunk.length;
      if (size > maxBytes) {
        throw new Error(`gzip 对象解压后超过上限: ${size} > ${maxBytes}`);
      }
      chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  } catch (error) {
    gunzip.destroy();
    throw error;
  }
}
```

### 3.6 移动端每次保存全量导出 SQLite

**证据**：`src/mobile/persistence.ts:28`、`src/mobile/sqliteDb.ts:117`。

每次 `saveSnapshot()` 都 `db.export()` 序列化整个数据库，复杂度为 O(全库大小)，且每次保存都发生。10 万文档目标下不可扩展。

**建议**：短期减少批量操作中的保存次数但不能牺牲可靠性；长期替换为原生 SQLite + WAL 持久化或增量 oplog。不建议把 sql.js 全库导出作为正式移动端存储方案。

### 3.7 移动端同步加载全部正文

**证据**：

- `src/mobile/bridge.ts:417` `getAllNotes()` SELECT 全部 `content`
- `src/core/syncEngine.ts:500` 第一次调用
- `src/core/syncEngine.ts:730` 第二次调用

移动端每次同步至少两次加载全部正文，内存和 CPU 双倍放大。桌面 adapter 已按 metadata-only 契约实现，问题主要在移动端 adapter。

**建议**：明确 `getAllNotes()` 为 metadata-only；需要正文的分支通过 `getNote(id)` 按需回查；为 synced 状态维护 `content_hash`，避免 `markSyncedIfUnchanged` 每次重算全文 hash。

### 3.8 SQL `IN (...)` 无上限展开

**证据示例**：`src/mobile/bridge.ts:1131`、`:1205`、`:1241`、`:1296`。

多处直接展开全部占位符。SQLite 默认变量上限通常为 999，不应依赖编译期配置。10 万级数据会触发参数上限或生成超长 SQL。

**建议**：新增统一分批 helper，批量大小控制在 500 到 900，并用测试锁定。

### 3.9 `listAssetKeysFs()` 漏小记且全树扫描

**证据**：`src/mobile/assetFs.ts:82`。

函数只读 `note-assets/{noteId}` 下一层，小记路径 `quick-notes/{id}/{file}` 不会被列出；同时每次调用遍历全部资产目录。

**建议**：按 noteId 或 namespace 精确列出目录；若必须全局扫描，应递归支持 `quick-notes`，并建立文件写入/删除时失效的目录索引。

### 3.10 移动端小记图片缺少桌面同款校验

**证据**：`src/mobile/home/QuickNoteComposer.tsx:81`。

当前只根据 `file.type.startsWith("image/")` 过滤，未检查 25MB、50MP、魔数、合法 MIME 和 SVG 拒绝策略。用户可保存超限图片、伪图片或 SVG；本地能显示，但远端同步或桌面校验会失败。

**建议**：抽出共享图片校验纯函数，桌面与移动端复用；移动端在 addFiles 阶段先校验再进入 Composer。

### 3.11 桌面小记 DB 先提交、文件后落盘

**证据**：`electron/quickNotes.ts:284`、`:295`、`:309`。

流程为 staging 准备 → DB 事务提交 → `promoteStagedSave()` 移动正式文件。promote 失败时 DB 已提交，元数据声称图片存在但正式文件缺失。

**建议**：文件 promote 应在 DB 提交前完成；若业务要求文件不先于 DB 落正式路径，应使用 pending 状态机：文件进入可恢复 staging，DB 记录 pending，promote 成功后再提交 active 状态。

### 3.12 云恢复 seed 顺序脆弱

**证据**：`electron/workspaceBackup.ts:61`、`:79`、`:83`；`electron/ipc/registerNotes.ts:91`。

问题：

1. 先 rename 隔离旧工作区，再创建新空目录。
2. 随后才写 S3 restore seed。
3. seed 解析失败时 `finally` 仍删除 seed。

隔离成功但 seed 写入失败时，用户进入新空库却丢失凭据；seed 解析失败时被删除，无法复核或修复。

**建议**：先确认新工作区可写并写好 seed，再 rename 旧工作区；解析失败时保留 seed 并报错。

### 3.13 整库备份未进入维护队列

**证据**：`electron/ipc/registerNotes.ts:83`。

`run_workspace_backup` 直接调用 `exportWorkspaceBackup()`，未通过 `enqueueMaintenance()`。备份期间保存、同步、GC 可能并发；虽然 DB 使用 `VACUUM INTO`，文件目录拷贝可能来自另一时间点，DB 与文件可能不一致。

**建议**：整库备份进入维护队列，或引入读快照屏障。

## 4. P2：维护性与细节

### 4.1 Android MIME 嗅探短 RIFF 头越界

**证据**：`android/app/src/main/java/com/lakenotes/mobile/AssetServer.java:288`。

只检查 `n >= 8`，但 WebP 判断读取 `head[8]` 到 `head[11]`。当读取长度为 8 到 11 时可能越界。WebP 判断必须要求 `n >= 12`。

### 4.2 Android 资源服务器无请求超时

**证据**：`AssetServer.java`。

工作线程数固定，慢客户端可长期占用连接，导致资源服务饥饿。应为 socket 设置 `setSoTimeout()`，请求读取阶段超时后关闭连接；响应阶段也应限制总耗时。

### 4.3 `assetFs.ts` 缺少路径安全纵深防御

**证据**：`src/mobile/assetFs.ts:37`、`:51`、`:67`。

只检查 `noteId` 和 `filename` 非空，没有复用 `isSafePathSegment`；`load`/`remove` 吞掉所有 IO 错误，文件不存在与权限/损坏错误不可区分。

**建议**：对 key 每一段调用 `isSafePathSegment`；`ENOENT` 可返回 null，其它错误应抛出。

### 4.4 桌面启动全量重建 FTS

**证据**：`src/core/searchRepository.ts:67`。

`rebuild()` 每次 `DELETE FROM notes_fts` 后全量重插。应按 HANDOFF 计划重做为增量账本、只重建缺失/过期条目，并补 1/2 字短词回退。

### 4.5 Electron `sandbox: false`

**证据**：`electron/main.ts:239`。

虽有 contextIsolation 与 sender 校验，但关闭 sandbox 仍是安全折衷。应审计依赖后评估恢复 `sandbox: true`；短期至少确保 preload 不暴露高权限能力，IPC 全部使用白名单和输入校验。

### 4.6 大文件职责混杂

**证据**：

- `src/mobile/bridge.ts` 约 1554 行
- `electron/store.ts` 约 2332 行
- `src/core/syncEngine.ts` 约 998 行

建议在 P0/P1 修复和测试护栏落地后按领域拆分，严禁一次性大迁移；应保持同步语义和事务边界不变。

## 5. 已核对为基本正确的部分

为避免二次复核重复排查，以下已核对，暂不列为缺陷：

1. **SQL 注入**：主流查询参数化，动态 SQL 主要是占位符数组，未发现用户字符串直接拼接进 SQL。
2. **桌面 SSRF**：私网 IP、DNS 解析、重定向、连接钉定处理较完善。
3. **搜索片段 XSS**：`SearchPanel` 做了 HTML 转义，仅保留受控 `<mark>`。
4. **桌面资源服务器**：token 与 trusted sender 校验较完善。
5. **移动端目录 purge 当前语义**：使用 `purged_at`，但未实现 `markPurgeSynced()`，暂无立即 bug；与桌面“永久墓碑”语义存在架构漂移，后续实现必须遵守永久判定红线。
6. **Android 小记资源可达性**：小记文件位于 `FilesDir/note-assets/quick-notes/...`，资源 URL 可达；此前“无法服务”的判断不成立。
7. **同步引擎加载全部正文范围**：桌面 adapter 已按 metadata-only 契约实现；该问题只对移动端 adapter 成立。
8. **本地 `uploadResource()` 落盘**：已等待落盘并具备回滚；fire-and-forget 问题集中在远端下载资源和小记资源。

## 6. 建议修复批次

### 第一批：P0 数据正确性

1. `SqlJsStatement.run()` 返回真实 `changes` 和 rowid。
2. 引入 `persistedMutation()`，统一移动端写操作。
3. 修正 `syncNow()` 中历史清理与快照保存顺序。
4. 远端资源与小记图片等待落盘，失败抛错并回滚。
5. `RemoteImportRepository` 改为完整 staging/backup/rollback。
6. 目录子树收集包含 folder 与 note。
7. 附件下载改用 `MAX_ATTACHMENT_BYTES`。

### 第二批：P1 安全与资源边界

1. Android 资源服务器 token 与 Origin 校验。
2. FileProvider 只暴露 `note-assets/`。
3. `allowBackup=false`。
4. 收窄 cleartext HTTP。
5. SecretStore 迁移 Android Keystore。
6. gzip 流式限额。
7. 云恢复 seed 顺序修正。
8. 整库备份进入维护队列。

### 第三批：P1/P2 性能与架构

1. 移动端存储层替换全量导出。
2. `getAllNotes()` 改 metadata-only。
3. SQL `IN (...)` 分批。
4. 资源目录按需扫描。
5. FTS 增量索引。
6. 大文件按领域拆分。

## 7. 建议测试用例

### 7.1 SQLite 变更数

```ts
it("returns the real SQLite change count", async () => {
  const db = await SqlJsDb.open();
  db.exec("CREATE TABLE audit_values(x INTEGER)");

  expect(db.prepare("INSERT INTO audit_values(x) VALUES(?)").run(1).changes).toBe(1);
  expect(db.prepare("UPDATE audit_values SET x=? WHERE x=?").run(2, 1).changes).toBe(1);
});
```

### 7.2 嵌套文档子树

构造：

```text
notebook
└── folder A
    └── note B
        └── note C
```

验证：

1. trash `folder A` 后 B、C 均进入回收站。
2. restore `folder A` 后 B、C 均恢复。
3. purge `folder A` 后 B、C 均写墓碑并物理删除。

### 7.3 远端导入失败不丢旧数据

用 mock DB 事务在提交时抛错：

1. 已存在旧正文与旧资产。
2. 导入新正文与新资产。
3. DB 提交失败。
4. 验证旧正文和旧资产仍可读。

### 7.4 附件大小上限

构造 26MB 附件，验证本地上传、manifest 声明和另一端下载均成功。

### 7.5 gzip 解压限额

```ts
const compressed = gzipSync(Buffer.alloc(1024 * 1024));
await expect(gunzipWithLimit(compressed, 1024)).rejects.toThrow(/超过上限/);
```

同时监控峰值内存，确认解压在中途中止而不是完成后检查。

### 7.6 Android 资源服务器授权

1. 无 token 请求返回 401/403。
2. 错 token 请求返回 401/403。
3. 正确 token 且正确 Origin 请求成功。
4. 非 WebView Origin 请求失败。

## 8. GPT 二次复核清单

1. 核对每个 P0 的代码路径是否真实可达，尤其 UI 是否已暴露对应入口。
2. 验证 `sql.js` 的 `getRowsModified()` 与 `last_insert_rowid()` 行为。
3. 检查移动端是否还有其它直接写 DB 但未保存快照的入口。
4. 核对 `RemoteImportRepository` 的失败矩阵：正文失败、资产失败、DB 失败、恢复失败。
5. 用真实目录树验证 note-as-parent 是否会进入 folder 删除路径。
6. 确认所有附件路径均应使用 100MB，而不是仅某类资源使用 100MB。
7. 评估 Android 资源服务器 token 的注入与轮换方案。
8. 核对移动端存储替换方案：原生 SQLite/WAL 与增量 oplog 的取舍。
9. 复核“已核对为正确”的部分，确认没有漏掉边界条件。
10. 对每个 P0 修复补充失败注入测试，不允许只测 happy path。

## 9. 审计限制

1. 本次为静态审计，未运行 `tsc`、`vitest`、桌面构建、移动构建或 Android 真机测试。
2. 未触碰正式数据目录。
3. 未修改任何源码。
4. 行号基于 `0498bb6` 和当前工作区状态，后续代码变化可能使行号漂移；复核时应以符号名和代码片段为准。

---

## 10. 二次复核与条件重估（260909，GPT 复核，追加）

> 本节为二次复核结论。复核方式：逐条回源码验证 §2~§4 全部证据链（P0 六条全部属实），
> 并按用户给定的**运营前提**对严重级别与修复必要性重新定级。本节与正文冲突时以本节为准。

### 10.0 复核前提（用户给定，覆盖正文的量级假设）

1. **本地优先 + 云端备份**：本地是真相，S3 只是镜像（云端备份绝不反噬本地）。
2. **个人笔记、多端无并发**：不存在多设备同时编辑同一文档的对抗场景。
3. **先提交者为真、不解决冲突**：被覆盖方的编辑以历史快照（`createHistorySnapshot`）归档，不做冲突合并。
4. **回收站是"有笔记本行为的系统容器"**：软删=移入回收站，purge 后条目仍可从回收站语义恢复（墓碑权威、删除压编辑）。
5. **数据量级按 5000 文档 / 3 万附件估算**（全库含附件 ~20GB；覆盖 AGENTS §1 的 10 万/100 万压测基线，压测基线仅作长期参考，不作为本次定级依据）。已写入 `README.md`「设计先决条件」作为后续开发/审计/重构的前置约束。
6. **排除全部搜索相关问题**（§4.4 FTS 等）：搜索功能将单独立项统一重构，不在本审计修复范围内。

### 10.1 不成立的问题（前提变化后撤销）

| 原编号 | 问题 | 不成立理由 |
|---|---|---|
| 3.5 | gzip 炸弹（先解压后检查） | 威胁模型不成立：攻击前提是攻击者已控制用户自己的 S3 桶；能写桶者已能读到全部笔记数据，炸弹不增加额外危害。且本地优先、云端只是镜像。**撤销**（如顺手可做流式限额，不计为审计整改项） |
| 4.2 | 资源服务器无请求超时 | 唯一客户端是本应用 WebView；个人设备、无对抗客户端。若 3.1 token 落地，此项更无必要。**撤销** |
| 4.1（部分） | "短 RIFF 头越界"表述 | 表述不成立：`head` 是 `new byte[16]` 定长数组，`head[8..11]` 不会越界；真实问题是 `n∈[8,11]` 时读到零初始化字节导致 WebP 判不出、MIME 回退。问题降级为轻微正确性瑕疵（修法不变：要求 `n>=12`） |

### 10.2 没有必要修改 / 降级接受的问题

| 原编号 | 问题 | 处置 | 理由 |
|---|---|---|---|
| 4.4 | 桌面启动全量重建 FTS | **排除** | 搜索统一重构（用户决策），不在本审计范围 |
| 3.11 | 桌面小记 DB 先提交、文件后落盘 | **不修（观察）** | 注释明示是有意设计（"先提交为确定"）；且符合"小记=随手记、不备份"既定语义；promote 失败概率极低（同卷 rename）。若日后出现实损再议 |
| 3.12 | 云恢复 seed 顺序脆弱 | **降级 P2 可选** | quarantine 保留旧库，最坏情况只是重输 S3 凭据，无数据丢失；seed 解析失败概率近零（自己写入的 JSON） |
| 4.5 | Electron `sandbox: false` | **接受（记录在案）** | 已有 contextIsolation + sender 校验 + IPC 白名单；打包版 preload 沙箱有已知 asar 兼容问题（代码注释）。长期评估项，非本批整改 |
| 3.4 | SecretStore 硬编码派生密钥 | **降级长期项** | 个人设备威胁模型下，现有实现已防明文直读；代码头已标注"降级实现 + Keystore 迁移 TODO"。不阻塞 |
| 3.3（明文部分） | 全局 cleartext HTTP | **接受（记录在案）** | Network Security Config 的 domain 不支持 IP 字面量，无法精确限定到 127.0.0.1；实际流量仅 S3(HTTPS) + 本地资源服务。**但 `allowBackup=false` 仍须执行**（见 10.3，一行改动，防 IndexedDB 密文+硬编码密钥随系统备份外泄） |

### 10.3 需要继续修改的问题（按施工优先级）

**第一批：P0 数据正确性（全部确认属实，必须修）**

| 顺序 | 原编号 | 问题 | 复核补充 |
|---|---|---|---|
| 1 | 2.1 | SQLite 假变更数 | **升级：不是隐患，是当下坏掉的功能**。`renameTreeNode`（bridge.ts:755）消费 `.changes` 恒 0 → 恒抛"节点不存在" → UI `catch{}` 吞错，移动端重命名文件夹 100% 失败且无提示（正是"静默丢弃用户输入"失败模式）。改动 <10 行，最先修 |
| 2 | 3.8 | SQL `IN (...)` 无分批 | **从 P1 升级为 P0**：5000 文档/3 万附件量级下，`removeS3GcPending` 每次同步传入全库引用键 ≈3.5 万参数，超过 sql.js 内置 SQLite 3.49.1 的变量上限 32766（实测确认版本），当前被 `catch {}` 静默吞掉（bridge.ts:1489）——**当下必现的静默失败**，非扩展性隐患。需统一分批 helper；桌面同类 IN 展开一并分批 |
| 3 | 2.6 | 附件下载用错 25MB 常量 | 确认：26~100MB 附件传得上去、所有端拉不下来。一行常量修正 |
| 4 | 2.5 | 子树操作漏嵌套文档 | 确认，**仅移动端**（桌面统一 `tree_nodes` + `descendantIdsIncludingDeleted` 不受影响）。trash/restore/purge 三个消费点同改；恢复分支须对嵌套子 note 写 `restore_pending_at`（恢复红线） |
| 5 | 2.3 | 远端资源落盘 fire-and-forget | 确认，**后果升级**：落盘失败 → `listLocalAssets` 实扫磁盘扫不到 → 新 manifest 不声明 → 他端 GC 判"未引用"删除云端对象 ⇒ 单点落盘失败放大为**跨端资产永久丢失**（违反"清单声明⇒存在"的对称责任）。必须等待落盘 + 失败回滚内存层 |
| 6 | 2.2 | 写操作未持久化/绕过维护队列 | 确认（9 个方法 + `syncNow` 先保存后清理的顺序错误）。**⚠️ 修复方案有死锁隐患**：`syncNow` 已持有 `maintenance.run("main")`，其 `onPublished` 钩子调用 `addS3GcPending`/`removeS3GcPending`；若按原稿给这些方法套队列 → 自等自挂起。须拆"无队列内部变体（`*Locked`）+ 公开入口包队列" |
| 7 | 2.4 | 桌面远端导入回滚缺陷 | 确认：catch 恢复 backup 是 best-effort，finally 却无条件删 backup；资产覆盖无备份。按原稿 staging→backup→place→DB→commit/rollback 方案实施，"备份恢复失败则保留备份并抛错" |

**第二批：P1 安全与配置（小改动）**

1. **3.2 FileProvider 收窄**：删 `cache-path`/`external-path` 两行（注释自认已弃用；按红线不为旧数据写兼容）。
2. **3.3 `allowBackup=false`**：一行（理由见 10.2）。
3. **3.1 资源服务器 token**：从 P1-high 降为 P1-low，但仍建议做（同设备其他 App 可读 127.0.0.1 端口，绕过 Android 应用沙箱；桌面已有 token，对齐即可）。
4. **3.13 整库备份进维护队列**：一行 `enqueueMaintenance`，顺手。

**第三批：P1 性能（5000 文档/3 万附件量级核算后排序）**

1. **3.9 `listAssetKeysFs`**：3 万附件下每次 `listLocalAssets` 全树扫描 = O(笔记数×目录数) readdir 风暴，同步路径必卡；且小记 `quick-notes/{id}/{file}` 两层结构列不出。改按 noteId 精确列目录。
2. **3.7 `getAllNotes()` metadata-only**：5000 文档全正文 × 每次同步 2 遍，移动端 WebView 内存峰值仍不可接受。确认仅移动端 adapter 违反契约。
3. **3.6 全量导出**：从"目标量级不可扩展"**降级为性能债**（5000 文档库导出约百 MB 级，单次保存百 ms 级）。短期：合并/减少批量操作中的保存次数；长期：原生 SQLite + WAL 替换 sql.js 全量导出（同时根治 2.2 一类"忘保存"bug 的土壤）。
4. **3.10 移动端小记图片校验**：抽共享纯函数复用桌面校验（否则移动端可存、桌面拒收，跨端不一致）。

**第四批：P2 顺手/长期**

- 4.1 `sniffMime` 要求 `n>=12`（轻微，顺手）。
- 4.3 `assetFs` 路径段校验（远端 manifest 文件名是外部输入面，纵深防御，成本低）。
- 4.6 大文件按领域拆分（按 HANDOFF 既定计划，测试护栏后分批，严禁一次迁移）。

### 10.4 复核修正记录（对正文的勘误）

1. **2.1 升级**：正文写"依赖 changes 的逻辑会误判失败"——实际 `renameTreeNode` 已经 100% 失败且被 UI 吞错，是现存功能故障，非潜在风险。
2. **2.3 升级**：正文只述"同步状态可能被推进"——实际存在"落盘失败 → manifest 漏声明 → 他端 GC 删云端对象"的跨端永久丢失链。
3. **2.2 修复方案缺陷**：原稿 `persistedMutation` 直接套 `maintenance.run("main")` 会在 `syncNow`（已持锁）的 `onPublished` 钩子内自等死锁；必须提供无队列内部变体。
4. **4.1 表述错误**："越界"不成立（定长 16 字节数组），实为零值误判；结论保留、级别下调。
5. **§5 抽查通过**：§5.3 搜索 XSS（`sanitizeSnippet` 先全转义再白名单还原 `<mark>`，顺序正确）、§5.4 桌面资源服务器 token、§5.7 桌面 metadata-only 契约，均复核属实。

### 10.5 验收与门禁要求

- 每个 P0 修复必须附**失败注入测试**（不允许只测 happy path）；2.1 须补"重命名真实生效"回归测试，2.3 须补"落盘失败时内存层回滚且不推进声明"测试。
- 每批完成后门禁全绿（`tsc` + vitest + 桌面/移动双 build），代码批次经用户验收后提交（红线：不擅自合 master）。
- 修复落在 `audit/20260909-full-code-audit` 分支；移动端改动须在模拟器/真机复验（HANDOFF §8.1）。
