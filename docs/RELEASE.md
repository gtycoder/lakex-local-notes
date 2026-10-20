# LocalLakeNotes macOS 发布指南（签名 + 公证 + 打包）

> 目标：消除 dmg 首次打开需「右键 → 打开」的问题，产出可安全分发的 .app/.dmg。
> 原理：Apple 要求 **Developer ID 签名**（证明应用来自你）+ **公证**（Apple 服务器扫描无恶意代码）。
> 本项目侧配置已就绪（图标 ✅、electron-builder ✅），剩下的是 **Apple 侧认证工作**（需你本人操作）。

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
`LocalLakeNotes-x.y.z.dmg` / `.zip`。

---

## 四、打包后验证

```bash
# 1) 签名是否有效
spctl --assess --type execute --verbose=4 "release/mac-arm64/LocalLakeNotes.app"

# 2) 公证是否通过（在 dmg 挂载或解压 zip 后对 .app 验证）
xcrun stapler validate "release/mac-arm64/LocalLakeNotes.app"

# 3) 查看签名详情（应含 Developer ID Application）
codesign -dv --verbose=4 "release/mac-arm64/LocalLakeNotes.app"
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
- [x] electron-builder 配置（appId `com.lakenotes.electron`、mac target dmg+zip、icon）
- [ ] 用户注册 Apple Developer Program（一.1）
- [ ] 生成 Developer ID Application 证书（一.2）
- [ ] 准备公证凭据（一.4）
- [ ] 配置 notarize + 环境变量并首次打包（二/三）
- [ ] spctl / stapler 验证通过（四）

> 备注：签名与公证依赖你的 Apple 账号与钥匙串，无法自动化代做；项目侧已全部就绪。
