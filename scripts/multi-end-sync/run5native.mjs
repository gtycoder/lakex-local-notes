// 原生资产端口跨端验证（E 模拟器 + R 真机；D1 桌面为对端）。
//   Phase U：移动端建普通笔记 + 256KB 资产 → sync 该端（原生 PUT）→ sync D1，校验 D1 落盘逐字节一致。
//   Phase D：D1 建普通笔记 + 磁盘落资产 → sync D1 → sync 移动端（原生 GET），校验落盘逐字节一致且 assetHttp=0。
// 未连接的端自动跳过。
import { connect } from './cdpclient.mjs';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';

const ADB = '/opt/homebrew/share/android-commandlinetools/platform-tools/adb';
const D1 = await connect(Number(process.env.D1_PORT || 9232));
const MOBILES = [
  { id: 'R', port: Number(process.env.R_PORT || 9235), serial: '50950385' },
  { id: 'E', port: Number(process.env.E_PORT || 9236), serial: 'emulator-5554' },
];
const active = [];
for (const m of MOBILES) {
  try { m.cdp = await connect(m.port); active.push(m); }
  catch (e) { console.log('SKIP ' + m.id + ' (no CDP on ' + m.port + '): ' + (e && e.message)); }
}
const sfx = String(Date.now()).slice(-6);
const SIZE = 262144;
const D1_ASSETS = path.join(process.env.TMPDIR || os.tmpdir(), 'lake5-d1', 'workspace-default', 'note-assets');
const results = [];
function check(name, ok, detail) { results.push({ name, ok }); console.log('  ' + (ok ? 'PASS' : 'FAIL') + ' ' + name + (detail ? ' | ' + detail : '')); }
function sha(buf) { return crypto.createHash('sha256').update(buf).digest('hex'); }
function expected() { const b = Buffer.alloc(SIZE); for (let i = 0; i < SIZE; i++) b[i] = (i * 7) & 255; return b; }
const expSha = sha(expected());
// 前缀防护：未配置/配错前缀的端直接跳过，避免「没传资产」被误判成 assetHttp=0。
const ready = [];
for (const m of active) {
  try {
    const prefix = await m.cdp.ev('window.lakeNative.getS3Settings().then(function(c){return c&&c.prefix;})');
    if (prefix !== process.env.PREFIX) { console.log('SKIP ' + m.id + ' (prefix mismatch: ' + prefix + ' != ' + process.env.PREFIX + ')'); continue; }
    ready.push(m);
  } catch (e) { console.log('SKIP ' + m.id + ' (config check failed: ' + (e && e.message) + ')'); }
}
active.length = 0; active.push(...ready);
async function sync(end) { const t0 = Date.now(); const v = await end.ev('window.lakeNative.syncNow()'); return { wallMs: Date.now() - t0, value: v }; }
function pullMobileFile(serial, id, name) { return execSync(ADB + ' -s ' + serial + ' exec-out run-as com.lakexlocalnotes.android cat files/note-assets/' + id + '/' + name, { maxBuffer: 64 * 1024 * 1024 }); }

const d1Nb = await D1.ev('window.lakeNative.getHomeSnapshot().then(function(s){return s.treeNodes;}).then(function(t){return (t.find(function(n){return n.nodeType==="notebook";})||{}).id;})');

for (const m of active) {
  console.log('== [' + m.id + '] Phase U: 该端原生上传资产 -> D1 下载 ==');
  const up = await m.cdp.ev('(async function(){var nb=(await window.lakeNative.getHomeSnapshot().then(function(s){return s.treeNodes;})).find(function(n){return n.nodeType==="notebook";});var note=await window.lakeNative.createNote("native-' + m.id + '-' + sfx + '",nb?nb.id:null);var id=(typeof note==="string")?note:note.id;var b=new Uint8Array(' + SIZE + ');for(var i=0;i<b.length;i++){b[i]=(i*7)&255;}var up=await window.lakeNative.uploadResource({bytes:b,filename:"native.png"},id);return {id:id,name:up.url.split("/").pop()};})()');
  await sync(m.cdp);
  await sync(D1);
  const f = path.join(D1_ASSETS, up.id, up.name);
  check('[' + m.id + '] D1 收到原生上传的资产', fs.existsSync(f), up.id + '/' + up.name);
  if (fs.existsSync(f)) check('[' + m.id + '] D1 资产 sha256 一致', sha(fs.readFileSync(f)) === expSha);

  console.log('== [' + m.id + '] Phase D: D1 落资产 -> 该端原生下载 ==');
  const d1Note = await D1.ev('window.lakeNative.createNoteIn(' + JSON.stringify(d1Nb) + ',"native-d1-' + m.id + '-' + sfx + '")');
  const dName = 'd1asset.png';
  const dir = path.join(D1_ASSETS, d1Note.id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, dName), expected());
  await sync(D1);
  await m.cdp.ev('window.__lakePerf.reset()');
  const t0 = Date.now();
  await sync(m.cdp);
  const wallMs = Date.now() - t0;
  const perf = await m.cdp.ev('window.__lakePerf.snapshot()');
  console.log('  [' + m.id + '] download wallMs=' + wallMs + ' assetHttp=' + (perf.assetHttp && perf.assetHttp.count) + ' assetB64Decode=' + (perf.assetB64Decode && perf.assetB64Decode.count) + ' fsWrite=' + (perf.fsWrite && perf.fsWrite.count));
  check('[' + m.id + '] 下载未过 HTTP 桥（assetHttp=0）', !!perf.assetHttp && perf.assetHttp.count === 0);
  let buf = null;
  try { buf = pullMobileFile(m.serial, d1Note.id, dName); } catch (e) { /* missing */ }
  check('[' + m.id + '] 收到 D1 的资产', !!buf && buf.length === SIZE, buf ? 'len=' + buf.length : 'missing');
  if (buf) check('[' + m.id + '] 资产 sha256 一致', sha(buf) === expSha);
}

const failed = results.filter((r) => !r.ok);
console.log('== SUMMARY ' + (results.length - failed.length) + '/' + results.length + ' ==');
if (failed.length) console.log('FAILED:\n' + failed.map((f) => ' - ' + f.name).join('\n'));
process.exit(failed.length ? 1 : 0);
