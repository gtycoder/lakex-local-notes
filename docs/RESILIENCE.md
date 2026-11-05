# RESILIENCE.md — 容错与自愈契约（261105 起）

> **定位**：回答「异常数据 / 异常操作 / 异常进程下，我们保证什么、怎么降级、怎么取证」。
> 分工：SYNC-PROTOCOL 管同步语义、TROUBLESHOOTING 管踩坑、本文管**失败面**。判据一律单一来源，新增失败面必须回填本文。
> 调研依据：desktop/mobile 现状测绘、思源（siyuan-master）兜底机制、故障注入实验（/tmp 复现：坏 sqlite/gzip/JSON、父环、水线未来、只读目录）。

## 1. 六条原则

1. **文件是真相，索引/派生数据可重建**：DB 索引、FTS、搜索缓存都能从正文重建，不得成为唯一真相。
2. **失败面收敛**：同一问题只有一套判据（坏正文 = core/docBodySafety.ts；DB 完整性 = startupRecovery.inspectDatabaseForStartup / data/dbHealth）。
3. **坏数据不静默吞、不覆盖**：非空但解析失败 ⇒ **只读 + 横幅 + 禁止保存**；绝不把坏内容当空文档再写回。
4. **失败就地隔离、留证不删除**：单条/单篇失败只影响自己；可疑字节宁可改名隔离（corrupted/<ts>/）也不静默丢弃。
5. **单点 panic 不扩散**：后台任务/渲染组件各自兜底，一次异常不得拖垮进程、队列或整棵组件树。
6. **越靠近本地写入越严格**：正文 tmp+rename（桌面待补 fsync）、多表写事务、I2「未变才标 / 未变才应用」。

## 2. 已落地能力（261105 前）

| 面 | 桌面 | 移动 |
|---|---|---|
| 进程级崩溃 | uncaughtException/unhandledRejection 落日志；render-process-gone 800ms 自动 reload、30s 内超 3 次熔断；crashReporter | 30s 首屏看门狗 reload；renderer gone → recreate |
| 组件级隔离 | per-tab EditorErrorBoundary（5 处） | 261105 补齐（见 §3） |
| 坏正文 | core/docBodySafety：usheet/board/ink（261105 起含 bitable）⇒ 只读 + 横幅 | 同判据（261105 起四族齐） |
| 缺正文 | ENOENT → bodyMissing + 资源页队列（云端/历史/仅本地） | B-lite 现扫 + 三条恢复 |
| 写入 | 正文 tmp+rename；多表写 70 处事务；VACUUM INTO 一致性导出 | BodyStore tmp+fsync+rename；WAL + 串行锁；迁移失败回滚 |
| 会话保护 | 草稿 journal（原子写）、切页/关闭前 flush | 小记草稿 journal（300ms 防抖） |
| 同步失败 | classifyS3v3Error（retryable/action-required/fatal）、发布锁重试、读回确认 | 触发点重试 + 断点续传标记；状态常驻设置页 |
| 诊断 | 日志分作用域（[crash]/[ipc]）；设置页同步诊断 | 复制诊断 + emptyCatchGuard AST 护栏（80 处带理由空 catch） |

## 3. 261105 容错批（本轮落地）

1. **同步窗口守卫**（core/s3v3/state/deviceStore.ts）：plan 快照与本轮落库之间发生的本地动作优先——轮内软删/purge 的小记与文档**不重建、不清墓碑**；轮内移入/移出回收站**不回滚生命周期**（cur.updatedAt > n.updatedAt 判据）。例外：显式恢复（restorePending）与远端复活（远端 updatedAt 晚于本地 purge 时间）仍正常导入。
2. **桌面启动硬失败恢复页**（electron/startupRecovery.ts + startupRecoveryWindow.ts）：启动前 PRAGMA quick_check + 外键预检 → 失败进恢复页（先备份后重试 / 从云端恢复 / 打开数据目录 / 退出），不再卡 boot splash；uncaughtException 写持久 crash-marker.json，正常启动时消费并告警。
3. **移动崩溃隔离与可观测性**：MobileErrorBoundary（根 + home/workspace/settings/search/ai 五层）；window error/unhandledrejection → crashLog 环形缓冲（20 条）；Kotlin UncaughtExceptionHandler + onRenderProcessGone 落 crash/last-crash.txt，启动读取并入诊断；**坏库页**（quick_check 延后 2.5s；从云端恢复 / 重试 / 清缓存重试 / 复制诊断）优先于普通启动失败页。
4. **清缓存不再是 no-op**：真清派生搜索缓存（单事务清空 + 后台重建）与 PDF 临时目录；明确不清正文/附件/历史/回收站；坏库时如实抛错。
5. **坏正文四族统一**：DocBodyKind 增加 bitable，桌面/移动共用 checkDocBody；空白正文 = 可编辑空表，坏正文 = 只读 + 横幅（不再显示「还没有数据表」）。

## 4. 已知缺口（Batch 2/3 backlog）

1. **水线单调化**（P1）：时钟前跳会让 deleted_at > 水线 恒 false ⇒ 删除永不传播；水线取 max(now, 已有墓碑时间) 并拒绝未来值。
2. **正文突变保护**（P1）：正文被外部损坏/替换时会被当本地编辑上传并清理旧对象；上传前做突变确认（大小/可解码性/上次 hash + 历史留档）。
3. **父环防护**（P1）：远端索引可注入目录环；descendantIds/递归 CTE 需 visited，导入侧校验环。
4. **资产坏文件名**（P1）：assets.errors 未上升为可见 warning ⇒ 附件静默不同步。
5. **quick-notes 独立库损坏**仍卡 boot splash（桌面恢复页只覆盖主库）。
6. **恢复页通道**用同文档 hash（未加 preload）；需一次真机/打包冒烟。
7. **Kotlin 侧未编译验证**（CrashLogPlugin / MainActivity）——需 CI 或真机。
8. 导出非原子写（electron/export.ts）、桌面 atomicWrite 无 fsync、canonicalJson 深嵌套 RangeError。
9. 崩溃标记 → **安全模式**（不自动同步/不恢复 tab）；整库备份**导入恢复**入口；文件↔元数据对账（节流）；定时兜底历史快照。

## 5. 新增失败面时的检查清单

- 有没有别的族/别的端已经有一套判据？→ 先合并到单一来源。
- 失败时用户看到什么？能否自助恢复（重试 / 从云端 / 从历史）？
- 会不会**覆盖**用户数据？禁止在「解析失败」路径上写回。
- 有没有留证（日志/隔离文件/诊断导出）？坏字节是否被静默丢弃？
- 后台/队列任务是否 try/finally 释放、是否 recover 到任务边界？
- 补回归测试：把这次事故变成一个用例。
