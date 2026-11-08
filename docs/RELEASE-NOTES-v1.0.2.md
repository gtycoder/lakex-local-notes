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
