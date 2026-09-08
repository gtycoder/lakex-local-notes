# Lake Notes Electron — 项目记忆（AGENTS.md）

> 本文件是本项目的**长期记忆**，每次会话自动加载。开始工作前先读本文 + `HANDOFF.md`（会话交接：当前状态与真正的待办）+ `docs/TODO.md`。
> 用户反复强调的背景与原则都写在这里，**不要等用户重复**。
> **本文只写长期内容**（红线/机制/坑）：分支名、commit hash、测试计数、当前焦点等易过期事实一律放 `HANDOFF.md` §0。

## 1. 项目是什么

Lake Notes 是**本地优先**笔记应用（Electron + React + better-sqlite3 + 语雀 Lake 内核），带 S3 同步（七牛 Kodo S3 兼容 API）。**本地是真相，S3 只是镜像。**

- 目录：`/Users/admin/file/local-lake/lake-notes-electron`
- 开发分支：`master`（唯一持续演进的业务分支；历史分支一律已合入并删除，勿基于它们开发）
- Node：**必须优先 Node 24**：`$HOME/.nvm/versions/node/v24.18.0/bin`
- Electron：43.4.0；better-sqlite3 13.x（N-API 单二进制、无需 rebuild；双 ABI 基建已随 43 升级删除）
- **目标数据量级**：压测做到 **10 万文档 / 100 万附件**（≈100k notes / 1M assets）。性能与同步决策按此量级验证，**勿用"小库正常"下结论**；同步/搜索/GC 相关改动的预期场景均以此为准。

## 2. 长期方向与文档分工

- **长期焦点**：同步/存储热路径的性能与健壮性、移动端编辑收口、可维护性（安全、IPC、资源服务、渲染层职责、测试覆盖、大文件按领域分批拆）。
- **具体待办与优先级只在 `HANDOFF.md` §3 维护**；`docs/TODO.md` 是历史总表（会过期），与 HANDOFF 冲突时以 HANDOFF 为准。
- 删除/恢复语义与 Electron 43 升级均已验收，后续改动必须保持现有同步语义（§3 原则 1~13）与全绿门禁。
- 先修 Critical/Warning，再按模块拆分大文件；不在没有测试护栏的情况下进行大规模架构重写。
- **文档分工（防漂移）**：`AGENTS.md`=长期红线/机制/坑（不写易过期事实）· `README.md`=项目概览（不维护进度/计数）·
  `HANDOFF.md`=唯一交接（当前基线/待办/本轮踩坑）。历史上本文件曾长期残留旧分支名与 188/217 测试计数，已清理，**不要写回去**。

## 3. 核心设计原则（用户反复强调，务必遵守）

1. **本地是真相，S3 只是镜像**：数据不丢由本地保证（回收站软删保留文件、历史快照、恢复标记），S3 仅用于多端同步。
2. **目录强一致性是 S3 同步的基础**：删除必须传播到所有端（墓碑权威）。
3. **墓碑权威（删除压编辑）**：A 删除后，B 的编辑**无论早于还是晚于删除**都抵抗不了墓碑——B 跟随删除。理由：删除意味着该文档被判定为错误/无效，继续编辑是在错误方向上工作。被删设备的本地编辑**强制留档**（历史快照，Lake）；小记**不备份**（随手记语义，丢了就丢，云端为主，不搞复杂机制）。
4. **恢复是唯一显式例外**：用户从回收站恢复 = 明确撤销删除 → 写入恢复标记（`notes.restore_pending_at`，小记 `quick_notes.restore_pending_at`）→ 同步时 local-wins，上传 active 覆盖墓碑并传播给其他端。恢复标记在 `markSynced` 时清除（绝不能残留，否则墓碑永胜失效）。
5. **墓碑携带删除前内容**：墓碑条目 `contentHash` 填**真实 hash**（删除方软删保留 `.lake`，同步时读文件算 hash + 上传对象）。其他设备下载时**先拉删除前内容再应用墓碑**（先内容、后标志）→ 回收站/恢复拿到的是删除方最新编辑版。旧墓碑（占位符 contentHash）靠容错下载天然兼容（对象不存在则跳过），无需判断占位符形态。
6. **同步顺序**：先拉远端（带冲突判定地合并）→ 推合并后的本地。墓碑是标志，内容照常走同步路径。
7. **当前开发版本不考虑数据兼容问题**：开发版数据可删除重建，不做迁移/兼容层，不做"为了历史数据"的过度设计。用户原话：*"这是开发版，不要考虑数据兼容问题，大不了删除所有数据。数据问题不是我们这个阶段考虑的问题。"*
8. **KISS/DRY/SOLID**：优先最简单可靠的实现；不引入未经验证的抽象；用已有依赖解决，不随意加依赖；不过度设计（小记不搞备份机制就是例子）。
9. **多表写必须用事务**：`this.db.transaction(() => {...})`。已审计修复：`restoreHistory`、`applyRemoteNoteMeta`、`markSynced`。
10. **永远不要为旧数据写冗余代码**：开发阶段的脏数据/坏数据（如某次 bug 写坏的文档内容）**直接删掉重建**，不写任何"兼容/修复/容忍旧数据形态"的代码——不做展示层兼容、不做格式迁移、不判断占位符形态。理由：数据可删可重建（见第 7 条），为旧数据写兼容代码只会引入复杂度与新的错误面。判断标准：**先问"这些数据能不能删了重新生成？"——能，就绝不写兼容**。用户原话：*"永远不要为旧数据写冗余代码，我们这个阶段根本不需要。"*
11. **资产存在性判定 = 远端清单声明差集（对齐思源 dejavu），禁止逐对象 HEAD/GET 探测、禁止本机陈旧缓存**：同步下载时已拿到远端 latest 清单，其 `notes[].assets` 就是「云端当前被引用集」的权威快照（发布顺序=先对象后清单；GC 只删「未被任何在留清单引用的键」+ 年龄保护）。⇒「清单声明该资产」即「云端存在且未被删」。上传只对「清单未声明的缺失资产」做 PUT，但 `manifest.assets` 仍**全量声明**（裁剪声明 → 他端 GC 把在用资产误判未引用而删）。**禁止**退回每对象 HEAD（实测 churn 同步因此 14s 空转、真实云首传 18s）；**禁止**「本机记过=已上传」的持久缓存（GC 可能删过该对象 → 缓存失真 → 破坏跨端自愈，这正是当年去掉缓存的原因）。
**两个外部前提（协议契约外，按红线不写检测、仅记录）**：① 无带外删除——不绕过本协议手工删/生命周期规则删云端对象（若发生，latest 仍声明但对象已失，属契约外）；② 资产按 filename 内容寻址——skip 只比对 `assets/{noteId}/{filename}` 是否已声明、不校验云端字节，靠 `buildAssetFilename`（时间戳+hash 前缀）保证「同名即同内容」。
对称地，**下载侧同样走差集**：`downloadNoteAssets` 按本地实扫的 size+sha256 跳过已持有资产；`active→trash` 跟随删除仅在**实读正文 sha256 相等**时复用本地、否则 GET 自愈——两处都验真实字节、不盲信 `contentHash` 缓存（`localHashOf` 对 synced 走 baseHash 缓存不读盘）。
12. **兜底"未分类"笔记本只惰性创建**：系统无默认笔记本；仅当某笔记**真正回落到兜底父**时才 `resolveDefaultNotebook()` 创建（本轮至多一次）。**禁止**在下载阶段开头无条件 `defaultNotebookId()`（旧实现导致空库同步即使 `downloaded=0` 也凭空创建并上传"未分类"）；冲突探测等"最终可能不应用"的路径**不得**解析兜底父。
13. **S3 并发上限 = 8（七牛建议）**：峰值并发 PUT = `NOTE_UPLOAD_CONCURRENCY(2) × ASSET_CONCURRENCY(4) = 8`；正文对象 `UPLOAD_CONCURRENCY(4)`、下载 `ASSET_CONCURRENCY(4)` 各自 ≤8 且与资产阶段串行、不叠加。**不得**为吞吐调到 16+（日常用不到、易触七牛限流）。
14. **设置面板与浮层一律走「精仿思源」版式语法，禁止再写内联样式**：思源组件 SCSS 已 vendored 且随 `src/main.tsx` 加载（`src/b3/siyuan.scss` → `src/b3/siyuan/{util,component}`，AGPL-3.0 已在文件头署名），可直接用的类：`.b3-list`/`.b3-list-item`(+`__text/__meta/__graphic/__action`/`--hide-action`/`--background`)、`.b3-label(+__text)`、`.b3-text-field`、`.b3-select`、`.b3-switch`、`.b3-button(+--outline)`、`fn__*`/`ft__*` 工具类。设置页骨架（分组标题在灰卡外、卡内一行一项、控件右对齐固定 200px、行间 1px 分隔）在 `src/b3/siyuan/business/_config.scss`：`.config-group/.config-title/.config-items/.config-item/.config-name/.config-block/.config-readonly/.config-stats/.config-assets/.config-empty`。**新 UI 先查上面两张表有没有现成件**；没有再往 `overlays.css` 的「浮层通用件」补（`ln-tabs(+__track)/ln-toolbar/ln-row2/badge(--warn/--error/--muted/--accent)/seg/checks/panel-title/ln-close/ln-empty`），**不要**在组件里写 `style={{...}}`，也不要再造第四套 `settings-*` 视觉类。颜色/圆角只用 `--b3-*` / `--lake-*` 令牌（深浅主题才跟得上）。**设置页每加/改一行都要同步 `settingsSearch.ts` 的 `SETTING_ITEMS`**（行原语带 `itemId` → `data-set-id`，支撑条目级搜索定位；漂移有单测卡住，改完跑 `vitest src/components/settingsSearch.test.ts` 即知）。**横向 tab 一律分段控件**（轨道 + 浮起白段），只给选中项灰底会被判读成「看不出这是 tab」。搜索面板、同步 popover、小记工作台已在该套上；新界面别再引入第四套。

15. **"已彻底删除"的判定必须永久**：`deleted_notes.purged_at` 只是"待删 S3 前缀"的工作标记，前缀删完就被 `markPurgeSynced()` 清空——**不能**拿它当"这条已被 purge"的依据（否则陈旧清单会把它重新导入/让子文档挂到不存在的父下，产生侧栏看不见却仍在同步与占资源的"幽灵文档"）。永久口径：folder 看 `deleted_notes` 是否存在 `node_type='folder'` 墓碑；note 看其墓碑。purge 时**无条件**写墓碑（`notes` 行缺失就从 `tree_nodes` 兜底取元数据），漏写等于云端永不下架、必然复活。`runDataHealthCheck` 的 `treeDanglingParent` 就是查这类节点。

16. **任何打开文档的入口都必须先判定"是否已进回收站/被他端 purge"**：统一用 `src/core/syncDecisions.ts` 的 `isGoneNote({parentId, syncState})`（parentId=TRASH 或 syncState='purged'）。命中则标签页以 `deleted` 打开 → 编辑器只读（复用 `EditorTab.locked` 的 viewer 模式）+ 顶部横幅提示 + 保存被拦时明确提示，**绝不允许静默丢弃编辑**。恢复走 `handleTrashRestored`（重载正文并清标记）。历史上这个守卫只在同步刷新路径里跑，导致重启自动重开"最后文档"时回收站文档可编辑可保存（2026-09-04 用户报）。

## 4. 关键机制速览（同步）

- 冲突四分支在 `electron/sync.ts` 下载阶段；`baseHash + lastUploadedHash` 存本地 `sync_base`，**绝不上 manifest**。
- `supersededNotes`：本地改动被远端覆盖时先强制 `createHistorySnapshot` 留档再接受远端。
- `folders[]` 必填；手动同步只发回触发窗口；自动同步广播所有窗口。
- 同步/GC/深度清理共用 `enqueueMaintenance` 串行队列（进程内唯一必需互斥）。
- 资产上传差集：`scanLocalAssets(cfg,s3,db,noteId,stats,cloudDeclaredFilenames)`，`cloudDeclaredFilenames` = 本笔记在**已下载远端清单**里声明的 `assets[].filename`；缺省/为空（新笔记、桶重置 rn=null）→ 全量上传。跨笔记并发：决策环登记 `assetTasks`，环后 `runPool(NOTE_UPLOAD_CONCURRENCY=2)` 回填 `entry.assets`（语义与串行逐字节一致，由 syncEquivalence/syncDualAB 保证）。见原则 11/12/13。
- manifest commit 链保留 `MANIFEST_CHAIN_KEEP=3`（设计 D4 O(3)），prune/gc-reconcile/deep-cleanup 三者共用、滞后裁剪（水位超过 target+SLACK 才裁），活动对象恒在 latest 全量快照内、被降级旧键靠本地历史 refs + 7 天年龄保护 + 重新引用撤销 pending 兜底。
- 小记独立前缀 `quick-notes/` + 独立小记库 `quick-notes/metadata.sqlite3`。

## 5. 数据路径与安全

| 项 | 路径 |
| --- | --- |
| 开发数据 | `/Users/admin/Library/Application Support/lake-notes-dev`（可重建） |
| 正式数据 | `/Users/admin/Library/Application Support/lake-notes-electron`（**禁止触碰**） |
| B 端开发数据 | `$TMPDIR/lake-device-b` |
| 日志 A | `~/Library/Application Support/lake-notes-dev/logs/lake-notes.log` |
| 日志 B | `$TMPDIR/lake-device-b/logs/lake-notes.log` |
| 只读检查 DB | `workspace-default/metadata.sqlite3`（小记 `workspace-default/quick-notes/metadata.sqlite3`） |

## 6. 关键命令

```bash
export PATH="$HOME/.nvm/versions/node/v24.18.0/bin:$PATH"
cd /Users/admin/file/local-lake/lake-notes-electron
npx tsc --noEmit
npm test -- --run          # 必须全绿；当前计数看 HANDOFF §0 或直接跑，别写死进文档
node node_modules/vite/bin/vite.js build
git diff --check

# 多端（vite 必须 tty=true 长驻；electron 手动前台 tty=true）
#   A: ./node_modules/.bin/electron --disable-gpu --remote-debugging-port=9222 .
#   B: LAKE_USER_DATA="$TMPDIR/lake-device-b" LAKE_ASSET_PORT=19877 ./node_modules/.bin/electron --disable-gpu --remote-debugging-port=9223 .
#   （启动前临时给 vite.config.ts 的 electron 入口加 onstart: () => {}，备份为 vite.config.ts.multidev-bak；结束必须还原）

node scripts/s3-ls.mjs --count | --note <id> | --prefix <prefix>   # 云端对象查看
```

## 7. 踩坑记录（务必记住）

### 环境 / 进程
1. vite dev server 会被 exec 会话回收：必须长驻 tty（`tty=true`）。vite-plugin-electron 会自动拉起 electron，手动控端前临时加 `onstart: () => {}`，验证完必须还原。
2. 单实例锁按 userData 隔离；资源端口 A=19876、B=19877。
3. 结束 electron 只能 kill 具体 PID，**不要 `pkill -f Electron`**（机器上还有 SiYuan/VSCode/Trae）。

### 七牛 S3
4. `ObjectStore.test()` 必须用 ListObjectsV2（七牛 HeadBucket 对存在的桶也返回 404）。
5. 正确配置：Endpoint=`https://s3.cn-north-1.qiniucs.com`、Region=`cn-north-1`、Bucket=`local-lake-hebei`、`forcePathStyle=false`。

### 同步 / 代码
6. 同步完成必须广播 `sync-progress`，否则打开 tab/状态栏/小记列表不刷新。
7. `markSynced` 只改 notes 不够：`tree_nodes.sync_state` 也要改（状态栏读它）。
8. `contentCache` 会导致冲突后 tab 不刷新：`reloadKey` 变化时先清缓存。
9. IPC 三处同步：`main.ts`(handle) + `preload.cjs`(invoke) + `src/lib/native.ts`(类型+封装)。
10. **变量 shadow 坑**：同步函数里外层 `remote` 是 ObjectStore，循环内若再 `const remote = remoteById.get(...)` 会 shadow 掉它，导致 `remote.put is not a function`。改名 `remoteNote`/`remoteItem`。

### 日志 / 构建
11. electron-log 必须 external：`vite.config.ts` electron 入口 `rollupOptions.external` 写 `/^electron-log/`。
12. Electron 33 的 `console-message` 事件签名是 `(event)`（`event.message`），logger 已兼容。
13. better-sqlite3 是 Electron ABI 编译，系统 Node 24 跑不了；bench 等用 python3 sqlite3 代替。
14. vitest 下 electron-log 要静音（`process.versions.electron` 不存在时关 transports）。

## 8. 会话启动指引

1. 读本文件 + `HANDOFF.md`（当前状态与真正的待办）；`docs/TODO.md` 按需（历史总表）。
2. 查 `git status`/`git log` 确认当前状态，并 **`git worktree list`** 检查有无未记录的在途 worktree 改动（2026-09-03 就漏看过一次）；
   `vite.config.ts` 不应有改动（除非多端调试中的 onstart 补丁）。
3. 需要用户确认产品语义时，给出选项和推荐，但**当前删除/恢复语义已定稿**（见 §3），不要重新争论。
