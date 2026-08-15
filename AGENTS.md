# Lake Notes Electron — 项目记忆（AGENTS.md）

> 本文件是本项目的**长期记忆**，每次会话自动加载。开始工作前先读本文 + `Electron-HANDOFF.md`（会话交接，含最新进度）+ `docs/TODO.md`。
> 用户反复强调的背景与原则都写在这里，**不要等用户重复**。

## 1. 项目是什么

Lake Notes 是**本地优先**笔记应用（Electron + React + better-sqlite3 + 语雀 Lake 内核），带 S3 同步（七牛 Kodo S3 兼容 API）。**本地是真相，S3 只是镜像。**

- 目录：`/Users/admin/file/local-lake/lake-notes-electron`
- 当前分支：`feat/s3-storage-rw-delete`（**未合并 master，用户未验收不合并、不擅自提交**）
- Node：**必须优先 Node 24**：`$HOME/.nvm/versions/node/v24.18.0/bin`
- Electron：33.4.11（升级 42 已列入 TODO，**排期在删除链路验收之后**）

## 2. 当前阶段目标与排期

- **当前焦点：多端删除链路完整测试**（软删 → 恢复 → purge → GC 对账 → 深度清理 → 小记删除），四层验证：UI / 本地 DB+文件 / 云端对象（`scripts/s3-ls.mjs`）/ 两端日志。
- 删除链路验收之后：Electron 升级 33 → 42（直接升级、不过度适配）。
- 验收通过后：提交 `docs/S3-GC-DESIGN.md`、`HISTORY-DESIGN.md`、`TODO.md`、`Electron-HANDOFF.md` 及全部代码，再谈合并。

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

## 4. 关键机制速览（同步）

- 冲突四分支在 `electron/sync.ts` 下载阶段；`baseHash + lastUploadedHash` 存本地 `sync_base`，**绝不上 manifest**。
- `supersededNotes`：本地改动被远端覆盖时先强制 `createHistorySnapshot` 留档再接受远端。
- `folders[]` 必填；手动同步只发回触发窗口；自动同步广播所有窗口。
- 同步/GC/深度清理共用 `enqueueMaintenance` 串行队列（进程内唯一必需互斥）。
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
npm test -- --run          # 基线 188；当前 197
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

1. 读本文件 + `Electron-HANDOFF.md`（最新进度与待办）+ `docs/TODO.md`。
2. 查 `git status`/`git log` 确认当前状态；`vite.config.ts` 不应有改动（除非多端调试中的 onstart 补丁）。
3. 需要用户确认产品语义时，给出选项和推荐，但**当前删除/恢复语义已定稿**（见 §3），不要重新争论。
