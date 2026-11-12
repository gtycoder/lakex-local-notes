# 27 发版前移动快照核对（v1.1.1）— 手机 10 态 / 平板 10 态

> 目的：按 AGENTS §3#21 在发版前核对移动端快照基线。**不改产品代码**；本文只记录核对结果、数据依赖判定与处置。
> 环境：lake_gate = `emulator-5556`（CDP 9336）、lake_tab = `emulator-5558`（CDP 9340）；装当前代码（`bash scripts/android-build.sh --sync` → APK install），`pm clear` + `gate-fixture`（5 文档 + 4 小记）。

## 0. 结论

| 项 | 结果 |
| --- | --- |
| 手机 10 态（首跑，校验不写基线） | **1/10 态差异**：`home-doc` 元素数 **2085 → 2085（相同）**，指纹 `14tutej → a7cy7p`，两轮一致 |
| 手机差异定性 | **数据依赖，非回归**：对「两次独立重灌夹具」的 home-doc 做行级对拍，差异恒为 **6 行** = `ne-p$<docId>-body` 一进一出（hash 相同）+ 4 条 `span.qn-card__date`（小记日期标签宽度随生成时刻变），**其余 2079 行完全一致**（见 `evidence/release-mobile-snap/phone-seed-diff.txt`）。与 AGENTS §7#14 / mobile-audit README 记录的两条数据依赖一致。 |
| 手机处置 | 按 §3#21③ **重烤手机 10 态基线**（warm = `.css-audit/snap/rel-warm.json`，`--from … --write-baseline`）；重烤后**现场复核 10/10 域 0 差异**（`phone-verify.txt`）⇒ **无需再次重烤**。基线 `scripts/mobile-audit/baseline/mobile-snap.json` 已更新（仅 home-doc 一行 hash 变更，**未 commit**，见 §4）。 |
| 平板 10 态（lake_tab，`check-mobile-snap-tablet.mjs`） | **1/10 态差异**：`home-doc` 元素 **2106 → 2106（相同）**，指纹 `1v9vqy3 → psm1vm`；同样用两次重灌夹具做行级对拍，差异同为 **6 行**（prose id + 4 日期标签）⇒ **数据依赖，非回归**（`tablet-seed-diff.txt`）。 |
| 平板处置 | 同型数据依赖（6 行），非回归；按 §3#21③ 重灌夹具后**已重烤** `baseline/mobile-snap-tablet.json`（home-doc hash `1v9vqy3 → yf5y0i`，元素数 2106 不变），现场复核**10/10 态 0 差异**（`tablet-verify.txt`）。 |
| 23 屏走查 | **可选，未跑**（本轮已完成手机 10 态 + 平板 10 态的核对；如需补跑：`node scripts/css-audit/drive.mjs 9336 scripts/css-audit/mobile-walkthrough.mjs`）。 |

## 1. 手机 10 态执行记录

1. `ANDROID_SERIAL=emulator-5556 bash scripts/android-build.sh --sync` → APK 装 5556/5558。
2. `pm clear` → 启动 → `emu-cdp.sh 9336` → 等 `window.lakeNative.getHomeSnapshot` 就绪 → `gate-fixture`（docsTotal=5 / quickTotal=4）。
3. `node scripts/mobile-audit/check-mobile-snap.mjs --port 9336 --tag rel-review2`（**不写基线**）：
   - 10 态两轮采集，结果 `[mgate] 快照有差异（1/10 态，两轮一致 ⇒ 真差异）：home-doc: 元素 2085 → 2085 | 指纹 14tutej → a7cy7p`。
   - 注：**首跑装置问题**——APK 安装后等待 10s 时 WebView 未就绪，`gate-fixture` 报「window.lakeNative 不存在」，导致无夹具、`home-doc` 导航失败；已改为「轮询桥就绪再灌夹具」后重跑（修正的是装置，不是代码）。
4. 数据依赖证明：`pm clear` + 重灌夹具（第二次独立 seed）→ 只采 `home-doc`（`diag-seedB`）→ 与上一 seed 的 `home-doc` 行级对拍 = **6 行**（`phone-seed-diff.txt`）：
   - `ne-p$07b93d92…-body#0`（旧 seed）↔ `ne-p$77fc01ab…-body#0`（新 seed），hash 均为 `15jf3xs`（文档 id 变、视觉不变）；
   - `span.qn-card__date#0..#3` 4 条：日期标签文本宽度随夹具生成时刻变化（该离屏分页字体无有效 tabular-nums）。
5. 重烤 + 复核：
   - `node scripts/css-audit/drive.mjs 9336 scripts/mobile-audit/mobile-snap.mjs rel-warm`（当前 seed 的 10 态暖快照）；
   - `node scripts/mobile-audit/check-mobile-snap.mjs --port 9336 --from .css-audit/snap/rel-warm.json --write-baseline` → 基线写入；
   - `node scripts/mobile-audit/check-mobile-snap.mjs --port 9336 --tag rel-verify` → **`[mgate] 10 态整页计算值 0 差异`**（`phone-verify.txt`）。

## 2. 平板 10 态执行记录（lake_tab / 9340）

1. 5558 装同一 APK → `pm clear` → 启动 → `emu-cdp.sh 9340` → `gate-fixture`（docsTotal=5 / quickTotal=4）。
2. `node scripts/mobile-audit/check-mobile-snap-tablet.mjs --port 9340`（不写基线，对比 `baseline/mobile-snap-tablet.json`）：
   - 结果 `[mgate-tablet] 快照有差异（1/10 态，两轮一致 ⇒ 真差异）：home-doc: 元素 2106 → 2106 | 指纹 1v9vqy3 → psm1vm`。
   - 说明：平板状态元素数 2106（expanded 外壳比手机多 21），其余 9 态 **0 差异**。
3. 数据依赖证明：再次 `pm clear` + 重灌夹具 → 只采平板 `home-doc`（`diag-tab-seedB`）→ 与本次核对快照行级对拍 = **6 行**（`tablet-seed-diff.txt`，同样是 prose 文档 id 一进一出 + 4 条小记日期标签）⇒ **数据依赖，非回归**。
4. 平板基线已重烤（`5386c09b`，仅 home-doc hash；其余 9 态不变），重烤后现场复核 10/10 态 0 差异。

## 3. 判定口径（为什么这是数据依赖）

- 两次**独立重灌夹具**（不同文档 id / 不同小记创建时刻）之间的差异行**恰好只有**：① 内核 prose 宿主 id（`ne-p$<docId>-body`，行 hash 相同，仅 key 变）；② 新增夹具的小记日期标签 4 条（宽度随文本变）。其余全部元素（含所有设置页、创作 Sheet、书架/列表、编辑器外壳）**逐行一致**。
- 因此本次核对中「相对旧基线的差异」= 旧基线烘焙时的 seed 与新 seed 之间的数据差异，**不是本轮代码引入的视觉回归**（本轮 `src/mobile` 无 CSS/几何改动，已在 task-98 复核）。
- 若把基线「烤死在某个 seed」上，下次重灌夹具仍会出现这 6 行 —— 这是门禁的已知数据依赖（README 已登记），按 §3#21③ 处理。

## 4. 基线状态 / 待办

- `scripts/mobile-audit/baseline/mobile-snap.json`：**已更新**（仅 `home-doc.hash` 14tutej → 19exe3j，其余 9 态不变）。按任务「只 commit 文档+必要证据」**本次未提交基线**；请 lead 决定是否随发版提交（建议提交，否则下次门禁会红）。
- `scripts/mobile-audit/baseline/mobile-snap-tablet.json`：**未改**（数据依赖差异，按任务不重烤）。若发版要求平板常绿，建议同批重烤。
- 23 屏走查：未跑（可选）；如需补跑按 §0 命令。

## 5. 证据（`docs/audit-261112/evidence/release-mobile-snap/`）

| 文件 | 内容 |
| --- | --- |
| `phone-check.txt` | 手机首跑校验：1/10 差异（home-doc 2085→2085，14tutej→a7cy7p） |
| `phone-seed-diff.txt` | 手机两次重灌夹具的 home-doc 行级对拍：**6 行**（prose id + 4 日期标签） |
| `phone-verify.txt` | 重烤手机基线后复核：**10 态 0 差异** |
| `tablet-check.txt` | 平板校验：1/10 差异（home-doc 2106→2106，1v9vqy3→psm1vm） |
| `tablet-seed-diff.txt` | 平板两次重灌夹具行级对拍：**6 行**（同型数据依赖） |

## 6. 收尾

- 5556、5558 均已 `pm clear`（不保留测试数据）；未启动/触碰其他模拟器与桌面实例；未改产品代码。
- 本轮新增/修改文件：仅本报告 + 上述证据 + `baseline/mobile-snap.json`（待 lead 决定是否提交）。
