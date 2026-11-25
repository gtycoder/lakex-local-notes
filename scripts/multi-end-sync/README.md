# 多端 S3 同步回归脚手架

本目录是「多端真实云同步」的脚本资产。**统一入口 = `regression.mjs`**（261114 收敛）：
一条命令完成「自检 → 唯一前缀 → 启动 N 个隔离桌面 → 配置 S3 → 按场景断言 → 清理前缀并复核 0 残留」，
断言失败退出码非 0，全程只写 /tmp 与本前缀云对象。

移动端/真机的手工方法见下文「移动端/真机手工方法（A–K）」（261112 审计 21 号搬存）。
**本入口本轮只固化桌面多实例**；`--with-mobile` 明确报未实现（见下「移动端」）。

## 前置条件

- Node 24：`export PATH="$HOME/.nvm/versions/node/v24.18.0/bin:$PATH"`
- 仓库依赖已安装（`node_modules` 存在；需要 `node_modules/.bin/electron`、`@aws-sdk/client-s3`）
- 桌面 dev server：默认 `http://127.0.0.1:1421`。已在跑则复用；**未跑时脚本会自己 `npx vite` 启动并在结束时关掉**；
  不想要这个行为用 `--no-start-vite`。
- 端口默认：桌面 CDP `9242/9243/9244`，资源服务 `19891/19892/19893`（实例依次 +1）；
  被占用时脚本在启动前报错，用 `--cdp-base/--asset-base` 换一组。
- **不要用用户自己的 9222 / 19876/19877 实例**；本入口只 spawn 自己的实例、只 kill 自己的子进程。
- 隔离数据：默认写在 `<tmp>/lakex-s3reg-<时间戳>/instances`（每个实例独立 `LAKE_USER_DATA`），结束删除；
  `--keep` 可保留实例与目录排障。**绝不触碰正式数据目录 `~/Library/Application Support/lakex-local-notes`**。

## 凭据来源（不落仓库、不打印）

两种方式，二选一：

1. 环境变量（当前 shell 内 export，不写文件）：
   `export S3_ENDPOINT=... S3_REGION=... S3_BUCKET=... S3_AK=... S3_SK=...`
2. env 文件（推荐，chmod 600，放 /tmp 或仓库外，路径由 `S3_ENV_FILE` 指定）：
   `S3_ENV_FILE=/tmp/lake5/creds.env node scripts/multi-end-sync/regression.mjs ...`
   （文件格式 `KEY=VALUE`，支持 `export ` 前缀与 `#` 注释；脚本只读、不回显、不写入报告。）

脚本从不打印 AK/SK，报告里只有 endpoint/bucket/prefix/region。**不要把凭据写进仓库、README 或日志。**

## 命令

```bash
export PATH="$HOME/.nvm/versions/node/v24.18.0/bin:$PATH"
cd "$(git rev-parse --show-toplevel)"

# 1) 看场景清单（不启动任何东西）
node scripts/multi-end-sync/regression.mjs --list

# 2) 自检（不访问网络、不启动实例；无凭据也退出 0）
node scripts/multi-end-sync/regression.mjs --dry-run
node scripts/multi-end-sync/regression.mjs --dry-run --scenarios all --instances 3 --loopback

# 3) 本机无凭据时的冒烟：内存 loopback S3（只监听 127.0.0.1，无外部网络）
node scripts/multi-end-sync/regression.mjs --loopback --scenarios A,B

# 4) 真实桶（默认 A,B 两实例）
S3_ENV_FILE=/tmp/lake5/creds.env node scripts/multi-end-sync/regression.mjs --scenarios A,B

# 5) 真实桶全量（2 端场景）+ 3 实例的 K
S3_ENV_FILE=/tmp/lake5/creds.env node scripts/multi-end-sync/regression.mjs --scenarios all
S3_ENV_FILE=/tmp/lake5/creds.env node scripts/multi-end-sync/regression.mjs --scenarios K --instances 3

# 6) 指定对象根前缀（例如用户桶里的项目前缀；清理只动 <base>/<唯一前缀>）
S3_ENV_FILE=/tmp/lake5/creds.env node scripts/multi-end-sync/regression.mjs --scenarios all --base-prefix lakex-notes-dev3

# 6) 指定前缀 / 保留现场排障
node scripts/multi-end-sync/regression.mjs --loopback --prefix audit-my-check-001 --keep
```

退出码：`0` 全 PASS 且前缀 0 残留；`1` 有断言失败或清理残留；`2` 参数/前置/致命错误；`130` 被 SIGINT/SIGTERM 中断
（第一次中断会等当前步骤结束、清理前缀/实例后退出；再按一次强制退出且不清理）。

日志与报告：默认 `<tmp>/lakex-s3reg-<时间戳>/regression.log` 与 `report.json`（含逐条断言、场景耗时、清理结果、
Node/Electron 版本），失败时打印路径。`--logs-dir` 可指定。

## 场景矩阵（桌面多实例口径）

| 场景 | 实例 | 断言要点 | 与 21 号手工场景（下文搬存）的关系 |
| --- | --- | --- | --- |
| A | 2 | D1 建文档 + 上传图片资产 → 同步 → D2 正文逐字节一致、附件落盘、云端索引/资产对象/声明齐全 | 对应 21 的 A（21 用手机构造，本入口用桌面等价路径） |
| B | 2 | D1 编辑 + 移动 → D2 拉取后正文更新且位置不被回滚；反方向 D2 编辑也不回滚位置 | 对应 21 的 B |
| C | 2 | D2 本地移入回收站（未同步）× D1 编辑发布 → D2 同步不整轮失败、正文应用、不隐式恢复；云端 trashedAt 非空 | 对应 21 的 C |
| D | 2 | D1 purge → 云端索引无该 id；D2 回收站保留副本 + cloudDeleted=true + 正文可读 + 不回传 | 对应 21 的 D（task-74 修复后的回归） |
| E | 2 | D2 恢复历史版本 → 正文回到旧版、**仍在回收站**；云端 trashedAt 非空 | 对应 21 的 E |
| F | 2 | D1 加编辑锁 → D2 isEditLocked/editLockedAt 一致、云端 isLocked/lockedAt 一致、两轮后仍只读 | 对应 21 的 F 的**传播部分**；21 里「UI 保存被拒」是 UI/入口层断言，由既有护栏 electron/s3v3/lockPropagation.test.ts 覆盖，本入口不驱动 UI |
| I | 2 | D1/D2 各追加一个图片资产 → 两端 note-assets/<id>/ 两个文件齐全、云端两个对象齐全 | 对应 21 的 I（桌面默认全量资产，无需移动 ensureNoteAssets） |
| J | 2 | D2 改错误 endpoint 后编辑并同步失败 → 恢复后两端正文逐字节一致、恢复轮 warnings=0 | 对应 21 的 J（用错误 endpoint 模拟断网，桌面等价） |
| K | 3 | D1 建 → D2 改 → D3 删 → 三端都在回收站、无活跃副本、云端 trashedAt 非空、D2 保留最后编辑正文并留历史 | 对应 21 的 K |

默认 `--scenarios A,B`（两实例，最小冒烟）。`--scenarios all` = `A,B,C,D,E,F,I,J`；
`K` 需要 `--instances 3`（显式 `--scenarios K` 而未给 3 会直接报参数错误）。

### 移动端（本轮未纳入入口）

**261114 真实桶手机↔桌面手工冒烟 PASS**（未固化进本入口）：模拟器 `pm clear` → 移动端 `saveS3Settings/saveSyncSettings(manual, deferAssets=false)` 配真实桶唯一前缀 → 建文档 + 上传 1×1 PNG（66B）并 `syncNow`；隔离桌面同前缀 `syncNow` 拉到正文 + 资产（落盘/预览可读）；桌面改正文同步 → 移动端同步拉回；前缀 9 对象收尾 residual=0，移动端凭据用后 `pm clear`。

- 移动端/真机步骤（AVD、`adb forward`、APK 安装、`pm clear` 备份还原）仍按上文「移动端/真机手工方法（A–K）」手工执行；
- `--with-mobile` 目前会**明确报「未实现」并退出 2**（不会静默降级），避免误以为跑过移动端；
- 桌面 A–K 场景已覆盖同一批同步一致性断言；「移动端特有」的部分（WebView 桥、deferAssets 按需资产、UI 只读横幅）仍需设备级验收。

## 移动端/真机手工方法（A–K；261112 审计 21 号搬存，原 `docs/audit-261112/21-s3-multi-end-mobile.md` 已删、git 可查）

> `regression.mjs` 只固化桌面多实例；移动端/真机按下文本节手工执行（`--with-mobile` 明确报未实现）。
> 261112 曾按本方法跑完 A–K（3 端 = 2 模拟器 + 1 隔离桌面 + 真实七牛桶）：A–C/E/F/G–K PASS；D 发现真缺陷「桌面 purge → 移动端不留回收站副本」，task-74 修复后同装置复跑 9/9 PASS。一次性证据（结果表/FAIL 明细/截图）在 git 历史 21 号报告。

### 装置

- 三端：M1 = emulator-5556（AVD `lake_gate`，CDP 9336）/ M2 = emulator-5558（AVD `lake_tab`，CDP 9337）/ D1 = 隔离桌面（`LAKE_USER_DATA=<tmp>/m72`、`LAKE_ASSET_PORT=19884`、CDP 9237、dev server 1421）。
- 真实桶**唯一前缀**（三端逐字相同，如 `audit-<stamp>`）；凭据只从 `S3_ENV_FILE`（chmod 600、仓库外）读取，不落仓库、不打印。
- 移动端装包 `bash scripts/android-build.sh --sync --install` 后 `pm clear` 干净起步；配置 = `saveS3Settings` + `saveSyncSettings(manual)` + `testS3Connection`（移动端只暴露 {}，以同步实测为准）。
- 驱动：`scripts/multi-end-sync/cdpclient.mjs` 连三端 + `@aws-sdk/client-s3` 直读本前缀 pointer/索引。断言原则 = **三端最终一致 + 云端索引状态 + 无整轮失败**；**真缺陷只登记不改语义**。

### 三端 API 差异（driver 需适配）

| 动作 | 移动端 | 桌面 |
| --- | --- | --- |
| 新建文档 / 移入回收站 / 彻底删除 / 回收站列表 | `createNote(title)` / `trashNote` / `purgeTreeItem` / `listTrashed` | `createNoteIn` / `deleteNote` / `purgeTrash` / `listTrash` |
| 读取（锁定判定） | `readNote().editLocked` | `readNote().isEditLocked` |
| 新建小记 | `createQuickNote(text)` | `createQuickNote({text, draftId, stagedImageIds})` |

### A–K 场景矩阵（移动端口径；断言 = 每条「额外必须钉死」项）

| 场景 | 断言要点 |
| --- | --- |
| A | M1 新建文档+图片卡 → 同步 → 云端索引含该文档与资产对象；D1/M2 拉到正文+图片卡 |
| B | D1 编辑正文 + 移动到另一笔记本 → M1 同步后正文更新且**位置不回滚** |
| C | M1 移入回收站（未同步）+ D1 编辑并同步 → M1 同步不抛错、正文应用、**仍在回收站**；D1/M2 跟随进回收站；云端 `trashedAt` 非空 |
| D | D1 purge → 云端索引不含该 id；M1/M2 回收站保留「云端已删除（仅本地）」只读副本（可恢复、不回传） |
| E | M1 恢复历史版本 → 只改正文、**不把文档移出回收站** |
| F | D1 加编辑锁 → M1/M2 同步后只读（`editLocked`/`editLockedAt` 三端一致）+ 保存被拒且正文零改动 |
| G | M1 建分组+子分组+子文档 → D1 父子关系正确；D1 移动分组到新笔记本 → M1 跟随 |
| H | M1 小记快路径（`syncQuickNote` → pushed）→ D1 拉到；M1 删除 → D1 活跃列表不含；陈旧保存被拒且首页不复活 |
| I | 资产双向：M1 上传图像卡 → D1 落盘；D1 追加 → 同步 + `ensureNoteAssets([id])` 后 M1 两个文件齐全 |
| J | M1 断网改 3 篇 → 开网同步不失败（warnings=0）→ 多轮后三端正文逐字节一致 |
| K | D1 建 → M1 改 → M2 删 → 三端各两轮：三端都在回收站、云端 `trashedAt` 非空、M1 回收站副本保留最后一次本地编辑正文 |

### 教训与语义备注（验收必读）

- **移动端「资产已传输」的验收必须在 `ensureNoteAssets([id])` 之后断言**（或先关 `deferAssets`）：移动端按需下载附件、普通轮不预拉；驱动传单字符串会 `e.filter is not a function`（签名是 `ensureNoteAssets(ids: string[])`）。
- 跨端删除/复活类场景用 **M1 建**避开两端 `createQuickNote` 签名差异（结论不受影响）。
- D 的最小复现与修复口径：D1 create→sync；M1/M2 副本到位；D1 trash→sync；D1 purge→sync；M1/M2 sync ×2 应见回收站只读副本。task-74 修复 = 移动端 `purgeLocalNote` 的**远端驱动收敛**改软删保副本（`trashed_at` + `deleted_from_parent_id` + `cloud_deleted=1`，不写墓碑、不删行/正文）；本机显式 purge 仍走 `trashRepository.purgeTreeItem`（物理删 + 墓碑）。
- d（同步 warning 逐项可见）的手工取证 = 接收端 SQLite 触发器故障注入（261112 task-67；方法在 git 历史 21 号 §6）。

### 收尾清理（强制）

- `DELPREFIX=<前缀> node scripts/multi-end-sync/delprefix.mjs` → ListObjectsV2 复核 **0 残留**；
- 桌面实例按 CDP 端口 PID 关（`lsof -nP -iTCP:<port> -sTCP:LISTEN -t` → kill；禁 `pkill -f Electron`）；两台模拟器 `pm clear com.lakexlocalnotes.android`；删除临时 `LAKE_USER_DATA`；
- 全程不 stub `input[type=file]`、不在画布作画（无桩/笔迹需还原）；真机测试前备份、测试后还原。

## 清理与失败排查

- **清理是强制收尾**（成功/断言失败/致命错误/第一次中断都会跑）：按本脚本记录的 PID 停实例 →
  `ListObjectsV2` 枚举 `<prefix>/` → `DeleteObjects` 分批删 → 再 `ListObjectsV2` 复核，**必须 residual=0**，
  否则退出码非 0 并在日志/报告里列出残留 key。`--keep-cloud` 可跳过删除（危险，仅离线演练用）。
- 前缀安全：默认 `audit-<UTC 时间戳>-<随机 4 位>`；`--prefix` 覆盖。**非 `audit-` 前缀默认拒绝清理**，
  确实要删别的目录必须显式 `--allow-unsafe-prefix`。启动前会先 ListObjectsV2 复核该前缀为空，非空直接拒绝复用。
- 常见失败：
  - `缺少 S3 凭据` → 按上文 export 或 `S3_ENV_FILE`；只想验证脚本用 `--loopback`。
  - `端口被占用: CDP 9242` → `--cdp-base 9252 --asset-base 19901`。
  - `vite 启动超时` / dev server 不可达 → 先手动 `npm run dev`，或去掉 `--no-start-vite` 让脚本自己起。
  - `实例 D1 提前退出` / `CDP 超时` → 看报告目录下 `D1-electron.log`、`D2-electron.log` 末尾。
  - `RESULT: FAIL` 但断言都 PASS → 看「前缀清理 residual」；残留通常意味着清理期间还有进程在写（确认实例已退出/`--keep` 未开）。
  - 偶发 `lock-busy` 由脚本自动重试（最多 3 次，仅锁竞争类错误），日志里不会静默吞错。
- 本脚本**不改产品语义**：断言口径来自 `docs/SYNC-PROTOCOL.md`、`AGENTS.md` 与本文移动端手工方法（261112 审计 21 号搬存）；发现真缺陷只登记 FAIL，不放宽断言。
  真实桶 FAIL 的场景要连同日志/报告一起交接，再决定改产品还是改场景。

## 与 21 号手工验收的关系

- 261112 的一次性**手工证据**（3 端含 2 台模拟器 + 真实七牛桶，A–K 结果、FAIL 明细、task-74 修复复跑）
  在 git 历史 `docs/audit-261112/21-s3-multi-end-mobile.md`（已删）；**方法已搬存到本文「移动端/真机手工方法（A–K）」**。
- 本目录 `regression.mjs` = 同一批场景的**可重复入口**（桌面多实例、自动清理、退出码/日志/报告固定），
  便于后续每次改动后复跑；两者不是替代关系：移动端特有面仍按本文手工方法执行。

## 文件

- `regression.mjs`：**统一入口**（本 README 主对象）
- `loopback-s3.mjs`：内存 S3（只实现产品传输层子集；`--loopback` 冒烟用，**不能替代真实桶结论**）
- `cdpclient.mjs`：极简 CDP 客户端（等 boot 遮罩结束、桥就绪、请求超时）
- `configure-s3.mjs` / `delprefix.mjs` / `s3verify.mjs`：单步工具（历史脚本仍在用；新流程不需要单独调用）
- `run58.sh` / `scenario58.mjs`：task-58 真实桶 B 档 13 条（含 S03/S05/... 协议细节断言）历史 driver；
  未删除，作为更细粒度协议场景参考。`run5b/run5c/run5d/run5e.mjs`：更早的边界/目录/压力/单端基准套件。
- `volume.mjs` / `eval.mjs` / `probe5.mjs`：量数据体量、单端 eval、5 端连通性历史脚本。

### 关于 scripts/packaged-performance/loopback-s3.mjs

那个 loopback 是**性能验收专用**，本入口不能直接复用（261114 实测）：它把前缀硬编码成 `perf-audit`、
只接受该前缀下的 key（其它 key 直接 500）、依赖 v2 `remote-manifest.json` 夹具、且只服务固定夹具对象。
本入口需要任意唯一前缀 + 完整 PUT/GET/List/Delete，因此另写了 `loopback-s3.mjs`（通用内存 S3 子集）。
两者的用途都只是「本机冒烟」；正式验收仍必须真实桶。

## 本机验证状态（261114）

- `node --check scripts/multi-end-sync/regression.mjs` / `loopback-s3.mjs`：通过；
- `--list`、`--dry-run`（含 `--scenarios all --instances 3 --loopback`）：通过（exit 0；无凭据只报 warn）；
- `--loopback` 冒烟（dev server 1421 复用）：A,B 21/21、其余 73/73、全量 94/94、K 14/14，全部 residual=0；
- 失败路径实测：占用 9242 → exit 2、清理 residual=0；SIGINT 中断 → exit 130、清理 residual=0；
- **真实七牛桶（261114 实测，PASS）**：endpoint `https://s3.cn-north-1.qiniucs.com` / region `cn-north-1` / bucket `local-lake-hebei`，对象根前缀 `lakex-notes-dev3`：
  - `--scenarios A,B --base-prefix lakex-notes-dev3` → **21/21 PASS**，前缀 12 对象删除后 residual=0；
  - `--scenarios all --base-prefix lakex-notes-dev3` → **94/94 PASS**（A–F/I/J），39 对象删除后 residual=0；
  - `--scenarios K --instances 3 --base-prefix lakex-notes-dev3` → **14/14 PASS**，9 对象删除后 residual=0；
  - 收尾对整个 `lakex-notes-dev3/` ListObjectsV2 = **0 对象**（凭据用后删除，不落仓库）；
  - 结果：真实桶桌面多实例 A–K 全部通过；**移动端/真机仍不在本入口**（`--with-mobile` 明确未实现）。

## 数据安全（务必遵守）

- 测试前**不要**动两个数据目录：正式 `~/Library/Application Support/lakex-local-notes`、开发 `...-dev`；
  本入口只用 `--userdata-root`（默认 /tmp）下新建的隔离目录。
- kill Electron **只 kill 本脚本 spawn 的 PID**；禁 `pkill -f Electron` / `killall`（会误伤其它应用与 DSH 宿主）。
- 真实桶只操作本脚本唯一前缀（可加 `--base-prefix` 限定对象根，如 `lakex-notes-dev3`）；结束必须 0 残留。真机测试前备份/测试后还原（见「移动端/真机手工方法」收尾清理）。
- 本目录脚本不写仓库文件、不提交；凭据永不入库。
