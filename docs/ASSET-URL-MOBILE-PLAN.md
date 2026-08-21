# 移动端图片/资源访问方案（AssetUrlResolver）

> 日期：2026-08-22 ｜ 状态：待评审/确认 ｜ 关联：V5 §10 AssetUrlResolver（四形态）、docs/MOBILE-TECH-STACK.md

## 1. 桌面机制（现状，移动端要对齐语义）

- 资源服务器：`electron/assetServer.ts`，`http://127.0.0.1:{ASSET_PORT=19876}/{noteId}/{filename}?token=xxx`
- 磁盘布局：`note-assets/{noteId}/{filename}`；vendor/cdn 静态服务（编辑器自身资源）
- Lake 内容中的图片 URL = canonical 形态（`src/lib/assetPort.ts` 的 `LOCAL_ASSET_PREFIX`）
- 访问令牌 ASSET_TOKEN（每次启动随机，preload 注入；带 Origin 的请求校验 token）
- 同步：S3 `assets/{noteId}/{filename}`（manifest.assets 带 size/hash，内容寻址校验）

## 2. 移动端缺口

无 Electron 主进程 → 无 HTTP 资源服务器、无磁盘目录；sql.js 内存库 + IndexedDB 持久化。
Lake 内容里的 canonical URL（`http://127.0.0.1:19876/...`）在移动端不可达。

## 3. 方案对比

| 方案 | 机制 | Lake 内容改造 | 大文件 | 工作量 | 与桌面同构 |
|---|---|---|---|---|---|
| **A. 原生 HTTP 资源服务器**（推荐正式） | Capacitor 自写插件（Android NanoHTTPD/Ktor + iOS GCDWebServer 后续）serve 原生 FS `note-assets/`；桥注入 `assetPort` | **零改造**（URL 形态与桌面一致） | ✅ 流式 | 中（Android 原生 ~200-300 行） | ✅ |
| **B. 运行时 data URL**（POC 过渡） | 图片存 IndexedDB；渲染前 canonical URL → data URL（复用 assetPort.mapLocalAssetUrls 思路），保存还原 | 运行时替换（内容不变） | ❌ 内存膨胀 +33% | 低（纯 JS ~100 行） | 部分（URL 形态一致，渲染层替换） |
| C. S3 直链 | 内容 URL 指向 S3 公网 | — | — | — | ❌ 否决（桶私有/签名过期/离线不可用） |

**存储决策**：图片二进制放**原生文件系统**（Capacitor Filesystem，目录 `note-assets/{noteId}/{filename}` 与桌面一致）——不用 sql.js BLOB（全库 export 会带上图片，性能灾难）、不用 IndexedDB（大文件不合适，且非桌面同构）。同步时下载/上传走 S3 `assets/{noteId}/{filename}`。

## 4. 演进路径

1. **POC（方案 B 先行，本轮可做）**：
   - 同步引擎扩展：拉 manifest 时下载 `assets/{noteId}/{filename}` → IndexedDB（Map，键 `{noteId}/{filename}`）
   - 桥加 `resolveAssetUrls(content): string`：canonical URL → data URL（有 token 时 strip；缺失的图留占位）
   - LakeEditor 适配：渲染前 resolve，保存前还原（对齐 assetPort 的 addAssetAccessToken/stripAssetAccessToken 思路）
   - 上传：编辑器内粘贴图片 → 桥 `uploadResource` → 存 IndexedDB + 内容写 canonical URL → 同步上传 S3
2. **正式（方案 A，M2+）**：
   - Capacitor 原生插件 `AssetServerPlugin`（Android Kotlin）：serve `note-assets/`（NanoHTTPD），端口随机/固定，token 校验
   - 桥注入 `assetPort`/`assetToken` → `src/lib/assetPort.ts` 的 ASSET_ORIGIN 逻辑天然生效（读 lakeNative.assetPort）
   - Lake 内容零改造（canonical URL 与桌面完全一致 → 同步/导出/跨端兼容）
   - iOS 后续：GCDWebServer + ATS 例外（NSAllowsLocalNetworking）

## 5. 同步集成

- 下载：manifest.assets（size/hash）→ 下载 `assets/{noteId}/{filename}` → 校验 size/hash（损坏拒绝，协议 §4.5）→ 存 FS/IndexedDB
- 上传：本地新资源 → 上传 S3 → 更新 manifest.assets
- 对象缺失：B 方案（跳过 + warnings）——图片缺失时渲染占位，不阻塞同步

## 6. 风险

| 风险 | 对策 |
|---|---|
| 大图内存（方案 B） | POC 接受；正式切方案 A（原生流式） |
| iOS ATS 拦 http://127.0.0.1 | NSAllowsLocalNetworking（iOS 阶段） |
| token/越权 | 复用桌面校验逻辑（带 Origin 请求校验 token） |
| CSP | img-src 已放行 `http://127.0.0.1:*` ✅ |
| 图片与桌面 URL 冲突（同步互读） | canonical 形态一致 → 两端 URL 可互认（正式方案 A） |

## 7. 决策点（待确认）

1. 是否先做 **POC 方案 B**（data URL 过渡，纯 JS）验证图片同步链路，正式再切 A？
2. 存储用 Capacitor Filesystem（原生 FS，推荐）还是 IndexedDB（POC 简化）？
3. 粘贴/选择图片上传的入口：POC 阶段是否只做「同步下载显示」，上传方向后置？
