# 规模验收脚手架（10k 文档 / 100k 附件 / 2GB 便携包）

目标：在**完全隔离的 /tmp 数据**上，用真实产品代码路径（Store / IPC / 真实 Electron UI / 真实
便携包导出）验证目标规模是否可用，并把「启动、目录树、搜索、打开文档、资源统计、设置页、便携包导出」
的实测值固化成固定字段 JSON 报告。

> 红线：**绝不触碰** `~/Library/Application Support/lakex-local-notes`（正式）与
> `lakex-local-notes-dev`（开发）；所有数据/导出/日志都在 `/tmp/lake-scale-*`，可随时 `rm -rf`。
> 所有 Electron 进程只用**本次脚本的 CDP 端口**定位并回收，绝不 `pkill -f Electron`。

## 目录

```
scripts/scale-acceptance/
  seed-large-library.mjs           # ① 造大库（10k 文档 + 100k 附件 ≈ 2GB）
  seedLargeLibrary.gated.test.ts   #    种子实现（gated vitest：走真实 Store）
  measure.mjs                      # ② 启动应用测启动/树/搜索/打开/资源统计/设置页
  portable-2gb.mjs                 # ③ 2GB 便携包导出 + 结构校验 + unzip 交叉校验 + 清理
  lib/cdp.mjs                      #    零依赖 CDP 客户端
  lib/env.mjs                      #    隔离路径/端口/应用启停/日志/目录统计
electron/portable/
  portableExport2gb.gated.test.ts  # ③ 的导出与校验实现（gated vitest，默认 skip）
```

## 前置条件

- Node 24（`node -v` ≥ v24）；仓库已 `npm install`（vitest / better-sqlite3 / electron 都在 node_modules）。
- 本机没有 `tsx` / `vite-node`：所有 TS 逻辑都用 **vitest 直接跑**（因此交付物里是
  `*.gated.test.ts` + `.mjs` 编排脚本，二者靠环境变量通信）。
- ② 默认被测应用 = 本仓 **dev Electron + `LAKE_RENDERER=scheme`**（服务已构建的 `dist/`，
  所以先要有 `dist/index.html` 与 `dist-electron/main.js`；`npm run build:web` / 主进程构建）。
  需要真打包 `.app` 时设 `LAKE_SCALE_APP=/abs/path/LakexLocalNotes.app/Contents/MacOS/LakexLocalNotes`。
- 脚本自己 `env -u ELECTRON_RUN_AS_NODE` 启动 Electron（DSH 宿主会注入 `ELECTRON_RUN_AS_NODE=1`）。
- 端口默认：CDP `9411`、资源服务 `19911`（占用会直接报错，换 `--cdp-port/--asset-port`）。

## ① 造大库：seed-large-library.mjs

```bash
# 完整规模（10,000 文档 + 100,000 附件 × 20KiB ≈ 2.0GB）：本机实测约 3.7 分钟
node scripts/scale-acceptance/seed-large-library.mjs

# 小规模自证（先验证脚手架本身，约 3 秒）
node scripts/scale-acceptance/seed-large-library.mjs --docs 100 --assets 1000 --notebooks 5 --root /tmp/lake-scale-seed-smoke --force
```

选项：`--root`（默认 `/tmp/lake-scale-seed-<时间戳>`）、`--docs`、`--assets`（必须能被 docs 整除）、
`--asset-bytes`（默认 20480）、`--notebooks`（默认 20）、`--asset-port`、`--report`、`--force`。

写入方式（**不是裸 SQL 造行**）：

- 文档/标题/树/正文/FTS 全部走产品 `Store`：`createNoteIn` → `saveNote`（正文引用附件 ⇒ 进全文索引、
  进资源引用集），所以搜索、目录、正文读取都是产品真实写入路径的产物；
- 附件文件按真实命名约定 `{13位时间戳}_{8hex}.{ext}` 由 Node fs 写入
  `workspace-default/note-assets/<noteId>/`，并在正文里以 `<card type="inline" name="file">` 引用
  ⇒ 桌面端「在用资源」判定（`extractAssetRefs`/孤儿判定/资源统计）会认；
- 不经过 `upload_resource` IPC，因此**不产生 DB 资产行**（桌面端本就没有资产表，资产声明由正文推导）。

输出：`<root>/seed-report.json` + `<root>/seed-summary.json`（字段固定：target / actual / timings /
checks / host；任一 check 失败 ⇒ vitest 失败、编排脚本退出码非 0）。
目标目录必须不存在（重复运行要 `--force`，且只允许 `/tmp/lake-scale-*`）。

## ② 大库验收测量：measure.mjs

```bash
node scripts/scale-acceptance/measure.mjs --seed /tmp/lake-scale-seed-<ts> --label 261114-10k
# 想看缓存热启动：--runs 2（每轮都重启应用；报告里 summary 给 min/median/max）
```

测量项（全部写进 `<seed>/measure-report.json`；预算见脚本 `BUDGETS`，只用于判「不可用」而非排名）：

| 指标 | 定义 |
| --- | --- |
| `firstScreenMs` | spawn → 外壳（`.tab-bar`）出现 |
| `treeFirstRowMs` / `treeRowsMs` | spawn → 目录树第一行 / 全部预期节点（10k+）渲染完成 |
| `tree.renderedRows` / `tree.domNodes` | 实际渲染行数（是否被虚拟化/截断）与整页 DOM 节点数 |
| `tree.listTreeNodesMs` | 产品 IPC `listTreeNodes` 往返（数据层是否跟得上 UI） |
| `searchHitMs` | 触发 ⌘K → 输入关键词 → 结果行出现（真实面板 + input 事件） |
| `openDocMs` | 点击目录行 → 目标 tab 的 `.ne-engine` 渲染完成（挑当前未打开的文档；首篇含内核 chunk 懒加载） |
| `openDocWarmMs` | 已有 tab 时再开一篇 |
| `storageMs` + `storage.storage` | `getSystemInfo()` 的资源统计（磁盘资产数/字节、笔记数、DB 字节）往返 |
| `resourcePageMs` | 打开顶栏「资源」页并渲染完成 |
| `settingsMs` | 打开偏好设置面板并渲染完成（含「数据维护」分组可见） |
| `memory` | 页面 DOM 节点数 / JS heap / 主进程 RSS |

硬判据（失败 ⇒ 退出码 1）：应用与桥就绪、目录树渲染出全部预期节点、搜索有命中且命中样例、
打开文档正文校验通过、资源统计资产数匹配、资源页/设置页可用。
报告同时记录 `budgetChecks`（每项预算/实测/是否通过）与 `runs[].cleanup`（是否残留进程/端口是否释放）。

## ③ 2GB 便携包验收：portable-2gb.mjs

```bash
# 完整验收（导出 2GB → 结构/计数/manifest 校验 → 抽样 CRC 读回 → 系统 unzip -t → 默认删除 2GB 包）
node scripts/scale-acceptance/portable-2gb.mjs --seed /tmp/lake-scale-seed-<ts>

# 想保留包给 root 复核（默认删除；报告里写保留/删除与路径）
node scripts/scale-acceptance/portable-2gb.mjs --seed /tmp/lake-scale-seed-<ts> --keep-package

# 直接跑 gated vitest（一般不需要；编排脚本会注入环境变量）
PORTABLE_2GB=1 LAKE_SCALE_SEED_ROOT=/tmp/lake-scale-seed-<ts> \
  PORTABLE_2GB_OUT_DIR=/tmp/lake-scale-portable-out PORTABLE_2GB_REPORT=/tmp/.../portable-report.json \
  npx vitest run electron/portable/portableExport2gb.gated.test.ts
```

导出走产品真实 `exportPortablePackage`（`snapshotDatabases` 用 `Store.backupDatabaseTo` /
`QuickNotesStore.backupDatabaseTo`，与 `electron/boot/ipcWiring.ts` 的 registerPortableIpc 同款口径），
不是重写一份 zip 逻辑。校验项：

- **结构**：EOCD / ZIP64 EOCD（>65535 条目必须有）/ 中央目录条目数 / 所有条目 `method=0` /
  本地头签名与 CRC/大小一致；
- **manifest**：`parsePortableManifest` 全量（format/formatVersion/hasHistory/limitBytes/source/counts/baseline）；
- **计数**：`counts.bytes === 所有条目数据字节和`；`counts.notes/assets/quickNotes/folders/tags` 与条目前缀统计一致；
- **白名单**：不含 `history/`、`draft-journal/`、`logs/`、`backups/`、`settings.json`、`window-state.json`、
  `sync-v3/state.json`、`sync-v3/baseline.json.gz`；所有条目路径安全（无 `..`/绝对路径/反斜杠/空段）；
- **抽样读回**：manifest + 两个 DB（SQLite magic）+ baseline + 正文（含种子正文标记）+ 若干附件
  （按本地头偏移真实读数据并重算 CRC32）；2GB 包不能整包进内存，这里用按需 seek 的流式校验
  （`readStoreZip` 只适合小包）；`verify.sample` 记录抽样明细；
- **外部交叉读取**：系统 `unzip -t` 校验全部条目 CRC（独立实现，证明不止自研读取器能读）；
- **移动端导入前兼容**：从 `android/.../PortablePackagePlugin.kt` 读 `MAX_ENTRIES` 与
  `4GiB` 上限做判定（不抄常量，避免漂移）。

退出码：`0` 全过；`2` = 包本身导出/格式校验通过，但**移动端导入前兼容失败**（见下）；
`1` = 导出/校验失败。默认校验完删除 2GB zip（`--keep-package` 保留），报告 `retention` 记录路径与是否删除。

**已修复（261114）**：Android `PortablePackagePlugin` 的 `MAX_ENTRIES` 100,000 → **250,000**
（目标规模 10k 文档 + 100k 附件实测 110,005 条，旧上限会让手机报「zip 条目过多」）。
修复后 `mobileCompat.verdict = pass`；zip bomb 仍由 4GiB 包体、逐条路径/越界校验与解压总量兜底。
⚠️ 真机 2GB 导入本级未执行（系统文件选择器无法在 CI/CDP 里自动化；且 2GB 包 staging+payload 需要手机
至少约 4GiB 可用空间，本机 AVD 7GiB 可用但未做端到端导入）；如需发版前最终确认，需人工在真机走
「设置 → 备份与恢复 → 便携包导入」。


## 本次实测记录（261114，Apple M1 / 8 核 / 16GB / macOS 27.0.0）

> 下面数字是**一次本机实测**，只用于判断量级与可用性；重跑以报告 JSON 为准，不要当长期契约/门禁数值。

环境：dev Electron 44.9.3 + `LAKE_RENDERER=scheme`（dist 构建于 2026-11-14T05:23Z，`app.isPackaged=false`；
内核 Chromium 152）。seed：`/tmp/lake-scale-seed-full`（10,001 笔记 / 10,022 树节点 / 100,000 附件 /
2,052,500,000B 附件（1.91GiB）/ 工作区 2.0GiB）。

### ① 种子（seed-large-library.mjs）

| 项 | 值 |
| --- | --- |
| 文档/附件 | 10,000 / 100,000（每篇 10 个，文件约 20.5KiB） |
| 耗时 | 总 223.8s（createNoteIn 101.5s + saveNote 113.9s + 写附件 6.5s + 校验 1.4s） |
| 校验 | 树/笔记/笔记本数、附件数/字节、FTS 搜索命中、正文回读、10 张 file 卡全部通过 |

### ② 大库测量（measure.mjs --runs 2：冷/热各一次）

| 指标 | run1（冷缓存） | run2（热） | 预算 | 判定 |
| --- | --- | --- | --- | --- |
| 首屏（外壳出现） | 1284ms | 200ms | 3000ms | ✅ |
| 目录树首行 / 全部 10,022 行 | 374ms / 433ms | 196ms / 262ms | 5000 / 20000ms | ✅ |
| 搜索命中（⌘K + 输入） | 445ms | 1928ms | 1500ms | ✅（中位数 445ms） |
| 打开文档（正文渲染） | 369ms | 388ms | 4000ms | ✅ |
| 再开一篇（已有 tab） | 565ms | 544ms | 4000ms | ✅ |
| 资源统计 getSystemInfo | 891ms | 782ms | 2000ms | ✅ |
| 「资源」页 | 535ms | 606ms | 3000ms | ✅ |
| 设置页 | 127ms | 127ms | 3000ms | ✅ |
| boot.ready（主进程日志） | 778ms | 478ms | — | — |
| 目录树 IPC listTreeNodes | 204ms → 158ms | 57ms | — | — |

- 目录树**未虚拟化**：10,022 行全部真实进 DOM，整页约 **20.1 万个 DOM 节点**；
  renderer JS heap ≈ **313–317MB**，主进程 RSS ≈ **48MB**（10k 文档规模下）。
- 收尾：两轮都 `leftoverPids=[]`、CDP/资源端口均已释放、无强杀。
- 结论：**10k 文档 + 100k 附件规模下，启动/目录/搜索/打开/资源统计/设置页均可用**；
  主要成本在内存/DOM 体量（树未虚拟化）与首次搜索（约 0.4–1.9s），未见崩溃或不可用。
- 报告：`/tmp/lake-scale-seed-full/measure-report.json`（`verdict.pass=true`）。

### ③ 2GB 便携包（portable-2gb.mjs）

| 项 | 值 |
| --- | --- |
| 包大小 / 条目 | **2,144,238,677B（2.00GiB）/ 110,005 条**（ZIP64 EOCD，store-only） |
| 导出耗时 | 总 39.6s（快照 37ms + 白名单遍历 978ms + 写 zip 38.5s） |
| 结构校验 | 166ms：manifest 通过、counts.bytes 与数据字节和一致（差额=manifest 自身 556B）、条目前缀统计一致、无禁区文件、路径全部安全、ZIP64 正确、8 条抽样（manifest/两 DB/baseline/正文/附件）CRC 全过 |
| 外部交叉读取 | 系统 `unzip -t` 全部条目 CRC 通过（12.2s，110,005 条） |
| 移动端导入前兼容 | **PASS（修复后）**：Android `MAX_ENTRIES=250_000` ≥ 110,005；`mobileCompat.verdict=pass`（真机端到端导入未执行，见上） |
| 清理 | 默认删除 2GB 包；报告记录路径与 `deletedBytes` |

- 结论：**便携包导出/格式/Android 导入前兼容在 2GB、110,005 条规模下全部 PASS**（ZIP64、store-only、
  Java ZipInputStream 口径；`MAX_ENTRIES` 已提到 250,000）。**真机端到端 2GB 导入未执行**（见上）。
- 报告：`/tmp/lake-scale-seed-full/portable-report-250k.json`（历史失败报告：`portable-report.json`）。

## 清理

```bash
# 所有脚手架产物都在这个前缀下（2GB 级，别忘删）
rm -rf /tmp/lake-scale-*
# 只清种子但留报告：rm -rf /tmp/lake-scale-seed-<ts>/workspace-default
# 别碰正式/开发数据目录；也不要用 pkill -f Electron
```

报告与日志都在对应 seed 目录里（`seed-report.json` / `seed-summary.json` / `measure/<run>-app.log` /
`measure-report.json` / `portable-report.json` / `portable-out/unzip-test.log`），删前可先拷出。

## 限制与风险（如实记录）

- `measure.mjs` 默认用 **dev Electron + scheme**（`app.isPackaged=false`）：启动路径与真包接近但
  不等价；真包验收请设 `LAKE_SCALE_APP` 并用同一套脚本。
- 启动数值含浏览器缓存首次冷启动；`--runs 2` 才能看热启动。单轮 p95 无统计意义（n 小）。
- 合成附件是 20KiB 同构文本（非真实图片/PDF）：验证的是「数量 + 体积 + 引用关系」的规模行为，
  不代表图片解码/缩略图/远端下载成本。
- 桌面目录树当前**不是虚拟列表**：10k 节点会真实产生约 1 万个 DOM 行、整页 20 万级 DOM 节点
  （实测见报告 `tree.domNodes`）。是否要做虚拟化是产品决策，本脚手架只负责量化。
- `measure.mjs` 会让被测 app 写一点设备本地状态（最后打开文档/窗口状态），没有业务数据语义。
- 便携包验收会把合成 `sync-v3/baseline.json.gz` 写进 seed 工作区（模拟「已同步过的用户」），
  报告 `baselineCreated` 记录是否新建；不触碰任何真实云端。
