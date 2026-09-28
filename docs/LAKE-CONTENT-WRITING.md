# Lake 正文写入约定（写入者必读）

> 面向**所有往 `.lake` / `notes.content` 写正文的代码或脚本**：仓库内的模块、以及仓库外的自动化/压测/迁移脚本。
> 结论一句话：**不要手拼 Lake 正文；媒体（图片/附件/音视频/画板）必须让内核产出。**
> 背景与实测证据见 §2；内核契约细节见 `docs/LAKEX-CONTRACT.md`。本文件 260917 建立。

## 1. 规则（按优先级选一种）

### ①（推荐）通过应用写入路径创建/写入
- 建文档用应用 IPC（`createNote` / `createNoteIn`）或直接操作界面；
- **媒体在编辑器里插入**（粘贴 / 拖入 / slash / 工具栏）——内核自己 `uploadXxxFile + createCard(...)`，产出规范卡片（我们已有 `insertFiles` + `category` 这条实测过的路径，见 `src/features/editor/mediaCardRouting.ts` 头部注释）；
- 保存时由内核 `getDocument("text/lake")` 产出正文。

> 这条路的产物**天然**是内核序列化，不可能出现"格式不一致"。

### ②（可接受）无内核时：**只写纯文本**
主进程 / 无 DOM 环境（`electron/**`）拿不到内核，此时：
- 允许写**纯文本级**正文：`<p …class="ne-p"><br></p>`、以及手写的 `<h1>/<p>/<ul>/<table>` 这类无媒体正文；
- **实测确认无害**：纯文本的旧形态正文，内核打开时**原样保留、不重写、不产生脏点、不上传**（对照实验见 §2）。
- 但这只是"内核容忍"，不是契约 —— 内核升级可能不再容忍，所以**媒体一律不要这样写**。

### ③（仅在确实必须时）无内核 + 必须写媒体
只允许写**内核的卡片容器**，不允许裸标签：

```html
<!-- ✅ 正确：卡片容器（内核认它是本地资产，不会去"下载"） -->
<p data-lake-id="uXXXX" id="uXXXX" class="ne-p"><card type="inline" name="image"
   value="data:%7B%22src%22%3A%22http%3A%2F%2F127.0.0.1%3A19876%2F<noteId>%2F<filename>%22…%7D"></card></p>

<!-- ❌ 禁止：裸 <img>（内核会当成"远程图片"去抓，见 §2） -->
<p><img src="http://127.0.0.1:19876/<noteId>/<filename>.png" alt="x"></p>
```

必须满足：
- URL 形如 `http://127.0.0.1:19876/<noteId>/<filename>`，**不带 token**（token 由渲染侧 `addAssetAccessToken` 按需加）；资源文件必须已存在于 `note-assets/<noteId>/`；
- 字段集照 §3 附录；写完后**必须过 §4 的校验**。

## 2. 为什么（260917 实测的完整链条）

1. 自动化程序**绕过应用**直接写库 + 写 `.lake`，图片写成**裸 `<img>`** 指向本机资源服务（`http://127.0.0.1:19876/…`）。
2. 桌面端**内核打开**这种正文时，把裸 `<img>` 判为**远程图片**，走主进程 `download_remote_resource` 去抓。
3. 主进程有 **SSRF 护栏**：本机/私网地址一律拒 → `[LAKE_IPC_CODE:INVALID_INPUT] 不允许下载本机或私网地址`（日志里会刷这条）。
4. 抓取失败 → 内核把图片写成**失败态卡片**（`"src":"", "status":"error", "errorMessage":"…INVALID_INPUT…"`）并**回写正文**。
5. 回写 = `contentchange` → 脏点 → 1s 防抖自动保存 → `syncState: synced → local` → **下次同步把它上传**（等于把"图已失效"传播到其他端）。
6. 实测：`压测3-图片-神里凌华.png` 正文 438B → 1365B，`synced → local`；`温迪.png` 434B → 1363B 同理。**全库 287 篇**含裸 `<img>`（占总 511 篇的 56%），一打开就会这样。
7. 对照：**纯文本**旧形态（`压测N-076`/`压测N-057`，且已用 `tabOpen/active` 校验确实打开了）**零变化**；**卡片形式**的小记转换产物（`未命名文档 · 2026-09-17 11:22`）也**零重写**（`.lake` mtime 停在转换时刻、无脏点、无快照）。

⇒ 分界线不是"旧形态新形态"，而是**容器**：`<card name="image">` = 本地资产；裸 `<img>` = 远程资源。

## 3. 附录：内核**自产**图片卡片字段集（实测样本）

来源：真实用户文档（内核插入图片后保存的形态）。

```json
{
  "src": "http://127.0.0.1:19876/<noteId>/<filename>",
  "taskId": "u40f61662-aef3-49df-906b-408326d67c0",
  "clientId": "ubf09f772-0a91-4",
  "originalType": "binary",
  "width": 362.953125, "height": 259,
  "linkTarget": "_blank",
  "name": "<filename>", "size": 109674,
  "originWidth": 687, "originHeight": 490,
  "ratio": 1, "status": "done", "style": "stroke",
  "search": "…OCR 文本…", "ocrLocations": [ { "x": …, "y": …, "width": …, "height": …, "text": "…" } ],
  "showTitle": false, "title": "", "rotation": 0, "crop": [0,0,1,1],
  "id": "u…", "margin": { "top": true, "bottom": true }
}
```

- 外层：`<card type="inline" name="image" value="data:{encodeURIComponent(JSON)}">`。
- 小记转换器（`electron/quickNoteConversion.ts`）写的是 `originalType:"url"`、无 `width/height`、多一个 `from:"quick-note"` —— 属于 §1 的 ③，「内核容忍」而非「内核产出」。**要改成 ① 或严格对齐本附录，须先过 §4 校验。**

## 4. 校验（写完必须做）

**判据**（任一不满足即视为不合格）：
1. 打开该文档后，`.lake` 的 **mtime 不变**（没被重写）；
2. 标签上**不出现脏点**（`.tab-dirty-dot`），状态栏不因打开而从 `已同步` 变 `待同步`；
3. 未新增该文档的历史快照；
4. 正文里 `status%22%3A%22error%22` 出现次数为 0；
5. 日志无该文档相关的 `download_remote_resource` 失败。

**方法（可重复）**：`node scripts/lake-roundtrip-check.mjs --note <noteId>`（或 `--title "标题"`；都不给则用当前活动文档）。
它通过应用写入路径另建一条**临时文档**（**原件全程不打开**；正文相同、资源仍引用原件）、打开临时文档、等到稳定，再比较"创建前正文"与"打开后的正文"：

- **PASS（退出码 0）** = 逐字节一致 → 这篇安全，内核没有重写；
- **FAIL（退出码 1）** = 被改写，并打印首个差异位置与上下文（便于定位是哪种形态问题）。

注意等待口径：改写发生在**图片水合时**，实测延迟 **0.5s～7.8s 不定**，所以"正文含裸 `<img>`"这类高风险形态会等满 20s（`--wait` 可调下限）。临时文档用完自动丢回收站（`--keep` 保留）。

人工核对时仍可按上面 5 条逐条看（`.lake` 在 `workspace-default/notes/<id>.lake`）。

## 5. 反例清单（都是真出现过的）

| 反例 | 后果 |
|---|---|
| 图片写成裸 `<img src="http://127.0.0.1:19876/…">` | 打开即重写 + 图片降级失败卡片 + 待同步（287 篇） |
| 图片写成裸 `<img src="https://…">` 指向外部站点 | 会被内核当远程图抓取；内网/受限网络下同样失败，且把外部依赖带进正文 |
| 直接写库 + 写 `.lake`，绕过应用 | 不会经过应用的资源复制/校验/索引，正文形态与内核不一致（本次根因） |
