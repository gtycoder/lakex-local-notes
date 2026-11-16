# Electron 主进程分层审计（对照思源 PR 21151）

> 审计对象：`lakex-local-notes`，分支 `modernize/web-platform-261115`，2026-11-16。
> 只读仓库（未改任何 `src/**` / `electron/**`）；本文是唯一产出。
> 口径：`file:行号` 均指本仓当前工作树；「实测」= 本次实际跑过的命令（见 §7）。

---

## 0. 结论（先看这段）

**能不能照抄思源 PR 21151？不能照抄，但它的两块「护栏」值得直接拿过来。** 本仓和思源改造前**不是同一种债**：

| 思源改造前（本机 `siyuan-master/app` 克隆实测） | 本仓现状（实测） |
| --- | --- |
| `electron/main.js` 4601 行（PR 正文 5292），CommonJS，无类型 | `electron/main.ts` 1102 行，严格 TS（`tsconfig.json:6` allowJs:false、`:10` strict:true） |
| `package.json main: ./electron/main.js`、`electron-builder.yml files: ["electron"]` → **源码目录就是打包输入** | `package.json:6 main: dist-electron/main.js`、`:118-127 files` 白名单只读产物 |
| 无分层，无依赖方向校验 | 8 个子目录 + 0 环依赖，但**没有任何一条针对 `electron/**` 的机器门禁** |

三句话结论：

1. **「严格 TypeScript 分层模块」已完成约 85%**：`electron/` 146 个非测试文件 / 26,202 行，其中 8 个子目录 63 文件 / 9,195 行（35.1%）、根平铺 83 文件 / 17,007 行（64.9%）；依赖图 0 环、无人 import `electron/main.ts`、81/82 个根模块被其他层引用。**缺的不是重写，是「层序声明 + 机器校验」**——`scripts/check-arch.mjs` 的 import 方向规则只覆盖 `src/core|mobile|features|components`（`scripts/check-arch.mjs:58-90`、`:193`），**完全没有 `electron/` 这一项**。
2. **「打包输入与源码目录分离」已完成约 95%**：主进程产物是**单个** `dist-electron/main.js`（1,375,153 B，0 个动态 import），测试文件不在 `build.files` 里（对照思源改造前把 34 个 `*.test.js`（291KB）打进 `resources/app/electron`）。**残留面**只有「源树里 4 个文件被直接当打包输入」：`electron/preload.cjs`(18,757B) / `boot.html`(1,864B) / `boot-anim.apng`(328,449B) / `boot-poster.png`(27,756B)，合计 376KB，且它们把 **3 处硬编码相对路径**钉死在 `electron/main.ts` 里（`:86` / `:328` / `:379-380`）。
3. **真正该借鉴的只有三件事**：① 思源的 `electron/architecture.test.ts`（遍历全部生产文件校验相对导入 + `allowedDependencies`，**新增一级目录未登记直接失败**）；② 打包内容测试（产物清单是测试断言，不是文档）；③ 「装配与业务分离」的启动分支穷尽（`StartupBranch` + `assertNever`）。**不适用**的是「引入独立 build/ 源码入口层」——思源自己也没这么做（见 §1、§6）。

**建议批次数：3 批、约 10 人日**（A 门禁先行 2 → B 入口装配外迁 5 → C 静态资源与包清单分离 3）。A 批**零行为改动、当天可合并**，且是本仓 AGENTS §3#17「没有护栏不做大规模架构重写」的合规前提。

**三个关键数字**：

- `main.ts` 1102 行中，`whenReady` 单块 470 行 = 42.6%；窗口/生命周期 254 行 = 23.0%；IPC 注册只剩 **1** 个（`renderer-ready`，`:417`），其余 188 个在 `electron/ipc/`。
- `electron/` 非测试 26,202 行，实际进产物 25,164 行（3 个测试支撑文件 1,038 行不进包）。
- `electron/` 123/146 个文件不 import `electron` 包（纯 Node/领域代码），但其中只有 8 个子目录有名字，**根平铺 83 个文件没有层语义**。

---

## 1. 对照基线：PR 21151 到底改了什么

来源：PR 正文（[siyuan-note/siyuan#21151](https://github.com/siyuan-note/siyuan/pull/21151)）+ 本机 `siyuan-master/app` 克隆的**改造前**快照实测。

| 维度 | 改造前（实测本机克隆） | 改造后（PR 正文） |
| --- | --- | --- |
| 入口 | `app/electron/main.js`：4,601 行（PR 正文 5,292）单文件 CommonJS，同目录散着 CommonJS 模块与 `*.test.js` | `main.ts` 只做副作用导入 `./environment` + 调 `bootstrap()`；装配点在 `startup/bootstrap.ts` |
| 类型 | 无 tsconfig | 严格 TypeScript，分层 `shared / startup / window / kernel / remote / ipc` |
| 依赖方向 | 无约束 | `electron/architecture.test.ts` 遍历全部生产文件逐个校验相对导入，对照 `allowedDependencies`；新增一级目录未登记 ⇒ 失败 |
| 运行期状态 | 模块级散落 | `shared/runtime.ts` 的 `state` 唯一容器；`windowRegistry` 管窗口账本；直接访问 `state.windows` 被 ESLint `no-restricted-syntax` 拦 |
| 打包 | `package.json main: ./electron/main.js`、`electron-builder.yml files: ["electron"]`、`asar: false` ⇒ **整个源码目录进包**，实测含 34 个 `*.test.js`（291KB）与测试专用 `fixtures/` | webpack 以 `main.ts` 为入口 → 单文件 `electron-dist/main.js`；渲染脚本/静态页原样复制到 `electron/static/`；`files` 只读 `electron-dist`；新增 `scripts/build-electron.mjs`（清理 + `--watch`） |
| 顺序约束 | 隐式 | `startAfterReady` 接线顺序、启动三段流程写进 `app/electron/README.md` |

**关键澄清（影响本方案的判断）**：思源的 webpack 入口**仍然直指源码 `main.ts`**。所以 PR 21151 要解决的「源码目录 = 打包输入」问题，指的是**打包清单把源码目录整包收进去**（`files: ["electron"]`），**不是**「入口指源码」。本仓入口指源码（`vite.config.ts:49 entry: "electron/main.ts"`）但打包清单是白名单 ⇒ **同一问题在本仓已基本不存在**。

---

## 2. 本仓现状（实测）

### 2.1 规模

| 目录 | 非测试文件 | 非测试行数 | 占比 | 职责（事实） |
| --- | --- | --- | --- | --- |
| `electron/`（根平铺） | 83 | 17,007 | 64.9% | 存储/仓库/同步编排/导出/日志/安全模式/窗口/入口 |
| `electron/ipc/` | 25 | 2,576 | 9.8% | `registrar.ts` + 21 个 `register*.ts` + `bytes/errors/exportDirState`，188 个通道 |
| `electron/s3v3/` | 13 | 2,024 | 7.7% | S3 v3 桌面适配（协议纯逻辑在 `src/core/s3v3/`） |
| `electron/quickNotes/` | 9 | 1,898 | 7.2% | 小记库（261112 S-3 拆分；`electron/quickNotes.ts` 只剩 83 行门面） |
| `electron/webApi/` | 5 | 920 | 3.5% | 浏览器端（261112 S-4 拆分；`electron/webApiServer.ts` 只剩 244 行门面 + `WEB_METHODS`） |
| `electron/portable/` | 3 | 594 | 2.3% | 便携包 `.zip.lln` |
| `electron/update/` | 1 | 506 | 1.9% | 更新中心 |
| `electron/boot/` | 2 | 370 | 1.4% | `paths.ts`(80) + `ipcWiring.ts`(290)，261112 S-5 从 main.ts 拆出 |
| `electron/ai/` | 5 | 307 | 1.2% | AI 主进程侧 |
| **合计** | **146**（145 `.ts` + 1 `preload.cjs`） | **26,202** | 100% | 另有 163 个 `*.test.ts` / 22,597 行 |

**「进产物」口径修正（本仓统计的一个坑）**：3 个文件名里不带 `.test` 但是测试专用 —— `s3v3/deviceConformance.ts`(844) / `s3v3/fileDeviceStore.ts`(132) / `portable/zipTestReader.ts`(62)，共 1,038 行。实测从 `electron/main.ts` 出发做可达性遍历：145 个非测试 `.ts` 中 **142 个可达、这 3 个不可达**（不进 `dist-electron/main.js`）。⇒ **真实进产物 = 24,880 行 `.ts` + 284 行 `preload.cjs` = 25,164 行**。同一遍历口径下，产物还会打进 **136 个 `src/` 文件**（`src/core` 131 / `src/features` 3 / `src/lib` 2）。

### 2.2 `electron/main.ts` 的 block 级清单（1102 行 = 空 44 + 注释 191 + 有效代码 868，另 1 个末尾空行由 split 计入）

| # | block | 行范围 | 总行 | 代码行 | 判断 |
| --- | --- | --- | --- | --- | --- |
| 1 | import（75 条） | `1-75` | 75 | 75 | 正常 |
| 2 | 模块级单例/令牌/`runFullSync`/退出闸 | `77-230` | 154 | 96 | 单例集中，**符合 S-5 纪律**（`boot/paths.ts:4-11` 明文约定不搬家） |
| 3 | 可信页面判定 + CDN/资产 token 重定向 | `233-288` | 56 | 38 | **该搬**（协议/资源服务层） |
| 4 | boot splash 窗口 | `291-333` | 43 | 39 | **该搬**（窗口层） |
| 5 | 崩溃留档安装 | `338-355` | 18 | 9 | 可搬可不搬 |
| 6 | **`createWindow`（主窗口 + 5 类安全 handler + webPreferences）** | `357-522` | **166** | **138** | **该搬**（窗口层） |
| 7 | IPC 发送方可信判定 | `524-531` | 8 | 5 | 与 IPC/窗口同源，随 #6 走 |
| 8 | 广播助手（note-body / portable） | `533-553` | 21 | 17 | 该搬（广播层） |
| 9 | 进程级开关（`js-flags`/`crashReporter`/`child-process-gone`） | `555-568` | 14 | 6 | 顺序敏感，留入口 |
| 10 | **单实例锁 + `whenReady` 主装配** | `570-1058` | **489** | **410** | **主要问题**，见下表 |
| 11 | `before-quit` 退出前同步 | `1060-1087` | 28 | 24 | 顺序敏感，留入口 |
| 12 | `will-quit` / `window-all-closed` | `1089-1102` | 14 | 10 | 留入口 |

`whenReady` 内部 470 行（**占全文件 42.6%**）的 20 个子块：

| 子块 | 行 | 代码行 | 归属建议 |
| --- | --- | --- | --- |
| A 身份/菜单 | `582-599` | 12 | 留（1 处 Menu 装配） |
| B initLogger + 崩溃日志 + boot 窗口 | `600-606` | 6 | 留 |
| C 完整性预检 + crashMarker + 安全模式判定 | `607-629` | 16 | `boot/startupDecision.ts` |
| D Store 打开 + 恢复决策 | `630-643` | 14 | `boot/startupDecision.ts` |
| **E 恢复页 `showRecoveryWindow`（4 个业务回调）** | `644-717` | **68** | **`boot/recoveryWiring.ts`** |
| F store 赋值 + 文件对账器装配 | `718-746` | 24 | `boot/fileReconcileWiring.ts` |
| G S3 恢复 seed 回填 | `747-762` | 12 | `boot/startupDecision.ts` |
| **H 小记库打开/降级 + 标签迁移 + 孤儿清理** | `763-806` | **37** | **`boot/quickNotesWiring.ts`** |
| I `DraftJournal` | `807` | 1 | 留 |
| **J 自动备份 runner + 6h tick** | `808-864` | **52** | **`boot/backupWiring.ts`** |
| K 更新中心装配 | `865-884` | 18 | `boot/updateWiring.ts` |
| L CDN/资产 token/asset server | `885-887` | 3 | `boot/protocolWiring.ts`（配 #3） |
| M `registerIpc` 接线 | `888-911` | 23 | 留（**已纯接线**，实现在 `boot/ipcWiring.ts`） |
| N 浏览器端服务 | `912-923` | 10 | `boot/protocolWiring.ts` |
| O 标记消费 + `createWindow` + update 启动 | `924-934` | 6 | 留 |
| **P 历史兜底/清理定时器** | `936-987` | **43** | **`boot/timerWiring.ts`** |
| **Q 自动同步定时器** | `989-1014` | 20 | **`boot/timerWiring.ts`** |
| **R 开/关应用同步一次** | `1016-1032` | 11 | **`boot/syncWiring.ts`** |
| **S 回收站自动过期定时器** | `1034-1052` | 18 | **`boot/timerWiring.ts`** |
| T `activate` | `1054-1056` | 3 | 留 |

**按关注点汇总（归因可重叠：同一行可能同时算「装配」和「定时器」；数字均取自上表 block 行数）**：窗口/生命周期 254 行（23.0%，#4+#6+#11+#12+T）· 后台定时器与编排 177 行（16.1%，J+P+S+K+F）· 启动恢复/安全模式/健康 129 行（11.7%，C+D+E+#5）· 同步编排 ~95 行（8.6%，`runFullSync`+广播+Q+R+退出闸）· 协议与资源服务 62 行（5.6%）· **IPC 注册 24 行（2.2%，且已是纯 deps 表）** · 菜单 18 行（1.6%）· 模块级单例 154 行（14.0%）。

> `electron/main.ts:417` 是**唯一**不在 `electron/ipc/` 里注册的通道（`ipcMain.on("renderer-ready")`，`:422` 配 `removeListener`）。188 个 `invoke/handle` 通道全在 `electron/ipc/`，由 `electron/ipc/ipcChannelParity.test.ts:168-170` 钉死（`toBe(188)` × 三面）。

### 2.3 构建与打包链路（实测）

```text
源码 electron/main.ts（唯一入口）
  └─ vite.config.ts:47-54  vite-plugin-electron
       ├─ :49  entry: "electron/main.ts"
       ├─ :50  outDir: "dist-electron"，rollupOptions.external = isMainProcessExternal
       └─ :52  onstart: electron . --remote-debugging-port=${LAKE_CDP_PORT ?? 9222}
  ⇒ dist-electron/main.js（单文件 ESM，1,375,153 B，0 动态 import）
  └─ package.json:6   main: "dist-electron/main.js"     ← electron 运行时入口
  └─ package.json:7   "type": "module"                  ← 产物是 ESM（.js 即 ESM）
  └─ package.json:118-127  build.files 白名单：
       dist/**、dist-electron/**、electron/preload.cjs、electron/boot.html、
       electron/boot-anim.apng、electron/boot-poster.png、!**/*.map、
       !node_modules/better-sqlite3/{deps,build/Release/obj}/**
  └─ package.json:141-143  build.asarUnpack: ["electron/preload.cjs"]
```

- **external 派生**：`vite.config.ts:33-39` 从 `package.json dependencies` 派生 `mainRuntimeDeps`，`node:`/`electron`/`electron/` 前缀 + 硬编码 `@smithy/`（`@aws-sdk` 传递依赖）一律 external。设计正确（新增原生依赖不会漏项），但**没有护栏测试**——AGENTS §7#9 只说「别硬编码」，没有可执行判据。
- **产物是单文件**：`dist-electron/` 只有 `main.js`，无 chunk（`grep -c 'import('` = 0）⇒ 「构建输出与源码目录分离」在**产物侧已成立**。
- **`preload.cjs` 不进构建**：`electron/ipc/ipcChannelParity.test.ts:5-9` 明文记录「原生 CJS，`files`/`asarUnpack` 直接列该文件，不进 Vite 构建」。这是本仓**唯一**有意保留的「源树文件直接进包」设计，且已有四面一致性护栏。
- **打包验收链路已存在**：`scripts/ci-packaged-smoke.sh`（vite build → `electron-builder --dir` → asar `@img` 自检 → unpacked libvips 自检 → CDP smoke），`package.json:29/34` 的 `test:packaged` / `test:packaged:full`。**注意它不在 `npm run build` / 默认门禁里**。
- **已有「打包清单即断言」的先例**：`electron/bootAssets.test.ts:34-40` 断言 `build.files` 必须包含 boot.html + 两张图。**这正是扩成「打包内容契约」的现成位置**（见批次 A）。

### 2.4 依赖方向实测（遍历 145 个非测试 `.ts` 的相对导入，`.js` spec → 实际 `.ts` 归一）

- **环：0 个**。`electron/main.ts` **无人 import**（真入口）。
- **跨层边（18 类，源层 → 目标层）**：`ipc→root 63`、`quickNotes→root 40`、`boot→ipc 23`、`boot→root 8`、`s3v3→root 8`、`root→webApi 7`、`root→s3v3 6`、`ipc→s3v3 4`、`ipc→ai 3`、`root→ipc 2`、`root→boot 2`、`root→quickNotes 2`、其余各 1。
  - `root→webApi 7` / `root→quickNotes 2` 是**门面 re-export**（`electron/webApiServer.ts:31-34,236-244`、`electron/quickNotes.ts:12`），不是逻辑依赖。
  - 真正的「子系统互相依赖」只有 `ipc→{s3v3,ai,update,portable}` 共 9 条。
- **根平铺层是共享内核**：83 个根模块里 **81 个被其他层引用**，27 个被 ≥2 层引用（`store.ts` / `quickNotes.ts` / `syncTypes.ts` 各被 root+boot+ipc+s3v3 四层引用）。⇒ 根层事实上是 L1「领域/存储层」，但**这个身份没有任何文字或门禁声明**。
- **`electron/` 对 `electron` 包的依赖只有 23/146 个文件**（`ipc` 13、根 8、`boot` 2）；**123 个文件是纯 Node/领域代码**。⇒ 「进程无关层」已客观存在，只是没被承认。
- **`electron/` → `src/` 的方向**（按 `import|export … from` 语句计，共 275 条）：`src/core` 260 条 / 93 个文件（值 217、仅类型 43）✅ 方向正确；`src/lib` 12 条 / 10 个文件（仅类型 10、值 2 = `main.ts` 的 `layoutMetrics` + `store.ts` 的 `SAVE_CONFLICT_CODE`）⚠️ 未登记；`src/features` 3 条 / 1 个文件（`electron/noteExport.ts` 引 `features/ink/{inkGeometry,inkStrokeStyle,inkPageTexts}`）⚠️ **主进程反向依赖渲染层特性域**，未登记。
- **`electron/` → `src/mobile`：0 条（非测试）**。唯一的 `electron/s3v3/deviceConformance.mixed.test.ts:29-33` 是测试文件，合规。

### 2.5 既有门禁覆盖矩阵（本次全部实跑，基线全绿）

| 门禁 | 覆盖 `electron/`？ | 实测基线 |
| --- | --- | --- |
| `npx tsc --noEmit`（`tsconfig.json:21 include: ["src","electron"]`） | ✅ 类型（strict:true `:10`，allowJs:false `:6`，noUnusedLocals `:11`） | **0 error** |
| `node scripts/check-core-boundaries.mjs` | ❌ 只扫 `src/core` | 181 文件 / 0 违规 |
| `node scripts/check-arch.mjs` | ❌ import 方向规则只含 `src/core`/`src/mobile`/`src/features`/`src/components`（`:58-90`，循环 `:193`） | import 违规 0 条；desktop 首屏 577,093B / 600,000B PASS |
| `electron/ipc/ipcChannelParity.test.ts` | ✅ 通道四面一致（188） | 通过 |
| `electron/bootAssets.test.ts` | ✅ `build.files` 含启动页三件 | 通过 |
| `scripts/ci-packaged-smoke.sh` / `test:packaged:full` | ✅ 打包产物级 | 本次未跑（无 `release/` 产物） |

**结论**：`electron/` 的类型面有门禁、IPC 面有门禁、打包清单有 3 条正向断言，但**「层与依赖方向」零门禁**。

---

## 3. 判据逐条过：已具备 / 缺口 / 不适用

| # | 思源 PR 21151 的判据 | 本仓 | 证据 |
| --- | --- | --- | --- |
| 1 | 严格 TypeScript（strict、无 `.js` 源码） | ✅ **已具备** | `tsconfig.json:6,10,11,12`；145 个 `.ts` 非测试文件；`electron/preload.cjs` 是唯一 CJS（有意为之，`ipcChannelParity.test.ts:5-9`） |
| 2 | 按职责分层、目录有名 | 🟡 **部分** | 8 个子目录有名字（§2.1），但 **64.9% 的代码在根平铺 83 个文件里**；`docs/ARCHITECTURE.md:12-28` 的目录图缺 `boot/`、`quickNotes/`、`webApi/` 三个子目录 |
| 3 | 依赖方向机器校验（`architecture.test.ts` + `allowedDependencies`） | ❌ **缺口（最大）** | `scripts/check-arch.mjs:193` 的扫描根不含 `electron`；`electron/` 下无任何分层/架构测试 |
| 4 | 新增一级目录未登记即失败 | ❌ **缺口** | 同上；现状 8 个目录靠人记 |
| 5 | 打包输入 ≠ 源码目录 | 🟡 **大部分已具备** | `package.json:6,118-127,141-143` ⇒ 产物 `dist-electron` 单独目录、测试不打包；**残留** 4 个源树文件 376KB 直接进包（§0-2） |
| 6 | 产物位置与源码路径解耦（构建脚本负责复制静态资源） | ❌ **缺口** | `main.ts:86`（`APP_DIR`）、`:328`（`../electron/boot.html`）、`:379-380`（`app.asar.unpacked/electron/preload.cjs`）3 处硬编码相对路径，无护栏 |
| 7 | 运行期状态单一容器 + 窗口账本 + 禁直连 | 🟡 **部分 / 不适用** | 单例确实集中在 `main.ts:79-168`；但「容器 + 冻结 + ESLint 禁直连」不适用：本仓只有 2 个窗口（`mainWindow`/`bootWindow`，`:79,82`），账本收益 ≈ 0（§6-3） |
| 8 | 启动分支判别联合 + `assertNever` 穷尽 | ❌ **缺口（低优先）** | 启动分支现在靠 `if (startupDecision.mode === "recovery" ‖ !openedStore) {…return}`（`:644`）+ `if (safeModeActive)` 散在 5 处（`:618,931,997,1024,1069`），无判别联合 |
| 9 | 不用参数逐层传递 Electron 成员 | ✅ **已具备** | 各模块直接 `import { app } from "electron"`（23 个文件）；`boot/ipcWiring.ts` 收的是显式依赖对象（`:55-…` 的 `IpcWiringDeps`），不是 `app` |
| 10 | 固定值收敛（窗口最小尺寸 / UA / webPreferences） | 🟡 **部分** | 路径/模式已收敛到 `boot/paths.ts`；但 `webPreferences`（`main.ts:376-389`）、minWidth/minHeight（`:368-369`）、`js-flags`（`:557`）仍在入口 |
| 11 | 拆分后保持导入路径不变（门面） | ✅ **已具备（且先于思源）** | `electron/quickNotes.ts:1-12`（83 行门面）、`electron/webApiServer.ts:5-34`（244 行门面 + `WEB_METHODS` 单一来源） |
| 12 | 迁移中发现并修复运行期 bug（改造副产品） | ⚠️ **不可预期收益** | 本仓已有等价物（`startupRecovery`、`safeMode`、`quickNotesAvailability` 降级链）——**别把「顺手修 bug」写进批次计划当交付** |

---

## 4. 风险清单（打包链路 + dev 流程）

### 4.1 打包链路

| # | 风险 | 触发条件 | 失效表现 | 定位（file:line） | 建议护栏 |
| --- | --- | --- | --- | --- | --- |
| P1 | **preload 路径解析失败（仅打包版）** | 改 `vite.config.ts:50 outDir` 的**目录深度**（如挪进 `build/electron`），或改 `asarUnpack` 目标 | 窗口能开、页面能加载，但**所有 IPC 报「不是函数」**；只有日志里一条 `[crash] preload-error`，极易误判成渲染层问题 | `electron/main.ts:378-380` 的 `path.join(__dirname, "../../app.asar.unpacked/electron/preload.cjs")`；错误捕获在 `:511-513` | 路径收敛为 `boot/paths.ts` 的一个函数 + 单测断言两个分支；packaged smoke 断言 `window.lakeNative` 存在 |
| P2 | **启动页 404（仅打包版）** | 同 P1，或漏改 `build.files` | 启动时长时间白屏（`:418` 的 8s fallback 才出主窗口） | `electron/main.ts:328` 的 `../electron/boot.html`；`:329` 的 catch 只记 warn | 已有 `bootAssets.test.ts:34-40` 正向断言；补「`files` 只允许产物前缀」负向断言（A-8） |
| P3 | **`APP_DIR` 语义漂移**（`dist/`、`vendor/cdn` 都按它定位） | 产物不再与 `dist/` 同级 | 私有协议 `lakexlocalnotes://app` 全 404（打包版白屏）；CDN 镜像失效 → 内核字体/图标缺失 | `electron/main.ts:86` + `boot/paths.ts:63-70` | 同 P1（单测断言 `rendererDistDir(appDir)` 以 `dist-electron` 父级为基准） |
| P4 | **electron-builder `main` 字段与产物不一致** | 改 `vite.config.ts:50 outDir` 但忘改 `package.json:6` | 打包版双击直接 `Cannot find module`（dev 完全正常，最易漏） | `package.json:6` vs `vite.config.ts:50` | 5 行测试：把 outDir 提成共享常量，断言 `main === outDir + "/main.js"`（A-9） |
| P5 | **external 派生漏项** | 新原生依赖进了 `devDependencies`，或传递依赖未登记（`@smithy/` 就是显式兜的，`vite.config.ts:37`） | dev 正常（`node_modules` 在），打包版崩 `Could not load the 'sharp' module…`（历史事故见 `scripts/ci-packaged-smoke.sh:5-7`） | `vite.config.ts:33-39` | 新增测试：扫非测试文件的 bare import，断言 ∈ `{node:*, electron*, dependencies}` ∪ `{@smithy/*}`（A-6，实测只差 1 条） |
| P6 | **better-sqlite3 ABI 误判** | 有人按 `AGENTS.md:181`「better-sqlite3 是 Electron ABI（系统 Node 跑不了）」去加 `@electron/rebuild` | 加多余 rebuild / 双 ABI 基建复活（已被拆掉的东西又长回来） | **文档冲突**：`AGENTS.md:181` 与 `docs/DEVELOPMENT.md:16,88`、`docs/TROUBLESHOOTING.md:92` 结论相反 | 以 `docs/DEVELOPMENT.md:88` 为准：**13.x 是 N-API 单二进制，Node/Electron 通用，无需 rebuild**。建议顺手改 `AGENTS.md:181` 措辞（不阻塞本方案） |
| P7 | **误删 `asarUnpack`**（以为 `sandbox: true` 就够） | 有人清理配置 | 打包版 preload 不加载（同 P1 表现） | `main.ts:377-384` 注释已写清；`package.json:141-143` | 保留；P1 的护栏同时覆盖 |
| P8 | **`node_modules` 软链出包**（worktree/CI） | 软链 node_modules 时打包 | `sharp` 的 `@img/*` 平台包被漏 → 主进程启动即崩 | `scripts/ci-packaged-smoke.sh:13-17` 已拦 | 已有 |
| P9 | **打包冒烟不在默认门禁里** | — | 「只在 packaged 才炸」的问题（P1/P2/P4/P5/P8）全靠人记得跑 | `package.json:17,29,34` | 保持现状（成本高），但把**零成本部分**（P2/P4/P5 的静态断言）下沉到 vitest（批次 A） |

### 4.2 dev 流程

| # | 风险 | 触发条件 | 失效表现 | 定位（file:line） | 建议护栏 |
| --- | --- | --- | --- | --- | --- |
| D1 | **`ELECTRON_RUN_AS_NODE` 继承 ⇒ Electron 以纯 Node 启动** | 从 DSH/宿主终端 `npm run dev` | `bad option: --disable-gpu` / 窗口不出现 | `scripts/dev.mjs:52-55` 已**自动移除**并告警 | 已有；`AGENTS.md §7#3` 的手动 `env -u` 老办法已非必需，但别删 dev.mjs 的兜底 |
| D2 | **改 `electron/preload.cjs` 后 dev 不重启** | 只改 preload 的 CJS 一侧 | 渲染层仍用旧 `window.lakeNative` ⇒「新加的 API 不是函数」（会误判成 IPC 没注册） | `vite.config.ts:47-54` 的 `electron([…])` **只有 1 个 entry**（main.ts），preload 不在 watch 范围 | 在 `preload.cjs` 头部加提醒注释；**不建议**把 preload 塞进构建（会推翻 `ipcChannelParity.test.ts:5-9` 的既有决定，AGENTS §3#17） |
| D3 | **`npm run dev:electron`（`electron .`）跑旧产物** | 改了 `electron/*.ts` 却直接 `electron .` | 行为与源码不符（最难查的「改了没生效」） | `package.json:17 dev:electron: "electron ."` + `:6 main: dist-electron/main.js` | 正常路径是 `npm run dev`（vite 重建 + 重启）；在脚本/README 写清 `dev:electron` 只用于产物调试 |
| D4 | **端口/CDP 冲突** | 已有 dev 实例在跑 | `npm run dev` 直接退出并给提示 | `scripts/dev.mjs:68-85` | 已有。**本机 9222 与 Android 模拟器正在跑**：任何清理只能按 CDP 端口定位（`AGENTS.md §7#2`），**禁止 `pkill Electron`** |
| D5 | **只跑 `tsc --noEmit` 不跑 `vite build`** | 只验类型 | external 漏项、路径解析错都要到打包才暴露 | `package.json:17 build = "tsc --noEmit && vite build && electron-builder"` | 批次 A 的 P4/P5 静态断言把缺口补到「不构建也能查」 |
| D6 | **单 tsconfig 带 DOM lib 掩盖主进程误用** | 在 `electron/` 里写 `document.`/`window.`/`localStorage`，类型不报错 | 运行时 `ReferenceError`（主进程无 DOM） | `tsconfig.json:5 lib: ["ES2024","DOM","DOM.Iterable"]` + `:21 include: ["src","electron"]` | **实测**：给 `electron/` 单独一份 `lib: ["ES2024"]`（无 DOM）、排除 `*.test.ts` 的 tsconfig，当前 **0 error** ⇒ 零改动即可加（A-7） |

---

## 5. 批次方案

> 通用原则：**每批可独立合并、可单独回滚**；每批都先落机器判据再加约束（AGENTS §3#17：无护栏不做大改）。
> 每批统一验收：`npx tsc --noEmit` → `npx vitest run` → `node scripts/check-arch.mjs` → `node scripts/check-core-boundaries.mjs`；B/C 另加 dev/packaged 冒烟。

### 批次 A · 门禁先行（2 人日，**零行为改动**）

**目标**：把「层与依赖方向」「打包清单」「运行时依赖派生」变成可执行判据。**不改产品代码**（唯一例外 = A-5/A-6 的两处白名单登记）。

| 项 | 落点 | 内容 | 当前实测基线 |
| --- | --- | --- | --- |
| A-1 | 新 `electron/architecture.test.ts` | 思源同款：遍历 `electron/**/*.ts`（排除 `*.test.ts`）的相对导入，按 `allowedDependencies` 表校验；**新增一级目录未登记 ⇒ 失败** | 可立刻绿（规则见下） |
| A-2 | 同上表 | R1 无人 import `electron/main.ts` | **0 违规** |
| A-3 | 同上表 | R2 `electron/` 顶层只允许 8 个已登记子目录 + 根文件 | **0 违规**（现 8 个） |
| A-4 | 同上表 | R3 反向依赖禁止：`ipc/ s3v3/ quickNotes/ webApi/ ai/ update/ portable/` 不得 import `boot/`；`s3v3/ quickNotes/ webApi/ ai/` 不得 import `ipc/`；根层不得 import `ipc/ boot/ window/`（现有 `main.ts→ipc/boot` 2+2 条按「入口豁免」登记） | **0 违规** |
| A-5 | 同上表 | R4 `electron/` → `src/` 白名单：`src/core/**` 全开；`src/lib/types`（类型面）、`src/lib/layoutMetrics`、`src/features/ink/{inkGeometry,inkStrokeStyle,inkPageTexts}` 逐条登记；`src/mobile/**` `src/components/**` `src/hooks/**` `src/desktop/**` 全禁 | **1 处需登记**（`electron/noteExport.ts` 的 3 个 ink 模块）；其余 0 |
| A-6 | 新 `electron/runtimeDeps.test.ts` | 扫非测试文件的 bare import，断言 ∈ `{node:*, electron, electron/*, dependencies}` ∪ `{@smithy/*}`（P5 护栏） | **1 条**：`electron/s3v3/deviceConformance.ts:30` 引 `vitest` ⇒ 进「测试支撑白名单」 |
| A-7 | 新 `tsconfig.electron.json` + `check:electron-ts` | `extends ./tsconfig.json`，`lib: ["ES2024"]`（**去 DOM**），`include: ["electron"]`，`exclude: ["electron/**/*.test.ts"]`；接进 `check:arch` 或 `build` | **实测 0 error**，可直接加 |
| A-8 | 扩 `electron/bootAssets.test.ts`（或新 `electron/packageContent.test.ts`） | 负向断言：`build.files` 每项前缀 ∈ {`dist/`,`dist-electron/`,`electron/preload.cjs`,`electron/boot*`,`!`}；不含任何 `*.test.ts`/`*.test.js`；`asarUnpack` ⊆ `files` | 现状通过 |
| A-9 | 新 `electron/entryContract.test.ts` | 断言 `package.json:6 main` === `vite.config.ts:50 outDir` + `/main.js`（把 outDir 提成共享常量或正则读 `vite.config.ts`） | 现状通过 |

**顺序**：A-7（纯增量）→ A-1/A-2/A-3 → A-4/A-5/A-6（登记 1-2 条）→ A-8/A-9。
**验收**：`npx vitest run electron/architecture.test.ts electron/runtimeDeps.test.ts electron/packageContent.test.ts electron/entryContract.test.ts` + `npx tsc -p tsconfig.electron.json --noEmit` 全绿；再跑全量 `npx vitest run` 确认 0 失败（本批不动产品代码）。
**回滚**：删新增文件 + 撤销 2 行白名单。

### 批次 B · 入口装配机械化外迁（5 人日，**行为不变**）

**目标**：`main.ts` 1102 → **≤600 行**；`whenReady` 从 470 行降到 ≤150 行的「有序阶段列表」。

改动面（新文件，纪律沿用 S-5：**单例不搬家，只经 getter 读**，见 `boot/ipcWiring.ts:1-16,55-…`）：

| 顺序 | 新文件 | 从 main.ts 搬什么 | 行 | 前置 |
| --- | --- | --- | --- | --- |
| 1 | `boot/protocolWiring.ts` | #3 可信页面判定 + CDN/资产 token 重定向 + L（asset server / serveAppDist） | ~62 | — |
| 2 | `boot/startupDecision.ts` | C+D+G（完整性预检 / crashMarker / 安全模式判定 / S3 seed 回填） | ~42 | — |
| 3 | `boot/recoveryWiring.ts` | E 恢复页 4 个回调（备份重试 / 云端恢复 / 从备份恢复 / 打开数据目录） | 74 | 2 |
| 4 | `boot/quickNotesWiring.ts` | H（小记库打开/降级/标签迁移/孤儿清理） | 44 | 2 |
| 5 | `boot/fileReconcileWiring.ts` | F（文件↔元数据对账器装配） | 29 | 2 |
| 6 | `boot/backupWiring.ts` | J（自动备份 runner + tick） | 57 | 2 |
| 7 | `boot/timerWiring.ts` | P+Q+S（历史兜底/清理、自动同步、回收站过期 3 组定时器 + restart 闭包） | ~81 | 6 |
| 8 | `boot/syncWiring.ts` | R 开/关应用同步一次 + `broadcastSyncProgress` | ~28 | 6 |
| 9 | `boot/updateWiring.ts` | K（更新中心装配 + onState 广播） | 20 | 2 |
| 10 | `window/{bootSplash,createMainWindow,windowSecurity}.ts` | #4 + #6 + #7（splash / 主窗口 / 导航与 window.open 拦截 / console-message 转发 / render-process-gone 自恢复） | ~230 | 1 |

**顺序原则（错了就是 P1/P2/P3 类事故）**：先搬无顺序约束的 1-9，最后搬窗口 10。三条**不可动的时序**要变成注释 + 断言：
`registerAppSchemePrivileges()` 必须在模块顶层（`main.ts:91`，Electron 要求 app ready 前）· `applyUserDataPath()` 必须在任何 `userDataDir()` 之前（`:88`）· `serveAppDist` 必须在 `createWindow` 之前（`:914` → `:929`）· `installNativeSha256()` 必须在任何 hash 计算前（`:95`）。

**可机器校验的规则（加进 A-1 的表）**：
- `boot/**` 不得 import `main.ts`；不得新建第二条维护队列（已有护栏 `electron/maintenanceQueueScope.test.ts`）。
- `window/**` 不得 import `ipc/**`（窗口层不装配 IPC）。
- `boot/**` 只允许 import `{root, ipc, update, webApi, boot}`；`window/**` 只允许 `{root, boot}`。
- `main.ts` 行数上限断言：`expect(lines).toBeLessThan(620)`（防搬完又长回去）。

**验收**：全量 `npx vitest run`（163 文件）+ `npx tsc --noEmit` + `node scripts/check-arch.mjs` + **dev 冒烟**（`env -u ELECTRON_RUN_AS_NODE ./node_modules/.bin/electron --disable-gpu --remote-debugging-port=9222 .` 后跑 `node scripts/e2e-electron-smoke.mjs`）+ **packaged 冒烟**（`bash scripts/ci-packaged-smoke.sh`，覆盖 P1/P2/P3）。
**风险**：搬函数必须**搬调用不改所有权**；恢复页/定时器回调里捕获的 `store`/`quickNotes` 必须是 getter，不能是值快照（否则启动期拿到 `undefined`）。

### 批次 C · 静态资源与打包清单彻底分离（3 人日，**可选**）

**目标**：`build.files` 只含 `dist/**` 与 `dist-electron/**`；源树 0 文件进包；preload/boot.html 的路径收敛到 1 个函数。

| 步骤 | 动作 | 说明 |
| --- | --- | --- |
| C-1 | `electron/{boot.html,boot-anim.apng,boot-poster.png}` → `electron/static/` | 纯移动 + 改 `main.ts:328` |
| C-2 | 构建期把 `electron/static/**` 与 `electron/preload.cjs` 复制进 `dist-electron/` | 10 行 vite 插件（`closeBundle` 里 `cpSync`）或写进 `scripts/` 并在 `package.json:17 build` 串起来；**不引新依赖** |
| C-3 | `package.json:118-127 files` 收敛为 `["dist/**/*","dist-electron/**/*","!**/*.map"]`；`:141-143 asarUnpack` 改 `["dist-electron/preload.cjs"]` | 目录深度不变（仍在 asar 根下一级）⇒ `../../app.asar.unpacked/…` 的**深度语义**可保留 |
| C-4 | 路径收敛：`main.ts:86/328/379-380` → `boot/paths.ts` 的 `appDirOf(__dirname)` / `bootSplashPath(appDir)` / `preloadPath(appDir, isPackaged)` | 3 处硬编码 → 1 处；保持 `boot/paths.ts:10-11`「不读 `import.meta.url`」的纪律（`__dirname` 由入口传入） |
| C-5 | 新 `electron/packageContent.test.ts`（A-8 的强化版） | 断言 `files` 每项前缀 ∈ {dist/, dist-electron/, !}；`asarUnpack` ⊆ files；启动页两图不在 `electron/` 根 |

**收益 vs 代价**：收益 = 包内源树面归零（376KB 不再与源码版本纠缠）、P1/P3 从「3 处隐式耦合」变「1 个函数 + 单测」、与思源「只读产物目录」对齐。代价 = 构建期多一步复制（几十 ms）、C-3 之后**改 preload 必须重新构建**（D2 现状不变）。
**建议**：如果只做一件事，**做 C-4（路径收敛 + 单测）**；C-1/C-2/C-3 可延后 —— P1/P3 的真实风险来自「相对路径无护栏」，不来自「文件在哪个目录」。

**总人日**：A 2 + B 5 + C 3 = **10 人日**；只做 A+B ≈ **7 人日**即可覆盖 ~90% 的可维护性收益。

---

## 6. 明确不做（附理由）

1. **不引入独立 `build/` 源码入口层**。思源 PR 21151 **也没有**引入（webpack 入口仍是 `app/electron/main.ts`，新增的 `electron-dist/` 是**产物**目录）；本仓已有 `dist-electron/` 扮演同一角色。引入 `build/` 源码层会同时破坏：`tsconfig.json:21` 单工程 include、`vitest.config.ts:32` 的 `electron/**/*.test.ts` 收集、`scripts/check-arch.mjs` 的扫描根、以及 3 处相对路径（P1/P2/P3）。按 AGENTS §3#17 三问：无真实问题证据、不做无代价、收益只是「结构更像思源」⇒ 不做。
2. **不重排目录、不把根平铺 83 个文件搬进主题目录**。它们现实中是「L1 领域/存储层」（81/82 被其他层引用）；搬迁收益是审美，代价是 60+ 文件 diff 与 import 全改。**改为在批次 A 给它一个名字**：`allowedDependencies` 里把根层登记为 `domain`，并禁止它 import `ipc/`、`boot/`、`window/`。
3. **不做窗口账本 / 运行期状态冻结 / ESLint 禁直连**（思源三件套）。本仓只有 2 个窗口（`main.ts:79,82`），账本收益 ≈ 0；冻结 `state` 与「main.ts 持有可变单例（`:116-168`）」的既有设计直接冲突。**只借鉴「单例集中 + 不复制」**（已满足：`boot/ipcWiring.ts` 用 getter 而不是值）。
4. **本批不做 `StartupBranch` 判别联合**。启动判据现在有 4 个正交维度（`safeModeActive`、`startupDecision.mode`、`quickNotesAvailability.mode`、`rendererMode`），收敛成判别联合会**改动 7 处分支的顺序**（`:618,644,774,931,997,1024,1069`）= 启动语义风险，收益只是类型整洁。留作 B 之后的独立议题，且必须先补「启动分支矩阵」测试。
5. **不给 preload.cjs 做 codegen/常量表**。`ipcChannelParity.test.ts:5-9` 已论证（原生 CJS、不进构建，为省字面量引入构建复杂度不划算），四面护栏已能当场抓漂移。保持现状。
6. **不改 S3 协议 / 删除恢复语义 / 并发 12**（AGENTS §3 已定稿），本方案完全不触碰。
7. **不为「更像思源」加依赖**（webpack、eslint-plugin-import、dependency-cruiser）。批次 A 用 vitest + 正则即可（思源的 `architecture.test.ts` 也是这么做的），符合 AGENTS §3#22 依赖准入四问。

---

## 7. 附录：本次实测方法与命令

```bash
export PATH="$HOME/.nvm/versions/node/v24.18.0/bin:$PATH"
cd "$(git rev-parse --show-toplevel)"        # 本次 = /Users/admin/file/local-lake/lakex-local-notes

# 规模
find electron -type f \( -name '*.ts' -o -name '*.tsx' -o -name '*.cjs' \) ! -name '*.test.ts' | wc -l          # 146
find electron -type f \( -name '*.ts' -o -name '*.tsx' -o -name '*.cjs' \) ! -name '*.test.ts' -exec cat {} + | wc -l   # 26202
find electron -type f -name '*.test.ts' | wc -l                                                                  # 163

# 基线门禁三件（本次实跑全绿）
npx tsc --noEmit && node scripts/check-core-boundaries.mjs && node scripts/check-arch.mjs

# 依赖图 / 可达性 / 环：一次性 node 脚本（遍历 import|export … from 与 import()，把 .js spec 归一为实际 .ts）
#   结论：0 环；main.ts 无人 import；145 个非测试 .ts 中 142 个从 main.ts 可达；
#         产物会打进 136 个 src 文件（core 131 / features 3 / lib 2）；electron → src/mobile 0 条（非测试）。

# 「主进程可去掉 DOM lib」验证（临时 tsconfig 放 /tmp，未写入仓库）
#   extends ./tsconfig.json + lib:["ES2024"] + include electron/**/*.ts + exclude **/*.test.ts
#   ⇒ 0 error。（若把 *.test.ts 也纳入，会因 deviceConformance.mixed.test.ts 引 src/mobile 报 3 类 DOM/Stream 错
#      ⇒ 这道门禁必须只覆盖生产文件。）
```

**本次未执行**（超只读范围 / 需构建产物）：`bash scripts/ci-packaged-smoke.sh`（需 `release/` 产物 + 数分钟构建）、全量 `npx vitest run`。基线门禁三件已实跑全绿。

**文档漂移顺带记录**（不阻塞本方案，供文档治理批次处理）：

- `docs/ARCHITECTURE.md:14,47` 写「187 个通道」，实际 `electron/ipc/ipcChannelParity.test.ts:168-170` 断言 **188**。
- `docs/ARCHITECTURE.md:12-28` 的目录图缺 `boot/`、`quickNotes/`、`webApi/` 三个子目录；`:28` 仍把 `webApiServer.ts` 描述为实现（现为 244 行门面）。
- `AGENTS.md:181`「better-sqlite3 是 Electron ABI（系统 Node 跑不了）」与 `docs/DEVELOPMENT.md:88`、`docs/TROUBLESHOOTING.md:92`（13.x = N-API 单二进制）**矛盾**，建议以后者为准。
