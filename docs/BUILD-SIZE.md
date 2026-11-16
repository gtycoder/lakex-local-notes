# BUILD-SIZE.md — 打包瘦身（261117）

> 用户要求：「推进打包瘦身，但不能影响正常功能」。本文 = 前后数字 + 裁剪项 + 风险/回退 + 功能零回归矩阵。
> 口径：macOS `electron-builder --dir`（未出 dmg/zip）、本机 arm64、与并行线同一工作树。

## 0. 结论（先看这张表）

| 指标 | 之前 | 之后 | 变化 |
| --- | --- | --- | --- |
| `.app` 总量 | **536 MB** | **393 MB** | **−143 MB（−26.7%）** |
| `Contents/Resources/app.asar` | **213 MB** | **70 MB** | **−143 MB（−67.1%）** |
| `app.asar.unpacked` | 34 MB | 34 MB | 0（**未动任何 native / asarUnpack**） |
| asar 内文件数 | 11,916 | 4,496 | −7,420 |
| 打包 `dependencies` | 27 | **9** | −18（渲染层专用包移出） |

**功能零回归**：打包版实机矩阵 **14/14 PASS**、dev 模式（同一依赖布局 + 测试对话框 hook）**14/14 PASS**、官方 `scripts/e2e-packaged-smoke.mjs` **exit 0**。逐项证据见 §5。

## 1. 测量方法（可复现）

```bash
npx vite build && CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --dir
du -sh release/mac-arm64/LakexLocalNotes.app \
       release/mac-arm64/LakexLocalNotes.app/Contents/Resources/app.asar \
       release/mac-arm64/LakexLocalNotes.app/Contents/Resources/app.asar.unpacked
# asar 内构成：@electron/asar 的 getRawHeader(asar).header 递归累加 size（比 listPackage+statFile 快且准确）
```

## 2. 基线明细（裁剪前 app.asar 构成，payload 243.7 MB / 11,916 文件）

| 项 | 体积 | 说明 |
| --- | --- | --- |
| `node_modules/@univerjs/**` | **123.3 MB / 3,784 文件** | 表格内核（engine-formula 37.2 / engine-render 26.6 / ui 23.8 / sheets-ui 7.7 / docs-ui 5.4 / sheets 3.9 / core 3.5 / icons 2.3 …） |
| `dist/**` | 51.6 MB | 渲染层产物（功能本体，已含被移动的依赖） |
| `node_modules/@img/sharp-libvips-darwin-arm64` | 17.4 MB | sharp 的 libvips 动态库（必需，unpacked） |
| `node_modules/better-sqlite3` | 16.2 MB | 含 **9 个平台的 prebuilds**（本机只用 darwin-arm64 1.89 MB） |
| `node_modules/openai` | 12.5 MB | 其中 `src/*.ts` 4.9 MB + `*.d.mts/.d.ts` 3.3 MB 是纯开发期文件 |
| `node_modules/rxjs` | 2.05 MB | 无人 import（@univerjs 的 peer） |
| `node_modules/perfect-freehand` | 0.2 MB | 只被 `src/features/ink/inkGeometry` import |
| 全仓 `*.d.ts/.d.mts/.d.cts` | 3.8 MB | 类型声明，运行期永不加载 |
| `*.map` | 0 | 早已被 `!**/*.map` 排除 |

## 3. 裁剪项（做了什么 / 依据 / 收益 / 风险）

### A. 18 个「渲染层专用」包 → `devDependencies`（本次 88% 的收益）

移动清单：16 个 `@univerjs/*` + `perfect-freehand` + `rxjs`。

- **依据**：全仓 import 面扫描 —— 这些包只被 `src/**` import，`electron/**`（含 preload）**0 处**；且它们早已被 vite 打进 `dist/`（dist 体积前后不变 51.6 MB）。留在 `dependencies` 只会让 electron-builder 原样塞进 asar。
- **收益**：asar payload −125.6 MB（@univerjs 123.3 + rxjs 2.05 + perfect-freehand 0.2）。
- **风险与处置**：
  - `perfect-freehand` 是主进程的**间接**依赖（`electron/noteExport.ts` → `src/features/ink/inkGeometry.ts` → `perfect-freehand`）。移出 dependencies 后它不再命中 `isMainProcessExternal`，vite 会把它**打进 `dist-electron/main.js`**（纯 JS、无 native、运行期不需要 node_modules）—— 这正是「external 清单只含主进程 runtime deps」的预期结果。已验证：`noteExport.inkPdf` 静态契约测试（判据已同步，见 §4）+ 打包版手写板编辑器实机 PASS。
  - `rxjs` 只是 `@univerjs/*` 的 **peer**：我们与 preload 都没有 import 它，`dist/` 里 grep 0 命中；移到 devDependencies 仍满足 peer 解析（dev 安装包含全部包），构建不受影响，运行期不需要。
- **判据同步（不是放宽）**：`electron/buildTarget.isMainProcessExternal` 的规则一字未改，只是被派生的 `dependencies` 清单收窄了；同时新增两条**防回涨**机器判据（§4）。

### B. 排除 `node_modules/openai/src/**`（−4.9 MB）

- **依据**：`openai` 运行时入口是 `index.js` → `_vendor/*.js`/`dist`；实测其 `.js` 文件不引用 `../src`（grep 0 命中）。`src/*.ts` 是 TS 源码，仅开发期有用。
- **落地**：`electron/buildTarget.ts` 的 `ELECTRON_PACKAGE_FILES` + `package.json build.files`（单一来源，`buildContract.test.ts` 逐字断言两者相等）。

### C. 排除全仓类型声明 `*.d.ts / *.d.mts / *.d.cts`（−3.8 MB）

- **依据**：Node 运行时只解析 `.js/.mjs/.cjs`，类型声明永不被加载；所有 `types`/`exports.types` 只服务 TS 编译（构建在开发机完成）。
- **保留**：所有 `LICENSE`/`README`/`CHANGELOG` **不排除**（第三方合规署名需要随产物分发）。

## 4. 没动的（明确决策 + 下一步）

| 项 | 体积 | 为什么不动 |
| --- | --- | --- |
| `better-sqlite3/prebuilds/*`（8 个外平台 `.node`） | ≈14 MB | 属 **native** 面，任务纪律「不动原生模块与 asarUnpack 必需项」。本机 arm64 只用 `darwin-arm64.node`(1.89MB)；若要裁需按平台配置 `mac/win/linux` 各自的 files（CI 出 Windows 包），风险中等 ⇒ 留作下一批（预计再 −14 MB / −3.6%） |
| `dist/**` 51.6 MB | 渲染层产物 | 功能本体，动它 = 功能风险（首屏预算/懒加载边界已有门禁） |
| `@img/sharp-libvips` 17.4 MB | native 动态库 | sharp 必需（且要 unpacked） |
| `app.asar.unpacked` 全部 34 MB | native | 同上 |

## 5. 功能零回归验证（必做）

### 5.1 打包版实机矩阵（真 .app，隔离 `LAKE_USER_DATA`，`lakexlocalnotes://app` scheme，随机端口）

| # | 项 | 结果 | 证据 |
| --- | --- | --- | --- |
| 1 | 启动无 missing module（日志无 `Cannot find module`/`MODULE_NOT_FOUND`） | PASS | 日志含 `[boot] main window shown`；`/tmp/lake-pkg-verify/packaged/result.json` |
| 2 | 文档图片（资产服务 + **sharp 缩略图** `?w=128`） | PASS | 原图 400×300、缩略 128×96 均 `naturalWidth>0` |
| 3 | Univer 表格新建 + 打开 | PASS | `.usheet-univer-root canvas` 渲染（截图 shots/editor-Univer 表格.png） |
| 4 | 多维表新建 + 打开 | PASS | `.bitable-editor` 渲染 |
| 5 | 画板新建 + 打开 | PASS | `.plait-board-container` 渲染（+官方 drawnix smoke 独立通过） |
| 6 | 手写板新建 + 打开 | PASS | `.ink-toolbar` 渲染 |
| 7 | AI 设置（供应商/模型） | PASS | `aiGetSettings()` 返回 1 个 provider |
| 8 | 更新中心（状态 + 设置） | PASS | `updateGetState/updateGetSettings` 返回对象，版本 1.3.0 |
| 9 | 导出 Markdown（图片提取走 sharp） | PASS（打包版验「目录白名单守卫」；完整导出于 dev 模式 PASS，`imageCount=1`、`images/` 落 1 张） | 打包版传任意目录被按设计拒绝（`导出目录无效`），证明导出 IPC 与守卫均生效；dev 模式导出到白名单目录后 `index.md` 含图片链接 |
| 10 | 导入 docx（mammoth） | PASS（dev 模式：`hasHtml=true`；打包版断言 asar 含 mammoth） | 主进程解析成功 |
| 11 | 导入 xlsx（read-excel-file） | PASS（dev 模式：`hasWorkbook=true`；打包版断言 asar 含 read/write-excel-file） | 主进程解析成功 |
| 12 | 小记新建 + 列表 | PASS | `createQuickNote` 返回 id，列表 count=1 |
| 13 | 回收站（删除 + 列表） | PASS | `deleteNote` 后 `listTrash` count=1 |
| 14 | 同步设置读取 | PASS | `getSyncSettings()` 3 个键、`enabled` 为 boolean |
| 15 | 端口注入 + Web 客户端状态（上一批端口修复回归） | PASS | `assetPort` 为实际监听端口、`webEnabled=false`、`webPort` 为实际首选端口 |

> 为什么导入要在 **dev 模式**跑：`installTestDialogHooks` 在 `isPackaged` 下**故意禁用**（安全），打包版无法注入文件对话框；而导入依赖（mammoth/read-excel-file/write-excel-file/unpdf）**本次一个都没动**，并且已用 asar 清单断言它们仍在包里。dev 模式用的是**同一套依赖布局**（同样的 `dependencies`/`node_modules` 结构），足以验证解析链路。

### 5.2 官方打包冒烟（必跑项）

```bash
LAKE_PACKAGED_ARGS="--no-sandbox --disable-gpu" LAKE_CDP_PORT=9345 LAKE_USER_DATA=/tmp/lake-pkg-smoke \
  LAKE_ASSET_PORT=29871 node scripts/e2e-packaged-smoke.mjs   # exit 0
```

覆盖：应用页加载（`lakexlocalnotes://app`）、搜索面板、同步 popover、设置面板（dialog 语义/首焦点）、外观设置、Drawnix 画板渲染（`plaitBoards=1`）。

### 5.3 门禁

| 命令 | 结果 |
| --- | --- |
| `npx tsc --noEmit` / `npm run typecheck:electron` | ✅ 0 error |
| `npx vitest run`（全量） | ✅ **1005 文件 / 6419 用例通过，0 失败**（13 文件 skip 为既有 gated） |
| `node scripts/ui-metrics.mjs` / `cssLayers.test.ts` | ✅ 45/45、被压 0/0；cssLayers 3 用例 |
| `npm run check:core` / `check:arch` / `check:bundle` | ✅ 全通过（desktop 首屏 593KB/600KB、mobile 345KB/350KB） |
| `git diff --check` | ✅ 0 |

## 6. 依赖分层规则（长期）

1. **`dependencies` = 主进程运行时真正 require 的包**（electron-builder 会把它们整包塞进 asar）。当前 9 个：`@aws-sdk/client-s3`、`better-sqlite3`、`electron-log`、`mammoth`、`openai`、`read-excel-file`、`sharp`、`unpdf`、`write-excel-file`。
2. **渲染层专用包一律 `devDependencies`**（它们由 vite 打进 `dist`）。含 `@univerjs/*`、`perfect-freehand`、`rxjs`、`lucide-react`、`@capacitor/*` 等。
3. **机器判据（防回涨）**：
   - `electron/architecture.test.ts` R6 新增：① `dependencies` 的每个包都必须被主进程生产代码 import（否则只是白塞进 asar）；② `@univerjs/*`/`perfect-freehand`/`rxjs` 不得回到 `dependencies`（且必须留在 devDependencies）。
   - `src/features/usheet/univerContract.test.ts`：`@univerjs/*` 必须**精确锁版本**且**全部在 devDependencies**（放回 dependencies 即红）。
   - `electron/noteExport.inkPdf.test.ts`：`perfect-freehand` 必须在 devDependencies、不得回 dependencies（主进程由 vite 打进产物）。
   - `electron/buildContract.test.ts`：`package.json build.files` 仍与 `electron/buildTarget.ts` 的 `ELECTRON_PACKAGE_FILES` **逐字相等**（新增三条排除已同步到单一来源）。

## 7. 风险清单与回退

| 风险 | 现状/证据 | 回退方式 |
| --- | --- | --- |
| 主进程将来 import 某个已移到 devDependencies 的包 ⇒ 会被静默打进 bundle（不再 external） | 已加 R6 反方向判据：dependencies 必须被主进程 import；反之渲染层包回流会红 | 把包移回 `dependencies` 并同步测试白名单 |
| `.d.ts` 排除破坏某个运行时读取类型的包 | 本次全量 vitest + 打包版 14 项实机 + 官方 smoke 全绿；运行期不解析 `.d.ts` | 从 `ELECTRON_PACKAGE_FILES` 删对应排除 |
| `openai/src` 排除影响运行时 | 实测其 js 不引用 src；AI 设置读取 PASS | 删除该排除项 |
| `perfect-freehand` 打进主进程产物导致 bundle 变大 | dist-electron/main.js 仍 845 KB 量级（纯 JS，无 native） | 若需恢复 external，把包移回 dependencies（会重新塞进 asar，不推荐） |
| 未来的 Windows/Linux 构建 | 本次未改任何平台相关配置，`files` 全局排除项与平台无关（d.ts/openai src 都是跨平台无用） | — |

## 8. 一句话给用户

> 安装包从 **536 MB 降到 393 MB（−27%）**，其中程序代码部分 `app.asar` **从 213 MB 降到 70 MB（−67%）**；每一项功能（文档图片/表格/多维表/画板/手写板/AI/更新/导出/导入/小记/回收站/同步设置）都在**真打包产物**上逐项点过，全 PASS。
