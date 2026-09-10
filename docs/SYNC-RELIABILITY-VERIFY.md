# Lake Notes 全流程可靠性验证矩阵（数据完整性门禁）

> **目的**：验证"本地编辑 → S3 同步 → 多端收敛 → 数据完整"全链路可靠性；把**体检(A3)**从"手动诊断"升级为"每次同步后的自动化断言"。
> **适用范围**：桌面 Electron 版（同步 / 数据保全核心）。安卓端另列（见 §7）。
> **前提**：你已认可"数据保全（体检 / A1 / A2）**保留**"，本方案只**加验证**、**不改语义**。A2 云端恢复预留讨论。
> **关联**：`AGENTS.md`(§3 原则 11~13·15·16) · `HANDOFF.md`(§6 命令) · `docs/SYNC-PROTOCOL.md` · `docs/S3-GC-DESIGN.md` · `docs/CODEX-GUIDE.md`(CDP 驱动)。

---

## 0. 现状盘点（你已经有哪些验证 —— 比想象的充分）

| 层 | 已有 | 入口 |
|---|---|---|
| 单元/集成 | 831 通过：syncEngine / syncDecisions / 墓碑 / 冲突 / GC / 资产命名 / 小记 | `npm test -- --run` |
| 双端收敛 | `syncDualAB` / `syncEquivalence` / `syncAdapterEquiv` / `sync.integration` | `electron/*.test.ts` |
| 真实云压力 | `syncStress.benchmark.test.ts`（隔离前缀+自动清理） | `LAKE_RUN_BENCHMARK=1 LAKE_STRESS_S3_* err vitest run electron/syncStress.benchmark.test.ts` |
| E2E 双端 CDP | `ab-verify.sh` + `ab-verify.mjs`（A建→同步→B拉；A删→跟随回收站） | `./scripts/ab-verify.sh`(需 `S3_AK/S3_SK`) |
| 多端编排 | `multidev.sh`（vite/device-a/device-b/stop） | `._/scripts/multidev.sh` |
| 备份 A1 | `workspaceBackup.test.ts` | `npm test -- --run` |
| 云端查看 | `s3-ls.mjs` | `node scripts/s3-ls.mjs --prefix <p>`/ `--count`/ `--note <id>` |
| 体检 A3 | `runDataHealthCheck`（store.ts，只读三查 + tree 链） | 设置→体检 / 脚本调用 |

**缺口**：① `ab-verify` 目前只覆盖 **2 个场景**（基本同步、删除跟随）；② **缺"跑完后用体检/收敛断言兜底"的门禁**。本方案补这两块，其余复用。

---

## 1. 全流程场景矩阵（每条跑完都过门禁）

> 每条：前置 → A/B 操作 → 双方同步 → **门禁断言**。可为"人工按清单走"或"CDP 脚本自动化"。

### S1 基本同步
- A 新建文档（标题+正文+一张图）→ A 同步 → B 同步。
- **断言**：B 有该文档；`contentHash` 一致；B 资产与 A 一致；**A3 体检 0 不一致**；`s3-ls` 对象数与 latest manifest 一致。

### S2 并发冲突（先提交者为真）
- A、B 同时编辑同一篇（同段）→ 双端同步。
- **断言**：生成"(冲突副本 日期)"且 `isConflict=true`；被覆盖版本**自动历史快照留档**；两边都保留、**无数据丢**；体检 0。

### S3 删除传播（墓碑权威 + purge）
- A 软删（入回收站）→ 同步 → B 跟随；A `purge` → 同步 → B 彻底删。
- **断言**：B 先软删（回收站笔记本/`trashed_at`），purge 后彻底删；B 的"迟到编辑"**不复活**；**无幽灵文档**（`treeDanglingParent=0`）；体检 0。

### S4 恢复（唯一显式例外，local-wins）
- A 删 → 同步 → B 已删；A 从回收站恢复 → 同步。
- **断言**：B 拿到恢复版；`restore_pending_at` 经 `markSynced` 清除、**不残留**；体检 0。

### S5 资产/附件 + webp→png
- A 粘贴图片（含 webp/avif）与 PDF → 同步 → B；复制到第三方（微信）验 webp→png。
- **断言**：B 有对应图像/附件；类型正确归档（`note-assets/{noteId}/...`）；webp 复制出是 PNG；**GC 不删在用资产、孤儿能被识别**；体检 0。

### S6 幽灵文档防护（回归：踩过的洞）
- 构造"陈旧清单把子文档重新导入到已不存在的父下"（purge 后用陈旧 manifest / 清空 `purged_at` 场景）。
- **断言**：**不产生**不可见却占资源/同步的幽灵文档；`isFolderPurged` 永久判定成立；体检 `treeDanglingParent=0`。

### S7 回收站污编辑防护（isGoneNote 守卫）
- 打开回收站/`purge` 文档。
- **断言**：以 `deleted` 打开→**只读(viewer)**+顶部横幅；保存被拦且**明确提示（绝不静默丢弃）**；`handleTrashRestored` 恢复后可编辑。

### S8 小记（quick notes，独立体系）
- 建 / 改 / 转正式笔记；独立同步。
- **断言**：小记与 Lake **互不污染**（不写 `notes`/`tree_nodes`/`note-assets`/Lake manifest）；转正式为"换行→段落、图→inline 图卡"；源小记 tombstone `ready_to_sync=0` 等待保护；体检 0。

### S9 备份 A1 → 损坏 → 云端恢复 A2（**A2 预留讨论，先测 A1**）
- 整库备份 A1 → 模拟本库损坏 → （讨论后）云端恢复 A2。
- **断言**：A1 一致性快照+`zip` 完整；A2（若启用）隔离到全新空库、只拉不打、确认后数据/同步语义正确、凭据(`enc:v1`)跨恢复保留；体检 0。

### S10 边界 / 负例
- 网络中断（同步中途 `kill`）→ 重试兜底；25MiB 超大；空文档；笔记本改名/移动；`purge` 后重导入（复活）；S3 配置测试（`ListObjectsV2`）。
- **断言**：不崩溃；失败**不 `markSynced`**→ 下轮重扫；超限给提示；无复活/幽灵；配置测试通过。

---

## 2. 数据完整性门禁（核心补点）

每条场景结束，**全部通过才算 PASS**：

1. **A3 体检**：`runDataHealthCheck` → 三查 0 不一致 + `treeDanglingParent=0`（notes↔.lake 的 sha256 / note_history↔快照 / 引用↔资源+孤儿 / 树父子链）。
2. **双端收敛**：A、B 该文档 `contentHash` 相同；资产清单（size+sha256 实读、不轻信 `contentHash` 缓存）一致。
3. **云端一致**：`s3-ls --prefix <isolated> --count/--note <id>` 与 latest manifest 声明一致；**无未引用堆积**；在用资产未被 GC 删；`purge` 后对象已删。

> 这就是"数据验证"：把体检从"手动看一眼"变成"每次同步后自动断言 0 不一致"。

---

## 3. 执行协议（多跑几遍 + 真实云）

- **本地双端**：`./scripts/ab-verify.sh`（需 `S3_AK/S3_SK`；用**隔离前缀** `S3_PREFIX` + 结束自动清理）。
- **扩展为场景跑批器**：把 `ab-verify.mjs` 从 2 场景扩到 **S1–S10**，每场景结束跑 **门禁断言**，输出 PASS/FAIL。
- **N 轮重复**：跑批器内部循环 N 次（随机种子/随机操作顺序），每轮结束过门禁 —— 用于"压可靠性"。
- **真实云 Tier B**：`LAKE_RUN_BENCHMARK=1 LAKE_STRESS_S3_ENDPOINT=... _REGION=... _BUCKET=... _AK=... _SK=... vitest run electron/syncStress.benchmark.test.ts` + 场景跑批器用真实七牛桶（**隔离前缀**、结束复核 **0 残留**）。
- **壳/冒烟**：`scripts/e2e-*-smoke.mjs`、`npm run test:packaged:full`、`scripts/check-core-boundaries.mjs`。

---

## 4. 对抗性回归测试（把踩过的洞固化，防复发）

把以下写成单测/集成测试：
- 幽灵文档（S6）· `purge` 复活（S3/S10）· 回收站可编辑（S7）· 冲突丢数据（S2）· 恢复缺资产/残标记（S4）· 小记互染（S8）。

---

## 5. 判定标准与通过阈值

- **单轮 PASS** = 所有场景 + 门禁全绿。
- **多轮可靠** = 本地双端 ≥ **10 轮全绿** + 真实云 ≥ **5 轮全绿** + 831 单测 + A1 测试。
- **任何 FAIL** → 记录场景/操作/错误/云端对象，作为回归用例；修复后重跑。

---

## 6. 建议的落地顺序

1. 先做"**跑完自动体检 + 断言 0 不一致**"这一层门禁（最小改动，叠在 `ab-verify.sh` 上）。
2. 再扩 `ab-verify.mjs` 到 **S1–S5**（日常主场景）。
3. 然后加 **S6–S10**（对抗/边界/小记/备份恢复）。
4. 最后做 **N 轮重复 + 真实云 Tier B**（隔离前缀 + 清场复核）。

---

## 7. 安卓端（另列，联调难）

- 安卓端验证难点：真机资产 `127.0.0.1:19876` 不可达、WebView/CDP 调试、原生构建循环。
- 建议：用 `scripts/emu-cdp.sh`(转发 WebView→CDP) + `scripts/android-build.sh` 自动化；资产 URL 用 `adb reverse tcp:19876` 或同 origin/blob。
- 全流程场景矩阵在移动端复用同一套同步引擎（`src/core` 端口化），**引擎级验证已在 §1 覆盖**；移动端重点是**真机 UI/IME/粘贴/资源可达**的冒烟。
-（手写 / Pad 支持为后续需求，暂不在本矩阵内。）

---

*本文由 Lake Notes 项目会话整理（验证方案，未改动代码）。关联：`docs/OBSIDIAN-PLUGIN-PLAN.md`(若转 Obsidian 插件则另立验证)。*
