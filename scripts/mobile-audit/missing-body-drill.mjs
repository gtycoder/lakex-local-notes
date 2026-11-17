// P0-2 缺正文 / 缺小记恢复路径**设备演练**（261117 device-qa）。
//
// 演练契约（docs/RESILIENCE.md §3.7 的 checklist 就是按它逐项打勾）：
//   ① 只用**新建的测试文档/小记**做破坏 —— 标题/文本带固定标记，收尾彻底删除，绝不碰用户已有数据；
//   ② 破坏走**文件层**（adb run-as rm 正文文件），不是产品删除入口；
//   ③ 验证 app 行为：缺正文文档「不打开 + 每篇每会话一次 toast」、缺小记同口径、资源管理清单与可恢复性判据；
//   ④ 走三条恢复路径：历史恢复（文档）/ 云端恢复（**云端无配置则如实登记跳过**，直接调接口取 reason）/
//      搜索索引兜底（小记重建纯文本）；
//   ⑤ 证据：每步设备级截图 + steps.json（桥返回值 / toast 文案 / 文件层验证）+ logcat 尾巴。
//
// 用法：node scripts/css-audit/drive.mjs 9335 scripts/mobile-audit/missing-body-drill.mjs [tag]
// 证据：.css-audit/resilience-drill-<tag>/NN-*.png + steps.json + logcat.txt
import fs from "node:fs";
import { execSync } from "node:child_process";
import { data } from "../css-audit/paths.mjs";
import { settle, reload } from "./snap-lib.mjs";

const ADB = process.env.ADB || "/opt/homebrew/share/android-commandlinetools/platform-tools/adb";
const PKG = "com.lakexlocalnotes.android";
const DOC_TITLE = "演练文档-缺正文-261117";
const QN_MARK = "演练小记-缺正文-261117";
const DOC_MARK = "演练正文标记-261117-deviceqa";

const adb = (args) => execSync(ADB + " " + args, { encoding: "utf8", timeout: 15000 });
function deviceShot(file) { try { execSync(ADB + " exec-out screencap -p > " + JSON.stringify(file), { shell: "/bin/bash" }); return true; } catch (e) { return false; } }

const HIT_JS = `(function (sel, text) {
  var els = [].slice.call(document.querySelectorAll(sel));
  for (var i = 0; i < els.length; i++) {
    var el = els[i];
    if (el.disabled) continue;
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

export default async ({ page, args }) => {
  const tag = args[0] || "261117";
  const OUT = data("resilience-drill-" + tag);
  fs.mkdirSync(OUT, { recursive: true });
  const steps = { tag, out: OUT, created: {}, fileChecks: {}, toasts: {}, bridge: {}, ui: {}, errors: [] };
  let shotNo = 0;
  const shot = (name) => { shotNo += 1; const f = OUT + "/" + String(shotNo).padStart(2, "0") + "-" + name + ".png"; deviceShot(f); return f; };
  const hit = (sel, text) => page.evaluate("(" + HIT_JS + ")(" + JSON.stringify(sel) + "," + JSON.stringify(text ?? null) + ")");
  const tapHit = async (sel, text, waitMs) => {
    const r = await hit(sel, text);
    if (!r.ok) return false;
    const x = r.rect[0] + Math.round(r.rect[2] / 2), y = r.rect[1] + Math.round(r.rect[3] / 2);
    await page.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
    await page.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
    await page.sleep(waitMs || 1200);
    return true;
  };
  /** 自定义定位（block 作用域等 text 过滤做不到的）：表达式返回 [x,y] 或 null。 */
  const tapExpr = async (expr, waitMs) => {
    const p = await page.evaluate(expr);
    if (!p) return false;
    await page.send("Input.dispatchMouseEvent", { type: "mousePressed", x: p[0], y: p[1], button: "left", clickCount: 1 });
    await page.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: p[0], y: p[1], button: "left", clickCount: 1 });
    await page.sleep(waitMs || 1200);
    return true;
  };
  const toastText = () => page.evaluate("(function(){var t=document.querySelector('.mb-toast__text');return t?t.textContent:null;})()");
  // ⚠️ 引号会被**宿主 shell** 先吃一层（AGENTS §7.21 同族坑）：adb 的参数必须双引号包整体，
  // 内层单引号要原样送到**设备 shell**，否则 sh -c 收到的脚本是碎的（test 恒 false、假阴性）。
  const fileExists = (rel) => {
    try {
      const out = adb("shell \"run-as " + PKG + " sh -c 'test -f files/" + rel + " && echo YES || echo NO'\"");
      return out.trim().endsWith("YES");
    } catch (e) { return "ERR:" + String(e.message).slice(0, 60); }
  };
  const fileContains = (rel, mark) => { try { const out = adb("shell run-as " + PKG + " cat " + JSON.stringify("files/" + rel)); return out.indexOf(mark) >= 0; } catch (e) { return "ERR:" + String(e.message).slice(0, 60); } };

  const cleanupData = async () => {
    // 收尾（也是「彻底删除」链路的桥级兜底）：测试数据必须清干净，绝不留残渣。
    try {
      const home = await page.evaluate("window.lakeNative.getHomeSnapshot()");
      for (const n of home.notes.filter((x) => x.title === DOC_TITLE)) {
        await page.evaluate("window.lakeNative.trashNote(" + JSON.stringify(n.id) + ")");
        await page.evaluate("window.lakeNative.purgeTreeItem(" + JSON.stringify(n.id) + ", 'note')");
      }
    } catch (e) { steps.errors.push("cleanup doc: " + e.message); }
    try {
      if (steps.created.qnId) await page.evaluate("window.lakeNative.purgeQuickNote(" + JSON.stringify(steps.created.qnId) + ")");
    } catch (e) { steps.errors.push("cleanup qn: " + e.message); }
  };

  try {
    // ---------- 0. 前置：云配置状态（云端恢复能不能走就看它） ----------
    await reload(page, null);
    steps.bridge.listMissingBefore = await page.evaluate("window.lakeNative.listMissingBodies()");
    steps.cloudConfigured = steps.bridge.listMissingBefore.cloudConfigured === true;

    // ---------- 1. 新建测试数据（只新建；固定标记便于文件层核对） ----------
    const created = await page.evaluate(`(async () => {
      const L = window.lakeNative;
      const home = await L.getHomeSnapshot();
      const nb = home.treeNodes.find(function (n) { return n.type === "notebook"; }) || home.treeNodes[0];
      const doc = await L.createNote(${JSON.stringify(DOC_TITLE)}, nb.id);
      await L.saveNote(doc.id, ${JSON.stringify(DOC_TITLE)}, '<p id="' + doc.id + '-body" class="ne-p">' + ${JSON.stringify(DOC_MARK)} + '</p><p id="' + doc.id + '-body2" class="ne-p"><br></p>');
      await L.snapshotNote(doc.id);   // 历史恢复路径的前提：至少一份历史快照
      const qnId = await L.createQuickNote(${JSON.stringify(QN_MARK + "：正文用于搜索索引兜底恢复。")});
      try { await L.ensureSearchIndex(); } catch (e) {}
      // ⚠️ 小记 text_cache 是**搜索时惰性建**的（quickNotesSearch 按需对账）：没被搜索过的新小记
      // hasTextCache=false、判「没有可用备份」（261117 演练第一轮实测）。演示兜底路径必须先触发一次
      // 全文搜索（searchNotes 会带 searchQuickNotesByScope → reconcileQuickNotesIndex）。
      await L.searchNotes(${JSON.stringify(QN_MARK.slice(0, 6))});
      return { docId: doc.id, qnId: qnId };
    })()`);
    steps.created = created;
    steps.fileChecks.docBefore = fileExists("notes/" + created.docId + ".lake");
    steps.fileChecks.qnBefore = fileExists("quick-notes/items/" + created.qnId + ".qnote");
    steps.bridge.listNoteHistory = await page.evaluate("window.lakeNative.listNoteHistory(" + JSON.stringify(created.docId) + ")");
    steps.bridge.listMissingBeforeDelete = await page.evaluate("window.lakeNative.listMissingBodies()");

    // ---------- 2. 文件层删正文（破坏测试数据；不动任何其它文件） ----------
    adb("shell run-as " + PKG + " rm files/notes/" + created.docId + ".lake");
    adb("shell run-as " + PKG + " rm files/quick-notes/items/" + created.qnId + ".qnote");
    steps.fileChecks.docAfterDelete = fileExists("notes/" + created.docId + ".lake");
    steps.fileChecks.qnAfterDelete = fileExists("quick-notes/items/" + created.qnId + ".qnote");
    steps.bridge.listMissingAfterDelete = await page.evaluate("window.lakeNative.listMissingBodies()");

    // ---------- 3. app 行为：缺正文文档「不打开 + toast」 ----------
    await reload(page, null);
    await tapHit(".mb-home-dock__item", "知识库", 1200);
    if (!(await tapHit(".nb-shelf-card", null, 2400)) && !(await tapHit(".nb-row", null, 2400))) throw new Error("首页没有笔记本入口");
    if (!(await hit(".side-panel--left.on .mb-row", DOC_TITLE).then((r) => r.ok))) {
      await tapHit(".mobile-bottom-bar__item", "文档树", 1200);
    }
    if (!(await tapHit(".side-panel--left.on .mb-row", DOC_TITLE, 1500))) throw new Error("目录里没有测试文档 " + DOC_TITLE);
    await page.sleep(600);
    steps.toasts.docOpen = await toastText();
    // 「没打开」的判据 = 活动标签里**没有这篇测试文档**（keep-alive 会话可能恢复了别的用户标签，
    // 判「有没有编辑器挂载」会被无关标签骗过 —— 261117 演练第一轮实测）。
    steps.ui.activeTabTitles = await page.evaluate("[].slice.call(document.querySelectorAll('.doc-pane .doc-tab, .mobile-tab, .workspace-tab')).map(function(t){return t.textContent.trim();})");
    steps.ui.docDidNotOpen = (steps.ui.activeTabTitles || []).every((t) => t.indexOf(DOC_TITLE) < 0);
    steps.screens = steps.screens || {};
    steps.screens.docOpenToast = shot("doc-open-toast");

    // ---------- 4. app 行为：缺小记「不打开 + toast」 ----------
    await reload(page, null);
    await tapHit(".mb-home-dock__item", "小记", 1500);
    if (!(await tapHit(".qn-card", QN_MARK, 1500))) throw new Error("首页找不到测试小记卡片");
    await page.sleep(600);
    steps.toasts.qnOpen = await toastText();
    steps.screens.qnOpenToast = shot("qn-open-toast");

    // ---------- 5. 资源管理清单与判据（缺正文 / 缺小记两个 sheet） ----------
    await reload(page, null);
    await tapHit(".toolbar__button", "设置", 1300);
    if (!(await tapHit(".mobile-settings-row, .mobile-settings-list button, .mobile-settings-list .mb-list-item", "资源管理", 1300))) throw new Error("设置里找不到「资源管理」");
    await page.sleep(800);
    // 「缺正文」block 的「查看（N）」：block 作用域定位（同页还有其它「查看」按钮）
    const openMissing = (blockName) => tapExpr(`(function () {
      var blocks = [].slice.call(document.querySelectorAll(".mb-set-block"));
      for (var i = 0; i < blocks.length; i++) {
        var name = blocks[i].querySelector(".mb-set-block__name");
        if (!name || name.textContent.indexOf(${JSON.stringify(blockName)}) < 0) continue;
        var btn = blocks[i].querySelector("button");
        if (!btn) return null;
        var r = btn.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0) return null;
        return [Math.round(r.x + r.width / 2), Math.round(r.y + r.height / 2)];
      }
      return null;
    })()`, 1500);
    if (!(await openMissing("缺正文"))) throw new Error("资源管理里没有「缺正文」清单入口");
    steps.ui.docSheet = await page.evaluate(`(function(){
      var sheet = [].slice.call(document.querySelectorAll(".mb-sheet")).filter(function(s){var t=s.querySelector(".mb-sheet__title");return t && t.textContent.indexOf("缺正文")>=0;})[0];
      if (!sheet) return null;
      return { title: sheet.querySelector(".mb-sheet__title").textContent, rows: [].slice.call(sheet.querySelectorAll(".mb-set-block")).map(function(b){return { name: (b.querySelector(".mb-set-block__name")||{}).textContent||"", desc: (b.querySelector(".mb-set-item__desc")||{}).textContent||"", buttons: [].slice.call(b.querySelectorAll("button")).map(function(x){return x.textContent.trim();}) };}) };
    })()`);
    steps.screens.docMissingSheet = shot("doc-missing-sheet");
    // 云端恢复路径：设备无 S3 配置 ⇒ 直接调接口取 reason（如实登记跳过）
    steps.bridge.restoreMissingNoteBody = await page.evaluate("window.lakeNative.restoreMissingNoteBody(" + JSON.stringify(created.docId) + ")");
    // 历史恢复路径：点「恢复最新历史」
    if (!(await tapHit("button", "恢复最新历史", 1800))) throw new Error("缺正文清单没有「恢复最新历史」");
    steps.ui.docSheetFeedback = await page.evaluate(`(function(){var s=[].slice.call(document.querySelectorAll(".mb-sheet")).filter(function(x){var t=x.querySelector(".mb-sheet__title");return t && t.textContent.indexOf("缺正文")>=0;})[0];var f=s?s.querySelector("[role=alert], [role=status]"):null;return f?f.textContent:null;})()`);
    steps.screens.docRestored = shot("doc-history-restored");
    await tapHit("button", "关闭", 900);

    if (!(await openMissing("缺小记"))) throw new Error("资源管理里没有「缺小记」清单入口");
    steps.ui.qnSheet = await page.evaluate(`(function(){
      var sheet = [].slice.call(document.querySelectorAll(".mb-sheet")).filter(function(s){var t=s.querySelector(".mb-sheet__title");return t && t.textContent.indexOf("缺小记")>=0;})[0];
      if (!sheet) return null;
      return { title: sheet.querySelector(".mb-sheet__title").textContent, rows: [].slice.call(sheet.querySelectorAll(".mb-set-block")).map(function(b){return { name: (b.querySelector(".mb-set-block__name")||{}).textContent||"", desc: (b.querySelector(".mb-set-item__desc")||{}).textContent||"", buttons: [].slice.call(b.querySelectorAll("button")).map(function(x){return x.textContent.trim();}) };}) };
    })()`);
    steps.screens.qnMissingSheet = shot("qn-missing-sheet");
    steps.bridge.restoreMissingQuickNoteFromCloud = await page.evaluate("window.lakeNative.restoreMissingQuickNoteFromCloud(" + JSON.stringify(created.qnId) + ")");
    // 搜索索引兜底：重建纯文本（有二次确认）
    if (!(await tapHit("button", "重建纯文本", 1200))) throw new Error("缺小记清单没有「重建纯文本」（hasTextCache=false？见 listMissingAfterDelete）");
    await tapHit(".mb-actionsheet__item", "重建纯文本", 1800);
    steps.ui.qnSheetFeedback = await page.evaluate(`(function(){var s=[].slice.call(document.querySelectorAll(".mb-sheet")).filter(function(x){var t=x.querySelector(".mb-sheet__title");return t && t.textContent.indexOf("缺小记")>=0;})[0];var f=s?s.querySelector("[role=alert], [role=status]"):null;return f?f.textContent:null;})()`);
    steps.screens.qnRebuilt = shot("qn-text-rebuilt");
    await tapHit("button", "关闭", 900);

    // ---------- 6. 文件层核对恢复结果 ----------
    steps.fileChecks.docAfterRestore = fileExists("notes/" + created.docId + ".lake");
    steps.fileChecks.docContainsMark = fileContains("notes/" + created.docId + ".lake", DOC_MARK);
    steps.fileChecks.qnAfterRebuild = fileExists("quick-notes/items/" + created.qnId + ".qnote");
    steps.fileChecks.qnContainsMark = fileContains("quick-notes/items/" + created.qnId + ".qnote", "搜索索引兜底");
    steps.bridge.listMissingAfterRecover = await page.evaluate("window.lakeNative.listMissingBodies()");
  } catch (e) {
    steps.errors.push(String((e && e.message) || e).slice(0, 300));
    steps.screens = steps.screens || {};
    steps.screens.onError = shot("on-error");
  } finally {
    await cleanupData();
    steps.bridge.listMissingFinal = await page.evaluate("window.lakeNative.listMissingBodies().catch(function(){return null;})");
    try {
      fs.writeFileSync(OUT + "/logcat.txt", execSync(ADB + " logcat -d -t 400", { encoding: "utf8", timeout: 15000 }).slice(-20000));
    } catch (e) { /* 日志只是证据之一，拿不到不影响演练结论 */ }
    fs.writeFileSync(OUT + "/steps.json", JSON.stringify(steps, null, 1));
    console.log("[missing-body-drill] errors=" + JSON.stringify(steps.errors));
    console.log("[missing-body-drill] 证据目录 " + OUT);
  }
  return {
    tag,
    cloudConfigured: steps.cloudConfigured,
    errors: steps.errors,
    toasts: steps.toasts,
    fileChecks: steps.fileChecks,
    out: OUT,
  };
};
