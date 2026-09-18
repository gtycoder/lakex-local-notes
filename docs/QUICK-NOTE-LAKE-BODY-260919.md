# 小记正文 v2：内核形态（260919 本批实现说明）

> 分支 `feat/quick-note-lake-editor`（worktree `../lake-notes-quicknote`，基线 = 主工作区 HEAD `f39b968`）。
> 本批 = **数据层 + 转换 + 移动端安全合成**；**桌面编辑态挂 Lake 实例**是下一步（见 §5）。
> 依据：`docs/QUICK-NOTE-LAKE-MEMORY-SPIKE-260919.md`（量化：单实例 ≈1.3~5MB 堆 / ≈5MB RSS，冷开 ≈150ms）。

---

## 1. 一句话

小记正文从「纯文本 + 图片列表」升级为**内核形态的 Lake 正文**（`.qnote` v2 的 `body`），
于是「小记 → 正式文档」从**手拼序列化**退化成**搬运 + 作用域改写**，不再依赖「内核容忍形态」。

---

## 2. 数据格式（`.qnote` v2）

```json
{
  "version": 2,
  "text": "纯文本镜像",
  "body": "<p data-lake-id=… class=\"ne-p\"><span …>纯文本镜像</span></p><p …><card type=\"inline\" name=\"image\" value=\"data:…\"/></p>",
  "images": [ { "id": "…", "filename": "…", "mimeType": "image/png", "width": 1, "height": 1, "size": 70, "hash": "…" } ]
}
```

- **`body` 是正文的唯一真相**（段落/列表/待办/引用/加粗/代码块/图片卡片都是内核形态）。
- **`text` 是派生镜像**：供时间线预览（`preview_text`）、搜索与无富文本端降级显示。桌面编辑态由内核 `getDocument("text/plain")` 抽取。
- **`images` 是资源清单**（同步/校验/转换复制文件时用），与 body 里的图片卡片一一对应。
- 版本号：`QUICK_NOTE_VERSION = 2`；`MAX_QUICK_NOTE_BODY_LENGTH = 4_000_000`。

---

## 3. 谁产出 `body`

| 入口 | body 来源 |
|---|---|
| 桌面编辑态（**下一步**） | 内核 `editor.getDocument("text/lake")`（strip 掉 asset token 后入库） |
| 其它入口（移动端输入框 / 只给 text 的调用） | 主进程用 `quickNoteBodyFromTextAndImages(text, images, imageUrl, makeId)` **合成**（见 `src/core/quickNoteModel.ts`） |

合成路径：每个物理换行 → 一个 `ne-p` 段落（空行 = 空段落），每张图片 → 一张 inline image 卡片，
`src` 指向 `http://127.0.0.1:<端口>/quick-notes/<id>/<filename>`，卡片 `from: "quick-note"`。
写入形态统一走 `src/core/lakeDocForm.ts`（媒体只走卡片容器，**绝不产出裸 `<img>`**，见 `docs/LAKE-CONTENT-WRITING.md`）。

**图片作用域改写**（保存时）：桌面编辑态插入的图片先落 staging，卡片 src 是
`/quick-notes/staging/<draftId>/…`；保存时由主进程改写成 `/quick-notes/<小记id>/…`
（`rewriteQuickNoteAssetScope`，同时处理正文里 URL-encoded 的形态 —— 卡片 value 是 `data:` + `encodeURIComponent(JSON)`）。

---

## 4. 转换：从「序列化」到「搬运」

`quickNoteToLakeContent(targetNoteId, source)` 现在只做一件事：

```
body = rewriteQuickNoteAssetScope(source.content.body, `/quick-notes/${source.id}/`, `/${targetNoteId}/`)
```

图片文件仍由既有 journal 流程复制到 `note-assets/<targetNoteId>/`（文件名不变）。
⇒ 产物字段与内核自产**完全一致**，不再有「内核容忍形态」这个隐患（旧实现手拼 `originalType/from/originWidth`，见 HANDOFF §4）。

---

## 5. 本批**没有**做的事（下一步）

1. **桌面编辑态挂 Lake 实例**（用户点名的核心）：`QuickNotesWorkspace` 的 `QuickNoteComposer` 目前仍是 `<textarea>`；
   下一步把「正在编辑的那一条」换成**一个** Lake 实例（编辑时挂、关掉即销毁，时间线卡片保持轻量），复用 `createLakeDocument(mode:"editor")` 与 `__disposeExtras` 清理链。
2. **图片上传钩子**：编辑态图片插入要走 `stageQuickNoteImage(draftId, …)`（而不是 `note-assets`），
   即给内核传自定义 `createUploadPromise`，返回 `{ url: <staging URL>, resourceRef, filename, mimeType, size }`。
   数据层已把「staging → 正式」的作用域改写做好，编辑器接上即可闭环。
3. **移动端富文本编辑**：composer 仍是输入框；保存时按 text+images 合成 body（**图片不会丢**）。
   若日后要富文本，再按同一个 `createUploadPromise` 思路接移动端实例。

---

## 6. 数据兼容（明确不做）

按 AGENTS §3 #7：**v1 `.qnote` 直接不可读**，不写迁移/兼容。开发库里现有 **7 条 v1 小记**需要删掉重建
（都是测试内容）。`validateQuickNoteContent` 现在要求 `version === 2 && typeof body === "string"`。

---

## 7. 本批改动文件

| 文件 | 改动 |
|---|---|
| `src/core/quickNoteModel.ts` | v2；`body` 字段与长度上限；`quickNoteBodyFromTextAndImages`；`rewriteQuickNoteAssetScope`；校验要求 body |
| `src/lib/types.ts` | `QuickNoteContent.body`、`SaveQuickNoteInput.body?` |
| `electron/quickNotes.ts` | 保存时：调用方给 body 就用、没给就合成；staging 作用域改写；单图校验补 body |
| `electron/quickNoteConversion.ts` | 删掉手拼序列化，改为作用域改写（搬运） |
| `src/core/quickNoteQueries.ts` | 行→文档映射带上 body |
| `src/mobile/quickNotesRepository.ts` | 移动端保存时合成 body（含图片卡片） |
| `src/testing/quickNotesSyncContract.ts`、`src/**/*.test.ts`、`electron/quickNotes.test.ts` | fixture 升 v2 |

**门禁（本批实测）**：`tsc` 0 · `vitest` **1014 passed / 16 skipped (1030)** · 桌面 `vite build` + 移动 `vite build -c vite.mobile.config.ts` 全绿。
