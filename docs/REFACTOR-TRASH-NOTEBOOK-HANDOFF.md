# 隐藏回收站笔记本重构 — 交接文档（写给全新会话）

> 本文档是**重构任务的完整交接**：起因、经过、结论、原则、计划、怎么做。
> 全新会话开始前必读：本文档 + `AGENTS.md`（项目长期记忆）+ `Electron-HANDOFF.md`（当前分支状态）+ `docs/S3-GC-DESIGN.md`（现有 GC 设计）。
> 项目目录：`/Users/admin/file/local-lake/lake-notes-electron`（分支 `feat/s3-storage-rw-delete`，**已提交、未合并 master**）

---

## 0. 一句话目标

把"删除"从一种**特殊状态**（墓碑机制）重构为**一次普通树操作**（移入/移出隐藏回收站笔记本），统一同步逻辑，同时根治当前墓碑机制的多个补丁和缺陷。

---

## 1. 起因：删除/回收站/GC 机制的演进（经过）

### 1.1 第一代：墓碑机制（当前分支已实现，约 7 个补丁）

为支持多端删除，当前分支实现了完整墓碑机制，但**每个需求都是打补丁**：

| # | 补丁 | 解决的问题 |
| --- | --- | --- |
| 1 | 墓碑权威（远端 deleted 压本地编辑） | 删除传播（目录强一致） |
| 2 | 恢复标记 `restore_pending_at` | 恢复是唯一显式例外（local-wins） |
| 3 | 墓碑携带正文 `contentHash` | 恢复 = 删除方最新编辑版 |
| 4 | 墓碑携带资源列表 → **改为前缀保护** | 软删资源不被 GC 误删 |
| 5 | B 端 `list assets/{id}/` 补全 | B 回收站资源完整 |
| 6 | 恢复传播 revoke（远端 active → 本地跟随） | B 恢复后 A 跟随 |
| 7 | GC 墓碑 keep 保护 | 软删资源/正文对象不被清理 |

**关键缺陷**（测试中发现）：
- **情况 3 缺陷**：B 从未持有该文档（离线期间 A 删除）→ B 只学到墓碑，本地无内容 → **B 无法恢复**（回收站无节点、无资源）
- 墓碑"永久保留"（审计 #2 防复活）→ `deleted_notes` + manifest 墓碑日积月累膨胀（量级可控，但无保留期策略）
- purge 是"本端彻底删除"不广播 → 其他端回收站独立保留、可恢复 → 恢复后全端复活（语义不彻底）
- 补丁间交互产生边界 bug（如"本端 purge 后远端恢复 → 本端同步崩"，已修）

### 1.2 第二代：用户的洞察（重构方向）

用户在讨论中提出核心洞察：**"云端回收站"本质就是一个隐藏的、只读的笔记本**。

> 删除 = 把文档移入隐藏回收站笔记本；恢复 = 移回原位置。所有逻辑（资源、GC、情况 3、冲突）都变成普通笔记本同步逻辑，**全部有迹可循**。

这个视角下，第一代墓碑机制的 7 个补丁全部收敛为：**删除/恢复 = parentId 移动**（复用现有树同步 + superseded 冲突分支）。

---

## 2. 重构方案：隐藏回收站笔记本（删除 = 移动语义）

### 2.1 核心模型

| 状态 | 当前机制 | 重构后 |
| --- | --- | --- |
| 正常文档 | 普通条目（parentId=普通笔记本） | 不变 |
| **软删文档** | `deleted:true` 墓碑 + 恢复标记 + 前缀保护 | **`parentId` = 隐藏回收站笔记本**，正常条目（contentHash + assets 完整），走正常同步/下载/GC |
| **purge 文档** | 墓碑保留（deleted 标记） | 从 manifest 移除条目 + 删云端对象 + **保留轻量墓碑**（防复活） |

### 2.2 白送的好处（重构的收获）

1. **情况 3 自然解决**：B 从未持有 → 同步隐藏笔记本 → 正常下载内容+资源到 B 回收站 ✅
2. **资源完整性自然**：回收站条目带 assets 列表 → 现有下载/keep 机制处理，不需要前缀保护 hack ✅
3. **墓碑权威自然**：删除压编辑 = 远端移动 + 本地编辑留档（现有 superseded 冲突分支）✅
4. **恢复传播自然**：恢复 = 移出回收站 = parentId 更新 → 同步传播 ✅
5. **恢复标记可删除**：`restore_pending_at` 整个机制不再需要（移动不是删除，没有墓碑压恢复问题）✅
6. **GC 自然**：回收站条目 assets 在 keep 集 ✅

### 2.3 必须解决的设计问题（已讨论定稿）

| 问题 | 决策 |
| --- | --- |
| **恢复原位置** | 需要 `deletedFromParentId`（删除前 parentId）**上云**（manifest 字段或独立同步），保证 B 恢复位置与删除方一致（目录强一致）。仅存本地 sqlite 不够（B 不知道 A 的原位置）。 |
| **purge 防复活（审计 #2）** | purge 从 manifest 移除条目后，**必须保留轻量墓碑**（deleted 标记，可带 purged 标记）→ 离线设备 B 上线看到墓碑 → 删本地，不把残留当新文档上传。否则 A 彻底删除的文档在 B 上线时复活（实测过当前机制防住、重构必须保留此墓碑）。 |
| **manifest 体积** | 回收站条目是完整条目（contentHash + assets），体积比墓碑大。用户决策：**可接受**——普通笔记本的文档同样占 manifest，这是"回收站可完整恢复"的必然成本（不累积：反复删除每次替换为最新版）。配套：**回收站保留策略**（自动过期，当前 `trashAutoPurgeDays` 仅提醒不自动删，重构时做成真正的自动过期）防无上限增长。 |
| **回收站只读** | 用户决策：**不做严格约束**——回收站 UI 只渲染标题+时间（不渲染文档），天然只读；同步侧异常编辑是防御性问题，可接受。 |
| **原位置上云承载** | sqlite 是本地落盘，跨端一致性需要同步承载（manifest 字段 `deletedFromParentId`）。实现细节重构时定。 |

### 2.4 复杂度对比（付出 vs 收获）

- **当前机制**：7 个补丁（墓碑权威/恢复标记/墓碑带内容/前缀保护/B 端 list/恢复传播/GC 保护）
- **重构后**：1 个移动操作 + 2 个必要机制（purge 墓碑防复活 + deletedFromParentId 上云）

**收获 > 付出**：一次性重构（约 2-4 天 + 测试重写）换取长期维护复杂度显著下降，且情况 3 和资源完整性是白送的。

---

## 3. 核心原则（用户反复强调，重构必须遵守）

1. **本地是真相，S3 只是镜像**：数据不丢由本地保证（回收站/历史/恢复），S3 仅多端同步。
2. **目录强一致性是 S3 同步的基础**：删除必须传播到所有端；恢复位置也要强一致（deletedFromParentId 上云的原因）。
3. **墓碑权威哲学**：删除意味着该文档被判定为错误/无效，任何端（无论编辑早晚）继续编辑都是在错误方向上工作——删除才对。被删设备的编辑**强制留档**（历史快照，Lake）；小记**不备份**（随手记语义，云端为主，丢了就丢，不搞复杂机制）。
4. **恢复是唯一显式例外**：用户从回收站恢复 = 明确撤销删除 → 必须能传播给所有端。
5. **当前开发版不考虑数据兼容**：开发版数据可删除重建，不做迁移/兼容层。用户原话："这是开发版，不要考虑数据兼容问题，大不了删除所有数据。"
6. **KISS/DRY**：优先最简单可靠的实现，不引入未经验证的抽象，不过度设计。
7. **多表写必须用事务**：`this.db.transaction(() => {...})`。

---

## 4. 实施计划（建议顺序）

> 排期：当前分支已提交（`feat/s3-storage-rw-delete`），重构**另起独立分支**实验（建议 `feat/trash-notebook`）。

1. **设计落地**：先更新 `docs/S3-GC-DESIGN.md` 或新建设计文档，把 2.3 的设计决策写清楚（deletedFromParentId 上云格式、purge 墓碑标记、回收站保留策略）
2. **manifest 扩展**：folders 加隐藏回收站笔记本（标识，如 `nodeType:"trash"`）；条目支持 `deletedFromParentId`
3. **store 层**：删除 = 移动（update parentId + 记录 deletedFromParentId）；恢复 = 移回；回收站 = 读隐藏笔记本；purge = 移除条目 + 本地记录待删对象
4. **sync 层**：移除 deleted 墓碑特殊分支/恢复标记/墓碑内容/前缀保护，统一为树移动 + 现有冲突；purge 墓碑（轻量）保留
5. **GC**：回收站条目自然 keep；purge 待删对象处理；对账/深度清理适配
6. **UI**：回收站面板改读隐藏笔记本；删除/恢复按钮改移动语义
7. **测试**：现有墓碑测试重写为移动语义；新增情况 3、purge 防复活、恢复位置强一致、两端 purge 后对象清理等用例
8. **验证**：tsc + 全量测试 + build + A/B 多端联调（软删/恢复/purge/GC 全链路）

**验证清单**（沿用上一轮 GC 测试方法论，见 `docs/GC-TEST-REPORT.md`）：
- 四层验证：UI / 本地 DB+文件 / 云端对象（`scripts/s3-ls.mjs`）/ 两端日志
- 必测场景：软删传播、B 从未持有（情况 3）恢复完整、恢复位置跨端一致、purge 防复活（离线 B 不复活）、两端都 purge 后云端对象清理、回收站条目资源完整

---

## 5. 当前分支状态与关键信息

### 5.1 git 状态
- 分支：`feat/s3-storage-rw-delete`，**已提交**（含删除链路 + GC + 前缀保护 + 本轮 bug 修复），**未合并 master**
- 提交内容：30+ 文件（sync/store/quickNotes/main/preload/native/UI/测试 + 文档 AGENTS.md / GC-TEST-REPORT.md / S3-GC-DESIGN.md）
- 未提交（**不要提交**）：`Electron-HANDOFF.md.bak-*`（备份）、`hist-bench-tmp.mjs`（临时 bench）
- `vite.config.ts` 只有 electron-log external 合法改动（onstart 临时补丁已还原）

### 5.2 测试基线
- `npm test -- --run` = **199 passed**；`npx tsc --noEmit` 通过；`node node_modules/vite/bin/vite.js build` 通过；`git diff --check` 干净

### 5.3 数据路径
| 项 | 路径 |
| --- | --- |
| 开发数据 A | `/Users/admin/Library/Application Support/lake-notes-dev`（可重建） |
| 正式数据 | `/Users/admin/Library/Application Support/lake-notes-electron`（**禁止触碰**） |
| B 端 | `$TMPDIR/lake-device-b` |
| 日志 A/B | `~/Library/Application Support/lake-notes-dev/logs/lake-notes.log` / `$TMPDIR/lake-device-b/logs/lake-notes.log` |

### 5.4 关键命令（多端）
```bash
export PATH="$HOME/.nvm/versions/node/v24.18.0/bin:$PATH"
cd /Users/admin/file/local-lake/lake-notes-electron
# A: ./node_modules/.bin/electron --disable-gpu --remote-debugging-port=9222 .
# B: LAKE_USER_DATA="$TMPDIR/lake-device-b" LAKE_ASSET_PORT=19877 ./node_modules/.bin/electron --disable-gpu --remote-debugging-port=9223 .
#   （vite 必须 tty=true 长驻；临时 onstart 补丁用完必须还原，bak 勿提交）
node scripts/s3-ls.mjs --count | --note <id> | --prefix <prefix>
```

### 5.5 测试驱动工具
- CDP 执行渲染层 API：`node /tmp/lake-cdp-eval.mjs <port> "<async expression>"`（`window.lakeNative.*` 可操作创建/删除/回收站/同步/GC）
- 只读 DB：python3 sqlite3（better-sqlite3 是 Electron ABI，系统 Node 跑不了）
- S3 配置在 settings 表 `s3_settings`（SK 是 `enc:v1` 本地加密，无法直接解）

---

## 6. 踩坑记录（重构时必看）

1. **变量 shadow**：同步函数外层 `remote` 是 ObjectStore，循环内勿再 `const remote = remoteById.get(...)`（会 shadow，`remote.put is not a function`）。改名 `remoteNote`/`remoteItem`。
2. **`markSynced` 双表**：notes + tree_nodes 都要更新（状态栏读 tree_nodes）。
3. **同步完成必须广播 `sync-progress`**，否则打开 tab/状态栏不刷新。
4. **IPC 三处同步**：`main.ts`(handle) + `preload.cjs`(invoke) + `src/lib/native.ts`(类型+封装)。
5. **electron-log 必须 external**：`rollupOptions.external` 写 `/^electron-log/`。
6. **多表写用事务**：`db.transaction()`；已修复 restoreHistory/applyRemoteNoteMeta/markSynced。
7. 结束 electron 只 kill 具体 PID（`ps ... | awk '{print $2}' | xargs kill -9`），**勿 `pkill -f Electron`**（机器上有 SiYuan/VSCode/Trae）。
8. 七牛：`ObjectStore.test()` 用 ListObjectsV2（HeadBucket 不可用）；正确配置 Endpoint=`https://s3.cn-north-1.qiniucs.com`、Region=`cn-north-1`、Bucket=`local-lake-hebei`、`forcePathStyle=false`。

---

## 7. 与用户沟通的要点

- 用户**喜欢深入讨论**设计：给出方案时附**真实场景和后果**，不要空洞；可以大胆反驳，但不要为了反驳而反驳。
- 用户**重视权衡**：付出 vs 收获、性能 vs 复杂度、统一性 vs 体积——都要摆数据。
- 已定稿的语义（**不要重新争论**）：本地是真相、目录强一致、墓碑权威（删除压编辑）、恢复是唯一显式例外、开发版不考虑数据兼容、小记不备份。
- 当前争议/待定：purge 是否广播给所有端（A purge 后 B 是否也彻底删除）——重构时讨论；恢复位置上云的承载格式。

## 8. 一句话给新会话

先读本文档 + AGENTS.md + Electron-HANDOFF.md，理解"删除 = 移入隐藏回收站笔记本"的模型，然后按 §4 计划从设计落地开始，在独立分支实施重构，用 §5.2 的基线做回归。
