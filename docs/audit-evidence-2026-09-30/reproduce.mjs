import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { webcrypto } from 'node:crypto';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const {default:ts}=await import(path.join(root,'node_modules/typescript/lib/typescript.js'));
const outputDir=fs.mkdtempSync(path.join(os.tmpdir(),'lake-non-bitable-audit-'));
const results=[];
const react='export const useCallback=(f)=>f; export const useRef=(v)=>({current:v}); export const useState=(v)=>[typeof v==="function"?v():v,(n)=>globalThis.__audit.states.push(n)]; export const useEffect=(f)=>globalThis.__audit.effects.push(f);';
const native='export const native=new Proxy({}, {get:(_,k)=>(...a)=>globalThis.__audit.native[k](...a)}); export const isDesktop=()=>true;';
const uri=s=>'data:text/javascript;base64,'+Buffer.from(s).toString('base64');
const cache=new Map();
function load(file){
  if(cache.has(file))return cache.get(file);
  let code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;
  code=code.replace(/(from\s*|import\s*)["']([^"']+)["']/g,(all,prefix,spec)=>{
    let target;
    if(spec==='react')target=uri(react);
    else if(spec.endsWith('/lib/native'))target=uri(native);
    else if(spec.endsWith('/features/editor/EditorTab'))target=uri('export const clearScrollMemory=()=>{}; export const locateEditorSearchHit=()=>true;');
    else if(spec.startsWith('.')){
      let absolute=path.resolve(path.dirname(file),spec).replace(/\.js$/,'.ts');
      if(!path.extname(absolute))absolute+=fs.existsSync(absolute+'.ts')?'.ts':'.tsx';
      target=load(absolute);
    }else return all;
    return prefix+JSON.stringify(target);
  });
  const target=uri(code);cache.set(file,target);return target;
}
let timer=0;let scheduled=new Map();
globalThis.window={setTimeout:f=>{scheduled.set(++timer,f);return timer;},clearTimeout:id=>scheduled.delete(id)};
const fresh=()=>{globalThis.__audit={states:[],effects:[],native:{}};scheduled=new Map();};
const tick=()=>new Promise(r=>setImmediate(r));
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
const {useSavePipeline}=await import(load(root+'/src/hooks/useSavePipeline.ts'));
const {useDocumentTabs}=await import(load(root+'/src/hooks/useDocumentTabs.ts'));
const options=tab=>({getOpenTab:()=>tab,getEditorCaches:()=>({plain:tab.content,markdown:tab.content}),onNoteSaved:()=>{},onOpenTabsApplied:s=>Object.assign(tab,{content:s.content,dirty:false}),onDraftCleared:()=>{},onError:()=>{}});
// 1: saving errors resolve, so the actual close callback removes the tab.
fresh();let tab={noteId:'a',title:'A',content:'unsaved',dirty:true,lastAccessedAt:0};
__audit.native.saveNote=async()=>{throw new Error('disk full');};
let pipeline=useSavePipeline(options(tab));let refs={current:[tab]};let removed=false;
const closing=useDocumentTabs({tabsRef:refs,activeNoteId:'a',setTabs:fn=>{refs.current=fn(refs.current);removed=refs.current.length===0;},setActiveNoteId:()=>{},setSaveState:()=>{},saveTimers:pipeline.saveTimers,persistTab:pipeline.persistTab,clearScrollMemory:()=>{}});
await closing.closeTab('a');results.push({id:'R01',description:'save throws disk-full; close still removes dirty tab',removed});
// 2: queue task snapshots the live revision after it has already captured old content.
fresh();tab={noteId:'a',title:'A',content:'v1',dirty:true};const first=deferred();let calls=[];let clears=0;
__audit.native.saveNote=async(id,title,content,caches)=>{calls.push({content,caches});if(calls.length===1)await first.promise;return {id,title,content};};
pipeline=useSavePipeline({...options(tab),onDraftCleared:()=>clears++});pipeline.bumpRevision('a');
const p1=pipeline.persistTab('a','A','v1');await tick();const p2=pipeline.persistTab('a','A','v1');
tab.content='v2';pipeline.bumpRevision('a');first.resolve();await Promise.all([p1,p2]);
results.push({id:'R02',description:'old queued body gets current revision and clears newer draft',calls,finalContent:tab.content,dirty:tab.dirty,clears});
// 3: two unrelated note reloads share the global last-request-wins guard.
fresh();const {useSyncRefresh}=await import(load(root+'/src/hooks/useSyncRefresh.ts'));
const {createRequestVersion}=await import(load(root+'/src/core/requestVersion.ts'));
let tabs=[{noteId:'a',content:'old-a',dirty:false},{noteId:'b',content:'old-b',dirty:false}];const a=deferred(),b=deferred();
__audit.native.readNote=id=>(id==='a'?a.promise:b.promise);
const refresh=useSyncRefresh({setPendingSummary:()=>{},setDraftEntries:()=>{},setTreeNodes:()=>{},setNotes:()=>{},setOpenTabs:fn=>tabs=fn(tabs),tabReloadVersionRef:{current:createRequestVersion()},openTabsRef:{current:tabs},bumpRevision:()=>{}});
refresh.reloadNoteTab('a');refresh.reloadNoteTab('b');a.resolve({id:'a',title:'A',content:'new-a'});await tick();b.resolve({id:'b',title:'B',content:'new-b'});await tick();
results.push({id:'R03',description:'reload(b) invalidates independent reload(a)',tabs});
// 4: restoring any trash item clears deleted on every readable deleted tab.
fresh();tabs=[{noteId:'a',content:'trash-a',deleted:true}];
__audit.native.listDraftJournals=async()=>[];__audit.native.listNoteSummaries=async()=>[];__audit.native.listTreeNodes=async()=>[];
__audit.native.readNote=async()=>({id:'a',title:'still-trash',content:'trash-a',parentId:'__trash__',syncState:'purged'});
const restore=useSyncRefresh({setPendingSummary:()=>{},setDraftEntries:()=>{},setTreeNodes:()=>{},setNotes:()=>{},setOpenTabs:fn=>tabs=fn(tabs),tabReloadVersionRef:{current:createRequestVersion()},openTabsRef:{current:tabs},bumpRevision:()=>{}});
restore.handleTrashRestored();await tick();results.push({id:'R04',description:'unrelated restore unlocks still-purged tab',tabs});
// 5: mobile flush drops all pending payloads instead of persisting them.
fresh();const {useAutoSave}=await import(load(root+'/src/mobile/useAutoSave.ts'));let writes=[];
const mobile=useAutoSave((...args)=>writes.push(args));mobile.schedule('a','A','new-a');mobile.schedule('b','B','new-b');mobile.flush();
for(const f of scheduled.values())f();results.push({id:'R05',description:'mobile flush with two dirty documents causes zero writes',writes,pending:scheduled.size});
// 6: the desktop pinned context Menu is cleared before awaited close success.
// Security proof: derive mobile encryption key from public constant and decrypt sample with no installation secret.
const source=fs.readFileSync(root+'/src/mobile/secretStore.ts','utf8');const material=source.match(/KEY_MATERIAL = "([^"]+)"/)[1];
const digest=await webcrypto.subtle.digest('SHA-256',new TextEncoder().encode(material));const k=await webcrypto.subtle.importKey('raw',digest,{name:'AES-GCM'},false,['encrypt','decrypt']);
const iv=webcrypto.getRandomValues(new Uint8Array(12));const encoded=await webcrypto.subtle.encrypt({name:'AES-GCM',iv},k,new TextEncoder().encode('test-secret-NOT-real'));
const secondKey=await webcrypto.subtle.importKey('raw',await webcrypto.subtle.digest('SHA-256',new TextEncoder().encode(material)),{name:'AES-GCM'},false,['decrypt']);
const decoded=new TextDecoder().decode(await webcrypto.subtle.decrypt({name:'AES-GCM',iv},secondKey,encoded));
results.push({id:'R06',description:'public fixed key decrypts AES-GCM without device-specific secret',decoded});
// 7: forced identical snapshots share the same file; deleting one destroys the other.
const {HistoryLifecycle}=await import(load(root+'/electron/historyLifecycle.ts'));
const {default:Database}=await import(root+'/node_modules/better-sqlite3/lib/index.js');
const db=new Database(':memory:');db.exec('CREATE TABLE note_history(id INTEGER PRIMARY KEY,note_id TEXT,file_path TEXT,content_hash TEXT,created_at TEXT,size INTEGER,refs_json TEXT,ref_count INTEGER,protected_until TEXT)');
const dir=path.join(outputDir,'history-fixture');fs.mkdirSync(dir,{recursive:true});const bodyFile=path.join(dir,'a.lake');fs.writeFileSync(bodyFile,'<p>same content</p>');
const OriginalDate=globalThis.Date;globalThis.Date=class extends OriginalDate{constructor(...args){super(...(args.length?args:['2026-09-30T08:00:00.100Z']));}static now(){return 1790755200100;}};
const history=new HistoryLifecycle({db,root:dir,notePathFor:()=>bodyFile,logScopes:{history:{info:()=>{}}},getHistorySettings:()=>({}),cleanupUnreferencedAssetsForNote:()=>{}});
const h1=history.createHistorySnapshot('a',undefined,true);const h2=history.createHistorySnapshot('a',undefined,true);globalThis.Date=OriginalDate;
const rows=db.prepare('SELECT id,file_path FROM note_history').all();history.deleteHistory(h1);
results.push({id:'R07',description:'same-second forced snapshots share path; deleting one breaks remaining snapshot',rows,remainingFileExists:fs.existsSync(path.join(dir,rows[1].file_path))});db.close();
// 8: actual file save succeeds, then injected DB commit failure leaves synced old metadata.
const {NoteContentRepository}=await import(load(root+'/electron/noteContentRepository.ts'));
const partialFile=path.join(dir,'partial.lake');fs.writeFileSync(partialFile,'old body');
const fakeDb={prepare:()=>({get:()=>({title:'A'}),run:()=>{}}),transaction:fn=>()=>{throw new Error('injected DB commit failure');}};
const repo=new NoteContentRepository({db:fakeDb,notePathFor:()=>partialFile,atomicWrite:(p,s)=>fs.writeFileSync(p,s),revivePurgedIfNeeded:()=>false,createHistorySnapshot:()=>null,upsertSearch:()=>{},detectOrphans:()=>{},markHistoryDirty:()=>{}});
let commitError;try{repo.save('a','A','new body');}catch(e){commitError=e.message;}
results.push({id:'R08',description:'DB commit failure after body write is not atomic',error:commitError,fileBody:fs.readFileSync(partialFile,'utf8'),metadata:'old/synced (injected rollback)'});
// 9: HTTP timeout is removed on headers, not on body end.
const {createPinnedHttpFetcher}=await import(load(root+'/electron/httpFetcher.ts'));
const start=performance.now();
const fetcher=createPinnedHttpFetcher({lookup:async()=>[{address:'93.184.216.34',family:4}],request:()=>{const handlers={};return {on(e,fn){handlers[e]=fn;return this;},end(){queueMicrotask(()=>handlers.response({statusCode:200,headers:{},async *[Symbol.asyncIterator](){await new Promise(r=>setTimeout(r,80));yield new Uint8Array([1]);}}));},destroy(){}};}});
const response=await fetcher.fetch('https://example.test/image',{timeoutMs:15,maxRedirects:0,userAgent:'test'});let bodyBytes=0;for await(const chunk of response.body)bodyBytes+=chunk.length;
results.push({id:'R09',description:'15ms HTTP timeout still permits 80ms body; body stalled forever would have no deadline',elapsedMs:Math.round(performance.now()-start),bodyBytes});
// 10: execute the current mobile UPSERT against a real SQLite trash row.
const mobileSource=fs.readFileSync(root+'/src/mobile/noteRepository.ts','utf8');
const sql=mobileSource.match(/`(INSERT INTO notes \(id, title, content, parent_id, updated_at, content_hash, sync_state, text_cache\)[\s\S]*?)`/)[1];
const mobileDb=new Database(':memory:');mobileDb.exec("CREATE TABLE notes(id TEXT PRIMARY KEY,title TEXT,content TEXT,parent_id TEXT,updated_at TEXT,content_hash TEXT,sync_state TEXT,text_cache TEXT,trashed_at TEXT); INSERT INTO notes(id,title,content,sync_state,trashed_at) VALUES('a','A','trash-original','purged','2026-09-30')");
mobileDb.prepare(sql).run('a','A','late-save',null,'2026-09-30','test-hash','late-save');
results.push({id:'R10',description:'current mobile UPSERT changes still-trashed purged row back to local',row:mobileDb.prepare('SELECT content,trashed_at,sync_state FROM notes').get()});mobileDb.close();
// 11: refresh invalid draft journals destroys the only recovery data for missing notes.
fresh();let deletedJournals=[];__audit.native.listDraftJournals=async()=>[{noteId:'missing',title:'Last input',content:'only copy'}];__audit.native.listNoteSummaries=async()=>[];__audit.native.deleteDraftJournal=async(id)=>deletedJournals.push(id);
const draftRefresh=useSyncRefresh({setPendingSummary:()=>{},setDraftEntries:()=>{},setTreeNodes:()=>{},setNotes:()=>{},setOpenTabs:()=>{},tabReloadVersionRef:{current:createRequestVersion()},openTabsRef:{current:[]},bumpRevision:()=>{}});
await draftRefresh.refreshDraftEntries();results.push({id:'R11',description:'refresh deletes missing-note draft automatically',deletedJournals});
// 12: per-note orphan cleanup bypasses the shared draft-reference guard.
const {AssetRepository}=await import(load(root+'/electron/assetRepository.ts'));
const {OrphanLifecycle}=await import(load(root+'/electron/orphanLifecycle.ts'));
const assetsDir=path.join(dir,'note-assets','draft-only');fs.mkdirSync(assetsDir,{recursive:true});
const assetName='1790755200100_abcdef12.png';fs.writeFileSync(path.join(assetsDir,assetName),'fixture');
const cleanBody=path.join(dir,'clean.lake');fs.writeFileSync(cleanBody,'<p>No asset</p>');
const assetDb={prepare:()=>({all:()=>[]})};
const assetRepo=new AssetRepository({db:assetDb,notePathFor:()=>cleanBody,extractAssetRefs:()=>new Set(),draftRefsFor:()=>new Set([assetName])});
const orphan=new OrphanLifecycle({db:assetDb,root:dir,noteAssetsDirFor:()=>assetsDir,assetRepository:assetRepo});
const protectedBefore=assetRepo.getProtectedRefs('draft-only').has(assetName);const cleanup=orphan.cleanNoteOrphans('draft-only');
results.push({id:'R12',description:'per-note cleanNoteOrphans deletes asset protected by draft-only references',protectedBefore,cleanup,fileStillExists:fs.existsSync(path.join(assetsDir,assetName))});
// 13: beforeunload is skipped while a canvas edit still waits inside the adapter's 800ms debounce.
// Timing proof uses adapter + parent source directly, not an Electron run.
const bd=fs.readFileSync(root+'/src/features/board/BoardEditor.tsx','utf8');
const sh=fs.readFileSync(root+'/src/features/sheet/SheetEditor.tsx','utf8');
const pl=fs.readFileSync(root+'/src/hooks/useSavePipeline.ts','utf8');
results.push({id:'R13',description:'nested debounces leave outer dirty=false during first 800ms; full persistence delay >=1800ms',boardInnerMs:Number(bd.match(/AUTOSAVE_DEBOUNCE_MS = (\d+)/)[1]),sheetInnerMs:Number(sh.match(/AUTOSAVE_DEBOUNCE_MS = (\d+)/)[1]),outerMs:Number(pl.match(/SAVE_DEBOUNCE_MS = (\d+)/)[1]),evidence:'static scheduling trace; not a runtime close/OOM test'});
// 14: cleanup retaining one of two same-path forced snapshots deletes its file.
// R07 establishes the same invariant already; no duplicate issue counted.
fs.writeFileSync(path.join(outputDir,'reproduction-results.json'),JSON.stringify(results,null,2));console.log(JSON.stringify(results,null,2));

// These assertions describe ae1cfda's observed bugs, NOT desired product behavior.
// After fixes, a failed assertion means this historical reproduction needs re-evaluation.
const byId=Object.fromEntries(results.map(r=>[r.id,r]));
assert.equal(byId.R01.removed,true);
assert.equal(byId.R02.finalContent,'v1');
assert.equal(byId.R02.dirty,false);
assert.equal(byId.R02.calls[1].caches.plain,'v2');
assert.equal(byId.R03.tabs[0].content,'old-a');
assert.equal(byId.R03.tabs[1].content,'new-b');
assert.equal(byId.R04.tabs[0].deleted,false);
assert.equal(byId.R05.writes.length,0);
assert.equal(byId.R06.decoded,'test-secret-NOT-real');
assert.equal(byId.R07.rows[0].file_path,byId.R07.rows[1].file_path);
assert.equal(byId.R07.remainingFileExists,false);
assert.equal(byId.R08.fileBody,'new body');
assert.ok(byId.R09.elapsedMs>=70);
assert.equal(byId.R10.row.sync_state,'local');
assert.deepEqual(byId.R11.deletedJournals,['missing']);
assert.equal(byId.R12.protectedBefore,true);
assert.equal(byId.R12.fileStillExists,false);
console.log('12 observed behaviors reproduced; R13 is static timing evidence.');
console.log('Isolated fixture and output:',outputDir);
