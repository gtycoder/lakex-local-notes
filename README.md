# Local Lakex Notes

[![Release](https://img.shields.io/github/v/release/gtycoder/local-lakex-notes?label=release&color=2ea44f)](https://github.com/gtycoder/local-lakex-notes/releases)

**本地优先的语雀 Lakex 编辑器笔记应用（非官方）**：桌面 macOS + Android，本地是唯一真相，S3 只做多端镜像。

> 使用语雀的 Lakex 编辑器内核（本地私有引入、已 pin），但本项目**与语雀官方无关**，不代表语雀官方立场；该闭源内核以 **vendored** 形式随本仓库公开分发（未经语雀/蚂蚁授权，风险自担，见 `NOTICE`）。

## 项目简介

Local Lakex Notes 是一个自持数据的个人笔记应用：笔记、表格、多维表、画板、小记全部保存在本地（SQLite + 文件），S3（七牛 Kodo / S3 兼容）只用于多端备份与同步。不存在账号体系、团队协作或云端依赖；没有网络也能完整写作与检索。

- 桌面端：Electron 44 + React 18，macOS 优先
- 移动端：Vite + Capacitor，Android 为正式端之一
- 编辑器：语雀 Lakex（富文本）、Univer（表格）、自研多维表、Drawnix（画板）、手写板
- 同步：本地优先 + 墓碑权威（删除压编辑）+ 先拉后推；冲突不合并，被覆盖方留历史快照

## 当前能力

**编辑与文档**
- 笔记本 / 分组 / 文档树，支持拖拽排序与移动层级
- Lakex 富文本：标题、列表、待办、引用、代码块、公式、分栏、折叠块、图片、附件、文档引用
- 表格（Univer）：公式库、数字格式、边框、合并、对齐、换行、冻结、排序、筛选、查找替换、超链接、单元格备注、十字高亮
- 多维表（自研）：表格 / 看板视图、字段类型、筛选、排序、搜索、附件与正文详情
- 画板（Drawnix）与手写板（多页 A4、笔迹/高亮/橡皮、撤销重做）
- 小记：独立时间线、标签、预览快路径 + 内核只读兜底、转正式文档、单条「保存并同步」
- 大纲、历史快照、回收站（软删 + 墓碑 + 恢复标记）、附件与图片管理、全文搜索（FTS5）
- AI 助手：选区浮层 / 顶栏 / 块菜单入口，文本与图片、PDF 文本解析（Key 只在主进程）

**同步与存储**
- 本地优先：SQLite + 文件是唯一真相，S3 只是镜像
- 墓碑权威：删除必须传播到所有设备；恢复是唯一显式例外
- 冲突先提交者为真，被覆盖方自动留历史快照，不做合并
- 资产按远端清单差集同步，禁止逐对象探测；并发上限 8
- S3 配置可在桌面导出、手机导入（加密迁移码 `LLN1.`，仅作备用）

**界面与工程**
- 自有设计系统：`--lake-*` 令牌、`ln-*` 原语、CSS `@layer` 层序、WCAG 对比度门禁
- 桌面 / 移动端两套独立 UI 层，共享 `src/core` 领域逻辑
- 全库 vitest + 类型检查 + UI/样式/构建门禁

## 技术栈

- 桌面：Electron 44.9、React 18.3、TypeScript 5.9、Vite 8、better-sqlite3 13
- 移动：Capacitor 8（Android）、Vite、原生 Kotlin 插件（文件 / 安全存储 / 快捷键 / 分享）
- 编辑器：`@dlient/lakex-doc-react`（本地私有引入，内含语雀 Lakex 内核 v1.99.0；不随仓库分发）、`@univerjs/*` 1.0.3（精确锁）、Drawnix、perfect-freehand
- 同步：`@aws-sdk/client-s3`、七牛 Kodo（S3 兼容）
- 其它：sharp（图片转换）、unpdf（PDF 文本）、write-excel-file（Excel 导出）

## 目录结构

```text
.
├── electron/                 # 主进程：窗口/协议/IPC/S3/同步编排/AI/资源服务
├── src/
│   ├── core/                 # 两端共享的领域逻辑（禁止 node: 导入）
│   ├── components/           # 桌面 React 组件
│   ├── features/             # 编辑器、表格、多维表、画板、小记、AI…
│   ├── desktop/              # 桌面外壳
│   ├── mobile/               # Android / Capacitor 端（mb-* 独立 UI 层）
│   ├── hooks/ · lib/ · styles/
│   └── ...
├── android/                  # Capacitor Android 工程（Kotlin 插件）
├── vendor/lakex-doc-react/   # 私有：Lakex 编辑器（不入库；npm run setup:lakex 恢复）
├── scripts/                  # 构建、门禁、e2e、样式/移动端审计、同步工具
├── docs/                     # 交接与规格（见下方「文档」）
└── build/ · public/          # 图标、启动资源、字体
```

## 数据与存储

**应用标识**

- 桌面 appId：`com.locallakexnotes.desktop`
- Android applicationId / 包名：`com.locallakexnotes.mobile`

**本地数据目录**

| 用途 | 路径 |
| --- | --- |
| 开发数据 | `~/Library/Application Support/local-lakex-notes-dev` |
| 正式数据 | `~/Library/Application Support/local-lakex-notes` |
| 日志 | 对应数据目录下 `logs/local-lakex-notes.log` |
| Android 数据 | 应用私有目录（SQLite + 正文文件） |

> ⚠️ 正式数据目录只属于你本人；开发/测试请用 `LAKE_USER_DATA` 覆盖到独立目录，**不要触碰正式数据**。

**S3 同步**

- 对象前缀默认 `local-lakex-notes`；清单为单文件 manifest，资产按清单声明的差集同步
- 同步顺序：先拉远端（带冲突判定）→ 再推合并后的本地
- 关闭云同步 = 完全没配置（任何路径不出网）

## 环境要求

- **Node.js 24**（必须；低版本 Vite 8 会失败）
- npm、macOS（桌面端）、Android SDK + JDK 21（移动端）
- macOS 打包建议 Xcode Command Line Tools
> ⚠️ 本仓库**包含**语雀闭源 Lakex 内核（`vendor/lakex-doc-react/`、`public/vendor/lakex-doc/`、`public/vendor/lakex/`，vendored）。本项目**未取得**语雀/蚂蚁的授权，公开分发属自担风险；如权利人提出要求，将停止分发并移除相关资源。详见 `NOTICE`。

```bash
export PATH="$HOME/.nvm/versions/node/v24.18.0/bin:$PATH"
node -v   # v24.x
```

## 安装依赖

本仓库已包含语雀闭源 Lakex 内核（vendored 在 `vendor/lakex-doc-react/`、`public/vendor/lakex-doc/`、`public/vendor/lakex/`），直接安装即可：

```bash
cd <repo>
npm install
```

维护者可用 `npm run backup:lakex` 把三处内核产物导出为仓库外归档（默认 `../private/lakex-private-<stamp>.tar.gz` + `.json` 元数据），用于备份或换机恢复；`npm run setup:lakex` 可从该归档恢复。

## 本地开发

```bash
npm run dev          # Vite(1421) + Electron（CDP 9222）
```

- 本地资源服务：`http://127.0.0.1:19876`
- 移动端浏览器预览（仅 UI / 纯 DOM 逻辑，原生桥降级）：

```bash
bash scripts/mobile-preview.sh          # http://127.0.0.1:1422/preview.html
```

Android 模拟器调试见 `docs/DEVELOPMENT.md` 与 `docs/MOBILE-TECH-STACK.md`；设备级截图必须用 `adb exec-out screencap -p`。

## 测试与门禁

每次改动至少跑（约 20s）：

```bash
npx tsc --noEmit
npx vitest run
git diff --check
```

样式 / 构建门禁：

```bash
node scripts/ui-metrics.mjs
npm run check:core
npm run check:mobileui
npm run check:bundle
```

视觉与移动端设备门禁按改动范围定点跑（完整口径见 `docs/HANDOFF.md` §3#21、`AGENTS.md` §3#21）。

## 构建

### 桌面（macOS）

```bash
npx vite build
./node_modules/.bin/electron-builder --mac   # release/*.dmg / *.zip / *.app
```

当前为**未签名、未公证**的本地构建；分发给他人需 Apple Developer 签名 + 公证（见 `docs/RELEASE.md`）。

### Android

```bash
bash scripts/android-build.sh --sync           # 构建 debug APK
bash scripts/android-build.sh --sync --install # 构建并安装到已连接设备
```

当前只产出 **debug 签名**的 APK；正式发布需要 release keystore 与 `assembleRelease`（尚未配置）。

## 打包与发布

- 推荐用 **GitHub Actions** 发版：打 tag（如 `v0.1.2`）后自动构建并发布 macOS `.dmg/.zip`、Windows `.exe`、Android `.apk` 到 GitHub Releases；配置 `GITEE_TOKEN` 后同步上传 Gitee 发行版
- 也可本地打包：`npx vite build && npx electron-builder --mac`（Windows 包建议交给 CI 的 `windows-latest`；Linux target 尚未配置）
- ⚠️ 构建产物**包含闭源 Lakex 内核**（仓库已 vendored）；公开分发（Release 附件）前请确认你接受相应风险，详见 `NOTICE`
- 当前为**未签名**构建：macOS 首次打开需右键 → 打开；Windows 会弹 SmartScreen，需「更多信息 → 仍要运行」
- 签名/公证流程与 Actions 发版指南见 `docs/RELEASE.md`；不提供自动更新，下载后手动替换

## 文档

| 文档 | 内容 |
| --- | --- |
| [docs/HANDOFF.md](docs/HANDOFF.md) | **唯一交接文档**：当前状态 / 待办 / 踩坑 |
| [AGENTS.md](AGENTS.md) | **长期红线与机制**（会话启动必读） |
| [docs/PRODUCT.md](docs/PRODUCT.md) · [docs/DESIGN.md](docs/DESIGN.md) | 产品定位 / 设计系统（令牌、层序、组件规范） |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | 进程结构、关键文件、数据流 |
| [docs/SYNC-PROTOCOL.md](docs/SYNC-PROTOCOL.md) · [docs/S3-GC-DESIGN.md](docs/S3-GC-DESIGN.md) · [docs/STORAGE-LAYERS.md](docs/STORAGE-LAYERS.md) | 同步协议 / GC / 存储分层 |
| [docs/LAKEX-CONTRACT.md](docs/LAKEX-CONTRACT.md) | 闭源 Lakex 内核已核实行为 + 调试速查 |
| [docs/USHEET-UPGRADE.md](docs/USHEET-UPGRADE.md) | Univer 表格触点、升级 playbook、能力路线 |
| [docs/MOBILE-TECH-STACK.md](docs/MOBILE-TECH-STACK.md) · [docs/MOBILE-DESIGN.md](docs/MOBILE-DESIGN.md) | 移动端架构与设计 |
| [docs/MOBILE-AI.md](docs/MOBILE-AI.md) | 移动端 AI 设计与实施契约（资料集 / 预算 / 原生通道 / 分期） |
| [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) · [docs/CODEX-GUIDE.md](docs/CODEX-GUIDE.md) · [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) | 环境/命令 / CDP 驱动指南 / 排错 |

## 数据与隐私

- 无账号、无云端登录；数据默认只在本机
- S3 凭证保存在本机（桌面 safeStorage / Android Keystore），不会写入正文或日志
- 迁移码内层加密仅用于防误读，**不是安全边界**；不要外传
- 仓库内不含任何真实笔记数据或密钥

## 许可与致谢

- 本项目自有代码采用 **AGPL-3.0-only**（见根目录 `LICENSE`）；第三方组件与例外见 `NOTICE`
- 语雀 Lakex 编辑器内核为闭源第三方产物，**以 vendored 形式包含在本仓库中**；该内核不属于本项目版权，不能由本项目按 AGPL 再授权。本项目未取得语雀/蚂蚁的授权，公开分发风险由分发者承担；权利人要求时将移除相关资源（见 `NOTICE`）
- 部分界面版式与主题令牌参考自 **SiYuan（思源笔记，AGPL-3.0）**；相关规则收编在 `src/styles/compat.css` / `kit.css`，署名保留在应用设置页「关于」与文件头
- 表格：[Univer](https://github.com/dream-num/univer)（Apache-2.0，1.0.3 精确锁）
- 画板：[Drawnix](https://github.com/plait-board/drawnix)
- 图标：[Lucide](https://lucide.dev)（ISC）
- 字体：MiSans（小米，MiSans 字体许可）· JetBrains Mono（SIL OFL 1.1）
- 参考：语雀 Lakex 编辑器官方文档（`yuque-developer-docs`）

## 免责声明

本项目是个人使用的非官方工具，与语雀 / 蚂蚁集团无关；不提供任何服务可用性、数据安全或兼容性保证。使用前请自行备份重要数据。
