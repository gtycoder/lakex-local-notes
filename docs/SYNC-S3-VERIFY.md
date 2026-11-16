# SYNC-S3-VERIFY.md — S3 配置后零回归验证（261118）

> 用户要求：「一定要确保后续配置了 S3 之后不能出现问题」。本文 = 逐项审计 + 一处真风险修复 + 本地假 S3 端到端证据 + 复跑方法。
> 纪律：全程用**本地假 S3**（`scripts/fake-s3-local.mjs`）与隔离 `LAKE_USER_DATA`，**没有碰任何真实桶/密钥/正式数据**。

## 0. 结论（先看这三条）

1. **端到端 PASS**：配置 S3 → 上传（文档+图片/表格/多维表/画板/手写板/小记）→ 换 userData/换端口 → 拉回 → 打开显示，**15/15 断言通过**；全程本地资产请求 **0 个 404/403/CORS 失败**；端口被占回退后（29878→29879）打开同一文档图片仍正常。
2. **发现并修复 1 个真风险**：正文里的图片是**绝对 URL 且带端口**（`http://127.0.0.1:<实例端口>/<noteId>/<file>`；内核卡片里是百分号编码形态）。端口按形态隔离（dev 19877 / packaged 19876 / 回退 19878…）+ 移动端固定 19876 之后，同一条正文换端口/换实例/换设备打开会指向不存在的端口 ⇒ **坏图**；且端口变化会改 contentHash ⇒ 同步反复上报「内容变了」。
   → 修复：**落盘/上云用规范端口 19876，渲染时归一到本实例实际端口**（裸 URL 与编码卡片两种形态都覆盖），导出正则改端口无关。见 §3。
3. 其余近期改动（`hasFragileUserData`、属性弹窗缩略图、打包依赖迁移、AI 本地专属、update 设置、移动端便携包）**逐项结论 = 不影响同步语义**，证据见 §2。

## 1. 复跑方法（可复制）

```bash
export PATH="$HOME/.nvm/versions/node/v24.18.0/bin:$PATH"
cd "$(git rev-parse --show-toplevel)"
npx vite build                                  # dev-mode 实例用 dist（lakexlocalnotes://app scheme 模式）
node scripts/s3-config-zero-regression.mjs      # 假 S3 + 两个/三个隔离实例，全自动

# 只想手工看假 S3：
node scripts/fake-s3-local.mjs --port 9400      # 打印 FAKE_S3_READY <port>
```

脚本内断言（12 组）：

| # | 断言 | 判定 |
| --- | --- | --- |
| 1 | S3 配置 + `testS3Connection` | 返回「连接成功，Bucket 可访问」 |
| 2 | 造内容（文档+图片/表格/多维表/画板/手写板/小记） | 资产已上传、正文含资产引用 |
| 3 | 实例 A `syncNow` | `uploaded > 0 && conflicts === 0` |
| 4 | 云端对象 | 同时含 `objects/`（正文/资产）与 `meta/`（索引） |
| 5 | 实例 B（新 userData + 新端口 29878）`syncNow` | `downloaded > 0` |
| 6 | 拉回后目录树 | 五种文档类型标题齐全 |
| 7 | 拉回后小记 | 计数 > 0 |
| 8 | 打开文档：图片 | DOM `img.src` **指向 B 的实际端口** 且 `naturalWidth > 0`（带 token） |
| 9 | 打开表格/多维表/画板/手写板 | 各自编辑器根节点渲染 |
| 10 | 本地资产请求 | `4xx/5xx/CORS 失败 = 0` |
| 11 | 端口被占（29878）回退 | 回退到 29879 且拉回成功 |
| 12 | 回退端口下打开同一文档 | 图片指向回退端口且加载成功 |

证据：`/tmp/lake-s3-e2e/result.json`（含每轮 `SyncResult` 与云端 key 列表）。

## 2. 逐项审计：近期改动 × 同步面

| 改动 | 会不会在「配置 S3 后」坏链/坏图/坏数据 | 结论与证据 |
| --- | --- | --- |
| **端口隔离 + 占用回退**（5dd56244） | **会**（正文绝对 URL 带端口；换实例/换端口/换设备 ⇒ 坏图 + contentHash 漂移） | **已修**（§3）。两个关键事实：① 写正文的 URL 用**实例实际端口**（`electron/store.ts:1575-1578`）；② 同步**只认文件名**、不认 URL/端口（`src/core/assetNaming.ts:183` `extractAssetRefs`）⇒ 同步传输本身端口无关，风险全在「显示/导出时用哪条 URL」。 |
| **`hasFragileUserData` / `allowBackup`**（a96632f5） | 不会 | 只改 `android/app/src/main/AndroidManifest.xml:14` 的应用属性 + 设置页文案 + 文档；不碰 DB schema / 同步协议 / 密钥存储。`allowBackup` 保持 false（原文理由见 `docs/mobile/UNINSTALL-DATA.md`）。 |
| **属性弹窗缩略图 `?w=` + token**（95a918b3） | 不会 | 档位/令牌只加在**显示 URL**上，且有护栏禁止写回正文：`src/features/preview/previewAsset.ts:41`、`src/features/editor/kernelImageThumb.ts:17`、`src/components/app/imageLoadingPolicy.test.ts`（`NoteDocPreview`/`ImageLightbox` 不得用 `withAssetWidth`）。同步读的是磁盘正文（无 `?w`/`token`）。 |
| **打包依赖迁移**（4e7a929b） | 不会 | 移走的 `@univerjs/*`/`perfect-freehand`/`rxjs` 都不被 `electron/**` 直接 import；同步真正用到的 `@aws-sdk/client-s3`、`better-sqlite3`、`electron-log`、`sharp` 仍在 `dependencies`（`npm ls --omit=dev` = 9 个）。`perfect-freehand` 由主进程间接 import（ink 导出）⇒ 已被 vite 打进 `dist-electron`，运行期不依赖 node_modules。 |
| **AI 本地专属边界** | 不会 | AI 只读本地资产/正文，不写 S3；AI 生成内容落正文时走同一渲染层保存路径（`stripAssetAccessToken` 归一化，见 §3）；AI 会话/密钥不进同步（本机库）。 |
| **update 设置** | 不会 | 更新中心独立存储 + 独立网络出口，与 S3 配置/同步队列无交叉。 |
| **移动端便携包（并行线 task-36）** | 不会（静态审计） | 便携包是**文件路径**能力（`src/mobile/settings/PortableExportBlock.tsx` / `portableImportStep.ts`），S3 配置在 Android Keystore/SharedPreferences，两者不共用键；未做设备级联跑（属 task-36 范围）。 |

## 3. 唯一代码修复：资产 URL 的端口归一化契约

**契约（三段）**：

1. **落盘/上云 = 规范端口 `19876`**（与移动端资产服务固定端口一致）：`src/lib/assetPort.ts:135`（`stripAssetAccessToken` → `normalizeLocalAssetPorts(stripped, CANONICAL_ASSET_PORT)`）。
2. **渲染/内存文档 = 本实例实际端口**：`addAssetAccessToken`（`src/lib/assetPort.ts:87`）、`withAssetAccessToken`（:51，小记缩略图/预览）、`withLocalImageThumb`（:108，`?w=` 档位）。
3. **归一化实现**（`src/core/assetUrl.ts:124`，常量 `:35`）覆盖两种真实存储形态：
   - 裸 URL：`http://127.0.0.1:19877/<noteId>/<file>`（markdown 缓存/HTML 导出/通知文本）；
   - **内核卡片 JSON 的百分号编码形态**：`http%3A%2F%2F127.0.0.1%3A19877%2F<noteId>%2F<file>`（正文图片实际存储形态；终止符要认 `%22/%27/%3C/%3E`，否则会把 `%22%7D` 吞进来）。

**安全边界**：只改「本地资产 URL」——判据 = quick-notes 空间 / uuid noteId / 带扩展名文件名；`http://127.0.0.1:19877/api/echo` 这类本机服务地址**不动**（有测试）。

**无同步 churn**：`stripAssetAccessToken` 幂等（同一正文反复保存字节不变）——否则每次端口变化都会改 contentHash、同步反复上报内容变更。

**导出兼容**：`electron/noteExport.ts:47-55` 的三个提取正则改为**端口无关**（`\d+`）——导出发生在运行实例上（dev 19877 / 回退 19878…），按当前端口匹配会静默丢光图片。

**护栏（长期防回归）**：
- `src/core/assetUrl.test.ts`：归一化 6 组用例（裸/编码/quick-notes/staging/幂等/非资产地址不动/形状收紧/规范端口默认）；
- `src/lib/assetPort.portNormalize.test.ts`：dev(19877)/回退(19878)/移动端(19876) 三视角 + 「保存回到 19876 且 token 被剥离」+ 缩略图档位。

## 4. 端到端实跑证据（本次）

| 项 | 实测 |
| --- | --- |
| S3 连接测试 | `连接成功，Bucket 可访问` |
| A 上传 | `uploaded=7, conflicts=0`（6 文档 + 1 小记）；云端 12 个对象（`objects/` + `meta/`） |
| B（新 userData、端口 29878）拉回 | `downloaded=6, conflicts=0` |
| 拉回后目录树 | `个人笔记 / 欢迎… / S3 验证文档 / S3 验证表格 / S3 验证多维表 / S3 验证画板 / S3 验证手写板` |
| 打开文档的图片 | `src=http://127.0.0.1:29878/<noteId>/<file>?token=…`、`naturalWidth=1`、`assetPort=29878`（云端正文里当时是 29876，显示侧已归一） |
| 四类编辑器 | `.usheet-univer-root canvas` / `.bitable-editor` / `.plait-board-container` / `.ink-toolbar` 全部渲染 |
| 本地资产请求 | `requests=2, bad=[], failed=[]`（无 404/403/CORS） |
| 端口回退 | 29878 被占 ⇒ 日志 `端口 29878 已被占用，尝试 29879` + `listening on :29879`，仍 `downloaded=6` |
| 回退端口下图片 | `src=http://127.0.0.1:29879/…&token=…`、`naturalWidth=1` |

## 5. 残留风险（诚实清单）

1. **云端已有非规范端口的正文**（本次 E2E 就是这种最坏情况：IPC 直写 29876）：显示侧归一化已兜住（B/C 实测），导出正则端口无关也已兜住；但若**外部工具**直接读云端对象自己拼 URL，仍会看到实例端口。建议下一步在**上传路径**规范化（见 §6）。
2. **直接 IPC 写正文绕过编辑器**（脚本/导入等）不会触发 `stripAssetAccessToken` ⇒ 端口随实例写入；显示/导出已兜住，但云端对象会带实例端口。
3. 规范端口 19876 与移动端资产服务端口绑定；若将来移动端改端口，必须同步改 `CANONICAL_ASSET_PORT`（已收敛为单一来源）。
4. 本次 E2E 用 **scheme 模式的 dev 实例**（同一份 `dist`/`dist-electron`/main/preload 代码），未做「packaged 产物 + 假 S3」联跑；打包版回归由 `docs/BUILD-SIZE.md` 的 14 项实机矩阵覆盖。

## 6. 下一步建议（小改动，可独立做）

- 在 s3v3 上传路径把正文归一化到规范端口（`electron/s3v3/s3Remote.ts` 的 `put` 调用点 / 存体适配器），让**云端对象永远规范**；本任务为避免一次改动过大没做（它属于「协议层规范化」，需要自己的单测与"不产生额外上传"的断言）。
- 移动端真机 + 假 S3 的等价 E2E（走 `src/mobile/v3` 适配器）。
