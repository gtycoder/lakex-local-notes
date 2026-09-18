import { execSync } from 'node:child_process';
const PORT = process.env.SPIKE_CDP || 9232;
const MAX = Number(process.env.SPIKE_MAX || 24);
const list = await fetch(`http://127.0.0.1:${PORT}/json/list`).then(r=>r.json());
const page = list.find(t=>t.type==='page' && !t.url.startsWith('devtools'));
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id=0; const pending=new Map(); const logs=[];
const send=(m,p={})=>new Promise(r=>{const i=++id;pending.set(i,r);ws.send(JSON.stringify({id:i,method:m,params:p}));});
ws.addEventListener('message',e=>{const m=JSON.parse(e.data);
  if(m.id&&pending.has(m.id)){pending.get(m.id)(m);pending.delete(m.id);}
  if(m.method==='Runtime.consoleAPICalled'){const t=(m.params.args||[]).map(a=>a.value??a.description??'').join(' '); if(/editor-perf/.test(t)) logs.push({ts:Date.now(),t});}
});
await new Promise(r=>ws.addEventListener('open',r));
await send('Runtime.enable'); await send('HeapProfiler.enable'); await send('Performance.enable');
try{await send('Page.bringToFront');}catch(e){}
try{await send('Emulation.setFocusEmulationEnabled',{enabled:true});}catch(e){}
try{await send('Page.setWebLifecycleState',{state:'active'});}catch(e){}
const ev=async(x)=>{const m=await send('Runtime.evaluate',{expression:x,returnByValue:true,awaitPromise:true});return m.result?.result?.value;};
const gc=async()=>{await send('HeapProfiler.collectGarbage');await send('HeapProfiler.collectGarbage');};
const metrics=async()=>{const m=await send('Performance.getMetrics'); const o={}; (m.result.metrics||[]).forEach(x=>o[x.name]=x.value); return {heapMB:+(o.JSHeapUsedSize/1048576).toFixed(1), nodes:o.Nodes, listeners:o.JSEventListeners};};
const click=async(x,y)=>{await send('Input.dispatchMouseEvent',{type:'mousePressed',x,y,button:'left',clickCount:1,buttons:1});await send('Input.dispatchMouseEvent',{type:'mouseReleased',x,y,button:'left',clickCount:1,buttons:0});};
const rows=async()=>await ev(`(()=>{const out=[];document.querySelectorAll('.tree-row').forEach(row=>{const cls=String(row.className);if(!/type-note(?!book)/.test(cls))return;const r=row.getBoundingClientRect();const t=(row.textContent||'').replace(/\\s+/g,' ').trim();if(r.y>50&&r.y<820&&r.height>10&&t)out.push({id:row.dataset.treeNodeId||t,t:t.slice(0,26),x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)});});return out;})()`);
const tabs=async()=>await ev(`document.querySelectorAll('.tab-item').length`);
const rssOfTree=()=>{ try{
  const out=execSync(`ps -eo pid,ppid,rss,command`).toString().split('\n');
  const procs=out.map(l=>{const m=l.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/); return m?{pid:+m[1],ppid:+m[2],rss:+m[3],cmd:m[4]}:null;}).filter(Boolean);
  const root=procs.find(p=>/remote-debugging-port=9232/.test(p.cmd) && /Electron\.app\/Contents\/MacOS\/Electron/.test(p.cmd));
  if(!root) return null;
  const ids=new Set([root.pid]); let grew=true;
  while(grew){grew=false; for(const p of procs){ if(ids.has(p.ppid)&&!ids.has(p.pid)){ids.add(p.pid);grew=true;} }}
  const total=procs.filter(p=>ids.has(p.pid)).reduce((a,p)=>a+p.rss,0);
  return {procs:ids.size, rssMB:+(total/1024).toFixed(0)};
}catch(e){return null;} };
await gc();
const m0=await metrics(); const r0=rssOfTree(); const t0tabs=await tabs();
const out=[{step:0,title:'(baseline)',...m0,deltaMB:0,initMs:null,readyMs:null,tabs:t0tabs,rssMB:r0?.rssMB??null,procs:r0?.procs??null}];
console.log(JSON.stringify(out[0]));
const opened=new Set();
let misses=0;
let scrollTries=0;
for (let step=1; step<=MAX+10 && misses<12 && out.length<=MAX; step++) {
  let rs=await rows();
  let target=rs.find(r=>!opened.has(r.id));
  while(!target && scrollTries<12){
    const sc=await ev(`(()=>{const c=[...document.querySelectorAll('.note-list,.tree-list,.sidebar,.sidebar-body')].find(e=>e.scrollHeight>e.clientHeight+20); if(!c) return null; c.scrollTop += 480; return c.scrollTop;})()`);
    if(sc===null) break;
    scrollTries++;
    await new Promise(r=>setTimeout(r,300));
    rs=await rows();
    target=rs.find(r=>!opened.has(r.id));
  }
  if(!target){console.log(JSON.stringify({stopped:'no more rows after scroll',step,scrollTries}));break;}
  opened.add(target.id);
  const before=await tabs(); const mark=logs.length; const tA=Date.now();
  await ev(`(()=>{const row=document.querySelector('[data-tree-node-id="${target.id}"]'); if(row) row.click(); return !!row;})()`);
  let openedOk=false, initMs=null;
  for(let i=0;i<40;i++){ await new Promise(r=>setTimeout(r,80));
    const hit=logs.slice(mark).find(l=>/editor-perf\]\s*init/.test(l.t));
    if(hit){ initMs=Number((hit.t.match(/init\s+\S+\s+(\d+)ms/)||[])[1]??NaN)||null; }
    const now=await tabs(); if(now>before){openedOk=true; if(hit) break;}
  }
  const readyMs=Date.now()-tA;
  if(!openedOk){ misses++; console.log(JSON.stringify({skip:target.t,reason:'no new tab',readyMs}));
    const sc=await ev(`(()=>{const c=document.querySelector('.tree-list'); if(!c) return null; c.scrollTop+=420; return c.scrollTop;})()`); await new Promise(r=>setTimeout(r,250)); continue; }
  misses=0;
  await new Promise(r=>setTimeout(r,350)); await gc();
  const m=await metrics(); const tabsNow=await tabs(); const r=rssOfTree();
  const rec={step,title:target.t,...m,deltaMB:+(m.heapMB-m0.heapMB).toFixed(1),initMs,readyMs,tabs:tabsNow,rssMB:r?.rssMB??null,procs:r?.procs??null};
  out.push(rec); console.log(JSON.stringify(rec));
}
const fs=await import('node:fs');
fs.writeFileSync('/tmp/lk-spike-measure4.json', JSON.stringify(out,null,1));
console.log('WROTE /tmp/lk-spike-measure3.json');
ws.close();
