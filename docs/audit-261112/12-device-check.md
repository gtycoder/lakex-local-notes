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

## 5. R2 收尾后的设备门禁矩阵（261112 15:0x）

- **构建**：R2 全部代码落地后重新 scripts/android-build.sh --sync（APK 42,304,515 B），安装到 emulator-5556（lake_gate）、emulator-5558（lake_tab）与真机 50950385；5554 已断开未装。
- **手机 10 态整页快照**（9336 / lake_gate）：按夹具流程 pm clear -> 启动 -> gate-fixture（5 文档 + 4 小记）-> 重烤基线，随后**连跑两轮 0 差异**。基线 scripts/mobile-audit/baseline/mobile-snap.json 已更新（R1/R2 改了预览/回收站/历史 UI，home-doc 等指纹变化属预期）。
- **平板 10 态整页快照**（9340 / lake_tab）：同夹具重烤后**连跑两轮 0 差异**；基线 mobile-snap-tablet.json 已更新。
- **多维表 3 态快照**（9336，夹具自建自删）：元素数不变（2194/2160/2172），但指纹在 mobile.css 域归位后变化（CSS 文件归属/加载顺序调整的预期结果）-> 重烤后**连跑两轮 0 差异**；基线 bitable-snap.json 已更新。
- **23 屏走查**（9336 / lake_gate，ANDROID_SERIAL=emulator-5556）：**23/23 ok**；截图在 .css-audit/mobile-walk/。escape/smallTap 计数为既有可观测量（隐藏首页层等），无新增溢出/对比度项。
- **窗口矩阵**（npm run check:windowsweep / 9340）：pass: true，7 个窗口形态与 tabs/滚动保持均通过。
- **桌面 42 态**：未跑（需专用夹具机/全新实例；本机无夹具缓存）。

## 6. 结论

- R2 收尾后设备门禁（手机 10 态 / 平板 10 态 / 多维表 3 态 / 23 屏 / 窗口矩阵）全部通过，基线已按新 UI 重烤。
- 真机 50950385 已装最新 APK，用户可直接点收 Q03 历史预览、Q07 preview 档、Q05 字号等观感项。
