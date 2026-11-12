/**
 * task-58 · 真实七牛桶 B 档 13 条场景（S03/S05/S13/S21/S25/S28/S43/S50/S55/S58/S59/S62/S72）。
 *
 * 前置：3 个隔离桌面已起（CDP 9232/9233/9234），S3 已配置到**唯一前缀** `process.env.PREFIX`；
 * 凭据与 PREFIX 由外层 driver（run58.sh）从 /tmp/lake5/creds.env 注入，本脚本**不打印密钥**。
 *
 * 纪律：
 *  - 只在 `PREFIX/` 前缀内列举/删除对象（S28 故障注入会删本项目云端正文对象，随后按备份字节恢复）；
 *  - 每条场景独立命名（sfx 带场景号），互不污染；
 *  - 失败只登记（PASS/FAIL + 细节），不会中断后续场景；退出码 = 是否有 FAIL；
 *  - S50（锁×并发编辑）依赖 task-47；若发现锁不传播会如实 FAIL（真缺陷只登记，不改产品语义）。
 */
import { connect } from "./cdpclient.mjs";
import { createRequire } from "node:module";
import zlib from "node:zlib";
import crypto from "node:crypto";

const require = createRequire(new URL("../../package.json", import.meta.url));
const { S3Client, GetObjectCommand, PutObjectCommand, DeleteObjectCommand, ListObjectsV2Command } = require("@aws-sdk/client-s3");

const PREFIX = process.env.PREFIX;
if (!PREFIX) { console.error("缺少 PREFIX（由 run58.sh 注入唯一前缀）"); process.exit(2); }
const s3 = new S3Client({
  endpoint: process.env.S3_ENDPOINT, region: process.env.S3_REGION,
  credentials: { accessKeyId: process.env.S3_AK, secretAccessKey: process.env.S3_SK }, forcePathStyle: false,
});
const BUCKET = process.env.S3_BUCKET;
// F-01 断言用：桌面实例 userData 目录（driver 注入；只**只读**打开主库查 deleted_notes 墓碑，不写）
const USERDATA_ROOT = process.env.SCN_USERDATA_ROOT ?? "/tmp/lake5";
const INSTANCES = { D1: "s1", D2: "s2", D3: "s3" };
// better-sqlite3 的 module.exports 本身就是类（不是 ESM default 包装）
const BetterSqlite3 = require("better-sqlite3");
function openLocalDb(instance) {
  const dbPath = USERDATA_ROOT + "/" + INSTANCES[instance] + "/workspace-default/metadata.sqlite3";
  const conn = new BetterSqlite3(dbPath, { readonly: true, fileMustExist: true });
  try { conn.pragma("busy_timeout = 3000"); } catch { /* 只读连接可能不允许，忽略 */ }
  return conn;
}
/** 读该实例的 purge 墓碑（deleted_notes: id/node_type/purged_at）。 */
function purgedTombs(instance, ids) {
  const conn = openLocalDb(instance);
  try {
    const ph = ids.map(() => "?").join(",");
    return conn.prepare("SELECT id, node_type, purged_at FROM deleted_notes WHERE id IN (" + ph + ")").all(...ids);
  } finally { conn.close(); }
}

// ---------- CDP ----------
const C = {};
for (const [id, port] of [["D1", 9232], ["D2", 9233], ["D3", 9234]]) {
  try { C[id] = await connect(port, { waitMs: 60_000 }); }
  catch (e) { console.error("连接失败 " + id + ":" + e.message); process.exit(2); }
}
const ev = (id, expr) => C[id].ev(expr);

// ---------- 断言登记 ----------
const results = [];
function check(scn, name, ok, detail) {
  const row = { scn, name, ok: !!ok, detail: detail ?? "" };
  results.push(row);
  console.log("[" + scn + "] " + (ok ? "PASS" : "FAIL") + " " + name + (detail ? " | " + detail : ""));
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sfxOf = (tag) => tag + "-" + Date.now().toString(36).slice(-5);

// ---------- 同步/状态 ----------
async function sync(id) {
  try {
    const r = await ev(id, "window.lakeNative.syncNow()");
    return { ok: true, r };
  } catch (e) { return { ok: false, err: String(e && e.message || e) }; }
}
const syncBrief = (x) => x.ok ? ("up=" + x.r.uploaded + " down=" + x.r.downloaded + " pub=" + x.r.manifestId) : ("ERR " + x.err);
async function syncAll(order = ["D1", "D2", "D3"]) { const out = {}; for (const d of order) out[d] = await sync(d); return out; }
const tree = (id) => ev(id, "window.lakeNative.listTreeNodes()");
const trashOf = (id) => ev(id, "window.lakeNative.listTrash()");
const readBody = async (id, noteId) => { try { return (await ev(id, "window.lakeNative.readNote(" + JSON.stringify(noteId) + ")"))?.content ?? null; } catch { return null; } };
const readNote = async (id, noteId) => { try { return await ev(id, "window.lakeNative.readNote(" + JSON.stringify(noteId) + ")"); } catch { return null; } };
const parentOf = async (id, noteId) => (await tree(id)).find((n) => n.id === noteId)?.parentId ?? null;
const notePaths = (id, noteId) => ev(id, "window.lakeNative.getNotePaths(" + JSON.stringify(noteId) + ")");
const historyCount = async (id, noteId) => { try { return (await ev(id, "window.lakeNative.listNoteHistory(" + JSON.stringify(noteId) + ")"))?.length ?? 0; } catch { return 0; } };
const notebookId = async (id) => (await tree(id)).find((n) => n.nodeType === "notebook")?.id ?? null;
const createNote = async (id, parentId, title) => (await ev(id, "window.lakeNative.createNoteIn(" + JSON.stringify(parentId) + ", " + JSON.stringify(title) + ")")).id;
const cfgFromEnv = {
  endpoint: process.env.S3_ENDPOINT, region: process.env.S3_REGION, bucket: process.env.S3_BUCKET,
  prefix: PREFIX, accessKeyId: process.env.S3_AK, secretAccessKey: process.env.S3_SK, forcePathStyle: false,
};
const setCfg = (id, cfg) => ev(id, "window.lakeNative.saveS3Settings(" + JSON.stringify(cfg) + ")");

// ---------- 云端 ----------
const gz = (b) => { const r = Buffer.from(b); return (r[0] === 0x1f && r[1] === 0x8b ? zlib.gunzipSync(r) : r); };
async function getObj(key) { const r = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key })); return Buffer.from(await r.Body.transformToByteArray()); }
async function cloud() {
  const pointer = JSON.parse(gz(await getObj(PREFIX + "/meta/pointer.json")).toString());
  const lake = JSON.parse(gz(await getObj(PREFIX + "/meta/index/" + pointer.lake.commit + ".json")).toString());
  let quick = null;
  try { quick = JSON.parse(gz(await getObj(PREFIX + "/quick-notes/meta/index/" + pointer.quickNotes.commit + ".json")).toString()); } catch { /* 小记索引可能为空 */ }
  return { pointer, lake, quick };
}
async function listPrefix(p) {
  const out = []; let token;
  do {
    const r = await s3.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: p, ContinuationToken: token }));
    (r.Contents || []).forEach((o) => out.push({ key: o.Key, size: o.Size, etag: o.ETag, lastModified: String(o.LastModified) }));
    token = r.IsTruncated ? r.NextContinuationToken : undefined;
  } while (token);
  return out;
}
const cloudHasNote = (lake, id) => lake.notes.some((n) => n.id === id);

// ================= 场景 =================
const SCN = [];

// ---------- S55：首拉空设备（必须最早跑：D3 此刻还是空库） ----------
SCN.push({ id: "S55", run: async () => {
  const nb = await notebookId("D1");
  const kw = "s55kw" + sfxOf("w");            // 独立可检索词（完整 token，不能截断，否则 FTS 不命中）
  const n = await createNote("D1", nb, "s55-" + sfxOf("first"));
  await ev("D1", "window.lakeNative.saveNote(" + JSON.stringify(n) + ", 's55', '<p>s55-body-" + kw + "</p>')");
  await sync("D1");
  await sync("D2"); // D2 也顺带建基线
  const first = await sync("D3"); // D3 首次面对已有云端数据（App 启动会自动同步一次 ⇒ 不假设「空库」）
  const t = await tree("D3");
  const body = await readBody("D3", n);
  const caches = await ev("D3", "window.lakeNative.readNoteCaches(" + JSON.stringify(n) + ")").catch(() => null);
  const hits = await ev("D3", "window.lakeNative.searchNotes(" + JSON.stringify(kw) + ").then(function(h){return h.map(function(x){return x.id;});})").catch(() => []);
  check("S55", "首拉同步成功（无整轮失败）", first.ok, syncBrief(first));
  // 说明：App 启动即自动同步一次（syncModes.shouldSyncOnOpenClose）⇒ 「首拉前必为空」不成立，不作断言；
  // 首拉语义改按「本轮把云端全部文档/目录/正文拉全」验证（下三条），这是可观测且与自动同步无关的口径。
  check("S55", "首拉落全部文档/目录", t.some((x) => x.id === n) && t.some((x) => x.id === nb));
  check("S55", "首拉正文可读", body === "<p>" + n + "</p>" || (typeof body === "string" && body.length > 0), String(body && body.slice(0, 40)));
  check("S55", "首拉正文可被全文搜索命中（text_cache/FTS 随正文落库）", Array.isArray(hits) && hits.includes(n), "kw=" + kw + " hits=" + JSON.stringify(hits) + " plain=" + String(caches && caches.plain).slice(0, 24));
} });

// ---------- S03：本地 purge（**目录 + 子树**）→ 云端删除 + 对端留副本（含 F-01 断言） ----------
SCN.push({ id: "S03", run: async () => {
  const nb = await notebookId("D1");
  const tag = sfxOf("purge");
  const grp = (await ev("D1", "window.lakeNative.createGroup(" + JSON.stringify(nb) + ", 's03-grp-" + tag + "')")).id;
  const sub = (await ev("D1", "window.lakeNative.createGroup(" + JSON.stringify(grp) + ", 's03-sub-" + tag + "')")).id;
  const d1 = (await ev("D1", "window.lakeNative.createNoteIn(" + JSON.stringify(grp) + ", 's03-a-" + tag + "')")).id;
  const d2 = (await ev("D1", "window.lakeNative.createNoteIn(" + JSON.stringify(sub) + ", 's03-b-" + tag + "')")).id;
  await sync("D1");
  await ev("D1", "window.lakeNative.saveNote(" + JSON.stringify(d1) + ", 's03-a', '<p>s03-a-body</p>')");
  await ev("D1", "window.lakeNative.saveNote(" + JSON.stringify(d2) + ", 's03-b', '<p>s03-b-body</p>')");
  await sync("D1");
  await syncAll();
  const d2Had = (await tree("D2")).some((x) => x.id === d1) && (await tree("D2")).some((x) => x.id === d2);

  // 用户删目录（进回收站）→ 同步（回收站子树会被同步扁平化：每个 trashed 行 parent 归一成回收站容器）
  await ev("D1", "window.lakeNative.deleteTreeNode(" + JSON.stringify(grp) + ")");
  await sync("D1");
  await sync("D1");
  // 彻底删除目录 ⇒ F-01：必须按 deleted_from_parent_id 原始父链把子分组/子文档一起 purge
  await ev("D1", "window.lakeNative.purgeTrash(" + JSON.stringify(grp) + ")");
  const purgeSync = await sync("D1");
  await sync("D1");
  await sync("D2"); await sync("D3");

  const ids = [grp, sub, d1, d2];
  const lake = (await cloud()).lake;
  const folderIds = new Set((lake.folders || []).map((f) => f.id));
  const noteIds = new Set((lake.notes || []).map((n) => n.id));
  check("S03", "purge 前 D2 已持有子树全部节点", d2Had);
  check("S03", "purge 轮同步成功", purgeSync.ok, syncBrief(purgeSync));
  check("S03", "云端索引不含子树任何 id（folders ∪ notes）", ids.every((id) => !folderIds.has(id) && !noteIds.has(id)),
    JSON.stringify(ids.filter((id) => folderIds.has(id) || noteIds.has(id))));
  // 前缀对象空：正文 objects/{id}-*、附件 assets/{id}/、声明 meta/assets/{id}/
  const leftovers = [];
  for (const nid of [d1, d2]) {
    for (const pfx of ["/objects/" + nid + "-", "/assets/" + nid + "/", "/meta/assets/" + nid + "/"]) {
      const got = await listPrefix(PREFIX + pfx);
      if (got.length > 0) leftovers.push(pfx + " => " + got.length);
    }
  }
  check("S03", "云端前缀对象已清空（正文/附件/声明）", leftovers.length === 0, JSON.stringify(leftovers));
  // F-01：逐文档墓碑（目录=folder / 文档=note，purged_at 非空）
  let tombs = [];
  try { tombs = purgedTombs("D1", ids); } catch (e) { check("S03", "读取本机 purge 墓碑", false, String(e && e.message || e)); }
  const byId = new Map(tombs.map((t) => [t.id, t]));
  const wantTypes = { [grp]: "folder", [sub]: "folder", [d1]: "note", [d2]: "note" };
  const badTombs = ids.filter((id) => !byId.get(id) || !byId.get(id).purged_at || byId.get(id).node_type !== wantTypes[id]);
  check("S03", "逐文档 purge 墓碑（4 个节点，类型正确）", badTombs.length === 0,
    badTombs.map((id) => id + ":" + JSON.stringify(byId.get(id) ?? null)).join(" "));
  // 对端：只留回收站副本、正文可读、不回传
  const d2trash = (await trashOf("D2")).find((t) => t.id === d1);
  const d2body = await readBody("D2", d1);
  check("S03", "对端保留回收站副本 + 正文可读", !!d2trash && typeof d2body === "string" && d2body.length > 0);
  check("S03", "对端不回传（再同步后云端仍无任何子树 id）", !cloudHasNote((await cloud()).lake, d1));
} });

// ---------- S05：本地 trash × 他端编辑 ----------
SCN.push({ id: "S05", run: async () => {
  const nb = await notebookId("D1");
  const n = await createNote("D1", nb, "s05-" + sfxOf("trash"));
  await syncAll();
  await ev("D2", "window.lakeNative.deleteNote(" + JSON.stringify(n) + ")");       // D2 本地删（未同步）
  await ev("D1", "window.lakeNative.saveNote(" + JSON.stringify(n) + ", 's05-edit', '<p>s05-edited</p>')");
  await sync("D1");                                                                // D1 发布编辑（远端 active）
  const d2 = await sync("D2");                                                     // 历史缺口：会整轮抛 INTERNAL
  const d2trash = (await trashOf("D2")).some((t) => t.id === n);
  const d2body = await readBody("D2", n);
  await sync("D2");
  check("S05", "D2 同步不抛错（不整轮失败）", d2.ok, syncBrief(d2));
  check("S05", "D2 正文应用他端编辑", d2body === "<p>s05-edited</p>", String(d2body).slice(0, 40));
  check("S05", "D2 仍在回收站（不隐式恢复）", d2trash);
  check("S05", "云端位置已发布（trashedAt 非空）", ((await cloud()).lake.notes.find((x) => x.id === n)?.trashedAt ?? null) !== null);
  await sync("D1");
  check("S05", "D1 跟随进回收站", (await trashOf("D1")).some((t) => t.id === n));
} });

// ---------- S13：移动 × 他端编辑 ----------
SCN.push({ id: "S13", run: async () => {
  const nb = await notebookId("D1");
  const dst = (await ev("D1", "window.lakeNative.createNotebook('s13-dst-" + sfxOf("mv") + "')")).id;
  const n = await createNote("D1", nb, "s13-" + sfxOf("mv"));
  await syncAll();
  await ev("D1", "window.lakeNative.moveTreeNodeOrdered(" + JSON.stringify(n) + ", " + JSON.stringify(dst) + ", [" + JSON.stringify(n) + "])");
  await ev("D2", "window.lakeNative.saveNote(" + JSON.stringify(n) + ", 's13-edit', '<p>s13-edited</p>')");
  await sync("D2");
  const d1 = await sync("D1");
  check("S13", "D1 同步成功", d1.ok, syncBrief(d1));
  check("S13", "D1 正文=他端编辑", (await readBody("D1", n)) === "<p>s13-edited</p>");
  check("S13", "D1 位置=自己移动后的目录（不被编辑回滚）", (await parentOf("D1", n)) === dst);
  check("S13", "云端位置=移动后目录", ((await cloud()).lake.notes.find((x) => x.id === n)?.parentId) === dst);
  await sync("D2");
  check("S13", "D2 跟随移动", (await parentOf("D2", n)) === dst);
} });

// ---------- S21：双端并发编辑（远端胜 + 历史/冲突口径） ----------
SCN.push({ id: "S21", run: async () => {
  const nb = await notebookId("D1");
  const n = await createNote("D1", nb, "s21-" + sfxOf("conf"));
  await syncAll();
  await ev("D1", "window.lakeNative.saveNote(" + JSON.stringify(n) + ", 's21-A', '<p>s21-by-D1</p>')");
  await sleep(10);
  await ev("D2", "window.lakeNative.saveNote(" + JSON.stringify(n) + ", 's21-B', '<p>s21-by-D2</p>')");
  const b = await sync("D2");   // 先发布者 D2
  const a = await sync("D1");   // D1 本地编辑 vs 远端已发布 ⇒ 远端胜
  const d1body = await readBody("D1", n);
  const hist = await historyCount("D1", n);
  const lake = (await cloud()).lake;
  const superseded = a.ok ? (a.r.supersededNotes || []).some((x) => x.id === n) : false;
  check("S21", "两端同步均成功", a.ok && b.ok, "D2 " + syncBrief(b) + " / D1 " + syncBrief(a));
  check("S21", "被覆盖端正文=远端版本（先提交者胜）", d1body === "<p>s21-by-D2</p>", String(d1body).slice(0, 40));
  check("S21", "被覆盖端留历史快照", hist >= 1, "history=" + hist);
  check("S21", "冲突清单/supersededNotes 记录该篇", superseded, JSON.stringify(a.ok ? a.r.supersededNotes : a.err));
  check("S21", "索引 contentHash 唯一且为远端版本", !!lake.notes.find((x) => x.id === n)?.contentHash);
} });

// ---------- S25：本地正文文件缺失 → 云端恢复 ----------
SCN.push({ id: "S25", run: async () => {
  const nb = await notebookId("D1");
  const n = await createNote("D1", nb, "s25-" + sfxOf("miss"));
  await ev("D1", "window.lakeNative.saveNote(" + JSON.stringify(n) + ", 's25', '<p>s25-body</p>')");
  await syncAll();
  const paths = await notePaths("D1", n);
  const fs = await import("node:fs");
  let removed = false;
  try { fs.rmSync(paths.lakePath, { force: true }); removed = true; } catch { /* 文件可能在不同路径 */ }
  const missingList = await ev("D1", "window.lakeNative.listMissingBodies()").catch(() => []);
  const s1 = await sync("D1");                 // 缺正文 ⇒ 跳过上传、不整轮失败
  const restored = await ev("D1", "window.lakeNative.restoreMissingBodyFromCloud(" + JSON.stringify(n) + ")").catch((e) => ({ error: String(e && e.message || e) }));
  const body = await readBody("D1", n);
  const lake = (await cloud()).lake;
  check("S25", "正文文件已被删除（故障注入成功）", removed, String(paths && paths.lakePath));
  check("S25", "缺正文清单包含该篇", Array.isArray(missingList) && missingList.some((x) => x.id === n));
  check("S25", "缺正文同步不整轮失败", s1.ok, syncBrief(s1));
  check("S25", "云端恢复成功", !(restored && restored.error) && body === "<p>s25-body</p>", String((restored && restored.error) || body).slice(0, 60));
  check("S25", "云端正文未被空正文覆盖", !!lake.notes.find((x) => x.id === n)?.contentHash);
} });

// ---------- S28：正文对象中断 → 下轮补齐 ----------
SCN.push({ id: "S28", run: async () => {
  const nb = await notebookId("D1");
  const n = await createNote("D1", nb, "s28-" + sfxOf("intr"));
  await ev("D1", "window.lakeNative.saveNote(" + JSON.stringify(n) + ", 's28', '<p>s28-body</p>')");
  await sync("D1");
  const lake = (await cloud()).lake;
  const hash = lake.notes.find((x) => x.id === n).contentHash;
  const key = PREFIX + "/objects/" + n + "-" + hash + ".lake";
  const backup = await getObj(key);
  await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));  // 故障注入：正文对象缺失
  const d3 = await sync("D3");                                          // D3 首拉该篇 ⇒ 缺正文：warning + 跳过
  const d3body = await readBody("D3", n);
  const warned = d3.ok && (d3.r.warnings || []).some((w) => w.kind === "remote_incomplete" || (w.message || "").includes("缺正文"));
  await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: backup })); // 传输入口恢复（操作员补对象）
  const d3b = await sync("D3");
  const d3body2 = await readBody("D3", n);
  check("S28", "缺正文轮不整轮失败", d3.ok, syncBrief(d3));
  check("S28", "缺正文轮给出 warning（或明确跳过）", warned || d3body === null, JSON.stringify(d3.ok ? (d3.r.warnings || []).map((w) => w.kind) : d3.err));
  check("S28", "对象恢复后下一轮补齐且字节一致", d3b.ok && d3body2 === "<p>s28-body</p>", String(d3body2).slice(0, 40));
} });

// ---------- S43：资产上传 + 声明差集 ----------
SCN.push({ id: "S43", run: async () => {
  const draft = "s43-" + sfxOf("asset");
  const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
  const staged = await ev("D1", "(function(){var b=atob('" + png + "');var a=new Uint8Array(b.length);for(var i=0;i<b.length;i++)a[i]=b.charCodeAt(i);return window.lakeNative.stageQuickNoteImage(" + JSON.stringify(draft) + ", {bytes:a, filename:'s43.png'});})()");
  const q = await ev("D1", "window.lakeNative.createQuickNote({text:'s43-asset', draftId:" + JSON.stringify(draft) + ", stagedImageIds:[" + JSON.stringify(staged.id) + "]})");
  await sync("D1");
  const assets = await listPrefix(PREFIX + "/quick-notes/assets/" + q.id + "/");
  const qidx = (await cloud()).quick;
  const decl = await listPrefix(PREFIX + "/quick-notes/meta/assets/" + q.id + "/");
  await sync("D2");
  const d2q = (await ev("D2", "window.lakeNative.listQuickNotes()")).find((x) => x.id === q.id);
  const beforeKeys = (await listPrefix(PREFIX + "/")).map((o) => o.key).sort().join("|");
  await sync("D1"); await sync("D2");
  const afterKeys = (await listPrefix(PREFIX + "/")).map((o) => o.key).sort().join("|");
  check("S43", "云端有小记资产对象", assets.length === 1, JSON.stringify(assets.map((a) => a.key)));
  check("S43", "云端有该小记的资产声明（声明=在用集）", decl.length === 1, JSON.stringify(decl.map((d) => d.key)));
  check("S43", "索引条目带 assetsHash", qidx?.items?.some((x) => x.id === q.id && !!x.assetsHash));
  check("S43", "对端拉到图片（imageCount>=1）", !!d2q && d2q.imageCount >= 1, d2q ? "images=" + d2q.imageCount : "missing");
  check("S43", "差集生效：再同步不新增/重传对象（对象键集合不变）", beforeKeys === afterKeys);
} });

// ---------- S50：锁 × 他端连续编辑（锁必须传播） ----------
SCN.push({ id: "S50", run: async () => {
  const nb = await notebookId("D1");
  const n = await createNote("D1", nb, "s50-" + sfxOf("lock"));
  await syncAll();
  await ev("D1", "window.lakeNative.setNoteLocked(" + JSON.stringify(n) + ", true)");
  await sync("D1"); await sync("D2");
  const d2Locked0 = !!(await readNote("D2", n))?.isEditLocked;
  let allRoundsLocked = true;
  for (const v of [1, 2]) {
    await sleep(8);
    await ev("D2", "window.lakeNative.saveNote(" + JSON.stringify(n) + ", 's50-edit', '<p>s50-B-v" + v + "</p>')"); // B 未感知锁的数据层编辑
    await sync("D2");
    await sync("D1");
    const lake = (await cloud()).lake;
    if (!lake.notes.find((x) => x.id === n)?.isLocked) allRoundsLocked = false;
    await sync("D2");
    if (!(await readNote("D2", n))?.isEditLocked) allRoundsLocked = false;
  }
  const d1 = await readNote("D1", n);
  check("S50", "锁首次传播（D2 看到只读）", d2Locked0);
  check("S50", "B 连续两轮编辑期间锁仍发布/传播", allRoundsLocked);
  check("S50", "A 应用 B 的正文且仍锁", d1?.isEditLocked === true && d1?.content === "<p>s50-B-v2</p>", String(d1 && d1.content).slice(0, 40));
  check("S50", "云端索引锁字段=true", ((await cloud()).lake.notes.find((x) => x.id === n)?.isLocked) === true);
} });

// ---------- S58：发布失败重试（错误凭据 → 恢复后成功） ----------
SCN.push({ id: "S58", run: async () => {
  const nb = await notebookId("D1");
  const n = await createNote("D1", nb, "s58-" + sfxOf("retry"));
  const badCfg = { ...cfgFromEnv, secretAccessKey: cfgFromEnv.secretAccessKey.slice(0, -2) + "XX" };
  await setCfg("D1", badCfg);
  const failed = await sync("D1");
  await setCfg("D1", cfgFromEnv);
  const retried = await sync("D1");
  const lake = (await cloud()).lake;
  check("S58", "错误凭据轮失败但可分类（不静默成功）", !failed.ok, String(failed.err || "").slice(0, 80));
  check("S58", "恢复凭据后下一轮成功", retried.ok, syncBrief(retried));
  check("S58", "云端最终有该文档且正文唯一", cloudHasNote(lake, n) && !!(await readBody("D1", n)));
} });

// ---------- S59：双端同时发布（pointer 竞争） ----------
SCN.push({ id: "S59", run: async () => {
  const nb = await notebookId("D1");
  const n1 = await createNote("D1", nb, "s59-a-" + sfxOf("race"));
  const n2 = await createNote("D2", nb, "s59-b-" + sfxOf("race"));
  const [a, b] = await Promise.all([sync("D1"), sync("D2")]);
  let bothOk = a.ok && b.ok;
  if (!bothOk) { await sync("D1"); await sync("D2"); bothOk = true; } // 锁竞争允许先失败一轮（retry 覆盖在内）；这里再给一轮确认非死锁
  await sync("D1"); await sync("D2"); await sync("D1");
  const lake = (await cloud()).lake;
  const d1ids = (await tree("D1")).map((x) => x.id);
  const d2ids = (await tree("D2")).map((x) => x.id);
  check("S59", "同时发布至少一轮成功（或经重试成功）", a.ok || b.ok, "A=" + String(a.ok) + " B=" + String(b.ok));
  check("S59", "双端最终都看到两篇（无 fork 丢更新）", d1ids.includes(n1) && d1ids.includes(n2) && d2ids.includes(n1) && d2ids.includes(n2));
  check("S59", "云端索引含两篇（收敛到同一索引）", cloudHasNote(lake, n1) && cloudHasNote(lake, n2));
} });

// ---------- S62：断网中途失败 → 恢复补齐 ----------
SCN.push({ id: "S62", run: async () => {
  const nb = await notebookId("D1");
  const n = await createNote("D1", nb, "s62-" + sfxOf("net"));
  await ev("D1", "window.lakeNative.saveNote(" + JSON.stringify(n) + ", 's62', '<p>s62-body</p>')");
  await syncAll();
  const badNet = { ...cfgFromEnv, endpoint: "https://127.0.0.1:1" };
  await setCfg("D1", badNet);
  await ev("D1", "window.lakeNative.saveNote(" + JSON.stringify(n) + ", 's62', '<p>s62-body-v2</p>')");
  const offline = await sync("D1");
  await setCfg("D1", cfgFromEnv);
  const online = await sync("D1");
  await sync("D2");
  const d2body = await readBody("D2", n);
  check("S62", "断网轮失败但不崩溃（可分类错误）", !offline.ok, String(offline.err || "").slice(0, 80));
  check("S62", "恢复网络后同步成功", online.ok, syncBrief(online));
  check("S62", "恢复后对端补齐字节一致", d2body === "<p>s62-body-v2</p>", String(d2body).slice(0, 40));
} });

// ---------- S72：三端 建→改→删 ----------
SCN.push({ id: "S72", run: async () => {
  const nb = await notebookId("D1");
  const n = await createNote("D1", nb, "s72-" + sfxOf("tri"));
  await syncAll();
  await ev("D2", "window.lakeNative.saveNote(" + JSON.stringify(n) + ", 's72-edit', '<p>s72-D2-edit</p>')");
  await ev("D3", "window.lakeNative.deleteNote(" + JSON.stringify(n) + ")");
  await sync("D3");    // 删除先发布
  const d2 = await sync("D2"); // D2 编辑 vs 远端缺席 ⇒ 删除压编辑
  await sync("D1");
  await sync("D2"); await sync("D3"); await sync("D1");
  const trash = { D1: (await trashOf("D1")).some((t) => t.id === n), D2: (await trashOf("D2")).some((t) => t.id === n), D3: (await trashOf("D3")).some((t) => t.id === n) };
  const active = { D1: (await tree("D1")).some((x) => x.id === n), D2: (await tree("D2")).some((x) => x.id === n), D3: (await tree("D3")).some((x) => x.id === n) };
  const hist = await historyCount("D2", n);
  const lake = (await cloud()).lake;
  check("S72", "三端都在回收站（删除压编辑）", trash.D1 && trash.D2 && trash.D3, JSON.stringify(trash));
  check("S72", "三端都无活跃副本", !active.D1 && !active.D2 && !active.D3, JSON.stringify(active));
  check("S72", "被删侧编辑强制留历史快照（AGENTS §3#3；D2）", hist >= 1, "history=" + hist + "（plan 的 archiveLocal 只在远端缺席分支触发；trash=位置变化时走内容 upload ⇒ 未留档，登记缺陷）");
  check("S72", "云端索引无活跃条目", !cloudHasNote(lake, n) || !!lake.notes.find((x) => x.id === n)?.trashedAt);
  check("S72", "D2 同步未整轮失败", d2.ok, syncBrief(d2));
} });

// ================= 执行 =================
console.log("== task-58 真实桶 B 档 13 条 | PREFIX=" + PREFIX + " ==");
console.log("对象数（开始）: " + (await listPrefix(PREFIX + "/")).length);
const t0 = Date.now();
for (const s of SCN) {
  const t = Date.now();
  try { await s.run(); }
  catch (e) { check(s.id, "场景执行异常", false, String(e && e.stack || e).split("\n").slice(0, 3).join(" / ")); }
  console.log("[" + s.id + "] 耗时 " + (Date.now() - t) + "ms");
}
const objects = await listPrefix(PREFIX + "/");
const failed = results.filter((r) => !r.ok);
console.log("\n== SUMMARY " + (results.length - failed.length) + "/" + results.length + " 断言 PASS，场景 " + SCN.length + " 条，总耗时 " + Math.round((Date.now() - t0) / 1000) + "s ==");
if (failed.length) {
  console.log("FAILED:");
  for (const f of failed) console.log(" - [" + f.scn + "] " + f.name + " | " + f.detail);
}
console.log("PREFIX=" + PREFIX + " 对象数（结束）=" + objects.length + "（清理由 driver 的 DELPREFIX 完成）");
for (const c of Object.values(C)) { try { c.close(); } catch { /* ignore */ } }
process.exit(failed.length ? 1 : 0);