# 19 · 真实七牛桶 B 档 13 条场景子集（task-58）

> 执行：audit-core（261112），只读真实桶验收；**未改产品代码**（本轮只新增/修正验收脚本与本文档）。
> 被验收代码 = HEAD `d45e7c91`（含 `20a066eb` s3v3+锁+wire+F-01 / `20361880` mobile / `e06eaf99` UI）。
> 矩阵依据：`docs/audit-261112/14-s3-scenario-matrix.md` 附录 A。

## 0. 结论摘要

- **13 条场景全部执行完毕；56/57 条断言 PASS，1 条 FAIL = S72「被删侧编辑强制留历史快照」**（真缺陷，本文只登记、不改语义，建议另开任务）。
- **云端残留 0**：3 次运行的前缀全部 `DELPREFIX` 后复核 0 objects（见 §5）。
- 另：S03 已按 F-01 扩成「purge 目录 + 子树」专项，**7 条断言全 PASS**（云端索引无子树任何 id / 三类前缀对象空 / 逐节点墓碑 / 对端留副本）。
- 覆盖限制见 §4（S28/S58/S62 是存储/配置层故障注入；S55 受「启动自动同步」影响，删掉了一条不可成立的断言）。

## 1. 环境与方法

| 项 | 值 |
|---|---|
| 代码 | HEAD `d45e7c91`（工作树 clean 起跑） |
| 端 | 3 个隔离桌面：CDP 9232/9233/9234；`LAKE_USER_DATA=/tmp/lake5/s1..s3`；资产口 19881-19883 |
| 云端 | 真实七牛桶；**唯一前缀** `audit-261112-scn-<stamp>`（3 次运行前缀见 §5） |
| 凭据 | 只从 `/tmp/lake5/creds.env`（chmod 600）读，脚本/报告不打印密钥 |
| 脚手架 | `scripts/multi-end-sync/run58.sh`（driver）+ `scenario58.mjs`（13 条场景；复用 cdpclient/configure-s3/delprefix） |
| 清理 | 实例按 CDP 端口定位 PID 关闭（不用 `pkill -f Electron`）；**只 DELPREFIX 本前缀**；结束复核 0 objects + 清 `/tmp/lake5/s1..s3`；`creds.env` 保留 |
| 判定 | 每条断言独立登记 PASS/FAIL，失败不中断后续场景；FAIL 只登记不改语义 |

**复跑命令**（在仓库根、Node 24）：

```bash
bash scripts/multi-end-sync/run58.sh          # 全程自动：起 vite/3 实例 → configure → 13 场景 → 清理 → 残留复核
# 产物：/tmp/lake5/scn58.out（逐条断言）、/tmp/lake5/run58.log（driver 日志）、/tmp/lake5/scn-prefix.txt
```

## 2. 逐条结果（最终运行，前缀 `audit-261112-scn-1112175323`）

| 场景 | 断言 | 结果 | 关键证据 |
|---|---|---|---|
| S55 首拉空设备 | 4 | **PASS** | 首拉 up=0/down=1 不整轮失败；文档/目录落全；正文可读；**正文可被全文搜索命中**（`text_cache`/`FTS` 随正文落库，kw 命中该 id） |
| S03 purge（目录+子树，F-01 专项） | 7 | **PASS** | 见 §3 |
| S05 本地 trash × 他端编辑 | 5 | **PASS** | D2 同步不抛错、正文=他端版、仍在回收站、云端 `trashedAt` 非空、D1 跟随回收站 |
| S13 移动 × 他端编辑 | 5 | **PASS** | D1 正文=他端版且位置=自己移动后的目录、云端位置=移动后、D2 跟随移动 |
| S21 双端并发编辑 | 5 | **PASS** | 先提交者胜、被覆盖端正文=远端版、留历史快照、`supersededNotes` 记录该篇、索引 hash 唯一 |
| S25 本地正文缺失 → 云端恢复 | 5 | **PASS** | host 侧删正文文件成功、`listMissingBodies` 含该篇、同步不整轮失败、`restoreMissingBodyFromCloud` 恢复成功、云端 hash 未被空正文覆盖 |
| S28 正文对象中断 → 下轮补齐 | 3 | **PASS** | 缺正文轮不整轮失败 + warning、对象回填后下一轮字节一致 |
| S43 资产上传/差集 | 5 | **PASS** | 云端资产对象 1 个、**声明 1 个**（`quick-notes/meta/assets/<id>/`）、索引带 `assetsHash`、对端 imageCount≥1、二轮对象键集合不变 |
| S50 锁 × 他端连续编辑 | 4 | **PASS** | 锁首次传播；**B 连续两轮编辑期间云端 `isLocked=true` 且 B 仍只读**；A 应用 B 正文且仍锁 |
| S58 发布失败重试 | 3 | **PASS** | 坏 secret 轮失败可分类（`The request signature…`）、恢复凭据后下一轮成功、云端正文唯一 |
| S59 双端同时发布 | 3 | **PASS** | 并发 syncNow 均成功、两端最终都看到两篇（无 fork）、云端索引含两篇 |
| S62 断网失败恢复 | 3 | **PASS** | 断网轮 `ECONNREFUSED 127.0.0.1:1` 可分类失败、恢复后成功、对端字节补齐 |
| S72 三端 建→改→删 | 5 | **4 PASS / 1 FAIL** | 三端都在回收站、无活跃副本、云端索引无活跃条目、D2 同步未整轮失败；**FAIL = 被删侧编辑未留历史快照（history=0）**，见 §4 |

耗时：13 条共 **37s**（场景内耗时见 `/tmp/lake5/scn58.out`：S50 5.6s / S03 5.0s / S72 4.4s 最长）。

## 3. S03 · F-01 专项（purge 目录 + 子树）

构造：`NB → 组 G → 子组 S + 文档 d1；S → 文档 d2`（两层目录 + 两篇有正文文档）；D1 建并同步 → D2/D3 拉全 →
D1 删除 G（进回收站）→ 同步两轮（让 wire/apply 把 trashed 行 parent 归一成回收站容器，即「扁平化」）→
D1 彻底删除 G → 同步 → D2/D3 同步。

断言与结果（均 PASS）：

1. purge 前 D2 已持有子树全部节点（4 个）；
2. purge 轮同步成功；
3. **云端索引不含子树任何 id**（`folders[] ∪ notes[]`，实测缺失集合为 `[]`）；
4. **三类前缀对象为空**：`objects/{docId}-*`、`assets/{docId}/`、`meta/assets/{docId}/`（两篇文档逐一枚举，实测均 0）；
5. **逐文档 purge 墓碑**：本机 `deleted_notes` 四个节点各 1 行、`purged_at` 非空、类型正确（G/S = `folder`、d1/d2 = `note`）；
6. 对端保留回收站副本 + 正文可读；
7. 对端不回传（再同步后云端仍无任何子树 id）。

> 为什么这条是本轮新增断言：F-01 的修复面正是「同步把回收站子树扁平化后，purge 只按 parent_id 会漏掉子文档」。本场景**必须先同步两轮制造扁平化**再 purge，才覆盖真实形态；只跑一次同步的话子树尚未扁平化，测不到该缺陷。

补充（本轮顺带复核，非本场景断言）：lead 调整后的目录守卫语义「**只拦 trashed 副本、放行远端 active**（= 他端显式恢复）」与 AGENTS §3#4 一致；A 端 purge 后 B 端仍持副本并发布为 trashed 时 A 不重建，而 B 端显式恢复（远端 active）时 A 正常接收——后者由 `electron/s3v3/scenarioMatrix.test.ts` 的 S17/S17c 覆盖（本轮 14 例全绿）。

## 4. 失败项（真缺陷登记，不改语义）

### S72-F1 被删侧本地编辑未强制留历史快照（AGENTS §3#3）

- **现象**：D2 编辑正文（未同步）→ D3 删除该文档并同步（删除 = 位置变化，索引条目变 trashed）→ D2 同步：
  D2 的编辑被**上传**（`up=1`，以 trashed 条目发布 = 内容赢家本地/位置赢家远端，合并本身正确），
  D2 本地进回收站，但 `listNoteHistory(id)` = **0**。
- **期望**：AGENTS §3#3 红线「**被删侧本地编辑强制留历史快照**」——即便内容已被上传，被删除侧也应有可回退的快照。
- **根因线索**（读码，未改）：`src/core/s3v3/plan/plan.ts` 的 `archiveLocal` 只在「远端**缺席**」分支
  （`remote-purged-move-to-trash` / `remote-wins-history`）生成；v3 起「移入回收站」是**位置字段变化**、
  条目仍在索引里（§10.3），此时内容判定可以走 `upload`，**不会**产生 `archive-local` 写 ⇒ 无快照。
- **最小复现**（内存远端即可，~0.4s；本轮已用临时用例复现后删除）：
  1) A 建 `NOTES → n1(<p>v1</p>)`，A/B/C 各同步一轮建立基线；
  2) `B.saveNote(n1, "<p>B-edit</p>")`；`C.deleteNote(n1)`；`C.sync()`；
  3) `B.sync()` → 观察 `B.listNoteHistory(n1).length === 0`（期望 ≥1）。
  断言点：`electron/store.ts` `listNoteHistory` / `historyRepository.listForNote`（无过滤，0 = 确无行）。
- **影响**：被他端删除且本地有未同步编辑时，用户无法从「历史版本」找回自己的编辑（只能靠云端 trashed 条目正文，恢复后可见）。数据未丢，但恢复路径少一条。
- **处置**：只登记（本任务约束：真缺陷不改语义）。建议下一批在 plan 的「位置赢家=远端 trashed + 本地内容赢家」分支补一次 `archive-local`（reason="remote-wins"），并加断言：上传成功仍留快照。

## 5. 残留复核（3 次运行）

| 运行 | 前缀 | 结束对象数（DELPREFIX 后） |
|---|---|---|
| #1（首跑，含脚本断言问题） | `audit-261112-scn-1112174752` | **0** |
| #2（修正 3 处脚本断言后） | `audit-261112-scn-1112175113` | **0** |
| #3（最终，本文数据来源） | `audit-261112-scn-1112175323` | **0** |

每次均为：`DELPREFIX=<本次唯一前缀> node scripts/multi-end-sync/delprefix.mjs`（脚本内只按 `PREFIX + "/"` 列举删除），
随后 ListObjectsV2 复核 `RESIDUAL = 0`；3 个 Electron 实例按 CDP 端口 PID 关闭；`/tmp/lake5/s1..s3` 已删；`creds.env` 保留。
**未触碰**任何其他历史前缀、正式数据目录、`android/`、`dist-mobile/`。

## 6. 覆盖限制（不粉饰）

1. **S28/S58/S62 是存储/配置层故障注入**，不是真实断网丢包：S28 = 备份后删本前缀内云端正文对象、再回填；S58 = 写坏 secret；S62 = endpoint 指向 `https://127.0.0.1:1`。真实弱网/丢包由 `deviceConformance`（MemoryRemote 弱网 3 条）覆盖；共享机器上不动网络。
2. **S55 不再断言「首拉前本机为空」**：App 启动即自动同步一次（`syncModes.shouldSyncOnOpenClose`）⇒ 该前提不成立（首跑实测红）；改按「首拉轮把文档/目录/正文/检索索引拉全」验证，同样可观测且与自动同步无关。
3. **S21 的「历史快照」断言**用的是「被覆盖端 `listNoteHistory` ≥1」；与 S72-F1 的差别在于 S21 走的是远端**已发布**的 `remote-wins-history` 分支（有 `archive-local`），所以能留档——两处对照正好定位 S72-F1 的触发条件。
4. **S43 只覆盖小记资产**（`quick-notes/assets/` + `quick-notes/meta/assets/`）；文档附件走同一套声明差集实现（`meta/assets/`），本轮未单独造文档内嵌图（编辑器插图的 IPC 入口在渲染层，脚本侧成本高）；差集不重传以「二轮对象键集合不变」断言。
5. S50 验证的是 task-47 落地后的真实桶行为（锁不因他端连续编辑而丢发布）；移动端锁与目录表示的差异属 task-55/56 范围，本轮未覆盖移动端。

## 7. 建议后续

- **新开任务**：S72-F1「被删侧本地编辑强制留历史快照」（P1，本报告 §4 有最小复现与根因线索）。
- 可选：`scripts/multi-end-sync/scenario58.mjs` 本轮有断言修正（S55/S43/S72 文案 + F-01 断言），建议与本文档一并入库，便于复跑。
