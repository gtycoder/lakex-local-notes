# 26 · 发版前独立闸门（release readiness review）

> 独立复核 · 只读（不改代码） · 2026-11-12 21:31–21:45 CST · 基线 **HEAD `99df5f86`**（工作树开始时 clean）。
> 标准 = **「能不能安全打 tag」**；门禁与构建均实跑；产物写入被 gitignore 的 `dist*/`，复核后工作树仍 clean。
> 结论：**NO-GO（1 个机械阻塞：版本未 bump）**；完成该步后 = **GO with nits**（见 §6）。

---

## 0. 结论

| 项 | 判定 | 摘要 |
| --- | --- | --- |
| 仓库卫生 | ✅ 通过（1 nit） | 工作树 clean、无临时/凭据/私钥/产物脏改；唯一 nit = 生成文件 `android/capacitor.settings.gradle` 被跟踪（N3） |
| 门禁矩阵 | ⚠️ 1 个负载敏感红 | tsc 0；ui-metrics/check:core/check:mobileui/check:bundle+arch 全绿；两条 build 通过；**全量 vitest 1 failed = `inkPerf` 墙钟阈值在并发负载下超时（孤立跑 14.4ms PASS，见 §3.2）** |
| 发版链路 | ❌ 阻塞 1 项 | **`package.json` = 1.1.0，本次目标 = v1.1.1（RELEASE-NOTES 段已就绪）⇒ `generate-update-manifest` 实测硬失败**；其余链路（触发/Secrets/正文/latest.json/Gitee）核对通过，有 4 个 nits |
| 文档一致性 | ⚠️ 部分过期 | AGENTS 55.2KB ≤64KB ✓；RELEASE-NOTES v1.1.1 段与标题已就绪 ✓；HANDOFF §1 部分数字/tag 口径与实跑不一致（另有并行会话正在改） |

**结论：NO-GO** —— 唯一阻塞项是「**未把 `package.json` 从 1.1.0 bump 到 1.1.1**」（纯机械一步，不改代码）。完成 bump + 提交后可 GO；其余 nits 不阻塞发版。

---

## 1. 基线快照

- HEAD = `99df5f86`（日记收口批回写）；`git status` 开始时 **0 项**；单 worktree（`git worktree list` 仅主目录）。
- 版本：`package.json` = **1.1.0**；tag 最新 = **v1.1.0**（`075272b2`）；**目标版本 = v1.1.1** —— `docs/RELEASE-NOTES.md:7` 已有 `# LakexLocalNotes v1.1.1` 完整段（46 行），但 tag 未创建、package.json 未 bump。
- v1.1.0..HEAD = **207 个提交**（日记不可变/两出口、回收站副本预览、showNotice、S3 多端收口等）。
- 远端：`origin`（Gitee SSH；**第二 pushurl = GitHub HTTPS**）、`github`（SSH）。`origin/master` = 8cc65e06、`github/master` = 2e512c48 ⇒ **本地 master 未推送**（tag 推送前需按 RELEASE.md 步骤推 master）。
- 门禁在 21:31–21:45 本机执行（同时有并行会话/构建，见 §3.2）；**复核中段出现他人未提交改动**（`android/capacitor.settings.gradle`、`docs/HANDOFF.md`，均非本报告产生）。

---

## 2. 仓库卫生（逐项）

| 检查 | 结果 | 证据/说明 |
| --- | --- | --- |
| 工作树干净、无未跟踪临时文件 | ✅ | 复核开始时 `git status --porcelain` = 0；无 `__tmp`/`.bak`/`.orig`/`.rej`/`*~` 跟踪文件 |
| 无凭据/私钥/keystore 入库 | ✅ | 跟踪文件无 `.env`（仅 `.env.example`，另 vendor 示例）、无 `*.pem/.p12/.p8/.keystore/.jks`；`git grep` AKIA/LTAI/私钥块 = 0 |
| 无生成产物入库 | ✅（1 nit） | `dist/ dist-mobile/ dist-electron/ release/ .css-audit/` 均未跟踪（`git ls-files` 0 项）且被 .gitignore 覆盖；**但 `android/capacitor.settings.gradle` 被跟踪**（文件头自己写 DO NOT EDIT/GENERATED）→ N3 |
| 无本机绝对路径 | ✅ | `git grep '/Users/admin' -- ':!docs/audit-261112'` = **0** |
| 大文件/二进制 | ✅ | 最大均为既有 vendor 内核与 CDN 镜像（lakex.js 9.3MB 等，已按 AGENTS 入库）；无发布产物/apk/dmg 跟踪 |
| 审计证据体积 | ⚠️ nit | `docs/audit-261112` 共 66 文件 / **6.6MB**（其中 `evidence/` 5.3MB 设备截图）随仓库入库 → N9 |
| 构建后工作树 | ✅ | 两条 vite build 完成后 `git status` 仍 0（产物全被 ignore） |
| AGENTS 预算 | ✅ | `AGENTS.md` **55,194 B**（≤64KB 硬约束；HANDOFF 35,750B） |

---

## 3. 门禁矩阵（全部实跑，本机 Node v24.18.0）

### 3.1 结果表

| 门禁 | 命令 | 结果 | 耗时 |
| --- | --- | --- | --- |
| 类型 | `npx tsc --noEmit` | **0 error** | 16.3s |
| 单元测试 | `npx vitest run` | **1 failed / 5756 passed / 12 skipped**（文件 917 = 905 passed / 1 failed / 11 skipped） | 182.0s |
| 同上（复跑） | `npx vitest run` | **同一用例再次失败**（见 §3.2） | 128.8s |
| 样式 | `node scripts/ui-metrics.mjs` | **全绿**：颜色字面量 0、`!important` 9/9、移动 19/19、跨文件重复 45/45、被压死声明 0/0、未定义令牌 0 | 0.9s |
| core 边界 | `npm run check:core` | **177 文件 / 0 违规** | — |
| 移动 UI | `npm run check:mobileui` | **通过**（含 ui-metrics 硬指标） | — |
| 架构/预算 | `npm run check:arch` | **PASS**：desktop 首屏 571,442/600,000（余 28.6KB）、app-js 197,537/307,200；mobile 首屏 350,311/360,000（余 9.7KB）、entry 60,856/61,440、CSS 139,532/141,312、preload 6；import 方向违规 0 | — |
| 产物审计 | `npm run check:bundle` | **通过**（含 audit-vendor-css：11 个产物 CSS 无未分层 reset） | — |
| 桌面构建 | `npx vite build` | **exit 0**（169ms build；仅既有 `INEFFECTIVE_DYNAMIC_IMPORT` warning：`desktopSync` 既被 dynamic 又被 static import） | 13.0s |
| 移动构建 | `npx vite build -c vite.mobile.config.ts` | **exit 0** | 15.6s |
| Android 发版配置静态断言 | `node scripts/check-android-release-config.mjs` | **12/12 通过**（assembleRelease / 无 continue-on-error / aapt 断言 / release job 依赖 / 无明文凭据 / debug-keystore 保守签名） | — |

### 3.2 全量 vitest 唯一红项（负载敏感，非代码回归）

- 失败：`src/features/ink/inkPerf.test.ts:70` `"300 页正文整篇序列化 < 35ms（保存路径可以付这个成本，热路径不能）"` —— 两次全量跑均在并发负载下测得 **52.7ms**（阈值 35ms）。
- **孤立复跑通过**：`npx vitest run src/features/ink/inkPerf.test.ts` → 序列化 **14.4ms**，3 tests PASS（与 261103 注释中「vitest 环境 39.6ms（60 点/笔 10.9MiB）」同量级；本夹具 30 点/笔 1.92MiB）。
- 判定 = **墙钟阈值 + 本机并发负载**（门禁执行时另有并行会话与构建；917 workers 并发）。这一类性能护栏对负载天然敏感，**不是功能回归**；同类已知口径见 HANDOFF §1 对 `electron/s3v3/perf.integration.test.ts` 的「低负载串行」说明（该测试本轮通过）。→ N8。

---

## 4. 发版链路核对（`.github/workflows/release.yml` + `docs/RELEASE.md` + `docs/UPDATE-CENTER.md`）

### 4.1 触发与作业
- 触发：**仅 tag `v*`**（普通 push 不打包）+ `workflow_dispatch`（输入已存在 tag，仅失败重跑）——与 RELEASE.md §七.1 一致。
- 作业：macOS（dmg/zip，unsigned/ad-hoc + **packaged smoke** 冒烟）、Android（`assembleRelease`，release keystore 签名 + apksigner/aapt 双断言 + 重命名 APK）、Windows（nsis，`continue-on-error: true`）、Publish（依赖 macos+android，**只以 macOS 成功为前提**：Android 失败不阻断发版，仅缺 APK）。
- Publish 步骤：从 `docs/RELEASE-NOTES.md` 抽 **当前 tag 段落** → `release-body.md`；用 `scripts/generate-update-manifest.mjs` 生成 `latest.json`（schemaVersion/version/versionCode/publishedAt/notes/releasePageUrl/assets[{os,arch,filename,url,sha256,size}]）；GitHub Release 上传 `dist/**`；配 `GITEE_TOKEN` 时镜像 **APK** 到 Gitee（Gitee 单附件 100MB 限制，只传 APK）。

### 4.2 发版前必须成立的硬约束（脚本/工作流逐条）
1. **tag == `package.json` version**（`generate-update-manifest.mjs` 会 fail）：实测 `--tag v1.1.1` → `package.json version=1.1.0 与 tag=v1.1.1 不一致` **exit 1**（本次阻塞点的直接证据）。
2. **RELEASE-NOTES 必须有 `# LakexLocalNotes <tag>` 段**（找不到直接 fail；段落 = 到下一个同名 H1 为止）——v1.1.1 段已存在 ✓（46 行）。
3. 产物名需匹配清单解析：mac `*arm64*`/`*x64*` 的 dmg（zip 兜底）、`* Setup <ver>.exe`、`*-android-release.apk`；缺平台只 **warn**（Windows/Android 失败不阻断清单生成）。
4. versionCode = 1000 + major×10000 + minor×100 + patch（1.1.1 ⇒ **11101**）；Android `build.gradle` 从根 package.json 派生，不手改 ✓。

### 4.3 本地可预演（已做两层）
- **当前 HEAD 直接干跑**：`node scripts/generate-update-manifest.mjs --tag v1.1.1 --dist <dir>` → **失败**（版本不一致，见 4.2-①）。
- **bump 后全链路干跑（/tmp 副本模拟）**：把 package.json 版本改成 1.1.1 + 真实 RELEASE-NOTES + 4 个假产物名（arm64/x64 dmg、Setup exe、android apk）→ 脚本**成功**：`version 1.1.1 / versionCode 11101 / notes 46 行 / assets 4 个 / URL 指向 v1.1.1 release`，release 正文首行 = v1.1.1 段正文 ⇒ **bump 后清单生成路径已验证**。

### 4.4 CI 上可能失败/需人工确认的步骤（按概率）
| # | 步骤 | 风险 | 本地预演 |
| --- | --- | --- | --- |
| 1 | Publish → Generate update manifest | **当前必失败**（version 1.1.0 ≠ tag v1.1.1）→ 阻塞 B1 | 已复现（§4.3-①） |
| 2 | Android → Decode keystore / Assemble release | 需 4 个 secrets：`ANDROID_KEYSTORE_BASE64 / ANDROID_KEYSTORE_PASSWORD / ANDROID_KEY_ALIAS / ANDROID_KEY_PASSWORD`（release.yml:104-128）；**RELEASE.md 只写了 GITEE_TOKEN，未列这四个名字**（N2）。缺任一 ⇒ gradle 回落 debug keystore（`android/app/build.gradle:20-28` 四条件）⇒ `apksigner` 断言会拒绝「Android Debug」证书 ⇒ Android job 红（Release 仍发但**无 APK**） | `node scripts/check-android-release-config.mjs` 12/12 通过（静态）；keystore 内容无法本地预演 |
| 3 | macOS Package + Packaged smoke | 未签名（`mac.identity=-`、`hardenedRuntime=false`、`CSC_IDENTITY_AUTO_DISCOVERY=false`）——**ad-hoc，未公证**（N4）；packaged smoke 依赖 `release/mac-*` 产物与 asar `img` 自检，本地未跑整包 | 需在 mac runner 实测；本地 electron-builder 整包未跑（本轮只跑 vite） |
| 4 | Windows job | `continue-on-error` ⇒ 失败不阻断；可能栽在 better-sqlite3 原生编译/winCodeSign 下载；Release 可能无 exe 且 latest.json 无 windows 资产（仅 warn） | 本地无法预演（N5） |
| 5 | Publish → Mirror to Gitee | `GITEE_TOKEN` 未配则跳过；配了但网络/限额失败 `continue-on-error` | 不可本地预演 |
| 6 | Push 本身 | `origin` 第二 pushurl 是 **GitHub HTTPS**（`git remote -v`），而 AGENTS §2/§7 实测「HTTPS 到 GitHub 不通、VPN 开时不通」⇒ `git push origin master v1.1.1` 可能第二个 URL 失败（N7）；建议先 `git push github`（SSH）再 `git push origin`（Gitee），或临时改 pushurl | 无副作用检查：`git remote -v` |

### 4.5 发版前推荐命令（自包含）
```bash
export PATH="$HOME/.nvm/versions/node/v24.18.0/bin:$PATH"
cd "$(git rev-parse --show-toplevel)"
git status                                   # 必须 clean
npm version patch --no-git-tag-version       # 1.1.0 → 1.1.1（唯一阻塞项）
git add package.json package-lock.json 2>/dev/null; git commit -m "chore: release v1.1.1"
# 可选：本地干跑清单（真实产物由 CI 生成；此处只验证 tag/版本/说明段）
node scripts/generate-update-manifest.mjs --tag v1.1.1 --dist <含4类产物的目录> --out-dir /tmp/relcheck
git push github master && git push github v1.1.1      # GitHub SSH（发版主仓，tag 触发 CI）
git push origin master && git push origin v1.1.1      # Gitee 镜像（如 pushurl 报 HTTPS 失败，见 N7）
```

---

## 5. 文档一致性抽查

| 文档/项 | 结果 | 证据 |
| --- | --- | --- |
| AGENTS ≤64KB | ✅ 55,194B | `wc -c AGENTS.md` |
| RELEASE-NOTES 本轮条目 | ✅ 已有 v1.1.1 段（46 行），标题/格式符合 `# LakexLocalNotes v1.1.1`；页首合集范围已改为 v1.1.1→v1.0.0 | `docs/RELEASE-NOTES.md:3,7` |
| RELEASE.md 版本流程 | ✅ 与 workflow 一致（只 tag 触发、bump+tag、不手改 gradle、段落标题格式、Gitee 只镜像 APK、未签名说明）；**缺 Android 四个 secret 名**（N2） | `docs/RELEASE.md:158-230` |
| UPDATE-CENTER 清单 schema | ✅ 与生成脚本逐字段一致（schemaVersion/version/versionCode/publishedAt/notes/releasePageUrl/assets） | `docs/UPDATE-CENTER.md §3` vs `scripts/generate-update-manifest.mjs` |
| HANDOFF §1 数字 vs 实跑 | ⚠️ 部分过期（N1）：§1 写 check:core **172**（实跑 **177**）、bundle/arch **desktop 567,551 / app-js 196,192 / mobile 348,211 / entry 60,803 / css 139,503**（实跑 **571,442 / 197,537 / 350,311 / 60,856 / 139,532**）；tag/RELEASE-NOTES 范围仍写 v1.1.0（实为待发 v1.1.1）；§1「本次 HANDOFF 回写批未提交」与 clean 工作树不符（**并行会话 task-101 正在改这两处，复核中段已见 `docs/HANDOFF.md` 未提交改动**） | `docs/HANDOFF.md §1` |
| 门禁快照总量 | ✅ 总量一致：HANDOFF 917 文件/5769 用例 = 实跑总量；差异只在 1 个负载敏感失败（§3.2） | `docs/HANDOFF.md:65` |

---

## 6. 阻塞项与 nit

### 6.1 阻塞项（必须解决才能安全打 tag）
- **B1（阻塞）版本未 bump**：`package.json` = 1.1.0，而本次目标 tag = **v1.1.1**（RELEASE-NOTES 段已就绪、gate 也按 v1.1.1 核对）。实测 `generate-update-manifest --tag v1.1.1` 直接失败；若强行推 tag，Publish job 必红且浪费 macOS runner。**修法 = `npm version patch --no-git-tag-version` + 提交**（无代码风险；bump 后 /tmp 全链路模拟已通过）。

### 6.2 Nits（不阻塞）
- **N1 HANDOFF §1 数字/口径过期**（见 §5）：发版前应更新 check:core 177、bundle/arch 实际值、v1.1.1 tag 口径；并行 task-101 正在处理（复核中段已出现未提交改动）。
- **N2 RELEASE.md 未列 Android 四个 Secrets 名称**（`ANDROID_KEYSTORE_BASE64 / ANDROID_KEYSTORE_PASSWORD / ANDROID_KEY_ALIAS / ANDROID_KEY_PASSWORD`，release.yml:104-128）：只写「CI 从 GitHub Secrets 解码」；缺任一 ⇒ gradle 回落 debug keystore ⇒ apksigner 断言失败 ⇒ Release 无 APK。建议在 RELEASE.md §七 列出名称与「缺失时 CI 会红」。
- **N3 生成文件被跟踪**：`android/capacitor.settings.gradle` 文件头 `DO NOT EDIT`/GENERATED，但入库且路径依赖克隆目录名（旧提交内容为 `../../lakex-local-notes/node_modules/...`；复核中段另一会话正在把它改成 `../node_modules/...`——恰好证明 `cap sync` 会重写它）。建议加入 .gitignore（构建前 `cap sync`；CI 已 `npx cap sync android`）或明确保留策略。
- **N4 macOS 未签名/未公证**：workflow 固定 `mac.identity=-`、`hardenedRuntime=false`（ad-hoc）；已文档化（RELEASE.md §七.5），但**用户首次打开需「仍要打开」**；若正式分发需 Apple 证书/公证（另一件事）。
- **N5 Windows job `continue-on-error`**：失败不阻断发版 ⇒ 可能出现「无 exe」的 release 且 latest.json 无 windows 资产（仅 warning）。可接受（既定口径），但发布说明/验收时应知悉。
- **N6 发版 CI 不跑 vitest**：release.yml 的 macOS/Windows job 只 `tsc --noEmit + vite build`，Android 只 build；**tag 构建不跑单测**（PR 门禁才跑）。tag 前必须本地全量绿（本 gate 承担）；可考虑在 macOS job 追加 `npx vitest run`（+~2–3min）。
- **N7 pushurl = GitHub HTTPS**：`git remote -v` 显示 `origin` 第二 pushurl 为 GitHub HTTPS，与 AGENTS「HTTPS 到 GitHub 不通 / VPN 开时不通」矛盾；RELEASE.md 写「一次推 Gitee+GitHub」但未提示该风险。建议按 AGENTS 用 `git push github`（SSH）单独推 GitHub。
- **N8 负载敏感性能门禁**：`src/features/ink/inkPerf.test.ts:70` 的 35ms 墙钟阈值在并发负载下失败（52.7ms），孤立跑 14.4ms 通过。建议 A. 发版门禁声明「低负载串行」口径（与 HANDOFF 对 s3v3 perf 的既有口径一致）；或 B. 提高阈值/改相对判据，避免发布前误红。
- **N9 审计证据体积**：`docs/audit-261112` 66 文件/6.6MB（`evidence/` 5.3MB 截图）入库；开源发布前可评估是否精简/外置（不阻塞）。

---

## 7. 未覆盖 / 边界

- **未在 CI 真实 runner 预演**（无 secrets/无 macOS runner）：macOS electron-builder 打包 + packaged smoke、Windows NSIS、Android 真实 keystore 签名均未本地执行（本地只跑了两条 vite build + `check-android-release-config` 静态断言）。
- **未跑 `npm ci` 冷装**（避免破坏当前 node_modules）；安装期风险仅按锁文件跟踪性核对（`package-lock.json` 入库、vendor 内核 173 文件入库、`postinstall` 的 patch-package 目录与 4 个 patch 均存在）。
- **未重跑设备/视觉门禁**（按任务口径以 HANDOFF §1 已录结果为准；本轮只查一致性）。
- 复核期间有并行会话改动（HANDOFF/生成文件），结论以 **HEAD 99df5f86** + 复核开始时的 clean 工作树为准。
