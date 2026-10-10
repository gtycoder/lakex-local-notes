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

## 重构输入（261010 实测约束 + 既有修复 —— 架构重做前必读）

> 来源：261009–261010 的移动端逐页走查（22 屏设备级截图 + 五类探针）、F16 弱网实测、S3 密钥缺陷修复。数字与截图口径见 `HANDOFF.md` §8。

### A. 运行时硬约束（实测，别假设）
1. **WebView 存储只有一半可靠**：同一台 AVD 上 **localStorage 跨 App 重启仍在**，而 **IndexedDB 重启后被重建为空**
   （`app_webview/Default/IndexedDB/http_localhost_0.indexeddb.leveldb` 目录还在，库却消失、`onupgradeneeded` 再次触发）。
   ⇒ **任何持久化（尤其密钥）都不要信 WebView 存储**，走 native（Keystore / SQLite / Preferences）。
   这正是旧 `secretStore.ts`（WebCrypto+IDB）导致「S3 密钥每次重启丢失、同步报 signature mismatch」的根因。
2. **CDP 的 `Page.captureScreenshot` 抓不到 GPU canvas 层**：usheet 网格在页面截图里整片空白，而同屏 `canvas.toDataURL()` 内容完整、
   `adb exec-out screencap -p` 正常 ⇒ 移动端验收**一律设备级截图**（走查脚本已按此改），否则会误报「表格空白」。
3. **keep-alive 的隐藏视图仍在 DOM**（`display:none`，元素还在、部分 rect 为 0）⇒ 自动化导航与可见性判据必须带**命中测试**
   （`elementFromPoint`），只查 `querySelector` 会点到不可见元素（本轮为此反复踩）。
4. **可编程入口 = `window.lakeNative`（当前 49 个方法）+ `window.__lakePerf`**：移动端自动化验收（含 F16 计时）全靠它。
   **新架构必须保留等价入口**，否则验收退回手工。
5. **弱网可复现**：模拟器 `-netdelay gprs -netspeed gprs`（≈80kbps / 500ms RTT）。

### B. 需要重构替掉的既有结构（现状对照）
- `src/mobile/bridge.ts`：`window.lakeNative` 兼容契约 + **一条 `KeyedAsyncQueue`（key 固定 `main`）**，把「整轮同步（含全部网络往返）」
  与「所有本地写（saveNote / 小记 / 目录 CRUD / 回收站恢复与彻底删除 / 历史 / GC）」**完全互斥** ⇒ 弱网下本地写要等整轮同步
  （实测 **152s**，见下面 D 的 F16）。桌面**没有**该问题（维护锁只包 同步 / 备份 / 定期 GC）。
- `src/mobile/secretStore.ts`：当前是 WebCrypto AES-GCM + **localStorage 密文**（261009 刚从 IndexedDB 改过来）；
  **正解仍是 native / Keystore-backed**（该文件头注释与 §17.5 的既定方向）⇒ 建议新架构直接吸收，别让密文继续留在 WebView 存储里。
- 视图分派（`NotebookWorkspace`）：doc 可编辑（Lake 内核单实例）；**usheet（Univer 只读）/ 多维表 / 画板**只读。
- 内核：与桌面**同一套**（lakex vendor + `@univerjs/*` 1.0.3 精确锁）；`@univerjs/ui` 有我们一个**补丁**（floating 层收口，两端共用）
  —— 重构若改编辑器装载方式，补丁 + `univerContract.test.ts` 护栏 + `scripts/usheet-kernel-probes.mjs` 要一起复核。

### C. 本轮已修 + 已验收（请当需求保留，别在重做时丢掉）
1. **S3 密钥跨重启**（已修）：密文进 localStorage + 缺失时给可执行提示（`assertS3Credentials()`，同步 / 测连通 / 上传三条路径共用）。
   设备验收：保存 →（force-stop 重启）→ `skLen 40` / 连通 OK / 同步成功。**需求**：密钥必须跨重启可用，缺失时明确提示而非签名错。
2. **冷启动首用内核时内核样式缺席**（已修）：小记编辑器渲染成大图标 + 原生 `<input type=file>`；根因是 kernel CSS 只由文档编辑器模块引。
   **需求**：任何内核消费者都要保证内核样式已加载。
3. **小记写作卡两字按钮折行**（已修，`.mobile-qn-btn` nowrap）。
4. **移动端逐页走查装置**：`scripts/css-audit/mobile-walkthrough.mjs`（22 屏 / 设备级截图 / 五类探针 / 可只复跑指定屏），覆盖面与未覆盖边界见 `HANDOFF.md` §8。
5. **画板只读查看器**需要一篇 board 文档；模拟器按 `HANDOFF.md` §8 的种子法补了 `mobile-board-1`。

### D. 与重构重叠、需要架构方一句话的点
- **F16（弱网下同步中本地写等 ~2.5 分钟，已量完并判定立项）**：原计划「**网络阶段不占主队列 + DB 片段内短锁 + 跨端对拍先行**」。
  若新架构要换掉移动端的数据/同步编排，请把 F16 作为**新架构的硬约束**（用户写不得被网络阻塞），我就不在旧 `bridge.ts` 上打补丁；
  若仍走旧桥，我按原计划实现（对拍用例先行）。**在你回话前，F16 保持不动。**
- 桌面侧与本重构无关（桌面走查批次、表格中期项），不冲突。
- 两端共用物不要顺手删：`@univerjs/ui` 补丁、`univerContract.test.ts`、`scripts/usheet-kernel-probes.mjs`、`walkthrough.mjs` / `mobile-walkthrough.mjs`。

### E. 需要架构方回的三个问题
1. 新架构是否替换 `bridge.ts` / 全局 `KeyedAsyncQueue` / `secretStore`？（这决定 F16 的落点）
2. 是否需要把 `mobile-walkthrough.mjs` 的设备级截图与探针口径接进新架构的验收流程？
3. 新架构是否保留 `window.lakeNative` 等价的可编程入口？（我要用它量 F16、做自动验收）
## 验证
- 构建：`node node_modules/vite/bin/vite.js build --config vite.mobile.config.ts`
- 安装：`bash scripts/android-build.sh --sync --install`
- CDP：`bash scripts/emu-cdp.sh`
- 模拟器：`bash scripts/emu-up.sh`
- 真机重点：图片/附件、V1 同步、编辑保存、键盘安全区、长文档大纲、剪贴板。
