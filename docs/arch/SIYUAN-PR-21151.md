# 思源 PR #21151 拆解：桌面主进程 → 严格 TS 分层 + 打包输入分离

> 一句话结论：**思源这次是「搬运 + 加护栏」，不是重写业务**——5292 行单文件 `app/electron/main.js` 被搬成 102 个严格 TS 模块（6 层目录），同时新增了 3 类机器门禁（依赖方向、打包内容、通道一致性）；「打包输入与源码目录分开」的真实含义是**新增产物目录 `app/electron-dist`**，源码目录没有搬走。
>
> 拆解对象：`siyuan-note/siyuan` PR #21151（head `4f00ee4e83604155f2242fc7a706d80b8ca12dd3`，base `dev`），已合并。
> 本地只读对照：本机 `siyuan-master/`（3.8.4 旧 checkout，**非 git 仓库、不含 PR 后代码**）。
> 本仓（lakex-local-notes）**只读**；本次唯一写入 = 本文档。未提交。
>
> 证据代号：正文里的 `A1`…`A6`、`L*`、`R*` 全部对应 §8 引用清单里的完整 URL / 文件路径行号。

---

## 0. 结论（先看这段）

**① 改动本质是「单文件 → 6 层 + 产物目录」的纯搬迁式重构，业务逻辑基本原样搬走。**
PR 标题 *Migrate the desktop Electron main process to strict TypeScript modules*，245 个文件、**+16901 / -10263**、3 个 commit，2026-11-02 创建并当天合并（A1、A3）。`main.js` 删除 5292 行；改造后 `app/electron/` 共 **186** 个文件，其中 **102 个生产 TS 模块**（root 2 + `shared` 18 + `startup` 15 + `window` 27 + `kernel` 12 + `remote` 12 + `ipc` 16），另有 3 个 `.d.ts`、2 个测试替身、63 个测试（61 `.test.ts` + 2 `.test.js`）、4 个静态 JS（A2）。

**② 「把打包输入与源码目录分开」不等于「新加一个 src 源码层」。**
源码仍然在 `app/electron/`（与测试同目录）；新增的是**构建产物目录 `app/electron-dist/`**——webpack 以 `main.ts` 为入口打成单文件 `electron-dist/main.js`，构建脚本再把静态资源复制进去，6 个 `electron-builder*.yml` 的 `files` 与 `main` 一起改成只读 `electron-dist`（A2：`app/webpack.electron.js`、`app/scripts/build-electron.mjs`、`app/package.json`、`app/electron-builder*.yml`；A6）。**如果你听到的转述是「源码搬到 src 层」，那是转述错误**——详见 §3。

**③ 值得照抄的是「护栏」，不是「这次搬迁」。**
依赖方向测试（`architecture.test.ts`，85 行）、打包内容测试（`electronPackageContent.test.js`，89 行 + 单一产物清单）、通道一致性测试（`channelsConsistency.test.ts`，101 行）是三件低成本、可独立拿走的东西。这次搬迁本身（245 文件单 PR、4 套工具链、源码文本锚点测试）是**反面教材**——见 §5 第二栏。

**④ 是否保留 CJS：是，但只保留了一个岛。**
`app/package.json` 没有 `"type": "module"`（A6），webpack 产物是 CJS bundle；`electron/markdown/` 的 15 个 JS 模块与 `preload.js` 仍是 CommonJS，PR 只把它们「接入新的启动流程」，没有迁 TS。合并后维护者又单独做了一轮迁移（`15 个 JS 实现模块 → 严格 TS，移除 3 份手写类型声明，14 个相关测试文件同步迁移`）——这恰好说明「留一个 CJS 岛」的代价是**合并后还得再来一轮**（A4）。

| 用户关心的数字 | 值 | 来源 |
| --- | --- | --- |
| PR 文件总数 | **245**（added 141 / modified 28 / removed 28 / renamed 48） | A1、A2 |
| 增删行 | +16901 / -10263 | A1 |
| commit 数 | **3** | A1、A3 |
| `main.js` 改造前行数 | **5292**（删除行数即此值） | A1（正文自述）、A2 |
| `main.js` 拆成几个模块 | **102 个生产 TS 模块**（分 6 个一级目录；另有 root 的 `main.ts`/`environment.ts`） | A2 |
| 测试文件 | 改造后 63 个在 `electron/` 内（61 `.test.ts` + 2 `.test.js`）；改造前顶层 36 个 `.test.js` | A2 |
| 是否保留 CJS | 是：`markdown/`（15 个 JS 模块）+ `preload.js`；合并后单独一轮迁走 | A2、A4 |
| 验证覆盖 | `tsc` 两份配置通过、eslint 0 错、468 用例（462 过 / 6 跳过 / 0 失败）；**未跑 `pnpm build`/`pnpm dev`/`pnpm run dist`** | A1（正文） |

---

## 1. 事实底账（GitHub API 原始数字）

### 1.1 PR 元数据

| 字段 | 值 |
| --- | --- |
| 标题 | Migrate the desktop Electron main process to strict TypeScript modules |
| 状态 | closed / **merged**，`merged_at` = 2026-11-02T05:34:38Z，`created_at` = 2026-11-02T02:52:51Z |
| 作者 | `TCOTC` |
| base / head | `dev` / `refactor/electron-modules`（head `4f00ee4e83`，merge commit `097508a2`） |
| commits / changed_files / additions / deletions | 3 / **245** / **+16901** / **-10263** |
| 讨论量 | issue comments 2、review comments 0、reviews 0（即**没有走 PR review**） |
| label | `Refactor` |
| 正文长度 | 4185 字符（含结构表、迁移暴露问题、验证表） |

来源：https://api.github.com/repos/siyuan-note/siyuan/pulls/21151 ；https://api.github.com/repos/siyuan-note/siyuan/pulls/21151/reviews

### 1.2 逐文件统计（245 个）

| 状态 | 数量 |
| --- | --- |
| added | 141 |
| renamed | 48 |
| removed | 28 |
| modified | 28 |

按目录聚合（来源：https://api.github.com/repos/siyuan-note/siyuan/pulls/21151/files?per_page=100&page=1..3）：

| 目录 | 文件数 | 增 | 删 |
| --- | --- | --- | --- |
| `app/electron/` | 213 | +16460 | -10155 |
| `app/`（electron 之外：package.json、6 个 builder yml、eslint、tsconfig、webpack、scripts、tests） | 26 | +331 | -98 |
| `scripts/`（仓库根：check-lang-keys.py、license-header.mjs） | 2 | +101 | -5 |
| `.github/SECURITY.md` | 1 | +1 | -1 |
| `.gitignore` / `AGENTS.md` / `kernel/util/session.go` | 3 | +8 | -3 |

`app/electron/` 内部按层（含测试与静态资源，186 个现存文件）：

| 层 | 文件数 | 其中生产 TS | 说明 |
| --- | --- | --- | --- |
| `window/` | 44 | 27 | 窗口创建/导航/生命周期/菜单/托盘/拖拽 |
| `startup/` | 28 | 15 | 启动条件、进程级事件、启动分支、更新协调 |
| `shared/` | 24 | 18 | 运行期状态、类型、通道名、固定值、日志… |
| `kernel/` | 22 | 12 | 本机内核启动/就绪/退出 |
| `remote/` | 21 | 12 | 远端内核：连接、认证、协议、页面抓取 |
| `ipc/` | 17 | 16 | 按通道域拆分的 IPC 注册 |
| `static/` | 14 | 0 | HTML/CSS/渲染脚本/图标/语言包（不经 webpack） |
| `root`（`main.ts`、`environment.ts`、`README.md`、`tsconfig.json`、3 个架构/一致性测试） | 8 | 2 | 入口只做装配 |
| `markdown/` | 6 | 0（3 个 `.d.ts`） | 保留的 CJS 编辑器岛 |
| `fixtures/` | 2 | 0 | `electronStub.ts` + `windowControlsStub.cjs` |

### 1.3 commit 列表（3 个）

| sha | 标题 |
| --- | --- |
| `81a177727c` | :recycle: Migrate the desktop Electron main process to strict TypeScript |
| `f2f6bb723b` | :bug: Settle a throwing kernel startup attempt and keep one connection manager reference |
| `4f00ee4e83` | :sparkles: Restore the standalone Markdown editor on the refactored desktop modules (issue #21115) |

来源：https://api.github.com/repos/siyuan-note/siyuan/pulls/21151/commits

**注意迁移节奏**：第 2 个 commit 是**行为修复**（内核启动抛异常时永久等待），第 3 个 commit 是**功能接线**（把 #21115 的 Markdown 编辑器接回新启动流程）。也就是说「纯重构」PR 里混进了 bug fix 与 feature 接线——这正是 review 0 条的原因之一（见 §6）。

### 1.4 本机证据方法与限制（先说清，避免误读）

- 本机 **github.com / raw.githubusercontent.com 不可达**（`curl` 20–40s 超时，HTTP 000），只有 `api.github.com` 通。因此本文的逐文件数字来自 REST `/pulls/21151/files` 三页（每页 `patch` 字段含完整 diff 片段），**没有**用 `.diff`/`.patch`，也没有直接读到 head 分支任意文件的原始字节（`app/package.json` 全文经 `contents` API 单独取过，A6）。
- 本机 `/Users/admin/file/local-lake/siyuan-master` 是 **3.8.4 发布版** checkout（`app/package.json` version `3.8.4`，L1），**不是 PR 的 base**（PR base 是 `dev`dff818f435`，版本 `3.8.10-alpha.2`）。两者都是「改造前」形态，但规模差一截：3.8.4 顶层 **35** 个文件 / `main.js` **4601** 行 / 12 个 `.test.js`；PR base 顶层 **73** 个文件 / `main.js` **5292** 行 / 36 个 `.test.js`（A2 逐文件重建 + L1）。
- **引用「改造前」数字时必须带版本**，否则会像 PR 正文那样出现「34 个 `*.test.js`」与 API 重建「36 个（顶层）+3 个（markdown）≈39–40 个」的口径差（见 §2.4）。

---

## 2. 改造前是什么样（3.8.4 实测 + PR base 重建）

### 2.1 改造前目录树（PR base 重建，A2）

```
app/
├── package.json                  # main: "./electron/main.js"
├── electron-builder.yml          # extraMetadata.main: "electron/main.js"; files: ["electron"]
├── electron-builder-{arm64,darwin,darwin-arm64,linux,linux-arm64}.yml   # 同上，共 6 份
├── electron/                     # 35 个文件（3.8.4）/ 73 个顶层文件（PR base），全部平铺
│   ├── main.js                   # 5292 行：一切都在里面
│   ├── window.js                 # 920 行：pre-boot 窗口渲染脚本（内嵌 22 种语言的 i18n 表，L1 实测）
│   ├── main.js 之外的 CJS 模块    # connectionManager/windowGeometry/settingsWindows/remoteKernel/kernelRequestLog/...
│   ├── boot.html init.html workspace.html connections.html remote-auth.html error.html
│   ├── *.test.js                 # 与源码同目录：36 个（3.8.4 是 12 个）
│   ├── fixtures/                 # 仅测试使用，但会被打进安装包
│   └── markdown/                 # 4 个文件被本次 PR 触及（15 个 JS 模块整体保持 CJS）
├── scripts/                      # 构建/测试脚本（appleSilicon.test.js 也在这里）
└── tests/                        # 集成测试（真实 Electron 里重跑）
```

3.8.4 实测：[siyuan-master/app/electron](siyuan-master/app/electron) 共 35 个文件、**没有任何子目录**（`find . -type d` 只有 `.`），`main.js` 4601 行、`window.js` 920 行（L1）。

### 2.2 5292 行里到底混了什么（以 3.8.4 的 4601 行为样本）

`main.js` 顶层就堆着 **139 个 `const`**，包括：

| 类别 | 证据（L2 = [siyuan-master/app/electron/main.js](siyuan-master/app/electron/main.js)） |
| --- | --- |
| 全局路径/常量 | `appDir`、`confDir`、`windowStatePath`、`appCrashLogPath`、`updateKernelExitTimeout`…（L2:82–98） |
| 运行期状态（裸 Map/Set） | `kernelProcesses`、`windowKernelTargets`、`initializedWindowIds`、`blockDragSessions`、`handledCrashWebContents`、`pendingRemoteOpenURLs`…（L2:98–120） |
| 业务编排 | 块拖拽路由（`routeBlockDragMove` 等 20+ 个函数，L2:124–440）、菜单、全局快捷键、上下文菜单、拼写检查 |
| 进程/窗口生命周期 | `initKernel`、`initMainWindow`、`showWindow`、`exitApp`、崩溃处理 |
| IPC 派发 | 23 处 `ipcMain.on(...)`、4 处 `ipcMain.handle(...)`（L2 全文 grep） |

PR 正文的定性描述与此一致：**「`main.js` 已难以定位职责，事件注册、进程状态与业务编排混在一处」**（A1）。

### 2.3 改造前的「打包输入 = 源码目录」

3.8.4 实测（L3 = [siyuan-master/app/package.json](siyuan-master/app/package.json)；L4 = [siyuan-master/app/electron-builder.yml](siyuan-master/app/electron-builder.yml)）：

```jsonc
// app/package.json
"main": "./electron/main.js"
```
```yaml
# app/electron-builder.yml
extraMetadata:
  main: "electron/main.js"
files:
  - "electron"     # ← 整个源码目录，含测试与 fixtures
```

后果（PR 正文实测）：**34 个 `*.test.js`（约 291 KB）与仅测试使用的 `fixtures/` 被复制进 `resources/app/electron`**（A1）。安装包里带测试，既是体积问题，也是「源码/测试/产物」三者不可区分的问题。

### 2.4 改造前的测试形态

- 测试与源码同目录、同前缀（`window.js` ↔ `window.test.js`），`require` 真实 `electron`（纯 Node 下 `require("electron")` 只返回可执行文件路径字符串，所以此前很多 Electron 成员是**作为函数参数逐层传**的）。
- 没有类型门禁：`electron/` 不在 `tsc` 检查范围（3.8.4 `typecheck` 只跑 `tsconfig.typecheck.json` + `tsconfig.api.json`，L3）。

**数字口径提醒**：逐文件重建得到「顶层 36 个 `*.test.js` + `markdown/` 3 个 + `app/scripts/appleSilicon.test.js` 1 个 = 40 个被本次 PR 触及的测试文件」，而 PR 正文写「34 个 `*.test.js`、约 291 KB」（A1、A2）。差异可能来自统计时点（正文 02:52 写成、代码 05:34 合并）或「是否只数顶层」。本文档一律以 API 逐文件重建为准，并标注正文口径。

---

## 3. 「把打包输入与源码目录分开」具体指什么（逐项落到文件）

### 3.1 一句话

**不是**把源码搬进 `src/`，而是**新增一个只读产物目录 `app/electron-dist/`**：webpack 把 `electron/main.ts` 打成单文件，构建脚本把静态资源复制进去，打包器只读这个目录。源码与测试仍在 `app/electron/`，靠「打包输入指向产物」隔离。

### 3.2 七步链条（每步都有对应文件）

| # | 改什么 | 改法 | 来源 |
| --- | --- | --- | --- |
| 1 | 产物入口 | 新增 `app/webpack.electron.js`（43 行）：`entry: "./electron/main.ts"` → `output.path: app/electron-dist`，`filename: "main.js"`；`target: "node"`；`node.__dirname/__filename = false`（保留运行期语义）；裸模块一律 `externals: "commonjs " + request`；`resolve.extensions: [".ts", ".js"]`；esbuild-loader 转译 TS；`minimize: false`、`nodeEnv: false`（保留 `process.env.NODE_ENV` 判断） | A2 `app/webpack.electron.js` |
| 2 | 构建脚本 | 新增 `app/scripts/build-electron.mjs`（57 行）：`pnpm run build:electron` 先 `rm -rf electron-dist`，复制 `static/` 资源到 `electron-dist/static/`，复制 markdown 运行期依赖（`preload.js`、`replaceFile.ps1`）到 `electron-dist/` 根；支持 `--watch`（watch 模式每次都重新复制静态资源） | A2 `app/scripts/build-electron.mjs` |
| 3 | 产物清单单一来源 | 新增 `app/scripts/electronPackageContent.js`（12 行）：导出 `rendererScripts`、`staticAssets`、`markdownRuntimeAssets` 三张清单，构建脚本与打包内容测试**共用** | A2 |
| 4 | 包入口 | `app/package.json`：`main` 改 `./electron-dist/main.js`；`start`/`start:simulate-rosetta` 前置 `pnpm run build:electron`；**6 个** `dist*` 脚本全部前置 `pnpm run build:electron`；新增 `build:electron` 脚本；`typecheck` 追加 `tsc -p tsconfig.electron.json` 与 `tsc -p tsconfig.electron.test.json` | A2（`app/package.json` patch）；A6 全文 |
| 5 | 打包器配置（6 份） | 每个 `electron-builder*.yml` 两处同改：`extraMetadata.main: "electron-dist/main.js"`、`files: ["electron-dist"]` | A2（6 份 yml patch） |
| 6 | 忽略与门禁范围 | `.gitignore` 增 `app/electron-dist`；`app/eslint.config.mjs` 的 `ignores` 增 `electron-dist` | A2 |
| 7 | 测试发现范围 | `app/scripts/test.mjs`：测试发现从 `electron/**/*.test.js` 改为 `electron/**/*.test.ts` **和** `electron/**/*.test.js`（markdown 未迁），并加 `--experimental-test-module-mocks`；`test-changed.mjs` 同样加该开关 | A2 |

### 3.3 产物结构（构建后）

```
app/electron-dist/            # 已被 .gitignore，不在仓库里
├── main.js                   # webpack 单文件 bundle（CJS），来自 electron/main.ts
├── preload.js                # 从 electron/markdown/ 复制（沙箱 preload，仍 CJS）
├── replaceFile.ps1           # Windows 替换脚本，markdown 模块按 __dirname 加载
└── static/                   # 原样复制的渲染期资源
    ├── window.js  connections.js  connectionEntry.js   # 渲染脚本，不能被 bundle 合并
    ├── boot.html init.html workspace.html connections.html remote-auth.html error.html
    ├── window.css connections.css icon.png
    └── window-languages.json # 启动期窗口文案（从旧 window.js 内嵌表抽出）
```

来源：A2 `app/scripts/electronPackageContent.js`、`app/scripts/build-electron.mjs`、`app/electron/README.md`；`static/window-languages.json` 为新增文件（+684 行），`static/window.js` 新增 +267 行（旧 `window.js` 920 行被 `removed`，内嵌 i18n 表外置）。

### 3.4 为什么是「同层目录」而不是「src 层」——两个设计理由

1. **保 `__dirname` 语义**：产物目录与 `electron/` 同层，主进程里所有 `path.join(__dirname, "..")` / 相对资源路径都不用改（`app/webpack.electron.js` 注释原文：*「产物目录与 `electron/` 同层，运行时 `__dirname` 的 `../` 语义保持不变」*）。
2. **webpack `node.__dirname = false`**：不把 `__dirname` 替换成打包期常量，否则运行期加载 preload/静态资源会指向构建机路径。

这是本次改造里**最值得学的一个细节**：把「源码/产物分离」做成「同层新目录 + 构建复制」，迁移面远小于「搬家到 src/」。

### 3.5 双保险：产物清单被测试钉死

新增 `app/scripts/electronPackageContent.test.js`（89 行）三条断言（A2 全文可见）：

1. **每个** `electron-builder*.yml`（除被 `extends` 的 `electron-builder-common.yml`）：`files` 必须**恰好**是 `["electron-dist"]`、`main` 必须是 `electron-dist/main.js`；
2. `package.json` 的 `main` 必须是 `./electron-dist/main.js`；`start`/`start:simulate-rosetta`/`build:electron` 脚本存在；**所有** `dist*` 脚本必须包含 `pnpm run build:electron`；
3. 产物里不能出现 `.test.` 文件、不能有 `fixtures` 目录；`main.js` 非空；`static/` 里清单列的每个资源存在且非空；`preload.js`/`replaceFile.ps1` 在产物根。

第 3 条的 `outputDir` 不存在时直接 `t.skip(...)`——**这也是一处坑**：CI 没接构建步骤时这条永远 skip（见 §6.4）。

---

## 4. 严格 TS 分层是怎么做的

### 4.1 分层与职责（来自 `app/electron/README.md`，211 行新增，是这次改造的说明书）

| 目录 | 职责 | 关键模块 |
| --- | --- | --- |
| `shared/` | 跨层基础件，**不引用其它目录** | `runtime`（运行期状态）、`types`（领域类型）、`channels`（IPC 通道名）、`desktopDefaults`（固定值 + UA + 本机页 `webPreferences`）、`staticMessages`、`errorWindow`、`language`、`crashHistory`、`pagePaths`、`atomicJsonFile`、`logging`、`errors`… |
| `startup/` | 启动期条件 + 进程级事件 | `bootstrap`、`startupBranches`、`startupSwitches`、`chromiumSwitches`、`secondInstance`、`appLifecycle`、`systemShutdown`、`updateCoordination`、`linuxInputMethod`、`accessibility`、`protocolClient`、`lastWorkspace`、`enabledSettingFile` |
| `window/` | 窗口创建、导航、生命周期 | `mainWindow`、`bootWindows`、`openWindow`、`windowLookup`、`windowVisibility`、`appExit`、**`windowRegistry`**、`windowLifecycle`、`windowNavigation`、`windowPreferences`、`windowGeometry`、`windowControlsOverlay`、`windowMessaging`、`windowWorkspaces`、`settingsWindows`、`settingsTaskBridge`、`appMenu`、`trayMenu`、`blockDrag`、`globalShortcutBindings`、`rendererCrash` |
| `kernel/` | 本机内核：启动、就绪探测、退出编排 | `kernelBoot`、`kernelBootBudget`、`kernelExit`、`kernelEndpoint`、`kernelExitCodes`、`kernelRequestLog`、`kernelDiagnostics`、`localKernelRequest`、`previousKernelExit`、`workspaceInfo`、`notebookSystemLock`、`appleSiliconWarning` |
| `remote/` | 远端内核：连接、认证、协议、页面获取 | `connectionManager`、`connectionRuntime`、`connectionStore`、`remoteBoot`、`remoteKernel`、`remoteDocument`、`remoteKernelAuth`、`remoteProtocol`、`sessionHeaders`、`webPageFetch`、`webPageNetwork`、`remoteExport` |
| `ipc/` | 通道注册，按通道域拆分 | `getChannel`+`getContract`、四张域表（`clipboard`/`windowCommands`/`systemSettings`/`connectionCommands`）、`workspace`、`appEvents`、`commandChannel`、`dialogs`、`exportPreview`、`shellIntegration`、`register`（**全部通道的装配点**）、`clipboardFormat`、`richClipboard` |
| `static/` | 不经 webpack、由 `loadFile`/本机协议直接加载的页面 | 6 个 HTML、`window.js`/`window.css`、`connections.js`、`connectionEntry.js`、语言包、图标 |
| `markdown/` | 保留 CommonJS 的独立编辑器（叶子能力） | 15 个 JS 模块 + 3 个 `.d.ts`；宿主能力由入口注入 |

### 4.2 依赖方向 + 机器门禁

README 的依赖表与 `app/electron/architecture.test.ts` 的 `allowedDependencies` **一字对应**（A2）：

| 层 | 可以引用 |
| --- | --- |
| `shared` | 仅 `shared` |
| `kernel` | `shared`、`kernel` |
| `remote` | `shared`、`kernel`、`remote` |
| `window` | `shared`、`kernel`、`remote`、`window` |
| `markdown` | 仅 `markdown`（叶子） |
| `ipc` | 以上 + `ipc`、`startup` |
| `startup` | 全部 |
| `root`（`main.ts` 所在） | 全部，且**不被任何生产模块引用** |

门禁实现（85 行，零依赖）：遍历 `electron/**/*.ts`（跳过 `*.test.ts`、`fixtures/`、`static/`）→ 去注释后正则提取相对 import → 按**一级子目录**定层 → 不在 `allowedDependencies[from]` 里就收集违规 → `assert.deepEqual(violations, [])`。**新增一级目录未登记会以「unknown layer」直接失败**。特例处理得很细：注释里的示例 import 先剥掉；指向 `electron/` 之外的说明符（测试夹具、stage 资源）不计入分层。

配套还有两个「约定 → 检查」的转换：

- `app/electron/electronGlobalBinding.test.ts`（61 行）：用 TS AST 检查**值位置**的 `Electron.BrowserWindow`——`electron.d.ts` 把它声明成全局命名空间（类型位置合法），但运行期没有名为 `Electron` 的全局绑定，`tsc` 与 ESLint 都放行、运行才 `ReferenceError`。这是只有跑一遍测试才能补上的坑。
- `app/electron/channelsConsistency.test.ts`（101 行）：通道名在三处出现（`electron/shared/channels.ts`、`src/constants.ts`、`electron/static/*.html|js`），测试守住三处不漂移。

### 4.3 IPC / 窗口 / 存储 / 更新各落到哪

| 关注点 | 落点 |
| --- | --- |
| IPC 装配 | `ipc/register.ts`（43 行）：只按顺序调用各域注册函数，是唯一装配点 |
| IPC 分派 | `ipc/getChannel.ts`（66 行）：远程内核拦截、上下文组装、按域分派；域表用对象展开合并，避免 `getChannel` 重新变胖 |
| 窗口账本（谁有这个窗口） | `window/windowRegistry.ts`（122 行）：按 `webContents id` 索引；**直接访问 `state.windows` 的只有它和 `shared/runtime.ts`**，ESLint `no-restricted-syntax` 三种写法（`state.windows.x`、`state["windows"]`、解构）全部 error |
| 窗口状态持久化 | `window/windowPreferences.ts` + `shared/atomicJsonFile.ts`（原子写 JSON） |
| 工作区列表持久化 | `window/windowWorkspaces.ts` |
| 崩溃记录 / 上次工作区 | `shared/crashHistory.ts`、`startup/lastWorkspace.ts`、`startup/enabledSettingFile.ts` |
| 远端连接存储 | `remote/connectionStore.ts` |
| 更新 | `startup/updateCoordination.ts` + `startup/updateInstall.ts`；退出侧由 `startup/systemShutdown.ts` + `window/appExit.ts` 协调 |
| 运行期状态 | `shared/runtime.ts` 的 `state`（157 行）：唯一容器、进程内同一引用；`startup` 整组写入后 `Object.freeze`；测试用 `resetRuntimeState()` 复位 |

### 4.4 入口与启动流程（装配点不在 main.ts）

`app/electron/main.ts` 全文 11 行，只做两件事（A2 全文）：

```ts
import "./environment";              // 副作用导入：环境变量要早于启动依赖图求值
import {bootstrap} from "./startup/bootstrap";
void bootstrap();
```

`startup/bootstrap.ts`（263 行）分三段：**① 就绪前定条件**（路径/日志 → Linux 输入法兼容重启 → 进程身份 → 单实例锁 → 远端参数与深链 → 协议注册 → Chromium 开关 → 辅助功能 → 首次启动探测 → `setStartupSnapshot()` 冻结）→ **② 装配能力**（设置任务桥、主窗口、设置窗口、`registerAppLifecycle()`、`app.whenReady().then(startAfterReady)`）→ **③ `startAfterReady()`**：`createKernelBoot` + `createNotebookSystemLock` → `prepareSession()` → `resolveStartupBranch()` → 按分支预创建启动页 → `createConnectionRuntime()` → `registerDesktopIpc()` → `startSecondInstance()` → `registerRuntimeHandlers()` → `runStartupBranch()`。

启动分支用判别联合 + `switch` + `assertNever` 保证穷尽，优先级：`remote-arg-invalid` → `remote-target` → `first-open` → `crash-recovery` → `workspace-missing` → `local-kernel`（README 表格 + `startup/startupBranches.ts`）。

README 还列了 **7 条顺序约束**（为什么必须这个顺序），例如「进程身份早于单实例锁（`userData` 决定锁落点）」「Linux 输入法兼容重启早于取锁/建窗/启动内核（兼容模式会就地剔除受管开关）」「会话策略早于任何页面加载」。**这类「顺序即正确性」的表格是这次文档里最可复用的产物。**

### 4.5 测试迁移与 ESM/CJS 处理

| 项 | 做法 | 来源 |
| --- | --- | --- |
| 测试位置 | 仍与源码同目录、同名（`x.ts` ↔ `x.test.ts`） | A2 |
| 测试文件改名 | 48 个 rename 里 **28 个**是 `.test.js → .test.ts`（如 `bootWindow.test.js → window/bootWindow.test.ts`、`settingsWindows.test.js → window/settingsWindows.test.ts`）；另 9 个 CJS 模块 `.js → .ts`、9 个静态资源原样搬家、2 个渲染脚本，git 历史保留 | A2 |
| 遗留 .js 测试 | 只剩 `markdown/windows.test.js`、`markdown/windows.dom.test.js` 2 个 | A2 |
| Electron 替身 | `fixtures/electronStub.ts`（117 行）：纯 Node 下 `require("electron")` 只返回路径字符串，用 `t.mock.module` + `mockElectron(t, {...})` 替换；**未提供的成员被调用即抛错**（让缺失替身立刻暴露）；测试入口带 `--experimental-test-module-mocks` | A2、`app/scripts/test.mjs` |
| 同层协作者不能 mock | tsx 把模块导出编译成 getter，`t.mock.method` 对其无效 → 只能「改共享状态/写磁盘」或把协作者留在注入面（README 明写） | `app/electron/README.md` |
| `import type` 纪律 | 测试里取类型一律 `import type`，否则会提前加载真实 Electron（README 明写） | 同上 |
| TS 配置三份 | `app/tsconfig.electron.json`（16 行，生产：`module/moduleResolution: node16`、`target: ES2022`、`strict: true`、`noEmit: true`、排除 `*.test.ts`）；`app/tsconfig.electron.test.json`（12 行，测试：`strict: false`、`noImplicitAny: false`，**有意的**——只拦结构错误）；`app/electron/tsconfig.json`（12 行，给编辑器用，避免 `.test.ts` 落进推断项目） | A2 |
| ESM/CJS | `app/package.json` **没有** `"type": "module"`（A6）；源码写 ESM TS，webpack 打 CJS bundle；`markdown/`、`preload.js`、`replaceFile.ps1` 保持 CJS 并由构建复制；TS 里仍用 `require()`（`module: node16` 下合法） | A2、A6 |
| 沙箱 preload | 本次未编译，随主进程产物原样分发；合并后的 follow-up 才「沙箱 preload 独立编译」 | A2、A4 |

---

## 5. 值得照抄 / 不值得照抄

### 5.1 值得照抄（按性价比排序）

| 模式 | 它解决了什么 | 为什么值得（理由） |
| --- | --- | --- |
| **依赖方向测试**（`architecture.test.ts`，85 行、零依赖） | 分层靠人 review 守不住；新增一级目录不登记就失败 | 一条测试换掉「架构会腐化」这个长期债；实现只用 `fs`+`path`+正则，任何 Node 项目可搬（本仓 `scripts/check-arch.mjs` 已有同思想，缺的是 `electron/` 这一项——见 §7） |
| **打包内容当测试断言** + **单一产物清单**（`electronPackageContent.js` 被构建脚本与测试共用） | 「测试/夹具被打进安装包」「改了 yml 漏改 main」这类静默回归 | 清单只有一处，漏项在构建侧与校验侧同时暴露；断言是「每个 builder 配置的 `files` 恰好是 dist」而不是「包含 dist」，写死才防回退 |
| **产物与源码同层的新目录**（`electron-dist`，不做 `src` 搬家） | `__dirname` 相对路径全量改写 + 导入路径全量改写 | 迁移面从「全仓路径重写」缩到「构建脚本 + 4 处配置」；这是本次改造能压进 3 个 commit 的关键 |
| **装配点外移 + 分段启动 + 判别联合 + `assertNever`** | 启动流程有 7 条顺序约束、6 个分支，靠人记顺序必错 | 顺序约束写进文档、分支穷尽交给编译器；新增分支漏 case 时编译失败，而不是运行期静默走错分支 |
| **单一运行期状态容器 + 冻结快照 + 测试复位** | 全局变量散落、用例互相污染 | `state` 一处定义、`startup` 冻结后不可变、`resetRuntimeState()` 给测试干净起点；比「每个模块导出自己的可变状态」好排查 |
| **账本 + ESLint `no-restricted-syntax`（含计算属性/解构三种写法）** | 「绕过账本直接改 `state.windows`」这类规则，warn 没人看 | 把约定写成 **error** 且覆盖三种语法形式；只放行账本模块与 runtime 两个文件 |
| **跨端一致性测试**（通道名三处比对） | 主进程/渲染进程/启动页脚本三处常量漂移 | 迁移时最容易漏的就是这种「同名常量分散在三个技术栈」；一条测试能定位漏改的那一侧 |
| **`import type` 纪律 + 替身缺失即抛错** | 测试意外加载真实 Electron；缺失替身静默返回 `undefined` | 让测试环境的错误**大声失败**，而不是靠断言莫名其妙地挂 |
| **迁移时保留 rename**（48 个） | 历史追溯、blame 可用 | `git log --follow` 仍能看到 `settingsWindows.js` 的演变；对「重构不能改行为」的审计很重要 |

### 5.2 不值得照抄 / 有代价（同等重要）

| 反面点 | 证据 | 代价 / 理由 |
| --- | --- | --- |
| **245 文件单 PR、3 个 commit、0 条 review** | A1：+16901/-10263，`review_comments: 0`、`reviews: 0`，只有 2 条 issue 评论 | 无法逐行 review，只能「合并后测」；重构 + bug fix + feature 接线混在一起（3 个 commit 分别是 migrate / fix / feature），出事无法二分定位。**应拆成 3 批**（门禁 → 装配外迁 → 资源与包清单分离） |
| **为「一层打包」引入 webpack** | 新增 `webpack.electron.js` + `esbuild-loader`；仓库已有 `tsx`；验证还依赖 `tsc` 两份配置 | 同一目录里四套转译/打包链（webpack、esbuild-loader、tsx、tsc）。若项目已有 Vite/Rollup/tsup，**不要为此加 webpack** |
| **tsconfig 三份 + 测试 `strict: false`** | `tsconfig.electron.test.json` 注释自认「测试夹具大量使用无注解的桩，逐个补注解不改变正确性」 | 生产严格、测试放宽，短期省事；但测试里的类型错误（属性不存在、回调签名漂移）只被「结构检查」覆盖，`any` 仍会渗进用例。**是明账，不是免费** |
| **测试与源码同目录 + 靠构建隔离** | 旧态 `files: ["electron"]` 直接打包源码 | 一旦有人新增「从源码目录直接读文件」的打包入口（或忘了跑 build），测试又进包；护栏只在「产物清单测试被跑」时生效 |
| **留一个 CJS 岛（`markdown/` + `preload.js`）** | PR 正文 Notes：「`app/electron/markdown/` 仍是 CommonJS，本次只把它接入新的启动流程」；合并后 follow-up 才迁 15 个模块 / 14 个测试 / 删 3 份 `.d.ts` | 双模块体系要维护两套测试发现规则、两套 mock 策略；合并后还要再来一整轮（A4 原文），且跨 ESM/CJS 边界的 preload 仍是例外 |
| **源码文本锚点测试** | `app/tests/mainWindowLoading.test.js` patch：从 `mainWindow.ts` 里 `slice(main.indexOf("const attachMainWindowReady ="), main.indexOf("const createMainWindow ="))` 取片段，再 `ts.transpileModule` 后 `new Function` 执行 | 函数改名/顺序调整就断；这类测试把「测试」变成「源码排版快照」。**新项目不要学**，应直接 import 可测函数 |
| **合并前没跑构建/打包** | A1 正文：「未执行 `pnpm build` / `pnpm dev`…Windows 安装包打包（`pnpm run dist`）未在本机运行」 | 「打包输入分离」这件事**只在测试里被断言过，没被真实构建验证**；产物清单测试在未构建时 `t.skip`，等于 CI 里可能是空转（§3.5） |
| **CI 未接入** | 245 个文件里 `.github/` 只改了 `SECURITY.md`（A2） | 新增的 `build:electron` 步骤没进任何 workflow；本地开发者忘了跑 build 就 `dist`，靠 `package.json` 的 `&&` 挡住（脚本层挡，不是 CI 挡） |
| **6 个 skip 用例** | A1 验证表：468 项，462 通过 / **6 跳过** / 0 失败 | skip 未说明清单；重构 PR 里 skip 是「未验证」的同义词，应逐条给理由 |
| **搬家中夹带行为修复** | PR 正文「迁移中暴露并修复的问题」列了 4 条（内核启动抛异常永久等待、失败路径同步抛、连接管理器重复副本、远端 handler 无归属记录） | 修复本身正确，但混在重构里让「改行为 vs 搬代码」不可区分；应单独 commit 并附回归用例（本次确实补了用例） |
| **文档/元信息同步成本** | `AGENTS.md`、`.github/SECURITY.md`、`kernel/util/session.go` 注释、`scripts/license-header.mjs` 白名单、`scripts/check-lang-keys.py`（+100 行，新增启动期语言包校验） | 「入口文件路径」被写死在至少 4 处非代码位置；迁移=全仓 grep 一遍，这是单文件入口的真实红利被高估的地方 |

---

## 6. 评审讨论与坑（事实清单）

### 6.1 讨论量本身就是一个坑

- `reviews: 0`、`review_comments: 0`（A5）；issue comments 只有 2 条（A4）：
  - 作者 `TCOTC`（2026-11-02T02:55:38Z）：「`88250 旧的代码都改成 TS 了，不过新增的 Markdown 编辑器的代码还是 JS，合并之后再让 AI 把 Markdown 编辑器的代码也重构成 TS 吧」
  - 维护者 `88250`（2026-11-02T05:35:49Z，合并后 1 分钟）：「已合并到 `dev`，并完成合并后的修复和迁移…」并列出后续处理
- **结论**：这不是「经过评审的改造」，而是「作者自审 + 维护者合并后补一刀」。任何想照抄的团队，**不能把它的设计当成被验证过的最佳实践**，只能当「作者一家之言 + 事后补丁记录」。

### 6.2 PR 正文自述「迁移中暴露并修复的问题」（4 条，原文转述）

| 问题 | 本质 | 对我们的启示 |
| --- | --- | --- |
| 内核启动尝试抛异常时**永久等待** | `initKernel` 的尝试 Promise 只由「就绪轮询/内核 close/before-quit 取消」三条路径结算，尝试本身抛出时无人结算 | 迁移「等待型」代码时，**失败路径也要结算**；重构最容易漏的是异常分支 |
| 失败路径读取窗口状态文件**会同步抛出** | 改为不再从写空文件入手读取 | 重构时把「读损坏文件」的兜底丢了，是典型的搬代码丢细节 |
| 连接管理器存在**结构重复的副本** | `shared/` 只登记它需要的 presenter 函数，不再复制一份语义更窄的连接管理器 | 跨层单例只保留一份引用；「为了解耦而复制」会变成双份状态 |
| 远端协议 handler **无归属记录** | 记录安装它的远端 origin，第二个目标被拒绝并留日志 | 全局 handler 注册在重构后容易变成「谁都能装」 |

### 6.3 合并后 follow-up 暴露的坑（A4 原文要点）

1. **CJS 岛必须再迁一轮**：15 个 Markdown JS 模块 → 严格 TS，移除 3 份手写 `.d.ts`，14 个测试文件迁移，沙箱 preload 独立编译。
2. **退出协调**：关闭欢迎页/工作空间选择页要以 `app.quit()` 走退出协调，先 Markdown 保存保护、再通知工作空间保存；取消或保存失败要保留应用——否则「直接结束进程丢失未保存内容」。
3. **竞态**：初始 Markdown 命令行请求在 `ready` 前按参数与工作目录**快照入队**，否则早到的 macOS `open-file` 事件会丢首个请求。
4. **构建监听漏依赖**：复制的静态资源与 Windows 替换脚本要纳入 webpack watch 依赖，否则「单独改 preload/ps1 不重建产物」。
5. **验证范围**：「本轮验证范围为上述受影响路径，环境为 Windows；安装包及 macOS/Linux 实机行为仍待验证」。

### 6.4 我们自己踩到的「口径坑」（写文档时容易抄错的地方）

| 说法 | 实际情况 | 结论 |
| --- | --- | --- |
| 「main.js 5292 行」 | PR 正文与删除行数一致（5292）；本机 3.8.4 是 **4601** 行 | 引用必须带版本：3.8.4 → 5292 的差距是版本增长 |
| 「34 个 `*.test.js` 被打进安装包」 | 逐文件重建：顶层 **36** 个 + `markdown/` 3 个 + `app/scripts` 1 个 = 40 个被触及 | 正文 34 可能是时点/口径差；**用它说明「测试进包」没问题，用它当精确数字不行** |
| 「改成严格 TS 分层模块，把源码目录和打包输入分开」 | 源码**没有**搬进 src 层，只是新增 `electron-dist` 产物目录 | 转述会误导要不要「新建 src 层」这个决策 |
| 「所有代码都 TS 了」 | `markdown/` 的 15 个 JS 模块 + `preload.js` 仍是 CJS | 迁移是分两轮的 |
| 「github.com 上能看到」 | 本机 `github.com`/`raw.githubusercontent.com` 超时，仅 `api.github.com` 可用 | 复现命令见附录 C |

---

## 7. 本仓（lakex-local-notes）对照：只给三条初步事实

> 完整审计见另一份文档 [docs/arch/ELECTRON-LAYERING-AUDIT.md](ELECTRON-LAYERING-AUDIT.md)（本目录已有），本节只记录我读代码时顺带确认的事实，不做审计结论。

1. **主进程已经是 TS**：[electron/main.ts](lakex-local-notes/electron/main.ts) 1102 行，`electron/` 185 个条目 / 308 个 `.ts` / 163 个 `.test.ts`（R2）——思源「单文件 CJS → TS」这一步本仓早已完成，**不需要抄**。
2. **产物目录已经分离**：[package.json](lakex-local-notes/package.json) 的 `main` 是 `dist-electron/main.js`，主进程由 [vite-plugin-electron](lakex-local-notes/vite.config.ts)（`vite.config.ts:47-50`）把 `electron/main.ts` 打成 `dist-electron`；`build.files` 白名单读产物（R1）。**与思源方案同构，只是工具从 webpack 换成 vite**。
3. **残留面**：`build.files` 里仍有 4 个源码文件被直接当打包输入（`electron/preload.cjs`、`electron/boot.html`、`electron/boot-anim.apng`、`electron/boot-poster.png`）——即「打包输入与源码目录分离」在本仓还差最后一小段；而思源的经验是：**把这 4 个文件也纳入构建产物 + 写一条打包内容测试**，比继续靠人记更划算（§5.1 第 2 条）。

---

## 8. 引用清单

| 代号 | 内容 | URL / 路径 |
| --- | --- | --- |
| A1 | PR 元数据与正文全文 | https://api.github.com/repos/siyuan-note/siyuan/pulls/21151 |
| A2 | 245 个逐文件状态/增删/patch（本文所有文件内容引用均出自此三页） | https://api.github.com/repos/siyuan-note/siyuan/pulls/21151/files?per_page=100&page=1 / `page=2` / `page=3` |
| A3 | 3 个 commit | https://api.github.com/repos/siyuan-note/siyuan/pulls/21151/commits |
| A4 | 2 条 issue 评论（含合并后迁移说明） | https://api.github.com/repos/siyuan-note/siyuan/issues/21151/comments |
| A5 | reviews（空） | https://api.github.com/repos/siyuan-note/siyuan/pulls/21151/reviews |
| A6 | `app/package.json` ` head 全文 | https://api.github.com/repos/siyuan-note/siyuan/contents/app/package.json?ref=4f00ee4e83604155f2242fc7a706d80b8ca12dd3 |
| L1 | 本机 3.8.4 旧 checkout 统计 | [siyuan-master/app/electron](siyuan-master/app/electron)（`main.js` 4601 行、`window.js` 920 行、35 个文件、12 个 `.test.js`、无子目录） |
| L2 | 3.8.4 单文件结构样本 | [siyuan-master/app/electron/main.js](siyuan-master/app/electron/main.js)（139 个顶层 `const`、23 处 `ipcMain.on`、4 处 `ipcMain.handle`） |
| L3 | 3.8.4 包入口与脚本 | [siyuan-master/app/package.json](siyuan-master/app/package.json)（`main: ./electron/main.js`、`typecheck` 不含 electron） |
| L4 | 3.8.4 打包配置 | [siyuan-master/app/electron-builder.yml](siyuan-master/app/electron-builder.yml)（`files: ["electron"]`、`extraMetadata.main: electron/main.js`，共 6 份 `electron-builder*.yml`） |
| R1 | 本仓打包配置 | [lakex-local-notes/package.json](lakex-local-notes/package.json)（`main: dist-electron/main.js`、`build.files`） |
| R2 | 本仓主进程构建入口 | [lakex-local-notes/vite.config.ts](lakex-local-notes/vite.config.ts)（`vite-plugin-electron`，entry `electron/main.ts`，outDir `dist-electron`） |
| R3 | 本仓对照审计 | [lakex-local-notes/docs/arch/ELECTRON-LAYERING-AUDIT.md](lakex-local-notes/docs/arch/ELECTRON-LAYERING-AUDIT.md) |

---

## 附录 A：本文用到的 API 原始数字（速查）

```
pulls/21151:  changed_files 245  additions 16901  deletions 10263  commits 3
              comments 2  review_comments 0  merged true
              base dev  head refactor/electron-modules
              head_sha 4f00ee4e83604155f2242fc7a706d80b8ca12dd3  merge_sha 097508a2c1bcdb61ae51def10f802c67c2144732
files(3 页共 245): added 141  renamed 48  removed 28  modified 28
              app/electron/ 213 文件 +16460/-10155
              app/electron/main.js  -5292 行（patch 省略，超 3000 行）
改造后 app/electron 现存 186 文件：
              102 生产 .ts（root 2 / shared 18 / startup 15 / window 27 / kernel 12 / remote 12 / ipc 16）
              63 测试（61 .test.ts + 2 .test.js）  3 .d.ts（markdown）
              2 测试替身（electronStub.ts / windowControlsStub.cjs）  4 静态 .js  12 静态资源/页面
改造前 app/electron 顶层 73 文件（3.8.4 为 35）：36 个 .test.js，其余为 main.js + CJS 模块 + 页面资源
```

## 附录 B：关键新增/改名文件清单（可照抄的最小集合）

| 文件 | 行数 | 作用 |
| --- | --- | --- |
| `app/electron/README.md` | +211 | 目录职责、依赖方向表、启动三段、7 条顺序约束、扩展指南、编码约定 |
| `app/electron/architecture.test.ts` | +85 | 依赖方向门禁（`allowedDependencies`） |
| `app/electron/channelsConsistency.test.ts` | +101 | 通道名三处一致性 |
| `app/electron/electronGlobalBinding.test.ts` | +61 | AST 查「值位置的 `Electron.X`」 |
| `app/scripts/electronPackageContent.test.js` | +89 | 打包内容断言（6 份 yml + main + dist 脚本 + 产物内容） |
| `app/scripts/build-electron.mjs` | +57 | 清产物、webpack 构建、复制静态资源、`--watch` |
| `app/scripts/electronPackageContent.js` | +12 | 产物清单单一来源 |
| `app/webpack.electron.js` | +43 | 主进程打包配置（`__dirname` 保留、externals、esbuild-loader） |
| `app/tsconfig.electron.json` / `tsconfig.electron.test.json` / `electron/tsconfig.json` | +16/+12/+12 | 生产 strict / 测试放宽 / 编辑器 |
| `app/electron/main.ts` + `startup/bootstrap.ts` | +11 / +263 | 入口只装配 + 三段启动 |
| `app/electron/fixtures/electronStub.ts` | +117 | Electron 替身（缺失即抛错） |
| `app/electron/static/window.js` + `static/window-languages.json` | +267 / +684 | 旧 920 行 `window.js` 拆为「脚本 + 语言包」 |

## 附录 C：复现本文证据的命令

```bash
# 元数据（本机仅 api.github.com 可达；github.com / raw.githubusercontent.com 会超时）
curl -sS -H 'Accept: application/vnd.github+json' \
  'https://api.github.com/repos/siyuan-note/siyuan/pulls/21151' -o pr.json

# 245 个文件（3 页），每页含 patch
for p in 1 2 3; do
  curl -sS -H 'Accept: application/vnd.github+json' \
    "https://api.github.com/repos/siyuan-note/siyuan/pulls/21151/files?per_page=100&page=$p" -o files$p.json
done

# 讨论与评审
curl -sS -H 'Accept: application/vnd.github+json' \
  'https://api.github.com/repos/siyuan-note/siyuan/issues/21151/comments' -o comments.json
curl -sS -H 'Accept: application/vnd.github+json' \
  'https://api.github.com/repos/siyuan-note/siyuan/pulls/21151/reviews' -o reviews.json

# 改造前形态（本机 3.8.4）
wc -l siyuan-master/app/electron/main.js        # 4601
ls siyuan-master/app/electron | wc -l            # 35
grep -c '^const [a-zA-Z0-9_]* = ' siyuan-master/app/electron/main.js   # 139
```
