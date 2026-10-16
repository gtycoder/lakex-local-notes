// 附件/图片过桥成本实测（280925 移动同步性能专项）：
//   - 上传：在模拟器 E 上注入图片并上传，测移动端 assetFs 读 + base64 编码 + HTTP PUT。
//   - 下载：在桌面 D1 的 note-assets/{id}/ 直接落真实字节（桌面流式上传，无 base64），同步后在 E 下载，
//           测移动端 HTTP GET + base64 解码 + assetFs 写盘。
// 依赖移动端 __lakePerf（见 src/mobile/native/assetPerf.ts）。运行前 D1/E 均已配置同一 PREFIX。
import { connect } from './cdpclient.mjs';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const D1_PORT = Number(process.env.D1_PORT || 9232);
const D2_PORT = Number(process.env.D2_PORT || 9233);
const E_PORT = Number(process.env.E_PORT || 9236);
const D1 = await connect(D1_PORT);
const E = await connect(E_PORT);
let D2 = null;
try { D2 = await connect(D2_PORT); } catch { /* D2 可选 */ }

const sfx = String(Date.now()).slice(-6);
const D1_ASSETS = path.join(process.env.TMPDIR || os.tmpdir(), 'lake5-d1', 'workspace-default', 'note-assets');

// 页内生成图片字节：PNG 魔数 + 稀疏载荷（只关心字节量，小记校验仅看 magic）。
function imagesExpr(n, size) {
  return '(function(){var out=[];for(var i=0;i<' + n + ';i++){var b=new Uint8Array(' + size + ');' +
    'b[0]=0x89;b[1]=0x50;b[2]=0x4e;b[3]=0x47;b[4]=0x0d;b[5]=0x0a;b[6]=0x1a;b[7]=0x0a;' +
    'for(var j=8;j<b.length;j+=4096){b[j]=(i*31+j)&255;}' +
    'out.push({filename:"perf"+i+".png",mimeType:"image/png",width:1,height:1,bytes:b});}return out;})()';
}
async function seedQuickNote(end, id, n, size) {
  await end.ev('window.lakeNative.createQuickNote(' + JSON.stringify(id) + ')');
  return end.ev('(function(){var imgs=' + imagesExpr(n, size) + ';return window.lakeNative.saveQuickNoteWithImages(' + JSON.stringify(id) + ', ' + JSON.stringify(id) + ', imgs);})()');
}
async function sync(end) {
  const t0 = Date.now();
  const r = await end.ev('window.lakeNative.syncNow()');
  return { wallMs: Date.now() - t0, result: r };
}
async function resetPerf() { return E.ev('window.__lakePerf.reset()'); }
async function snapPerf() { return E.ev('window.__lakePerf.snapshot()'); }

function fmt(name, phase, n, size, wallMs, p) {
  const totalBytes = n * size;
  const assetHttp = p.assetHttp || { count: 0, bytes: 0, ms: 0 };
  const b64Enc = p.b64Encode || { count: 0, bytes: 0, ms: 0 };
  const b64Dec = phase === 'upload' ? (p.b64Decode || {}) : (p.assetB64Decode || {});
  const fsSide = phase === 'upload' ? (p.fsRead || {}) : (p.fsWrite || {});
  const overheadMs = (b64Enc.ms || 0) + (b64Dec.ms || 0) + (fsSide.ms || 0);
  return {
    name, phase, files: n, bytes: totalBytes, wallMs,
    networkMs: assetHttp.ms, assetRequests: assetHttp.count,
    b64EncodeMs: b64Enc.ms, b64DecodeMs: b64Dec.ms || 0, fsMs: fsSide.ms || 0,
    bridgeB64OverheadMs: overheadMs,
    overheadPctOfWall: wallMs > 0 ? Math.round((overheadMs / wallMs) * 1000) / 10 : null,
    perFileOverheadMs: n > 0 ? Math.round((overheadMs / n) * 1000) / 1000 : null,
    mbPerSecWall: wallMs > 0 ? Math.round((totalBytes / 1024 / 1024) / (wallMs / 1000) * 10) / 10 : null,
  };
}

const BATCHES = [
  { name: 'big-20x2MB', n: 20, size: 2 * 1024 * 1024 },
  { name: 'many-300x8KB', n: 300, size: 8 * 1024 },
];
const report = { prefix: process.env.PREFIX, sfx, phases: [] };

if (process.env.SKIP_UPLOAD !== '1') {
  for (const b of BATCHES) {
    console.log('== upload ' + b.name + ' on E ==');
    const upId = 'perfup-' + b.name + '-' + sfx;
    await seedQuickNote(E, upId, b.n, b.size);
    await resetPerf();
    const up = await sync(E);
    const upPerf = await snapPerf();
    const row = fmt(b.name, 'upload', b.n, b.size, up.wallMs, upPerf);
    report.phases.push(row);
    console.log('  ' + JSON.stringify(row));
  }
}

// 下载：D1 新建普通笔记 → 直接落资产文件 → D1 同步（流式上传）→ E 同步下载。
const nbId = ((await D1.ev('window.lakeNative.listTreeNodes()')).find(function (n) { return n.nodeType === 'notebook'; }) || {}).id || null;
for (const b of BATCHES) {
  console.log('== download ' + b.name + ' to E (seeded on D1 disk) ==');
  const note = await D1.ev('window.lakeNative.createNoteIn(' + JSON.stringify(nbId) + ', "perfdown-' + b.name + '-' + sfx + '")');
  const dir = path.join(D1_ASSETS, note.id);
  fs.mkdirSync(dir, { recursive: true });
  const payload = Buffer.alloc(b.size);
  payload[0] = 0x89; payload[1] = 0x50; payload[2] = 0x4e; payload[3] = 0x47;
  payload[4] = 0x0d; payload[5] = 0x0a; payload[6] = 0x1a; payload[7] = 0x0a;
  for (let i = 0; i < b.n; i++) fs.writeFileSync(path.join(dir, 'd' + i + '.png'), payload);
  const upD1 = await sync(D1);
  console.log('  D1 upload wallMs=' + upD1.wallMs);
  const wall0 = Date.now();
  await resetPerf();
  const down = await sync(E);
  const downPerf = await snapPerf();
  const row = fmt(b.name, 'download', b.n, b.size, down.wallMs, downPerf);
  report.phases.push(row);
  console.log('  ' + JSON.stringify(row));
}

if (D2) {
  const d2 = await sync(D2);
  console.log('  D2 desktop download wallMs=' + d2.wallMs + ' (baseline, electron net no bridge)');
  report.d2BaselineWallMs = d2.wallMs;
}

console.log('== JSON ==');
console.log(JSON.stringify(report, null, 2));
