import { connect } from './cdpclient.mjs';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import zlib from 'node:zlib';
import { createRequire } from 'node:module';
const require = createRequire('/Users/admin/file/local-lake/lake-notes-electron/package.json');
const Database = require('better-sqlite3');
const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
const ADB = '/opt/homebrew/share/android-commandlinetools/platform-tools/adb';
const ENDS = [
  { id: 'D1', type: 'desktop', port: 9232 },
  { id: 'D2', type: 'desktop', port: 9233 },
  { id: 'D3', type: 'desktop', port: 9234 },
  { id: 'R', type: 'android', port: 9235, serial: '50950385' },
  { id: 'E', type: 'android', port: 9236, serial: 'emulator-5554' }
];
const C = {};
for (const e of ENDS) C[e.id] = await connect(e.port);
const results = [];
function check(name, ok, detail) { results.push({ name, ok }); console.log('  ' + (ok ? 'PASS' : 'FAIL') + ' ' + name + (detail ? ' | ' + detail : '')); }
function find(id) { return ENDS.find(function (e) { return e.id === id; }); }
function ev(id, expr) { return C[id].ev(expr); }
const IDS = ENDS.map(function (e) { return e.id; });
async function sync(id) { return ev(id, 'window.lakeNative.syncNow()'); }
async function syncAll(creator) {
  const order = [creator].concat(IDS.filter(function (x) { return x !== creator; }));
  const log = {};
  for (const id of order) { const r = await sync(id); log[id] = r; }
  return log;
}
function pullMobile(e) {
  const dir = '/tmp/lake5/db-' + e.serial; fs.mkdirSync(dir, { recursive: true });
  for (let i = 0; i < 3; i++) {
    try {
      for (const f of ['lake-notes-mobileSQLite.db', 'lake-notes-mobileSQLite.db-wal']) {
        const b = execSync(ADB + ' -s ' + e.serial + ' exec-out run-as com.lakenotes.mobile cat databases/' + f, { maxBuffer: 200 * 1024 * 1024 });
        fs.writeFileSync(dir + '/' + f, b);
      }
      break;
    } catch (err) { if (i === 2) throw err; }
  }
  const db = new Database(dir + '/lake-notes-mobileSQLite.db', { readonly: true });
  try { return db.prepare('SELECT id,title,doc_kind,content,trashed_at FROM notes').all().map(function (r) { return { id: String(r.id), title: String(r.title), kind: r.doc_kind || 'doc', content: String(r.content), trashed: !!r.trashed_at }; }); }
  finally { db.close(); }
}
async function mobileActive(e) { return ev(e.id, 'window.lakeNative.listNotes().then(function(n){return n.map(function(x){return {id:x.id,title:x.title};});})'); }
async function mobileTrash(e) { return ev(e.id, 'window.lakeNative.listTrashTree().then(function(t){return t.filter(function(x){return x.kind==="note";}).map(function(x){return {id:x.id,title:x.title};});})'); }
async function notes(id) {
  const e = find(id);
  if (e.type === 'desktop') return ev(id, 'window.lakeNative.listTreeNodes().then(function(t){return t.filter(function(n){return n.nodeType==="note";}).map(function(n){return {id:n.id,title:n.title,kind:n.kind||"doc"};});})');
  const live = await mobileActive(e);
  const db = pullMobile(e);
  const kindById = {}; db.forEach(function (n) { kindById[n.id] = n.kind; });
  return live.map(function (n) { return { id: n.id, title: n.title, kind: kindById[n.id] || 'doc' }; });
}
async function trashed(id) {
  const e = find(id);
  if (e.type === 'desktop') return ev(id, 'window.lakeNative.listTrash().then(function(t){return t.map(function(x){return {id:x.id,title:x.title};});})');
  return mobileTrash(e);
}
async function contentOf(id, noteId) {
  const e = find(id);
  if (e.type === 'desktop') return ev(id, 'window.lakeNative.readNote(' + JSON.stringify(noteId) + ').then(function(n){return n.content;})');
  const row = pullMobile(e).find(function (n) { return n.id === noteId; });
  return row ? row.content : '';
}
async function quickInv(id) { return ev(id, 'window.lakeNative.listQuickNotes().then(function(q){return q.map(function(x){return {id:x.id,text:x.previewText};});})'); }
function activeMap(list) { const m = {}; for (const n of list) m[n.id] = n.kind + '|' + n.title; return m; }
function canon(m) { return Object.keys(m).sort().map(function (k) { return k + '=' + m[k]; }).join(';'); }

console.log('== Phase 1: kind propagation (D1 -> all) ==');
const tree = await ev('D1', 'window.lakeNative.listTreeNodes()');
const nbId = (tree.find(function (n) { return n.nodeType === 'notebook'; }) || {}).id || null;
const sfx = String(Date.now()).slice(-6);
const doc = await ev('D1', 'window.lakeNative.createNoteIn(' + JSON.stringify(nbId) + ', "p1-doc-' + sfx + '")');
const sheet = await ev('D1', 'window.lakeNative.createSheetIn(' + JSON.stringify(nbId) + ', "p1-sheet-' + sfx + '")');
const bitable = await ev('D1', 'window.lakeNative.createBitableIn(' + JSON.stringify(nbId) + ', "p1-bitable-' + sfx + '")');
const board = await ev('D1', 'window.lakeNative.createBoardIn(' + JSON.stringify(nbId) + ', "p1-board-' + sfx + '")');
const quick1 = await ev('D1', 'window.lakeNative.createQuickNote({text:"p1-quick-' + sfx + '", draftId:"p1-' + sfx + '", stagedImageIds:[]})');
console.log('  ids: doc=' + doc.id.slice(0,8) + ' sheet=' + sheet.id.slice(0,8) + ' bitable=' + bitable.id.slice(0,8) + ' board=' + board.id.slice(0,8) + ' quick=' + quick1.id.slice(0,8));
const cases = [{ id: doc.id, kind: 'doc' }, { id: sheet.id, kind: 'sheet' }, { id: bitable.id, kind: 'bitable' }, { id: board.id, kind: 'board' }];
await syncAll('D1');
for (const id of IDS) {
  const ns = await notes(id);
  for (const c of cases) { const row = ns.find(function (n) { return n.id === c.id; }); check(id + ' kind ' + c.kind, !!row && row.kind === c.kind, row ? row.kind : 'missing'); }
  check(id + ' quick', (await quickInv(id)).some(function (q) { return q.id === quick1.id; }));
}

console.log('== Phase 2: multi-writer creation (D2,D3,R doc + E quick) ==');
const d2doc = await ev('D2', 'window.lakeNative.createNoteIn(' + JSON.stringify(nbId) + ', "p2-doc-D2-' + sfx + '")');
const d3doc = await ev('D3', 'window.lakeNative.createNoteIn(' + JSON.stringify(nbId) + ', "p2-doc-D3-' + sfx + '")');
const rdoc = await ev('R', 'window.lakeNative.createNote("p2-doc-R-' + sfx + '", null)');
const equickId = await ev('E', 'window.lakeNative.createQuickNote("p2-quick-E-' + sfx + '")');
console.log('  equickId=' + String(equickId).slice(0,8));
for (const id of ['D2', 'D3', 'R', 'E']) { const sr = await sync(id); if (id === 'E') console.log('  E sync result quickNotes=' + JSON.stringify(sr && sr.quickNotes) + ' msg=' + (sr && sr.message)); }
await syncAll('D1');
for (const id of IDS) {
  const ns = await notes(id);
  check(id + ' has D2doc', ns.some(function (n) { return n.id === d2doc.id; }));
  check(id + ' has D3doc', ns.some(function (n) { return n.id === d3doc.id; }));
  check(id + ' has Rdoc', ns.some(function (n) { return n.id === rdoc.id; }));
  check(id + ' has Equick', (await quickInv(id)).some(function (q) { return q.id === equickId; }));
}

console.log('== Phase 3: metadata edit LWW (D1 renames D2 doc) ==');
const p3title = 'p3-renamed-by-D1-' + sfx;
await ev('D1', 'window.lakeNative.renameTreeNode(' + JSON.stringify(d2doc.id) + ', ' + JSON.stringify(p3title) + ')');
await syncAll('D1');
for (const id of IDS) { const row = (await notes(id)).find(function (n) { return n.id === d2doc.id; }); check(id + ' title LWW', !!row && row.title === p3title, row ? row.title : 'missing'); }

console.log('== Phase 4: delete propagation (D3 trashes bitable) ==');
await ev('D3', 'window.lakeNative.deleteNote(' + JSON.stringify(bitable.id) + ')');
await syncAll('D3');
for (const id of IDS) {
  check(id + ' bitable trashed', (await trashed(id)).some(function (x) { return x.id === bitable.id; }));
  check(id + ' bitable not active', !(await notes(id)).some(function (n) { return n.id === bitable.id; }));
}

console.log('== Phase 5: restore propagation (R restores bitable) ==');
await ev('R', 'window.lakeNative.restoreNote(' + JSON.stringify(bitable.id) + ')');
await syncAll('R');
for (const id of IDS) { const row = (await notes(id)).find(function (n) { return n.id === bitable.id; }); check(id + ' bitable active', !!row && row.kind === 'bitable', row ? row.kind : 'missing'); }

console.log('== Phase 6: content conflict, first-committer-wins (doc) ==');
await ev('D1', 'window.lakeNative.saveNote(' + JSON.stringify(doc.id) + ', "p6-doc", "<p>p6-D1-wins-' + sfx + '</p>")');
await ev('D2', 'window.lakeNative.saveNote(' + JSON.stringify(doc.id) + ', "p6-doc", "<p>p6-D2-loses-' + sfx + '</p>")');
await sync('D1');
const d2res = await sync('D2');
check('D2 superseded recorded', Array.isArray(d2res.supersededNotes) && d2res.supersededNotes.some(function (x) { return (x && x.id) === doc.id; }), JSON.stringify(d2res.supersededNotes));
await syncAll('D1');
for (const id of IDS) { const c = await contentOf(id, doc.id); check(id + ' doc content converged', c.indexOf('p6-D1-wins') >= 0, c.slice(0, 24)); }

console.log('== Phase 7: quick-note edit propagation (E edits Equick) ==');
await ev('E', 'window.lakeNative.saveQuickNote(' + JSON.stringify(equickId) + ', "p7-edited-by-E-' + sfx + '")');
await syncAll('E');
for (const id of IDS) { const row = (await quickInv(id)).find(function (q) { return q.id === equickId; }); check(id + ' quick text', !!row && String(row.text).indexOf('p7-edited-by-E') >= 0, row ? String(row.text).slice(0, 24) : 'missing'); }

console.log('== Phase 8: cloud manifest integrity ==');
const prefix = process.env.PREFIX;
const s3 = new S3Client({ endpoint: process.env.S3_ENDPOINT, region: process.env.S3_REGION, credentials: { accessKeyId: process.env.S3_AK, secretAccessKey: process.env.S3_SK }, forcePathStyle: false });
const got = await s3.send(new GetObjectCommand({ Bucket: process.env.S3_BUCKET, Key: prefix + '/manifests/latest.json' }));
let bytes = Buffer.from(await got.Body.transformToByteArray());
if (bytes[0] === 0x1f && bytes[1] === 0x8b) bytes = zlib.gunzipSync(bytes);
const manifest = JSON.parse(bytes.toString('utf8'));
check('manifest version 7', manifest.version === 7, String(manifest.version));
for (const c of cases) { const m = manifest.notes.find(function (n) { return n.id === c.id; }); const gotKind = m ? (m.kind || 'doc') : 'missing'; check('manifest kind ' + c.kind, gotKind === c.kind, gotKind); }
const qman = await s3.send(new GetObjectCommand({ Bucket: process.env.S3_BUCKET, Key: prefix + '/quick-notes/manifests/latest.json' }));
let qb = Buffer.from(await qman.Body.transformToByteArray());
if (qb[0] === 0x1f && qb[1] === 0x8b) qb = zlib.gunzipSync(qb);
const qm = JSON.parse(qb.toString('utf8'));
check('quick manifest has Equick', JSON.stringify(qm).indexOf(equickId) >= 0, 'items=' + JSON.stringify((qm.items || []).length));

console.log('== Phase 9: all-ends convergence ==');
await syncAll('D1');
const maps = {}; const qmaps = {};
for (const id of IDS) { maps[id] = activeMap(await notes(id)); qmaps[id] = (await quickInv(id)).map(function (q) { return q.id; }).sort().join(','); }
const baseCanon = canon(maps['D1']);
for (const id of IDS) {
  const same = canon(maps[id]) === baseCanon;
  let diff = '';
  if (!same) { const keys = new Set(Object.keys(maps[id]).concat(Object.keys(maps['D1']))); const d = []; keys.forEach(function (k) { if (maps[id][k] !== maps['D1'][k]) d.push(k.slice(0,8) + '[' + (maps['D1'][k] || '-') + ']vs[' + (maps[id][k] || '-') + ']'); }); diff = d.slice(0,6).join(' '); }
  check(id + ' note-set converged', same, diff || (String(Object.keys(maps[id]).length) + ' notes'));
  check(id + ' quick-set converged', qmaps[id] === qmaps['D1'], qmaps[id] === qmaps['D1'] ? '' : ('mine=' + qmaps[id] + ' d1=' + qmaps['D1']));
}

console.log('== Phase 10: idempotency (D1 second sync) ==');
await sync('D1');
const r2 = await sync('D1');
check('D1 zero-change', r2 && r2.uploaded === 0 && r2.downloaded === 0, JSON.stringify({ uploaded: r2.uploaded, downloaded: r2.downloaded }));

const failed = results.filter(function (r) { return !r.ok; });
console.log('== SUMMARY ' + (results.length - failed.length) + '/' + results.length + ' ==');
if (failed.length) console.log('FAILED:\n' + failed.map(function (f) { return ' - ' + f.name; }).join('\n'));
process.exit(failed.length ? 1 : 0);
