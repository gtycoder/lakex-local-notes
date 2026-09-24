// 原生资产端口跨端验证（分支 feat/android-kotlin-native）：
//   Phase U：E（安卓，原生上传）建普通笔记 + 256KB 资产 → sync E（原生 PUT）→ sync D1，校验 D1 落盘逐字节一致。
//   Phase D：D1 建普通笔记 + 直接在磁盘落资产 → sync D1 → sync E，校验 E 落盘逐字节一致（下载路径未改）。
// 依赖：D1 桌面（9232）+ 模拟器 E（9236，serial emulator-5554，已配同一 PREFIX）。
import { connect } from './cdpclient.mjs';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';

const ADB = '/opt/homebrew/share/android-commandlinetools/platform-tools/adb';
const D1 = await connect(Number(process.env.D1_PORT || 9232));
const E = await connect(Number(process.env.E_PORT || 9236));
const sfx = String(Date.now()).slice(-6);
const SIZE = 262144;
const D1_ASSETS = path.join(process.env.TMPDIR || os.tmpdir(), 'lake5-d1', 'workspace-default', 'note-assets');
const results = [];
function check(name, ok, detail) { results.push({ name, ok }); console.log('  ' + (ok ? 'PASS' : 'FAIL') + ' ' + name + (detail ? ' | ' + detail : '')); }
function sha(buf) { return crypto.createHash('sha256').update(buf).digest('hex'); }
function expected() { const b = Buffer.alloc(SIZE); for (let i = 0; i < SIZE; i++) b[i] = (i * 7) & 255; return b; }
const expSha = sha(expected());
async function sync(end) { const t0 = Date.now(); const v = await end.ev('window.lakeNative.syncNow()'); return { wallMs: Date.now() - t0, value: v }; }
function pullMobileFile(id, name) {
  return execSync(ADB + ' -s emulator-5554 exec-out run-as com.lakenotes.mobile cat files/note-assets/' + id + '/' + name, { maxBuffer: 64 * 1024 * 1024 });
}

console.log('== Phase U: E 原生上传资产 → D1 下载 ==');
const eNote = await E.ev('(async function(){var nb=(await window.lakeNative.listTreeNodes()).find(function(n){return n.nodeType==="notebook";});var note=await window.lakeNative.createNote("native-e-' + sfx + '",nb?nb.id:null);var id=(typeof note==="string")?note:note.id;var b=new Uint8Array(' + SIZE + ');for(var i=0;i<b.length;i++){b[i]=(i*7)&255;}var up=await window.lakeNative.uploadResource({bytes:b,filename:"native.png"},id);return {id:id,name:up.url.split("/").pop()};})()');
console.log('  E note=' + eNote.id + ' asset=' + eNote.name);
await sync(E);
await sync(D1);
const d1File = path.join(D1_ASSETS, eNote.id, eNote.name);
const d1Ok = fs.existsSync(d1File);
check('D1 收到 E 上传的资产文件', d1Ok, d1File);
if (d1Ok) check('D1 资产 sha256 一致', sha(fs.readFileSync(d1File)) === expSha);

console.log('== Phase D: D1 落资产 → E 下载 ==');
const d1Nb = await D1.ev('window.lakeNative.listTreeNodes().then(function(t){return (t.find(function(n){return n.nodeType==="notebook";})||{}).id;})');
const d1Note = await D1.ev('window.lakeNative.createNoteIn(' + JSON.stringify(d1Nb) + ',"native-d1-' + sfx + '")');
const dName = 'd1asset.png';
const dir = path.join(D1_ASSETS, d1Note.id);
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, dName), expected());
await sync(D1);
await E.ev('window.__lakePerf.reset()');
await sync(E);
const ePerf = await E.ev('window.__lakePerf.snapshot()');
console.log('  E download perf: assetHttp=' + (ePerf.assetHttp && ePerf.assetHttp.count) + ' assetB64Decode=' + (ePerf.assetB64Decode && ePerf.assetB64Decode.count) + ' fsWrite=' + (ePerf.fsWrite && ePerf.fsWrite.count));
check('E 下载未过 HTTP 桥（assetHttp=0）', !!ePerf.assetHttp && ePerf.assetHttp.count === 0);
let eBuf = null;
try { eBuf = pullMobileFile(d1Note.id, dName); } catch (e) { /* missing */ }
check('E 收到 D1 的资产文件', !!eBuf && eBuf.length === SIZE, eBuf ? 'len=' + eBuf.length : 'missing');
if (eBuf) check('E 资产 sha256 一致', sha(eBuf) === expSha);

const failed = results.filter((r) => !r.ok);
console.log('== SUMMARY ' + (results.length - failed.length) + '/' + results.length + ' ==');
if (failed.length) console.log('FAILED:\n' + failed.map((f) => ' - ' + f.name).join('\n'));
process.exit(failed.length ? 1 : 0);
