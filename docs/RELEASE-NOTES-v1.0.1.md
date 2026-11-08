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
