# 日志规范（桌面端）

> 261023 重做。长期口径 + 排查手册；改埋点前先读本文。
> 相关：`electron/logger.ts`（主进程）/ `electron/logLevels.ts`（分级单一来源）/ `src/lib/log.ts`（渲染层）/
> `src/core/logFormat.ts`（格式单一来源）/ `electron/consoleNoise.ts`（CSP 噪音折叠）/ `docs/TROUBLESHOOTING.md`。

## 1. 目标

1. **出事能查**：错误、慢操作、异常退出必须留下证据，且能还原"什么时候、哪个通道、多大体量"。
2. **性能能优化**：关键流程的耗时与数据量按统一格式落盘，积累一段时间后可以 grep/聚合出热点。
3. **不添乱**：正式环境不写调试噪音（内核/React 的 debug、CSP 拦截通知等），日志体积可控。

## 2. 分级与默认值

| 级别 | 用途 | 开发环境 | 正式环境 |
| --- | --- | --- | --- |
| `error` | 失败、异常、数据风险 | 落盘 | **落盘**（重点） |
| `warn` | 可恢复但异常（慢 IPC、网络抖动、安全拦截） | 落盘 | **落盘** |
| `info` | 关键流程节点、启动上下文、**全部 [perf] 汇总行** | 落盘 | **落盘** |
| `debug` | 逐次调用细节（每次 IPC / 上传 / 粘贴细节） | 落盘 | 丢弃 |

- file level：开发 `debug`、正式 `info`；console：开发开、正式关（打包版没有终端）。
- 渲染层：开发 `debug`、正式 `info`（`rlog.debug` 在正式环境直接不输出，见 `src/lib/log.ts`）。
- **现场排障不必改代码**：
  - `LAKE_LOG_LEVEL=debug|info|warn|error` —— 覆盖 file + renderer（临时开 debug）
  - `LAKE_LOG_CONSOLE=1` —— 正式环境也把主进程日志打到终端（配合终端启动）
- 判据单一来源 = `electron/logLevels.ts`（`resolveLogLevels` / `isLevelEnabled`，有单测）。

## 3. 作用域（每行前缀）

主进程（`log.<scope>`）：`app` `sync` `s3` `quick` `history` `gc` `trash` `store` `renderer` `perf` `ipc` `boot` `main`。
渲染层（`rlog.<level>("scope", ...)`）的 scope 是自由字符串，约定用：`boot` `window` `paste` `editor` `sync` `usheet` …

## 4. 格式约定

一行一条。级别/时间/scope 由 logger 前缀补；正文统一「一句话 + key=value 字段」：

    [2026-10-23 12:34:32.043] [info]   (renderer) [perf] 资源上传 98 次（远程 96 / 本地 2）：墙钟 9245ms，单次最长 4524ms，重试 0 次，失败 0 次
    [2026-10-23 12:34:23.263] [warn]   (ipc)      [perf] ipc.slow user_save 412ms

- **耗时一律 `[perf] <label> <ms>ms`**（格式单一来源 `src/core/logFormat.ts` 的 `perfMessage`），后面跟字段。
- **错误一律带字段** `error="Name: message"` + `stack="at … | at …"`（前 3 帧，`errorFields` / `rlog.error`）。
- 字段规则：`k=v`，数字取整（避免亚毫秒抖动）；含空格/引号的值加 JSON 引号；没值的字段直接省略。
- **主进程的 console.* 也会落盘**：`installConsoleBridge` 把 console.warn/error/info/debug/log 桥接到 `(main)` 作用域（electron-log 的 console transport 在加载时已快照原始方法 ⇒ 不会回环/重复）。新代码仍优先用 `log.<scope>`。
- **不记录**：正文内容、密钥、S3 凭据、剪贴板原文。可以记录：noteId、filename、字节数、条数、阶段名。
- 未捕获异常会留**两条**：我们的 `[window] 未捕获异常`（带 error/stack 字段）+ 浏览器自身的 `Uncaught …`（console 转发）。以带 stack 字段的那条为准，排障时不必当成两个问题。

## 5. 已有埋点（261023）

| 埋点 | 级别 | 位置 | 说明 |
| --- | --- | --- | --- |
| `[start] …` | info | `main.ts` whenReady | 版本 / Electron / 平台 / userData / 生效级别（排障第一行） |
| `[perf] boot.ready` | info | `main.ts` revealMainWindow | 从 main 加载到主窗口首帧的耗时（reason=renderer-ready/fallback） |
| `[boot]` splash / window | info | `main.ts` | 启动链路节点 |
| `[perf] ipc.<channel>` | debug | `electron/ipc/registrar.ts` | 每次 IPC 耗时（正式环境丢弃） |
| `[perf] ipc.slow` | warn | 同上 | 单次 IPC ≥ 200ms（正式环境保留） |
| `[ipc] <channel> 失败` | error | 同上 | 通道名 + 耗时 + 错误摘要 |
| `[perf] note.save` | debug / info | `electron/store.ts` | 保存耗时 + 正文字数；≥200ms 或 ≥1MB 升 info |
| `[perf] sync.round` | info | `electron/syncEngineController.ts` | 一轮同步：耗时、上传/下载条数、字节数、文件夹数、墓碑数、冲突数、warnings |
| `[perf] paste.html` | info | `src/features/editor/clipboardHtml.ts` | 一次粘贴：chars（HTML 字符数）/ getData 次数 / 我们升级耗时 / 大表护栏是否命中 |
| `[perf] 资源上传 …` | info | `src/lib/uploadStats.ts` | 一次上传爆发：次数、远程数、墙钟、单次最长、重试、失败（阈值 ≥3 次/≥1.5s/有失败） |
| `[perf] editor.init` | info | `src/features/editor/EditorTab.tsx` | 打开文档初始化耗时 + noteId / mode / chars / locked |
| `[heap]` | info | `logHeapPeak` | 主进程堆/常驻峰值（仅新峰值） |
| `[crash]` | error/warn | `main.ts` | uncaughtException / unhandledRejection / render-process-gone / preload-error / child-process-gone |
| `[security]` | warn | `main.ts` | 被阻止的窗口导航 |
| `[ui]` | warn/info | `main.ts` | 窗口 unresponsive / responsive |
| `[console-noise]` | info | `electron/consoleNoise.ts` | 一次粘贴的 N 条 CSP 拦截通知折叠成一行 |
| `(main)` 桥接 | 原级 | `electron/logger.ts` `installConsoleBridge` | 主进程既有 `console.warn/error/info/debug/log` 统一落盘（打包版没有终端，不桥接就丢） |

## 6. 排查手册

- 日志路径：`<userData>/logs/lakex-local-notes.log`（10MB 轮转，上一份是 `.old.log`）。
  开发 `~/Library/Application Support/lakex-local-notes-dev/logs/`；正式 `…/lakex-local-notes/logs/`。
  应用内：设置 → 日志（`read_app_log` IPC，只读白名单路径）。
- **先看时序，不先看内容**：卡顿类问题先看关键行的时间戳是否成簇、中间有没有空档 —— 空档 = 主线程被占住，
  日志本身不会是原因（详见 `docs/TROUBLESHOOTING.md` §M）。
- 常用 grep：

      grep '\[crash\]' log                                  # 崩溃 / 未捕获异常
      grep '\[perf\] ipc.slow' log                           # 慢 IPC
      grep '\[perf\] sync.round' log                         # 每轮同步的耗时与数据量
      grep '\[perf\] note.save' log                          # 保存耗时（大文档）
      grep '\[perf\]' log | awk '{print $4, $5}'             # 粗略聚合

## 7. 性能优化怎么用

- 所有 [perf] 行都带**数据量**（chars / bytes / 条数），用来算"单位成本"：例如
  `sync.round ms / (uploaded+downloaded)`、`note.save ms per 10k chars`。
- 慢 IPC：`ipc.slow` 的通道名直接指向要优化的 handler；逐次耗时在开发环境用 `LAKE_LOG_LEVEL=debug` 打开。
- 粘贴/上传：`paste.html` + `资源上传` 两行即可区分"CPU 解析"与"网络 I/O"（实测见 §M）。
- 攒一段时间后按 label 聚合、找 P90/P99 长尾，再决定立项（避免凭感觉优化）。

## 8. 新增埋点的规范

1. 用 `perfMessage(label, ms, fields)`（主进程 `log.perf` / 渲染层 `rlog.perf`），label 用点号分层：`domain.action`。
2. **必须带数据量**（条数/字节数/次数），否则事后无法判断"这 400ms 是正常还是异常"。
3. **热路径不要逐次写 info**：逐次用 debug，或像 uploadStats / pasteStats 那样**聚合成一行**（去抖/阈值）。
4. 慢阈值约定：IPC 200ms、保存 200ms / 1MB、同步只在轮次结束记一次。
5. 纯格式化/阈值逻辑抽成无依赖模块并加单测（`logFormat` / `logLevels` / `uploadStats` 就是范例）。

## 9. 代码索引

- `electron/logLevels.ts` —— 分级 + dev/prod 默认值 + 环境变量覆盖（单测）
- `electron/logger.ts` —— electron-log 装配、scopes、启动上下文、堆峰值
- `electron/rendererLogLevel.ts` —— 渲染层 console 级别映射（Electron 新旧签名）
- `electron/consoleNoise.ts` —— CSP 拦截通知折叠
- `src/lib/log.ts` —— 渲染层 logger（debug 仅开发环境；perf 走 info）
- `src/lib/uploadStats.ts` —— 上传爆发聚合
- `src/core/logFormat.ts` —— 字段/耗时/错误的唯一格式化来源
- `src/core/logger.ts` —— 注入给 core 的 LoggerScopes 接口（含 debug）
