# task-63 移动端设备验收记录（本批生命周期/锁/warning）

> 时间点：2026-11-12 17:30–17:42（Asia/Shanghai）。**中途接到代码冻结通知**，本记录只覆盖冻结前已完成项；未完成项如实列出，待解冻后续跑。
> 设备：emulator-5556 = AVD **lake_gate**（CDP 9336）。构建：`ANDROID_SERIAL=emulator-5556 bash scripts/android-build.sh --sync --install` → BUILD SUCCESSFUL（APK 42,304,273 B，安装成功）。
> 点按口径：CDP `Input.dispatchTouchEvent`（touchStart/touchEnd；mouse 事件在 WebView 上不产生应用点击，已实测）；截图：`adb -s emulator-5556 exec-out screencap -p`（设备级）。

## 1. 结论总表

| 项 | 场景 | 结果 | 证据 |
| --- | --- | --- | --- |
| a | 桌面锁定文档 → 手机打开：只读 + 横幅 + 编辑入口提示；保存被拒且正文零改动 | **PASS（主链路）**；「桌面解锁后恢复可编辑」**未跑**（冻结） | `shots/task63-a1-lock-banner.png`、`shots/task63-a2-lock-edit-toast.png`；输出见 §2 |
| b | 回收站文档/日记（首页/搜索/日记页三入口）⇒ 只读预览 + 横幅 | **未跑**（冻结） | — |
| c | 小记陈旧保存 ⇒ 明确拒绝、不复活 | **未跑**（冻结） | — |
| d | 同步 warning 逐项可见（label/hint，不可重试项不写「下次会重试」） | **未跑**（冻结）；需 S3 会话语义，gate 实例是否配置 S3 未确认 | — |
| e | 回收站文档恢复历史 ⇒ 正文变、仍在回收站 | **未跑**（冻结） | — |
| — | 移动快照门禁（受影响态） | **未跑**；且 5556 已被本次验收写脏（见 §4） | — |

## 2. a 项实测数据（PASS 部分）

准备：用 `window.lakeNative` 建文档「验收-锁定文档」+ 正文 `<p>v1 锁定正文</p>` + 历史快照；force-stop 后经 `run-as ... sqlite3` 置 `is_locked=1, locked_at=2026-11-12T09:30:00.000Z`；重启 + CDP 9336；搜索入口点进工作区（touch 点按）。

- `getNoteInfo(noteId)` → `{isEditLocked:true}`（锁字段已透出，此前硬编码 false）。
- 工作区 DOM：`.mobile-status-msg` = **「该文档已在桌面端锁定（只读）：可以阅读，不能编辑或保存。在桌面端解锁后回到这里即可编辑。」**；顶栏存在「编辑」按钮，未出现编辑 dock（`.mobile-editor-dock` = false）。
- 点按顶栏「编辑」→ toast **「文档已在桌面端锁定（只读），不能编辑；请先在桌面端解锁」**；仍无 dock、无「完成」按钮（未进入编辑态）。
- 保存尝试（用户保存入口 `lakeNative.saveNote`）→ **拒绝**：「文档已锁定（只读），保存被拒绝；请先在桌面端解锁后再编辑」；随后 `readNote` 正文仍为 `<p>v1 锁定正文</p>`（**零改动**）。

未完成：把 DB 锁清 0 后重启再点「编辑」应出现 dock/可保存（解冻后补跑）。

## 3. 未跑项的最小复现配方（解冻后按此补）

- b：`lakeNative.createNote` 建文档→`trashNote`；设置→回收站→点行⇒预览页应出现「只读预览：该文档在回收站…」横幅；再从首页最近/搜索/日记页确认已删项不可进入可编辑工作区（日记用 写今天 造一条后 trash，确认日记页列表消失且 stale 入口经 gone 判据进只读预览）。
- c：小记 tab 点开朗读「验收-陈旧小记」写作卡 → 调 `lakeNative.deleteQuickNote(id)` 模拟他端删除 → 点「保存/保存并同步」⇒ toast 含「已在回收站或被删除」，且 `listQuickNoteTrash` 仍含该条、首页列表不复活。
- d：需在测试实例配置 S3（或注入一次 apply 跳过：让某篇正文文件缺失且远端有更新）；同步后设置→「上次同步」应逐项显示 label/hint；`retryable=false` 的项不得出现「下次同步会重试」。
- e：建文档+快照→trash→`lakeNative.restoreHistory(historyId)` ⇒ 正文=快照、`trashed_at` 仍非空（DB 复核）、回收站列表仍可见。

## 4. 现场状态与收尾注意

- **emulator-5556（lake_gate）已被本次验收写脏**：新增「验收-锁定文档」「验收-陈旧小记」、并把验收文档 `is_locked=1`（仅测试行）。**跑移动快照门禁前必须** `adb -s emulator-5556 shell pm clear com.lakexlocalnotes.android` → 启动 → `emu-cdp.sh 9336` → `cdp-eval @scripts/mobile-audit/gate-fixture.mjs` → 再跑 `check-mobile-snap.mjs`；否则 10 态必假红。
- 未产生 CDP 桩（未 stub `input[type=file]`）；未在画布上作画（无合成笔迹需清理）；App 当前停在锁定文档只读页。
- 证据目录与并行 task-57 有同名冲突：已把 3 张图另存为 `task63-*.png`（本记录引用），并把被覆盖的 2 张 tracked 图 `git checkout` 还原为 task-57 版本，避免互相覆盖。
