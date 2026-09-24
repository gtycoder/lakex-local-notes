import { connect } from './cdpclient.mjs';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire('/Users/admin/file/local-lake/lake-notes-electron/package.json');
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
const IDS = ENDS.map(function (e) { return e.id; });
function find(id) { return ENDS.find(function (e) { return e.id === id; }); }
const results = [];
function check(name, ok, detail) { results.push({ name, ok }); console.log('  ' + (ok ? 'PASS' : 'FAIL') + ' ' + name + (detail ? ' | ' + detail : '')); }
async function evT(id, expr, ms) {
  const t0 = Date.now();
  const v = await Promise.race([C[id].ev(expr), new Promise(function (_, rej) { setTimeout(function () { rej(new Error('timeout ' + ms + 'ms')); }, ms); })]);
  return { value: v, ms: Date.now() - t0 };
}
async function syncT(id, ms) { const t0 = Date.now(); const v = await evT(id, 'window.lakeNative.syncNow()', ms); return { value: v.value, ms: Date.now() - t0 }; }
function pullMobile(e) {
  const dir = '/tmp/lake5/db-' + e.serial; const fs = require('node:fs'); fs.mkdirSync(dir, { recursive: true });
  for (const f of ['lake-notes-mobileSQLite.db', 'lake-notes-mobileSQLite.db-wal']) { try { const b = execSync(ADB + ' -s ' + e.serial + ' exec-out run-as com.lakenotes.mobile cat databases/' + f, { maxBuffer: 300 * 1024 * 1024 }); fs.writeFileSync(dir + '/' + f, b); } catch (err) {} }
  const db = new Database(dir + '/lake-notes-mobileSQLite.db', { readonly: true });
  try { return db.prepare('SELECT id,doc_kind,content FROM notes').all().map(function (r) { return { id: String(r.id), kind: r.doc_kind || 'doc', len: String(r.content).length }; }); }
  finally { db.close(); }
}
async function counts(id) {
  const e = find(id);
  const t = await evT(id, 'window.lakeNative.listTreeNodes()', 60000);
  if (e.type === 'desktop') { const notes = t.value.filter(function (n) { return n.nodeType === 'note'; }).length; const folders = t.value.filter(function (n) { return n.nodeType !== 'note'; }).length; return { notes: notes, folders: folders }; }
  const mc = pullMobile(e); return { notes: mc.length, folders: t.value.length };
}

const N = 1000, M = 100, BIG = 2 * 1024 * 1024;
const sfx = String(Date.now()).slice(-6);
console.log('== T1: create ' + N + ' notes on D1 ==');
const nbId = (await evT('D1', 'window.lakeNative.listTreeNodes()', 30000)).value.find(function (n) { return n.nodeType === 'notebook'; }).id;
const t1 = await evT('D1', '(async function(){var t0=Date.now();for(var i=0;i<' + N + ';i++){await window.lakeNative.createNoteIn(' + JSON.stringify(nbId) + ', "stress-"+i);}return Date.now()-t0;})()', 1200000);
console.log('  create notes ms=' + t1.ms + ' inner=' + t1.value);
check('T1 created ' + N + ' notes', (await counts('D1')).notes >= N, JSON.stringify(await counts('D1')));

console.log('== T2: create ' + M + ' notebooks on D1 ==');
const t2 = await evT('D1', '(async function(){var t0=Date.now();for(var i=0;i<' + M + ';i++){await window.lakeNative.createNotebook("stress-f-"+i);}return Date.now()-t0;})()', 1200000);
console.log('  create folders ms=' + t2.ms + ' inner=' + t2.value);

console.log('== T3: sync D1 (upload ~' + N + ' notes + ' + M + ' folders) ==');
const s1 = await syncT('D1', 1200000);
console.log('  D1 sync ms=' + s1.ms + ' result=' + JSON.stringify(s1.value && { uploaded: s1.value.uploaded, durationMs: s1.value.durationMs }));
check('D1 sync ok', s1.value && (s1.value.uploaded >= N), 'uploaded=' + (s1.value && s1.value.uploaded));

console.log('== T4: sync D2/D3/R/E (download) ==');
for (const id of ['D2', 'D3', 'R', 'E']) { const s = await syncT(id, 1200000); console.log('  ' + id + ' sync ms=' + s.ms + ' result=' + JSON.stringify(s.value && (s.value.notes ? { downloaded: s.value.notes.downloaded, dur: s.value.notes.durationMs } : { downloaded: s.value.downloaded, dur: s.value.durationMs }))); }

console.log('== T5: convergence counts ==');
const cnts = {}; for (const id of IDS) { cnts[id] = await counts(id); console.log('  ' + id + ' ' + JSON.stringify(cnts[id])); }
const refN = cnts['D1'].notes, refF = cnts['D1'].folders;
for (const id of IDS) { check(id + ' note count converged', Math.abs(cnts[id].notes - refN) <= 0, cnts[id].notes + '/' + refN); check(id + ' folder count converged', Math.abs(cnts[id].folders - refF) <= 0, cnts[id].folders + '/' + refF); }

console.log('== T6: large document (' + Math.round(BIG / 1024) + 'KB) ==');
const bigDoc = await evT('D1', 'window.lakeNative.createNoteIn(' + JSON.stringify(nbId) + ', "big-' + sfx + '")', 30000);
const body = '<p>' + 'x'.repeat(BIG) + '</p>';
await evT('D1', 'window.lakeNative.saveNote(' + JSON.stringify(bigDoc.value.id) + ', "big-' + sfx + '", ' + JSON.stringify(body) + ')', 300000);
const b1 = await syncT('D1', 1200000); console.log('  D1 big sync ms=' + b1.ms);
const b2 = await syncT('D2', 1200000); console.log('  D2 big sync ms=' + b2.ms);
await syncT('R', 1200000); await syncT('E', 1200000); await syncT('D3', 1200000);
for (const id of IDS) { const e = find(id); let len = 0; if (e.type === 'desktop') { const c = await evT(id, 'window.lakeNative.readNote(' + JSON.stringify(bigDoc.value.id) + ').then(function(n){return n.content.length;})', 60000); len = c.value || 0; } else { const row = pullMobile(e).find(function (x) { return x.id === bigDoc.value.id; }); len = row ? row.len : 0; } check(id + ' big doc length', len > BIG - 100, 'len=' + len); }

console.log('== T7: liveness + eval latency ==');
for (const id of IDS) { const t = await evT(id, '1+1', 10000); check(id + ' responsive', t.value === 2, 'eval=' + t.ms + 'ms'); }
for (const e of ENDS.filter(function (x) { return x.type === 'android'; })) { let alive = false; try { alive = execSync(ADB + ' -s ' + e.serial + ' shell pidof com.lakenotes.mobile').toString().trim().length > 0; } catch (err) {} check(e.id + ' process alive', alive); }

console.log('== T8: idempotent second sync D1 ==');
const s2 = await syncT('D1', 1200000);
console.log('  D1 second sync ms=' + s2.ms + ' result=' + JSON.stringify(s2.value && { uploaded: s2.value.uploaded, downloaded: s2.value.downloaded }));
check('D1 second sync zero-change', s2.value && s2.value.uploaded === 0 && s2.value.downloaded === 0, JSON.stringify({ up: s2.value.uploaded, down: s2.value.downloaded }));

const failed = results.filter(function (r) { return !r.ok; });
console.log('== SUMMARY ' + (results.length - failed.length) + '/' + results.length + ' ==');
if (failed.length) console.log('FAILED:\n' + failed.map(function (f) { return ' - ' + f.name; }).join('\n'));
console.log('TIMINGS create-notes=' + t1.ms + 'ms create-folders=' + t2.ms + 'ms sync-D1=' + s1.ms + 'ms');
process.exit(failed.length ? 1 : 0);
