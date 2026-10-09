# 移动端技术栈

> 当前移动端是正式端之一：Vite 前端 bundle + Capacitor Android + 原生 SQLite/AssetServer。
> 运行方式、AVD、CDP、已知验收项见 `HANDOFF.md` §8。

## 架构
- UI/编辑器：React + 共享 Lake/编辑器组件；mobile bundle 由 `vite.mobile.config.ts` 构建。
- 壳：Capacitor 8，Android 包名 `com.lakenotes.mobile`。
- 数据：Android native SQLite（WAL）保存 notes/folders/history/GC 等；`sql.js` 仅保留测试/迁移验证。
- 文件：Capacitor Filesystem 保存工作区、资源和 staging；不映射 macOS 数据目录。
- 资源：`AssetServer.kt` 提供本机 canonical URL，token/CORS 语义与桌面端对齐。
- 同步：共享 `src/core/syncEngine.ts` / `quickNotesSyncEngine.ts`；移动端注入 SQLite、Filesystem、HTTP 与 secret ports。
- 小记：v2 Lake body；编辑态挂单实例内核，时间线预览用白名单解析器。

## 数据与同步约束
- 本地是唯一真相，S3 只是镜像；墓碑、回收站、恢复语义与桌面一致。
- 当前 Lake Manifest 为 V1（260928 重置），所有端必须一起升级。
- 资源存在性按远端清单差集；下载按实扫 size+sha256 复用本地文件。
- 移动端不写 Lake 文档正文：**表格（usheet，Univer 内核只读）/ 多维表 / 画板**只读展示；doc 交给 Lake 编辑器。
- `note_history` 仍需补齐 `refs_json`/`protected_until`，纳入真机验收。

## 验证
- 构建：`node node_modules/vite/bin/vite.js build --config vite.mobile.config.ts`
- 安装：`bash scripts/android-build.sh --sync --install`
- CDP：`bash scripts/emu-cdp.sh`
- 模拟器：`bash scripts/emu-up.sh`
- 真机重点：图片/附件、V1 同步、编辑保存、键盘安全区、长文档大纲、剪贴板。
