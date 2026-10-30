// 多维表专项整页快照（261030）：表单 / 内容·表格 / 内容·卡片 三态。
//
// 为什么单独一套：6 态整页快照与 23 屏走查都**不含** bitable 屏，而把多维表塞进共享夹具会影响
// home-doc（最近文档顺序）与走查的行序号；这里用「本脚本自建确定性夹具 + 跑完即删」的独立装置，
// 不碰共享夹具与既有基线。夹具 = 固定 id 的 grid(按日期分组)+form 双视图 + 3 条记录。
//
// 用法：node scripts/css-audit/drive.mjs 9336 scripts/mobile-audit/mobile-bitable-snap.mjs <tag>
// 门禁：node scripts/mobile-audit/check-bitable-snap.mjs [--write-baseline]
import fs from "node:fs";
import { data } from "../css-audit/paths.mjs";
import { snapExpr } from "../css-audit/stylesnap.mjs";
import { settle, reload, tapSel, tapByLabel, tapByText, clickText, expectOn } from "./snap-lib.mjs";

const SNAP_EXPR = snapExpr(4);
const TITLE = "门禁多维表";

const ts = "2026-06-09T02:00:00.000Z";
const record = (id, type, content, date) => ({ id, createdAt: ts, updatedAt: ts, values: { "f-type": type, "f-content": content, "f-date": date } });
const BODY = {
  kind: "bitable", version: 1, activeTableId: "tbl-gate",
  tables: [{
    id: "tbl-gate", name: "门禁表", activeViewId: "v-grid",
    views: [
      { id: "v-grid", name: "内容", type: "grid", rowHeight: "low", groups: [{ fieldId: "f-date" }] },
      { id: "v-form", name: "表单", type: "form", formFieldIds: ["f-type", "f-content", "f-date"], formTitle: "门禁表单", formDescription: "门禁专项快照用" },
    ],
    fields: [
      { id: "f-type", name: "类型", type: "select", required: true, options: [{ id: "o1", name: "复盘", color: "green" }, { id: "o2", name: "提问", color: "blue" }] },
      { id: "f-content", name: "内容", type: "text", required: true },
      { id: "f-date", name: "日期", type: "date" },
    ],
    records: [
      record("r1", "o1", "快照记录一：周三复盘结论。", "2026-06-09"),
      record("r2", "o2", "快照记录二：这周的问题。", "2026-06-10"),
      record("r3", "o1", "快照记录三：下周计划。", "2026-06-10"),
    ],
  }],
};
const BODY_JSON = JSON.stringify(BODY);

const seed = async (page) => page.evaluate(`(async () => {
  const L = window.lakeNative;
  if (!L) return { error: "window.lakeNative 不存在" };
  const home0 = await L.getHomeSnapshot();
  for (const stale of home0.notes.filter(function (n) { return n.title === ${JSON.stringify(TITLE)}; })) {
    try { await L.trashNote(stale.id); await L.purgeTreeItem(stale.id); } catch (e) {}
  }
  // 上次中断可能留下「回收站里的门禁表」：它会在文档抽屉里多一行回收站入口 ⇒ 6 态整页快照 +1 行（实测踩到）。
  try {
    const trash = await L.listTrashed();
    const nodes = Array.isArray(trash) ? trash : (trash && trash.nodes) || [];
    for (const item of nodes) {
      if (item && item.title === ${JSON.stringify(TITLE)}) { try { await L.purgeTreeItem(item.id); } catch (e) {} }
    }
  } catch (e) {}
  const home = await L.getHomeSnapshot();
  const nb = home.treeNodes.find(function (n) { return n.type === "notebook"; }) || home.treeNodes[0];
  if (!nb) return { error: "没有笔记本" };
  const note = await L.createBitable(${JSON.stringify(TITLE)}, nb.id);
  await L.saveNote(note.id, ${JSON.stringify(TITLE)}, ${JSON.stringify(BODY_JSON)});
  try {
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.indexOf("lakex-local-notes-mobile.bitable-layout.") === 0) keys.push(k);
    }
    keys.forEach(function (k) { localStorage.removeItem(k); });
  } catch (e) {}
  return { noteId: note.id };
})()`);

const cleanup = async (page) => page.evaluate(`(async () => {
  const L = window.lakeNative;
  const home = await L.getHomeSnapshot();
  for (const note of home.notes.filter(function (n) { return n.title === ${JSON.stringify(TITLE)}; })) {
    try { await L.trashNote(note.id); await L.purgeTreeItem(note.id); } catch (e) {}
  }
  // 自检：回收站里不能再留同名的门禁表（否则会扰动 6 态整页快照的文档抽屉）。
  try {
    const trash = await L.listTrashed();
    const nodes = Array.isArray(trash) ? trash : (trash && trash.nodes) || [];
    const leftover = nodes.filter(function (item) { return item && item.title === ${JSON.stringify(TITLE)}; }).length;
    if (leftover > 0) return { leftover: leftover };
  } catch (e) {}
  return { leftover: 0 };
})()`);

/** 每次从冷启动首页进：知识库 → 第一张笔记本卡 → 文档树 → 夹具文档行。 */
const openFixture = async (page) => {
  await clickText(page, ".mobile-htab", "知识库");
  if (!(await tapSel(page, ".nb-shelf-card", 2600)) && !(await tapSel(page, ".nb-row", 2600))) {
    throw new Error("bitable-snap: 首页没有笔记本入口");
  }
  await expectOn(page, "!!document.querySelector('.mobile-workspace')", "第二层工作区");
  const rowsOpen = "!!document.querySelector('.side-panel--left.on .mb-row')";
  if (!(await page.evaluate(rowsOpen))) {
    if (!(await tapByLabel(page, ".mobile-bottom-bar__item", "文档树", 1200))) throw new Error("bitable-snap: 底栏找不到「文档树」");
  }
  if (!(await tapByText(page, ".side-panel--left.on .mb-row", TITLE, 2400))) throw new Error("bitable-snap: 目录里没有夹具文档 " + TITLE);
  await expectOn(page, "!!document.querySelector('.mobile-bitable')", "多维表视图");
};

export const STATES = [
  { name: "bitable-form", nav: async (page) => {
    await openFixture(page);
    await expectOn(page, "!!document.querySelector('.mbt-form')", "多维表 · 表单（填写态）");
  } },
  { name: "bitable-table", nav: async (page) => {
    await openFixture(page);
    if (!(await tapByText(page, ".mbt-viewtab", "内容", 1200))) throw new Error("bitable-table: 没有「内容」视图页签");
    await expectOn(page, "!!document.querySelector('.mbt-grid')", "多维表 · 内容（表格布局）");
  } },
  { name: "bitable-card", nav: async (page) => {
    await openFixture(page);
    if (!(await tapByText(page, ".mbt-viewtab", "内容", 1200))) throw new Error("bitable-card: 没有「内容」视图页签");
    if (!(await tapByLabel(page, "button", "视图配置", 900))) throw new Error("bitable-card: 工具行没有「视图配置」");
    if (!(await tapByText(page, ".mbt-tile", "卡片", 900))) throw new Error("bitable-card: 面板里没有「卡片」磁贴");
    if (!(await tapByLabel(page, "button", "关闭", 900))) throw new Error("bitable-card: 面板没有关闭按钮");
    await expectOn(page, "!!document.querySelector('.mbt-card')", "多维表 · 内容（卡片布局）");
  } },
];

export default async ({ page, args }) => {
  const tag = args[0] || "bitable";
  const out = { tag, states: {} };
  try {
    const seeded = await seed(page);
    if (seeded.error) throw new Error("bitable-snap 夹具失败：" + seeded.error);
    await reload(page, "shelf");
    for (const st of STATES) {
      await reload(page, "shelf");
      await st.nav(page);
      await settle(page);
      out.states[st.name] = await page.evaluate(SNAP_EXPR);
      console.log("  [bitable-snap] " + st.name + ": " + out.states[st.name].n + " els");
    }
  } finally {
    try {
      const cleaned = await cleanup(page);
      if (cleaned && cleaned.leftover > 0) console.error("[bitable-snap] 清理后回收站仍有 " + cleaned.leftover + " 条门禁表（会扰动 6 态快照）");
    } catch (e) { console.error("[bitable-snap] 夹具清理失败：" + e.message); }
  }
  fs.mkdirSync(data("snap"), { recursive: true });
  fs.writeFileSync(data("snap/" + tag + ".json"), JSON.stringify(out));
  return { tag, states: Object.keys(out.states).length, file: data("snap/" + tag + ".json") };
};
