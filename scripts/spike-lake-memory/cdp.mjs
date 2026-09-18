const PORT = process.env.SPIKE_CDP || 9232;
let page;
for (let i=0;i<20;i++) {
  try { const list = await fetch(`http://127.0.0.1:${PORT}/json/list`).then(r=>r.json()); page = list.find(t=>t.type==='page' && !t.url.startsWith('devtools')); if (page) break; } catch(e) {}
  await new Promise(r=>setTimeout(r,500));
}
if (!page) { console.error('no page target on', PORT); process.exit(1); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id=0; const pending=new Map();
const send=(method,params={})=>new Promise((res)=>{const i=++id;pending.set(i,res);ws.send(JSON.stringify({id:i,method,params}));});
ws.addEventListener('message',e=>{const m=JSON.parse(e.data); if(m.id&&pending.has(m.id)){pending.get(m.id)(m);pending.delete(m.id);}});
await new Promise(res=>ws.addEventListener('open',res));
const ev=async(expr)=>{const m=await send('Runtime.evaluate',{expression:expr,returnByValue:true,awaitPromise:true}); if(m.result?.exceptionDetails) return 'ERR:'+m.result.exceptionDetails.text; return m.result?.result?.value;};
const gc=async()=>{ await send('HeapProfiler.enable'); await send('HeapProfiler.collectGarbage'); await send('HeapProfiler.collectGarbage'); };
const heap=async()=>{ const m=await send('Runtime.getHeapUsage'); return m.result; };
const shot=async(path)=>{ const d=await send('Page.captureScreenshot',{format:'png'}); (await import('node:fs')).writeFileSync(path, Buffer.from(d.result.data,'base64')); };
const click=async(x,y)=>{ await send('Input.dispatchMouseEvent',{type:'mousePressed',x,y,button:'left',clickCount:1,buttons:1}); await send('Input.dispatchMouseEvent',{type:'mouseReleased',x,y,button:'left',clickCount:1,buttons:0}); };
const cmd = process.argv[2];
export {};
if (cmd==='reload') { await ev('location.reload()'); console.log('reloaded'); }
if (cmd==='ev') { console.log(JSON.stringify(await ev(process.argv[3]))); }
if (cmd==='baseline') { await gc(); const h=await heap(); console.log(JSON.stringify({usedMB:+(h.usedSize/1048576).toFixed(1), totalMB:+(h.totalSize/1048576).toFixed(1), embedders: (await ev('document.querySelectorAll(".ne-engine").length'))})); }
if (cmd==='shot') { await shot(process.argv[3]); console.log('shot', process.argv[3]); }
if (cmd==='rows') {
  const rows = await ev(`(()=>{const els=[...document.querySelectorAll('[class*=tree-row],[class*=tree-node]')].filter(e=>{const r=e.getBoundingClientRect(); return r.width>80 && r.height>14 && r.height<40 && r.x<400;}); return els.slice(0,60).map(e=>{const r=e.getBoundingClientRect(); return {t:(e.innerText||'').trim().slice(0,24), x:Math.round(r.x+r.width/2), y:Math.round(r.y+r.height/2)};});})()`);
  console.log(JSON.stringify(rows));
}
ws.close();
