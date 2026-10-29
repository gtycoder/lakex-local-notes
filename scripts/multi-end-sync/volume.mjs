import { createRequire } from 'node:module';
import fs from 'node:fs';
import { execSync } from 'node:child_process';
const req = createRequire("/Users/admin/file/local-lake/lakex-local-notes/package.json");
const Database = req('better-sqlite3');
const ADB = '/opt/homebrew/share/android-commandlinetools/platform-tools/adb';
const dir = '/tmp/lake5/db-perf'; fs.mkdirSync(dir, { recursive: true });
for (const f of ['lakex-local-notes-mobileSQLite.db','lakex-local-notes-mobileSQLite.db-wal']) { try { fs.writeFileSync(dir+'/'+f, execSync(ADB+' -s emulator-5554 exec-out run-as com.lakexlocalnotes.android cat databases/'+f, { maxBuffer: 300*1024*1024 })); } catch(e){} }
const db = new Database(dir + '/lakex-local-notes-mobileSQLite.db', { readonly: true });
const row = db.prepare("SELECT COUNT(*) c, SUM(LENGTH(content)) s FROM notes").get();
db.close();
console.log('perf notes=' + row.c + ' total_body_bytes=' + row.s + ' avg=' + Math.round(row.s / row.c));
const { S3Client, GetObjectCommand, ListObjectsV2Command } = req('@aws-sdk/client-s3');
const c = new S3Client({ endpoint: process.env.S3_ENDPOINT, region: process.env.S3_REGION, credentials: { accessKeyId: process.env.S3_AK, secretAccessKey: process.env.S3_SK }, forcePathStyle: false });
const P = 'lakex-local-notes-stress2-260910';
const g = await c.send(new GetObjectCommand({ Bucket: process.env.S3_BUCKET, Key: P + '/manifests/latest.json' }));
const bytes = Buffer.from(await g.Body.transformToByteArray());
console.log('real manifest stored bytes=' + bytes.length + ' gzip=' + (bytes[0]===0x1f&&bytes[1]===0x8b));
const l = await c.send(new ListObjectsV2Command({ Bucket: process.env.S3_BUCKET, Prefix: P + '/' }));
let total = 0, n = 0, byCat = {};
for (const o of (l.Contents||[])) { total += o.Size; n++; const cat = o.Key.split('/')[1] || 'root'; byCat[cat] = (byCat[cat]||0) + o.Size; }
console.log('real prefix objects=' + n + ' total_bytes=' + total + ' (' + (total/1024/1024).toFixed(1) + ' MiB)');
console.log('byCat=' + JSON.stringify(Object.fromEntries(Object.entries(byCat).map(function(e){return [e[0], (e[1]/1024/1024).toFixed(1)+'MiB'];} ))));
