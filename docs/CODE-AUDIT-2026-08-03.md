# Lake Notes Electron 代码审计报告

- 审计日期：2026-08-03
- 审计分支：`master`
- 审计提交：`a9dfa51`
- 审计方式：静态代码审查、调用链核对、现有测试与 TypeScript 检查
- 审计范围：Electron 主进程、IPC、SQLite/文件存储、S3 同步、资源服务、编辑器运行时、自动保存、移动端状态和 Worker Pool
- 报告状态：仅记录问题和建议，尚未据此修改代码

## 验证基线

- `npx tsc --noEmit`：通过
- `npx vitest run`：通过，共 4 个测试文件、82 个测试
- 审计结束时工作区干净

现有检查通过只说明当前类型检查和已有测试未发现失败，不代表下述边界场景已被覆盖。

## 高风险问题

### 1. 同步会在正文未变化时清空资源清单

**位置**

- `electron/sync.ts:221-247`
- 相关现有测试：`electron/sync.test.ts:264-278`

**问题**

上传阶段仅在正文 hash 变化时扫描本地资源并填充 `assets`。无论正文是否变化，代码随后都会用当前 `assets` 生成新的 manifest。正文未变化时 `assets` 仍为空数组，因此带图片的笔记连续同步两次后，第二份 manifest 会丢失该笔记的资源列表。

**影响**

已有设备可能暂时正常显示本地图片，但新设备或重建后的设备根据最新 manifest 同步时不会下载这些资源，造成跨设备资源缺失。

**建议**

- 每次同步都生成当前有效资源清单；或在正文未变化时复用并核验远端资源清单。
- 增加“带资源笔记连续同步两次，第三台设备仍能恢复全部资源”的回归测试。

### 2. 删除墓碑只保留一次同步，离线设备可让已删除笔记复活

**位置**

- `electron/sync.ts:250-260`
- `electron/sync.ts:280-285`
- `electron/store.ts:509-514`

**问题**

本地删除记录被写入一次远端 manifest 后立即从本地 `deleted_notes` 剪除。下一次同步重新生成 manifest 时，该删除记录不再存在。长期离线设备仍保留旧笔记，上线后会将其视为本地有效内容并重新上传。

**影响**

用户已删除的笔记可能在多设备场景中重新出现，属于同步数据一致性和删除语义失效。

**建议**

- 在远端 manifest 中持续保留删除记录。
- 仅在满足明确保留期限、所有设备确认或版本向量条件后回收墓碑。
- 增加三设备测试：设备 C 离线，设备 A 删除并多次同步，设备 C 上线后不得恢复笔记。

### 3. 远程 manifest 可造成目录穿越和任意文件写入

**位置**

- `electron/sync.ts:127-130`
- `electron/sync.ts:145-191`
- `electron/store.ts:155-156`
- `electron/store.ts:551-560`

**问题**

远程 JSON 被直接断言为 `Manifest`，没有运行时 schema 校验。远程 `note.id` 会进入笔记文件路径，`asset.filename` 会进入资源文件路径。攻击者若控制或篡改 Bucket、凭据或 manifest，可构造 `../` 路径逃逸工作区目录。

**影响**

可覆盖当前用户有权限写入的工作区外文件，属于任意文件写入风险。

**建议**

- 对 manifest 执行严格运行时 schema 校验。
- `note.id` 和资源文件名只允许安全的单路径段，并限制长度和字符集。
- 使用 `path.resolve` 生成目标路径后，验证目标仍位于预期根目录内。
- 为恶意 ID、正反斜杠、绝对路径和编码变体增加安全测试。

### 4. 远程资源没有完整性校验，缺失对象会被静默忽略

**位置**

- `electron/sync.ts:163-171`
- `electron/store.ts:551-560`

**问题**

资源下载后没有验证 manifest 中声明的 `hash` 和 `size`。`getOptional` 返回空值时，该资源被直接跳过，笔记仍继续导入并可能被标记为同步成功。

**影响**

远端对象损坏、被替换或部分丢失时，本地会接受不完整状态；随后生成的新 manifest 还可能固化该资源丢失。

**建议**

- 要求 manifest 声明的每个资源都必须存在。
- 下载后校验大小和 SHA-256，不一致则中止该笔记导入。
- 使用 staging 目录完成全部下载和验证，再原子替换本地资源。

### 5. SSRF 校验可被 DNS、重定向和渲染层回退绕过

**位置**

- `electron/ssrf.ts:7-14`
- `electron/store.ts:588-617`
- `src/features/editor/resourceUpload.ts:89-139`

**问题**

SSRF 检查只拦截 URL 中直接出现的本机或私网 IP，不解析域名；网络请求同时设置了自动跟随重定向。因此域名解析到私网、DNS rebinding、公共地址重定向到私网或云元数据地址均可绕过。主进程拒绝请求后，渲染层还会直接使用 `fetch` 回退，明确绕过主进程策略。

**影响**

恶意笔记内容或远程资源 URL 可能探测、读取本机服务、局域网服务或云环境元数据。

**建议**

- 每次请求前解析 A/AAAA，并拒绝所有本机、私网、链路本地、保留和组播地址。
- 禁止自动跟随重定向，逐跳解析并重新校验目标。
- 考虑 DNS rebinding，在连接层锁定已校验地址或采用受控请求实现。
- `InvalidInput`、SSRF 拒绝等安全错误绝不能回退到 renderer fetch。
- 尽量统一所有远程下载到主进程受控路径。

### 6. IPC 来源校验过宽，页面导航后仍可能获得完整本地权限

**位置**

- `electron/main.ts:39-64`
- `electron/main.ts:67-85`
- `electron/preload.cjs:5-33`

**问题**

IPC 来源判断信任任意 `file://`、任意 localhost 端口、DevTools 和 `about:blank`。BrowserWindow 没有拦截顶层导航，也没有设置新窗口处理策略。preload 暴露了完整笔记读写、删除、S3 设置和同步能力。

**影响**

如果应用窗口被导航到恶意本地页面或受攻击的 localhost 页面，该页面可能调用高权限 IPC 操作本地数据和同步凭据。

**建议**

- 生产环境精确匹配打包入口文件，开发环境只允许固定开发源。
- 同时校验调用来源属于应用创建的预期 `webContents`。
- 拦截 `will-navigate`，设置 `setWindowOpenHandler`。
- 外链仅在协议校验后交给 `shell.openExternal`。
- 不将 `about:blank`、DevTools 和任意 localhost 视为可信应用页面。

### 7. 自动保存响应会覆盖保存期间产生的新编辑

**位置**

- `src/App.tsx:84-110`
- `src/App.tsx:175-178`

**问题**

保存请求返回后，代码无条件使用返回内容覆盖标签内容并设置 `dirty: false`。保存请求发出后用户仍可继续输入；旧请求返回时会覆盖更新后的 React 草稿。多个保存请求之间也没有串行队列、revision 或过期响应保护。

**影响**

用户最新输入可能在界面和磁盘上被旧版本覆盖，属于潜在内容丢失。

**建议**

- 对每篇笔记串行执行保存。
- 保存请求携带单调 revision，并忽略过期响应。
- 只有当前草稿仍等于该请求快照时，才能用返回值更新内容并清除 `dirty`。
- 增加延迟和乱序 IPC 响应测试。

## 中风险问题

### 8. 移动端保存成功后仍持有旧文档快照

**位置**

- `src/App.tsx:84-98`
- `src/App.tsx:287-299`
- `src/App.tsx:335-336`

**问题**

移动端调用通用 `persistTab` 保存，但该函数只更新桌面标签、笔记摘要和树节点，不更新 `mobileActive`。完成编辑切换到 viewer 后，viewer 使用的仍是旧 `mobileActive.content`。

**影响**

用户可能立即看到保存前内容；再次离开时仍会被判断为有差异并重复保存。

**建议**

- 移动端保存成功时同步更新 `mobileActive`、draft 内容和标题。
- 将持久化结果和桌面、移动端状态更新明确拆分。
- 增加“编辑、完成、阅读、离开、再次打开”的移动端回归测试。

### 9. 树结构约束可被 UI 或 IPC 直接破坏

**位置**

- `electron/store.ts:172-176`
- `electron/store.ts:229-263`
- `electron/store.ts:340-359`
- `src/App.tsx:236-254`
- `src/components/Sidebar.tsx:92-120`

**问题**

Store 只验证父节点存在，不验证父节点类型。当前实现允许 note 成为其他节点的父节点，也允许 notebook 移入其他节点。`reorderTreeNodes` 不验证 ID 是否属于指定父节点，也不验证重复、遗漏或不存在的 ID。前端拖拽同样允许对任意节点执行 `inside`。

**影响**

树可能出现不受 UI 正常支持的层级、隐藏节点、跨父级错误排序和同步异常。

**建议**

- 在 Store 层建立并强制树结构不变量。
- notebook 只能位于根层；note 不能有子节点；明确 group 的合法父类型。
- 重排时在事务内校验 parent、同级集合完整性、重复和遗漏。
- 将移动和重排合并为一次原子操作。

### 10. 文件系统操作与 SQLite 事务并不原子

**位置**

- `electron/store.ts:229-243`
- `electron/store.ts:279-290`
- `electron/store.ts:309-337`
- `electron/store.ts:551-580`

**问题**

创建、保存、删除和远程导入在 SQLite transaction 中执行不可回滚的文件操作。后续 SQL 失败时数据库可以回滚，但已写入、替换或删除的文件无法回滚。删除路径尤其会在数据库事务提交前永久删除 `.lake` 和整个资源目录。

**影响**

异常、磁盘错误或数据库错误可造成 DB 引用不存在文件、文件内容与元数据不一致，甚至不可恢复的数据丢失。

**建议**

- 使用 staging、备份和原子 rename 组织文件变更。
- 明确数据库提交和旧文件清理顺序。
- 启动时检测并恢复未完成操作，或执行一致性修复。
- 为中途失败注入测试覆盖各个阶段。

### 11. 远端资源集合缩小时，本地旧资源不会被删除

**位置**

- `electron/store.ts:550-580`

**问题**

`importRemoteNote` 只覆盖或新增远端资源，不删除本地资源目录中已从远端集合移除的文件。

**影响**

旧资源长期占用空间，并可能在后续孤儿检测或上传流程中重新进入同步状态。

**建议**

- 使用 staging 目录构建完整远端资源集合后原子替换目录。
- 或计算本地与远端文件集合差集，显式删除旧文件并同步更新孤儿记录。

### 12. 孤儿文件删除失败仍被报告为清理成功

**位置**

- `electron/store.ts:416-436`

**问题**

`unlink` 失败被捕获后，代码仍删除对应数据库记录并增加成功计数。

**影响**

文件继续占用磁盘，但 UI 会报告清理成功；由于记录已删除，后续也无法发现或重试该文件。

**建议**

- 仅在文件不存在或删除成功后删除数据库记录并累计释放空间。
- 返回成功数、失败数和错误详情，保留失败项供重试。

### 13. Worker 崩溃后仍会被继续复用

**位置**

- `src/lib/workerPool.ts:64-78`
- `src/lib/workerPool.ts:100-118`

**问题**

worker 触发 `onerror` 后只被标记为空闲，没有 terminate、移除或替换。队列处理随后可能把下一任务再次派发给已崩溃的 worker。

**影响**

后续图片转换任务可能连续失败或永久等待，影响资源上传流程。

**建议**

- worker 崩溃后立即 terminate 并创建替代实例。
- 为每个任务增加超时，保证所有 Promise 最终 settle。
- 增加 worker 抛错后继续处理排队任务的测试。

### 14. 附件和 Data URL 缺少解码前大小限制

**位置**

- `src/features/editor/resourceUpload.ts:45-61`
- `src/features/editor/resourceUpload.ts:79-86`
- `src/features/editor/resourceUpload.ts:146-150`

**问题**

非图片文件会被完整读入内存，再转换成体积更大的 base64 并嵌入笔记。Data URL 也在大小检查前执行 `atob` 和数组转换，产生多份内存副本。

**影响**

大附件可能造成 renderer 内存骤增、长时间卡顿、崩溃以及超大笔记文件。

**建议**

- 对所有附件设置统一大小上限。
- 根据 base64 文本长度在解码前预检。
- 优先将附件落盘并在笔记中保存资源引用，避免直接嵌入大型数据。

## 低风险问题

### 15. TOC 延迟水合参数错误，且多标签判断使用全局 DOM

**位置**

- `src/features/editor/lakeRuntime.ts:507-515`
- `src/features/editor/lakeRuntime.ts:553-561`
- `src/features/editor/lakeRuntime.ts:620-641`

**问题**

两次延迟水合把需要 `host` 参数的 `ensureCardsInViewHydrated` 直接传给 `setTimeout`，调用时不会得到正确的编辑器 host，因此重试实际无效。TOC 刷新又使用全局 `document.querySelectorAll` 判断条目数量，多标签场景下其他编辑器已有 TOC 条目会让当前编辑器提前停止重试。部分延迟定时器也没有在销毁时清理。

**影响**

第二个及后续标签可能偶发不显示大纲；异步水合重试失效；编辑器销毁后仍可能执行延迟回调。

**建议**

- 使用闭包明确传入对应 `host`。
- 将 TOC 查询范围限定在当前编辑器容器。
- 保存所有 timeout ID，并在编辑器销毁时统一清理。
- 增加多标签同时启用 TOC 和快速关闭标签的测试。

## 建议的二次审计重点

建议二次审计优先对以下问题做独立复现或反证：

1. 连续两次同步后 manifest 是否丢失 `assets`。
2. 墓碑被剪除后，第三台离线设备是否能恢复已删除笔记。
3. 恶意 manifest 的 `note.id` 和 `asset.filename` 是否可逃逸工作区。
4. 域名解析到私网、HTTP 重定向到私网以及 renderer fallback 是否能绕过 SSRF 防护。
5. 人为延迟并乱序返回 `save_note` IPC 时，最新草稿是否被旧响应覆盖。
6. 页面导航到其他 `file://` 或 localhost 页面后，preload IPC 是否仍可调用。

二次判断时可对每项标记为：`确认`、`需要复现`、`风险降级`、`误报`，并记录判断依据。

---

# 二次审计判断（Codex，2026-08-03，基于当前 master @ a9dfa51）

> 方法：逐条对照源码与调用链核验（非仅复读报告）；参考了 opus4.8 的评审（见文末状态说明）。
> 标记：`确认` / `需要复现` / `风险降级` / `误报`。

## 逐条判断

### 1. 同步清空资源清单 — `确认`（高，同意 opus：全报告最该先修）
代码核验：`electron/sync.ts:224-247` 中 `assets` 只在 `remoteHashes.get(note.id) !== hash` 分支内填充，
`manifestNotes.push({...assets})` 无条件执行。正文 hash 未变 → 第二份 manifest 的 `assets` 为空。
测试核验：`electron/sync.test.ts:264-278`（"笔记内容变更时…"）只覆盖改内容路径，未覆盖"内容不变、重复同步"。
补充：该缺陷会在内容下次变更时自愈（重新扫描并列出资源），但新设备按"空 assets 的 manifest"拉取期间图片缺失。
结论与报告/opus 一致。

### 2. 删除墓碑只保留一次同步 — `确认`（高）
代码核验：`electron/sync.ts:284-285` 写完 manifest 立即 `pruneTombstones`；
`electron/store.ts:510-514` 直接 DELETE。`sync.ts:250-262` 墓碑只在"云端有该笔记"时写入。
逻辑推演：设备 A 删除 → 同步（manifest 带 deleted）→ A 再次同步（墓碑已剪，manifest 不再带 deleted）→
离线设备 C 上线：manifest 无此笔记 → C 将本地旧笔记视为新内容重新上传 → 复活。
前提是 A 在 C 上线前至少同步两次，属真实高频场景。结论与报告/opus 一致。

### 3. manifest 目录穿越 — `确认`（高，且实际面比报告更大）
代码核验：`electron/sync.ts:128` `JSON.parse` 后仅断言为 `Manifest`（无运行时 schema）；
`electron/store.ts:551-560` `importRemoteNote` 用 `notePath(note.id)`（`store.ts:155`，id 零校验）写 `.lake`，
`path.join(dir, asset.filename)`（`store.ts:559`，filename 零校验）写资源。
opus 补充正确：`noteAssetsDirFor`（`store.ts:362-368`）对 noteId 有校验而 `notePath` 没有，两条路径不一致。
**我方追加**：`notePath` 的缺口不止 manifest 路径——`save_note`/`read_note` IPC 直连 `store.ts:220/280`，
任意"受信"页面（见第 6 条）可直接读写工作区外 `*.lake` 文件。修复应把"单路径段 + `path.resolve` 包含性"校验
下沉到 `notePath` 本身（而非只在 assets 目录做），并同时校验 `asset.filename`。

### 4. 远程资源无完整性校验 — `确认`（高）
代码核验：`electron/sync.ts:163-171` 资源下载 `if (bytes) assets.push(...)`，`getOptional` 返回 null（NoSuchKey）即静默跳过；
manifest 声明的 `hash`/`size` 全流程未使用。补充细节：非 NoSuchKey 错误会让 `Promise.all` reject 中止同步，
所以"静默忽略"只针对缺失对象；但"对象可读但内容损坏/被替换"会被原样接受（无 hash 校验），两者都成立。
结论与报告/opus 一致。

### 5. SSRF 校验可被绕过 — `确认`（高，且比报告更严重）
代码核验：`electron/ssrf.ts:13` 明确"域名不做解析"；`electron/store.ts:615` `redirect: "follow"`；
`src/features/editor/resourceUpload.ts:137` 只在错误含"浏览器模式"时 throw，Electron 路径永不产生该词。
**关键补充**：`resourceUpload.ts:89-91` 注释明言回退目的是"主进程 SSRF 策略拒绝的本地/私网地址"——
渲染层绕过是**刻意设计**而非疏漏，必须改为安全错误（InvalidInput/SSRF）绝不回退。
另注：renderer `fetch` 虽受 CORS 限制读不到响应体，但请求仍会发出（探测/元数据副作用不受 CORS 影响）。
结论与报告/opus 一致。

### 6. IPC 来源过宽 + 无导航拦截 — `确认`（高）
代码核验：`electron/main.ts:65-73` 信任任意 `file://`、任意 localhost 端口、`devtools://`、`about:blank`；
全仓无 `will-navigate` / `setWindowOpenHandler` / `shell.openExternal`；`preload.cjs:5-33` 暴露全量
读写/删除/S3/同步。`contextIsolation:true`、`nodeIntegration:false` 存在但均不拦截导航。
与第 3 条叠加 = 恶意本地页可读/写任意 `.lake` 文件。结论与报告/opus 一致。

### 7. 自动保存响应覆盖新编辑 — `确认`（中偏高，同意 opus 上调）
代码核验：`src/App.tsx:84-110` `persistTab` 无条件用返回值覆盖 tab 内容并置 `dirty:false`；
`App.tsx:173-178` 防抖 800ms 按 noteId 覆盖定时器，无 revision/过期响应保护。
补充 nuance：主进程同步写盘，请求按序到达时磁盘最终收敛到最新，真正丢失窗口是
"in-flight 期间继续输入 → 旧响应覆盖 tab 状态且 dirty=false → 关闭/驱逐标签（不触发保存）"。
另外 `EditorTab` 不随 content prop 重挂载（effect 仅依赖 noteId），可见编辑器内保留新内容，
使 tab 状态与编辑器 DOM 不一致，进一步掩盖问题。建议采纳 revision + 快照比对。

### 8. 移动端保存后仍持旧快照 — `确认`（中低，比报告/opus 再降半档）
代码核验：`App.tsx:287-298` `leaveMobileDocument`/`finishMobileEditing` 调 `persistTab`，
后者只更新 openTabs/notes/treeNodes，不更新 `mobileActive`；viewer 用 `mobileActive.content`（旧）。
结论：磁盘内容正确（已保存），影响是 viewer 显示旧内容 + 下次离开重复保存（无害）。
非数据丢失，故我判 `中低`，报告与 opus 判"中"。功能正确性问题成立。

### 9. 树结构不变量可破坏 — `确认`（中）
代码核验：`store.ts:172-175` `ensureParent` 只查存在性；`store.ts:339-348` `moveTreeNode` 校验自移/子孙
但不校验节点类型（note 可成为父、notebook 可移入 group）；`store.ts:353-359` `reorderTreeNodes` 不校验
orderedIds 归属/重复/遗漏；`Sidebar.tsx:102` 对任意行允许 `inside`。现有测试（`store.test.ts:141-159`）
仅覆盖自移/子孙，未覆盖类型不变量。结论与报告/opus 一致。

### 10. 文件系统操作与 SQLite 事务非原子 — `确认`（中，删除路径应单独升级为高）
代码核验：`saveNote`（`store.ts:278-293`）atomicWrite 在事务最后，SQL 失败时 DB 回滚、文件未动（相对可控）；
`deleteTreeNode`（`store.ts:307-337`）在事务提交前 `fs.rmSync` 永久删 `.lake` + 整个资源目录——后续 SQL 失败
DB 回滚但文件已不可恢复；`importRemoteNote`（`store.ts:551-580`）先写文件后 upsert DB，同型风险。
同意 opus：此条应区分严重度，删除路径单列为最高优先级。建议先删 DB 记录（可恢复）后清理文件，
或文件先移入回收/暂存区、提交成功后异步清理。

### 11. 远端资源集合缩小不删本地旧文件 — `确认`（中低）
代码核验：`store.ts:551-580` `importRemoteNote` 只 writeFileSync 覆盖/新增。
与第 1 条耦合（assets 被清空 → 旧文件变孤儿 → 再次进入同步流）。结论与报告/opus 一致。

### 12. 孤儿文件删除失败仍报成功 — `确认`（低）
代码核验：`store.ts:416-434` `unlinkSync` 失败被 catch 后仍 `DELETE` + `count++`；
`freedBytes` 仅在成功时累加（字节数无误），但 count/成功语义虚高、失败项丢失不可重试。
建议：仅 ENOENT 或删除成功才删记录/计数。结论与报告/opus 一致。

### 13. Worker 崩溃后仍被复用 — `确认`但需改写描述（低，同意 opus 降级）
代码核验：`src/lib/workerPool.ts:64-79` `handleWorkerError` 已遍历 pendingTasks reject 该 worker 的
in-flight 任务——报告"Promise 永不 settle"作为总括已过时；但崩溃 worker 只置 `busy=false`，
未 terminate/移除，`processQueue`（`workerPool.ts:100-118`）会把后续任务再派给坏 worker；
且 `executeTask` 的 `postMessage` 对已死 worker 可能同步抛错 → 任务留在 pendingTasks 永不 settle。
无 per-task 超时属实。建议改写为"崩溃 worker 未替换 + 无任务超时"，风险 `低`。

### 14. 附件和 Data URL 缺少解码前大小限制 — `确认`（中低，范围需收窄，同意 opus）
代码核验：图片路径**有** 25 MiB 上限（`imageFormat.ts:31`、`store.ts` imageOutput）；
缺口精确在：(a) 非图片附件 `fileToBase64DataUrl`（`resourceUpload.ts:45-62`）无上限；
(b) 非图片 Data URL pass-through（`resourceUpload.ts:80-84`）无上限；
(c) 图片 Data URL 在 `dataUrlInput`（`resourceUpload.ts:146-150`）先 `atob`+`Array.from` 后才进
25 MiB 检查，解码前无长度预检。建议报告按此收窄措辞。

### 15. TOC 延迟水合参数错误 + 全局 DOM — `确认`（低，定位需修正，补全 opus 被截断的结论）
代码核验：
- 报告称 `lakeRuntime.ts:507-515`（scheduleUpdate）"直接传裸函数"——**不准确**：513-514 是箭头闭包，
  正确传入 `host`。
- **真正传裸函数的是 `lakeRuntime.ts:560-561`**（onContentChange 里的 600/1500ms 延迟），
  host 为 undefined → `host.querySelectorAll("ne-card")`（`lakeRuntime.ts:361`）抛 TypeError →
  被函数内 try/catch 静默吞掉 → 这两次水合重试完全无效。（即 opus 未写完的那半句。）
- `refreshTocSidebar`（`lakeRuntime.ts:632`）用全局 `document.querySelectorAll(".ne-toc-sidebar .ne-toc-item")`；
  MultiTabEditor 所有标签同时挂载（隐藏标签 `display:none` 但仍在 DOM），其他标签的 TOC 条目会令
  当前标签提前停止重试 → 偶发大纲不显示。成立。
- 定时器清理：250/500ms（scheduleUpdate）、120/400ms、600/1500ms（onContentChange）、
  refreshTocSidebar 重试均未跟踪/清理，销毁后仍可能执行。成立。
建议：560/561 改箭头闭包 + 统一收集 timeout id 在 cleanup 中清除；refreshTocSidebar 的条目数
改为 `host.querySelector` 限定范围。

## 6 个二次审计重点结论

1. 连续两次同步后 manifest 丢失 assets → **确认**（逻辑推演 + 代码核验；可用 FakeStore 两轮 sync 复现，建议补测试）
2. 墓碑剪除后第三台离线设备恢复已删笔记 → **确认**（需要"删除后 A 再同步一次"的前置；建议补三设备推演测试）
3. 恶意 manifest 的 note.id / asset.filename 逃逸工作区 → **确认**（notePath 零校验 + filename 零校验；
   `path.resolve` 包含性校验缺失；注意 `noteAssetsDirFor` 与 `notePath` 校验不一致）
4. DNS/重定向/renderer 回退绕过 SSRF → **确认**（渲染层回退是刻意设计，`resourceUpload.ts:89-91` 注释为证；
   建议移除回退或对回退施加同等校验）
5. save_note 延迟/乱序响应覆盖最新草稿 → **确认**（代码路径存在；乱序响应在本地 IPC 下概率低，
   但"旧响应覆盖 tab 状态 + dirty=false + 关闭标签"路径无需乱序即可复现）
6. 导航到其他 file:// 或 localhost 页面后 preload IPC 仍可调用 → **确认**（`isTrustedSenderFrame`
   对任意 file:// 与任意 localhost 端口放行，且无 will-navigate 拦截；建议用 electron 的
   `webContents` 归属 + 精确 URL 匹配 + 导航拦截三件套）

## 新增风险条目（原报告未覆盖）

### 16. [中] 本地资产服务器无鉴权且 CORS `*`，任意网站可跨域读取笔记图片
位置：`electron/assetServer.ts:79,116,127,137`
问题：asset server 绑定 127.0.0.1、无任何鉴权，响应带 `Access-Control-Allow-Origin: *`。
用户浏览器访问的任意网页可用 fetch 读取 `http://127.0.0.1:19876/{noteId}/{filename}`（含 `?base64=1`）。
noteId 为 UUID 不易枚举，但 welcome-note 等固定 ID、路径泄露或猜测可达；笔记图片可能含敏感内容。
建议：增加随机 token 校验（URL 带 token 或校验 Origin），或至少限定允许的来源。

### 17. [中] `notePath` 未校验使 IPC 可直接读写工作区外文件（与 3/6 叠加）
位置：`electron/store.ts:155,220,280`
问题：`save_note`/`read_note` 的 id 参数直接进 `notePath`（`path.join(root/notes, id.lake)`），
零校验。任何"受信"页面（见第 6 条）可读任意 `.lake` 文件、覆盖任意 `.lake` 命名文件。
即使不做 manifest 攻击也可利用。建议在 `notePath` 内统一做单路径段校验 + 包含性校验。

### 18. [低] 移动/重排两步 IPC 非原子
位置：`src/App.tsx:236-254`
问题：`moveTreeNode` 与 `reorderTreeNodes` 是两次独立 IPC，中间崩溃/异常会留下
parent 已改但 sortOrder 未更新的不一致树。建议合并为单个原子 IPC（同第 9/10 条修复一并做）。

### 19. [低] 远程 manifest 无 schema 校验的健壮性缺口
位置：`electron/sync.ts:127-130`
问题：`JSON.parse` 后只检查 `version`，`notes` 非数组/字段缺失会抛运行时错误或写入脏数据；
`workspaceId` 未校验（其他工作区清单会被导入 default）。属第 3 条 schema 校验的一部分。

### 20. [低] 删除后经云端恢复的墓碑残留与重复导入不清墓碑
位置：`electron/store.ts:307-337`、`electron/sync.ts:250-262`
问题：下载到 deleted 标记时 `deleteTreeNode` 会再写墓碑，但该 id 不在本次 manifestNotes 中 →
`pruneTombstones` 不剪除，墓碑持续累积；本地重建同名笔记后墓碑永久残留（无害但膨胀）。
建议：同步删除路径用不写墓碑的删除，或按 id 剪除。

### 21. [低] `upload_resource` IPC 输入侧无大小限制
位置：`electron/main.ts:95` → `store.ts:585`
问题：renderer 可传任意大 `number[]`，IPC 序列化复制到主进程后才在 `imageOutput` 做 25 MiB 校验，
超大数组仍会造成主进程内存峰值。建议 IPC 层预检长度。

### 22. [低] `detectOrphans` 在保存事务外执行，异常误报保存失败
位置：`electron/store.ts:293`
问题：`saveNote` 事务已提交后 `detectOrphans`（statSync/readdir）抛错会让渲染层显示"保存失败"，
但数据实际已写入，状态与事实不符。建议 try/catch 隔离孤儿检测。

### 23. [低] 窗口/应用关闭无保存兜底，脏标签草稿可丢失
位置：`src/App.tsx`（全文件无 beforeunload/unload 处理）、`src/main.tsx`
问题：防抖 800ms 未触发或保存 in-flight 期间关闭窗口（macOS 红点关闭即销毁渲染层与定时器），
脏标签内容直接丢失。建议：window `beforeunload` 时同步 flush 脏标签（或提示）。

## opus4.8 评审状态说明

- 已收到：第 1–14 条结论完整（1/2/3/4/5/6/7/8/9/10/11/12/14 为确认（含严重度与定位修正），
  13 为部分误报→降级为低，15 的结论被截断）。
- **第 15 条被截断**（停在"真正传裸函数、导致 host 为 undefined…的是"）——本次已由我方补全判断：
  裸函数在 `lakeRuntime.ts:560-561`（onContentChange 的 600/1500ms），而 513-514 是正确闭包。
- 无其他 opus 章节写入报告；若后续收到完整版，可对照更新本节的 7/8/13/14/15 细节。

---

# 修复状态（2026-08-03，分支 `fix/audit-2026-08-03`）

> 依据上述二次审计判断实施修复；未直接改 master。验证：tsc 通过、vitest 82→100 用例全绿、
> Playwright 驱动真实 Electron 实测（SSRF 矩阵/导航拦截/CORS 门控/多标签 TOC）。

| 条目 | 结论 | 修复 |
|---|---|---|
| 1 同步清空资源清单 | 确认(高) | ✅ 恒重扫资源清单 + 新增回归测试 |
| 2 墓碑只保留一次同步 | 确认(高) | ✅ 墓碑永久保留 + 学习墓碑 + 三设备测试 |
| 3 manifest 目录穿越 | 确认(高) | ✅ notePath/资产文件名统一校验 + schema 校验 + sync fail-fast |
| 4 远端资源无完整性校验 | 确认(高) | ✅ 缺失即中止 + size/hash 校验 |
| 5 SSRF 可绕过 | 确认(高) | ✅ DNS 感知校验 + net.request 逐跳校验 + 移除渲染层回退 |
| 6 IPC 来源过宽 + 无导航拦截 | 确认(高) | ✅ 精确 URL + webContents 白名单 + will-navigate/窗口拦截 |
| 7 自动保存覆盖新编辑 | 确认(中偏高) | ✅ revision 保护 |
| 8 移动端旧快照 | 确认(中低) | ✅ persistMobile 同步 mobileActive/草稿 |
| 9 树结构不变量 | 确认(中) | ✅ 类型不变量 + reorder 完整性校验 |
| 10 FS 与 SQLite 非原子 | 确认(中/删除高) | ✅ 删除 DB-first + import staging |
| 11 远端资源集合缩小不删本地旧文件 | 确认(中低) | ✅ 导入后按正文引用对账标记孤儿（本地保留当回收站、不再上传） |
| 12 孤儿删除失败仍报成功 | 确认(低) | ✅ 失败保留记录可重试 |
| 13 Worker 崩溃后复用 | 降级(低) | ✅ terminate+替换 + 60s 超时 |
| 14 附件/Data URL 无解码前上限 | 确认(中低) | ✅ 附件 25MiB + Data URL 解码前预检 |
| 15 TOC 延迟水合参数错误 | 确认(低) | ✅ 裸函数修正（560-561）+ 定时器清理 + host 限定 |
| 16 资产服务无鉴权 + CORS `*` | 新增(中) | ✅ Origin 门控 |
| 17 notePath 未校验 IPC 直读写 | 新增(中) | ✅ 随 #3 一并修复 |
| 18 移动+重排两次 IPC 非原子 | 新增(低) | ✅ move_tree_node_ordered 单事务 |
| 19 manifest 无 schema 校验 | 新增(低) | ✅ 随 #3 一并修复 |
| 20 同步删除路径墓碑残留 | 新增(低) | ✅ 随 #2 一并修复 |
| 21 upload_resource IPC 无大小预检 | 新增(低) | ✅ main 层预检 |
| 22 detectOrphans 事务外抛错 | 新增(低) | ✅ saveNote 隔离 |
| 23 无 beforeunload 兜底 | 新增(低) | ✅ 脏标签阻止关闭 + 尽力 flush |

**遗留（有意未修）**：S3 对象累积回收（GC）待立项（已同步图片删除后对象永久留存，需 manifest 墓碑 + 安全剪枝）；
#15 中 refreshTocSidebar 的重试定时器未纳入统一清理（editor 销毁后最多空跑 8 次，有 try/catch 兜底）。

> 补充（用户反馈后追加）：`uploadResource`/`downloadRemoteResource` 已改为**写盘即登记孤儿**（保存时按正文引用撤销），
> 杜绝「未登记孤儿就被同步上传」导致的 S3 无用文件累积；`importRemoteNote` 导入后按正文引用对账（#11 修复）。
