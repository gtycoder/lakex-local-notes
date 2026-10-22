// 移动端**门禁专用实例**的固定夹具（261013 建）。
//
// 为什么需要：check:mobilesnap 的 6 态里有"知识库书架/列表 / 首页小记 / 打开一篇文档"，
// 元素数与指纹**直接由设备里的数据决定** ⇒ 拿"用户正在用的那台"当基准环境，用户随手记一条小记就会把门禁打红（实测 +17 元素）。
// ⇒ 口径（AGENTS §7.27）：门禁跑在专用实例（AVD lake_gate）上，先用本文件灌一份**固定夹具**，再在它上面重烤基线。
//
// 用法（前置：lake_gate 已启动且装了包；CDP 转发到 9336）：
//   ANDROID_SERIAL=emulator-5556 bash scripts/emu-cdp.sh 9336
//   node scripts/cdp-eval.mjs 9336 @scripts/mobile-audit/gate-fixture.mjs
//
// 用产品自己的 window.lakeNative 建数据（不猜 DB/正文格式；也用不到 psql/sqlite 手改）。
// 幂等：已有同名笔记本/文档/小记就跳过，可反复跑。
(async () => {
  const L = window.lakeNative;
  if (!L) return { error: "window.lakeNative 不存在（页面还没起来？）" };
  /** 文档必须挂在**默认笔记本**上：门禁的 home-doc 态是"点书架第一张卡"进的，
   *  若另建一个笔记本，第一张卡是空的默认笔记本 ⇒ 抽屉里没有文档行（实测踩过）。 */
  const DEFAULT_NB_ID = "notebook-personal";
  // 5 篇：走查装置要 doc-0..doc-4 五行（3 篇时 doc-3/doc-4 会 ERR「not found: doc row #3/#4」，261013 实测）。
  const DOC_TITLES = ["夹具文档 1", "夹具文档 2", "夹具文档 3", "夹具文档 4", "夹具文档 5"];
  const QN_TEXTS = ["夹具小记 1", "夹具小记 2", "夹具小记 3", "夹具小记 4"];

  const nodes = await L.getHomeSnapshot().then(function(s){return s.treeNodes;});
  const findNb = async () => {
    const list = await L.getHomeSnapshot().then(function(s){return s.treeNodes;});
    return list.find((n) => n.id === DEFAULT_NB_ID) || list.find((n) => n.type === "notebook") || null;
  };
  const nb = await findNb();
  if (!nb) return { error: "没有可用笔记本（默认笔记本也没有？）" };

  const existing = await L.getHomeSnapshot().then(function(s){return s.notes;});
  const made = [];
  for (const title of DOC_TITLES) {
    if (existing.some((n) => n.title === title)) continue;
    const note = await L.createNote(title, nb.id);
    made.push({ id: note.id, title });
  }

  const qnBefore = await L.getQuickNotePage().then(function(p){return p.items;});
  let qnMade = 0;
  for (const text of QN_TEXTS) {
    if (qnBefore.some((q) => (q.previewText || "").indexOf(text) >= 0)) continue;
    await L.createQuickNote(text);
    qnMade += 1;
  }

  const [nbAfter, notesAfter, qnAfter] = [await findNb(), await L.getHomeSnapshot().then(function(s){return s.notes;}), await L.getQuickNotePage().then(function(p){return p.items;})];
  return {
    notebook: nbAfter ? { id: nbAfter.id, title: nbAfter.title } : null,
    docsTotal: notesAfter.length,
    docsCreated: made.length,
    quickTotal: qnAfter.length,
    quickCreated: qnMade,
    treeNodes: nodes.length,
  };
})()