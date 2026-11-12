/** M3 导航 v2：所有目标都做命中测试（MOBILE-OPS §6：keep-alive 隐藏视图仍在 DOM）。 */
export default async ({ page }) => {
  const ev = (expr) => page.evaluate(expr);
  const trace = [];
  const clickByText = async (needle, tag, maxLen = 40) => {
    const hit = await ev('(()=>{const needle=' + JSON.stringify(needle) + ';const maxLen=' + maxLen + ';const all=[...document.querySelectorAll("button,[role=button],[aria-label],div,span")];for(const e of all){const al=e.getAttribute&&e.getAttribute("aria-label");const tx=(e.textContent||"").trim();const isAria=al&&al.indexOf(needle)>=0;const isText=tx.length>0&&tx.length<=maxLen&&tx.indexOf(needle)>=0&&e.children.length<=2;if(!isAria&&!isText)continue;const r=e.getBoundingClientRect();if(r.width<=0||r.height<=0)continue;const cx=r.x+r.width/2,cy=r.y+r.height/2;if(cx<0||cy<0||cx>innerWidth||cy>innerHeight)continue;const top=document.elementFromPoint(cx,cy);if(!top)continue;if(!(top===e||e.contains(top)))continue;return {how:isAria?"aria":"text",label:isAria?al:tx.slice(0,30),x:Math.round(cx),y:Math.round(cy)};}return null;})()');
    if (!hit) { trace.push({ step: tag, error: "target-not-clickable", needle }); return false; }
    await page.click(hit.x, hit.y);
    await page.sleep(1000);
    trace.push({ step: tag, hit });
    return true;
  };
  const snap = () => ev('(()=>{const vis=(e)=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0;};const btns=[...document.querySelectorAll("button,[role=button]")].filter(vis).map(b=>({t:(b.textContent||"").trim().slice(0,14),al:b.getAttribute("aria-label")||""})).filter(x=>x.t||x.al).slice(0,18);return {text:(document.body.innerText||"").slice(0,200),btns,ce:document.querySelectorAll("[contenteditable=true]").length,lockWords:((document.body.innerText||"").match(/锁定|只读/g)||[]).length};})()');
  await clickByText("个人笔记", "tap-notebook");
  trace.push({ step: "after-notebook", state: await snap() });
  // 工作区：打开文档树胶囊（不同版本 aria 可能是 文档树 / 目录）
  const treeOpened = await clickByText("文档树", "tap-tree");
  if (!treeOpened) await clickByText("目录", "tap-tree-alt");
  trace.push({ step: "after-tree", state: await snap() });
  await clickByText("M3锁定测试", "tap-doc", 60);
  trace.push({ step: "after-open-doc", state: await snap() });
  return trace;
};