# 13 · 写路径「生命周期守卫」越界扫查（同类 F04 事故）

> 只读审计（未改任何产品代码）· 2026-11-12 · 基线 = **HEAD `6c5e52b1`**（工作树另有 task-44 的在途修复，见 §0.2，本文引用行号一律以 HEAD 为准，工作树状态单独标注）。
> 范围：`electron/noteContentRepository.ts`、`electron/store.ts`、`electron/s3v3/*`、`electron/{noteMetadataRepository,remoteImportRepository,syncReconciliation,trashLifecycle,historyLifecycle}.ts`、`src/core/s3v3/**`、`src/mobile/{v3/*,data/noteRepository.ts,bridge/notes.ts}`。
> 复现命令均可在本机只读执行（不跑真实 S3、不改代码）。

---

## 0. 一页结论（先读这段）

### 0.1 规模与判定
- 扫到的「因生命周期/状态而拒写」守卫共 **18 处**，判定分布 = **真越界 2**（G1/G3）+ **层次不当但已补偿 1**（G2）+ **必要 15**（G4–G18，其中 U 入口 / S 镜像 / R 恢复 / M 维护四类有交叉，逐条见 §2 表）。
- **真越界（同类 F04，必须修）2 处**：
  - **G1 正文写守卫**：`electron/noteContentRepository.ts:63-65`（HEAD）—— 用户保存策略放在最底层正文写函数，同步 apply 也走它 ⇒ 整轮 syncNow 抛错、设备永久卡死。**工作树已被 task-44 以 `saveSynced` 分身修复（未提交）**。
  - **G3 元数据图标守卫**：`electron/noteMetadataRepository.ts:51-59` 的 `assertNodeWritable` 被 `setNodeIcon` 使用（`:105-110`），而同步 apply 在**首次见到远端行**时会调它（`src/core/s3v3/state/deviceStore.ts:542`）⇒ 新设备首次拉取「带图标的回收站条目」时整轮抛错。**HEAD 与当前工作树都未修**（工作树 `deviceStore.ts:584` 仍在调 `p.setNodeIcon`）。
- **层次不当但已被调用方补偿、建议保留**：G2（`noteContentRepository.ts:57/62` 的 NotFound）。
- **必要守卫（别动）**：§2 表中判定为「必要」的 15 处（用户入口/显式恢复/维护竞态/镜像直写）。
- **疑似死代码**：**未发现**「只测不用」的写守卫；但 G3 属于「无测试覆盖的活代码」（现有 12 例测试只覆盖用户路径，未覆盖同步新行 + 回收站 + icon 组合）。
- **移动端等价性**：用户保存与桌面等价且更严（双层守卫）；同步镜像路径**不走用户守卫**（与桌面修复后语义一致）；**恢复路径有功能缺口**（移动 `restoreSyncConflict` 复用用户保存守卫，目标行已 trashed 时恢复失败；桌面走 `restoreTrashItem` 直写可恢复）。

### 0.2 工作树在途修复（task-44，审计时未提交）
`git status` 显示 task-44 已改：`electron/noteContentRepository.ts`（+saveSynced/allowTrashed）、`electron/store.ts`（+saveSyncedNote）、`electron/s3v3/desktopPlatformPort.ts`、`src/core/s3v3/state/deviceStore.ts`（`:599` 分支 `if (cur.trashedAt != null && p.saveSyncedNote)`）、`src/mobile/v3/{mobilePlatformPort,mobileDeviceStore,sync}.ts`、`plan/plan.ts`、`deviceConformance.ts` + 新测试 `electron/s3v3/trashRemoteDivergence.test.ts`。本文的「修法」与其中已验证的落点一致；**G3 不在该修复范围内**。

---

## 1. 事故链（G1）与失败面

```
同步 apply（core）
  src/core/s3v3/state/deviceStore.ts:556  await p.saveNote(...)
→ 桌面端口
  electron/s3v3/desktopPlatformPort.ts:112-114  store.saveNote(...)
→ Store（无策略，纯转发）
  electron/store.ts:936-937 → :945 saveNoteVersioned → noteContent.save(...)
→ 最底层正文写
  electron/noteContentRepository.ts:63-65
     if (current.trashed_at != null || current.is_purged === 1) throw AppError("InvalidInput", "笔记已在回收站或已被删除，保存被拒绝…")
```

- **谁被拦**：本地行已在回收站（`trashed_at != null`）而远端又对同 id 发布了新正文（他端在 A 删除前/未同步时编辑；远端仍 active）⇒ 三方合并判定「远端胜，正文要写到本地回收站行」，apply 走 `saveNote` → 抛错。
- **失败面 = 整轮、且永久**：`deviceStore.ts:618-619` 对单篇 `catch (e) { throw new Error("saveState 失败(" + n.id + ")" + …) }` ⇒ 异常逃出 apply；`state.write`/基线/水位都在循环之后（`deviceStore.ts` 收尾段）⇒ **这一轮什么都没落库**：下一轮重新载入同一状态、再次命中同一守卫，整轮永远失败 = 设备永久卡死（日志表现为每轮同一条 `saveState 失败(n1)`）。
- **代价**：该设备的自动/手动同步全部停摆（不只这一篇）；S3 上其它设备的编辑无法落地；用户看到的是"同步一直失败"而非"某篇失败"。
- **正确语义**（工作树 task-44 已按此实现）：正文写与生命周期写是**独立字段** —— 远端正文可以写进本地回收站行，但**不得改变 trashed 状态**（不隐式恢复）；`purged` 仍拒绝（不可复活）。同 `saveSynced` 模式见 §3。

## 2. 全量守卫表（file:line → 调用方 → 同步可达？→ 判定）

> 调用方分类：**U**=用户保存/编辑入口、**S**=同步镜像 apply、**I**=导入、**R**=恢复、**M**=维护/GC。
> 失败面：整轮=异常逃出 apply；单篇=per-note 跳过/结构化失败；静默=只跳过不报。

| # | 守卫 | file:line（HEAD） | 条件 | 调用方 | 同步可达？ | 撞上后的失败面 | 判定 / 处置 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| G1 | 正文写「回收站/purged 拒写」 | `electron/noteContentRepository.ts:63-65` | `trashed_at != null||is_purged=1` → throw | **U**（IPC `save_note`：`registerNotes.ts:102`；`renameAssetDisplay`→`store.ts:1225`；导入/冲突副本）**+ S**（`desktopPlatformPort.ts:112`） | **是** | **整轮**（`deviceStore.ts:618-619` 重抛） | **越界**。修法：分身 `saveSynced`（工作树已做）；purged 保留拒绝但**建议 sync 侧改为跳过**（见 §3-P2） |
| G2 | 正文文件不存在 | `electron/noteContentRepository.ts:57`（及 `:62` 行不存在） | 文件缺失 → NotFound | U + S | 是 | 整轮 | **层次不当但已补偿**：`deviceStore.ts:558-560` 检测不到正文文件时改走 `importRemoteNote` 重建（P0 注释在案）。保留；建议把"sync 不得对缺文件行调 saveNote"写进端口注释 |
| G3 | 元数据写边界 `assertNodeWritable` | `electron/noteMetadataRepository.ts:51-59`；被 `renameTreeNode:92` / **`setNodeIcon:110`** / `setNoteEditLocked:182` 调用 | 节点在回收站/purged → throw | U（重命名/图标/锁定菜单）**+ S**（`deviceStore.ts:542` 新行 icon） | **是** | **整轮**（同上 rethrow） | **越界（未修）**：修法见 §3-P1（同步侧分身 `applyRemoteIcon` 或端口直写；保留用户入口守卫） |
| G4 | 删除回收站笔记本 | `electron/trashLifecycle.ts:87-93` | 目标=回收站本 → throw；已在回收站→幂等 return | U | 否 | 单篇（用户动作） | **必要**，保留 |
| G5 | 恢复回收站条目 | `electron/trashLifecycle.ts:140-215` | 不满足回收站子树/父不可用 → 回落兜底父/幂等 | U/R | 否（sync 用 direct `applyRemoteRestore`） | — | **必要**（恢复=唯一显式例外，写路径本身绕开 G1） |
| G6 | 彻底删除（purge） | `electron/trashLifecycle.ts:238-300` | 不在回收站子树 → NotFound；写 purge 墓碑 | U/M | 否 | 单篇 | **必要**，保留 |
| G7 | 移动端彻底删除过期竞态守卫 | `src/mobile/data/trashRepository.ts:282-330` | `expiredBefore` 不满足（已恢复/未到期）→ return false | M（自动过期） | 否 | 静默跳过（正确） | **必要**（事务内重判，防后台动作压过用户恢复），保留 |
| G8 | 移动端用户保存守卫（桥层） | `src/mobile/bridge/notes.ts:89-100` | `noteWriteState = gone` → throw；missing+tombstone → throw | **U**（含 `useWorkspaceSession`/AI/导入）、**R**（`restoreHistory:174`、`restoreSyncConflict:283`） | 否（mobile sync 走 `mobilePlatformPort` 直写） | 单篇（抛给 UI/结构化失败） | **U 必要**；**R 撞用户守卫**：`restoreSyncConflict` 目标已 trashed 时恢复失败（桌面可恢复）→ §3-P3 功能缺口 |
| G9 | 移动端用户保存守卫（底层） | `src/mobile/data/noteRepository.ts:232-270` | `trashed_at/purged` → throw；**二次 WHERE** `trashed_at IS NULL AND is_purged=0`，不命中→回滚正文+throw | U | 否（sync 走端口直写） | 单篇 | **必要**（与桌面等价且多了竞态二次守卫）；保留。桌面缺这条二次守卫（见 §4） |
| G10 | 移动端 sync 端口直写 | `src/mobile/v3/mobilePlatformPort.ts:363-379`（saveNote）、`:339-362`（importRemoteNote）、`:388-…`（applyRemoteNoteMeta）、`:425`（setNodeIcon）、`:432`（deleteNote）、`:452`（restoreTrashItem） | 无生命周期守卫（直写 UPDATE/INSERT） | S | —（它就是 S） | 不会因生命周期抛错 | **必要**：镜像路径必须直写、不得复用用户写函数（**正面范本**，桌面应对齐） |
| G11 | 桌面 sync 端口 | `electron/s3v3/desktopPlatformPort.ts:107-127` | 无策略，转发 Store（因此继承了 G1/G3） | S | — | 整轮（因为底层守卫） | **问题在底层而非端口**；修复应为端口新增 `saveSyncedNote`/`applyRemoteIcon`（工作树已加前者） |
| G12 | 同步镜像元数据直写 | `electron/syncReconciliation.ts:123-160`（applyRemoteNoteMeta）、`electron/noteMetadataRepository.ts:191-195`（applyRemoteEditLock 直写 UPDATE） | 无生命周期守卫 | S | — | 安全 | **必要**（正确分层），保留；建议在文件头写明"镜像写不得复用 U 入口" |
| G13 | 远端新行导入（含回收站） | `electron/remoteImportRepository.ts:84-150`（`importNote`，trashed 行写 trashed_at/parent=trash） | 仅校验 path/filename；无生命周期拒写 | S | — | 安全 | **必要**，保留 |
| G14 | 同步轮内被 purge 的行 | `src/core/s3v3/state/deviceStore.ts:513-533` | `purgedAt` 且非 restoring 且 `updatedAt <= purgedAt` → `continue`（跳过不抛） | S | — | 单篇静默跳过（正确） | **必要 + 正面范本**：同步侧兜底守卫必须"跳过"而非"抛错"，保留 |
| G15 | 恢复正文（资源页） | `electron/store.ts:1723-1725`（writeRestoredBody，直写原子写）/ `electron/syncEngineController.ts:183-222` | 不读 DB 生命周期；只校验 hash | R（用户显式） | 否 | 单篇（结构化失败） | **必要**（恢复=显式例外），保留 |
| G16 | 历史版本恢复 | `electron/historyLifecycle.ts:363-399`（`:375` 直写 .lake + 标 dirty） | 无生命周期守卫 | R（用户显式） | 否 | — | **必要（但注意）**：入口只在活跃文档（回收站面板只做只读预览：`TrashPanel.tsx:348`），当前不可达 trashed 行；若将来给回收站加"恢复历史"入口，会**绕过** G1 语义（要么补显式恢复前置，要么明确这是显式恢复） |
| G17 | 新建副本（含回收站源） | `electron/noteDuplication.ts:79/106` | 源已 trashed → `already-trashed` 结构化失败 | U | 否 | 单篇 | **必要**，保留 |
| G18 | 渲染层保存前置拦截 | `src/hooks/useSavePipeline.ts:99-102` | openTab.deleted → `{ok:false,blocked:true}` + onBlockedSave | U | 否 | 阻止 UI 写回 | **必要**（与底层 G1 双保险；不能替代底层），保留 |

补充（非守卫、仅记录）：
- `src/core/syncDecisions.ts:69` `isGoneNote` 是**读/只读态判据**（`useSyncRefresh`/`useTabLifecycle`/`MobileApp`/`noteRef`），不是写守卫；桌面 `repositoryCapabilities.ts:51` 标 desktop=null（桌面靠 G1 兜）——分层不对称，但删/改都无必要。
- `electron/noteMetadataRepository.ts:120-140` `moveTreeNode` **没有** `assertNodeWritable`：拖拽/移动入口只对活跃树可见；若未来给回收站加"移动"入口需补判定（记录为潜在不一致，不是现存缺陷）。
- `electron/quickNotes/index.ts` 未发现生命周期写守卫（删除/恢复委托 `trashLifecycle` 直写）；小记写路径不在本次 F04 同类范围内。

## 3. 建议处置（按优先级，均为"不改代码"方案）

**P0（随 task-44 一起收口）**
1. G1 的 `saveSynced` 分身：保留 `save()` 的用户拒写（回收站 + purged），新增 allowTrashed 同步入口；`deviceStore` 对 `cur.trashedAt != null` 走 `saveSyncedNote`（工作树已实现，落点 `deviceStore.ts:599`、`platformPort` 可选端口）。验收 = 工作树新增的 conformance 用例「本地已进回收站 + 他端编辑并发布 → 应正文/保留回收站、且整轮不失败」（`electron/s3v3/deviceConformance.ts`，可在 `deviceConformance.mixed.test.ts` 里跑）。
2. **确认 purged 在 sync 侧的失败面**：`saveSynced` 仍对 purged 抛错（正确语义），但**不要让它逃出 apply** —— 建议 `deviceStore` 对 `cur.isPurged` 的 wanted 条目 `continue`（与 G14 同款"跳过"），或 apply 层把这类错误降级为"单篇失败并记录"。否则"purged 行仍在 wanted"只是把 G1 的卡死推迟到 purge 场景。

**P1（G3，未修，同类越界）**
3. 给桌面端口加**镜像图标写**（与 `applyRemoteEditLock` 同款直写），core 在新行分支改调它：
   - 落点：`src/core/s3v3/state/platformPort.ts` 增 `applyRemoteIcon?(noteId, icon)`；`electron/s3v3/desktopPlatformPort.ts` 实现为 `store.applyRemoteIcon`（`UPDATE tree_nodes/notes icon…` 直写，无 `assertNodeWritable`）；`deviceStore.ts:542` 改为优先 `applyRemoteIcon`、缺省回退 `setNodeIcon`（移动端端口已直写、天然安全，可一并实现以消除平台差异）。
   - 保留 `noteMetadataRepository.setNodeIcon` 的用户守卫（U 路径）。
   - 护栏：conformance 增一例「新设备首次拉取：远端=回收站条目 + icon 非空 ⇒ 整轮不失败、图标落库、trashed 状态保留」。
4. 若不想加端口：退而求其次在 `deviceStore` 新行分支把 icon 写入 `importRemoteNote` 的 note write 里（`remoteImportRepository.importNote` 的 INSERT 增加 icon 列），避免第二次调用——但改动面更大，不推荐。

**P2（口径与护栏）**
5. 在 `src/core/s3v3/state/platformPort.ts` 文件头与 `electron/noteContentRepository.ts`/`noteMetadataRepository.ts` 类注释里写死一条不变量：**U 入口守卫不得被 S（同步镜像）复用**；镜像写只走端口直写或 `*Synced/*Remote*` 分身。
6. 移动端恢复缺口（G8 的 R 分支）：`restoreSyncConflict` 目标是回收站行时，改走 `restoreTreeItem`（显式恢复）再恢复历史；或返回既有结构化失败并在 UI 指明"请先在回收站恢复"。桌面已有 `restoreTrashItem` 分支（`store.ts:1062-1087`），两端对齐即可。
7. 桌面补 G9 的**二次 WHERE 守卫**（可选）：`noteContentRepository.save` 在 atomicWrite 后、DB UPDATE 上加 `AND trashed_at IS NULL AND is_purged=0`，不命中则删/回滚刚写的正文并抛结构化错误；可消除"检查与写入之间被移入回收站"的窄竞态（移动端已有，桌面没有）。收益小、改动在热路径，列为可选。

## 4. 移动端 vs 桌面：trashed 行行为对照

| 路径 | 桌面（HEAD） | 移动端 | 等价？ |
| --- | --- | --- | --- |
| 用户保存（编辑器/IPC/bridge） | `store.saveNote` → G1 拒绝；渲染层 `useSavePipeline` 先拦 | `bridge.saveNote` 拒绝（G8）→ 底层再拦（G9 双层）；`useWorkspaceSession` 同路径 | **等价**（移动端更严：二次 WHERE） |
| 同步镜像（远端正文 → 本地行） | `desktopPlatformPort.saveNote` → G1 抛错（P0 根因） | `mobilePlatformPort.saveNote` 直写 UPDATE（无生命周期守卫） | **不等价（HEAD 状态）**；修复后（saveSynced）等价 |
| 同步镜像（新行/图标/锁定/删除/恢复） | 导入/元数据/锁/删除/恢复均直写；**图标走 G3 抛错** | 同一 core 流程，端口全部直写（`:425/432/452`） | **图标路径不等价**（桌面有 G3，移动端没有） |
| 恢复（显式） | `restoreTrashItem`/`restoreHistory`/`writeRestoredBody` 直写，永远成功 | `restoreTreeItem` 直写成功；但**同步记录恢复**（`restoreSyncConflict`）复用 G8 → 目标已 trashed 时失败 | 显式回收站恢复**等价**；同步记录恢复**不等价**（缺口，§3-P2-6） |
| 导入 | 导入新建的文档（活跃行）走 G1 正常写 | 同（新建行走 `createNote`+`saveNote`，活跃） | **等价**（都不应触发 trashed 守卫） |
| 维护/GC | purge/过期直写 + 墓碑；无写守卫 | `purgeTreeItem` 事务内 `expiredBefore` 重判（G7） | 等价（各自竞态守卫在维护侧，正确） |

## 5. 复现与现有护栏（只读命令）

```bash
cd "$(git rev-parse --show-toplevel)"   # 本机 = /Users/admin/file/local-lake/lakex-local-notes
export PATH="$HOME/.nvm/versions/node/v24.18.0/bin:$PATH"

# 1) 用户路径守卫确实存在且有测试（HEAD 通过；只证明 U 路径，不覆盖 S）
npx vitest run electron/noteContentRepository.test.ts src/mobile/data/noteRepository.test.ts
#    → 12 passed（含「审计 F04：回收站条目不能被普通保存改写」「移动端 R10 晚到保存被拒绝」）

# 2) 证明 S 路径确实会撞守卫（读码链路，无需起 App）
git show HEAD:src/core/s3v3/state/deviceStore.ts | sed -n '532,562p;616,620p'   # apply → p.saveNote → per-note catch/rethrow
git show HEAD:electron/s3v3/desktopPlatformPort.ts | sed -n '107,115p'          # 端口无分身，直接 store.saveNote
git show HEAD:electron/noteContentRepository.ts | sed -n '59,65p'               # F04 拒写

# 3) 工作树 task-44 的修复形态与验收用例（未提交，行号随工作树漂移）
git diff electron/noteContentRepository.ts | head -60                          # saveSynced/{allowTrashed}
git diff electron/s3v3/deviceConformance.ts | sed -n '1,60p'                    # 新增 P0 conformance 用例
# 合并后可用：npx vitest run electron/s3v3/deviceConformance.mixed.test.ts -t "本地已进回收站"
```

**覆盖缺口（要补的测试）**：
1. 同步 apply 写「本地 trashed 行」正文（task-44 已补）；
2. **新设备首次拉取「trashed + icon」行 → 不得整轮抛错**（G3，当前无测试）；
3. 同步 apply 遇「本地 purged 行」不得整轮抛错（§3-P0-2）；
4. 移动端 `restoreSyncConflict` 目标 trashed 的行为（当前是结构化失败，未钉语义）。

## 6. 明确不动（避免误删必要守卫）

- 所有 **U 入口**守卫：G1 的 `save`（用户）、G3 的 `renameTreeNode/setNodeIcon/setNoteEditLocked`（用户入口）、G4/G5/G6、G17、G18 —— 删掉它们会重新引入"用户保存/改名/图标/锁定静默写进回收站行"的旧缺陷（F04 的原始意图）。
- 所有 **S/M 直写**：`syncReconciliation.applyRemoteNoteMeta`、`noteMetadataRepository.applyRemoteEditLock`、`remoteImportRepository.importNote`、`mobilePlatformPort` 的 6 个直写、`writeRestoredBody`、`trashLifecycle` 的 direct SQL —— 这些正是"策略不越界"的实现，删/加守卫都会重新造成卡死或静默丢弃。
- **"跳过而非抛错"型同步守卫**（G14、G7）：保留；新增同类守卫一律按这个姿势。
- 悬置项：G16 历史恢复不可达回收站行（当前正确）——**不要**为了"统一"给它加 F04 守卫（会误伤未来显式恢复入口），只在加新入口时复核。

---

### 附录 A · 扫描关键词与结果口径
- 关键词：`保存被拒绝`、`回收站`、`已彻底删除`、`is_purged`、`trashed_at`、`gone`、`不允许/拒绝写入`、`throw new AppError`，在 HEAD 的 `electron/**`、`src/core/**`、`src/mobile/**` 上 `git grep` 全量过一遍；然后对每个「写函数（save*/import*/apply*/restore*/delete*/purge*/update*）」人工判定"守卫位置 vs 调用方"。
- "同步可达"判定口径 = core `deviceStore.apply` 会调到的端口方法（`importRemoteNote / saveNote / applyRemoteNoteMeta / setNodeIcon / deleteNote / restoreTrashItem / applyRemoteEditLock / applyNoteTagLinks / purgeLocalNote`）是否最终进入该守卫。
- 行号以 HEAD `6c5e52b1` 为准；工作树 task-44 在途改动可能使 `noteContentRepository.ts / store.ts / desktopPlatformPort.ts / deviceStore.ts / plan.ts / mobile/v3/*` 的行号偏移。

### 附录 B · 未覆盖 / 下轮
- 未跑真实 S3 与设备（按只读纪律）；同步路径结论来自代码链 + 工作树新增的 memory-remote conformance 用例形态。
- 未逐行审 `plan/plan.ts` 的三方合并细节（task-44 正在改）；本报告只关心"守卫位置与调用方"。
- `electron/quickNotes/**` 与小记快路径（`runQuickPush`）不在本次同类范围内（小记无回收站行→正文写入的镜像路径）。
- 未审计 web 客户端（`webApiServer`）的写通道：它映射到同一批用户的 `save_note` → 与桌面 U 路径同判据（G1 保留）。
