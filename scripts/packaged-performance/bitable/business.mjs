import fs from 'node:fs';
import assert from 'node:assert/strict';
import * as hr from './harness.mjs';
const only=process.argv[2];if(only&&!/^[a-z0-9-]+$/i.test(only))throw new Error('Invalid check filter');const output=`business${only?'-'+only:''}.json`;
const h=await hr.launch();const result={runtime:h.runtime,checks:[],errors:[]};
const option=(name)=>`[...document.querySelectorAll('[role="option"]')].find(e=>e.textContent===${JSON.stringify(name)})`;
const button=(sel,name)=>`[...document.querySelectorAll(${JSON.stringify(sel)})].find(e=>e.textContent===${JSON.stringify(name)})`;
async function check(label,fn){if(only&&!label.includes(only))return;const t=performance.now();try{const details=await fn();result.checks.push({label,ok:true,ms:performance.now()-t,details});console.log('PASS',label,JSON.stringify(details));}catch(e){result.checks.push({label,ok:false,error:String(e),stack:e.stack});result.errors.push(label+': '+String(e));console.error('FAIL',label,e);await h.snapshot('release-failure-'+label);await h.key('Escape','Escape');}fs.writeFileSync(hr.root+'/evidence/'+output,JSON.stringify(result,null,2));}
try{
 await h.open();
 await check('select-multi-option-value-roundtrip',async()=>{
  await h.click(hr.cell('r0','f2')+'.querySelector("button")');await h.click(option('A'));
  await h.click(hr.cell('r0','f3')+'.querySelector("button")');await h.click(option('B'));await h.key('Escape','Escape');
  const d=await h.saved();assert.equal(d.tables[0].records[0].values.f2,'a');assert.deepEqual(d.tables[0].records[0].values.f3,['a']);return {select:'a',multi:['a']};
 });
 await check('date-boolean-rating-progress-edit',async()=>{
  await h.click(hr.cell('r0','f4')+'.querySelector("button")');await h.click(button('.bt-date-day','20'));
  await h.click(hr.cell('r0','f5')+'.querySelector("input")');
  await h.click(hr.cell('r0','f6')+'.querySelectorAll("button")[1]');
  await h.click(hr.cell('r0','f7')+'.querySelector(".bt-progress")');await h.key('ArrowRight','ArrowRight');
  const d=await h.saved(),v=d.tables[0].records[0].values;assert.equal(v.f4,'2026-10-20');assert.equal(v.f5,false);assert.equal(v.f6,2);assert.ok(Number.isFinite(v.f7)&&v.f7!==60);return {date:v.f4,boolean:v.f5,rating:v.f6,progress:v.f7};
 });
 await check('link-commit-and-cancel',async()=>{
  await h.click(hr.cell('r0','f8')+'.querySelector(".bt-link-cell")',{double:true});await h.text(hr.cell('r0','f8')+'.querySelector("input")','https://example.org/changed');await h.key('Enter','Enter');
  await h.click(hr.cell('r0','f8')+'.querySelector(".bt-link-cell")',{double:true});await h.text(hr.cell('r0','f8')+'.querySelector("input")','https://example.org/cancel');await h.key('Escape','Escape');
  const d=await h.saved();assert.equal(d.tables[0].records[0].values.f8,'https://example.org/changed');return {committed:true,cancelPreserved:true};
 });
 await check('relation-cancel-confirm-two-way-mirror',async()=>{
  await h.click(hr.cell('r0','f11')+'.querySelector("button")');await h.click(`document.querySelector('.bt-rel-picker input[aria-label="选择 目标3"]')`);await h.click(button('.bt-rel-foot button','取消'));
  let d=await h.saved();assert.deepEqual(d.tables[0].records[0].values.f11,['rel-1']);
  await h.click(hr.cell('r0','f11')+'.querySelector("button")');await h.click(`document.querySelector('.bt-rel-picker input[aria-label="选择 目标3"]')`);await h.click(button('.bt-rel-foot button','确认'));
  await h.click(hr.cell('r0','f12')+'.querySelector("button")');await h.click(`document.querySelector('.bt-rel-picker input[aria-label="选择 目标2"]')`);await h.click(`document.querySelector('.bt-rel-picker input[aria-label="选择 目标3"]')`);await h.click(button('.bt-rel-foot button','确认'));
  d=await h.saved();assert.deepEqual(d.tables[0].records[0].values.f11,['rel-1','rel-3']);assert.deepEqual(d.tables[0].records[0].values.f12,['rel-3']);const target=d.tables.find(t=>t.id==='related');assert.ok(!target.records[1].values.reverse.includes('r0'));assert.ok(target.records[2].values.reverse.includes('r0'));return {cancelPreserved:true,oneWay:true,twoWayMirrored:true};
 });
 await check('markdown-ai-snapshots-and-attachment-undo',async()=>{
  await h.scroll(0);
  for(const [fid,value] of [['f13','**修改说明**'],['f14','AI结果手动修改']]) {
   await h.click(hr.cell('r0',fid)+'.querySelector(".bt-expand-btn")');
   if(fid==='f14'){assert.ok(await h.r.evaluate(`!!document.querySelector('.bt-md-expand-preview')`));await h.click(button('.bt-md-expand-actions .ln-segment__item','编辑'));}
   await h.text(`document.querySelector('.bt-md-expand-editor')`,value);
   await h.click(`document.querySelector('.bt-text-expand [aria-label="关闭"]')`);
  }
  await h.click(hr.cell('r0','f9')+'.querySelector(".bt-expand-btn")');
  await h.click(`document.querySelector('.bt-attach-expand button[aria-label^="编辑名称 "]')`);
  await h.text(`document.querySelector('.bt-attach-card-rename-input')`,'重命名');await h.key('Enter','Enter');
  await h.click(`document.querySelector('.bt-attach-card-remove')`);
  await h.click(`document.querySelector('.bt-attach-expand button[aria-label="关闭"]')`);
  await h.r.evaluate('document.activeElement?.blur();true');await h.key('z','KeyZ',4);
  const d=await h.saved(),v=d.tables[0].records[0].values;
  assert.equal(v.f13,'**修改说明**');assert.equal(v.f14,'AI结果手动修改');assert.equal(v.f9[0].name,'重命名.txt');assert.equal(v.f9[0].file,'poc.txt');
  return {markdown:true,aiManual:true,attachmentRename:true,removeUndo:true};
 });
 await check('filtered-sort-last-row-stat-full-model',async()=>{
  await h.view('筛选降序');const s=await h.r.evaluate(`({count:${hr.editor}.querySelector('tbody').dataset.recordCount,ids:[...${hr.editor}.querySelectorAll('tr[data-record-id]')].map(e=>e.dataset.recordId),stat:${hr.editor}.querySelector('.bt-stat-row').textContent})`);assert.equal(s.count,'2500');assert.equal(s.ids[0],'r4999');assert.ok(s.stat.includes('9373750'));assert.ok(s.ids.length<50);
  await h.scroll('last');assert.ok(await h.r.evaluate(`!!${hr.cell('r2500')}`));await h.view('普通');return {count:s.count,first:s.ids[0],sum:9373750,last:'r2500'};
 });
 await check('stats-menu-change-refresh-and-save',async()=>{
  await h.click(`${hr.editor}.querySelectorAll('.bt-stat-cell .bt-stat')[1]`);await h.click(button('.bt-menu-item','平均值'));
  const d=await h.saved();assert.equal(d.tables[0].views.find(v=>v.id==='plain').columnStats.f1,'average');assert.ok(await h.r.evaluate(`${hr.editor}.querySelector('.bt-stat-row').textContent.includes('2499.5')`));return {type:'average',value:2499.5};
 });
 await check('duplicate-and-conditional-fill-refresh',async()=>{
  await h.view('填色查重');await h.scroll(360);
  const before=await h.r.evaluate(`({class:${hr.cell('r10','f1')}.className,style:${hr.cell('r10','f1')}.getAttribute('style'),duplicate:${hr.cell('r10','f2')}.className,color:getComputedStyle(${hr.cell('r10','f0')}).color})`);assert.ok(before.duplicate.includes('in-highlight'));assert.ok(before.style.includes('gradient'));
  await h.text(hr.cell('r10','f1')+'.querySelector("input")','-1');await h.key('Escape','Escape');
  const after=await h.r.evaluate(`${hr.cell('r10','f1')}.getAttribute('style')`);assert.ok(!after.includes('gradient'));const d=await h.saved();assert.equal(d.tables[0].records[10].values.f1,-1);assert.equal(d.tables[0].views.find(v=>v.id==='decorated').fillRules.length,1);await h.view('普通');return {changedProjection:true,duplicate:true,storedValue:-1};
 });
 await check('empty-view-add-row-and-return',async()=>{
  await h.view('空结果');const state=await h.r.evaluate(`({rows:${hr.editor}.querySelectorAll('tr[data-record-id]').length,count:${hr.editor}.querySelector('tbody').dataset.recordCount,stat:${hr.editor}.querySelector('.bt-stat-row').textContent,add:!!${hr.editor}.querySelector('.bt-add-row')})`);assert.equal(state.rows,0);assert.equal(state.count,'0');assert.ok(state.stat.includes('共 0 条'));assert.ok(state.add);await h.view('普通');return state;
 });
 await check('popup-editing-row-survives-scroll-and-hides',async()=>{
  await h.click(hr.cell('r0','f2')+'.querySelector("button")');await h.scroll('last');assert.ok(await h.r.evaluate(`!!${hr.cell('r0','f2')}`));await h.click(option('B'));const d=await h.saved();assert.equal(d.tables[0].records[0].values.f2,'b');
  await h.scroll(0);await h.click(hr.cell('r0','f2')+'.querySelector("button")');await h.open('perf-bitable-200');assert.equal(await h.r.evaluate(`document.querySelectorAll('[role="listbox"]').length`),0);await h.open();return {scrollPin:true,hiddenPopupReleased:true};
 });
 await check('large-relation-picker-window-budget',async()=>{
  await h.view('普通');await h.scroll(0);const t=performance.now();await h.click(hr.cell('r0','f17')+'.querySelector("button")');
  const state=await h.r.evaluate(`({rows:document.querySelectorAll('.bt-rel-grid tbody tr:not(.bt-virtual-spacer)').length,cells:document.querySelectorAll('.bt-rel-grid tbody td').length,all:document.querySelector('.bt-rel-tabs')?.textContent,heap:performance.memory?.usedJSHeapSize})`);
  const openMs=performance.now()-t;await h.snapshot('release-large-relation');assert.ok(state.rows<60,JSON.stringify({openMs,...state}));
  await h.r.evaluate(`(()=>{const w=document.querySelector('.bt-rel-body');w.scrollTop=w.scrollHeight-w.clientHeight;w.dispatchEvent(new Event('scroll'));return true})()`);await hr.wait(180);
  await h.click(`document.querySelector('.bt-rel-grid tr[data-record-id="large-r4999"] input[type="checkbox"]')`);
  await h.text(`document.querySelector('.bt-rel-search input')`,'大目标4998');
  assert.equal(await h.r.evaluate(`document.querySelectorAll('.bt-rel-grid tr[data-record-id]').length`),1);
  await h.click(`document.querySelector('.bt-rel-grid tr[data-record-id="large-r4998"] input[type="checkbox"]')`);
  await h.text(`document.querySelector('.bt-rel-search input')`,'');
  await h.click(`document.querySelector('.bt-rel-tabs button[aria-selected="false"]')`);
  assert.deepEqual(await h.r.evaluate(`[...document.querySelectorAll('.bt-rel-grid tr[data-record-id]')].map(e=>e.dataset.recordId)`),['large-r0','large-r4999','large-r4998']);
  await h.click(button('.bt-rel-foot button','确认'));const d=await h.saved();assert.deepEqual(d.tables[0].records[0].values.f17,['large-r0','large-r4999','large-r4998']);return {openMs,...state,lastAndSearchAndSelectedOrder:true};
 });
 if(!result.checks.length)throw new Error('No matching checks were executed');
 result.complete=result.errors.length===0;
}catch(e){result.errors.push(String(e));console.error(e);}
finally{await h.close();fs.writeFileSync(hr.root+'/evidence/'+output,JSON.stringify(result,null,2));if(result.errors.length)process.exitCode=1;}
