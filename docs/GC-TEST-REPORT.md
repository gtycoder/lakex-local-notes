# GC / 删除 / 资源链路测试报告（2026-08-15）

> 执行人：Codex（用户委托）。环境：A/B 双端（同机 dev）+ 真实七牛 S3。基线：`npm test` 198 passed。
> 测试驱动：CDP 调 `window.lakeNative` + sqlite3 只读检查 + `scripts/s3-ls.mjs` 云端核对。

## 结论概览

| # | 测试项 | 结果 |
| --- | --- | --- |
| 1 | 删除资源 → 云端标记 / 对账扫描 | ✅ 通过 |
| 2 | 删除文档 → 资源/文档标记 + 超期逻辑 | ✅ 通过（发现并修复 1 个 bug） |
| 3 | 清空回收站 → 连带清除云和本地资源 | ✅ 通过 |
| 4 | 对账 / 深度预览 / 深度清除 | ✅ 通过 |
| 5 | 其他场景（恢复传播、历史引用保护） | ✅ 通过 |
| 6 | 严格指标（gcRetentionDays 窗口 + 自动对账） | ✅ 通过 |

## 测试 1：删除资源（从正文移除图片）

- 造「GC-资源测试」文档（2 图）→ A 同步 → B 同步（两端一致）
- A 编辑移除 1 图 → 同步：
  - ✅ 被移除资源 `assets/{id}/xxx.png` 进 `s3_gc_pending`
  - ✅ 被替换旧正文对象进 pending
  - ✅ 云端资源仍在（对账前不删）
- 对账（gcRetentionDays=0）：
  - 初次对账 `kept=3`：被 prevCommit 链（最近 3 份 commit 引用）保护
  - 连续同步 4 次挤出链 → 对账 `deleted=3`（旧正文 ×2 + 移除资源）
  - ✅ 云端只剩当前正文 + 保留资源；pending 清空；s3_gc_log 记录

## 测试 2：删除文档（软删）+ 超期逻辑

- A 删除文档 → 同步：
  - ✅ 墓碑（`deleted:true` + 真实 contentHash）上传，删除前正文对象在云端
  - ✅ **资源不进 pending**（软删保留资源语义）
  - ✅ A 本地资源保留；B 同步被删（墓碑权威），B 本地资源保留（回收站）
- ⚠️ **发现 Bug（已修复）**：深度清理会把软删笔记的资源列为候选（墓碑 `assets=[]` → 软删资源不在 GC keep 集）→ **执行深度清理会误删回收站文档资源，恢复后缺图**
  - **修复**：墓碑携带删除前资源列表（读 `note-assets/{id}/` + 上传 + 填 `assets`）；`collectManifestRefs` 对 deleted 条目也保护其资源；B 下载墓碑时先拉资源再软删
  - 修复后验证：深度清理预览软删资源不再列为候选 ✅；云端软删资源保留 ✅
- 超期逻辑：软删资源**不因时间删除**（GC 窗口只处理 pending 键；软删资源保留到 purge）

## 测试 3：清空回收站（purge）

- purge 单个文档 → 同步：
  - ✅ 本地 `.lake` + `note-assets/{id}/` 目录物理删除
  - ✅ 云端 `deletePrefix('objects/{id}-')` + `deletePrefix('assets/{id}/')`（0 对象残留）
  - ✅ 墓碑保留、`purged_at` 清除（markPurgeSynced，避免重复删前缀）

## 测试 4：对账 / 深度预览 / 深度清除

- 深度清理预览（74 候选）：审计全部为旧正文对象 + 旧 manifest commit，**无软删资源/当前引用**
- 执行深度清理：`lake deleted=74`，云端 131 → 57 对象
- ✅ 软删笔记资源全部保留（墓碑 keep 保护生效）；s3_gc_log 记录 74 条 deep-clean
- ✅ 小记深度清理 `quickCandidates=0`

## 测试 5：其他场景

- **5a 历史引用保护（B1）**：带图笔记 → 创建历史快照（引用资源）→ 移除图片：
  - ✅ 被历史引用的资源**在标记阶段就不进 pending**（`getProtectedRefs` 直接保护）
  - ✅ 对账/深度清理均不删；云端资源保留
- **5b 恢复传播 + 资源完整**：B 恢复 444 → 同步 → A 跟随恢复：
  - ✅ A/B 两端 444 恢复，资源完整（2 png 都在）

## 测试 6：严格指标 + 自动对账

- `gcRetentionDays=7`：对账保留 pending（未超窗）✅
- `gcRetentionDays=0` + 链挤出：对账删除 pending ✅
- **GC 删除条件 = 超窗口（gcRetentionDays）且不在最近 3 份 commit 引用内**（双重约束）
- 自动对账定时器（代码审查）：`setInterval(gcIntervalHours)` + `enqueueMaintenance` 串行 + `save_s3_gc_settings` 重启定时器 + 云同步关闭时不跑 ✅
- 配置读写持久化（DB settings 表）✅

## 关键机制确认（本轮测试沉淀）

1. **墓碑携带删除前完整内容**（正文 contentHash + 资源 assets 列表）：回收站/恢复 = 删除方最新完整版
2. **GC 双重保护**：prevCommit 链（3 份）保护 + 历史引用保护（B1）+ 墓碑引用保护（软删资源）
3. **对账只删 pending 差集**；深度清理全量枚举 + keep 兜底
4. purge 是唯一"立即删云端"路径（不进窗口）

## 测试数据清理

- 临时测试笔记（GC-资源测试 / GC窗口测试 / GC历史保护）已全部 purge 清除
- 「444」已恢复（B 恢复传播），「333」仍在回收站（用户既有测试数据）
