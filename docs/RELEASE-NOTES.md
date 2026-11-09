# LakexLocalNotes 发布说明

> v1.1.0 → v1.0.0 倒序合集。各版本标题与正文保持原样；原五份独立发布说明已合并（独立文件删除，git 可查）。

---

# LakexLocalNotes v1.1.0

两个新空间：**AI 写作**（桌面）与**日记**（桌面 + Android）。

## AI 写作（桌面，⌘3）

- 新增独立空间：左栏「新对话 + 历史记录（按今天/昨天/更早分组，可重命名与删除）」，主区分「对话写作 / 多文档推理」。
- 提示词库 6 张卡（点卡 = 挂成输入卡上的 chip，不写正文）；多文档可「按时间快捷组」或「按笔记本勾选」，chip 显示「N 篇文档」。
- 深度思考默认开启且不提供关闭入口；思考内容与正文分开显示，都不进上下文。
- 答案用 Lake 内核只读视图渲染：任务清单、表格、引用、代码、行内与块级公式都按内核原生解析；生成中先走轻量 Markdown，收尾无缝切成富文本。
- 「生成文档」只选到笔记本（不选目录），「保存到小记」落成小记卡片。
- 会话与消息只存本机，**不进同步、不进搜索、不进目录树**；模型使用你已有的 AI 供应商配置，未配置时页面给引导。

## 日记（桌面 ⌘4 · Android 首页第 4 个 tab）

- 新增独立空间，**数据仍是普通文档**：一本"日记"笔记本 + 标题就是日期 +「年 → 月」分组自动收纳。历史快照、回收站、全文搜索、导出、云同步全部沿用文档那一套，不新建数据结构。
- 写今天 / 翻历史 / 日记内搜索（复用全库搜索并按日记范围收窄，不新增索引）。
- **转为文档**：右键（Android 在条目操作入口）把某一天的日记移到任意笔记本，成为正式文档；正文与历史跟着走，不复制。
- 日记不打标签；v1 不做缺天提醒、补写任意日期、月历视图。

## 同步与数据

- lake 索引新增 `folders[].space`（日记本标记）：发布时显式写（非日记写 null），未知值按非日记处理，坏端写的 group+space 会被就地归一。
- 移动端 SQLite schema 11 → 12（新增 `folders.space`），版本门按既有方式 +1。
- 便携包与整库备份保留日记标记（快照天然带列）。

## 修复

- 修复移动端便携包导入丢失日记标记：导入后日记本曾降级成普通笔记本、再点「写今天」会建出第二本。
- 修复移动端日记页数据源缺 notes 行（页内曾恒为空、日记内搜索恒 0 命中）。
- 移动端「多个日记本」按契约取第一个并告警，不再静默。

## 验证

- `tsc` 0 错；vitest **818 文件 / 5148 通过 / 11 skipped / 0 failed**；ui-metrics、check:core、check:mobileui、diff-check 通过。
- 桌面与移动两条 `vite build` 通过。设备级门禁（移动 6 态 + 23 屏走查、桌面 42 态）未随本版重跑，见 `docs/HANDOFF.md` §3。

## 升级说明

- Android：自 v1.0.2 起同一 release keystore 可直接覆盖升级（保留数据）；本版 `versionName 1.1.0` / `versionCode 11100`。
- 日记与 AI 写作都是**新增**能力，不改动既有数据形态：升级后原有文档/小记/标签/同步状态不受影响；移动端首次启动会做一次 schema +1。

# LakexLocalNotes v1.0.5

应用内更新中心 + 桌面到手机的便携迁移。

## 更新中心

- 桌面与 Android 新增应用内更新中心：默认自动检查、默认自动下载（Android 仅 Wi-Fi），稳定版 only，不静默安装。
- 更新清单只认 GitHub latest release 的 latest.json；下载校验 sha256，Android 另验 release 证书。
- 桌面是独立「更新」设置页；Android 设置菜单「更新中心」放在「关于」上方。
- 更新日志与 GitHub Release 正文同源，均来自本文件。

## 便携迁移

- 桌面可导出单个 .zip.lln 便携包（≤4GiB，不含历史快照），手机导入覆盖本机全部笔记、小记、标签与回收站。
- 不需要先配置云同步；导入后配置 S3 仍按基线做增量同步。
- 只接受 .zip.lln，不再兼容旧 .zip。

## 移动端设置

- 恢复「灰底 + 白卡」层次；设置顺序按桌面重排，云端、备份、关于按语义分组。
- 设置页动作按钮统一为主题色描边；更新中心位于关于上方。

## 同步与修复

- 修复桌面文件夹发布后 is_dirty 未清除、移动端回收站目录被同步上传等问题。
- 3.0GiB 合成便携包完成导入与 S3 接续验证。

## 验证

- tsc / diff-check 通过；vitest 4995 通过、12 跳过（2 个性能护栏在并行负载下抖动，非功能失败）；移动端快照扩到 9 态并连续两轮 0 差异。
- Android APK 使用正式 release keystore 签名，versionName 1.0.5 / versionCode 11005。

## 升级说明

- **Android**：v1.0.2 起使用同一正式 release keystore，可直接覆盖安装；从 v1.0.1 或 debug 签名版升级需先备份并卸载旧包（卸载会清本机数据）。
- **macOS**：ad-hoc 签名、未公证；首次打开若被拦截，到「系统设置 → 隐私与安全性 → 仍要打开」。
- **Windows**：未签名；SmartScreen 提示时选「更多信息 → 仍要运行」。
- **更新中心**：本版起可在应用内检查更新；Android 自动下载仅 Wi-Fi，安装仍需系统确认，不会静默安装。
- **便携包**：只接受 .zip.lln；旧 .zip 不再兼容。升级前建议先做一次整库备份或便携包导出。

---

# LakexLocalNotes v1.0.4

移动端顶栏与手写板体验修复。

## 移动端

- 顶栏左右统一 16px 页边距，`知识库` 不再换行；窄屏优先保证三枚 tab 完整可见。
- Sheet / 全屏标签页头部、状态条右内距统一收口到 16px。
- 手写板移动端导航新增「新建页」按钮。
- 阅读态手写板支持左右滑动翻页（横向 ≥60px 且横向占优，纯视图不写正文）。
- 手写板页码固定单行（`3 / 3` 不再折成两行）。

## 其它平台

- Android APK 继续使用正式 release keystore 签名（versionName 1.0.4 / versionCode 11004）。
- macOS x64 + arm64 ad-hoc 签名（未公证，首次打开走「仍要打开」）。
- Windows NSIS 安装包不变。

## 验证

- 全量 vitest / tsc 通过；移动端 6 态快照两轮 0 差异；平板 6 态 0 差异。
- 真机/模拟器验证顶栏、手写板新建页、只读滑动翻页与页码单行。


---

# LakexLocalNotes v1.0.3

本版无业务功能变更，用于验证 GitHub → Gitee 的发布链路。

## 发布

- GitHub Release：mac x64/arm64 dmg+zip、Windows NSIS、Android APK 全量。
- Gitee Release：只同步 Android APK（Gitee 单附件上限 100MB，mac/Windows 包超限）。
- Gitee Release 说明中包含 GitHub Release 链接，mac/Windows 用户从 GitHub 下载。

## Android

- 继续使用正式 release keystore 签名；证书 SHA-256：
  `A8:BA:87:F7:F7:A5:E0:68:71:CB:CF:4E:EF:10:78:A0:38:01:E2:B5:B6:DD:3C:82:55:51:6A:B5:CF:21:2E:35`
- versionName 1.0.3 / versionCode 11003。
- 从 v1.0.1（debug key）升级仍需卸载重装；v1.0.2 及以后同 key 可正常覆盖升级。

## macOS / Windows

- macOS x64 + arm64，ad-hoc 签名未公证；首次打开走「隐私与安全性 → 仍要打开」。
- Windows 未签名，SmartScreen 提示时选「更多信息 → 仍要运行」。

## 验证

- 全量 vitest / tsc / 设备快照保持绿。
- CI 检查 Android APK 非 debug、非 debuggable，指纹与 release keystore 一致。


---

# LakexLocalNotes v1.0.2

Android 正式签名版；macOS 保持 x64 + arm64 双架构。

## Android（重要）

- APK 改用 **正式 release keystore** 签名（不再使用 debug keystore）。
- 证书 SHA-256：`A8:BA:87:F7:F7:A5:E0:68:71:CB:CF:4E:EF:10:78:A0:38:01:E2:B5:B6:DD:3C:82:55:51:6A:B5:CF:21:2E:35`
- **从 v1.0.1 升级必须卸载旧包再安装**：v1.0.1 是 debug key 签名，签名不同不能覆盖安装；卸载会清本机数据，请先备份。
- 之后所有版本都用同一 key，可正常覆盖升级；keystore 必须离线备份，丢失后无法覆盖升级。

## macOS

- x64 + arm64 两份 dmg/zip。
- ad-hoc 有效签名，未公证；首次打开走「系统设置 → 隐私与安全性 → 仍要打开」。
- Intel 下 x64，Apple Silicon 下 arm64。

## Windows

- NSIS 安装包不变。

## 验证

- 本地 release APK `apksigner verify --print-certs` 指纹与 keystore 一致；aapt 断言非 debuggable。
- 全量 vitest / tsc / 设备快照保持绿。


---

# LakexLocalNotes v1.0.1

修复 v1.0.0 macOS 包打不开的问题，并补齐 Intel Mac 支持。

## macOS

- **x64 + arm64 两份安装包**（Intel / Apple Silicon 分别下载）
- 采用 **ad-hoc 有效签名**（关闭 hardened runtime），不再被 macOS 误判为「已损坏」
- **未做 Apple 公证**：首次打开可能提示「无法验证开发者」，按系统提示到  
  **系统设置 → 隐私与安全性 → 仍要打开** 即可；也可右键 → 打开
- 如仍被 quarantine 拦截，可执行：
  ```bash
  xattr -dr com.apple.quarantine /Applications/LakexLocalNotes.app
  ```
- 若需要分发时双击即开、无任何提示，必须使用 Apple Developer ID 证书签名并公证（后续版本可接入）。

> 未使用 universal 单包：sharp 的 arm64/x64 原生依赖在 universal 合并时会冲突，分架构打包更稳定。

## 其它平台

- Windows NSIS 安装包、Android release APK 与 v1.0.0 一致（Android versionCode 11001）。
- 功能与 v1.0.0 相同，无业务行为改动。

## 验证

- 全量 vitest 774 文件 / 4940 例通过；tsc 0。
- 设备快照：手机 6 态、平板 6 态、多维表 3 态均两轮 0 差异。
- macOS 打包冒烟（arm64）通过；x64 本机构建验证通过。


---

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
- UI 回归记录（历史文档已随文档清理删除，git 可查）：桌面/手机/平板 + S3 跨设备/冲突/附件。

## 已知限制

- GitHub Actions macOS 产物未签名/未公证，首次打开需右键 → 打开；正式分发需按 `docs/RELEASE.md` 配置 Apple 证书。
- Android CI 产物为 release 变体但用 debug keystore 签名（`debuggable=false`）；正式商店分发需换 release keystore。
- 真实第三方 Android 分享面板、Android 文件选择器仍需人工验证；桌面原生选择器已由 dev-only 测试钩子覆盖自动化回归。
- AI 默认关闭，需在设置中开启并配置供应商 Key。

