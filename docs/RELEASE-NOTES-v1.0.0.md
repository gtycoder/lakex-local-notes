# LakexLocalNotes v1.0.0

首个 1.0 正式版。本地优先、无账号依赖：笔记、表格、多维表、画板、手写板、小记全部保存在本机，S3 只做多端镜像。

## 核心能力

- 桌面 macOS（Electron）+ Android（Capacitor）双端；共享 `src/core` 领域逻辑，两端 UI 独立。
- Lakex 富文本、Univer 表格、自研多维表、Drawnix 画板、手写板（含图片页/PDF/导出）。
- 小记时间线、标签、转正式文档；文档标签与标签空间/筛选；标签目录与文档关系已统一存入小记库。
- 目录树多选：桌面 ⌘/Ctrl + Shift、移动端长按；批量移动/复制/打标签/回收站。
- 全文搜索、历史快照、回收站软删+恢复、附件/图片管理、整库备份与从备份恢复。
- S3 v3 同步：本地真相、删除=缺席、冲突留档、按文档资产声明差量传输、跨设备同步。
- 设置搜索、数据维护/体检、资源管理、同步诊断、AI 助手（默认关，Key 只在主进程）。

## 验证

- 全量 vitest：774 文件 / 4939 例通过（11 skipped，共 785/4951）。
- tsc / core 边界 / ui-metrics / mobileui / bundle / arch / 双端 build 全绿。
- 设备快照：手机 6 态、平板 6 态、多维表 3 态均连跑两轮 0 差异。
- UI 回归记录见 `docs/REGRESSION-261108.md`（桌面/手机/平板 + S3 跨设备/冲突/附件）。

## 已知限制

- GitHub Actions macOS 产物未签名/未公证，首次打开需右键 → 打开；正式分发需按 `docs/RELEASE.md` 配置 Apple 证书。
- Android CI 产物为 release 变体但用 debug keystore 签名（`debuggable=false`）；正式商店分发需换 release keystore。
- 真实第三方 Android 分享面板、Android 文件选择器仍需人工验证；桌面原生选择器已由 dev-only 测试钩子覆盖自动化回归。
- AI 默认关闭，需在设置中开启并配置供应商 Key。
