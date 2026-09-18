const list = await fetch('http://127.0.0.1:9232/json/list').then(r=>r.json());
const page = list.find(t=>t.type==='page' && !t.url.startsWith('devtools'));
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id=0;const pending=new Map();const logs=[];
const send=(m,p={})=>new Promise(r=>{const i=++id;pending.set(i,r);ws.send(JSON.stringify({id:i,method:m,params:p}));});
ws.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.id&&pending.has(m.id)){pending.get(m.id)(m);pending.delete(m.id);}
 if(m.method==='Runtime.consoleAPICalled'){const t=(m.params.args||[]).map(a=>a.value??a.description??'').join(' '); if(/editor-perf/.test(t)) logs.push({ts:Date.now(),t});}});
await new Promise(r=>ws.addEventListener('open',r));
await send('Runtime.enable');await send('HeapProfiler.enable');await send('Performance.enable');
const ev=async(x)=>{const m=await send('Runtime.evaluate',{expression:x,returnByValue:true,awaitPromise:true});return m.result?.result?.value ?? m.result?.exceptionDetails?.text;};
const gc=async()=>{await send('HeapProfiler.collectGarbage');await send('HeapProfiler.collectGarbage');};
const m=async()=>{const r=await send('Performance.getMetrics');const o={};(r.result.metrics||[]).forEach(x=>o[x.name]=x.value);return {heap:+(o.JSHeapUsedSize/1048576).toFixed(2),nodes:o.Nodes,listeners:o.JSEventListeners,tabs:await ev(`document.querySelectorAll('.tab-item').length`),editors:await ev(`document.querySelectorAll('.ne-editor').length`)};};
const sample=async(label)=>{await new Promise(r=>setTimeout(r,450));await gc();const s=await m();console.log(label, JSON.stringify(s));return s;};
const closeTab=async()=>await ev(`(()=>{const t=[...document.querySelectorAll('.tab-item')].pop(); if(!t) return 'no tab'; const c=t.querySelector('.tab-close'); if(!c) return 'no close btn'; c.click(); return 'closed';})()`);
const a=await sample('A@24tabs');
console.log('close one ->', await closeTab());
const b=await sample('B@23tabs');
const mark=logs.length;const t0=Date.now();
const created=await ev(`(async()=>{const n=await window.lakeNative.createNoteIn('notebook-personal','ZZ-量化-空文档'); return n && n.id;})()`);
console.log('createNoteIn ->', created);
let initMs=null;
for(let i=0;i<60;i++){await new Promise(r=>setTimeout(r,80));const hit=logs.slice(mark).find(l=>/editor-perf\]\s*init/.test(l.t));if(hit){initMs=Number((hit.t.match(/init\s+\S+\s+(\d+)ms/)||[])[1]??NaN)||null;break;}}
const c=await sample('C@24tabs+emptyDoc');
console.log('empty-doc instance delta:', JSON.stringify({heapMB:+(c.heap-b.heap).toFixed(2),nodes:c.nodes-b.nodes,listeners:c.listeners-b.listeners,tabs:c.tabs-b.tabs,initMs,readyMs:Date.now()-t0}));
console.log('close delta (24->23):', JSON.stringify({heapMB:+(b.heap-a.heap).toFixed(2),nodes:b.nodes-a.nodes,listeners:b.listeners-a.listeners}));
for(let i=0;i<20;i++){await closeTab();await new Promise(r=>setTimeout(r,120));}
const d=await sample('D@~4tabs');
console.log('closed 20 tabs delta:', JSON.stringify({heapMB:+(d.heap-c.heap).toFixed(2),tabs:d.tabs}));
ws.close();
