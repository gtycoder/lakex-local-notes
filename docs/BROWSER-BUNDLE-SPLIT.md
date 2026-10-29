# 浏览器 P2：双 bundle（Electron / 浏览器）量化评估

> **结论：不做。** 现有 `dist/` 里**没有** Electron-only 依赖（主进程依赖 0 个进入渲染层），浏览器端首屏
> `2.78 MB gzip` 中约 **90% 是两端共用的 Lake 内核**（`1.71 MB gzip`）——双 bundle 能剪掉的
> Electron-only 渲染层代码 **< 5 KB 源码（< 0.5 KB gzip，≈0.02% 首屏）**，初始化收益 < 0.1 ms（噪声内）；
> 成本则是第三条构建链 + 发布包再涨约 **20 MB（压缩后）**。
> 本文只做量化，不改任何构建/源码。依据 `docs/audit-261027/11-browser-end-plan.md` §3 P2、`docs/HANDOFF.md` §3
> 「浏览器端 P2（bundle 分离，需先量化）」。
>
> 口径：仓库 `master @ ea576a80` + 工作树；读取**已构建**的 `dist/`（718 个文件 / 51,339,699 B）与
> `dist-mobile/`（仅作对照），未重新构建 dist。字节 = 文件大小，gzip = `zlib.gzipSync(level 9)`。

---

## 1. 现状：浏览器端就是「同一份 dist + HTTP shim」

| 事实 | 证据 |
| --- | --- |
| 浏览器端入口 = `GET /` → 静态服务 **`dist/`**（与 Electron 同一份产物） | `electron/webApiServer.ts:13`（注释）、`:810-812`（static）、`:686`（只认 `/` 与 `/index.html`） |
| Electron 渲染层也从 `dist/` 加载（私有协议） | `electron/main.ts:68-70` `rendererDistDir() = <app>/dist`；`:637` 传给 web server |
| 浏览器能力靠 **注入 `/__native.js` shim**，不是另一份前端 | `electron/webApiServer.ts:312-316`：在 bundle 之前插入 `<script src="/__native.js">` |
| 浏览器端跑的是同一套桌面渲染层（P0.5/P1 后编辑/导出也可用） | `docs/audit-261027/11-browser-end-plan.md` §3 P0.5/P1 |
| 首个能力矩阵（P1）已经用运行时标志隔离差异 | `src/lib/hostCapabilities.ts`（`browserClient/localFileSystem/importExport/nativeDialog/windowControls/globalShortcuts`） |

`dist-electron/`（主进程）**不在**浏览器静态服务范围内；web server 只服务 `dist/`。

---

## 2. 首屏传输清单（浏览器打开一次要拿的字节）

入口是 `index.html` 里的 1 个 `<script type="module">` + 25 条 `modulepreload` + 1 个 stylesheet，
外加 body 末尾一个**同步**（无 defer/async）的 CodeMirror 脚本。实测：

| 项 | 文件 | raw (B) | gzip (B) | 占首屏 gzip |
| --- | --- | ---: | ---: | ---: |
| 入口 chunk | `assets/index-H5DLWoQg.js` | 6,983,329 | 1,906,889 | 68.6% |
| 25 条 modulepreload（合计） | `react-dom`、`chunk-WYO6CB5R`、`rough.esm` 等 | 648,475 | 163,307 | 5.9% |
| 入口 CSS | `assets/index-CnOkv0c8.css` | 1,799,001 | 303,797 | 10.9% |
| CodeMirror（body，同步阻塞） | `vendor/cdn/.../lake-codemirror/7.1.3/CodeMirror.js` | 1,223,108 | 407,375 | 14.6% |
| **首屏 JS+CSS 合计** | — | **10,653,913** | **2,781,368** | 100% |
| index.html | `dist/index.html` | 3,351 | 1,180 | — |

> 口径说明：`webApiServer` 未实现 `Content-Encoding`（全文件无 gzip/br 分支），浏览器实际拿到的是 **raw 字节**
> （loopback，传输耗时可不计，代价主要在 V8 解析/执行）；gzip 列用于与构建预算、安装包压缩后体积同口径比较。

参考：全量 `dist/assets` = **251 个 JS / 33,830,038 B raw / 8,928,926 B gzip**；`dist` 全部可压缩文件
（701 个，js/css/html/svg/字体）**50,123,045 B raw / 20,440,304 B gzip**。即首屏只拿了全量 JS 的
**22.6% raw**——懒加载边界本身已经工作正常（见 §3）。

---

## 3. 入口 chunk / 模块组成

### 3.1 静态图（首屏）

- 入口 + 静态子 chunk = **26 个文件 / 7,631,804 B raw / 2,070,196 B gzip**。
- 静态子 chunk 里能看到文档渲染所需的 `katex` / d3 / rough / mindmap / markdown 片段
  （如 `chunk-WYO6CB5R` 224 KB raw 命中 `katex`、`d3`、`elk`、`mindmap`、`markdown`、`highlight`；
  `rough.esm` 27 KB raw）—— 这些是 doc 渲染的公共依赖，不是 Electron-only。
- 入口 chunk 同源文件（`index-H5DLWoQg.js`）内命中内核/文档栈专属串：
  `ne-table-hole`（字符偏移 5,557,862）、`ant-` 93 次、`katex` 30 次、`codemirror` 29 次、
  `mindmap` 179 次、`mermaid` 28 次、`rough` 81 次。
- 更硬的证据：入口覆盖 vendor 内核产物里 **807/823 = 98.1%** 的 `ne-*` 专有类名 ⇒ 内核基本完整地在入口里。

### 3.2 内核占比估算（为什么双 bundle 剪不动）

| 量 | 数值 | 说明 |
| --- | ---: | --- |
| 入口 chunk | 6,983,329 B / 1,906,889 B gz | 实测 |
| vendor 内核 ESM 产物（未压缩） | 6,583,068 B / 1,321,425 B gz | `vendor/lakex-doc-react/dist/index.es.js`，197,592 行（未 minify） |
| **同版本 rolldown 重新 minify 后的内核主 chunk** | **6,484,523 B / 1,708,264 B gz** | 读现有 vendor 产物，输出到 `/tmp`（未碰仓库） |
| 内核 / 入口 | **≈92.9% raw / ≈89.6% gzip** | 估算（未对 tree-shaking 做逐导出对拍；动态 import 的内核子 chunk 另计） |

结论：入口 ≈ **Lake 内核（两端共用）+ 约 0.2 MB gzip 的应用壳**。浏览器要「正常读笔记」就必须有这份内核
（doc 标签直接挂内核；`QuickNoteKernelPreview` 兜底也走内核）。任何「浏览器专用 bundle」都删不掉它。

### 3.3 懒加载边界（已做对，不需要 bundle 拆分）

| 组 | 文件数 | raw (B) | gzip (B) |
| --- | ---: | ---: | ---: |
| `UniverSheetEditor`（表格） | 1 | 7,068,762 | 1,836,771 |
| `plantuml`（文本绘图） | 1 | 6,394,589 | 1,400,694 |
| `viz-global` / `flowchart` / `cytoscape` | 4 | 3,395,894 | 1,196,203 |
| `DrawnixBoardCore`（画板） | 1 | 724,686 | 226,046 |
| `BitableEditor`（多维表） | 1 | 194,880 | 54,668 |
| 其余 217 个懒 chunk（含语言包） | — | — | — |
| **全部懒 chunk** | **225** | **26,198,234** | **6,858,730** |

懒 JS = 全部 JS 的 **77.4% raw / 76.8% gzip**。真正的首屏优化空间在「入口静态图」（尤其内核与
CodeMirror），而不在「Electron / 浏览器」这条切分线上。

---

## 4. Electron-only 依赖核查：**一个都没进 web bundle**

### 4.1 主进程依赖 → 渲染层 import 对拍（读源码统计）

| 依赖 | `src/` 渲染层引用 | `electron/` 主进程引用 | 结论 |
| --- | ---: | ---: | --- |
| `@aws-sdk/client-s3` | 0 | 2（`s3Store.ts`、`s3v3/s3Remote.ts`） | 未进 web bundle |
| `better-sqlite3` | 0 | 2（`store.ts`、`quickNotes.ts`） | 未进 |
| `electron-log` | 0 | 1（`logger.ts`） | 未进 |
| `openai` | 0 | 1（`ai/aiClient.ts`） | 未进 |
| `sharp` | 0 | 6（`assetServer.ts`、`ai/aiImages.ts` …） | 未进 |
| `unpdf` / `write-excel-file` | 0 | 各 1 | 未进 |
| `@univerjs/*`、`perfect-freehand` | 有（懒 chunk） | 0 | 浏览器端也需要 |

### 4.2 `dist` 产物 grep（251 个 JS chunk 全量扫描）

**0 命中**：`ipcRenderer`、`contextBridge`、`process.versions.electron`、`child_process`、`node:fs`、
`electron-updater`、`autoUpdater`、`showSaveDialog`、`BrowserWindow`、`webContents`、`app.getPath`、
`registerNotes`、`desktopSync`。

**「命中」但只是文案**：`better-sqlite3` / `@aws-sdk` 只出现在设置页「关于 · 开源依赖」的介绍文案里
（入口偏移 ~6.58M），不是代码引用。`window.lakeNative` 命中是**设计内的桥接**：preload 与
`/__native.js` shim 提供同一套方法面（`webApiServer.ts:13` 注释、`src/lib/native.ts`），不是 Electron 运行时依赖。

### 4.3 构建配置

`vite.config.ts:35-39,47-54` 的 `isMainProcessExternal()` 只作用于 **`vite-plugin-electron` 的主进程构建**
（`outDir: dist-electron`）；渲染层构建（`outDir: dist`，`vite.config.ts:92-95`）没有 externals，
也没有任何 Electron-only import 可剪。`vite.mobile.config.ts` 是**另一套 UI**（`mobile.html`）的第二条构建，
不是目标剪裁的先例。

### 4.4 真正「Electron-only」的渲染层代码有多少

只有能力矩阵的运行时分支：

- `src/lib/hostCapabilities.ts`（2,979 B 源码）；
- `ExportSubmenuItem.tsx` 1 处 `importExport` 判断、`SettingsPanel.tsx` 2 处 `localFileSystem` 守卫、
  `useNoteActions.ts` 1 处导出目录判断（合计约 20-30 行）。

且 `windowControls` / `globalShortcuts` 两个字段**只声明、UI 未使用**（grep 仅矩阵与测试命中）。
`src/desktop/**`（48 KB 源码：顶栏/浮层/布局）是**两端共用的桌面 UI**，不是 Electron-only，浏览器端照样渲染它。

**可剪上限 ≈ 5 KB 源码。** 按入口里应用壳的压缩比（0.199 MB gzip / 约 2.5 MB 源码 ≈ 8%）折算，**< 0.5 KB gzip**，
占首屏 2.78 MB 的 **约 0.02%**。而运行时 `if (capabilities.x)` 分支除非重构成独立模块，否则连这 0.5 KB 也剪不掉。

---

## 5. 双 bundle 收益估算

### 5.1 字节

| 方案 | 首屏 gzip | 可省 | 占比 |
| --- | ---: | ---: | ---: |
| 现状（同一份 dist） | 2,781,368 B | — | — |
| 双 bundle（最理想：剪掉全部 Electron-only 分支） | 2,780,900 B 量级 | **< 0.5 KB gzip / ≈< 2 KB raw** | **< 0.02%** |
| 参考：即使把整个应用壳（除内核外全部）删掉 | — | 199 KB | 7.2%（不可能：没 UI） |
| 参考：能删掉整个 `src/desktop/`（48 KB 源码，但浏览器也要它） | — | ≈4 KB | 0.14% |

### 5.2 初始化

V8（Node 24.18，同引擎）实测 `vm.SourceTextModule` 解析（3 次取最小，仅 lazy parse，不含执行）：

| 文件 | 字符数 | 解析 ms |
| --- | ---: | ---: |
| 入口 chunk | 6,800,559 | **70.1** |
| CodeMirror | 1,222,888 | 11.0 |
| react-dom | 132,671 | 1.6 |

按 0.02% 的可剪比例折算，初始化节省 **< 0.02 ms**（70.1 × 0.0002）；即便把可剪面上限放大 10 倍也 < 0.2 ms，
远低于启动路径的抖动（同步/引导/首帧都在几十到几百 ms 级；移动端移除 6.1 MB 内核后实测 6123 ms → 533 ms，
说明「MB 级公共内核」才是量级变量，而不是这几 KB 的宿主分支）。

### 5.3 为什么移动端 `dist-mobile` 不能当反例

`dist-mobile` 入口只有 `mobile-AxJX11ri.js` **225,585 B raw / 71,393 B gzip**（21 条 preload、CSS 137 KB gz），
看起来「分离很赚」——但它省下来的是**另一套 UI + 内核懒加载**（`mobile.html` 入口，`vite.mobile.config.ts:6-9`），
不是「剪掉 Electron 代码」。浏览器端跑的是桌面 UI，同样的办法只能把内核挪到打开文档之后，而那正是用户要看的页面。

---

## 6. 成本

| 维度 | 成本 | 依据 |
| --- | --- | --- |
| 构建 | 第三条构建链（新增 config/入口/output），每次发布多跑一遍完整 renderer 构建 | `vite.mobile.config.ts` 已有先例；CI 现在 mac/win 各一次 + mobile 一次（`.github/workflows/release.yml:34,75,128`） |
| 发布体积 | 若与 `dist` 一起打进安装包：asar 新增一整份构建产物；按 `dist` 可压缩文件实测 **+50.1 MB raw / +20.4 MB gzip** | `package.json.build.files` 目前只含 `dist/**/*`；两构建产物 hash 不同，共享 chunk 无法跨构建去重 |
| 维护 | 两套产物同源，能力/保存/安全逻辑容易出现「只改一边」；CORE-03（打开=只读）刚统一到 `core/docBaseline`，双产物等于重新引入“两份编译分支”的漂移面 | 本轮 09 CORE-03 收尾；`src/core/docBaseline.ts` |
| 安全 | SEC-07 刚把 token 面收口到 cookie/同源校验；第二个产物需要重新验证 CSP/Origin/下载端点/资产 token | `webApiServer.ts:253`（来源判定单一来源）、`docs/audit-261027/11-browser-end-plan.md` §3 P0 |
| 门禁 | `check:bundle`（需新增 browser 预算）、CSS 层/第三方 CSS 审计、webApiServer 33 例、桌面 42 态快照都可能要按产物跑两遍 | `scripts/check-bundle-budget.mjs`、`src/styles/cssLayers.test.ts` |
| 开发/排查 | 浏览器端必须 build 后才能跑（现状 `dist/index.html` 缺失会报 503）；两产物会让“我改的到底在哪个包里”成为日常问题 | `webApiServer.ts:819` |
| 回滚 | 双产物 = 双发布开关，回滚需要同时换两份 | — |

用户收益侧：浏览器端用途是「分屏读笔记」（`11-browser-end-plan.md` 开头），首屏差异 < 0.1 ms / 0.5 KB，
**不可感知**；而安装包 +20 MB 是可感知的成本。

---

## 7. 建议

**不做 P2（bundle 分离）。** 现状应保持「同一份 `dist` + 能力矩阵（P1 已完成）+ HTTP shim」：

1. Electron-only **依赖**本来就没有进 web bundle（§4），P2 要解决的问题不存在；
2. Electron-only **渲染层代码** < 5 KB 源码（§4.4），最理想剪裁 < 0.5 KB gzip（§5.1）；
3. 首屏 90% 是两端共用的 Lake 内核（§3.2），双 bundle 无法触及；
4. 成本是第三条构建 + 安装包 +20 MB（压缩后）+ 双份门禁/安全复核（§6）。

**重新评估的触发条件（满足任一才值得再立项）**：

- 出现「浏览器端不需要、但体积 ≥ 200 KB gzip」的公共依赖可被整块裁掉（当前最大的可裁项是 0.2 MB 应用壳，
  且它是 UI 本身）；
- 实测浏览器端首屏/首次交互有 ≥ 20% 来自 Electron-only 初始化路径（现有证据不支持：字节与解析都被内核主导）；
- Electron-only 渲染层代码增长到 ≥ 200 KB gzip（当前 < 0.5 KB）。

**如果目标是首屏更小，优先做两条共享优化（都比重开一个 bundle 划算，且不改产品语义）**：

- CodeMirror 的 `1.22 MB raw / 407 KB gzip` 同步脚本（占首屏 14.6%）——评估能否延后到首次出现代码块时再加载
  （需先确认内核代码块契约，属共享优化，不是本 P2）；
- 入口内核：桌面/浏览器都以文档为主界面，剪不动；移动端那套「内核懒加载」只对空壳首页成立，
  浏览器端照搬会把首屏白屏时间挪到打开文档时（用户实际等待更长）。

> 文档结论与 `docs/audit-261027/11-browser-end-plan.md` P2 的「先量化再决定」一致：**量化后决定不做**；
> 建议后续把该条从 HANDOFF「未做/延后」里改为「已评估·不做」（需 lead 统一改 HANDOFF，本文不改）。

---

## 8. 复现方式（全部只读）

```bash
export PATH="$HOME/.nvm/versions/node/v24.18.0/bin:$PATH"
cd /Users/admin/file/local-lake/lakex-local-notes

# 首屏清单（entry + modulepreload + css + CodeMirror）
node - <<'NODE'
const fs=require('fs'),path=require('path'),zlib=require('zlib');
const root='dist', html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const entry=html.match(/<script[^>]*src="\.\/assets\/([^"]+\.js)"/)[1];
const pre=[...html.matchAll(/rel="modulepreload"[^>]*href="\.\/assets\/([^"]+)"/g)].map(m=>m[1]);
const css=html.match(/rel="stylesheet"[^>]*href="\.\/assets\/([^"]+\.css)"/)[1];
const cm='vendor/cdn/as/g/larkgroup/lake-codemirror/7.1.3/CodeMirror.js';
let raw=0,gz=0;
for(const f of [entry,...pre].map(f=>'assets/'+f).concat('assets/'+css,cm)){
  const b=fs.readFileSync(path.join(root,f)); raw+=b.length; gz+=zlib.gzipSync(b,{level:9}).length;
}
console.log({entry,preloads:pre.length,css,raw,gz});
NODE

# 主进程依赖是否被渲染层 import（应为 0）
grep -rn "from \"better-sqlite3\"\|from \"sharp\"\|from \"@aws-sdk" src --include=*.ts --include=*.tsx | wc -l

# 产物里 Electron 运行时痕迹（应为 0；better-sqlite3/@aws-sdk 只出现在设置页文案）
grep -l "ipcRenderer\|contextBridge\|child_process\|node:fs" dist/assets/*.js | wc -l

# 现有预算门禁
node scripts/check-bundle-budget.mjs
```

（内核 minify 对拍：`node_modules/.bin/rolldown vendor/lakex-doc-react/dist/index.es.js --minify --format esm --platform browser --dir /tmp/kernel-min -e react,react-dom,react/jsx-runtime`，再对输出 gzip；本文数字取自该次产物。）
