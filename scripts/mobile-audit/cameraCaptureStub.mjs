/**
 * 「拍照」链路 CDP 桩（261118：task-2 拍照改走 native/cameraCapture 后的**新桩点**）。
 *
 * 背景（AGENTS §7#24）：旧桩是 `HTMLInputElement.prototype.click`（拍照/贴图都走隐藏 <input type=file>）。
 * task-2 起「拍照」直调原生 CameraCapture 插件（ACTION_IMAGE_CAPTURE + 落盘回传），不再经过 file input
 * ⇒ 旧桩对「拍照」**完全失效**：点了会真拉起系统相机，walk/门禁步骤卡死或误判。本模块提供新链路的桩点：
 *
 *   **桩点 = `window.Capacitor.nativePromise(pluginName, methodName, options)` 拦截**（Capacitor 代理分发是
 *   call-time 属性查找，native-bridge.js 注入 ⇒ 可整体保存/还原）：
 *     · CameraCapture.takePhoto → 合成照片描述符（cancelled:false + camera/camera_stub_0001.png）；
 *     · Filesystem.readFile    → 合成图片字节（1x1 PNG base64，模块加载时自检 PNG 魔数）；
 *     · Filesystem.deleteFile  → 直接成功；
 *     · 其余插件调用原样透传给原生。
 *   ⇒ **cameraCapture 模块本体（取消语义/字节组装/insertFiles 接线）跑的是真实代码**，桩只替掉相机与落盘字节；
 *   合成 File 之后进真实 insertFiles/资源上传链路 —— 正是门禁要看的那一截。
 *
 * 用法（walk/门禁脚本）：
 *   await installCameraCaptureStub(page);             // 打桩
 *   ...点「拍照」...
 *   const proof = await proveCameraCaptureStub(page); // §7#21 自证：photoHits/readHits 必须 +N
 *   await restoreCameraCaptureStub(page);             // **立即**还原并校验（桩不许跨步骤活着）
 *   ...
 *   await restartApp();                               // 交还用户前必须重启 App（§7#24 红线）
 *
 * §7#21 口径：注入脚本里**不写正则**（引号字符串反斜杠会被 JS 吃掉，见 AGENTS §7#21）；自证用**已知命中的
 * 样本**——canary 走真实 `Capacitor.Plugins.*` 代理链路各调一次，计数不 +1 当场抛错；fixture 字节在模块
 * 加载时自检 PNG 魔数（样本坏了先红，不许静默）。unit 级自证见 cameraCaptureStub.test.ts。
 *
 * §7#24 红线（261104 现场事故：桩残留，用户点「贴图」直接插进测试图）：**打过桩的会话，交还用户前必须
 * `restartApp()`**（force-stop → am start → 重跑 emu-cdp 转发）；restore 的校验只是兜底，不能替代重启。
 */
import { execSync } from "node:child_process";

const ADB = process.env.ADB || "/opt/homebrew/share/android-commandlinetools/platform-tools/adb";

/** 1x1 透明 PNG（最小可用样本；拍照桩回传的合成图）。 */
export const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

/** 合成照片的固定名/路径（与 CameraCaptureRules.relativePath 同格式：camera/<name>）。 */
export const STUB_PHOTO_NAME = "camera_stub_0001.png";
export const STUB_PHOTO_PATH = "camera/" + STUB_PHOTO_NAME;

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function pngBytes(base64) {
  return Buffer.from(base64, "base64");
}

/** 模块加载即自检 fixture：坏样本当场抛（§7#21：探针/样本必须能自证会命中）。 */
export function assertFixture() {
  const bytes = pngBytes(PNG_BASE64);
  for (let i = 0; i < PNG_MAGIC.length; i += 1) {
    if (bytes[i] !== PNG_MAGIC[i]) {
      throw new Error("cameraCaptureStub fixture 不是合法 PNG（魔数不符）——样本坏了，先修再跑");
    }
  }
  return bytes.length;
}
assertFixture();

/**
 * 打桩脚本（纯字符串；自证测试直接求值同一份）。
 * 注入脚本只用字符串比较、不用正则（§7#21）。
 */
export function buildInstallScript() {
  const size = pngBytes(PNG_BASE64).length;
  return "(function () {" +
    " var w = window;" +
    " if (!w.Capacitor || typeof w.Capacitor.nativePromise !== 'function') return { ok: false, reason: 'no-capacitor-bridge' };" +
    " if (w.__lakeCameraStub) return { ok: false, reason: 'already-installed' };" +
    " var orig = w.Capacitor.nativePromise;" +
    " var fixture = " + JSON.stringify(PNG_BASE64) + ";" +
    " var state = { photoHits: 0, readHits: 0, passthrough: 0 };" +
    " w.__lakeCameraStub = { orig: orig, state: state, fixture: fixture };" +
    " w.Capacitor.nativePromise = function (pluginName, methodName, options) {" +
    "   if (pluginName === 'CameraCapture' && methodName === 'takePhoto') {" +
    "     state.photoHits += 1;" +
    "     return Promise.resolve({ cancelled: false, path: " + JSON.stringify(STUB_PHOTO_PATH) + ", name: " + JSON.stringify(STUB_PHOTO_NAME) + ", mimeType: 'image/png', size: " + size + " });" +
    "   }" +
    "   if (pluginName === 'Filesystem' && methodName === 'readFile') {" +
    "     state.readHits += 1;" +
    "     return Promise.resolve({ data: fixture });" +
    "   }" +
    "   if (pluginName === 'Filesystem' && methodName === 'deleteFile') {" +
    "     return Promise.resolve({});" +
    "   }" +
    "   state.passthrough += 1;" +
    "   return orig.call(w.Capacitor, pluginName, methodName, options);" +
    " };" +
    " return { ok: true, photoHits: 0, readHits: 0 };" +
    "})()";
}

/**
 * 自证脚本（§7#21）：走**真实 Capacitor.Plugins 代理分发链路**各打一发 —— 计数不 +1 就 ok:false，
 * 调用方必须当失败处理（桩看不见 = 比报错更危险）。旧 APK 没有 CameraCapture 插件头时会
 * “not implemented” 拒绝 ⇒ canary 报 actionable 的 reason，而不是假装命中。
 */
export function buildCanaryScript() {
  return "(function () {" +
    " var w = window;" +
    " var stub = w.__lakeCameraStub;" +
    " if (!stub) return Promise.resolve({ ok: false, reason: 'stub-not-installed' });" +
    " var beforePhoto = stub.state.photoHits;" +
    " var beforeRead = stub.state.readHits;" +
    " return Promise.resolve()" +
    "   .then(function () { return w.Capacitor.Plugins.CameraCapture.takePhoto(); })" +
    "   .then(function (photo) {" +
    "     return w.Capacitor.Plugins.Filesystem.readFile({ path: " + JSON.stringify(STUB_PHOTO_PATH) + ", directory: 'DATA' }).then(function (read) {" +
    "       var photoHit = stub.state.photoHits === beforePhoto + 1 && photo && photo.cancelled === false && photo.path === " + JSON.stringify(STUB_PHOTO_PATH) + ";" +
    "       var readHit = stub.state.readHits === beforeRead + 1 && read && read.data === stub.fixture;" +
    "       return { ok: Boolean(photoHit && readHit), photoHits: stub.state.photoHits, readHits: stub.state.readHits, photoPath: photo && photo.path };" +
    "     });" +
    "   })" +
    "   .catch(function (e) { return { ok: false, reason: 'canary-rejected: ' + String(e && e.message || e) };" +
    "   });" +
    "})()";
}

/** 还原脚本：原样放回 nativePromise、删掉桩全局，并**校验**真的还原了。 */
export function buildRestoreScript() {
  return "(function () {" +
    " var w = window;" +
    " var stub = w.__lakeCameraStub;" +
    " if (!stub) return { ok: true, stubGone: true, restored: true, wasInstalled: false };" +
    " if (w.Capacitor && stub.orig) w.Capacitor.nativePromise = stub.orig;" +
    " delete w.__lakeCameraStub;" +
    " var stubGone = !w.__lakeCameraStub;" +
    " var restored = Boolean(w.Capacitor) && w.Capacitor.nativePromise === stub.orig;" +
    " return { ok: Boolean(stubGone && restored), stubGone: stubGone, restored: restored, wasInstalled: true, photoHits: stub.state.photoHits, readHits: stub.state.readHits };" +
    "})()";
}

/** 打桩（成功才返回；失败一律抛——桩没打上还想跑拍照步骤 = 必误判）。 */
export async function installCameraCaptureStub(page) {
  const out = await page.evaluate(buildInstallScript());
  if (!out || !out.ok) throw new Error("cameraCaptureStub 安装失败：" + JSON.stringify(out));
  return out;
}

/** §7#21 自证：真实代理链路各命中一次；不命中一律抛。 */
export async function proveCameraCaptureStub(page) {
  const out = await page.evaluate(buildCanaryScript());
  if (!out || !out.ok) throw new Error("cameraCaptureStub 自证失败（桩没命中）：" + JSON.stringify(out));
  return out;
}

/** 立即还原 + 校验（校验不过一律抛，绝不把桩留给下一步/用户）。 */
export async function restoreCameraCaptureStub(page) {
  const out = await page.evaluate(buildRestoreScript());
  if (!out || !out.ok) throw new Error("cameraCaptureStub 还原失败：" + JSON.stringify(out));
  return out;
}

/**
 * §7#24 收尾：打过桩的会话，交还用户前**必须重启 App**（桩不随脚本退出自动还原）。
 * 重启后 CDP socket 失效属预期 —— 重跑 scripts/emu-cdp.sh（或 drive.mjs 自愈）再继续。
 */
export function restartApp() {
  try {
    execSync(ADB + " shell am force-stop com.lakexlocalnotes.android", { stdio: "pipe" });
    execSync(ADB + " shell am start -n com.lakexlocalnotes.android/.MainActivity", { stdio: "pipe" });
    return { ok: true, note: "App 已重启；CDP 转发需重跑 emu-cdp.sh（drive.mjs 会自愈）" };
  } catch (e) {
    return { ok: false, note: "adb 重启失败：" + String(e && e.message || e) };
  }
}
