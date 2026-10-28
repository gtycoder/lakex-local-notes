# 开发指南

## 一、环境要求（重要）

- **Node 必须是 ≥ 20.12**：系统默认 node 是 v18（`~/.nvm/versions/node/v18.20.8`），
  跑 vite 8（rolldown）会报 `styleText` 缺失。必须用 nvm v24：
  ```bash
  export PATH="$HOME/.nvm/versions/node/v24.18.0/bin:$PATH"
  ```
- **npm 镜像**：私有镜像 `npm.weizhipin.com` 不可达（2026-08-02 实测 npm 命令会挂起）。安装新依赖用：
  ```bash
  export npm_config_registry=https://registry.npmmirror.com
  export npm_config_cache=/tmp/npm-cache-lake
  ```
- **better-sqlite3 13.x（N-API）**：单二进制同时兼容 Node 与 Electron，**无需 @electron/rebuild**，
  不再有双 ABI 问题（Electron 升级后无需重编译）。

## 二、开发

```bash
cd /Users/admin/file/local-lake/local-lakex-notes
PATH="$HOME/.nvm/versions/node/v24.18.0/bin:$PATH" npm run dev
```
- Vite dev server：`http://127.0.0.1:1421/`
- 本地图片服务器（asset server）：`http://127.0.0.1:19876/`
- `vite-plugin-electron` 监听 `electron/*.ts` 变更自动重建并重启 Electron；渲染层走 HMR
  （注意：HMR **不会重建已创建的编辑器实例**，测编辑器相关改动必须 Cmd+R 或重启）

**杀进程时绝不能用 `pkill -f "Electron"`**——Trae CN（用户的 IDE）也是 Electron 应用，会被误杀。正确方式：
```bash
kill $(ps aux | grep "local-lakex-notes" | grep -v grep | awk '{print $2}')
```

**dev 与打包版 userData 隔离**（dev=`local-lakex-notes-dev`，打包版=`local-lakex-notes`），单实例锁按
userData 各自独立，**可同时运行**；同一 userData 内第二实例会被单实例锁直接退出。

## 三、构建与打包

```bash
# 1. 类型检查 + 渲染层/主进程构建（必须用 Node 24）
PATH="$HOME/.nvm/versions/node/v24.18.0/bin:$PATH" node node_modules/vite/bin/vite.js build

# 2. 打包 dmg + zip（electron-builder）
./node_modules/.bin/electron-builder --mac
```
产物输出到 `release/`（已在 .gitignore）：
- `release/LocalLakexNotes-0.1.0-arm64.dmg`（约 158MB）
- `release/LocalLakexNotes-0.1.0-arm64-mac.zip` + 两个 `.blockmap`
- `release/mac-arm64/LocalLakexNotes.app`（未打包的应用）

**打包版注意事项**：
- 未签名/未公证：首次打开需右键 → 打开（或系统设置 → 隐私与安全性）
- 默认 Electron 图标（尚未做应用图标）
- **userData 隔离**：dev 用 `~/Library/Application Support/local-lakex-notes-dev`（可重建），打包版默认
  `~/Library/Application Support/local-lakex-notes`（正式数据，**禁止随意触碰**）。
- **打包版测试隔离**（避免打开正式数据）：任意模式都支持 `LAKE_USER_DATA` 覆盖，例如：
  ```bash
  LAKE_USER_DATA="$HOME/Library/Application Support/local-lakex-notes-test" \
    "release/mac-arm64/LocalLakexNotes.app/Contents/MacOS/LocalLakexNotes"
  ```
  不设 `LAKE_USER_DATA` 时打包版才走正式数据路径。

## 四、测试

```bash
PATH="$HOME/.nvm/versions/node/v24.18.0/bin:$PATH" npm test   # vitest run，82 用例
```
- 测试文件：`electron/{ssrf,sync,store}.test.ts` + `src/features/editor/clipboardHtml.test.ts`
- better-sqlite3 13.x 为 N-API 单二进制，vitest 直接用仓库内构建，无需双 ABI 基建；
  `electron/store.test.ts` 里 `vi.mock("electron")` 提供 safeStorage/net 替身（store.ts 模块加载即 import electron）
- Store 层测试用真实 SQLite 临时目录 + 另开只读连接验证落盘内容（如 S3 密钥是否 `enc:v1:`）

## 五、关键版本与依赖

| 依赖 | 版本 | 备注 |
|---|---|---|
| electron | 43.4.0 | ^43.4.0 |
| electron-builder | 25.1.8 | devDependency |
| vite / rolldown | 8.1.5 | 需 Node ≥ 20.12 |
| better-sqlite3 | 13.0.3 | N-API 单二进制，无需 rebuild |
| sharp | 0.35.3 | 原生，webp→png |
| @aws-sdk/client-s3 | 3.1101.0 | S3 同步 |
| @dlient/lakex-doc-react（vendor 源码） | 0.1.3（内核 v1.99.0） | Lake 编辑器 ESM |
| lakex-drawnix / -react-board / -react-text | 0.1.0 | 画板 |
| vitest | 4.x | 测试 |

## 六、提交历史（master 主线，2026-08-02 更新）

```
cbdfc2c fix(试验): 长大纲列表跟随——选中项滚动到 TOC 列表可视区
c249e16 feat(阶段C): 孤儿资源 UI——同步面板增加未引用资源列表与清理
a7e41c8 test(阶段C): Store 层 DB 测试（双 ABI）+ S3 配置校验，56→82 用例
115fa6c docs: 虚拟渲染试验已合回 audit/code-optimization（当前分支更新）
4a76c76 refactor(试验收敛): 清理探针/封顶重试轮询 + 修复 Phase B 桥离开路径
02dde5f fix(试验 Phase B): 表格浮动工具栏 hover 消失
2c33875 fix(试验): TOC 三问题修复（滚出视口/高亮跟随/点击定位）+ 代码块粘贴不可见
afe0b9f docs: 写本会话交接（大文档性能定位 + virtualRendering 试验）
…（中间为 audit 审计/测试/性能埋点 21 个提交）…
bf82118 重写主交接文档：面向新会话的完整上下文（路线验证完成）
74062e3 阶段B收尾：资源本地化+同步进度UI+dmg打包
898e7b9 同步面板入口：状态栏点击同步状态打开 S3 配置面板
c57a3a4 阶段 B：S3 备份同步（七牛云等 S3 兼容服务）
a703492 正式版 v1 基础：资源归一化 + 第三方图片下载/复制修复
61ee469 baseline: before asset server POC
```
