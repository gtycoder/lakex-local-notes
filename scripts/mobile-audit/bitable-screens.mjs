// 多维表关键屏走查探针（261117 device-qa P1-6②）：网格 / 编辑记录 / 字段管理 / 修改字段 / 视图配置 / 表单填写 / 看板。
//
// 为什么新探针而不是塞进 23 屏走查/10 态快照：走查按共享夹具的**行序号**导航、快照基线绑固定夹具，
// 而多维表需要一份自己的确定性夹具（+ 看板/表单/字段面板这些深屏）——沿用 mobile-bitable-snap 的
// 「自建夹具 + 跑完即删」惯例，不碰共享夹具、不碰用户数据、不动任何快照基线。
//
// 可见性判据（AGENTS §7.13 keep-alive 口径）：**rect>0 + 视口内 + elementFromPoint 命中**三件套 ——
// keep-alive 的隐藏 pane 还在 DOM 里，只 querySelector 会把不可见元素判成"到了"。
// 截图一律设备级 screencap（CDP Page.captureScreenshot 抓不到 GPU canvas 层）。
//
// 用法：node scripts/css-audit/drive.mjs 9335 scripts/mobile-audit/bitable-screens.mjs [tag] [only]
//   only = 逗号分隔的屏名（bitable-grid,bitable-record,bitable-fields,bitable-field-edit,bitable-view-config,bitable-form,bitable-kanban）
// 截图/报告：.css-audit/bitable-screens/<屏名>.png + report.json
import fs from "node:fs";
import { execSync } from "node:child_process";
import { data } from "../css-audit/paths.mjs";
import { settle, reload, expectOn } from "./snap-lib.mjs";

const ADB = process.env.ADB || "/opt/homebrew/share/android-commandlinetools/platform-tools/adb";
function deviceShot(file) { try { execSync(ADB + " exec-out screencap -p > " + JSON.stringify(file), { shell: "/bin/bash" }); return true; } catch (e) { return false; } }

const TITLE = "装置多维表-261117"; // 自建夹具唯一标题（清理只按它，绝不碰别的数据）
const OUT = data("bitable-screens");
fs.mkdirSync(OUT, { recursive: true });

const ts = "2026-06-09T02:00:00.000Z";
const record = (id, type, content, date) => ({ id, createdAt: ts, updatedAt: ts, values: { "f-type": type, "f-content": content, "f-date": date } });
const BODY = {
  kind: "bitable", version: 1, activeTableId: "tbl-screens",
  tables: [{
    id: "tbl-screens", name: "关键屏表", activeViewId: "",
    views: [
      { id: "v-grid", name: "表格", type: "grid", rowHeight: "low" },
      { id: "v-form", name: "表单", type: "form", formFieldIds: ["f-type", "f-content", "f-date"], formTitle: "关键屏表单", formDescription: "多维表关键屏探针用" },
      { id: "v-kanban", name: "看板", type: "kanban", kanbanGroupFieldId: "f-type" },
    ],
    fields: [
      { id: "f-type", name: "类型", type: "select", options: [{ id: "o1", name: "复盘", color: "green" }, { id: "o2", name: "提问", color: "blue" }] },
      { id: "f-content", name: "内容", type: "text" },
      { id: "f-date", name: "日期", type: "date" },
    ],
    records: [
      record("r1", "o1", "关键屏记录一：周三复盘结论。", "2026-06-09"),
      record("r2", "o2", "关键屏记录二：这周的问题。", "2026-06-10"),
      record("r3", "o1", "关键屏记录三：下周计划。", "2026-06-10"),
    ],
  }],
};
const BODY_JSON = JSON.stringify(BODY);

const seed = async (page) => page.evaluate(`(async () => {
  const L = window.lakeNative;
  if (!L) return { error: "window.lakeNative 不存在" };
  const purgeByTitle = async function (title) {
    const home0 = await L.getHomeSnapshot();
    for (const stale of home0.notes.filter(function (n) { return n.title === ${JSON.stringify(TITLE)}; })) {
      try { await L.trashNote(stale.id); await L.purgeTreeItem(stale.id, "note"); } catch (e) {}
    }
    try {
      const trash = await L.listTrashed();
      const nodes = Array.isArray(trash) ? trash : (trash && trash.nodes) || [];
      for (const item of nodes) {
        if (item && item.title === ${JSON.stringify(TITLE)}) { try { await L.purgeTreeItem(item.id, "note"); } catch (e) {} }
      }
    } catch (e) {}
  };
  await purgeByTitle();
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
    try { await L.trashNote(note.id); await L.purgeTreeItem(note.id, "note"); } catch (e) {}
  }
  try {
    const trash = await L.listTrashed();
    const nodes = Array.isArray(trash) ? trash : (trash && trash.nodes) || [];
    const leftover = nodes.filter(function (item) { return item && item.title === ${JSON.stringify(TITLE)}; }).length;
    if (leftover > 0) return { leftover: leftover };
  } catch (e) {}
  return { leftover: 0 };
})()`);

// ---- 命中测试（keep-alive 口径：rect>0 + 视口内 + elementFromPoint）----
const HIT_JS = `(function (sel, text) {
  var els = [].slice.call(document.querySelectorAll(sel));
  for (var i = 0; i < els.length; i++) {
    var el = els[i];
    if (el.disabled) continue; // 禁用按钮不是可达目标（与 walkthrough 探针同口径）
    if (text && ((el.getAttribute("aria-label") || el.title || el.textContent || "")).indexOf(text) < 0) continue;
    var r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) continue;
    if (r.bottom <= 0 || r.top >= innerHeight || r.right <= 0 || r.left >= innerWidth) continue;
    var cx = Math.round(r.x + r.width / 2), cy = Math.round(r.y + r.height / 2);
    var h = document.elementFromPoint(cx, cy);
    if (!h) continue;
    if (!(h === el || el.contains(h) || h.contains(el))) continue;
    return { ok: true, rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)] };
  }
  return { ok: false };
})`;

const hit = (page, sel, text) =>
  page.evaluate("(" + HIT_JS + ")(" + JSON.stringify(sel) + "," + JSON.stringify(text ?? null) + ")");

/** 真实点按：只点「命中测试通过」的元素（隐藏 pane / 遮罩下的元素一律不点）。 */
const tapHit = async (page, sel, text, waitMs) => {
  const r = await hit(page, sel, text);
  if (!r.ok) return false;
  await page.send("Input.dispatchMouseEvent", { type: "mousePressed", x: r.rect[0] + Math.round(r.rect[2] / 2), y: r.rect[1] + Math.round(r.rect[3] / 2), button: "left", clickCount: 1 });
  await page.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: r.rect[0] + Math.round(r.rect[2] / 2), y: r.rect[1] + Math.round(r.rect[3] / 2), button: "left", clickCount: 1 });
  await page.sleep(waitMs || 1200);
  return true;
};

/** 每次从冷启动首页进：知识库 → 第一张笔记本卡 → 工作区 → 文档树 → 夹具文档行。 */
const openFixture = async (page) => {
  await tapHit(page, ".mb-home-dock__item", "知识库", 1200);
  if (!(await tapHit(page, ".nb-shelf-card", null, 2600)) && !(await tapHit(page, ".nb-row", null, 2600))) {
    throw new Error("bitable-screens: 首页没有笔记本入口");
  }
  await expectOn(page, "!!document.querySelector('.mobile-workspace')", "第二层工作区");
  const rowsOpen = "!!document.querySelector('.side-panel--left.on .mb-row')";
  if (!(await page.evaluate(rowsOpen))) {
    if (!(await tapHit(page, ".mobile-bottom-bar__item", "文档树", 1200))) throw new Error("bitable-screens: 底栏找不到「文档树」");
  }
  if (!(await tapHit(page, ".side-panel--left.on .mb-row", TITLE, 1200))) throw new Error("bitable-screens: 目录里没有夹具文档 " + TITLE);
  await waitFor(page, "!!document.querySelector('.mobile-bitable')", 10000, "多维表视图");
};

/** 轮询等待（重载/打开文档的时延在重载的开发库上会超 2.4s 固定等待；到不了才抛）。 */
const waitFor = async (page, expr, ms, what) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await page.evaluate(expr)) return true;
    await page.sleep(400);
  }
  await expectOn(page, expr, what);
};

const enterEdit = async (page) => {
  if (await page.evaluate("!!document.querySelector('.mobile-bitable.is-editing')")) return;
  if (!(await tapHit(page, ".toolbar__button", "编辑", 800))) throw new Error("bitable-screens: 顶栏找不到「编辑」");
  await waitFor(page, "!!document.querySelector('.mobile-bitable.is-editing')", 6000, "多维表编辑态");
};

const closeSheet = async (page) => {
  if (await tapHit(page, "button", "关闭", 900)) return;
  // 兜底：点遮罩（MobileSheet 的关闭入口之一）
  await tapHit(page, ".mb-scrim", null, 900);
};

/** 每屏的可见性断言：[选择器, 文本过滤?, 说明]；全部走命中测试。 */
const SCREENS = [
  { name: "bitable-form", label: "表单填写", nav: async (page) => {
    await openFixture(page); // 默认视图规则 = 有表单视图就落表单（MobileBitableViewer）
    await expectOn(page, "!!document.querySelector('.mbt-form')", "多维表 · 表单填写");
    return [[".mbt-form", null, "表单容器"], [".mbt-form-input, .mbt-form-textarea, .mbt-form .mb-switch", null, "表单可填控件"]];
  } },
  { name: "bitable-grid", label: "网格", nav: async (page) => {
    await openFixture(page);
    await enterEdit(page);
    if (!(await tapHit(page, ".mbt-viewtab", "表格", 1200))) throw new Error("bitable-grid: 没有「表格」视图页签");
    await expectOn(page, "!!document.querySelector('.mbt-grid')", "多维表 · 网格");
    // ⚠️ .mbt-cell-btn **不再只属于记录单元格**：列头（排序与筛选快捷入口）也用同名类 ⇒ 必须限定 tbody，
    // 否则点到的是列头按钮（261117 实测：编辑记录屏因此拿不到记录面板）。
    return [[".mbt-grid", null, "网格表"], [".mbt-grid tbody .mbt-cell-btn", null, "可编辑单元格"], ["button", "字段管理", "头部·字段管理"]];
  } },
  { name: "bitable-record", label: "编辑记录", nav: async (page) => {
    await openFixture(page);
    await enterEdit(page);
    if (!(await tapHit(page, ".mbt-viewtab", "表格", 1200))) throw new Error("bitable-record: 没有「表格」视图页签");
    if (!(await tapHit(page, ".mbt-grid tbody .mbt-cell-btn", null, 1000))) throw new Error("bitable-record: 网格里没有可点的记录单元格（注意列头按钮与单元格共用 .mbt-cell-btn，必须 tbody 限定）");
    await waitFor(page, "!!document.querySelector('.mb-sheet')", 6000, "编辑记录面板");
    return [[".mb-sheet", null, "记录面板"], [".mb-sheet__title", "编辑记录", "面板标题"]];
  } },
  { name: "bitable-fields", label: "字段管理", nav: async (page) => {
    await openFixture(page);
    await enterEdit(page);
    if (!(await tapHit(page, "button", "字段管理", 900))) throw new Error("bitable-fields: 头部没有「字段管理」");
    await waitFor(page, "!!document.querySelector('.mb-sheet')", 6000, "字段管理面板");
    return [[".mb-sheet", null, "字段面板"], [".mb-sheet__title", "字段", "面板标题"], ["button", "修改字段", "行内·修改字段"]];
  } },
  { name: "bitable-field-edit", label: "修改字段", nav: async (page) => {
    await openFixture(page);
    await enterEdit(page);
    if (!(await tapHit(page, "button", "字段管理", 900))) throw new Error("bitable-field-edit: 头部没有「字段管理」");
    await waitFor(page, "!!document.querySelector('.mb-sheet')", 6000, "字段管理面板");
    if (!(await tapHit(page, "button", "修改字段", 900))) throw new Error("bitable-field-edit: 字段面板没有「修改字段」铅笔");
    // ⚠️ 嵌套面板：「修改字段」盖在「字段」面板之上，querySelector 只会拿到**第一个** title（外层的）⇒
    // 必须扫全部 .mb-sheet__title（keep-alive/嵌套浮层同族坑：单一 querySelector 会骗人）。
    await waitFor(page, "(function(){return [].slice.call(document.querySelectorAll('.mb-sheet__title')).some(function(t){return t.textContent.indexOf('修改字段')>=0;});})()", 6000, "修改字段面板");
    // 「必填」在面板底部：不滚进视口就会被命中测试判不可见（rect>0 但在视口外 ≠ 可见）。
    await page.evaluate("(function(){var els=[].slice.call(document.querySelectorAll('button'));var e=els.find(function(x){return (x.getAttribute('aria-label')||'')==='必填';});if(e)e.scrollIntoView({block:'center'});return !!e;})()");
    await page.sleep(400);
    return [[".mb-sheet__title", "修改字段", "面板标题"], [".mbt-form-input", null, "字段标题输入"], ["button", "必填", "必填开关"]];
  } },
  { name: "bitable-view-config", label: "视图配置", nav: async (page) => {
    await openFixture(page);
    await enterEdit(page);
    if (!(await tapHit(page, "button", "筛选", 900))) throw new Error("bitable-view-config: 头部没有「筛选」");
    await waitFor(page, "!!document.querySelector('.mbt-vcfg')", 6000, "视图配置面板");
    return [[".mbt-vcfg", null, "视图配置体"], [".mbt-vcfg-tabs", null, "筛选/排序/布局页签"]];
  } },
  { name: "bitable-kanban", label: "看板", nav: async (page) => {
    await openFixture(page);
    if (!(await tapHit(page, ".mbt-viewtab", "看板", 1400))) throw new Error("bitable-kanban: 没有「看板」视图页签");
    await expectOn(page, "!!document.querySelector('.mbt-kanban')", "多维表 · 看板");
    return [[".mbt-kanban", null, "看板列容器"], [".mbt-kanban-col", null, "看板分栏"]];
  } },
];

export default async ({ page, args }) => {
  const tag = args[0] || "run";
  const only = args[1] ? args[1].split(",") : null;
  const out = { tag, screens: {} };
  try {
    const seeded = await seed(page);
    if (seeded.error) throw new Error("bitable-screens 夹具失败：" + seeded.error);
    await reload(page, "shelf");
    for (const st of SCREENS) {
      if (only && !only.includes(st.name)) continue;
      const rec = { ok: false, checks: [] };
      // 装置抖动（CDP 断连 / adb 卡顿）不该把屏判成产品失败 ⇒ 每屏失败重跑一次再定论。
      for (let attempt = 1; attempt <= 2 && !rec.ok; attempt++) {
        try {
          await reload(page, "shelf");
          const targets = await st.nav(page);
          await settle(page);
          rec.checks = [];
          for (const [sel, text, what] of targets) {
            const r = await hit(page, sel, text);
            rec.checks.push({ what, ok: r.ok, rect: r.rect || null });
          }
          rec.ok = rec.checks.every((c) => c.ok);
          if (!rec.ok && attempt === 1) { rec.retryNote = "首轮有不可见检查，重跑一次"; continue; }
          rec.shot = st.name + ".png";
          deviceShot(OUT + "/" + st.name + ".png");
        } catch (e) {
          rec.error = String((e && e.message) || e).slice(0, 200);
          if (attempt === 2) continue;
          rec.retryNote = "首轮异常（装置抖动？），重跑一次：" + rec.error;
          rec.error = null;
        }
      }
      out.screens[st.name] = rec;
      const bad = rec.checks.filter((c) => !c.ok).map((c) => c.what);
      console.log("[bitable-screens] " + st.name + "（" + st.label + "）" + (rec.ok ? "ok" : "FAIL " + (rec.error || "不可见: " + bad.join(","))));
    }
  } finally {
    try {
      const cleaned = await cleanup(page);
      if (cleaned && cleaned.leftover > 0) console.error("[bitable-screens] 清理后回收站仍有 " + cleaned.leftover + " 条夹具（请手工 purge）");
    } catch (e) { console.error("[bitable-screens] 夹具清理失败：" + e.message); }
  }
  fs.writeFileSync(OUT + "/report.json", JSON.stringify(out, null, 1));
  const names = Object.keys(out.screens);
  return {
    tag,
    screens: names.length,
    pass: names.filter((n) => out.screens[n].ok).length,
    file: OUT + "/report.json",
  };
};
