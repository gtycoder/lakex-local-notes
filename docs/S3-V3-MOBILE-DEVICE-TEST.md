# S3 v3 移动端真机/模拟器实测（2 设备，261025）

> 目标：在真实 Android App（debug APK，含 v3 代码）+ 真实七牛 S3 上验证移动端 v3 推拉。
> 设备：AVD lake_mobile（emulator-5554，CDP 9335）与 AVD lake_gate（emulator-5556，CDP 9336）。
> 触发方式：通过 App 内 bridge window.lakeNative.syncNow() 触发同步（同一 App/同步入口）；移动端 UI 点击自动化本轮未做。

## 构建与安装
- npx vite build -c vite.mobile.config.ts（含 v3 代码，构建通过）
- npx cap copy android → gradle assembleDebug（缓存 gradle 8.14.3 + SDK android-36，离线构建成功）
- 两台模拟器 adb install -r app-debug.apk 成功，am start 启动 App。

## 结果
| 步骤 | 结果 |
|---|---|
| A（lake_mobile）配置 v3 flag + S3（真实前缀） | saveS3Settings=ok |
| A 首次同步 | v3 同步完成：↑1 ↓0；云端 4 对象（pointer/index/正文/quick 空索引） |
| B（lake_gate）首次同步 | v3 同步完成：↑0 ↓1（拉到 A 上传的文档） |
| B 新建文档（bridge saveNote）并同步 | ↑2 ↓0 |
| A 再同步 | ↑0 ↓1（拉到 B 新建的文档） |

- 移动端 v3 使用与桌面同一份 src/core 引擎 + MobileDeviceStore + 移动 S3v3Remote（CapacitorHttpHandler/OkHttp），证明 Capacitor S3 端口可用。
- 本轮数据量小（欢迎文档 + 1 新文档），无附件/小记数据；移动端附件/小记/目录已在单元测试覆盖，尚未在设备上造数验证。

## 未完成
- 移动端真实 UI 点击（设置页/同步按钮）自动化；
- 设备端耗时/流量指标与大数据量；
- 设备端附件/小记/目录/删除/恢复/彻底删除路径；
- 与 master 旧移动同步的 A/B 指标。
