# 审计提示词：里程碑计划 M1–M6 + B4（供外部审计者使用）

> 用法：把本文连同下列"必读文件"交给审计者（外部 GPT/同事），要求其输出结构化审计报告。
> 审计目标是**计划本身**（批次划分/顺序/是否伤存量/测试充分性/红线遵守），不是写代码。

## 你的任务
请对 Lake Notes（Electron+React+better-sqlite3+语雀 Lake 内核，本地优先+S3 镜像同步）的一份
**增量功能里程碑计划**做一次独立审计。计划见 docs/MILESTONES-SYNC-UX-2026-09-03.md（或当时文件名）。
你的输出是审计报告，指出：(a) 计划与项目既有红线/语义的冲突点；(b) 批次划分与顺序的问题；
(c) 每批"增量不伤存量"的风险点与测试缺口；(d) 被遗漏的依赖/边界情况；(e) 优先级建议。
不要实现任何代码。

## 背景（项目铁律，违反=致命）
1. 本地是真相、S3 只是镜像；数据不丢由本地保证（回收站软删保留、历史快照、恢复标记）。
2. 墓碑权威（删除压编辑）；恢复是唯一显式例外（restore_pending 标记，markSynced 必须清除）。
3. 软删=移动到回收站笔记本（TRASH + trashedAt）；deleted:true 只用于 purge 墓碑；两者混用=B1 致命 bug。
4. 删除/恢复/同步语义已定稿（TRASH-NOTEBOOK-DESIGN、SYNC-PROTOCOL），**不接受重新争论**。
5. 不为旧数据写兼容/迁移（dev 数据可删重建）。
6. 资产存在性=远端清单声明差集（禁逐对象 HEAD/禁持久缓存）；manifest.assets 必须全量声明；
   发布先对象后清单；GC 只删未被在留清单引用的键+年龄保护。
7. 并发峰 8（NOTE×ASSET）；src/core/ 禁 node: 导入；只动 dev 数据（lake-notes-dev），禁碰正式数据。
8. IPC 三处同步：main.ts(handle)+preload.cjs(invoke)+src/lib/native.ts(类型+封装)。
9. 质量门槛：tsc 0 · vitest 762 passed/15 skipped · 桌面+移动 vite build · git diff --check。
10. 代码批次需用户验收后才合 master；批次=独立 commit、显式 git add。

## 必读文件（按优先级，只读不改）
- HANDOFF.md（§0 基线 / §3 真正待办 / §4 坑）
- AGENTS.md（红线 §3 原则 1–13、机制速览 §4）
- docs/SYNC-PROTOCOL.md · docs/S3-GC-DESIGN.md · docs/TRASH-NOTEBOOK-DESIGN.md
- docs/MILESTONES-SYNC-UX-2026-09-03.md（本次审计对象）
- 相关代码面（抽查即可）：electron/sync.ts、src/core/syncEngine.ts、src/core/lakeReconcile.ts、
  electron/store.ts（cleanupHistory/purgeTrashItem/restoreTrashItem/listTrashReminder/s3_gc_pending）、
  electron/ipc/registerSync.ts、src/components/{SyncToast,SyncStatusPopover,HistoryPanel,TrashPanel,SettingsPanel}.tsx

## 审计维度（逐条回答，别漏）
1. **红线冲突**：计划的每项是否触碰上述铁律？特别注意 B3（note_history 加列/清理语义）、
   M5 A2（坏库/换机恢复——会不会绕开墓碑权威或把云端反噬本地）、M1 B2（预检判定是否与
   先提交者胜+superseded 语义一致）、B4（只读性是否真实——绝不能写存储/清单/GC）。
2. **批次与顺序**：M1 同批 B1/B2/B3/D1 是否合理？是否应拆/合并？M5 最重放倒数第二是否合适？
   B4 独立分支+基准先行的门槛是否充分？
3. **增量不伤存量**：每批改动文件与既有测试的重叠面；哪一批最可能让 762 变红或引入回归？
   测试缺口在哪（列出具体缺口，如 B3 的"自动清理跳过 vs 手动删除"、C1 的"0=关闭"边界、
   A2 的"恢复失败回滚"、B2 的"自动同步绝不弹"）。
4. **依赖与边界**：被忽略的跨端（移动端同步引擎是共享 src/core）影响；IPC 三处同步遗漏点；
   并发/事务边界；UI 状态竞态（如 TrashPanel 自动过期与打开中预览）。
5. **优先级**：按价值/风险/成本给 M1–M6 + B4 + A4 重新排序（可维持原序但要给理由）。

## 输出格式
- 结论先行：总体评价（放行/附条件放行/打回）+ 最严重 3 个问题；
- 按维度分节，每节用"问题→证据→建议"；
- 每批给一个风险等级：绿(可开工)/黄(需补设计)/红(不能按此做)；
- 最后给"必改项"清单（不改不能开工）与"建议项"清单（可后续）。
- 引用代码/文档行号作为证据；不确定处标注"需核查"，不要臆断。
