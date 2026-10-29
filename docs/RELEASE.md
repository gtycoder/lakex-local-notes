# LakexLocalNotes macOS 发布指南（签名 + 公证 + 打包）

> 目标：消除 dmg 首次打开需「右键 → 打开」的问题，产出可安全分发的 .app/.dmg。
> 原理：Apple 要求 **Developer ID 签名**（证明应用来自你）+ **公证**（Apple 服务器扫描无恶意代码）。
> 本项目侧配置已就绪（图标 ✅、electron-builder ✅），剩下的是 **Apple 侧认证工作**（需你本人操作）。


---

## 〇、打包自检（261027 实锤，出包前必看）

**症状**：打包版启动弹框「A JavaScript error occurred in the main process / Could not load the 'sharp' module using the darwin-arm64 runtime」，主进程起不来。

**根因**：不是 OOM（渲染进程 `--max-old-space-size=4096`）。从**软链的 node_modules（如 `/tmp/*` worktree 里 `node_modules -> 主克隆/node_modules`）** 跑 electron-builder 时，依赖收集会漏掉 sharp 的平台包 `@img/*` —— asar 里 `node_modules/@img` 条目为 0，sharp 加载不到 libvips 原生库。

**纪律**：
1. 出包必须在**真实 node_modules** 的克隆里跑（`npm ci` / CI），不要在 symlink worktree 里出包；
2. 出包后自检（缺一不可）：
   ```bash
   node -e "const a=require('@electron/asar'); const f=a.listPackage('release/mac-arm64/LakexLocalNotes.app/Contents/Resources/app.asar'); console.log('asar @img:', f.filter(x=>x.includes('@img')).length)"   # 期望 >= 10
   ls release/mac-arm64/LakexLocalNotes.app/Contents/Resources/app.asar.unpacked/node_modules/@img   # 期望有 sharp-darwin-arm64 / sharp-libvips-darwin-arm64
   ```
3. 冒烟：`node scripts/e2e-packaged-smoke.mjs`（需要 `release/mac-arm64/...app` 已存在；默认 CDP 9333、独立 LAKE_USER_DATA），通过后再签名/公证。

**一条命令（本地/CI 通用）**：`bash scripts/ci-packaged-smoke.sh`
—— 软链 node_modules 直接报错退出；否则 vite build → electron-builder --dir → asar @img 自检 → asar.unpacked @img 自检 → packaged smoke；`SKIP_BUILD=1` 复用已有 release 产物（release 工作流就是这么用的）。

**CI**：
- `.github/workflows/packaged-smoke.yml`：PR / 手动触发，跑同一条脚本；失败上传 smoke 日志。**普通 push 不再触发**（用户 261029 定：只有 tag 才打包，日常提交不消耗 macOS runner；tag 上的冒烟由 release 工作流内联兜底）。
- `.github/workflows/release.yml`：`electron-builder --mac` 之后、上传 dmg/zip 之前跑 `SKIP_BUILD=1 bash scripts/ci-packaged-smoke.sh` —— 安装包起不来的话不允许出 release。
---

## 一、你需要先在 Apple 侧完成的认证工作（按顺序）

### 1. 加入 Apple Developer Program
- 地址：https://developer.apple.com/programs/enroll/
- 费用：¥688/年（$99），需 Apple ID，个人/公司均可
- 注意：**个人开发者**即可，无需公司。注册需要身份证/实名（国内用户用护照或身份证，按页面指引）

### 2. 生成「Developer ID Application」证书（签名用）
两种方式任选：
- **方式 A（Xcode，推荐）**：打开 Xcode → Settings → Accounts → 登录你的 Apple ID →
  Manage Certificates → 点 `+` → 选 **Developer ID Application** → 自动生成并下载到钥匙串
- **方式 B（网页）**：https://developer.apple.com/account/resources/certificates → 新建证书 →
  选 **Developer ID Application** → 按指引生成 CSR → 上传 → 下载 .cer 双击导入钥匙串
- 验证：`security find-identity -v -p codesigning` 应看到 `Developer ID Application: xxx (TEAMID)`

### 3. 获取 Team ID（签名/公证都要用）
- https://developer.apple.com/account → 右上角你的名字 → Membership Details → **Team ID**
- 形如 `ABCDE12345`（10 位大写字母数字）

### 4. 准备公证凭据（二选一）
- **方式 A（App Store Connect API Key，推荐）**：
  https://appstoreconnect.apple.com/access/integrations/api → 新建 Key →
  权限选 **Developer ID / App Store Connect**（至少 `Developer ID`）→ 下载 `.p8` 文件 +
  记下 **Key ID** 和 **Issuer ID**
  （.p8 只下载一次，保管好）
- **方式 B（app-specific password）**：
  https://appleid.apple.com → 登录 → 安全 → App 专用密码 → 生成一个（用于公证，与你的 Apple ID 密码不同）

### 5. 安装命令行工具（本机）
```bash
xcode-select --install      # 若未装过 Xcode CLT
```

---

## 二、项目侧：配置公证（一次性）

编辑 `package.json` 的 `build.mac`：

```json
"mac": {
  "category": "public.app-category.productivity",
  "icon": "build/icon.icns",
  "target": ["dmg", "zip"],
  "notarize": {
    "teamId": "你的TeamID"
  }
}
```

（electron-builder ≥ 24 支持 `mac.notarize.teamId`；凭据走环境变量，不写进仓库）

---

## 三、打包命令

```bash
export PATH="$HOME/.nvm/versions/node/v24.18.0/bin:$PATH"
export npm_config_registry=https://registry.npmmirror.com
export npm_config_cache=/tmp/npm-cache-lake

# 方式 A：API Key（推荐）
export APPLE_API_KEY="$(cat /path/to/AuthKey_XXXXXXXXXX.p8)"   # 或 export APPLE_API_KEY_PATH=...
export APPLE_API_KEY_ID="XXXXXXXXXX"
export APPLE_API_ISSUER="你的IssuerID"

# 方式 B：app-specific password
export APPLE_ID="you@example.com"
export APPLE_APP_SPECIFIC_PASSWORD="xxxx-xxxx-xxxx-xxxx"
export APPLE_TEAM_ID="你的TeamID"

# 构建 + 签名 + 公证 + 打包（dmg + zip 输出到 release/）
node node_modules/.bin/electron-builder --mac
```

首次公证需上传整个 .app 到 Apple 服务器，通常 3~10 分钟；`release/` 下会生成
`LakexLocalNotes-x.y.z.dmg` / `.zip`。

---

## 四、打包后验证

```bash
# 1) 签名是否有效
spctl --assess --type execute --verbose=4 "release/mac-arm64/LakexLocalNotes.app"

# 2) 公证是否通过（在 dmg 挂载或解压 zip 后对 .app 验证）
xcrun stapler validate "release/mac-arm64/LakexLocalNotes.app"

# 3) 查看签名详情（应含 Developer ID Application）
codesign -dv --verbose=4 "release/mac-arm64/LakexLocalNotes.app"
```

预期输出：`accepted`（spctl）+ `The validate action worked!`（stapler）→ 分发出去用户可直接打开。

---

## 五、常见问题

| 现象 | 原因/处理 |
|---|---|
| 打包报 `No identity found for signing` | 证书没导入钥匙串 / 不是 Developer ID Application 类型。回到一.2 |
| 公证报 `Invalid team id` | Team ID 拼错或不是该账号的 |
| 公证报 `The user or password is incorrect` | 方式 B 密码必须是 **App 专用密码**，不是 Apple ID 登录密码 |
| 首次打开仍提示「无法验证开发者」 | 签名或公证没完成；确认 spctl/stapler 输出为 accepted |
| `notarize` 报 `Could not find API key` | 方式 A 三个环境变量没配全，或 .p8 内容没读对 |
| 架构注意 | 本机若为 Apple Silicon，默认打 arm64；要通用包加 `--universal`（体积翻倍，一般不需要） |

---

## 六、当前进度（2026-08-03）

- [x] 应用图标（`build/icon.icns`，程序化设计：湖蓝 + 文档页 + 波浪）
- [x] electron-builder 配置（appId `com.lakexlocalnotes.desktop`、mac target dmg+zip、win target nsis、icon）
- [x] GitHub Actions 发版（macOS dmg/zip + Windows exe + Android apk → GitHub Release）
- [ ] 用户注册 Apple Developer Program（一.1）
- [ ] 生成 Developer ID Application 证书（一.2）
- [ ] 准备公证凭据（一.4）
- [ ] 配置 notarize + 环境变量并首次打包（二/三）
- [ ] spctl / stapler 验证通过（四）

> 备注：签名与公证依赖你的 Apple 账号与钥匙串，无法自动化代做；项目侧已全部就绪。

---

## 七、GitHub Actions 发版指南（含 Windows / Gitee 同步 / 未签名说明）

> 日常发版推荐走 Actions；本地打包只用于调试或需要 Apple 签名/公证时。

### 1. 触发方式

**只有推 tag 才打包**（用户 261029 定）：普通 push / 合并不触发任何打包 job，不消耗 macOS runner。

- **推 tag（唯一常规入口）**：`v*` 触发 `.github/workflows/release.yml`
- **手动**：GitHub → Actions → Release → Run workflow，输入已存在的 tag（仅用于失败重跑）

> 远端：GitHub 是**发版主仓**（Actions 所在），Gitee 是日常拉取源。clone 后先 `npm run setup:remotes` 配好双推（脚本 `scripts/setup-remotes.mjs`）；日常 `git push origin <branch>` 一次推两边。

### 2. 构建矩阵

| Job | Runner | 产物 |
| --- | --- | --- |
| macOS | `macos-15` | `*.dmg` / `*.zip`（未签名） |
| Windows | `windows-latest` | NSIS 安装包 `*.exe`（未签名） |
| Android | `ubuntu-24.04` | `LakexLocalNotes-<version>-android-release.apk`（release 变体，debug keystore 签） |
| Publish | `ubuntu-24.04` | GitHub Release；配置 `GITEE_TOKEN` 时同步 Gitee 发行版 |

产物命名统一为「产品名 + 版本」：

- macOS：`LakexLocalNotes-<version>-arm64.dmg` / `-arm64-mac.zip`
- Windows：`LakexLocalNotes Setup <version>.exe`（electron-builder NSIS 默认命名）
- Android：`LakexLocalNotes-<version>-android-release.apk`（release 变体，debug keystore 签，`debuggable=false`）

### 3. 发版步骤

```bash
cd lakex-local-notes

# 0) 首次 clone 才需要（remote 配置不入库）
npm run setup:remotes

# 1) 版本号必须与 tag 一致（electron-builder 产物名取自 package.json）
npm version patch --no-git-tag-version   # 或手动改 package.json
git commit -am "chore: release v0.1.2"
git tag v0.1.2                           # 注解 tag 更稳（git tag -a）

# 2) 推代码与 tag：一次推 Gitee + GitHub；只有 tag 会触发打包
git push origin master v0.1.2
```

### 4. Gitee 发行版同步（可选）

- GitHub 仓库 → Settings → Secrets and variables → Actions → 新建 `GITEE_TOKEN`
  （Gitee 私人令牌，勾选 `projects` 权限）
- 配置后 Publish job 会调 Gitee API 创建发行版并上传产物
- ⚠️ Gitee 单附件有大小限制（通常 100MB 级）；dmg/zip 约 180MB 可能超限，
  超限时只同步 apk，或把大文件放对象存储并在发行版里给链接

### 5. 未签名说明

- **macOS**：CI 里 `CSC_IDENTITY_AUTO_DISCOVERY=false`，产物未签名/未公证；
  首次打开需 右键 → 打开
- **Windows**：未签名，SmartScreen 提示「Windows 已保护你的电脑」→ 更多信息 → 仍要运行
- **Android**：产物 = `assembleRelease` 的 release 变体（debug keystore 签，`android:debuggable=false`）；正式发布再换 release keystore（签名强度不变，但不再可调试）
- 要正式分发：按本文一~三节配置 Apple 签名/公证，并在 CI 中加对应 secrets

### 6. 已知坑

- **tag 发布后不可移动**：Release 一旦创建，GitHub 会拒绝改 tag ⇒ 发错就 bump 版本号发新 tag
- Android CI 曾因 `maven.aliyun.com` 对 `j2objc-annotations:1.3` 返回 502 失败 ⇒
  workflow 在 CI 内移除 aliyun 镜像；本地构建仍走镜像加速
- Windows 首次构建若失败，看 `windows` job 日志（常见：better-sqlite3 原生编译、
  electron-builder 下载 winCodeSign）
