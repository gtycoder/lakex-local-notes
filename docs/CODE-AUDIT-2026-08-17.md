# Lake Notes Electron 代码审计与优化报告

- 审计日期：2026-08-17
- 分支：`feat/electron-43-upgrade`
- 项目：Electron 43.4.0 + React 18 + better-sqlite3 + Lake 编辑器 + S3 镜像同步
- 审计范围：主进程、IPC/preload 边界、资源服务器、S3 配置、同步/存储入口、渲染层组件、测试与工程配置
- 审计方式：
  - `ocr delegate preview/rule` 确认当前工作区 review 范围与规则
  - 静态源码审查、敏感信息扫描、SQL/IPC/资源路径检查
  - TypeScript、Vitest、Vite build、`git diff --check`
  - 真实 Electron 运行态曾通过 CDP/Computer Use 做 UI 回归；本报告聚焦代码质量与安全

## Code Review Report

### Critical

#### C-001：S3 访问密钥曾硬编码在源码与脚本中

- 历史位置：`electron/main.ts`、`scripts/s3-ls.mjs`
- 风险：仓库历史提交 `6e306de` 仍包含共享 S3 AK/SK。任何获得仓库历史、备份或镜像的人都可以尝试访问云端对象；这属于凭据泄露和潜在数据暴露。
- 已修复：
  - 删除当前工作树中的硬编码凭据。
  - 开发版 S3 seed 改为可选环境变量：`LAKE_DEV_S3_ACCESS_KEY_ID` / `LAKE_DEV_S3_SECRET_ACCESS_KEY`。
  - `scripts/s3-ls.mjs` 缺少 `S3_AK` / `S3_SK` 时直接失败，不再使用默认密钥。
  - 增加 `.env.example`，并将真实 `.env*` 加入 `.gitignore`。
- 尚需外部动作：立即轮换这对 AK/SK；之后由用户确认是否使用 `git filter-repo` 清理历史。历史重写会改变提交哈希，不能未经确认自动执行。

### Warning

#### W-001：主进程 IPC 注册函数职责过多

- 位置：`electron/main.ts:243-390`，约 148 行。
- 问题：一个 `registerIpc` 同时注册工作区、笔记、历史、搜索、同步、GC、小记、转换等所有通道，后续新增 IPC 容易误放、难以做模块级权限审计。
- 建议：下一阶段拆成 `registerNoteIpc`、`registerHistoryIpc`、`registerSyncIpc`、`registerQuickNoteIpc`，共享一个类型安全的 registrar。此次已先移除 `any` registrar，降低边界类型风险。

#### W-002：`electron/store.ts` 仍是超大聚合类

- 规模：约 2,438 行。
- 问题：SQLite schema/migration、文件系统、历史、回收站、搜索、资源上传、导出和同步适配都集中在一个类中，单一职责和可测试性较弱。
- 建议：按依赖方向拆分为 `StoreSchema`、`NoteRepository`、`HistoryRepository`、`AssetRepository`、`TrashRepository`；先抽纯函数和只读查询，避免一次性重构事务边界。

#### W-003：`src/App.tsx` 仍承担过多职责

- 规模：约 1,206 行。
- 问题：窗口生命周期、工作区切换、同步 Toast、保存队列、移动端、标签管理、菜单、状态栏和布局都在同一组件中。
- 建议：优先抽取四个低耦合单元：
  1. `useDocumentTabs`
  2. `useSyncFeedback`
  3. `useWorkspaceMenus`
  4. `DesktopStatusBar`
- 不建议在没有 UI 回归护栏时直接重排整个 App。

#### W-004：资源服务器此前在每个请求中使用同步文件 I/O

- 位置：`electron/assetServer.ts`。
- 风险：`existsSync/statSync/readFileSync/openSync/readSync` 会阻塞 Electron 主进程；大量图片、编辑器资源或复制图片时可能拖慢 IPC/窗口响应。
- 已修复：
  - 改为 `fs.promises.stat/readFile/open/read`。
  - 抽出 `statFile`、`sniffMimeFromFile`、`streamFile`。
  - 为 `createReadStream` 增加错误处理，避免文件在 stat 后被删除时产生未处理的 stream error。

#### W-005：生产代码仍有多处 `any`

- 主要位置：`electron/quickNotes.ts`、`electron/store.ts`、`src/features/editor/lakeRuntime.ts`、`src/App.tsx`。
- 其中 Lake 内核私有 API 的 `any` 属于外部库缺少公开类型的边界适配；但 SQLite 行对象和小记 tombstone 行仍可定义明确接口。
- 建议：下一轮优先为 `quickNotes.ts` 的数据库行定义 `QuickNoteRow`、`QuickNoteDeletedRow`、`QuickNoteConversionRow`，再收窄映射函数输入。

#### W-006：测试覆盖偏向同步/存储，主进程 IPC 与资源服务器缺少集成测试

- 当前基线：15 个测试文件、232 个测试通过。
- 缺口：
  - IPC 受信来源与错误分支没有直接集成测试。
  - 资源服务器的路径穿越、CORS token、流读取错误、base64 转换缺少独立测试。
  - `registerCdnRedirect` 的镜像命中/未命中矩阵测试不足。
- 建议：补一组纯 Node HTTP 测试，优先覆盖安全边界，再考虑 Electron BrowserWindow 集成测试。

#### W-007：依赖审计发现 5 个中等级传递依赖告警

- 公共 registry 审计结果：5 个 moderate，0 high，0 critical。
- 影响链：`lakex-drawnix` / `@plait-board/mermaid-to-drawnix` 带入 `mermaid 10.9.3`、`dompurify 3.1.6`、`uuid 9.0.1`；Lake 编辑器自身的 mermaid 链为 `11.16.0`。
- 当前 `npm audit` 显示没有可自动应用的修复，不能通过 `npm audit fix --force` 盲目升级 drawnix/Lake 运行时。
- 结论：这是需要单独评估的依赖链问题，不阻塞本轮低风险重构；后续应在确认 drawnix/Lake 兼容版本后再处理。
- 之前公司 registry 的 audit endpoint 返回 500；本轮已使用公共 registry + 临时 npm cache 成功完成审计。

### Info

#### I-001：Quick Notes effect 依赖过宽

- 原位置：`src/components/QuickNotesWorkspace.tsx` 使用 `[dirty, props]`。
- 问题：父组件每次传入新的 props 对象时都会重新触发 dirty 回调。
- 已优化：解构 `notebookNodes/onConverted/onDirtyChange`，effect 现在只依赖 `[dirty, onDirtyChange]`。

#### I-002：代码规则文档已过期

- `AGENTS.md` 原先记录 Electron 33 和旧分支，实际项目已经是 Electron 43.4.0 / `feat/electron-43-upgrade`。
- 已更新，避免后续会话按错误版本操作。

#### I-003：资源服务器的 CORS 规则需要保持“应用页面 + token”双重约束

- 当前正式资源的跨域请求仍要求启动 token；非 CORS `<img>` 请求不带 Origin，保留其可渲染性。
- 后续新增资源路由必须复用同一 token 校验，不要仅依赖 Origin 白名单。

#### I-004：样式文件存在多轮覆盖和较多 `!important`

- 这是此前 UI 对齐和回滚留下的维护成本，当前视觉结果已验收，不建议为了“整洁”立即重排。
- 后续应以组件为单位收敛 CSS 层级，并为每次样式收敛保留截图回归。

## 已实施优化清单

- [x] 移除当前源码与脚本中的共享 S3 凭据
- [x] 开发版 S3 seed 改为环境变量注入，缺失时安全降级为本地模式
- [x] 新增 `electron/devConfig.ts` 和 3 个配置边界测试
- [x] IPC registrar 去除 `any`，改用泛型参数元组
- [x] 资源服务器改用异步文件 I/O
- [x] 资源文件流增加错误处理
- [x] `QuickNotesWorkspace` effect 依赖收窄并改善变量命名
- [x] 更新过期的 `AGENTS.md` 环境上下文
- [x] 增加 `.env.example`，忽略本地凭据文件
- [x] 为小记与孤儿资源 SQLite 行增加明确接口，移除对应 `any`
- [x] 分批拆分 IPC 注册模块，并抽取 `DesktopStatusBar`
- [x] Batch 3B：抽取 Store 只读 note digest 查询与纯函数工具，并补充边界测试
- [x] Batch 4A：抽取 SearchRepository，保留 Store 兼容 wrapper
- [x] Batch 4B：抽取 HistoryRepository/TrashRepository 只读层，保留 Store 兼容 wrapper
- [x] Batch 4C：抽取 AssetRepository 只读层，保留 Store 兼容 wrapper
- [x] Batch 4D-1：抽取 NoteQueries 只读层，保留 Store 兼容 wrapper
- [x] Batch 4D-2：抽取 NoteMetadataRepository，保留 Store 兼容 wrapper
- [x] Batch 4D-3A：抽取共享图片格式/尺寸纯函数并补测试
- [x] Batch 4D-3B-1：抽取 NoteContentRepository save 协调器
- [x] Batch 4D-3B-2：抽取 ResourceRepository 上传/远程下载协调器
- [x] Batch 4D-3B-3：抽取 RemoteImportRepository 远程导入协调器
- [x] Quick Notes M1：抽取共享模型/校验/序列化层并补测试
- [x] Quick Notes M2：抽取 Electron 只读查询层，保留 QuickNotesStore wrapper
- [x] 低风险升级 AWS SDK 与 Vite lockfile 版本并完成回归

## 验证结果

- `npx tsc --noEmit`：通过
- `npm test -- --run`：232/232 通过（由原 217 增加配置、Store 工具边界测试）
- `node node_modules/vite/bin/vite.js build`：通过
- `git diff --check`：通过
- `node scripts/s3-ls.mjs --count`（无凭据）：按预期以 exit code 1 失败并提示设置环境变量
- `npm audit --registry=https://registry.npmjs.org --omit=dev`：完成；5 moderate、0 high、0 critical，均为 drawnix/Lake 的传递依赖链，当前无自动修复

## 下一阶段建议

按风险和收益排序：

1. 凭据轮换 + 用户确认后清理 Git 历史（Critical 收口）。
2. 资源服务器 HTTP/CORS/path traversal 集成测试。
3. 按领域拆分 IPC 注册函数。
4. 继续为 `Store` 与 Lake 内核适配边界建立明确类型，减少剩余 `any`。
5. 抽取 `App.tsx` 的 tabs/sync/menu/statusbar hooks/components。
6. 最后再收敛 CSS 级联，避免影响已验收 UI。

## 低风险优化与改动影响评估

### 已自动完成（无需产品决策）

| 改动 | 影响范围 | 业务影响 | 回滚难度 |
| --- | --- | --- | --- |
| Quick Notes effect 依赖收窄、变量命名优化 | 渲染层回调触发次数 | 无业务语义变化 | 低 |
| IPC registrar 去除 `any` | 主进程类型层 | 无运行时协议变化 | 低 |
| 资源服务改异步 I/O、统一流处理 | 本地资源读取 | 响应内容和 URL 不变，降低主进程阻塞 | 低 |
| 开发配置抽取为 `devConfig.ts` | 开发环境配置 | 无已保存配置的用户不受影响 | 低 |
| 移除源码中的共享 S3 凭据 | 安全/开发启动 | 已有开发数据库保留原配置；全新开发数据库需显式设置环境变量，否则为本地模式 | 低到中 |
| 更新 AGENTS/示例配置/审计文档 | 文档 | 无运行时影响 | 低 |

### 需要用户决策后再做

#### D-001：轮换并清理 Git 历史中的 S3 凭据

- 影响：需要在七牛侧轮换 AK/SK；`git filter-repo` 会重写历史提交哈希。
- 建议：先轮换，再由用户确认是否重写历史。若远端已有其他人基于这些提交工作，不建议直接重写。

#### D-002：拆分 `electron/store.ts`

- 影响：约 2,438 行核心存储类，涉及事务、文件落盘、历史、回收站和同步调用链。
- 风险：中高。错误拆分可能改变事务边界、删除/恢复语义或历史快照时序。
- 建议：单独建立重构分支，先抽只读查询和纯函数，逐步迁移并保持每步测试全绿。

#### D-003：拆分 `src/App.tsx` 与 IPC 注册模块

- 影响：工作区切换、标签、保存、同步、菜单和状态栏。
- 风险：中。尤其是 UI 状态闭包、Electron IPC 调用和窗口生命周期。
- 建议：先抽无状态组件和独立 hooks，不改变 state ownership；每次只迁移一个领域。

#### D-004：依赖升级/漏洞修复

- 影响：可能触发 Electron、better-sqlite3、Lake 内核或构建链兼容性问题。
- 当前阻塞：本机 registry 的 `npm audit` endpoint 返回 HTTP 500，尚未得到可靠漏洞清单。
- 建议：切换可信 registry/CI 后再决定升级，不在当前审计中盲目更新依赖。

#### D-005：全面清理生产代码 `any`

- 影响：主要集中在外部 Lake 私有 API 和 SQLite 行映射。
- 风险：低到中，但 Lake 私有 API 类型化需要根据实际运行时对象补类型，不能凭猜测定义。
- 建议：先从 SQLite row interface 开始；外部内核边界保留一个集中适配层。
