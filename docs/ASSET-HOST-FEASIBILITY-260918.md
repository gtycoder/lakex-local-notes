# 附件层能否交给 CloudFlare-ImgBed —— 可行性调研（260918）

> **命题（用户）**：把 [CloudFlare-ImgBed](https://github.com/MarSeventh/CloudFlare-ImgBed)（下称 ImgBed）内嵌进来，用它的图床能力管理笔记附件，底层存储仍放当前 S3，前端显示功能简化，从而"解放"我们在自研附件管理上的投入。
>
> **结论：不建议替换 / 内嵌。** ImgBed 不是"附件服务"，而是一个**自带索引与用户体系的独立文件托管 Web 应用**。让它接管我们的资产层，等于把"清单是唯一真相"改成"清单 + ImgBed 索引双真相"，同时破坏离线、跨端与现有 GC 的全部前提；工作量约 **4–7 周**，且长期维护成本更高。真正可取的只有两条小路：**旁路部署只做分享/外链**（0.5–1 人日）与**借它的 S3 分片实现补我们的大文件上传**（1–3 人日）。
>
> 本文只做事实与判断，不含任何代码改动。

---

## 1. 先回答"我们不是有一个附件服务吗"

有，而且是三层，中心不是"上传/浏览"，而是**"清单声明 = 云端存在"这条不变量**：

| 层 | 位置 | 职责 |
|---|---|---|
| 本地资源服务 | `electron/assetServer.ts`（`127.0.0.1:19876`） | Range（音视频 seek / PDF 分页）、MIME 嗅探、CORS+token、webp→png base64；小记/草稿独立路径 |
| 本地落盘与护栏 | `electron/resourceRepository.ts`、`src/core/assetNaming.ts` | `buildAssetFilename` = `{13位时间戳}_{8位hash}.ext`；图片像素/体积护栏、附件 25MiB 协议上限、SSRF 逐跳校验；`orphan_assets` 登记 |
| 云端资产管线 | `electron/sync.ts`、`syncAdapters.ts`、`syncGc.ts` | `manifest.assets[]`（size+sha256）全量声明；`declared_assets` 差集上传（禁逐对象 HEAD）；GC keep-set + 年龄保护 + `s3_gc_pending/log` + 深度清理 |
| 契约 | `docs/SYNC-PROTOCOL.md` §2/§4.5、`docs/S3-GC-DESIGN.md`、`docs/STORAGE-LAYERS.md`、`AGENTS.md` §3 #11 | `assets/{noteId}/{filename}`，filename 不可变 + 内容寻址校验；存在性 = 远端清单声明差集 |

ImgBed 恰好会破坏这条不变量（见 §3.1）。

---

## 2. ImgBed 的事实（读上游源码得到，非文档口径）

- **形态**：Cloudflare Pages Functions 应用。Docker 版由 `deploy/server/index.js`（Hono + `@hono/node-server`）在 Node 里**模拟** CF 环境：`globalThis.caches`、D1（`deploy/server/sqliteD1.js` = better-sqlite3 实现 D1 接口）、本地 R2（`r2Storage.js`）；运行时需要**整个仓库树**（`FUNCTIONS_DIR=<root>/functions`、`database/init.sql`）与 `data/database.sqlite`，默认端口 8080。
- **元数据 = 自己的索引库**：`database/init.sql` 的 `files` 表（id/file_name/directory/channel/file_size/timestamp/label/tags…）就是文件索引，按 KV 语义读写（`functions/utils/d1Database.js`：`putFile/getFile/listFiles`）。
- **S3 渠道**：`functions/upload/index.js` 用 `@aws-sdk/client-s3` 直接 `PutObjectCommand`，**Key = ImgBed 文件 id = 目录+文件名**，并把 `S3FileKey` 写进索引；读取走 `GetObjectCommand`（`functions/file/[[path]].js`）、删除走 `DeleteObjectCommand`（`functions/api/manage/delete/[[path]].js`）、大文件走 multipart（`functions/upload/chunkUpload.js`）。
- **没有"从桶重建索引"的路径**：抽查全部 S3 触点（上传/读取/删除/分片）都只做定点对象操作，未使用 ListObjects；文档里的 `action=rebuild` 是"**重建查询索引以提高查询性能**"，不是从桶对账。
- **元数据里没有内容 hash**（只有 `File-Size` / `File-Mime` / `TimeStamp` / `S3FileKey`）。
- 自带用户端/管理端认证、API Token、内容审查、CDN 缓存清理、**远端遥测（默认开，后台可关）**。
- **前端是另一个仓库**（`MarSeventh/Sanyue-ImgHub`，Vue，MIT）；ImgBed 本仓库只提交构建产物 `frontend-dist/`。⇒ "显示功能简化" = fork/重写前端仓库，或原样 iframe。
- 许可：ImgBed 与前端均 MIT（无授权障碍）；上游活跃（6.5k stars，最近推送 2026-09-11）。

---

## 3. 冲突清单（按严重度）

1. **双真相源（致命）**：我们的口径是"manifest 声明⇒存在；禁逐对象 HEAD、禁止本机/远端持久缓存"（AGENTS §3 #11）。ImgBed 的 `files` 表正是第二个权威索引，且**不可从桶重建** ⇒ 它丢库/回滚/清空后，S3 对象还在而 ImgBed 认为不存在；反向地，我们 GC 按差集删掉的对象仍在它索引里 ⇒ `/file/...` 404。两套系统必须**持续对账**，而这份对账比现在"只有清单一个真相"更重。
2. **GC 归属冲突**：`S3-GC-DESIGN` 的 keep-set / 年龄保护 / `s3_gc_pending` 审计 / 深度清理都建立在"能全量列举自己的前缀"上（`sync.ts:475-477`、`syncGc.ts:43-46`、`quickNotesSync.ts:185-186`）。交给 ImgBed 后，删除要么绕过它（索引变脏），要么绕过我们的审计（账实不符）。**不是简化，是把一个 GC 变成两个。**
3. **完整性校验丢失**：协议 §4.5 要求资源 size+sha256 校验、不符即拒绝；ImgBed 元数据没有 hash。要么给上游打补丁（每次升级重打），要么放弃校验（安全退化）。
4. **离线与本地优先退化**：正文图片 canonical URL 是 `http://127.0.0.1:19876/{noteId}/{file}`，可离线；走 ImgBed 则读取依赖服务在线。移动端（Capacitor，无 Electron 主进程）还要额外解决"连到哪台机器的 8080 端口"。这与"本地是真相"直接对撞。
5. **内嵌成本被低估**：需随包携带 ImgBed 服务端 + 前端产物 + 其 node_modules（hono / @hono/node-server / better-sqlite3 / sharp / @aws-sdk/client-s3），以**子进程**方式跑（CF Functions 兼容 loader，不是普通库）；还要管端口、数据目录、DB 迁移（`database/migrations/`）、它自己的用户/Token/遥测开关，以及**跟随上游升级**。
6. **能力正交**：它最有价值的几项（媒体库浏览、分享外链、公开图库、随机图、WebDAV、图片变换、内容审查）与"笔记附件同步"是**正交**需求；为这些能力替换整条同步资产管线，收益/风险完全不成比例。

---

## 4. 工作量估算

| 形态 | 内容 | 估时 | 结论 |
|---|---|---|---|
| **A. 内嵌并替换现有资产层** | 打包启动 ImgBed 服务 3–5d；上传改造（目录/命名对齐、失败重试、并发≤8、25MiB 以上走分片）3–5d；读取/离线策略重做 5–10d；GC 与双真相源对账 5–8d；sha256 校验补齐 2–5d；"显示简化"0.5–10d（取决于是否 fork 前端仓库）；跨端 + 1011 用例回归 8–15d | **约 4–7 周**，长期维护成本上升 | ❌ 不推荐 |
| **B. 旁路部署（同桶、独立前缀）** | Docker 起 ImgBed，S3 渠道指向同一桶但**只用 `imgbed/` 前缀**；用途限"分享外链 / 公开图库 / WebDAV / 随机图"；应用内加"复制外链"入口 | 0.5–1 人日 | ✅ 想要"图床能力"就走这条 |
| **C. 只借实现：S3 分片上传** | 参考 `functions/upload/chunkUpload.js` 自己实现 multipart，提升 25MiB 上限（对应 HANDOFF §3 已有待办"附件大文件 S3 分片"） | 1–3 人日 | ✅ 零新运行时 |
| **D. 维持现状** | 现有 `orphan_assets` + 资源管理视图 + 云端 GC 已覆盖增删查清理 | 0 | ✅ 默认 |

> **B 为什么安全**：我们的云端枚举只发生在 `objects/`、`assets/`、`manifests/`、`quick-notes/`（均在 `settings.prefix` 之内），独立顶层前缀不会被误扫。
> **B 的硬前提**：两边**永不写同一批对象**——一旦把笔记附件也经 ImgBed 上传，就退化成形态 A 的双真相源问题。

---

## 5. 若仍要做 A，先过这几道闸（POC 验收点）

1. 证明 ImgBed 的 `files` 索引能在"桶被我们 GC 删过对象"或"索引库丢失"后自愈（当前看**不能**）——这一条过不了，"替换"就不成立。
2. 证明 100 万附件量级下 `files` 表 + `list` 分页 / `count=-1` 统计可用。
3. 明确 hash：接受放弃 sha256 校验，还是维护上游补丁。
4. 明确"谁的删除说了算"，并写出与 `S3-GC-DESIGN` 等价的新契约文档（否则就是隐性协议变更）。
5. 移动端 / 离线的阅读路径定稿。

---

## 6. 证据来源

- **上游**：仓库 tree；`package.json`、`docker-compose.yml`；`deploy/server/{index.js,sqliteD1.js,r2Storage.js}`；`database/init.sql`；`functions/utils/d1Database.js`；`functions/upload/{index.js,chunkUpload.js,uploadTools.js}`；`functions/file/[[path]].js`；`functions/api/manage/delete/[[path]].js`；官方文档 <https://cfbed.sanyue.de/deployment/configuration.html>、<https://cfbed.sanyue.de/api/>、<https://cfbed.sanyue.de/api/list.html>
- **本仓库**：`electron/assetServer.ts`、`electron/resourceRepository.ts`、`electron/syncGc.ts`、`electron/sync.ts`、`docs/SYNC-PROTOCOL.md`、`docs/S3-GC-DESIGN.md`、`docs/STORAGE-LAYERS.md`、`AGENTS.md` §3 #11、`HANDOFF.md` §3
