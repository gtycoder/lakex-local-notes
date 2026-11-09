# UPDATE-CENTER 规格（应用内更新中心）

> 状态：**已实现（261109，桌面 + Android）**。本文是口径唯一来源；口径变更先改本文再改代码。

## 1. 范围（已定稿）

- **只有稳定版**：无 beta/alpha 通道；只认 GitHub 的 latest release。
- **不做静默安装**：桌面下载后由用户打开安装包；Android 下载后拉起系统安装器，用户在系统弹窗确认。
- **可以自动下载**：默认开（Android 仅 Wi-Fi 自动下载）；**只由后台/启动的自动检查触发**。
- **手动检查只提示、不自动下载**（261109 用户定稿）：用户自己点「下载安装包」或「前往发布页」。
- **自动检查**：默认开；启动时查一次 + 每 24h（可选 6/12/24h / 关闭）。
- **更新日志**：应用内展示；GitHub tag 页（Release body）也必须有更新内容，二者同源（docs/RELEASE-NOTES.md）。
- 更新源：**GitHub Releases 为主**；不做国内镜像（国内慢由"启动即查 + 后台自动下载"缓解）。
- 非目标：Linux 包、增量更新、灰度、渠道包、自动安装/root 静默。

## 2. 用户交互

### 桌面（设置 → 更新；独立分类页，不是弹窗）
- 行「检查更新」：显示当前版本 / 上次检查时间 / 状态；点击立即检查。
- 行「自动检查」：开关 + 频率（6/12/24 小时 / 关闭），默认开 / 24h。
- 行「自动下载」：开关，默认开（只影响后台自动检查；手动检查永远不自动下载）。
- 行「更新日志」：打开面板，渲染 docs/RELEASE-NOTES.md（当前版本及历史）。
- 发现新版本：在「更新」页内显示 版本号、发布日期、大小、更新内容与操作（不弹窗）；按钮：
  - 「下载安装包」→ 下载（显示进度）→ 完成后「打开安装包」（macOS 打开 dmg、Windows 运行 exe）；
  - 「前往发布页」→ GitHub release **当前最新 tag 页**（手动下载兜底）；
  - 「稍后」；「忽略此版本」→ 该版本不再提示（下个版本恢复）。
- **手动检查**发现新版本：停在「可用更新」，不自动下载，等用户点上面两个按钮。
- **自动检查**（启动/定时）且「自动下载」开启时：发现新版本即后台下载，完成后提示「打开安装包」。
- 网络失败：状态行给**可操作原因 + 原始错误码**（如「连接 GitHub 超时 · 请检查代理 / VPN 后重试（UND_ERR_CONNECT_TIMEOUT）」），主进程同时留日志。
- 启动检查发现更新：弹一次更新窗口（每版本最多一次；已忽略的不弹）。

### Android（设置 → 更新中心；菜单倒数第二，「关于」置底）
- 同上四行，另加「仅 Wi-Fi 自动下载」（默认开）；**手动检查同样不自动下载**（与桌面同口径），给「下载并安装 / 前往发布页」。
- 发现更新：更新卡片（版本/大小/更新内容）→「下载并安装」→ 下载进度 → 完成后「安装」→ 系统安装器。
- 自动下载（仅 Wi-Fi）：后台下载，系统通知可见；回到 App 后提示安装。
- 自动检查触发：App 启动（就绪后）一次 + 前台恢复时按 24h 节流。

## 3. 清单（latest.json）

CI 在发版 job 生成，作为 GitHub Release 资产；应用读取
`https://github.com/gtycoder/lakex-local-notes/releases/latest/download/latest.json`。

```json
{
  "schemaVersion": 1,
  "version": "1.0.5",
  "versionCode": 11005,
  "publishedAt": "2026-11-09T00:00:00Z",
  "notes": "## 更新内容\n- ...",
  "releasePageUrl": "https://github.com/gtycoder/lakex-local-notes/releases/tag/v1.0.5",
  "assets": [
    { "os": "macos", "arch": "arm64", "filename": "LakexLocalNotes-1.0.5-arm64.dmg", "url": "https://github.com/.../LakexLocalNotes-1.0.5-arm64.dmg", "sha256": "<64hex>", "size": 208000000 },
    { "os": "macos", "arch": "x64", "filename": "LakexLocalNotes-1.0.5-x64.dmg", "url": "...", "sha256": "...", "size": 0 },
    { "os": "windows", "arch": "x64", "filename": "LakexLocalNotes.Setup.1.0.5.exe", "url": "...", "sha256": "...", "size": 0 },
    { "os": "android", "arch": null, "filename": "LakexLocalNotes-1.0.5-android-release.apk", "url": "...", "sha256": "...", "size": 0 }
  ]
}
```

- 版本比较：桌面用 semver；Android 以 `versionCode` 为主（回退 semver）。
- 资产选择：桌面按 `process.platform` + `process.arch`；Android 只取 `os=android`。
- 校验：https、sha256 64 hex、size>0、version/semver 合法；下载后必须校验 sha256（Android 另验 APK 签名证书指纹 = `A8:BA:87:F7:...:2E:35`）。

## 4. 设置默认值（两端同口径，设备本地）

| 键 | 默认 | 说明 |
|---|---|---|
| autoCheck | true | 启动检查 + 定时 |
| checkIntervalHours | 24 | 6/12/24；0=关闭 |
| autoDownload | true | 发现更新即后台下载 |
| autoDownloadWifiOnly | true | 仅 Android 生效 |
| ignoredVersion | "" | 「忽略此版本」记录 |

设置只存设备本地（桌面 settingsRepository / 移动 localStorage），**不进 S3、不写正文**。

## 5. 失败面（单一判据）

- 网络失败 / 404 / 清单不合法 ⇒ 只提示「检查更新失败」，保留旧状态；不重试风暴（本轮内最多 1 次）。
- 下载失败 ⇒ 最多重试 3 次（指数退避 2s/8s/30s）；校验失败 ⇒ 删除坏包并提示重新下载。
- 用户取消/切后台：下载可继续（Android 用系统 DownloadManager；桌面主进程流式下载）；App 重启后从「已下载未安装」状态恢复。
- 版本被撤回（清单版本低于当前）⇒ 不提示降级。
- 自动检查与手动检查并发 ⇒ 单飞（同一时刻只跑一个）。
- 设备已忽略版本 ⇒ 不弹窗、不自动下载，仅「检查更新」可看到。

## 6. 安全

- 只走 HTTPS；清单与包均校验 sha256；Android 额外固定签名指纹（与 GitHub 发布证书一致）。
- 不自动执行安装器；不静默；不请求未知来源权限以外的权限（Android 需 `REQUEST_INSTALL_PACKAGES`）。
- 下载目录：桌面 `userData/updates/`；Android App 私有 cache（FileProvider 暴露单文件）。

## 7. CI（发版 job）

1. 从 `docs/RELEASE-NOTES.md` 抽取当前 tag 对应版本段落 → 写 `release-body.md`。
2. 扫描 dist 产物（dmg/zip/exe/apk），算 sha256/size，生成 `latest.json`（URL 指向本 tag 的 release asset）。
3. `softprops/action-gh-release`：`body_path: release-body.md`（不再 generate_release_notes）、`files` 追加 `latest.json`。
4. 本地可用 `node scripts/generate-update-manifest.mjs --tag vX.Y.Z --dist <dir> --out <dir>` 干跑校验。

## 8. 实现落点（文件级）

- 共享：`src/core/update/updateManifest.ts`（类型/解析/比较/选包；两端共用）。
- CI：`scripts/generate-update-manifest.mjs`、`.github/workflows/release.yml`。
- 桌面：`electron/update/updateService.ts`、`electron/ipc/registerUpdate.ts`、`electron/main.ts`、`electron/preload.cjs`、`electron/webApiServer.ts`（WEB_METHODS）、`electron/settingsRepository.ts`、`src/lib/native.ts`、`src/components/app/UpdateCenter.tsx`（+ hook）、`src/components/app/SettingsPanel.tsx`（关于页入口）。
- 移动：`android/.../UpdatePlugin.kt`（check/download/status/verify/install）、`MainActivity.kt` 注册、`AndroidManifest.xml`（REQUEST_INSTALL_PACKAGES）、`res/xml/file_paths.xml`（cache-path updates）、`src/mobile/native/updateManager.ts`、`src/mobile/settings/UpdateCenterSection.tsx`、`src/mobile/update/*`（状态/节流/自动检查）、设置页接线。
- 文档：本文件 + HANDOFF §3 + RELEASE.md（发版跑清单脚本）+ README（去掉"不提供自动更新"）。

## 9. 测试

- 单元：manifest 解析/版本比较/选包（两端共享）；CI 脚本至少本地干跑一次（v1.0.4 产物目录）。
- 桌面：updateService 用 mock fetch（成功/404/坏 manifest/坏 sha256/断点），IPC 三处一致（parity 测试自动覆盖）。
- 移动：节流/忽略版本/Wi-Fi 判据纯逻辑单测；设备上至少手动走一遍检查→下载→安装器弹出。
- 门禁：tsc 0、全量 vitest、git diff --check；发版前设备门禁照旧。
