# v4 四相内核切换 · 四项验收测试报告

- 日期：2026-10-28（Asia/Shanghai）
- 被测代码：本仓工作树（HEAD `ea576a80` + 261028 全部未提交改动），v4 四相内核为**唯一**同步实现（旧 `incrementalSync/pullAll/initialUpload/buildAndUploadAll/executePending` 已物理删除）
- 真桶：endpoint `https://s3.cn-north-1.qiniucs.com` / region `cn-north-1` / bucket `local-lake-hebei`
- 铁律：未提交/未推送 git；未触碰正式数据目录；测试前缀全部独立并于结束后清理；AK/SK 仅经环境变量传递

## 0. 结论摘要

| 任务 | 结果 | 关键数字 |
|---|---|---|
| 1 真机复验 | **通过**（并真实复现一个历史缺陷） | 配置→测试连接 OK→同步成功；首拉 968ms、空跑 293ms；**首次同步真实复现 `epoch-mismatch` 且 UI 无处置入口（审计 SD-03）** |
| 2 与旧流程 A/B | **不慢**：6 轮中 5 轮更快，首传持平 | 3000 文档同负载：首传 v4 748ms vs v3 739ms（操作数/字节完全一致）；空跑 −6%~−13%；改 10 篇 −20%；**新增 100 篇 −54%** |
| 3 真桶压测 | **通过** | 2000 文档+200 附件（2646 对象/6.03MB）；六轮总耗时 **150s→79s（−47%）**，GET **1045→30（−97%）**；零变更轮仅读 1 次 pointer（312B）；清理 2646→0 |
| 4 多端并发 | **数据面通过 / 体验面 P1** | 1 真机+2 模拟器+4 桌面：最终 7 端 **40 篇、id 集合逐一相同**，无丢失/重复/fork/pointer 损坏，收敛轮全端 `published=false`；但**锁争用被当失败抛给用户 7/42 端·轮（17%）** |

## 1. 任务1：真机复验（设备 50950385，2109119BC / Android 14）

- 安装：`adb -s 50950385 install -r android/app/build/outputs/apk/debug/app-debug.apk`（42,075,650 B，19:33 构建）→ Success；`scripts/emu-cdp.sh 9341` 转发 WebView devtools 成功，CDP 可驱动 UI。
- 配置：Endpoint/Region/Bucket/Object prefix/Access Key/Secret Key 经 CDP 原生 setter + input 事件写入；**测试连接 = OK（对象数 ≥ 1）**、保存成功、启用云同步 = 开。
- **首次同步真实失败**：`同步失败: 云端是另一套数据（epoch 不一致）`。
  - 本机 baseline：epoch `3304e136…` / generation 85（来自旧前缀 `lakex-notes-dev4/real-r1`）
  - 云端 dev3 pointer：epoch `358885eb…` / generation 4
  - 落盘诊断：`ok=false, durationMs=2253, error.class=action-required, code=epoch-mismatch`
  - **App 内没有任何处置入口**（无重置/全量重拉/重新对齐），只能 `pm clear` 重来 —— 即 `docs/audit-261027/05-sync-data.md` 的 **SD-03 在真机上复现**。
- 处置后（`pm clear` 该 App 沙盒，清前导出 2052 篇清单；云端副本仍在旧前缀，未触碰正式数据）作为新设备加入 dev3：
  - 同步 #1：**成功**，`上次同步：… 19:43 · 同步成功（v3 同步完成：↑0 ↓1）`，耗时 **968ms**，阶段 `round-pull 293ms · bodies 1/1 189B · round-pull-done 634ms`；拉到「R2 发布验证」。
  - 同步 #2（空跑）：**成功**，耗时 **293ms**，`round-plan 166ms / round-apply 3ms / round-finalize 86ms`，`published=false`，gen 4 未变。
  - 落盘 baseline 与云端一致（epoch `358885eb…` / gen 4 / commit `d6182fd6…`）；本地 1 篇 / 1 目录 / 0 小记。
  - 云端核对：dev3 下 7 对象不变、pointer gen 4 不变、**无 `meta/lock.json` 残留**（新设备只拉不推）。
- 截图 7 张（失败页/成功页/诊断/开关=开/首页等），logcat 与清前后 DB 副本均在 `/tmp/v4test/device/`。

**真机观察项**：① 自动同步默认「完全手动」（只有手动同步联网）；② 「按需下载附件」新装显示**关**（语义上新设备默认开，疑被"先写同步设置"绕过 `deferAssetsDefault` 判据）。

## 2. 任务2：v3 vs v4 同负载 A/B（各阶段耗时 + 远端调用/扫描数）

- 方法：`git worktree` 检出 HEAD `ea576a80`（旧 v3 实现），与当前树共用 `node_modules`；两棵树上运行**同一份**基准脚本（真实桌面 `Store` + 内存 S3 `CountingRemote`，只走 `engine.sync()` 公共 API）。
- 负载：3000 文档（~400B 正文），轮次 initial → noop → 改 10 篇 → noop2 → 新增 100 篇 → noop3；每轮统计墙钟、`onPhase` 阶段耗时、远端 get/put/delete/list 次数、list 返回对象数、上下行字节。
- 采样：两树**交错**各跑 4 次取中位数（消除机器漂移）。

| 轮次 | v3 中位 | v4 中位 | 变化 | GET v3/v4 | PUT v3/v4 | DELETE v3/v4 | LIST v3/v4 | 上行字节 v3/v4 |
|---|---|---|---|---|---|---|---|---|
| initial（3000 首传） | 739ms | **748ms** | +1.2%（≈持平） | 8 / 8 | 3005 / 3005 | 1 / 1 | 2 / 2 | 1,769,792 / 1,769,792 |
| noop | 118ms | **111ms** | −5.9% | 1 / 1 | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 |
| edit10 | 236ms | **189ms** | −19.9% | 7 / 7 | 13 / 13 | 12 / 11 | 0 / 0 | 819,824 / 819,824 |
| noop2 | 116ms | **101ms** | −12.9% | 1 / 1 | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 |
| add100 | 527ms | **241ms** | **−54.3%** | 7 / 7 | 103 / 103 | 2 / 1 | 0 / 0 | 875,344 / 875,344 |
| noop3 | 118ms | **106ms** | −10.2% | 1 / 1 | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 |

**结论**：同一批操作（GET/PUT/字节完全一致）下，v4 在空跑/编辑/新增轮全面更快（新增轮 ~2.2×），**首传持平（差异在噪声内）**。旧实现「空跑只读 pointer」的预算被 v4 完整继承（noop 仍 GET=1）。

**本轮测试中发现并修复的性能缺陷（重要）**：v4 plan 原先对**所有带 `assetsHash` 的条目每轮都发声明读取** —— 2000 文档/200 附件时，零变更轮产生 **201 次 GET（25KB）**、apply 阶段 10.3~35.2s；修复为「只有要 apply 远端条目或要上传本地条目才读声明」后：

| 轮次（真桶 2000 文档+200 附件） | 修复前 | 修复后 |
|---|---|---|
| noop | 10,467ms / GET 201 | **145ms / GET 1** |
| noop2 | 11,560ms / GET 201 | **264ms / GET 1** |
| noop3 | 35,412ms / GET 221 | **221ms / GET 1** |
| 改 50 篇 | 16,472ms / GET 207 | **5,527ms / GET 12** |
| 新增 200 篇 | 22,201ms / GET 207 | **10,062ms / GET 7** |
| 六轮合计 | 150,096ms / GET 1,045 | **79,159ms / GET 30（−47% / −97%）** |

另两处同批优化：① 首轮并发竞态判空由「objects/ + meta/index/ 各列一次」改为**一次前缀列举**（空桶 RTT 2~4→1）；② 资产清单读取并发池化（2 万篇时不再串行 2 万次目录 IO）。

## 3. 任务3：真桶压测（v4-only）

- 数据：2000 文档（正文 682,010 B）+ 200 附件（每个 20,480 B 随机）+ 1 目录；本地生成 1,864ms。
- 前缀：`lakex-notes-stress-<ts>`（独立，结束清理；未触碰 dev3/dev4）。
- 结果（修复后版本）：

| 轮次 | 总耗时 | 上行/下行 | PUT | published / gen | warnings / errors |
|---|---|---|---|---|---|
| initial | 62,940ms | 5.03MB / 0 | 2405 | true / 1 | 0 / 0 |
| noop | **145ms** | 0 / 0 | 0 | false / 1 | 0 / 0 |
| 改 50 篇 | **5,527ms** | 28.6KB / 0 | 58 | true / 2 | 0 / 0 |
| noop2 | **264ms** | 0 / 0 | 0 | false / 2 | 0 / 0 |
| 新增 200 篇 | **10,062ms** | 516.4KB / 0 | 243 | true / 3 | 0 / 0 |
| noop3 | **221ms** | 0 / 0 | 0 | false / 3 | 0 / 0 |

- 对象盘点：2646 个 / 6.03MB（objects 2201、assets 220、meta/assets 220、meta/index 3、pointer/lock 1、quick-notes index 1）。
- 清理：分批判（≤1000/批、并发 12）删除 2646 个，复检剩余 0；全桶复查 `lakex-notes-stress-*` = 0。
- 遗留观察（本次只测未改）：① 上传侧有效在飞请求 ≈4.9（首轮 PUT 累计 300,826ms / 墙钟 61,299ms），低于配置 12；② `report.deletedObjects` 未计入 stale 正文清理（改 50 篇实删 51 个，report 记 0）；③ 单次 GET 长尾 683ms。

## 4. 任务4：多端并发（1 真机 + 2 模拟器 + 4 桌面）

- 前缀：`lakex-notes-conc-1793188033`；桌面 d1–d4（各自 userData/vite/asset/CDP 端口隔离）、模拟器 m1（emulator-5560）/m2（emulator-5562）、真机 p3（50950385，第 4 轮加入）。
- 并发轮：R1(6 端，wall 7.4s) → R2(6 端，18.5s) → R3(6 端，10.9s) → R4(7 端含真机，3.5s)；每轮各端新建 2 篇 + 指定两端改同一共享文档。
- **数据面 PASS**：7 端最终均 **40 篇**、id 集合逐一相同；18 个云端索引全部可解析、notes 单调 1→40；pointer gen18 指向末版；串行收敛轮全端 `published=false / ↑0 ↓0`（桌面 100–119ms）；共享文档内容 7 端逐字一致，输端 `supersededNotes` + 历史快照（d1=2,d2=3,d4=2,m2=1,p3=1）；本地 pending=0。
- **体验面 P1**：发布锁争用被直接当同步失败抛给用户（`另一台设备正在发布同步，请稍后重试`，桌面 IPC 码 INTERNAL），4 轮共 **7/42 端·轮（17%）**；无内部退避/排队/重试，用户需手动再点。本地数据安全（下轮补传）。
- 次要：① 首轮条件写冲突 `cond not match` 1 次（同样 INTERNAL）；② **空基线 + 非空云端**时本地独有文档被移入回收站（4 端，有 warning、正文/历史保留可恢复）——新设备带本地数据接入需产品口径；③ 1 次「1 项被跳过」；④ 无 pointer 损坏、无 fork、无文档丢失/重复。
- 清理：测试前缀 65 对象全删、复检 0；`lakex-notes-dev4/real-r1`（24,246 对象/1,635MB）与 `lakex-notes-dev3`（7 对象）均与清理前一致，未触碰。

## 5. 需要在产品/后续版本处理的问题（按严重度）

| # | 问题 | 级别 | 建议 |
|---|---|---|---|
| 1 | 发布锁争用 → 同步失败且 UI 码 INTERNAL，无重试/排队（并发 7 端时 17% 端·轮） | **P1 · 已修** | 见 §7.1（等锁预算 10s + 20s 内退避重试 + 诊断计数）与 §7.2（UI 区分可重试/需处理，可重试自动再跑一次） |
| 2 | `epoch-mismatch` 在真机无任何处置入口（SD-03 复现） | **P1 · 已修** | 见 §7.2：同步失败即给出「云端是另一套数据」+ 直达 设置→同步→「从云端恢复」的按钮（自动同步走状态栏 notice） |
| 3 | 空基线 + 非空云端 ⇒ 本地独有文档进回收站（"删除=缺席"默认） | **已裁决 · 不做** | 用户 261028 定：**保持默认逻辑**（本地独有 → 回收站 + 「云端已删除·仅本地」，正文/历史保留可恢复），不引入首次接入 upload/merge 策略选择 |
| 4 | 「按需下载附件」默认值 | **已裁决 · 保持现状** | 用户 261028 定：**移动端新设备默认开**（`deferAssetsDefault` 现状不改）、**桌面默认关**（`deferAssets === true` 白名单，已一致） |
| 5 | 上传侧有效在飞 ≈4.9（配置 12）；`report.deletedObjects` 未计 stale 正文清理；GET 长尾 683ms | **P2/P3** | 传输调度与计数口径后续调优 |

## 6. 门禁与产物

- 末尾全量门禁：`tsc` 0 · **vitest 487 文件 / 3087 passed（12 skipped）** · `check:core` 129 文件 0 · `git diff --check`；`perf.integration` 通过；桌面与移动两条 `vite build` 通过。
- 测试脚本/原始数据：`/tmp/v4test/`（device-report.md、stress-report.md、stress-report2.md、concurrency-report.md、各脚本与 JSON）；真机截图 `/tmp/v4test/device/*.png`。
- 旧流程 A/B 用临时 `git worktree`（HEAD）完成，测试后已 `git worktree remove` 清理；仓库源码仅保留三处性能修复（声明读取门控、单次前缀判空、资产清单并发池化）。
- 本次未做 git commit/push（无授权），工作树仍为未提交状态。

## 7. P1 修复（261028 晚，未提交）

### 7.1 发布锁争用不再变成用户可见失败（引擎）

- `src/core/s3v3Engine.ts`：
  - 新增 `publishLockWaitMs`（默认 10s）并透传给 `commitPlan` 的等锁预算。**只在锁被别的端持有时才产生等待**，正常轮（无锁）零额外往返、零额外延迟。
  - 重试环对 `lock-busy` 不再立即抛：在 20s 总预算内做 300–800ms 抖动退避（3 次尝试），仍等不到才抛 `lock-busy`（有界，不无限空转）。
  - 首传（`initialRound`）同样使用该等锁预算。
  - 新增诊断计数 `publishLockBusyRetries`（正常轮恒 0，供日志/测试断言并发压力）。
- 回归测试：新增 `src/core/s3v3LockContention.test.ts`（4 例）
  1. 6 端同时发布：无任何端失败、最终 13 篇 id 集一致、零变更轮不再发布；
  2. 锁被别的端长期占着：有界等待后明确抛 `lock-busy`（<10s，不挂死）；
  3. 锁只被短暂占用（300ms）：等锁预算内自动拿到并发布成功；
  4. 单次等锁预算用尽（60ms）但锁随后释放：外层退避重试后仍发布成功（断言 `publishLockBusyRetries ≥ 1`）。
- 既有用例调整：`electron/s3v3/syncEngine.test.ts` 的「发布锁被占用 → lock-busy」显式 `publishLockWaitMs: 0`，保持「长期占锁 ⇒ 有界后失败」语义。

### 7.2 错误分类透传 + 可重试提示 + epoch 恢复引导

- 跨 IPC 分类：`IpcErrorPayload` 新增可选 `syncCode`（≤64 字符）/ `syncClass`（retryable｜action-required｜fatal，白名单），`encodeIpcError`/`parseIpcError` 双向；preload 挂回 Error；渲染层 `getNativeSyncErrorInfo()` 读取。`SyncProgress` 失败广播同时带 `errorCode/errorClass`。
- 手动同步：retryable ⇒ 不再弹硬失败；状态栏「另一台设备正在同步，稍后自动重试…」+ busy toast，2.5s 后**自动重试一次**（局部标志，绝不无限重试），成功收尾为「已自动重试成功」；第二次仍失败才显示真实原因。
- 自动同步广播：retryable ⇒ 状态栏软提示（不弹红）；epoch-mismatch ⇒ 状态栏 notice +「打开同步设置」。
- epoch-mismatch（action-required）：toast 标题「云端是另一套数据」，正文指路 设置 → 同步 →「从云端恢复（换机/坏库）」（本机数据由该流程先隔离备份），附「打开同步设置」按钮。
- 移动端：`bridge.syncNow` 失败文案保留真实原因、按码追加可操作后缀（lock-busy / epoch-mismatch）。核实结论：移动端设置**没有**「从云端恢复」入口 ⇒ 只给文案、未新造 UI。
- 文案单一来源 `src/lib/syncFailureText.ts`；新增/扩充测试：`syncFailureText.test.ts`、`electron/s3v3/syncErrorInfo.test.ts`、`electron/ipc/errors.test.ts`、`src/lib/nativeErrors.test.ts`。

### 7.3 移动端「从云端恢复（换机/坏库）」（用户批准后已实现）

- 语义（移动端专属，不照抄桌面「整库改名隔离 + 重启」——移动端附件可能 1.6GB）：**清空本机 v3 同步账本**（baseline/intents/pending/assetsHash）→ 立即整轮全量重拉：基线没了 + 云端有 pointer ⇒ 引擎走 pullAll（**只拉不打**，不上传任何本机内容）。云端缺席的本机文档/小记由 pullRound 移入回收站并标「云端已删除 · 仅本地」（正文/历史保留可恢复）；**不删本地附件、不隔离数据目录、不重启 App**。
- 实现：`clearV3State()`（`src/mobile/data/v3StateRepository.ts`）· `syncDomain.restoreFromCloud()`（offline/未配置返回说明不抛；在途同步拒绝；顺序「先清账本（写域短锁）→ 再 syncNow（维护域）」有单测锁住；失败原样上抛，状态行/诊断由 syncNow 记录）· 设置页「连接与同步」区块新增入口（`confirmMobile` 二次确认、云同步关闭时禁用、busy 态、结果消息）· 契约方法 +1 · `core/maintenancePolicy.ts` WRITE_OPS + `restoreFromCloud`（**唯一 core 改动，经用户批准，1 行**）。
- 边界：极小竞态（自动同步恰在「清账本」await 窗口内启动）会让本次恢复退化成普通增量——无数据风险，再点一次即可（已记录，暂不加更严格等待）。
- 未做：真机点验（按钮/确认框/恢复后徽标；CDP 可直调 `window.lakeNative.restoreFromCloud()`）；设备快照门禁未跑（设置页不在 6 态夹具内）。

### 7.4 仍未处理 / 待裁决

- 非锁类 retryable（网络/未知）按 `classifyS3v3Error` 默认仍归 retryable ⇒ 手动同步会先自动重试一次再报真实原因（保留「真实原因可见」）。若要按码细分（如 `upload-failed`/`index-missing` 不重试）需改 core 分类，列为后续。
- 空基线 + 非空云端 ⇒ 本地独有文档进回收站：用户 261028 裁决**保持默认逻辑、不做**（回收站 + 「云端已删除·仅本地」即可，正文/历史保留）。
- 「按需下载附件」默认值：用户 261028 裁决**移动端新设备默认开、桌面默认关**；两端现状已符合，无需改代码。
- 移动端「从云端恢复（换机/坏库）」入口：用户 261028 批准补（桌面有样板，移动端按「清空同步基线 + 只拉不打 + 本地独有进回收站」语义实现，不隔离整库、不重启）。
- `cond not match`（首轮条件写冲突，1 次/弃用前缀轮）：根因未定位，仍以 INTERNAL 暴露；候选后续：S3 条件写冲突统一重试一次。

## 8. 门禁（P1 修复后）

- `npx tsc --noEmit` 0 错误。
- `npx vitest run`：**491 文件 / 3110 通过（11 skipped）**（含 P1 锁争用、错误分类、移动端恢复入口的回归）。首跑曾命中 `perf.integration` 并行 flake（ratio 断言 810 > 640ms）；单独运行与 `S3V3_PERF_STRICT=1` 均通过，属已记录的并行 flake（§3 性能门禁口径不变）。
- `npm run check:core` 129 文件 0 违规；`git diff --check` 干净；`ui-metrics` + `check:mobileui` 通过；桌面 `vite build` 3.34s + electron bundle 79ms；`check:bundle` 全部在预算内（含 `audit-vendor-css`；移动入口 JS gzip 71,774 / 预算 81,920）。