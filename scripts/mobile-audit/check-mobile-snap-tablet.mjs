// 平板（pad）整页快照门禁：与手机 6 态同一套「取快照/去抖/比对」逻辑，差异只在：
//   ① 视口钉到 1280x800（CDP setDeviceMetricsOverride）⇒ 与 lake_tab 的状态栏/导航栏实际高度解耦；
//   ② 基线独立（baseline/mobile-snap-tablet.json），手机基线不动；
//   ③ home-doc 走平板路径（先点顶栏「文档树」打开悬浮左栏再点行；无底部胶囊）。
//
// 前置（专用实例，不要拿日常机）：
//   bash scripts/emu-up.sh 后用 lake_tab（pixel_tablet）启动；或直接：
//   ANDROID_SERIAL=emulator-5580 bash scripts/android-build.sh --sync --install
//   bash scripts/emu-cdp.sh 9340
//   adb shell pm clear com.lakexlocalnotes.android && start && 灌夹具（gate-fixture.mjs）
// 用法：
//   node scripts/mobile-audit/check-mobile-snap-tablet.mjs --port 9340 --write-baseline
//   node scripts/mobile-audit/check-mobile-snap-tablet.mjs --port 9340
import { runSnapGate } from "./snap-gate.mjs";

await runSnapGate({
  snapScript: "mobile-snap.mjs",
  baselineName: "mobile-snap-tablet.json",
  portDefault: 9340,
  tagDefault: "mob-tablet-after",
  label: "mgate-tablet",
  passStates: true,
  unstable: [],
});
