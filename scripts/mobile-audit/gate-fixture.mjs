// 移动端**门禁专用实例**的固定夹具（261013 建；261125 门禁重建：nodeType 字段 + 默认笔记本回落）。
//
// ⚠️ **lake_gate 只跑门禁（261125 用户裁决）**：其它测试/走查一律另起模拟器实例（或桌面侧 LAKE_USER_DATA 独立目录），
//    不许在 lake_gate 上跑任何会造数据的装置（长文档探针/走查/多维表夹具…）—— 那些装置跑完都要重灌夹具 + 重烤基线。
//
// 为什么需要：check:mobilesnap 的 10 态里有"知识库书架/列表 / 首页小记 / 打开一篇文档"，
// 元素数与指纹**直接由设备里的数据决定** ⇒ 拿"用户正在用的那台"当基准环境，用户随手记一条小记就会把门禁打红（实测 +17 元素）。
// ⇒ 口径（AGENTS §7#14 · docs/MOBILE-OPS.md §5）：门禁跑在专用实例（AVD lake_gate）上，先用本文件灌一份**固定夹具**，再在它上面重烤基线。
//
// 用法（前置：lake_gate 已启动且装了包；CDP 转发到 9336；ANDROID_SERIAL 指向 lake_gate 那台）：
//   bash scripts/emu-cdp.sh 9336
//   node scripts/cdp-eval.mjs 9336 @scripts/mobile-audit/gate-fixture.mjs
// 标准重建顺序 = pm clear → am start → emu-cdp 9336 → 本文件 → 重烤基线（MOBILE-OPS §5.2/§5.3）。
// 语义护栏（防再被字段改名/回落假设静默破坏）：scripts/mobile-audit/gate-fixture.test.ts。
//
// 用产品自己的 window.lakeNative 建数据（不猜 DB/正文格式；也用不到 psql/sqlite 手改）。
// 幂等：已有同名笔记本/文档/小记就跳过，可反复跑。
(async () => {
  const L = window.lakeNative;
  if (!L) return { error: "window.lakeNative 不存在（页面还没起来？）" };
  /**
   * 文档必须挂在**首页书架第一张卡**的笔记本上：门禁的 home-doc 态是"点书架第一张卡"进的，
   * 挂到别的笔记本 ⇒ 第一张卡是空本、抽屉里没有文档行（实测踩过）。
   * 书架投影口径与 src/mobile/notebook/libraryNotebooks.ts 同源：
   * nodeType==='notebook' 且非日记本（space==='diary'）且非回收站（notebook-trash）。
   * 优先认全新库种子建的 notebook-personal（src/mobile/data/schema.ts，sort_order 0 = 书架第一本）；
   * **不假设它一定存在**（真实库/便携导入没有）⇒ 缺失时回落书架序第一本普通笔记本。
   * 判据只认 nodeType（TreeNode 的旧 type 字段已改名，认旧字段会静默找不到本）。
   */
  const DEFAULT_NB_ID = "notebook-personal";
  const TRASH_NB_ID = "notebook-trash";
  const isShelfNotebook = function (n) {
    return !!n && n.nodeType === "notebook" && n.id !== TRASH_NB_ID && n.space !== "diary";
  };
  // 5 篇：走查装置要 doc-0..doc-4 五行（3 篇时 doc-3/doc-4 会 ERR「not found: doc row #3/#4」，261013 实测）。
  const DOC_TITLES = ["夹具文档 1", "夹具文档 2", "夹具文档 3", "夹具文档 4", "夹具文档 5"];
  const QN_TEXTS = ["夹具小记 1", "夹具小记 2", "夹具小记 3", "夹具小记 4"];

  const nodes = await L.getHomeSnapshot().then(function(s){return s.treeNodes;});
  const findNb = async () => {
    const list = await L.getHomeSnapshot().then(function(s){return s.treeNodes;});
    return list.find((n) => n.id === DEFAULT_NB_ID && isShelfNotebook(n)) || list.find(isShelfNotebook) || null;
  };
  const nb = await findNb();
  if (!nb) return { error: "没有可用笔记本（书架一台普通笔记本都没有？）" };

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

  // 261029：全新安装会自带一条「欢迎」小记（固定 id welcome-quick-note，内容是欢迎页 + 使用说明链接）。
  // 门禁夹具要求**确定性 4 条小记**（快照基线依赖），这里把它物理删除；产品功能不受影响（其它设备照常）。
  let welcomeRemoved = false;
  const qnNow = await L.getQuickNotePage().then(function(p){return p.items;});
  if (qnNow.some(function(q){ return q.id === "welcome-quick-note"; })) {
    await L.purgeQuickNote("welcome-quick-note");
    welcomeRemoved = true;
  }

  const [nbAfter, notesAfter, qnAfter] = [await findNb(), await L.getHomeSnapshot().then(function(s){return s.notes;}), await L.getQuickNotePage().then(function(p){return p.items;})];
  return {
    notebook: nbAfter ? { id: nbAfter.id, title: nbAfter.title } : null,
    docsTotal: notesAfter.length,
    docsCreated: made.length,
    quickTotal: qnAfter.length,
    quickCreated: qnMade,
    welcomeRemoved,
    treeNodes: nodes.length,
  };
})()
