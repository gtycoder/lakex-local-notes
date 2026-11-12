# 12 · 261112 R1 设备验收记录（真机 + 模拟器）

> 验收对象：261112 R1 构建（debug APK，versionName 1.1.0 / versionCode 11100）。
> 证据级别：设备级截图（adb exec-out screencap）+ CDP Runtime.evaluate；不替代快照基线（10 态/23 屏需夹具 AVD 重烤后再跑）。

## 1. 环境

| 项 | 值 |
| --- | --- |
| 真机 | Xiaomi 2109119BC，Android 14（USB，serial 50950385） |
| 模拟器 | sdk_gphone64_arm64（emulator-5554，开发机 lake_mobile 实例，含既有测试数据） |
| APK | `android/app/build/outputs/apk/debug/app-debug.apk`（42,303,332 B），已 `adb install -r` 到真机 + 5554 模拟器 |
| 构建 | `bash scripts/android-build.sh --sync --install`（vite mobile build → cap sync → gradle assembleDebug → install → 启动）成功 |

## 2. 已通过（设备级）

### 2.1 启动 / 首页（真机 + 模拟器）
- 真机首启：欢迎小记 + 五格 Dock（小记/知识库/日记/AI/标签），无崩溃；logcat 无 FATAL。
- 截图：`home-physical-device.png`（真机）、`home-emulator.png`（模拟器）。

### 2.2 Q04 移动回收站文档 = 只读预览 + 横幅（模拟器，CDP）
- 路径：设置 → 回收站 → 点「项目计划（标签验收）」→ 只读预览页。
- 断言（CDP DOM）：`.mobile-settings-preview` 存在；正文 viewer 已挂载（`.lake-editor-mount / .ne-engine`）；横幅文本 =「只读预览：该文档在回收站，编辑与保存会被拦截；点右上角「恢复」后可继续编辑。」；顶部「恢复」按钮存在。
- 截图：`trash-preview-emulator.png`。
- 结论：Q04=B 落地（不再 toast 拒绝；只读 + 横幅）。

### 2.3 Q22 SecureStore → SecretBox 真机读回（真机，CDP）
- `Capacitor.Plugins.SecureStore.set({key:'smoke_r1',value:'hello-261112'})` → `get` 返回同值；
- `am force-stop` → 重新启动 → 新 WebView 会话 `get` 仍返回 `hello-261112`（密文跨进程持久）；
- `remove` 后 `get` 为空。
- 结论：改实现（SecretBox）后旧 ALIAS/PREFS 路径读写正常，**真机 Keystore 冒烟通过**。

## 3. 未完成 / 需补验

1. **Q03 移动历史快照预览**：单测（WorkspaceOverlayHost 3 例）通过；设备级点按未完成（本次模拟器导航未稳定进入文档历史 Sheet），需人工或补一次脚本走查。
2. **Q07 `LakeEditor interaction:"preview"`**：单测通过；设备验证需确认「预览里长按卡片不弹重命名/剪切、但单击图片仍出大图」。
3. **Q05 预览档字号**：需与桌面预览观感比对（模拟器可截屏）。
4. **快照矩阵（10 态/平板 10 态/23 屏）**：R1 改了移动预览/回收站/历史 UI，既有基线已过期；只在专用夹具 AVD 上重烤后再跑，**不把旧基线当回归**。
5. **物理机观感走查**：真机已装包并可自测；建议再人工点收回收站预览返回键/系统栏、历史 Sheet 50dvh 滚动、保存拦截提示。

## 4. 命令记录

```bash
ANDROID_SERIAL=50950385 bash scripts/android-build.sh --sync --install
adb -s 50950385 shell am start -n com.lakexlocalnotes.android/.MainActivity
adb -s 50950385 exec-out screencap -p > home.png
# CDP：forward webview_devtools_remote_<pid> → drive.mjs 驱动 DOM 断言
```
