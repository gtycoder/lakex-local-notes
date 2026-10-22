/**
 * 造一份**合成夹具**（scripts/css-audit 用；不含任何真实数据）。
 *
 * 为什么要它：快照基线 = 代码 × 数据。夹具若用「开发数据的副本」，用户每次增删文档都会让**所有态一起漂**
 * （实测少 2 篇 = 每态 −40 元素），逼着整份重烤。合成夹具把数据这份输入钉死：怎么改自己的库都不影响基线。
 *
 * 用法（README「夹具必须钉住」）：
 *   1) 空用户目录起一个实例：
 *      RUN=/tmp/lake-fixture-build; rm -rf "$RUN"
 *      env -u ELECTRON_RUN_AS_NODE LAKE_USER_DATA="$RUN" LAKE_ASSET_PORT=19810 \
 *        ./node_modules/.bin/electron --disable-gpu --remote-debugging-port=9231 .
 *   2) node scripts/css-audit/drive.mjs 9231 scripts/css-audit/make-fixture.mjs
 *   3) 结束实例 → 把 $RUN 冻到 ~/Library/Caches/local-lakex-notes-css-audit/fixture（**整份重烤一次**基线）
 * 注意：笔记 id 是 uuid ⇒ **每次重新生成都会换一套 id**，所以重新生成后必须整份重烤。
 */

/** 1×1 PNG（确定性字节；用于造"在正文里被引用 / 只被历史引用 / 纯孤儿 / 缺文件"四种资产）。 */
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

/** Lake 正文：id 用固定的 u+hex（快照会把 u<hex> 排除出 key，稳定）。 */
let seq = 0;
const uid = () => "u" + (0x100000 + (seq++ * 0x1111)).toString(16);
const span = (text) => { const id = uid(); return `<span data-lake-id="${id}" id="${id}">${text}</span>`; };
const p = (inner) => { const id = uid(); return `<p data-lake-id="${id}" id="${id}">${inner}</p>`; };
const h = (tag, text) => { const id = uid(); return `<${tag} data-lake-id="${id}" id="${id}">${span(text)}</${tag}>`; };
const li = (text) => { const id = uid(); return `<li data-lake-id="${id}" id="${id}">${span(text)}</li>`; };

export default async ({ page }) => {
  const api = async (expr) => {
    const out = await page.evaluate(`(async () => { try { const v = await (${expr}); return v === undefined ? "__void__" : JSON.stringify(v); } catch (e) { return JSON.stringify({ __error: String(e && e.message || e) }); } })()`);
    if (out === "__void__") return undefined;
    const parsed = JSON.parse(out);
    if (parsed && parsed.__error) throw new Error(expr + " → " + parsed.__error);
    return parsed;
  };
  const log = (...a) => console.log("  [fixture]", ...a);
  const summary = { notes: {}, assets: {}, trash: [], quickNotes: [] };

  // 0) 干净起步：删掉空库自带的欢迎笔记（免得它出现在树里影响 rows[0]/[1] 的定位）
  const boot = await api("window.lakeNative.bootstrap()");
  const welcome = (boot.tree || []).find((n) => n.type === "note" || n.nodeType === "note");
  if (welcome && welcome.id) {
    try { await api(`window.lakeNative.deleteNote("${welcome.id}")`); log("已移除自带欢迎笔记"); }
    catch (e) { log("移除欢迎笔记失败（忽略）:", e.message); }
  }
  const notebooks = (boot.tree || []).filter((n) => (n.type || n.nodeType) === "notebook");
  const rootId = notebooks[0] ? notebooks[0].id : null;
  const notebook = await api('window.lakeNative.createNotebook("合成夹具")');
  const parentId = notebook && notebook.id ? notebook.id : rootId;
  log("根目录:", parentId);

  // 1) 富文本文档（含标题/列表/代码/表格/图片，覆盖编辑器外围与卡片样式）
  const rich = await api(`window.lakeNative.createNoteIn(${JSON.stringify(parentId)}, "合成·富文本")`);
  summary.notes.rich = rich.id;
  const imgA = await api(`window.lakeNative.uploadResource({ bytes: Uint8Array.from(atob("${PNG}"), c => c.charCodeAt(0)), filename: "fixture-a.png" }, "${rich.id}")`);
  summary.assets.referenced = imgA.filename;
  const richBody = [
    h("h1", "合成夹具 · 富文本"),
    p(span("正文用于覆盖排版：") + span("加粗占位") + span("、斜体占位、行内代码占位。")),
    `<ul>${li("列表项一")}${li("列表项二（含「记」字，供搜索态使用）")}</ul>`,
    h("h2", "代码块"),
    `<pre data-language="javascript" data-lake-id="${uid()}" id="${uid()}"><code>const fixture = true; // code block</code></pre>`,
    h("h2", "表格"),
    `<table data-lake-id="${uid()}" id="${uid()}"><tbody><tr><td data-lake-id="${uid()}" id="${uid()}">${span("甲")}</td><td data-lake-id="${uid()}" id="${uid()}">${span("乙")}</td></tr><tr><td data-lake-id="${uid()}" id="${uid()}">${span("丙")}</td><td data-lake-id="${uid()}" id="${uid()}">${span("丁")}</td></tr></tbody></table>`,
    h("h2", "图片"),
    p(`<img src="${imgA.url}" data-lake-id="${uid()}" id="${uid()}">`),
  ].join("");
  await api(`window.lakeNative.saveNote(${JSON.stringify(rich.id)}, "合成·富文本", ${JSON.stringify(richBody)})`);
  log("富文本文档就绪");

  // 2) 第二篇（rows[1] 的定位对象）+ 一篇表格
  const second = await api(`window.lakeNative.createNoteIn(${JSON.stringify(parentId)}, "合成·第二篇")`);
  summary.notes.second = second.id;
  await api(`window.lakeNative.saveNote(${JSON.stringify(second.id)}, "合成·第二篇", ${JSON.stringify(h("h1", "合成·第二篇") + p(span("第二篇正文，含「记」字。")))})`);
  const usheet = await api(`window.lakeNative.createUsheetIn(${JSON.stringify(parentId)}, "合成·表格")`);
  summary.notes.usheet = usheet.id;
  const bitable = await api(`window.lakeNative.createBitableIn(${JSON.stringify(parentId)}, "合成·多维表")`);
  summary.notes.bitable = bitable.id;
  const board = await api(`window.lakeNative.createBoardIn(${JSON.stringify(parentId)}, "合成·画板")`);
  summary.notes.board = board.id;
  log("第二篇 / 表格 / 多维表 / 画板就绪");

  // 3) 只被历史引用的资产：先引用 + 存快照，再从正文去掉 ⇒ 资源页「历史保护」
  const historyAsset = await api(`window.lakeNative.uploadResource({ bytes: Uint8Array.from(atob("${PNG}"), c => c.charCodeAt(0)), filename: "fixture-history.png" }, "${second.id}")`);
  summary.assets.history = historyAsset.filename;
  await api(`window.lakeNative.saveNote(${JSON.stringify(second.id)}, "合成·第二篇", ${JSON.stringify(h("h1", "合成·第二篇") + p(span("含「记」字与一张稍后会被移除的图：") + `<img src="${historyAsset.url}">`))})`);
  await api(`window.lakeNative.createHistorySnapshot(${JSON.stringify(second.id)}, undefined, true)`);
  await api(`window.lakeNative.saveNote(${JSON.stringify(second.id)}, "合成·第二篇", ${JSON.stringify(h("h1", "合成·第二篇") + p(span("第二篇正文，含「记」字。")))})`);
  log("历史保护资产就绪:", historyAsset.filename);

  // 4) 纯孤儿（上传但从不引用）
  const orphan = await api(`window.lakeNative.uploadResource({ bytes: Uint8Array.from(atob("${PNG}"), c => c.charCodeAt(0)), filename: "fixture-orphan.png" }, "${rich.id}")`);
  summary.assets.orphan = orphan.filename;
  log("纯孤儿就绪:", orphan.filename);

  // 5) 缺失：登记成孤儿后，把文件从磁盘删掉（由外层脚本按 summary 处理）
  const missing = await api(`window.lakeNative.uploadResource({ bytes: Uint8Array.from(atob("${PNG}"), c => c.charCodeAt(0)), filename: "fixture-missing.png" }, "${rich.id}")`);
  summary.assets.missing = missing.filename;
  summary.notes.missingOwner = rich.id;
  log("待删除以造成「缺失」:", missing.filename);

  // 6) 回收站：两篇**同名**文档（覆盖「多篇重名 ⇒ 分组 key 不能只用 title」这条回归）
  const trashedA = await api(`window.lakeNative.createNoteIn(${JSON.stringify(parentId)}, "合成·回收站")`);
  const trashedB = await api(`window.lakeNative.createNoteIn(${JSON.stringify(parentId)}, "合成·回收站")`);
  for (const [note, tag] of [[trashedA, "a"], [trashedB, "b"]]) {
    const asset = await api(`window.lakeNative.uploadResource({ bytes: Uint8Array.from(atob("${PNG}"), c => c.charCodeAt(0)), filename: "fixture-trash-${tag}.png" }, "${note.id}")`);
    await api(`window.lakeNative.saveNote(${JSON.stringify(note.id)}, "合成·回收站", ${JSON.stringify(h("h1", "合成·回收站") + p(`<img src="${asset.url}">`))})`);
    await api(`window.lakeNative.deleteNote(${JSON.stringify(note.id)})`);
    summary.trash.push({ id: note.id, asset: asset.filename });
  }
  log("回收站两篇同名文档就绪");

  // 7) 小记（覆盖小记空间/列表样式）
  for (let i = 1; i <= 2; i++) {
    const qn = await api(`window.lakeNative.createQuickNote({ text: "合成小记 ${i}（含「记」字）", draftId: "fixture-draft-${i}", stagedImageIds: [] })`);
    summary.quickNotes.push(qn.id);
  }
  log("小记两篇就绪");

  console.log("  [fixture] SUMMARY " + JSON.stringify(summary));
  return summary;
};
