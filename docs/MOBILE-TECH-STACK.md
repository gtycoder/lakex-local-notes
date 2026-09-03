# 移动端技术方案定案：Capacitor（Android 先行）+ 复用前端 bundle

> 更新时间：2026-08-22 ｜ 决策人：用户（逐项确认）｜ 关联方案：`lake-notes-refactor-plan-v5-2026-08-21.md`（V5）
> 本文是移动端技术选型的**唯一决策记录**；实施进度见 `HANDOFF.md` 与 M0 POC 记录。

## 1. 决策记录（已确认，不再争论）

| # | 决策点 | 结论 | 备注 |
|---|---|---|---|
| 1 | 移动端壳方案 | **Capacitor**（WebView 壳，复用现有 Vite/React 前端 bundle） | 与思源架构同构且更简单（无需 gomobile 等价物） |
| 2 | 首版平台 | **Android 先行** | 用户主力机小米 + Tauri POC 已真机验证 Android WebView 跑 Lake |
| 3 | 移动端 SQLite | **wa-sqlite（WASM）vs @capacitor-community/sqlite（原生）→ M0 POC 实测后定** | DbLike 接口（V5 Phase 2）的移动端实现方向 |
| 4 | 桌面端 | 保持 Electron 不动 | **不复活 Tauri 2**：macOS 强制 WKWebView，无法渲染 SVG foreignObject 文字（画板、复杂排版 bug 频发）——README.md 已记录 |
| 5 | RN 路线 | **否决** | 依据见 §3（语雀调研 + 工作量评估） |
| 6 | iOS | 后置（Android 验收后再评估） | iOS WKWebView 的 foreignObject 风险需真机 POC，Drawnix 画板降级预案（只读/隐藏） |

## 2. 参考对象技术栈（已核实，2026-08-22 调研）

### 思源笔记（siyuan）
- 桌面：Electron；移动端：独立原生仓库（siyuan-ios / siyuan-android）+ WKWebView/WebView 加载 Web 前端（`app/webpack.mobile.js` 构建 `stage/build/mobile`）+ **gomobile 绑定的 Go 内核**（`kernel/mobile/kernel.go`）跑本地服务。
- 桌面/移动**同一份前端代码**（`app/src` 共用），区分手段：`/// #if MOBILE` 编译宏 + 运行时探测（`isMobile = () => document.getElementById("sidebar") ? true : false`，全仓 294 处）+ CSS 媒体查询。
- 本地参考源码：`/Users/admin/file/local-lake/siyuan-master`（只读）。

### 语雀 App
- 基于阿里 mPaaS，**原生 + RN + H5 三层架构**（iOS/Android 同构）。
- **RN 层**：壳 UI（列表页、导航等，基于 ViewModel 同构列表页）。
- **H5 层**：**Lake 富文本编辑器跑在 WebView/WKWebView 里**。原文："*用 ReactNative 来实现一个富文本编辑器或者阅读器，那么它的代价是非常高的，这种情况就使用 H5 来实现*"。
- 通信：RN ↔ H5 通过通用 JSBridge / postMessage 双向消息（"底部是 RN View，上面嵌入 WebView 展示编辑页"）。
- 参考文章（可读）：[微信原文](https://mp.weixin.qq.com/s/8xGS2n59S1WQ1d2yfB3OyQ) ｜ [B站专栏](https://www.bilibili.com/read/cv19820080/) ｜ [语雀官方站](https://www.yuque.com/antfe/featured/ra1miv) ｜ [知乎](https://zhuanlan.zhihu.com/p/583888953)

### 共同结论
**Lake 只能在 WebView 承载；壳是原生的；前端尽量复用。** 我们的优势：内核（同步决策/tree/quickNoteModel 等）已被 V5 Phase 1 抽成纯 JS（`src/core/`），SQLite 走 DbLike 接口——移动端无需任何原生内核绑定，比思源（gomobile）更简单。

## 3. 为什么否决 RN（语雀调研后的依据）

语雀的架构恰好证明：**RN 的价值只在壳 UI，编辑器无论如何都进 WebView**。对我们是负收益：

| 项 | RN 方案 | Capacitor 方案 |
|---|---|---|
| 壳 UI（列表/侧栏/树/设置） | RN 组件全部重写，与桌面 React DOM 永久双份 | 直接复用现有组件 |
| Lake 编辑器 | WebView 包一层 + postMessage 桥 | 原生 WebView 容器 |
| 桌面/移动一致性 | 两套代码两套行为，需"跨端同构"工程 | 同一份代码 |
| 构建链 | Metro/babel + RN 原生依赖，与 Vite 并存 | Vite 产物直接打包 |
| 维护 | 需同时掌握 React DOM + RN + 桥；单人维护不现实 | 仅 Web 技术栈 |

现有前端规模：`src/App.tsx` 1423 行 + Sidebar/MultiTabEditor/EditorTab/LakeEditor/MobileLibrary 等。RN = 永久双份 UI。语雀能做到是因为蚂蚁专职团队 + 性能监控体系（文章仍将 **RN Crash** 列为 5 大挑战之一）；单人/小团队选 Capacitor。

## 4. 共用前端代码混乱风险与对策（思源 294 处 isMobile 的教训）

**事实辨析**：思源的 294 处 isMobile 不是平台分支，是**响应式 DOM 探测**（sidebar 存在性），且思源桌面/移动本就是同一份前端——**复用前端的固有代价就是这类判断，思源也不例外**。

本项目的控制手段（V5 Phase 2/4 拆分即为答案）：
1. **UI 层只用响应式设计，不做平台分支**：现有移动 UI 本就是桌面响应式（`isMobile = window.matchMedia("(max-width: 760px)")`，src/App.tsx:154），Capacitor WebView 天然是手机宽度，`isMobile` 自动成立——**无需新增任何 isPhone 判断**。
2. **7 个 mobile 状态收拢**：mobileOpen/mobilePage/mobileEditing/mobileTocOpen/mobileActive/mobileDraftTitle/mobileDraftContent → `useMobileDocumentSession`（V5 Phase 4）。现状散在 App.tsx，收拢后可控。
3. **真正平台差异收敛到 adapter 注入点**（V5 Phase 2）：DbLike / FileStore / HttpFetcher / SecretCipher + Phase 3 契约（NoteService/QuickNoteService/TrashService/AssetService/SyncService）——渲染层不感知平台，只调接口。
4. **少数必要分支用能力探测**（如 `window.lakeNative !== undefined`），不散落 isPhone。
5. 对比：Capacitor = 一份 UI + 响应式判断 + adapter 收拢；RN = 双份 UI 各自平台差异 + 桥，混乱更甚。

## 5. 与 V5 Phase 1-4 的衔接与依赖

| V5 阶段 | 内容 | 移动端衔接 |
|---|---|---|
| Phase 1（已完成） | lake-core 纯逻辑抽取（src/core/） | 纯 JS 内核直接进移动端 bundle；同步决策纯函数移动端复用 |
| Phase 2 | 适配器注入点（DbLike/FileStore/HttpFetcher/SecretCipher） | DbLike/FileStore 的移动端实现（M1） |
| Phase 3 | 契约接口（5 个 Service + 错误码） | 移动端渲染层只调契约（M1） |
| Phase 4 | App hook（useMobileDocumentSession/useSavePipeline/useSyncShell）+ EditorHost 窄端口 | 移动端 UI 复用 hook（M2） |
| V5 §10 后置项 | AsyncDb/WASM、AssetUrlResolver、EditorHost RN/WebView、npm workspaces、移动端 bundle 分叉 | 全部落在此方案的 M0-M2 |

## 6. 实施计划（M0-M3）

### M0：Capacitor 工程 + 技术风险 POC（当前执行中）
1. 独立分支 `refactor/mobile-capacitor` + git worktree（`/Users/admin/file/local-lake/lake-notes-mobile`），与 `refactor/lake-core` 并行会话隔离。
2. 移动端 bundle：新增 `mobile.html` 入口 + vite 多入口构建（现有 `index.html` 桌面入口不动）；CSP 按入口注入移动端版（放行 `capacitor://`/`https://`、S3 endpoint、本地资源，不放行外部 CDN）。
3. JS 桥：Capacitor 侧实现 `window.lakeNative` 兼容接口（仿 `src/lib/native.ts` 子集：openNote/saveNoteContent/listNotes/uploadResource），原生能力走 Capacitor 插件。
4. 真机 POC 验证矩阵（小米）：Lake 编辑器运行（编辑/保存/中文/滚动/图片）；**SQLite 对照实验**（wa-sqlite WASM 同步 vs @capacitor-community/sqlite 原生异步，基准 + 集成，据以定 SQLite 方向）；`.lake` 文件读写；S3（`@aws-sdk/client-s3` 在 WebView 跑通七牛上传/下载）；凭据（Secure Storage）。
5. **POC 通过标准**：真机完成「浏览笔记 → 编辑 → 保存 → 上传七牛 → 桌面端拉到该变更」最小闭环。

### M1：数据层落地（依赖 Phase 2/3 完成）
DbLike 移动端实现（按 POC 结论）；FileStore 移动端实现；AssetUrlResolver 四形态（canonical/runtime/export/legacy）；同步服务适配（复用 `src/core` reconcile 纯函数）。

### M2：渲染层（依赖 Phase 4 完成）
移动端 bundle 分叉 + 能力探测分支；复用 useMobileDocumentSession/useSavePipeline/useSyncShell；移动端 UI（文档列表/编辑器/小记，参考 Tauri POC `src/MobileLibrary.tsx` 雏形）；Drawnix 画板移动端策略：Android 真机验证，iOS 降级预案。

### M3：同步闭环 + 完整验收
桌面↔移动双向同步回归（A/B 设备，离线编辑/断网恢复/墓碑传播）；后台同步（Capacitor Background Task）；完整验收清单。

## 7. 质量门槛

- 桌面：`npm test -- --run`（358 基线不回归）/ `npx tsc --noEmit` / `vite build` / `git diff --check` / UI smoke 三项。
- 移动端：真机验证清单（沿用 Tauri POC `ANDROID_VALIDATION.md` + M0 矩阵）；SQLite 选型 POC 结论文档化。
- 分支纪律：每阶段独立验收，**用户确认后才合 master**（「未验收不合并」）。

## 8. 风险与红线

| 风险 | 对策 |
|---|---|
| iOS WKWebView foreignObject（Drawnix 画板）渲染 bug | Android 先行规避；iOS 启动前真机 POC；画板降级预案（只读/隐藏） |
| better-sqlite3 无法跨端（Node ABI） | DbLike 接口（Phase 2）+ M0 POC 实测定 WASM/原生 |
| 共用前端平台判断散落（思源 294 处教训） | §4 四手段：响应式 UI + hook 收拢 + adapter 注入 + 能力探测 |
| 双壳维护（Electron + Capacitor） | 前端 bundle 共享，壳代码最小化；原生工程仅 android/ |
| 并行会话冲突（refactor/lake-core） | git worktree 隔离 + 独立分支 + 不碰重叠文件 |
| Lake 资源/CSP 在 WebView 差异 | 移动端 CSP 单独注入；资源已全本地化（V5 §5.6 成果直接复用） |

**红线**：不复活 Tauri；不重写 Lake 编辑器；不改桌面行为与桌面构建；不做 iOS 原生壳定制（首版）；不引入 RN/Flutter 双份 UI；不引入 Manifest CAS（V5 已撤销）。

## 9. 准备工作记录（2026-08-22，重构完成前的准备，未实施移动端）

> 用户明确：移动端实施（M0 起）**后置到 V5 Phase 1-4 重构完成**（Phase 2 适配器 / Phase 3 契约 / Phase 4 hook 未就绪前不开始）。以下为不依赖重构、无代码改动的准备成果。

### 9.1 依赖可用性验证（M0 硬前提 ✅）

- 内部 registry `npm.weizhipin.com` 的 API 路径 curl 空响应（npm view 超时）；**公网 `registry.npmjs.org` 可直连**。
- 已验证可用版本（--registry=https://registry.npmjs.org）：
  - `@capacitor/core` **8.5.0** / `@capacitor/cli` / `@capacitor/android` **8.5.0**
  - `@capacitor-community/sqlite` **8.1.1**（Capacitor 8 兼容）
  - `wa-sqlite` **1.0.0**
- **M0 安装命令**：`npm install @capacitor/cli @capacitor/core @capacitor/android @capacitor-community/sqlite wa-sqlite --registry=https://registry.npmjs.org`（Capacitor 8 需 JDK 21 ✅ / Android SDK cmdline-tools ✅，Tauri POC 已验证过同一套工具链）。

### 9.2 POC 桥最小 IPC 集（从 74 个 IPC 中筛选）

`window.lakeNative`（native.ts）共 74 个方法。POC 最小闭环「浏览→编辑→保存→上传→同步」所需的**最小集**：

| 闭环步骤 | 桥方法 |
|---|---|
| 浏览列表 | `bootstrap()` / `listTreeNodes()` / `listNoteSummaries()` / `readNote(id)` / `getNoteDigest(id)` |
| 编辑 | `readNote(id)`（LakeEditor 是纯 Web 组件，无 native 直接依赖——已 grep 确认 LakeEditor.tsx 零 native 调用） |
| 保存 | `saveNote(id, title, content, caches)` / `ensureNoteCaches(id)` |
| 上传资源 | `uploadResource(input, noteId)` |
| 七牛配置 | `getS3Settings()` / `saveS3Settings(settings)` / `testS3Connection()` |
| 触发同步 | `syncNow()` / `getSyncStatus()` / `onSyncProgress(cb)` |

**其余 60+ 方法（导出/历史/回收站/GC/小记/设置面板）POC 阶段可不实现**——这决定桥的实现范围，M0 开工即用。

### 9.3 SQLite 预研备忘（M0 对照实验待实测）

| 方案 | API 形态 | 与 better-sqlite3 适配 | 性能 | 原生依赖 | 备注 |
|---|---|---|---|---|---|
| **sql.js 1.14.2** | **同步**（prepare/step/bind 现成） | **高**（DbLike 同步接口直接实现） | 中（WASM；全库 export 持久化） | 无 | **POC 主路径已采用**（M0 实测通过 tsc+build）；内存库，持久化=export() 快照 |
| **wa-sqlite 1.0.0** | 官方 API **仅异步**（sqlite-api.js 硬编码 `const async = true`，Asyncify 包装） | **低**（同步调用实测 rc=21 SQLITE_MISUSE，Asyncify 状态机未初始化） | 中（WASM） | 无 | **M0 实测否决为同步 DbLike**：需自行重写 wasm 绑定或自编译同步构建——M1 若走 WASM 路线直接沿用 sql.js |
| **@capacitor-community/sqlite 8.1.1** | 异步（Promise，原生桥） | 中（DbLike 需异步化，与桌面同步接口冲突） | 高（原生 SQLite） | 有（原生插件，已注册） | **M0 真机性能对照项**；若 DbLike 接口保持同步，仅适合作为独立数据服务 |

**M0 对照实验设计**：主路径 sql.js（已实现：列表/打开/编辑/保存/快照持久化）；cap-sqlite 真机对照（性能基准 + 接口形态记录）；wa-sqlite 已实测否决为同步路径（保留记录）。

### 9.4 其他准备

- worktree `/Users/admin/file/local-lake/lake-notes-mobile` @ `refactor/mobile-capacitor` 已建（基于 master ce8c049，依赖安装进行中）；lake-core 合入 master 后需 `git rebase master` 更新基线（依赖不变，node_modules 无需重装）。
- 真机验证清单基线：Tauri POC `docs/ANDROID_VALIDATION.md`（小米 17 Pro 已验证：中文输入/换行/删除/软键盘/长文滚动/编辑保存）。

## 10. M0 POC 真机验证记录（2026-08-22，小米 2109119BC，全通过）

### 10.1 验证矩阵

| 验证项 | 结果 | 备注 |
|---|---|---|
| Capacitor WebView 运行 bundle | ✅ | CDP（chrome://inspect 等价）验证 DOM 渲染 |
| Lake 编辑器中文输入/多行 | ✅ | 真机输入「你好，这是移动端 poc」+ 换行 |
| sql.js WASM 加载 | ✅ | 首次踩坑：CSP 需 `'unsafe-eval'`（WebAssembly 编译） |
| IndexedDB 持久化 | ✅ | force-stop 杀进程重启，笔记保留 |
| S3 测试连接（ListObjectsV2） | ✅ | 首次踩坑：CSP 需放行 `*.s3.cn-north-1.qiniucs.com`（虚拟主机风格子域） |
| S3 上传（PutObject） | ✅ | `poc/mobile-snapshot-*.sqlite` 上传成功 |

### 10.2 请求分层（CORS 架构性解决，思源同构）

- **问题**：WebView 内直接 fetch 撞 CORS（七牛桶默认无 CORS 规则，且用户不改云端配置）。
- **参考思源**：网络请求在原生层（Go kernel）做，WebView 只做 UI。
- **方案**：`src/mobile/capacitorHttpHandler.ts`——AWS SDK `requestHandler` 走 **Capacitor 原生 HTTP（CapacitorHttp → Android OkHttp）**，签名/协议逻辑保留在 AWS SDK（JS），仅传输层下沉原生。
- **对齐 V5 Phase 2 `HttpFetcher` 注入点**：桌面=electron net / 移动端=CapacitorHttp（M1 正式接入时复用此 handler）。
- 二进制约定：发送 Uint8Array → base64 + `dataType:'file'`（原生 Base64.decode 写原始字节）；接收 `responseType:'arraybuffer'` → base64 → Uint8Array（已验证 Android 源码 setRequestBody/buildResponse）。

### 10.3 分支与合并

- `refactor/lake-core`（V5 Phase 1-4 重构）合入 master：**`df15f87`**，质量门槛 408 tests 全绿（原 358 +50）。
- `refactor/mobile-capacitor` rebase master 零冲突：**`1249c1c`**（M0 POC 提交）on `df15f87`。

### 10.4 构建环境（踩坑固化）

- gradle wrapper 下载 services.gradle.org 超时（公司网络）→ 复用 `~/.gradle/wrapper/dists/gradle-8.14.3-bin` 缓存二进制（`scripts/android-build.sh` 固化）。
- 阿里云 maven 镜像已配（`android/settings.gradle` + `build.gradle`）：google/central/gradle-plugin。
- 小米真机安装：无 SIM 无法开「USB 安装」→ `adb push` APK 到 Download + 文件管理器安装。

## 11. M1 计划（数据层 + 同步协议落地）

1. **DbLike 正式接入**：POC `SqlJsDb`（sql.js 同步）按 `src/core/dbLike.ts` 接口收敛（已对齐，补单元测试 + 边界检查）。
2. **同步协议（manifest v4）移动端落地**：读 `docs/SYNC-PROTOCOL.md` + `src/core` reconcile 纯函数（decideUpload/reconcileLakeNote）→ 移动端实现 manifest 拉取/发布 + 变更应用（移动端数据模型对齐：notes/tree_nodes + `.lake` 文件）。
3. **FileStore 移动端实现**（`.lake` 文件读写 → Capacitor Filesystem 或 sql.js BLOB，POC 已存 BLOB 简化）。
4. **AssetUrlResolver** 四形态（canonical/runtime/export/legacy）。
5. **HttpFetcher 移动端实现** = CapacitorHttpHandler（S3 传输层已就绪）。
6. 验证：移动端↔桌面 A/B 双向同步（离线编辑/断网恢复/墓碑传播）。

## 12. M1 同步引擎完成记录（2026-08-22，真机验证通过）

### 12.1 已实现

- **`src/mobile/syncEngine.ts`**（manifest v4 协议落地）：
  - 下载方向：拉 `manifests/latest.json` → `reconcileLakeNote` 对账（复用 src/core）→ 对象下载（先内容后标志，墓碑语义）→ 本地应用 + `sync_base` 记账
  - 上传方向：`decideUpload`（复用 src/core）→ 内容寻址幂等 PUT（`objects/{id}-{hash}.lake`）→ commit + latest 发布 → `markLocalNoteSynced`
  - skip-fast 快路径：synced + baseHash == remoteHash → 零 IO 跳过（不重复上传/发布）
- **`bridge.ts`**：M1 schema（notes 扩展 parent_id/sort_order/content_hash/sync_state/is_conflict/deleted_at + sync_base 表，旧表 ALTER 迁移保数据）+ `SyncDbPort` 实现
- **`capacitorHttpHandler.ts`**：响应体 `ReadableStream`（AWS SDK 浏览器运行时要求；修复 `Unexpected stream implementation` Deserialization error）
- **`sha256.ts`**：crypto.subtle 哈希

### 12.2 真机验证

| 场景 | 结果 |
|---|---|
| 首次同步（无 manifest） | ✅ 上传本地笔记 + 发布 manifest |
| 二次同步（无变更） | ✅ skip-fast：上传 0、发布 否（记账正确） |
| 对账 | ✅ reconcile 复用 src/core 纯函数 |

### 12.3 踩坑（M1）

1. **AWS SDK 浏览器运行时要求响应 body 为 Blob/ReadableStream**——handler 返回 Uint8Array 报 `Unexpected stream implementation`，包装 `ReadableStream` 修复。
2. **reconcile local-wins 与 decideUpload 重复 push**：步骤 2 的 local-wins 分支直接入队导致每次同步重传——local-wins 统一由步骤 3 decideUpload 决定（skip-fast 覆盖）。
3. **gradle 偶发 2s 失败根因 = 漏 export JAVA_HOME（用了系统 Java 8）**——`android-build.sh` 已强制 JDK 21。

### 12.4 M1 剩余项（后置）

- 跨端完整验证：桌面 App 配置七牛 + 手动同步，确认拉到移动端发布的数据（需要桌面端配合，独立验收项）
- 回收站/墓碑/恢复语义、锁/图标元数据、目录树（folders）应用、小记同步、commit 链 GC、对象缺失 warnings 透传 UI

## 13. 同步编排共享化（用户明确要求的高优先 TODO，2026-08-22 第一阶段完成）

### 13.1 第一阶段完成 ✅（编排进 lake-core，真机回归通过）

- **`src/core/syncEngine.ts`**（新）：同步编排引擎（拉 manifest → 墓碑/恢复分支 → reconcile 对账 → 上传 → 发布 → 记账），
  平台差异全部端口注入（`S3Store` + `SyncDbPort`），边界检查 0 违规
- **`src/core/sha256.ts`**：hash 工具迁入 core（crypto.subtle，Web/Node 通用）
- **移动端 adapter**：`src/mobile/s3Store.ts`（CapacitorHttpHandler + aws-sdk 实现 S3Store）+ bridge 的 dbPort（sql.js 实现 SyncDbPort）
- **验证**：真机自动化 E2E 回归通过（删除→墓碑→回收站→恢复→active 覆盖，与共享前行为一致）

### 13.2 第二阶段（待做）：桌面端收敛

- electron 侧实现 S3Store（现有 ObjectStore 包装）+ SyncDbPort（store 方法包装）
- 桌面 sync.ts 核心对账循环替换为共享 syncEngine（GC/历史/warnings 等特有功能保留在桌面层）
- 表驱动语义等价测试（桌面/移动端同一批 manifest 输入 → 同一决策输出）
- 408 桌面测试全绿 + 移动端真机回归

### 13.3 目标状态：语义演进只改 src/core/syncEngine.ts 一处

**背景**：决策机制（reconcileLakeNote/decideUpload/mergeLockState）已在 src/core 共享；
但执行编排（拉 manifest → 对账循环 → 应用 → 上传 → 发布 → 记账流程）目前双份：
桌面 `electron/sync.ts`（1150 行，与 store 深度耦合） vs 移动端 `src/mobile/syncEngine.ts`（端口注入式）。

**执行**（存储逻辑真机验证通过后）：
1. 把 `src/mobile/syncEngine.ts` 提升为 `src/core/syncEngine.ts`（无平台依赖：
   S3Store 端口 = getObject/putObject，LocalStore 端口 = SyncDbPort，均已注入）
2. 桌面 adapter 对接：electron 侧实现 S3Store（现有 ObjectStore）+ LocalStore（store 方法包装），
   桌面 sync.ts 收敛为 adapter 装配 + 调用共享 syncEngine
3. 测试护栏：408 桌面测试全绿 + 移动端真机回归 + 语义等价测试（表驱动：桌面/移动端同一批 manifest 输入 → 同一决策输出）
4. 验收：electron/sync.ts 编排逻辑清零，仅剩 adapter；语义演进只改一处

**为什么选移动端 syncEngine 做基础**：它无 Electron 依赖、端口注入清晰、真机验证过；
比"凭空重构桌面 1150 行"风险低。V5 §7 适配器注入点（DbLike/HttpFetcher）与之一致。

## 14. 同步语义补齐完成记录（2026-08-22，真机自动化验证通过）

### 14.1 墓碑/回收站/恢复（存储逻辑闭环 ✅）

- **数据模型**：notes 加 `trashed_at`/`deleted_from_parent_id`/`restore_pending_at`（ALTER 迁移保数据）
- **本地删除**：软删（trashed_at + sync_state=local）→ 同步上传墓碑（删除前内容对象 + deleted/trashedAt 标记）
- **远端墓碑应用**：先拉内容再标记回收站（先内容、后标志；保留可恢复）
- **恢复**：restore_pending_at → 同步 local-wins 上传 active 覆盖墓碑（唯一显式例外）
- **时间比较**：本地删除 vs 远端 active → updatedAt 比较（删除新 → 删除胜上传墓碑；远端新 → 跟随恢复）——修复"本地删除被远端旧 active 误恢复"的 bug
- **幂等应用优化**：localHash === remoteHash → 仅对齐记账，不重复下载

### 14.2 真机自动化验证（CDP 驱动，全程无人工）

| 步骤 | 结果 |
|---|---|
| 删除 → 同步 | ✅ 墓碑上传（拉 2 应用 0 上传 1 发布） |
| 回收站视图 | ✅ 显示已删笔记 + 恢复按钮 |
| 恢复 → 同步 | ✅ active 上传覆盖墓碑 |
| skip-fast / 幂等 | ✅ 无变更时上传 0 |

### 14.3 工具链升级

- USB 安装已开启 → `adb install -r` 直装 + CDP 自动化驱动（`/tmp/cdp-e2e-tombstone.mjs`）
- 自动化验证脚本可复用（后续回归）
