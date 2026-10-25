# S3 v3 桌面真实 UI 点击冒烟（2 设备，261025）

> 目的：验证 v3 经真实 Electron UI（CDP 鼠标事件/键盘输入）+ 真实七牛 S3 的双端推拉；不是接口直调。
> 环境：dev Electron（vite）、独立 LAKE_USER_DATA、LAKE_SYNC_PROTOCOL=v3、真实 S3 前缀 lake-notes-v3-dev1/_ui/<ts>。

## 设备与操作

| 设备 | userData | CDP | 操作 |
|---|---|---|---|
| A | /tmp/lake-v3-ui-a | 9241 | 配置 S3 → 点云状态按钮同步（真实 mousePressed/Released） |
| B | /tmp/lake-v3-ui-b | 9242 | 同上；打开文档 → 点正文 → Input.insertText 输入「 [from-B]」→ 点同步 |

## 结果（真实 UI 点击）

| 步骤 | 结果 | 耗时 | 生成 |
|---|---|---|---|
| A 首次上传 | uploaded=1, manifestId v3-g1 | 663ms | 5 对象 / 1063B；pointer epoch/generation=1 |
| B 首次拉取 | downloaded=1, v3-g1 | 212ms | B 本地出现文档 |
| B 编辑欢迎文档 + 同步 | uploaded=1, v3-g2 | 790ms | 新正文对象 + 新索引 |
| A 同步 | downloaded=1, v3-g3 | 590ms | /tmp/lake-v3-ui-a/workspace-default/notes/welcome-note.lake 含 from-B |

证据截图：/tmp/ui-v3-A.png、/tmp/ui-v3-B.png（临时，未入库）。

## 发现的问题 / 使用注意

1. 只保存 S3 配置不会立刻刷新云状态：需同时 saveSyncSettings({enabled:true}) 并 reload 页面，按钮才从「本地空间」变为「待同步」。
2. 新建文档入口：侧栏「新建」只弹「新建笔记本」；右键笔记本只看到「重命名/删除」。本轮改用「编辑欢迎文档」完成推拉；新建文档的真实 UI 路径待确认。
3. v3 路由下桌面仍会跑旧 quick-notes 同步（独立前缀），因此云端同时出现 v3 pointer 与旧 quick-notes/manifests/latest.json；v3 小记适配未实现，二者暂时并存。
4. v3 feature flag 默认关闭；未改默认同步路径。
5. 设备 A 的 deviceId 为 desktop-<hash(userData)>，可作为稳定设备标识。

## 4 端复测发现 P0（已修复）

- 4 台桌面（A/B/C/D，CDP 9241-9244，独立 userData）同一前缀：A 上传 g1 → B/C/D 拉取 → D 编辑并发布 g2 → A 拉取成功（本地正文含 from-D），但 B/C 再同步时 `downloaded=0` 且各自 `published=true`，把旧索引重新发布（云端回退），B/C 本地正文仍为旧版。
- 根因：下载应用只写 `lakeEntries/quickEntries`，未同步「本轮发布用」的 `lakeIndexEntries/quickIndexEntries`；该端下一轮用旧条目构建索引并发布。
- 修复：下载应用同时更新 index 副本；新增多端回归测试（无修复时 C 拉到 v1 失败，有修复后 v2）。详见实施报告 B14。

## 4 端复跑（修复 B14 后，通过）

- 4 台桌面（A/B/C/D，独立 userData，CDP 9241-9244，同前缀 lake-notes-v3-dev1/_ui5/1792923016）：
  - A 首次上传 uploaded=1，670ms，v3-g1；
  - B/C/D 依次拉取 downloaded=1，258/172/212ms；
  - D 真实点击打开欢迎文档 + Input.insertText 输入「 [from-D5]」→ 点同步 uploaded=1，563ms，v3-g2；
  - A/B/C 依次同步 downloaded=1，137/121/124ms，manifestId 均为 v3-g2；
  - 四端正文 sha256 全部 = 77156366fe85…，均含 from-D5（完全收敛）。
- 说明：4 端同步按钮用 DOM button.click() 触发（真实 Input 曾因 hover 浮层拦截）；正文编辑仍是真实鼠标点击 + Input.insertText。

## 下一步

- 4 桌面矩阵（A/B/C/D 独立 userData + CDP 端口）+ 冲突/回收站/彻底删除的真实点击路径；
- 找到并验证「新建文档」真实 UI 路径后，按点击创建多文档；
- 2 移动端：先补移动 SQLite→S3v3DeviceStore 适配器与移动同步入口（当前不可测 v3）；
- master 旧逻辑 A/B 指标对比 + 多档真实 S3 压测 + 最终报告。
