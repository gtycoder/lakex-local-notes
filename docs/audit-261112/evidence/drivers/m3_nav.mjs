/** M3 导航：知识库 → 个人笔记 → 文档树 → 打开「M3锁定测试」，返回现场（是否可编辑/锁标识）。 */
export default async ({ page }) => {
  const ev = (expr) => page.evaluate(expr);
  const trace = [];
  const probe = () => ev('(()=>{const vis=(e)=>{if(!e)return false;const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&getComputedStyle(e).visibility!=="hidden";};const rect=(e)=>{const r=e.getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)};};return {text:(document.body.innerText||"").slice(0,300),buttons:[...document.querySelectorAll("button,[role=button]")].filter(vis).map(b=>({t:(b.textContent||"").trim().slice(0,16),al:b.getAttribute("aria-label")||"",r:rect(b)})).slice(0,30),contenteditables:[...document.querySelectorAll("[contenteditable=true]")].filter(vis).map(e=>({cls:String(e.className).slice(0,40),r:rect(e)})),lockWords:((document.body.innerText||"").match(/锁定|只读/g)||[]).length};})()');
  const tapText = async (needle, tag) => {
    const hit = await ev('(()=>{const vis=(e)=>{if(!e)return false;const r=e.getBoundingClientRect();return r.width>0&&r.height>0;};const rect=(e)=>{const r=e.getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)};};const all=[...document.querySelectorAll("button,[role=button],[aria-label],div,span")].filter(vis);for(const e of all){if((e.getAttribute("aria-label")||"").indexOf("' + needle + '")>=0){return {how:"aria",t:e.getAttribute("aria-label"),r:rect(e)};}}for(const e of all){const t=(e.textContent||"").trim();if(t.length<=40&&t.indexOf("' + needle + '")>=0&&e.children.length<=2){return {how:"text",t,r:rect(e)};}}return null;})()');
    if (!hit) { trace.push({ step: tag, error: "not found", needle }); return false; }
    await page.click(hit.r.x, hit.r.y);
    await page.sleep(900);
    trace.push({ step: tag, hit });
    return true;
  };
  // 1) 知识库 dock
  const { width, height } = await ev('({width:innerWidth,height:innerHeight})');
  await page.click(124, 815);
  await page.sleep(1200);
  trace.push({ step: "tap-library-dock", width, height });
  trace.push({ step: "after-library", state: await probe() });
  // 2) 笔记本卡「个人笔记」
  await tapText("个人笔记", "tap-notebook");
  trace.push({ step: "after-notebook", state: await probe() });
  // 3) 文档树胶囊
  await tapText("文档树", "tap-tree");
  trace.push({ step: "after-tree", state: await probe() });
  // 4) 打开 M3 文档
  await tapText("M3锁定测试", "tap-doc");
  trace.push({ step: "after-open-doc", state: await probe() });
  return trace;
};