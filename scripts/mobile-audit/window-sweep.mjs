// 平板/折叠屏「窗口矩阵」验收（261103 L1）：同一份 APK 在不同窗口尺寸下的形态判据 + resize 状态保持。
//
// 为什么需要：折叠屏/分屏/自由窗口会让同一个 App 在 412~1280 的宽度之间来回切换；
// 这里把「哪种窗口判成哪一档」与「切窗口后工作区状态不丢」固化成可复跑装置，
// 避免每次靠人肉拖窗口。
//
// 用法（专用实例，CDP 已转发）：
//   node scripts/css-audit/drive.mjs 9340 scripts/mobile-audit/window-sweep.mjs
// 断言失败 exit 1；成功打印 JSON 摘要。
const LIB = new URL("./snap-lib.mjs", import.meta.url).href; // 261110：原作写死指向 master checkout 的绝对路径，改完后会拿到旧 snap-lib

// 与 src/mobile/pad/formFactor.ts 的 FORM_FACTOR_BREAKPOINTS 同源（改那边必须同步这里）。
const BREAKPOINTS = { medium: 600, expanded: 800, expandedMinHeight: 560 };
const expectFormFactor = (w, h) =>
  w < BREAKPOINTS.medium ? "compact" : w < BREAKPOINTS.expanded || h < BREAKPOINTS.expandedMinHeight ? "medium" : "expanded";

const CASES = [
  { name: "phone-portrait", width: 412, height: 842 },
  { name: "small-tablet", width: 600, height: 800 },
  { name: "folded-square", width: 700, height: 700 },
  { name: "tablet-portrait", width: 800, height: 1280 },
  { name: "tablet-landscape", width: 1280, height: 800 },
  { name: "phone-landscape", width: 915, height: 412 },
  { name: "short-wide", width: 1280, height: 500 },
];

export default async ({ page }) => {
  const { reload, settle, tapSel, tapByLabel, clickText } = await import(LIB);
  const sleep = (ms) => page.sleep(ms);
  const setViewport = async (w, h) => {
    await page.send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 2, mobile: false });
    await sleep(600);
  };
  const ff = () => page.evaluate("document.documentElement.dataset.formFactor");
  const out = { cases: [], failures: [] };

  for (const c of CASES) {
    await setViewport(c.width, c.height);
    await reload(page, "shelf");
    const got = await ff();
    const want = expectFormFactor(c.width, c.height);
    // 261103：判据只剩 html[data-form-factor]（body.lake-tablet 已随死代码清理删除）。
    const row = { name: c.name, size: c.width + "x" + c.height, want, got, pass: got === want };
    if (!row.pass) out.failures.push(row);
    out.cases.push(row);
  }

  // resize 状态保持：从 800×1280（expanded）切到 1280×800（expanded）再切回 915×412（medium），
  // 工作区活动页/标签数/滚动位置不得被重置。
  await setViewport(800, 1280);
  await reload(page, "shelf");
  await clickText(page, ".mb-home-dock__item", "知识库");
  await sleep(600);
  if (!(await page.evaluate("Boolean(document.querySelector('.mobile-workspace'))"))) await tapSel(page, ".nb-shelf-card", 2600);
  await settle(page);
  await tapByLabel(page, ".mobile-bottom-bar__item", "文档树", 900);
  if (await page.evaluate("!!document.querySelector('.pad-tree')")) await tapSel(page, ".pad-tree .mb-row", 2400);
  else await tapSel(page, ".side-panel--left.on .mb-row", 2400);
  await settle(page);
  const snapshot = () => page.evaluate(`(function(){
    var panes=[].slice.call(document.querySelectorAll('.doc-pane.active .mobile-doc-body'));
    var body=panes[0]||null;
    if (body) body.scrollTop = Math.max(0, Math.min(body.scrollHeight - body.clientHeight, 40));
    return {
      active: (document.querySelector('.doc-pane.active .editor-host')||{}).id || document.querySelector('.doc-pane.active .ne-viewer, .doc-pane.active .ne-engine') ? true : false,
      tabs: document.querySelectorAll('.pad-tab').length || document.querySelectorAll('.doc-pane').length,
      scrollTop: body ? body.scrollTop : null,
      ff: document.documentElement.dataset.formFactor
    };
  })()`);
  const before = await snapshot();
  await setViewport(1280, 800);
  await sleep(800);
  const afterExpand = await snapshot();
  await setViewport(915, 412);
  await sleep(800);
  const afterShrink = await snapshot();
  const keep = (a, b) => a.tabs === b.tabs && Boolean(a.active) === Boolean(b.active);
  const retention = { before, afterExpand, afterShrink, tabsKept: keep(before, afterExpand) && keep(before, afterShrink), scrollKept: before.scrollTop === afterExpand.scrollTop && before.scrollTop === afterShrink.scrollTop };
  if (!retention.tabsKept) out.failures.push({ name: "resize-retention-tabs", retention });
  if (before.scrollTop !== null && !retention.scrollKept) out.failures.push({ name: "resize-retention-scroll", retention });
  out.retention = retention;

  await page.send("Emulation.clearDeviceMetricsOverride").catch(() => {});
  out.pass = out.failures.length === 0;
  if (!out.pass) throw new Error("窗口矩阵验收失败：" + JSON.stringify(out.failures));
  return out;
};
