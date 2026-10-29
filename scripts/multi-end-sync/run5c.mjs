import { connect } from './cdpclient.mjs';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire('/Users/admin/file/local-lake/lakex-local-notes/package.json');
const Database = require('better-sqlite3');
const ADB = '/opt/homebrew/share/android-commandlinetools/platform-tools/adb';
const ENDS = [
  { id: 'D1', type: 'desktop', port: 9232 },
  { id: 'D2', type: 'desktop', port: 9233 },
  { id: 'D3', type: 'desktop', port: 9234 },
  { id: 'R', type: 'android', port: 9235, serial: '50950385' },
  { id: 'E', type: 'android', port: 9236, serial: 'emulator-5554' }
];
const C = {}; for (const e of ENDS) C[e.id] = await connect(e.port);
const results = [];
function check(name, ok, detail) { results.push({ name, ok }); console.log('  ' + (ok ? 'PASS' : 'FAIL') + ' ' + name + (detail ? ' | ' + detail : '')); }
function find(id) { return ENDS.find(function (e) { return e.id === id; }); }
function ev(id, expr) { return C[id].ev(expr); }
const IDS = ENDS.map(function (e) { return e.id; });
async function sync(id) { return ev(id, 'window.lakeNative.syncNow()'); }
async function syncAll(creator) { for (const id of [creator].concat(IDS.filter(function (x) { return x !== creator; }))) await sync(id); }
async function tree(id) { return ev(id, 'window.lakeNative.getHomeSnapshot().then(function(s){return s.treeNodes;}).then(function(t){return t.map(function(n){return {id:n.id,title:n.title,type:n.nodeType,parentId:n.parentId,sortOrder:n.sortOrder,icon:n.icon||null};});})'); }
function pullMobile(e) {
  const dir = '/tmp/lake5/db-' + e.serial; fs.mkdirSync(dir, { recursive: true });
  for (const f of ['lakex-local-notes-mobileSQLite.db', 'lakex-local-notes-mobileSQLite.db-wal']) { try { const b = execSync(ADB + ' -s ' + e.serial + ' exec-out run-as com.lakexlocalnotes.android cat databases/' + f, { maxBuffer: 200 * 1024 * 1024 }); fs.writeFileSync(dir + '/' + f, b); } catch (err) {} }
  const db = new Database(dir + '/lakex-local-notes-mobileSQLite.db', { readonly: true });
  try { return db.prepare('SELECT id,title,parent_id,sort_order,icon,doc_kind FROM notes').all().map(function (r) { return { id: String(r.id), title: String(r.title), parentId: r.parent_id, sortOrder: r.sort_order, icon: r.icon || null, kind: r.doc_kind || 'doc' }; }); }
  finally { db.close(); }
}
async function trashed(id) {
  const e = find(id);
  if (e.type === 'desktop') return ev(id, 'window.lakeNative.listTrash().then(function(t){return t.map(function(x){return {id:x.id,title:x.title};});})');
  return ev(id, 'window.lakeNative.listTrashTree().then(function(t){return t.map(function(x){return {id:x.id,title:x.title};});})');
}
const sfx = String(Date.now()).slice(-6);

console.log('== F1: folder create + rename + icon ==');
const nbA = await ev('D1', 'window.lakeNative.createNotebook("f-nb-' + sfx + '")');
await syncAll('D1');
for (const id of IDS) { const n = (await tree(id)).find(function (x) { return x.id === nbA.id; }); check(id + ' sees notebook', !!n && n.title === 'f-nb-' + sfx, n ? n.title : 'missing'); }
const grp = await ev('D1', 'window.lakeNative.createGroup(' + JSON.stringify(nbA.id) + ', "f-grp-' + sfx + '")');
await syncAll('D1');
for (const id of IDS) { const n = (await tree(id)).find(function (x) { return x.id === grp.id; }); check(id + ' sees group', !!n && n.parentId === nbA.id, n ? ('parent=' + n.parentId) : 'missing'); }
await ev('D1', 'window.lakeNative.renameTreeNode(' + JSON.stringify(grp.id) + ', "f-grp-ren-' + sfx + '")');
await ev('D1', 'window.lakeNative.setNodeIcon(' + JSON.stringify(nbA.id) + ', "\u{1F4C1}")');
await syncAll('D1');
for (const id of IDS) {
  const n = (await tree(id)).find(function (x) { return x.id === grp.id; });
  check(id + ' group renamed', !!n && n.title === 'f-grp-ren-' + sfx, n ? n.title : 'missing');
  const a = (await tree(id)).find(function (x) { return x.id === nbA.id; });
  check(id + ' notebook icon', !!a && a.icon === '\u{1F4C1}', a ? String(a.icon) : 'missing');
}

console.log('== F2: folder reorder (sortOrder) ==');
const n1 = await ev('D1', 'window.lakeNative.createNotebook("f-r1-' + sfx + '")');
const n2 = await ev('D1', 'window.lakeNative.createNotebook("f-r2-' + sfx + '")');
const n3 = await ev('D1', 'window.lakeNative.createNotebook("f-r3-' + sfx + '")');
await syncAll('D1');
const roots0 = (await tree('D1')).filter(function (x) { return x.type === 'notebook' && x.parentId === null; }).sort(function (a, b) { return a.sortOrder - b.sortOrder; }).map(function (x) { return x.id; });
const desired = [n3.id].concat(roots0.filter(function (x) { return x !== n3.id; }));
await ev('D1', 'window.lakeNative.moveTreeNodeOrdered(' + JSON.stringify(n3.id) + ', null, ' + JSON.stringify(desired) + ')');
await syncAll('D1');
for (const id of IDS) {
  const order = (await tree(id)).filter(function (x) { return x.type === 'notebook' && x.parentId === null; }).sort(function (a, b) { return a.sortOrder - b.sortOrder; }).map(function (x) { return x.id; });
  check(id + ' n3 first of roots', order.indexOf(n3.id) === 0, 'idx=' + order.indexOf(n3.id));
  check(id + ' reorder relative', order.indexOf(n3.id) < order.indexOf(n1.id) && order.indexOf(n1.id) < order.indexOf(n2.id), 'n1=' + order.indexOf(n1.id) + ' n2=' + order.indexOf(n2.id));
}

console.log('== F3: move note into folder + note icon ==');
const fnote = await ev('D1', 'window.lakeNative.createNoteIn(' + JSON.stringify(nbA.id) + ', "f-note-' + sfx + '")');
await ev('D1', 'window.lakeNative.setNodeIcon(' + JSON.stringify(fnote.id) + ', "\u2B50")');
await syncAll('D1');
await ev('D1', 'window.lakeNative.moveTreeNodeOrdered(' + JSON.stringify(fnote.id) + ', ' + JSON.stringify(grp.id) + ', [' + JSON.stringify(fnote.id) + '])');
await syncAll('D1');
for (const id of IDS) {
  const e = find(id);
  let parent = null;
  if (e.type === 'desktop') { const n = (await tree(id)).find(function (x) { return x.id === fnote.id; }); parent = n ? n.parentId : null; }
  else { const n = pullMobile(e).find(function (x) { return x.id === fnote.id; }); parent = n ? n.parentId : null; }
  check(id + ' note moved to group', parent === grp.id, 'parent=' + parent);
}
console.log('== F4: folder trash / restore / purge ==');
const nbX = await ev('D1', 'window.lakeNative.createNotebook("f-x-' + sfx + '")');
await syncAll('D1');
await ev('D1', 'window.lakeNative.deleteTreeNode(' + JSON.stringify(nbX.id) + ')');
await syncAll('D1');
for (const id of IDS) { const active = (await tree(id)).some(function (x) { return x.id === nbX.id; }); check(id + ' nbX not active', !active); check(id + ' nbX in trash', (await trashed(id)).some(function (x) { return x.id === nbX.id; })); }
await ev('D1', 'window.lakeNative.restoreTrash(' + JSON.stringify(nbX.id) + ')');
await syncAll('D1');
for (const id of IDS) check(id + ' nbX restored', (await tree(id)).some(function (x) { return x.id === nbX.id; }));
await ev('D1', 'window.lakeNative.deleteTreeNode(' + JSON.stringify(nbX.id) + ')');
await syncAll('D1');
await ev('D1', 'window.lakeNative.purgeTrash(' + JSON.stringify(nbX.id) + ')');
await syncAll('D1');
for (const id of IDS) check(id + ' nbX purged (not active)', !(await tree(id)).some(function (x) { return x.id === nbX.id; }));
await syncAll('D1');
for (const id of IDS) check(id + ' nbX not resurrected', !(await tree(id)).some(function (x) { return x.id === nbX.id; }));

console.log('== F5: folder-tree convergence across 5 ends ==');
await syncAll('D1');
function treeKey(t) { return t.filter(function (x) { return x.type !== 'note'; }).map(function (x) { return x.id + '|' + x.title + '|' + x.parentId + '|' + x.sortOrder + '|' + x.icon; }).sort().join(';'); }
const ref = treeKey(await tree('D1'));
for (const id of IDS) { const fc = (await tree(id)).filter(function (x) { return x.type !== 'note'; }).length; check(id + ' folder tree converged', treeKey(await tree(id)) === ref, fc + ' folders'); }

console.log('== F6: S3 sync ops smoke (connection / GC diagnostics / dry-run cleanup) ==');
for (const id of IDS) { const s = await ev(id, 'window.lakeNative.testS3Connection()'); check(id + ' S3 connection', typeof s === 'string' && (s.indexOf('OK') === 0 || s.indexOf('连接成功') >= 0), String(s).slice(0, 40)); }
// 261028：GC 诊断/pending 清单随 manifest 时代链路删除（v3 深度清理直接看 runS3DeepCleanup 结果）。
const activeBefore = (await tree('D1')).filter(function (x) { return x.type === 'note'; }).length;
const dry = await ev('D1', 'window.lakeNative.runS3DeepCleanup(true)');
const activeAfter = (await tree('D1')).filter(function (x) { return x.type === 'note'; }).length;
check('D1 dry-run cleanup keeps data', activeBefore === activeAfter, activeBefore + ' -> ' + activeAfter);
check('D1 dry-run returns result', !!dry, JSON.stringify(dry).slice(0, 80));

const failed = results.filter(function (r) { return !r.ok; });
console.log('== SUMMARY ' + (results.length - failed.length) + '/' + results.length + ' ==');
if (failed.length) console.log('FAILED:\n' + failed.map(function (f) { return ' - ' + f.name; }).join('\n'));
process.exit(failed.length ? 1 : 0);
