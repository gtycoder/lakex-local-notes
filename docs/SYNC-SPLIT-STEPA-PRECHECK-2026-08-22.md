# Step A 拆分自查报告（行为零变化预检）

> 日期：2026-08-22 ｜ 分支：refactor/sync-split-desktop ｜ 目的：拆分前逐项核查，保证**代码逻辑与功能零变化**
> 原则：仅拆分（移动代码位置 + 类型/常量随迁 + re-export 兼容），不重构、不改语义、不加功能。

## 1. 14 函数逐项核查（调用方 / export / 依赖 / 风险）

| # | 函数 | export | 调用方（外部） | 依赖 | 风险与处理 |
|---|---|---|---|---|---|
| 1 | `syncSnapshot` | 否 | 仅 sync.ts 内（513/576/788） | mergeLockState（core 已有）+ ManifestNote 类型 | 无风险，纯对象构造 |
| 2 | `parseLakeManifest` | **是** | 无外部 | MAX_MANIFEST_BYTES/NOTES/FOLDERS（本地常量）、validateManifest | **Buffer→Uint8Array**：re-export 包装转 Uint8Array；TextDecoder 默认替换与 Buffer.toString 一致（等价测试） |
| 3 | `isGzip` | 否 | 仅 sync.ts | GZIP_MAGIC 常量 | Uint8Array 魔数比较，零风险 |
| 4 | `objectKey` | 否 | 仅 sync.ts（quickNotesSync 有**独立同名**小记版，不冲突） | 无 | 零风险 |
| 5 | `collectManifestRefs` | 否 | 仅 sync.ts | Manifest 类型 + objectKey | 零风险 |
| 6 | `normalizeEndpoint` | 否 | 仅 sync.ts | 无 | 零风险 |
| 7 | `validateS3Settings` | **是** | **quickNotesSync（2 处）** | **S3Settings 类型（须随迁 core）** | re-export 保外部兼容 |
| 8 | `errorMessage` | 否 | 仅 sync.ts（logger.ts 有**独立同名**，不冲突） | 无 | 零风险 |
| 9 | `isNoSuchKey` | 否 | 仅 sync.ts | error 对象字段（$metadata/name） | 零风险 |
| 10 | `mimeTypeFor` | **是** | **quickNotesSync（1 处）** | **node:path（core 禁）** | **path.extname 纯 JS 复刻** + 等价测试（见 §2） |
| 11 | `assertSafeKey` | 否 | 仅 sync.ts | SAFE_KEY_RE 常量（随迁） | 零风险 |
| 12 | `chunkArray` | 否 | 仅 sync.ts | 无 | 零风险 |
| 13 | `validateManifest` | 否→**是**（移动端需用） | 仅 sync.ts（parseLakeManifest 调） | MANIFEST_VERSION（随迁）+ Manifest 类型 + limits 参数 | 常量随迁；上限参数保留注入 |
| 14 | `sha256Hex` | **是** | **quickNotesSync（3 处）** | **node:crypto（core 禁）+ Buffer** | **核心风险**：同步上下文（539/677/731）→ core 需**纯 JS 同步 SHA-256**（见 §2） |

## 2. 三个高风险点与等价保障（必须处理，否则行为可能变化）

### H1. sha256Hex：node:crypto 同步 → core 纯 JS 同步 SHA-256
- 现状：`crypto.createHash("sha256").update(bytes).digest("hex")`（同步，Buffer）
- core 现有：`crypto.subtle` 版（**异步**）——sync.ts 调用点是同步上下文（`sha256Hex(bytes) !== asset.hash`），**不能直接用 async 版**
- 方案：core 新增**纯 JS 同步 SHA-256**（`sha256Sync(bytes: Uint8Array): string`，无依赖、确定性）；桌面 re-export `sha256Hex = (bytes: Buffer) => sha256Sync(new Uint8Array(bytes))`——调用点零变化
- **等价测试（强制）**：随机输入（空串/中文/长文本/二进制/边界长度）→ `sha256Sync` vs `node:crypto` 输出逐一相等（表驱动，≥20 用例）

### H2. mimeTypeFor：node:path.extname → 纯 JS 复刻
- 现状：`path.extname(filename).toLowerCase()` + 静态 map
- core 禁 node:path → 纯 JS 复刻 path.extname 规则：`lastIndexOf(".")`，dot 位置 > 0 且非路径分隔（asset filename 是安全段无分隔，但精确复刻）
- **等价测试（强制）**：覆盖 `.png`/`a.b.c.jpg`/`.gitignore`（→""）/`a.`（→"."）/`无扩展名`/中文文件名 → 与 path.extname 输出一致

### H3. parseLakeManifest：Buffer → Uint8Array + TextDecoder
- 现状：`bytes.toString("utf8")`（Buffer）
- core 版：`new TextDecoder("utf-8").decode(bytes)`（默认 non-fatal 替换，与 Buffer.toString 一致）
- 桌面 re-export 包装：`parseLakeManifest(bytes: Buffer, limits?) => core(new Uint8Array(bytes), limits)`
- **等价测试（强制）**：合法 UTF-8 / 含 BOM / 空字节 → 解析结果与 Buffer 版一致；超限抛错消息一致

## 3. 常量/类型随迁清单（漏迁会导致 core 函数无法独立工作）

| 项 | 现值 | 去向 |
|---|---|---|
| `MANIFEST_VERSION` | 4（sync.ts:95） | core（validateManifest 依赖） |
| `MAX_MANIFEST_BYTES` | 20MB（:114） | core 默认值 |
| `MAX_MANIFEST_NOTES` | 200k（:117） | core 默认值 |
| `MAX_MANIFEST_FOLDERS` | 50k（:118） | core 默认值 |
| `SAFE_KEY_RE` | :1050 | core（assertSafeKey 依赖） |
| `GZIP_MAGIC` | :139 | core（isGzip 依赖） |
| `S3Settings` 类型 | sync.ts:48 | **core 共享类型**（validateS3Settings + quickNotesSync 都依赖） |

## 4. re-export 兼容清单（外部调用方不能感知拆分）

quickNotesSync.ts:4 `import { type S3Settings, ObjectStore, isSafeSegment, mimeTypeFor, sha256Hex, validateS3Settings } from "./sync.js"`：
- ✅ 保留：ObjectStore（不搬，桌面 adapter）
- ✅ 已共享：isSafeSegment（sync.ts:1150 已 re-export 自 core storeUtils）
- 🔁 需 re-export：S3Settings（类型，从 core）、mimeTypeFor、sha256Hex、validateS3Settings
- parseLakeManifest 虽无外部调用，但本身是 export → 同样 re-export 保 API 稳定

## 5. 日志与溯源设计（用户要求：方便测试与问题溯源）

1. **拆分映射表**：本报告 §1 = 每个函数的「旧行号 → 新文件 → re-export 处理」溯源依据；随提交进 git history。
2. **等价测试**：§2 的 H1/H2/H3 表驱动测试（核心护栏）——拆分后若行为漂移，等价测试先红。
3. **验收日志**：每步执行后存档——`git diff --stat`（应仅"移动+re-export"）+ 408 测试输出 + 边界检查输出。
4. **行为快照（可选增强）**：拆分前后各跑一次同步集成测试（桌面 mock S3），对比 `[perf] download/upload` 日志与 SyncResult 字段——双保险。
5. **commit 信息规范**：每条拆分提交列出「函数清单 + 旧行号 + 新文件 + re-export 项」，可回溯。

## 6. 执行与验收

1. 新建 `src/core/syncUtils.ts`（纯逻辑）+ `src/core/sha256Sync.ts`（纯 JS SHA-256）+ S3Settings 类型（`src/core/` 类型文件）
2. sync.ts 改 import + re-export（原函数体删除）
3. 等价测试（H1/H2/H3）+ 现有测试：**408 全绿** + 边界检查 0 违规
4. `git diff --stat` 验证"仅移动"；提交信息含映射表
5. 移动端检出验证：core 新函数可 import + mock 跑通（§1.5 硬指标）

## 7. 明确不做（本步）

- 不合并重复函数（errorMessage 与 logger.ts 同名——留待后续，本次仅移动 sync.ts 版）
- 不改 quickNotesSync（它的独立 objectKey/常量不受影响）
- 不优化实现（mimeTypeFor 的 map、sha256 算法均为原样迁移/等价复刻）
