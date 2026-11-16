# Android 卸载保留数据（261117 用户点单）

> 需求：**卸载不删除资源，重装还在**；或至少卸载时给一次明确提示。
> 本文 = 实现与限制的唯一来源；调研任务（task-34）若给出不同结论，以本文件末尾「调研结论对齐」小节合并，**不要另立第二份文档**。
> 相关代码：`android/app/src/main/AndroidManifest.xml`、`src/mobile/settings/BasicSettingsSections.tsx`（关于页提示）、
> 护栏 `src/mobile/settings/uninstallData.test.ts`。

## 0. 结论（一句话）

用 Android 官方属性 `android:hasFragileUserData="true"` 打开系统级「卸载时保留应用数据」，
**不启用 Auto Backup**（限额/隐私/恢复不可控），并在设置「关于」页常驻一条「卸载前先备份」的引导
（便携包 / 云同步两个出口）。**系统卸载对话框的「保留应用数据」选项只在 Android 10（API 29）及以上、
且从系统卸载对话框（应用详情 / 启动器卸载确认）卸载时出现**；Android 9 及以下没有该能力，
桌面长按图标直接拖走或 `adb shell pm uninstall` 也不会弹出。

## 1. 做了什么

### 1.1 manifest（Android 10+ 保留数据）

`android/app/src/main/AndroidManifest.xml` 的 `<application>` 增加：

```xml
android:allowBackup="false"        <!-- 保持原值（理由见 §3） -->
android:hasFragileUserData="true"  <!-- 261117：Android 10+ 系统卸载对话框给「保留应用数据」 -->
```

- 语义：勾选「保留」后系统**保留该应用的私有数据目录**；用同一包名重装时数据仍在（无需额外代码）。
- 兼容性：API 29 以下系统**忽略**该属性，不会报错、不影响安装。
- 不引入任何新依赖、新权限、新进程；合并后的 manifest 由构建产物校验（§4）。

### 1.2 设置页引导（关于 → 卸载与换机）

`src/mobile/settings/BasicSettingsSections.tsx` 的「关于」页新增一组常驻说明（不弹窗、不打断）：
- 卸载会删除本机的正文/附件/索引；云同步只是镜像，未同步的改动会一起丢失；
- 备份出口：桌面版「备份与恢复 → 导出便携包」或先确认云同步完成；
- 说明 Android 10+ 系统卸载对话框的「保留应用数据」选项与其出现条件；
- 说明为什么没有启用 Google 云备份（见 §3）。

## 2. 为什么需要这层

移动端数据全部在本机（正文/小记/历史 = App 私有目录文件，SQLite 只存元数据/账本/派生索引，见 AGENTS §4），
S3 是镜像不是备份。卸载 = 系统删除 App 私有目录 ⇒ **没同步过的内容不可恢复**（回收站/历史也在该目录内）。
Android 官方给「保留数据」只有一个开关（`hasFragileUserData`），没有「卸载时弹我们自己的窗」这条路径
（卸载前进程已被杀，无法运行代码）⇒ 实现 = 官方属性 + 应用内提前引导。

## 3. 为什么**不**启用 Auto Backup（`allowBackup` 保持 false）

保持 `android:allowBackup="false"`，因此也不配置 `android:fullBackupContent` / `android:dataExtractionRules`
（没有备份就不需要规则；若将来启用，必须在此补规则与隐私说明）。理由三条：

1. **限额不匹配**：Auto Backup 每应用配额约 **25MB**；本仓目标量级是 2 万文档 / 20 万附件，正文与附件常在
   百 MB～GB 级 ⇒ 备份必然被截断或整体失败，表现为「看起来备份了、恢复时缺文件」。
2. **隐私与语义**：Auto Backup 会把 App 私有数据传到用户的 Google Drive；我们的正文**不做云端加密**
   （与 S3 同一口径），用户对「系统自动备份」没有知情同意，且这条链路完全绕过应用的网络开关
   （`canTouchNetwork()` 语义被打破）。
3. **恢复不可控**：Auto Backup 只在「同账号首次安装」时自动恢复，恢复时机/完整性不承诺，且无法与
   S3 同步、便携包导入合并出确定结果；真出问题时排障成本高于收益。

真正的迁移出口 = **云同步（S3 镜像）** 与 **桌面导出便携包 → 手机导入**（`PortableImportSection`），
两者都是显式、可验证、可排障的路径。

## 4. 验证（构建产物 + 设备，261117 实机）

### 4.1 构建/安装

```
bash scripts/android-build.sh --sync --install
  vite build ✓ / cap sync ✓ / gradle BUILD SUCCESSFUL ⇒ APK 37,362,178 bytes
  adb install -r → Success；am start com.lakexlocalnotes.android
adb shell dumpsys package com.lakexlocalnotes.android
  versionCode=11301 versionName=1.3.1 minSdk=24 targetSdk=36 lastUpdateTime=2026-11-16 18:32
```

targetSdk=36 / minSdk=24 ⇒ 目标设备几乎都在 Android 10+（API 29），`hasFragileUserData` 会生效。

### 4.2 解包 APK 校验合并后的 manifest

`aapt2 dump xmltree --file AndroidManifest.xml android/app/build/outputs/apk/debug/app-debug.apk`：

```
E: application (line=35)
  A: ...:allowBackup(0x01010280)=false
  A: ...:hasFragileUserData(0x0101059a)=true
```

同时校验：
- gradle 合并产物 `android/app/build/intermediates/merged_manifest/debug/processDebugMainManifest/AndroidManifest.xml`
  第 36 行 `android:allowBackup="false"`、第 41 行 `android:hasFragileUserData="true"`；
- APK 内**没有**任何 backup / extraction 规则资源（`unzip -l | grep backup` 为空）——
  与 §3「不启用 Auto Backup」一致。

### 4.3 设备上的设置页提示

- CDP（`emu-cdp.sh 9336` + `drive.mjs`）实机 DOM 实测「设置 → 关于」页出现
  「卸载与换机 / 卸载前请先备份」整组文案（含「Android 10 及以上…保留应用数据」「便携包」「25MB 限额」）。
- 设备级截图：`/tmp/uninstall-data/01-settings-about-uninstall.png`（1080×2400，adb screencap；
  拍摄内容 = 关于页「卸载与换机」组 + 其下「数据诊断」）。
- 验证后已把 App 退回首页，未在设备留测试数据。

### 4.4 未能在本机验证的部分（如实说明）

- **系统卸载对话框本身**：本机只能跑「安装/更新」，不能在自动化里真正走「设置 → 应用 → 卸载 → 勾选保留 →
  重装」全流程（卸载后 App 消失，重装会重置自动化环境；且模拟器策略可能裁剪该对话框）。
  ⇒ 该属性是否生效以 **APK 合并 manifest + 系统 API 语义**为据；冒烟建议：真机/模拟器手动
  「应用信息 → 卸载 → 勾选保留应用数据 → 重装 → 打开」一次，确认数据仍在。

## 5. 回归护栏

`src/mobile/settings/uninstallData.test.ts`（源码断言，防以后被合并覆盖/被清理）：
- manifest 必须有 `android:hasFragileUserData="true"`；
- `allowBackup="false"` 且**不得**出现 `fullBackupContent` / `dataExtractionRules`（启用备份必须同步改本文件 §3）；
- 「关于」页必须保留「卸载与换机」引导文案（含「保留应用数据」与「便携包」）；
- 本文件必须存在且写明 `hasFragileUserData` 与 Android 10 限制。

## 6. 调研（task-34）：官方能力、思源做法、方案排序与验收

### 6.0 一页结论（先看这段）

- 官方能让「卸载后数据还在」的**只有两条路**：① `android:hasFragileUserData`（API 29+，系统卸载对话框里勾「保留应用数据」）；② Auto Backup（Google Drive，25MB/账号/隐私）。其余（外置存储、SAF、MediaStore、`adb uninstall -k`）都**不是**「卸载自动保留 App 私有数据」。
- 本仓已落地的 **A（hasFragileUserData）+ C（应用内引导）与调研结论一致**；**不启用 Auto Backup 的决定成立**，本节补上官方机制证据（§6.2）。
- 需要修正/收敛的 3 处措辞（不影响已实现结论）：**「启动器拖拽卸载不弹」未证实**、缺「重装需同签名」、缺「Android 10 + 便携 SD 已知崩溃」→ §7。
- 置信度：属性/备份机制语义 = **高**（官方文档 + AOSP）；安装器/OEM 差异 = **中**（社区证据）；系统卸载对话框本身 = **待真机实测**（§6.7）。

### 6.1 `android:hasFragileUserData`（已采用）

| 项 | 事实 | 证据 |
| --- | --- | --- |
| 官方语义 | "If true the user is prompted to keep the app's data on uninstall." | developer.android.com/guide/topics/manifest/application-element#fragileuserdata |
| 起始版本 | API 29（Android 10）新增 | developer.android.com/reference/android/R.attr#hasFragileUserData |
| 机制 | 勾选保留 ⇒ PackageInstaller 以 `DELETE_KEEP_DATA` 卸载 ⇒ 保留 App 私有数据目录 | AOSP `PackageManager.java`：`DELETE_KEEP_DATA` 注释「don't want to delete the package's data directory」（api.github.com/repos/aosp-mirror/platform_frameworks_base/contents/core/java/android/content/pm/PackageManager.java） |
| 生效路径 | **只有走系统 PackageInstaller 卸载确认 UI 的路径**（设置→应用信息；启动器卸载菜单/拖拽一般也走 `ACTION_DELETE`/`ACTION_UNINSTALL_PACKAGE`）才会出现勾选框；`adb`/`pm uninstall`（无 `-k`）、静默卸载、Play 商店自有卸载流程不出现 | 社区逆向 gist（gist.github.com/agnostic-apollo/58def38fdb1c90563454974108ae52df）；启动器路径**待实测** |
| 勾选后的副作用 | ① 包进入 **semi-uninstall**：仍出现在设置应用列表，可再次卸载彻底清除；② **重装必须同签名**，否则 `INSTALL_FAILED_UPDATE_INCOMPATIBLE` | 同上 gist；AOSP `ApplicationInfo.hasFragileUserData()`（`@SystemApi`） |
| Android 10 已知缺陷 | Android 10 + **可移除 SD 卡设为便携存储**时，勾选保留会触发 PackageInstaller 崩溃、卸载失败；Android 11 修复 | issuetracker.google.com/issues/148573843（gist 记录）；KernelSU PR #3005 讨论亦记录 A11 以下异常 |
| 版本覆盖 | 仅 API 29+；本仓 minSdk 24（`android/variables.gradle:2`）⇒ **API 24–28 用户没有该选项**，卸载静默删数据 | 本仓 `android/variables.gradle:2`；官方 API 29 起始 |
| 隐私 | 无影响（数据不出设备） | — |
| 本仓现状 | `AndroidManifest.xml:13-14`：`allowBackup="false"` + `hasFragileUserData="true"`；护栏 `src/mobile/settings/uninstallData.test.ts:16-17` | 本仓文件 |

**签名约束是本仓最真实的坑**：CI 用 `ANDROID_KEYSTORE_BASE64` 注入正式 keystore（`.github/workflows/release.yml:105-112`），本地未配置时回退 debug 签名（`android/app/build.gradle:20-62`）⇒ ① 本地 debug 包与 CI release 包互相覆盖安装会因签名不同失败；② 将来**轮换 keystore** 会让旧「保留数据」再也无法被新包读取（只能彻底卸载后重装，数据即删）。发布检查清单应加一条。

### 6.2 Auto Backup（不采用；官方机制补充）

| 项 | 事实 | 证据 |
| --- | --- | --- |
| 默认参与 | target API 23+ 自动参与；`allowBackup` **默认 true**，设 false 才退出 | developer.android.com/identity/data/autobackup |
| 数据去向/限额 | 用户 Google Drive **私有文件夹**，每应用 **≤25MB**，不计入个人 Drive 配额；Android 9+ 用设备锁屏凭据做端到端加密 | 同上 |
| 规则格式 | API 30 及以下：`fullBackupContent`；target 31+ 且 Android 12+：`dataExtractionRules`（`<cloud-backup>` 与 `<device-transfer>` 分开；Android 16 QPR2/API 36.1 新增 `<cross-platform-transfer>`）。一旦指向新配置，Android 12+ **忽略** `fullBackupContent` | developer.android.com/about/versions/12/behavior-changes-12；autobackup 文档 |
| 备份域 | `root` / `file` / `database` / `sharedpref` / **`external`（getExternalFilesDir）**；默认「几乎全部 app 文件」，写 `<include>` 后变白名单 | autobackup 文档（XML 语法） |
| 超限行为 | 超过 25MB 会触发 `onQuotaExceeded()`（备份无法完整完成）；官方文档未明确「部分成功」语义，需实测 | autobackup 文档（排除示例即「导致应用超过 25MB 配额的大型文件」） |
| 恢复条件 | 同 Google 账号 + 系统备份开启 + 屏幕锁；云恢复与 D2D（`device-transfer`）分开；`adb` 或自更新安装器是否触发恢复**未证实** | autobackup 文档；developer.android.com/studio/preview/backup-restore-testing.md.txt；**待实测** |
| 结论 | 与 §3 三条理由一致：2 万文档/20 万附件必然超 25MB；正文不加密却上云，绕过 `canTouchNetwork()`；恢复时机与 S3 基线/便携包导入不可合并。**维持 `allowBackup="false"`** | 本文件 §3 |

补充：若只想备份极少量设备本地设置，可用 `<include>` 白名单做「仅设置备份」，但会引入「恢复后设置与数据不一致」的新状态，收益 < 复杂度 ⇒ 不做。

### 6.3 外置存储 / SAF / MediaStore / `adb uninstall -k`（哪个卸载才留存）

| 位置 | 卸载时 | 证据 |
| --- | --- | --- |
| App 私有内部（`Directory.Data` / SQLite） | **删** | 官方 app-specific storage 文档；本仓正文/附件在 `Directory.Data`（`src/core/noteBodyPaths.ts:4`） |
| App 私有外置 `getExternalFilesDir()`（`/sdcard/Android/data/<pkg>/files`） | **删**（与内部同口径） | 官方 app-specific storage 文档（「卸载应用后，系统会移除这些目录中存储的文件」） |
| 共享存储（`/sdcard/Documents`、Pictures、Download；SAF/MediaStore 创建的文件） | **留存**（属用户文件；官方建议「希望独立于应用保留的内容写共享存储」） | developer.android.com/training/data-storage/app-specific；shared/documents-files |
| SAF 树授权（`takePersistableUriPermission`） | 文件留存；**授权随卸载清除**，重装后需用户重新选择 | developer.android.com/training/data-storage/shared/documents-files |
| `adb uninstall -k` | 保留 `/data/data` 数据与 cache（本机 `adb help`：`'-k': keep the data and cache directories`，platform-tools 37.0.1）；等价 `pm uninstall -k`，与 `DELETE_KEEP_DATA` 同语义 | 本机 `adb help`；AOSP `PackageManager.java`（`DELETE_KEEP_DATA`） |

**本仓已具备的能力**：`OpenFilePlugin.saveAs`（`android/app/src/main/java/com/lakexlocalnotes/android/OpenFilePlugin.kt:101`）——图片走 MediaStore Pictures（`:128`），其它文件走 SAF `ACTION_CREATE_DOCUMENT`（`:162`）。**这使 D 方案（导出到用户可见位置）成本显著低于从零实现**。

### 6.4 思源移动端实际做了什么（file:line）

> 仓库 `siyuan-note/siyuan-android`（main，2026-11-16 提交 `96e1df6d`，版本 3.8.11-alpha.6）。**本机 `/Users/admin/file/local-lake/siyuan-android-main` 是旧快照，不含下面两个规则文件**；引用以线上 commit 为准。

| 项 | 事实 | 证据（线上 file:line） |
| --- | --- | --- |
| `allowBackup` | **未声明** ⇒ 默认 `true`（Auto Backup 参与） | `app/src/main/AndroidManifest.xml:56-59`（application 块） |
| `hasFragileUserData` | **未使用**（全仓 grep 无）；GitHub issue 搜索 `repo:siyuan-note/siyuan hasFragileUserData` = **0 条** | 上面 manifest；api.github.com search/issues |
| `fullBackupContent` | `@xml/backup_rules` | manifest:58 |
| `dataExtractionRules` | `@xml/data_extraction_rules` | manifest:59 |
| 规则内容 | 只排除 **Markdown 目录**：`<exclude domain="external" path="home/.config/siyuan/markdown/" />`；数据提取规则在 `cloud-backup` 与 `device-transfer` 各写一次 | `app/src/main/res/xml/backup_rules.xml:1-4`、`data_extraction_rules.xml:1-9` |
| 规则引入时间 | commit `0086a5ce3a`（2026-11-03，「Store Markdown data under the shared home」） | api.github.com commits?path=… |
| 数据目录 | `appDir = getFilesDir()/app`（内置 Web 资源）；`workspaceBaseDir = getExternalFilesDir(null)` ⇒ 笔记工作区在**外置 App 私有目录** `/sdcard/Android/data/org.b3log.siyuan/files` | `MainActivity.java:1085-1090` |
| 卸载提醒/引导 | **没有**。`res/values/strings.xml` 仅 22 行、无卸载/备份文案；Android 工程内无卸载提醒 UI；Web UI 里只有「插件卸载」文案 | `app/src/main/res/values/strings.xml`；本机 `siyuan-master/app/src` grep |
| 推断（标注为推断） | 默认 `allowBackup=true` + 工作区在 `external` 域 ⇒ 系统会尝试备份整个工作区，远超 25MB ⇒ 大概率 `onQuotaExceeded`/备份不完整；他们只排除 Markdown 子目录，**反证 `external` 域确实在默认备份集合内** | 机制组合推断，非官方文档原句 |

**对照结论**：思源走「Auto Backup 默认开 + 规则排除」路线，本仓走「`hasFragileUserData` + 关闭 Auto Backup + 应用内引导」路线。**不能照抄思源**：它的数据在 external 且体量大，Auto Backup 对其同样不可靠（且它没有卸载提醒）；另外思源同时发 Play/F-Droid，**多签名分发本身就会让 keep-data 的旧数据无法被另一个签名的包读取**（gist 记录的 Termux 同类问题），这也是本仓要避免的。

### 6.5 方案排序（成本 / 风险 / 版本覆盖 / 隐私）

| 方案 | 实现成本 | 风险 | 版本覆盖 | 隐私 | 结论 |
| --- | --- | --- | --- | --- | --- |
| **A. `hasFragileUserData`** | **极低**（1 个属性，无新依赖/权限/进程） | 中：semi-uninstall 状态、同签名约束、OEM/安装器差异、Android 10 portable-SD 崩溃 | API 29+（minSdk 24 ⇒ 24–28 无） | 无影响 | **已采用，性价比最高** |
| **C. 应用内「卸载前备份」引导** | 低（复用已有设置组与两个出口：桌面便携包 / 云同步；`BasicSettingsSections.tsx:65-78`） | 低（纯文案；写清「系统对话框才有」「云同步是镜像」即可） | 全版本 | 无影响 | **已采用**；建议补「重装需同一签名/来源」 |
| **D. 外置/SAF 导出便携包** | 中：移动端目前**只有导入**（`PortablePackagePlugin.pickAndStage:91` / `beginImport:374` / `commitImport:460`）；导出需新增 zip 打包 + 复用 `OpenFilePlugin.saveAs:101` 的 SAF/MediaStore 通道；包格式已有规格（`docs/PORTABLE-TRANSFER.md:1-30`） | 低-中：明文包（需提示）、可达 4GiB、耗时长、依赖用户手动 | 全版本 | 用户自选位置（比 Auto Backup 好） | **建议下一批**（唯一「不靠系统、卸载后可恢复」的兜底） |
| **B. Auto Backup（`allowBackup=true` + 规则）** | 低-中（2 个 XML + 规则 + 隐私说明） | 高：25MB 必然超限、恢复时机不可控、绕过网络开关、与 S3 基线/便携包导入冲突 | API 23+，但依赖账号/备份开关/系统恢复 | **高**（正文上云） | **不做**（维持 `false`） |

**排序：A（已做）→ C（已做）→ D（建议）→ B（不做）。** 附加约束：任何签名变更（keystore 轮换、商店/F-Droid 重签）都会切断 keep-data 链路，必须进发布检查清单。

### 6.6 验收方式（可复现清单）

| # | 验收项 | 方式 | 状态 |
| --- | --- | --- | --- |
| 1 | 合并后 manifest 带属性 | `aapt2 dump xmltree --file AndroidManifest.xml <apk>`；merged manifest 同值 | 已做（§4.2） |
| 2 | 源码护栏 | `src/mobile/settings/uninstallData.test.ts` | 已做（§5） |
| 3 | API 29+：勾选保留 → 重装数据在 | 真机/AVD：设置→应用信息→卸载→勾「保留应用数据」→ 同签名 APK 重装 → 数据在 | **待真机**（§4.4 已说明本机不可自动化） |
| 4 | API 29+：不勾选 → 数据消失（基线） | 同上反向 | 待真机 |
| 5 | API 28 基线：无勾选框、卸载即删 | API 28 AVD；确认不影响安装/启动 | 待真机 |
| 6 | `adb uninstall -k` 语义 | debug 包 `adb uninstall -k <pkg>` → `adb root` 后 `ls /data/data/<pkg>/files` 仍在 → 同签名 `adb install` → 数据在 | 待做（仅排障用） |
| 7 | 签名矩阵 | debug 包 vs CI release 包交叉安装应失败（`INSTALL_FAILED_UPDATE_INCOMPATIBLE`），记录为已知限制 | 待做 |
| 8 | Android 10 便携 SD 缺陷 | 本机无法复现；引用 issuetracker 148573843，作为排障知识 | 仅记录 |

### 6.7 证据清单

- 官方：`developer.android.com/guide/topics/manifest/application-element#fragileuserdata`、`reference/android/R.attr#hasFragileUserData`、`identity/data/autobackup`、`about/versions/12/behavior-changes-12`、`training/data-storage/app-specific`、`training/data-storage/shared/documents-files`、`studio/preview/backup-restore-testing.md.txt`
- AOSP：`aosp-mirror/platform_frameworks_base` → `core/java/android/content/pm/PackageManager.java`（`DELETE_KEEP_DATA`）、`core/java/android/content/pm/ApplicationInfo.java`（`hasFragileUserData()`）
- 社区：gist `agnostic-apollo/58def38fdb1c90563454974108ae52df`、issuetracker `148573843`、`KernelSU#3005`
- 思源：`siyuan-note/siyuan-android@96e1df6d` 的 `app/src/main/AndroidManifest.xml:56-59`、`res/xml/backup_rules.xml`、`res/xml/data_extraction_rules.xml`、`MainActivity.java:1085-1090`、`res/values/strings.xml`（22 行）
- 本机/本仓：`adb help`（platform-tools 37.0.1）；`android/app/src/main/AndroidManifest.xml:13-14`；`android/app/build.gradle:20-62`；`.github/workflows/release.yml:105-112`；`src/mobile/settings/BasicSettingsSections.tsx:65-78`；`src/mobile/settings/uninstallData.test.ts`；`OpenFilePlugin.kt:101/128/162`；`PortablePackagePlugin.kt:91/374/460`

## 7. 调研结论对齐（task-34 已填）

1. **不启用 Auto Backup 的结论：确认。** §3 三条理由（25MB 限额、隐私/网络开关语义、恢复不可控）都有官方机制证据支撑；Auto Backup 对 2 万文档/20 万附件的库必然超限，且正文未加密却会被传到用户 Google Drive。
2. **需要修正/补充的措辞**（不影响已实现结论，但影响准确性）：
   - ①（重要）「从桌面图标直接卸载不会弹」**未证实**。启动器卸载通常也走 `ACTION_DELETE`/`ACTION_UNINSTALL_PACKAGE` 进入系统 PackageInstaller 卸载确认框，理论上有勾选框；目前**只有「设置→应用信息→卸载」有确凿证据**。建议把 `BasicSettingsSections.tsx:72` 与 `docs/HANDOFF.md` §0 的同句改为「走系统卸载确认框（应用信息 / 启动器卸载菜单）一般会出现；静默卸载（adb/pm/商店）不会」，并以真机实测为准。
   - ② 缺「**重装需同一签名/来源**」（semi-uninstall + 签名约束；本仓 CI release keystore 与本地 debug 不同，见 §6.1）——建议设置页补一句。
   - ③ 缺「**Android 10 + 便携 SD** 勾选保留会导致 PackageInstaller 崩溃/卸载失败」（issuetracker 148573843，Android 11 修复）——排障知识即可。
   - ④ 保留范围补充：私有 `/data/data` 确定保留；外置 `Android/data` 是否保留社区说法不一（gist 称「可能保留」），**本仓数据全在内部私有目录（`src/core/noteBodyPaths.ts:4`），不受影响**。
3. **结论变更纪律**（保留原文）：任何启用 Auto Backup / 改签名路由的变更，必须同时改 manifest、护栏测试、本文件 §1/§3，并在 `docs/HANDOFF.md` §0 记一行。
