# 里程碑实施计划 v2：冲突收口 / 回收站 / 诊断 / 数据生命周期 / 审美（2026-09-03）

> 状态：**已定案待开工**（用户两轮评审 + 独立审计复核定稿）。审计见 docs/AUDIT-MILESTONES-SYNC-UX-2026-09-03.md。
> v2 变更：吸收审计必改项——M1 拆 M1a/M1b、B2 降级为非阻断提示、B3 到期解除幂等+port 签名、
> C1 换数据源（list_trash + settings 派生）、C2 文案更正（purge 立即删云端）、A2 机械安全四原则、
> B4 取消（对齐 S3-GC-DESIGN §14）；S3-GC-DESIGN §7/§13.3 过时表述已修订（2026-09-03）。
> 权威待办以 HANDOFF.md §3 为准。红线见 AGENTS.md。基线：master f66b31a · vitest 762 passed/15 skipped。
> 在途 worktree（android feat/android-mobile-editing 未提交 WIP）——本计划不触碰。

## 0. 定案范围（契约 C1–C6 下的最终形态）

| 编号 | 事项 | 最终范围 |
|---|---|---|
| B1 | 同步完成通知 | SyncToast 完成态加"N 份本地修改被覆盖已存档"，点击跳冲突浮层；冲突浮层列表去 3 条上限（滚动） |
| B2 | 拉取前提示 | **降级为非阻断提示**（不做"取消则中止同步"的门，审计 §3.1）：手动同步预检到将被覆盖的未同步本地修改时，提示"N 份将被覆盖，会先自动存档"并可继续；只挂桌面 sync_now，自动同步绝不弹 |
| B3 | 被覆盖快照保护 | **方案 B（30 天窗口）**：superseded 留档快照标 protected_until=created_at+30d；cleanupHistory 跳过未到期、扫描内幂等"到期解除"；手动删除任何时候允许；HistoryPanel 标"冲突保留 · 剩余 N 天"；**移动端默认 protected=null，不做保护语义** |
| C1 | 回收站到期可见 | 每行"N 天后自动清除"（**list_trash 的 trashed_at + get_s3_gc_settings 的 trashAutoPurgeDays 派生**，不用 get_trash_reminder）；≤7 天标黄；面板顶部提示条；**0=关闭时不显示倒计时/提示条** |
| C2 | purge 文案 | "本机立即移除 + **云端正文/资源立即删除且不可恢复（非 GC 窗口）** + 他端保留可恢复副本" |
| D1 | 顶栏浮层页脚 | "上次成功同步 xx:xx · 未同步 N 项" |
| D2 | 待回收键明细 | 设置页云端 GC 区把已加载 gcPendingRows 渲染为逐条列表（键+原因+到期） |
| A1 | 整库导出 | **只导出**（不做恢复导入）：一致性 DB 快照 + 拷贝 notes/assets/history/设置 → zip（选目录、白名单） |
| A2 | 云端恢复 | **隔离备份 + 全新空库 + 只拉不打 + 显式确认**（禁对现有库重置同步态）→ 走首次全量拉取 → 完成报告 |
| A3 | 数据体检 | 只读三查（notes↔.lake 存在+sha256 / note_history↔快照文件 / 引用图↔资源+orphan 漂移）；报告卡片不自动修复；放 electron/ 守 node: 禁入 |
| F1 | 日志查看器 | 设置页"日志"区：分页读 logs + 关键字过滤（GC/sync/trash）+ 复制/另存；路径白名单 |
| F3 | 历史清理统计 | 设置"文档与历史"区显示"上次清理 X 份 / Y MB"（store 已存 getLastHistoryCleanup，补 IPC+UI） |
| E | 审美统一轮 | 弹窗/浮层/资源页/小记工作区/回收站/历史面板收编 tokens；主页不动；纯样式 |
| B4 | 块级 Diff | **取消**（对齐 S3-GC-DESIGN §14：不引入 block 对比，用现有历史快照预览）——若用户坚持再做，独立分支+显式声明 diff 依赖 |
| A4 | 云端报告 | **单列 backlog**，形态（①抽屉/②页签/③浮层）待拍板 |
| C3 | 回收站预览 | 撤回（已有 preview） |

## 1. 批次与顺序

M1a → M1b → M2 → M3 → M4 → M5 → M6；A4 backlog。

### M1a · 冲突通知 UI（B1 + D1，纯 UI，无引擎改动）
1. B1：SyncToast 完成态 detail 通道已有，superseded>0 时追加"N 份本地修改被覆盖，已存档"；点击跳 SyncStatusPopover 冲突区；
2. 冲突浮层列表去 3 条上限（容器滚动）；D1：页脚"上次成功同步 xx:xx · 未同步 N 项"（lastSyncedAt + pending 计数现成）。
测试：组件渲染 mock（superseded 空/非空、点击回调）；无引擎逻辑 → 存量 762 全绿即验收。

### M1b · 归档保护 + 拉取前提示（B3 + B2，引擎改动）
1. B3：note_history 加 protected_until（dev 可重建，无兼容层）；
   - 扩 SyncDbPort.createHistorySnapshot 签名（core/syncEngine.ts:248 / syncAdapters.ts:145 / mobile/bridge.ts:487）——桌面在 superseded 三处调用点传保护标志，**移动端默认 protected=null**；
   - cleanupHistory（store.ts:979-1008）跳过 protected_until>now、扫描内幂等清除已到期标记；手动删除（deleteHistory）不受保护限制；
   - 确认历史资源仍进 GC keep-set（getProtectedRefs 已含，sync.ts:360 不受影响）。
2. B2：手动同步 preflight 复用 reconcileLakeNote 全量输入（lastSyncedMetaAt/remoteUpdatedAt/localInTrash），先算"将被覆盖的未同步本地修改"集合；非空 → 非阻断提示条；只挂桌面 sync_now controller（registerSync.ts），**不进共享 runSyncEngine**。
测试：加列迁移；cleanup 跳过/到期解除幂等/手动删除可用；superseded→快照带保护（双端集成）；preflight 空/非空、自动同步路径无 preflight 调用（引擎测试）；B2 与先提交者语义一致性。

### M2 · 回收站容器体验（C1 + C2）
1. C1：倒计时派生（list_trash 的 deletedAt=trashed_at + settings.trashAutoPurgeDays）；≤7 天标黄；顶部提示条；0=关闭 → 全隐藏；auto-purge 不运行（main.ts:513 已守卫，补测试）；自动过期跑完刷新列表；
2. C2：purge 确认文案（本机移除/云端立即删不可恢复/他端保留副本）。
测试：倒计时/边界（0=关闭、到期日）单测；TrashPanel 数据形状；存量 trash 集成（删/恢复/purge/墓碑）全绿。

### M3 · 设置区诊断可视化（A3 + D2 + F3）
1. A3：IPC run_data_health_check（只读三查，electron/ 实现）→ 报告卡片；
2. D2：gcPendingRows 明细渲染（SettingsPanel.tsx:74/84/98 已加载未渲染）；
3. F3：store.ts:1863 已有读取逻辑，补 main handle + preload.cjs + native.ts（IPC 三处）+ 设置区展示。
测试：三查各自构造损坏样本单测；明细渲染 mock；历史清理日志读；存量 GC/清理全绿。

### M4 · 日志查看器（F1）
设置页"日志"区：分页读取 logs/lake-notes.log（路径白名单）+ 关键字过滤 + 复制/另存。不引第三方日志库。
测试：IPC 分页/过滤单测；真机一轮同步后目检 GC/同步行。

### M5 · 数据生命周期（A1 + A2）——最重，单独评审
1. A1 只导出（一致性快照 + 拷贝 + zip，复用 registerNotes 目录白名单）；
2. A2：确认弹窗（含"将替换当前本地数据"警告）→ **隔离备份（改名/移动当前数据目录）→ 全新空库 → 只拉不打 → 完成报告**；禁止重置现有库同步态。
测试：导出 zip 完整性（文件数/hash 比对）；A2 在 $TMPDIR 副本演练（模拟坏库→恢复→计数核对）；只拉不打断言（恢复期间零上传）；恢复失败回滚（备份仍在）。

### M6 · 审美统一轮（E）
纯样式与结构：确认框/弹层/浮层 + 资源页 + 小记 + 回收站 + 历史面板收编 tokens、灭 inline 散兵。无逻辑变更。按模块拆视觉清单。
测试：门禁 + 逐页视觉清单 + 交互回归。

## 2. 每批固定验收流程（防"增量伤存量"）
1. npx tsc --noEmit → 0 error
2. npx vitest run 全量（762 passed / 15 skipped，不允许非预期变红；语义变化先说明再改测试）
3. npx vite build && npx vite build -c vite.mobile.config.ts 全绿
4. git diff --check
5. 手动验收清单（每批列步骤，用户过目）
6. 用户验收才合 master；每批独立 commit、只 git add 显式文件
7. 只动 dev 数据（lake-notes-dev / $TMPDIR 副本）；android worktree 不碰

## 3. 待用户拍板（不阻塞 M1a 开工）
- B4：默认取消（对齐 S3-GC-DESIGN §14）；若坚持做 → 独立分支 + 显式声明 diff 依赖 + 只读断言 + 可复现基准，且不占主线优先级。
- A4：形态与排期（backlog）。
- 每批开工顺序是否需要压缩（M1a+M1b 连续做 or 各批之间停一次验收）。
