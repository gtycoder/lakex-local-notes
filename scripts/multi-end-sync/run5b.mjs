import { connect } from './cdpclient.mjs';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import zlib from 'node:zlib';
import { createRequire } from 'node:module';
const require = createRequire('/Users/admin/file/local-lake/lake-notes-electron/package.json');
const Database = require('better-sqlite3');
const { S3Client, GetObjectCommand, ListObjectsV2Command } = require('@aws-sdk/client-s3');
const ADB = '/opt/homebrew/share/android-commandlinetools/platform-tools/adb';
const ENDS = [
  { id: 'D1', type: 'desktop', port: 9232 },
  { id: 'D2', type: 'desktop', port: 9233 },
  { id: 'D3', type: 'desktop', port: 9234 },
  { id: 'R', type: 'android', port: 9235, serial: '50950385' },
  { id: 'E', type: 'android', port: 9236, serial: 'emulator-5554' }
];
const C = {}; const ACTIVE = [];
for (const e of ENDS) {
  try { C[e.id] = await connect(e.port); ACTIVE.push(e); }
  catch (err) { console.log('SKIP ' + e.id + ' (no CDP on ' + e.port + '): ' + (err && err.message)); }
}
ENDS.length = 0; ENDS.push(...ACTIVE);
const results = [];
function check(name, ok, detail) { results.push({ name, ok }); console.log('  ' + (ok ? 'PASS' : 'FAIL') + ' ' + name + (detail ? ' | ' + detail : '')); }
function find(id) { return ENDS.find(function (e) { return e.id === id; }); }
function ev(id, expr) { return C[id].ev(expr); }
const IDS = ENDS.map(function (e) { return e.id; });
async function sync(id) { return ev(id, 'window.lakeNative.syncNow()'); }
async function syncAll(creator) { for (const id of [creator].concat(IDS.filter(function (x) { return x !== creator; }))) await sync(id); }
function pullMobile(e) {
  const dir = '/tmp/lake5/db-' + e.serial; fs.mkdirSync(dir, { recursive: true });
  for (const f of ['lake-notes-mobileSQLite.db', 'lake-notes-mobileSQLite.db-wal']) {
    try { const b = execSync(ADB + ' -s ' + e.serial + ' exec-out run-as com.lakenotes.mobile cat databases/' + f, { maxBuffer: 200 * 1024 * 1024 }); fs.writeFileSync(dir + '/' + f, b); } catch (err) {}
  }
  const db = new Database(dir + '/lake-notes-mobileSQLite.db', { readonly: true });
  try { return db.prepare('SELECT id,title,doc_kind,content,trashed_at FROM notes').all().map(function (r) { return { id: String(r.id), title: String(r.title), kind: r.doc_kind || 'doc', content: String(r.content), trashed: !!r.trashed_at }; }); }
  finally { db.close(); }
}
async function mobileActive(id) { return ev(id, 'window.lakeNative.getHomeSnapshot().then(function(s){return s.notes;}).then(function(n){return n.map(function(x){return {id:x.id,title:x.title};});})'); }
async function mobileTrash(id) { return ev(id, 'window.lakeNative.listTrashTree().then(function(t){return t.filter(function(x){return x.kind==="note";}).map(function(x){return {id:x.id,title:x.title};});})'); }
async function notes(id) {
  const e = find(id);
  if (e.type === 'desktop') return ev(id, 'window.lakeNative.getHomeSnapshot().then(function(s){return s.treeNodes;}).then(function(t){return t.filter(function(n){return n.nodeType==="note";}).map(function(n){return {id:n.id,title:n.title,kind:n.kind||"doc"};});})');
  const live = await mobileActive(id); const db = pullMobile(e); const km = {}; db.forEach(function (n) { km[n.id] = n.kind; });
  return live.map(function (n) { return { id: n.id, title: n.title, kind: km[n.id] || 'doc' }; });
}
async function trashed(id) {
  const e = find(id);
  if (e.type === 'desktop') return ev(id, 'window.lakeNative.listTrash().then(function(t){return t.map(function(x){return {id:x.id,title:x.title};});})');
  return mobileTrash(id);
}
async function contentOf(id, noteId) {
  const e = find(id);
  if (e.type === 'desktop') return ev(id, 'window.lakeNative.readNote(' + JSON.stringify(noteId) + ').then(function(n){return n.content;})');
  const row = pullMobile(e).find(function (n) { return n.id === noteId; }); return row ? row.content : '';
}
async function quickInv(id) { return ev(id, 'window.lakeNative.getQuickNotePage().then(function(p){return p.items;}).then(function(q){return q.map(function(x){return {id:x.id,text:x.previewText,images:x.imageCount};});})'); }
async function treeOf(id) { return ev(id, 'window.lakeNative.getHomeSnapshot().then(function(s){return s.treeNodes;}).then(function(t){return t.map(function(n){return {id:n.id,title:n.title,type:n.nodeType};});})'); }
const s3 = new S3Client({ endpoint: process.env.S3_ENDPOINT, region: process.env.S3_REGION, credentials: { accessKeyId: process.env.S3_AK, secretAccessKey: process.env.S3_SK }, forcePathStyle: false });
async function s3list(p) { const o = []; let token; do { const r = await s3.send(new ListObjectsV2Command({ Bucket: process.env.S3_BUCKET, Prefix: p, ContinuationToken: token })); (r.Contents || []).forEach(function (x) { o.push(x.Key); }); token = r.IsTruncated ? r.NextContinuationToken : undefined; } while (token); return o; }
const prefix = process.env.PREFIX;
const sfx = String(Date.now()).slice(-6);
const nbId = ((await ev('D1', 'window.lakeNative.getHomeSnapshot().then(function(s){return s.treeNodes;})')).find(function (n) { return n.nodeType === 'notebook'; }) || {}).id || null;

console.log('== Phase 11: non-doc content byte-equality across ends ==');
const usheet = await ev('D1', 'window.lakeNative.createUsheetIn(' + JSON.stringify(nbId) + ', "p11-usheet-' + sfx + '")');
const bitable = await ev('D1', 'window.lakeNative.createBitableIn(' + JSON.stringify(nbId) + ', "p11-bitable-' + sfx + '")');
const board = await ev('D1', 'window.lakeNative.createBoardIn(' + JSON.stringify(nbId) + ', "p11-board-' + sfx + '")');
await syncAll('D1');
for (const c of [{ n: usheet, k: 'usheet' }, { n: bitable, k: 'bitable' }, { n: board, k: 'board' }]) {
  const ref = await contentOf('D1', c.n.id);
  let allEq = ref.length > 0;
  for (const id of IDS) { const x = await contentOf(id, c.n.id); if (x !== ref) { allEq = false; check(id + ' ' + c.k + ' content bytes', false, 'len=' + x.length + ' vs ' + ref.length); } }
  if (allEq) check('all ends ' + c.k + ' content bytes equal', true, 'len=' + ref.length);
}

console.log('== Phase 12: quick-note image/asset propagation (E creates image) ==');
const qid = await ev('E', 'window.lakeNative.createQuickNote("p12-asset-' + sfx + '")');
const pngB64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
await ev('E', '(function(){var b=atob("' + pngB64 + '");var a=new Uint8Array(b.length);for(var i=0;i<b.length;i++)a[i]=b.charCodeAt(i);return window.lakeNative.saveQuickNoteWithImages(' + JSON.stringify(qid) + ', "p12-asset-' + sfx + '", [{filename:"p12.png",mimeType:"image/png",width:1,height:1,bytes:a}]);})()');
await syncAll('E');
for (const id of IDS) { const row = (await quickInv(id)).find(function (q) { return q.id === qid; }); check(id + ' quick imageCount>=1', !!row && row.images >= 1, row ? 'images=' + row.images : 'missing'); }
const assetKeys = await s3list(prefix + '/quick-notes/assets/' + qid + '/');
check('cloud has quick note asset', assetKeys.some(function (k) { return k.indexOf('/quick-notes/assets/' + qid + '/') >= 0 && k.slice(-4) === '.png'; }), JSON.stringify(assetKeys));

console.log('== Phase 13: purge / ghost protection ==');
const ghost = await ev('D1', 'window.lakeNative.createNoteIn(' + JSON.stringify(nbId) + ', "p13-ghost-' + sfx + '")');
await syncAll('D1');
await ev('D1', 'window.lakeNative.deleteNote(' + JSON.stringify(ghost.id) + ')');
await syncAll('D1');
await ev('D1', 'window.lakeNative.purgeTrash(' + JSON.stringify(ghost.id) + ')');
await syncAll('D1');
for (const id of IDS) {
  check(id + ' ghost not active', !(await notes(id)).some(function (n) { return n.id === ghost.id; }));
  const inTrash = (await trashed(id)).some(function (x) { return x.id === ghost.id; });
  if (id === 'D1') check('D1 ghost removed from trash', !inTrash);
  else { const st = await ev(id, 'window.lakeNative.getNoteInfo(' + JSON.stringify(ghost.id) + ').then(function(i){return i.syncState;})'); check(id + ' ghost kept as purged trash (design)', inTrash && st === 'purged', 'trash=' + inTrash + ' state=' + st); }
}
await syncAll('D1');
for (const id of IDS) check(id + ' ghost still gone', !(await notes(id)).some(function (n) { return n.id === ghost.id; }));

console.log('== Phase 14: notebook/folder propagation ==');
const nbt = 'p14-nb-' + sfx;
const nb = await ev('D1', 'window.lakeNative.createNotebook(' + JSON.stringify(nbt) + ')');
await syncAll('D1');
for (const id of IDS) { const t = await treeOf(id); check(id + ' sees folder', t.some(function (n) { return n.id === nb.id && n.title === nbt; })); }

console.log('== Phase 15: delete beats concurrent edit (tombstone authority) ==');
const d15 = await ev('D1', 'window.lakeNative.createNoteIn(' + JSON.stringify(nbId) + ', "p15-doc-' + sfx + '")');
await syncAll('D1');
await ev('D2', 'window.lakeNative.saveNote(' + JSON.stringify(d15.id) + ', "p15-doc", "<p>p15-edit-by-D2-' + sfx + '</p>")');
await ev('D3', 'window.lakeNative.deleteNote(' + JSON.stringify(d15.id) + ')');
await sync('D3');
const d2res = await sync('D2');
check('D2 edit superseded by delete', Array.isArray(d2res.supersededNotes) && d2res.supersededNotes.some(function (x) { return (x && x.id) === d15.id; }), JSON.stringify(d2res.supersededNotes));
await syncAll('D3');
for (const id of IDS) { check(id + ' d15 trashed (delete wins)', (await trashed(id)).some(function (x) { return x.id === d15.id; })); check(id + ' d15 not active', !(await notes(id)).some(function (n) { return n.id === d15.id; })); }

const failed = results.filter(function (r) { return !r.ok; });
console.log('== SUMMARY ' + (results.length - failed.length) + '/' + results.length + ' ==');
if (failed.length) console.log('FAILED:\n' + failed.map(function (f) { return ' - ' + f.name; }).join('\n'));
process.exit(failed.length ? 1 : 0);
