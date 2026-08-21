# Lake Notes 移动端交接文档（PHONE-HANDOFF）

> 更新时间：2026-08-22 ｜ 写给：没有上下文的新会话
> 主线：**存储机制统一**（桌面 sync.ts 收敛到共享引擎，两端单一实现）
> 移动端工作区：`/Users/admin/file/local-lake/lake-notes-mobile`（git worktree，分支 `refactor/sync-shared-desktop`）

---

## 0. TL;DR

- 移动端技术栈已定案：**Capacitor 8.5（Android 先行）+ 复用前端 bundle + sql.js（WASM 同步 DbLike）+ S3 原生传输分层**。
- **图片方案已定稿**：canonical 永远 `http://127.0.0.1:19876/{noteId}/{file}`（两端统一零迁移），移动端显示层用 **blob**（本地读字节 → blob URL 注入），**移动端不自建 HTTP 服务器**（纯 JS，零原生）。
- 同步语义（墓碑/回收站/恢复/skip-fast）移动端已真机验证；**共享引擎 `src/core/syncEngine.ts` 已抽**（桌面+移动端单一编排实现的目标）。
- **当前主线 = 存储机制统一**：桌面 `electron/sync.ts`（1150 行）收敛到共享引擎（分支 `refactor/sync-shared-desktop`，审计已修 Critical，剩余 C3/H2-H5/M1-M6 排期见下）。
- 记住红线：桌面行为零变化（408 测试 + UI smoke）；「未验收不合并」；开发版数据可删。

---

## 1. 移动端技术定案（用户确认，不再争论）

| 决策点 | 结论 | 备注 |
|---|---|---|
| 壳方案 | **Capacitor 8.5.0**（WebView 壳复用前端 bundle） | 思源同构且更简单（无需 gomobile）；RN/Tauri/PWA 均否决 |
| 首版平台 | **Android 先行**（小米 2109119BC 真机验证） | iOS 后置（WKWebView foreignObject 风险，画板降级预案） |
| SQLite | **sql.js 1.14.2（WASM 同步 API）** | 对齐 `src/core/dbLike.ts` 同步接口；wa-sqlite 实测否决（Asyncify 无法同步）；cap-sqlite（原生异步）仅对照 |
| S3 传输 | **CapacitorHttpHandler（原生 OkHttp）** | 绕开 WebView CORS（七牛桶不改配置）；对齐 V5 Phase 2 `HttpFetcher` 注入点 |
| 持久化 | sql.js 快照 → IndexedDB（POC）；图片 → Capacitor Filesystem（正式） | — |

**否决记录**：RN（语雀 mPaaS RN+H5 三层调研：编辑器必 WebView，RN 只买壳 UI，双份 UI 维护不可接受）；Tauri 2（macOS WKWebView foreignObject bug，README 记录）；自定义协议 lake-asset://（Lake 内核 URL 白名单拒绝，调研 `RESEARCH-LIGHTWEIGHT-PROTOCOL` 11 项探针证实）。

## 2. 进度总览

### 已完成（mobile 分支历史，已推 gitee `refactor/mobile-capacitor`）

| 阶段 | 内容 | 状态 |
|---|---|---|
| M0 | Capacitor 工程 + 移动端 bundle（mobile.html 多入口 + CSP）+ POC 桥 + sql.js + IndexedDB 持久化 | ✅ 真机验证（中文输入/编辑/保存/杀进程保留） |
| M0.5 | S3 请求分层（CapacitorHttpHandler） | ✅ CORS 架构性解决 |
| M1 | 同步引擎（manifest v4：拉取/对账/上传/发布/记账/skip-fast） | ✅ 真机验证 |
| M1.5 | 墓碑/回收站/恢复 + 删除压编辑时间比较 + 幂等应用优化 | ✅ CDP 自动化 E2E 验证 |
| 共享化一阶段 | `syncEngine` 收进 `src/core`（S3Store/SyncDbPort 端口注入，边界 0 违规） | ✅ 真机回归通过 |

### 共享切换第二阶段（当前，分支 `refactor/sync-shared-desktop`）

- **审计**（`/Users/admin/file/local-lake/lake-notes-audit-sync-shared-desktop-2026-08-22.md`）确认 3 Critical + 5 High + 6 Medium，**已修 C1/C2/H1**（提交 `e8fbb3b`，测试 8/8 绿 + 全量 416 passed）。
- **剩余**（按计划 `docs/SHARED-SYNC-PLAN.md` §8.2）：
  1. C3：`parseLakeManifest`/`validateManifest` 下沉 `src/core`（20MiB/200k 上限、字段校验、isSafeSegment）
  2. H2：`S3Store` 改字节形态 + gzip 魔数解压（桌面写→移动端读方向）
  3. H3：assets 进 `SyncDbPort` 契约（下载 size/sha256 校验、上传扫描）——**与图片方案联动**
  4. H4：folders 进端口契约
  5. H5：superseded 双路径（正文被覆盖 + 远端回收站压本地编辑）→ onSuperseded 接线
  6. M1-M6：幂等短路重排（meta/锁 LWW 先行）、恢复例外补全、性能（零变更早退/Map 索引）、超时/单对象上限、manifest 排序、folders 首次发布
  7. Step 4 等价测试：**逐字段比较 manifest** + 桌面独有场景（锁/元数据 LWW/superseded/folder/assets）
  8. Step 5 强制验收：**桌面↔手机双端真机 A/B**（gzip manifest、删除/恢复、图片）

## 3. 图片/资源方案（定稿：canonical http + 移动 blob 显示）

> 定稿文档：`/Users/admin/file/local-lake/lake-notes-asset-architecture-2026-08-22.md`（主目录，不受分支影响）

- **canonical（存储/同步）永远固定**：`http://127.0.0.1:19876/{noteId}/{filename}`——两端统一、存量零迁移（V5 红线）。
- **显示层各自独立**：桌面 http（assetServer 零改动）；移动端 **blob**（本地读字节 → `URL.createObjectURL` → `setDisplayUrl` 注入）。
- **blob 是显示层转换，不是存储形态**：不进 .lake、不进 S3、保存不污染（桌面实测：getDocument 输出 canonical、保存后 hash 不变）。
- **移动端不自建 HTTP 服务器**（方案 A 淘汰：省掉原生代码/iOS ATS/端口生命周期；"同构"由 canonical 保证而非显示层）。
- **评审补充 7 点**（已确认，实施时纳入）：
  1. `setDisplayUrl` 移动端可得性真机确认（同一 vendor lakex 0.1.2，应可用）
  2. **19876 是逻辑端口约定**：移动端注入前拦截所有 canonical URL（有字节→blob，缺→占位），**绝不能真请求 127.0.0.1**
  3. blob 生命周期：关文档/切 tab `revokeObjectURL`；按 `{noteId}/{filename}` 会话缓存（内容 hash key）
  4. 下载校验：manifest.assets（size/hash）→ 损坏拒绝（协议 §4.5）——与审计 H3 联动
  5. 移动端 canvas 转 png（webp/avif）复制微信：注意 WebView canvas 兼容性，POC 后置
  6. 缺失图占位 + warnings，不发网络请求
  7. 上传方向（粘贴新图）：canonical 生成统一 19876 形态 + FS 存储 + 同步上传，POC 后置
- **存储**：图片字节 → Capacitor Filesystem（目录 `note-assets/{noteId}/{file}` 与桌面一致）；不用 sql.js BLOB（全库 export 爆炸）。

## 4. 存储机制统一（当前主线，术语对照）

| 概念 | 共享层（src/core） | 桌面 adapter（待做） | 移动端 adapter（已有） |
|---|---|---|---|
| 同步编排 | `syncEngine.ts` | electron/sync.ts 收敛（Step 5） | bridge 直连 |
| S3 对象读写 | `S3Store` 端口 | ObjectStore 包装（Step 3） | `s3Store.ts`（CapacitorHttpHandler） |
| 本地库读写 | `SyncDbPort` 端口 | store 方法包装（Step 3） | bridge dbPort（sql.js） |
| 决策纯函数 | lakeReconcile/decideUpload/syncDecision | ✅ 已共享 | ✅ 已共享 |
| DB 接口 | `dbLike.ts`（同步形态） | better-sqlite3 | SqlJsDb（sql.js） |

**目标终态**：同步语义只改 `src/core/syncEngine.ts` 一处；桌面 sync.ts 缩减为 adapter 装配 + GC/历史/进度接线。

## 5. 分支与代码位置

```text
/Users/admin/file/local-lake/lake-notes-mobile     ← 移动端 worktree（git worktree，独立于主仓库工作树）
  分支 refactor/sync-shared-desktop（当前，含共享引擎 + 审计修复）
  分支 refactor/mobile-capacitor（M0-M1 历史，已推 gitee）
  关键代码：src/core/syncEngine.ts + syncEngine.test.ts（8 例）
            src/mobile/{bridge,s3Store,sqliteDb,capacitorHttpHandler,persistence,MobilePocApp}
            mobile.html + vite.mobile.config.ts（移动端 bundle）
            scripts/android-build.sh（gradle wrapper 绕行 + 阿里 maven 镜像 + JDK 21 强制）
/Users/admin/file/local-lake/lake-notes-electron   ← 主仓库（master）
  docs/SHARED-SYNC-PLAN.md（第二阶段计划，master 8eedb06 已推）
  docs/ASSET-URL-MOBILE-PLAN.md（图片方案初版，已被定稿文档取代）
主目录（不受分支影响）：
  lake-notes-asset-architecture-2026-08-22.md（图片定稿）
  lake-notes-audit-sync-shared-desktop-2026-08-22.md（审计）
```

## 6. 踩坑记录（移动端专属）

1. **CSP `'unsafe-eval'` 必须放行**：WebAssembly 编译被 CSP 拦（sql.js 加载失败）——script-src 加 `'unsafe-eval'`。
2. **CSP 通配子域**：AWS SDK 虚拟主机风格请求 `https://{bucket}.s3.cn-north-1.qiniucs.com`——connect-src 放行 `*.s3.cn-north-1.qiniucs.com`。
3. **CORS 绕行**：WebView fetch 撞 CORS → 传输层下沉原生（CapacitorHttpHandler）——这是架构决策不是补丁。
4. **AWS SDK 响应 body 要求 Blob/ReadableStream**：handler 返回 Uint8Array 报 `Unexpected stream implementation` → 包装 `ReadableStream`。
5. **gradle 2s 失败 = 漏 export JAVA_HOME（系统 Java 8）**：AGP 8.13 需 JDK 11+；脚本已强制 JDK 21。
6. **gradle wrapper 下载超时**：services.gradle.org 不可达 → 复用 `~/.gradle/wrapper/dists/gradle-8.14.3-bin` 缓存二进制。
7. **小米无 SIM 装 APK**：`INSTALL_FAILED_USER_RESTRICTED` → 开「USB 安装」后 `adb install -r` 直装 + CDP 自动化驱动（`/tmp/cdp-e2e-tombstone.mjs`）。
8. **wa-sqlite 官方包无法同步调用**（Asyncify 硬编码 async=true，rc=21）→ sql.js 为 WASM 路线主选。
9. **内部 npm registry（weizhipin）不可达** → mobile worktree `.npmrc` 已切 npmmirror（项目级，不动公司全局配置）；lockfile weizhipin 引用已替换。
10. **reconcile local-wins 与 decideUpload 重复 push** → 统一由 decideUpload 决定（skip-fast 覆盖）。

## 7. 下一步（按用户确认的优先级）

1. **继续共享切换第二阶段**（分支 `refactor/sync-shared-desktop`）：C3 → H2 → H3（assets，与图片联动）→ H4 → H5 → M1-M6 → Step 4 等价测试 → Step 5 双端 A/B 强制验收。
2. **图片落地**（H3 联动）：同步下载 assets（FS 存储 + 校验）→ blob 渲染注入 → 上传方向（POC 后置）。
3. **跨端完整验证**：桌面 App 配七牛 ↔ 移动端数据互通（含 gzip manifest、删除/恢复、图片）。
4. **移动端 UI 设计**（后置）：参考 Tauri POC `MobileLibrary.tsx`；丢失的 HTML 雏形未找到。
5. **test/adhoc 分支**（另一会话）：lake-asset:// 调研遇大问题已搁置；blob 方案已定稿替代。

## 8. 关键文档索引

```text
/Users/admin/file/local-lake/lake-notes-asset-architecture-2026-08-22.md   ★ 图片方案定稿（canonical http + blob 显示）
/Users/admin/file/local-lake/lake-notes-audit-sync-shared-desktop-2026-08-22.md  ★ 共享引擎审计（C1/C2 已修，C3/H2-H5/M1-M6 待办）
lake-notes-electron/docs/SHARED-SYNC-PLAN.md                                共享切换第二阶段计划（含 §8 审计反馈）
lake-notes-electron/docs/ASSET-URL-MOBILE-PLAN.md                           图片方案初版（已被定稿文档取代）
lake-notes-mobile/docs/MOBILE-TECH-STACK.md                                 移动端技术定案 + M0-M1 验证记录（§10-14）
lake-notes-electron/Electron-HANDOFF.md                                     桌面交接（V5 Phase 0-4 已合入）
```
