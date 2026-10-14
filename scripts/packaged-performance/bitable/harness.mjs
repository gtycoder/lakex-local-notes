/** Isolated real-package release regression. Never touches production userData or system clipboard. */
import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {Cdp, wait, waitFor, stats} from '../cdp.mjs';
export {wait, waitFor, stats};
import {root, fixture, executable, cdpPort, mainPort, assetPort, assertFreePorts, newDataDir} from './config.mjs';
export {root};
export const editor = `document.querySelector('.bitable-editor[data-active="true"]')`;
export const cell = (rid, fid = 'f0') => `${editor}.querySelector('td[data-record-id="${rid}"][data-field-id="${fid}"]')`;
export function seed(data) {
  fs.cpSync(fixture, data, {recursive: true});
  const base = JSON.parse(fs.readFileSync(path.join(data, 'workspace-default/bitables/perf-bitable-5000.bitable.json'), 'utf8'));
  const types = ['text','number','select','multiSelect','date','boolean','rating','progress','link','attachment','image','relationOneWay','relationTwoWay','markdown','ai','createdTime','updatedTime','relationOneWay','number','text'];
  for (const count of [200, 5000]) {
    const doc = structuredClone(base), table = doc.tables[0];
    table.records.length = count;
    table.fields = types.map((type, i) => ({id: 'f'+i, name: type+(i===17?'大表':''), type, width: i===0?180:150,
      ...(['select','multiSelect'].includes(type)?{options:[{id:'a',name:'A',color:'#4a90e2'},{id:'b',name:'B',color:'#ff8800'}]}:{}),
      ...(type.startsWith('relation')?{relation:{tableId:i===17?'large-target':'related',allowMultiple:true,...(i===12?{pairedFieldId:'reverse'}:{})}}:{}),
      ...(type==='ai'?{ai:{prompt:'总结 {{text}}'}}:{})}));
    table.records.forEach((rec,i) => {rec.values={f0:'记录'+(i+1),f1:i,f2:i%2?'a':'b',f3:['a','b'],f4:'2026-10-14',f5:i%2===0,f6:4,f7:60,f8:'https://example.com',f9:[{file:'poc.txt',name:'合成附件.txt',size:4096}],f10:[{file:'poc.png',name:'合成图.png',size:68}],f11:['rel-1'],f12:['rel-2'],f13:'**说明**',f14:'已有AI结果',f17:['large-r0'],f18:i,f19:'附注'};});
    const plain={id:'plain',name:'普通',type:'grid',rowHeight:'low',columnStats:{f1:'sum'}};
    table.views=[plain,
      {...plain,id:'decorated',name:'填色查重',hiddenFieldIds:['f19'],highlightDuplicateFieldIds:['f2'],columnTextColors:{f0:'#b3382f'},fillRules:[{id:'cf',mode:'cell',color:'#ff8800',condition:{fieldId:'f1',operator:'greaterThanOrEqualTo',value:'10'}}]},
      {...plain,id:'filtered',name:'筛选降序',filters:[{fieldId:'f1',operator:'greaterThanOrEqualTo',value:String(Math.floor(count/2))}],sorts:[{fieldId:'f1',desc:true}]},
      {...plain,id:'grouped',name:'分组高行',rowHeight:'high',groups:[{fieldId:'f2'}]},
      {...plain,id:'empty',name:'空结果',filters:[{fieldId:'f1',operator:'greaterThan',value:'999999'}]},
      {...plain,id:'custom72',name:'自定义72',rowHeight:72}];
    table.activeViewId='plain';
    doc.tables.push({id:'related',name:'关联目标',fields:[{id:'rt',name:'名称',type:'text'},{id:'reverse',name:'反向关联',type:'relationTwoWay',relation:{tableId:table.id,pairedFieldId:'f12',allowMultiple:true}}],records:[1,2,3].map(i=>({id:'rel-'+i,values:{rt:'目标'+i,reverse:i===2?table.records.map(r=>r.id):[]},createdAt:'2026-10-14T00:00:00Z',updatedAt:'2026-10-14T00:00:00Z'})),views:[{id:'rv',name:'目标表格',type:'grid'}],activeViewId:'rv'});
    const targetFields=Array.from({length:20},(_,i)=>({id:'l'+i,name:'目标列'+i,type:i===0?'text':'number',width:150}));
    doc.tables.push({id:'large-target',name:'5000条关联目标',fields:targetFields,records:Array.from({length:5000},(_,i)=>({id:'large-r'+i,values:Object.fromEntries(targetFields.map((f,j)=>[f.id,j===0?'大目标'+i:i+j])),createdAt:'2026-10-14T00:00:00Z',updatedAt:'2026-10-14T00:00:00Z'})),views:[{id:'lv',name:'全部目标',type:'grid'}],activeViewId:'lv'});
    const id='perf-bitable-'+count;
    fs.writeFileSync(path.join(data,`workspace-default/bitables/${id}.bitable.json`),JSON.stringify(doc));
    const ad=path.join(data,'workspace-default/note-assets',id);fs.mkdirSync(ad,{recursive:true});fs.writeFileSync(path.join(ad,'poc.txt'),'合成附件'.repeat(100));fs.writeFileSync(path.join(ad,'poc.png'),Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aGxkAAAAASUVORK5CYII=','base64'));
  }
}
export async function launch(prepare) {
  await assertFreePorts();
  const data=newDataDir('business'); try{seed(data);if(prepare)await prepare(data);}catch(error){fs.rmSync(data,{recursive:true,force:true});throw error;}
  const env={...process.env,LAKE_USER_DATA:data,LAKE_ASSET_PORT:String(assetPort)};delete env.ELECTRON_RUN_AS_NODE;
  const log=fs.openSync(path.join(root,`evidence/business-${Date.now()}.log`),'w');
  const child=spawn(executable,[`--remote-debugging-port=${cdpPort}`,`--inspect=127.0.0.1:${mainPort}`],{env,stdio:['ignore',log,log]});
  let r,m;
  const close=async()=>{try{r?.close();m?.close();}catch{}if(child.exitCode===null){const exited=new Promise(resolve=>child.once('exit',resolve));child.kill('SIGTERM');await Promise.race([exited,wait(6000)]);if(child.exitCode===null){child.kill('SIGKILL');await wait(300);}}fs.closeSync(log);fs.rmSync(data,{recursive:true,force:true});};
  try {
    r=await Cdp.connect(cdpPort,t=>t.type==='page');m=await Cdp.connect(mainPort);
    await m.evaluate(`(()=>{const {BrowserWindow}=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron');const w=BrowserWindow.getAllWindows()[0];w.show();w.focus();w.setSize(1315,900);return true})()`);
    await r.send('Page.enable');await r.send('Page.bringToFront');await r.send('Emulation.setFocusEmulationEnabled',{enabled:true});await waitFor(r,'!!window.__desktopEditor');
    const runtime=await m.evaluate(`(()=>{const {app,BrowserWindow}=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron');return {packaged:app.isPackaged,gpu:app.isHardwareAccelerationEnabled(),sandbox:BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences().sandbox,contextIsolation:BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences().contextIsolation,versions:process.versions}})()`);
    if(!runtime.packaged||!runtime.gpu||!runtime.sandbox||!runtime.contextIsolation)throw new Error('Invalid packaged runtime or security configuration');
    async function click(expr,{double=false,modifiers=0}={}) {
      await r.evaluate(`(()=>{const e=(${expr});(e?.closest('td')??e)?.scrollIntoView({block:'nearest',inline:'nearest'});return true})()`);await wait(40);
      // Expand controls only exist geometrically after their owning cell is hovered.
      const hover=await r.evaluate(`(()=>{const e=(${expr});const q=(e?.closest('td')??e)?.getBoundingClientRect();return q?{x:q.x+Math.min(12,q.width/2),y:q.y+q.height/2}:null})()`);
      if(hover){await r.send('Input.dispatchMouseEvent',{type:'mouseMoved',...hover});await wait(60);}
      const p=await r.evaluate(`(()=>{const e=(${expr});if(!e)throw Error('missing target: '+${JSON.stringify(expr)});const q=e.getBoundingClientRect();if(!q.width||!q.height)throw Error('hidden target');return{x:q.x+Math.min(12,q.width/2),y:q.y+q.height/2}})()`);
      await r.send('Input.dispatchMouseEvent',{type:'mouseMoved',...p});
      for(let n=1;n<=(double?2:1);n++)for(const type of ['mousePressed','mouseReleased'])await r.send('Input.dispatchMouseEvent',{type,...p,button:'left',buttons:type==='mousePressed'?1:0,clickCount:n,modifiers});await wait(80);
    }
    const key=async(k,code,modifiers=0)=>{for(const type of ['keyDown','keyUp'])await r.send('Input.dispatchKeyEvent',{type,key:k,code,modifiers});await wait(60);};
    const text=async(expr,value)=>{await click(expr);await r.evaluate(`(()=>{const e=(${expr});if(document.activeElement!==e)throw Error('input did not focus');e.select();return true})()`);await r.send('Input.insertText',{text:value});await wait(80);};
    const scroll=async(where)=>{await r.evaluate(`(()=>{const w=${editor}.querySelector('.bt-grid-wrap');w.scrollTop=${where==='last'?'w.scrollHeight-w.clientHeight':where};w.dispatchEvent(new Event('scroll'));return true})()`);await wait(120);};
    const open=async(id='perf-bitable-5000')=>{await waitFor(r,`!!document.querySelector('[data-tree-node-id="${id}"]')`);await r.evaluate(`document.querySelector('[data-tree-node-id="${id}"]').click();true`);await waitFor(r,`!!document.querySelector('.tab-item.active[data-note-id="${id}"]') && !!${editor}?.querySelector('tbody')`);await wait(150);};
    const view=async(name)=>{await click(`[...${editor}.querySelectorAll('.bt-view-name')].find(e=>e.textContent===${JSON.stringify(name)})`);await wait(180);await scroll(0);};
    const saved=async(id='perf-bitable-5000')=>{await wait(2200);return r.evaluate(`window.lakeNative.readNote('${id}').then(n=>JSON.parse(n.content))`);};
    const snapshot=async(tag)=>{const x=await r.send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(root,'evidence',tag+'.png'),Buffer.from(x.data,'base64'));};
    return {r,m,child,data,runtime,close,click,key,text,scroll,open,view,saved,snapshot};
  }catch(e){await close();throw e;}
}
