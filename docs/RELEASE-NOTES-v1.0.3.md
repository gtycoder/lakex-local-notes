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
