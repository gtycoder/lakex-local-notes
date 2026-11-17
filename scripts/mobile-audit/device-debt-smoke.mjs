// 设备欠账「模拟器可验部分」逐项冒烟（261117 device-qa / task-6③）。
//
// 覆盖三项（真机专属项不在这里，见 design-plans/device-debt-261117.md §3）：
//   A. 更新中心「下载校验流程中可自动部分」：清单获取（原生 check）+ sha256 校验通道（原生 verify 正/反例）；
//      系统安装器 / release 端到端 = 真机欠账，不在这跑；
//   B. 键盘冒烟：写作卡聚焦弹键盘（判据 = innerHeight 收缩 > 200px，AGENTS §7#17）+ 输入落字 + 取消不残留；
//   C. 便携包导出：设置→关于→「导出便携包到文件」+ 产物落到系统「下载」目录核对（导入是整库覆盖，
//      5554 有用户数据 ⇒ 不跑；包自检随导出链路一起验）。
//
// 用法：node scripts/css-audit/drive.mjs 9335 scripts/mobile-audit/device-debt-smoke.mjs [tag]
// 证据：.css-audit/device-debt-<tag>/NN-*.png + steps.json
import fs from "node:fs";
import { execSync } from "node:child_process";
import { data } from "../css-audit/paths.mjs";
import { settle, reload } from "./snap-lib.mjs";

const ADB = process.env.ADB || "/opt/homebrew/share/android-commandlinetools/platform-tools/adb";
const PKG = "com.lakexlocalnotes.android";
const APK_HOST = "android/app/build/outputs/apk/debug/app-debug.apk";
// 原生 verify 只认**更新缓存目录**里的包（路径门禁，UpdatePlugin.kt cacheDir/updates）⇒ 放这里才有正/反例可验。
const APK_DEV_PATH = "/data/data/" + PKG + "/cache/updates/debt-smoke.apk";
// 与 src/core/update/updateManifest.ts 的常量同值（只读证据脚本，不 import TS）。
const UPDATE_MANIFEST_URL = "https://github.com/gtycoder/lakex-local-notes/releases/latest/download/latest.json";
const RELEASE_CERT_SHA256 = "A8BA87F7F7A5E06871CBCF4EEF1078A03801E2B5B6DD3C8255516AB5CF212E35";

const adb = (args) => execSync(ADB + " " + args, { encoding: "utf8", timeout: 30000 });
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
  const OUT = data("device-debt-" + tag);
  fs.mkdirSync(OUT, { recursive: true });
  const steps = { tag, out: OUT, update: {}, keyboard: {}, portable: {}, errors: [] };
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

  /** 先滚进视口再点（按钮/行在折叠线以下时 hit() 判不可见）—— A/C 两节共用。 */
  const tapAfterScroll = async (sel, text, waitMs) => {
    const ok = await page.evaluate(`(function(){
      var els = [].slice.call(document.querySelectorAll(${JSON.stringify(sel)}));
      for (var i = 0; i < els.length; i++) {
        if ((els[i].getAttribute("aria-label") || els[i].title || els[i].textContent || "").indexOf(${JSON.stringify(text)}) < 0) continue;
        els[i].scrollIntoView({ block: "center" });
        return true;
      }
      return false;
    })()`);
    if (!ok) return false;
    await page.sleep(400);
    return tapHit(sel, text, waitMs);
  };

  /** 设置行点按：行可能在折叠线以下（「关于」就是最后一行）⇒ 先 scrollIntoView 再命中测试点按。 */
  const tapSettingsRow = async (label) => {
    const r = await page.evaluate(`(function(){
      var rows = [].slice.call(document.querySelectorAll(".mobile-settings-row, .mobile-settings-list button, .mobile-settings-list .mb-list-item"));
      for (var i = 0; i < rows.length; i++) {
        if ((rows[i].textContent || "").indexOf(${JSON.stringify(label)}) < 0) continue;
        rows[i].scrollIntoView({ block: "center" });
        return true;
      }
      return false;
    })()`);
    if (!r) return false;
    await page.sleep(400);
    return tapHit(".mobile-settings-row, .mobile-settings-list button, .mobile-settings-list .mb-list-item", label, 1400);
  };

  // ---------- A. 更新中心 ----------
  try {
    await reload(page, null);
    // 原生清单获取（不点 UI 也能拿原始结果；UI 里再走一遍「检查更新」取证）
    steps.update.manifestCheck = await page.evaluate(`(async () => {
      const U = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Update;
      if (!U) return { ok: false, code: "no-plugin" };
      try { return await U.check({ url: ${JSON.stringify(UPDATE_MANIFEST_URL)} }); }
      catch (e) { return { ok: false, code: "throw", detail: String(e && e.message || e).slice(0, 200) }; }
    })()`);
    // UI：设置 → 更新中心 → 检查更新（tapAfterScroll 定义在本节外层，C 节共用）
    await tapHit(".toolbar__button", "设置", 1300);
    if (await tapSettingsRow("更新中心")) {
      // 按钮文案是「立即检查」（「检查更新」是区块名）—— 点错等于没检查（261117 实测）。
      if (!(await tapAfterScroll("button", "立即检查", 3500))) steps.errors.push("update-ui: 没有「立即检查」按钮");
      // 检查是异步的：轮询状态行直到脱离「尚未检查/正在检查」
      for (let i = 0; i < 10; i++) {
        const text = await page.evaluate("document.body.innerText.slice(0, 900)");
        steps.update.uiStatus = text;
        if (text.indexOf("正在检查") < 0 && text.indexOf("尚未检查") < 0) break;
        await page.sleep(1000);
      }
      steps.update.screen = shot("update-center");
    } else {
      steps.errors.push("update-ui: 设置里找不到「更新中心」");
    }
    // sha256 / 证书校验通道（原生 verify：正例 = 真 APK + 真 sha256；反例 = sha256 不符）。
    // 系统安装器不点（真机欠账）；这里只证明「下载完的校验」在设备上真的工作。
    try {
      const sha = execSync("shasum -a 256 " + JSON.stringify(APK_HOST), { encoding: "utf8" }).split(/\s+/)[0].trim();
      adb("push " + JSON.stringify(APK_HOST) + " /data/local/tmp/debt-smoke.apk");
      // 引号同 fileExists 的坑：整体双引号包住，内层单引号才能活到设备 shell。
      adb("shell \"run-as " + PKG + " sh -c 'mkdir -p cache/updates && cp /data/local/tmp/debt-smoke.apk cache/updates/debt-smoke.apk'\"");
      steps.update.verifyPositive = await page.evaluate(`(async () => {
        const U = window.Capacitor.Plugins.Update;
        try { return await U.verify({ path: ${JSON.stringify(APK_DEV_PATH)}, sha256: ${JSON.stringify(sha)}, certSha256: ${JSON.stringify(RELEASE_CERT_SHA256)} }); }
        catch (e) { return { ok: false, code: "throw", detail: String(e && e.message || e).slice(0, 200) }; }
      })()`);
      steps.update.verifyNegative = await page.evaluate(`(async () => {
        const U = window.Capacitor.Plugins.Update;
        try { return await U.verify({ path: ${JSON.stringify(APK_DEV_PATH)}, sha256: "0".repeat(64), certSha256: ${JSON.stringify(RELEASE_CERT_SHA256)} }); }
        catch (e) { return { ok: false, code: "throw", detail: String(e && e.message || e).slice(0, 200) }; }
      })()`);
      adb("shell run-as " + PKG + " rm cache/updates/debt-smoke.apk");
      adb("shell rm /data/local/tmp/debt-smoke.apk");
    } catch (e) {
      steps.errors.push("update-verify: " + String(e.message).slice(0, 200));
    }
  } catch (e) {
    steps.errors.push("update: " + String(e.message).slice(0, 200));
  }

  // ---------- B. 键盘冒烟（写作卡：聚焦弹键盘 + 输入落字 + 取消不残留） ----------
  try {
    await reload(page, null);
    // ⚠️ 键盘判据必须**无键盘态取样**（AGENTS §7#17）：写作卡打开时键盘可能已自动弹起 ⇒ before 在首页取。
    const before = await page.evaluate("innerHeight");
    await tapHit(".mb-home-dock__item", "小记", 1400);
    await tapHit(".mb-home-fab", "新建", 1200);
    await tapHit(".mb-create__tile", "空白小记", 2600);
    await page.evaluate("!!document.querySelector('.mobile-qn-composer')");
    // 点正文（真实点按才会带手势语义聚焦）
    await tapHit(".mobile-qn-composer .ne-engine, .mobile-qn-composer [contenteditable]", null, 1500);
    const after = await page.evaluate("innerHeight");
    steps.keyboard.innerHeightBefore = before;
    steps.keyboard.innerHeightAfter = after;
    steps.keyboard.keyboardUp = before - after > 200;
    // 输入落字（CDP insertText = 等价键入）
    await page.send("Input.insertText", { text: "键盘冒烟-261117" });
    await page.sleep(800);
    steps.keyboard.typedInBody = await page.evaluate("(function(){var e=document.querySelector('.mobile-qn-composer .ne-engine, .mobile-qn-composer [contenteditable]');return e ? (e.textContent||'').indexOf('键盘冒烟-261117')>=0 : false;})()");
    steps.keyboard.screen = shot("keyboard-composer");
    // 取消 = 不留小记（弹二次确认则确认）
    if (await tapHit(".mobile-qn-actions button", "取消", 1000)) {
      await tapHit(".mb-actionsheet__item", "放弃", 1200).catch(() => {});
      await tapHit(".mb-actionsheet__item", "确定", 1200).catch(() => {});
    }
    steps.keyboard.composerClosed = await page.evaluate("!document.querySelector('.mobile-qn-composer')");
  } catch (e) {
    steps.errors.push("keyboard: " + String(e.message).slice(0, 200));
  }

  // ---------- C. 便携包导出（设置 → 关于 → 导出便携包到文件） ----------
  try {
    await reload(page, null);
    await tapHit(".toolbar__button", "设置", 1300);
    if (!(await tapSettingsRow("关于"))) {
      throw new Error("设置里找不到「关于」");
    }
    if (!(await tapAfterScroll("button", "导出便携包到文件", 1500))) throw new Error("关于页没有「导出便携包到文件」");
    // 导出是异步（关库→打包→自检→落下载）；轮询结果文案
    let outcome = null;
    for (let i = 0; i < 30 && !outcome; i++) {
      await page.sleep(1000);
      outcome = await page.evaluate(`(function(){
        var els = [].slice.call(document.querySelectorAll(".mb-set-item__desc, .mb-form__desc, [role=status], [role=alert]"));
        for (var i = 0; i < els.length; i++) {
          var t = (els[i].textContent || "").trim();
          if (t.indexOf("导出成功") >= 0 || t.indexOf("导出失败") >= 0 || t.indexOf("自检") >= 0 || t.indexOf("已保存") >= 0) return t;
        }
        return null;
      })()`);
    }
    steps.portable.outcomeText = outcome;
    steps.portable.screen = shot("portable-export");
    let downloads = "";
    try { downloads = adb("shell ls /sdcard/Download/ | grep -i lakex || true"); } catch (e) { /* 命名可能不同 */ }
    steps.portable.downloadsListing = downloads.trim();
  } catch (e) {
    steps.errors.push("portable: " + String(e.message).slice(0, 200));
  }

  fs.writeFileSync(OUT + "/steps.json", JSON.stringify(steps, null, 1));
  console.log("[device-debt] errors=" + JSON.stringify(steps.errors));
  console.log("[device-debt] 证据目录 " + OUT);
  return {
    tag,
    update: steps.update,
    keyboard: steps.keyboard,
    portable: steps.portable,
    errors: steps.errors,
    out: OUT,
  };
};
