// 移动端走查壳：一个 390x844 的 BrowserWindow，加载 mobile 预览（dist-mobile）。
// 为什么要壳：移动端 bundle 需要真实 Chromium 视口 + CDP 才能做计算值快照；桌面应用窗口尺寸/UA 都不对。
// 注意：这里没有 Capacitor 原生桥（无 native SQLite/AssetServer）⇒ 只用于**样式/布局**走查与 0 差异门禁，
// 不用于验证原生行为（那要走模拟器 scripts/emu-up.sh + android-build.sh）。
const { app, BrowserWindow } = require("electron");

const URL = process.env.LAKE_MOBILE_URL || "http://127.0.0.1:1422/index.html";
const W = Number(process.env.LAKE_MOBILE_W || "390");
const H = Number(process.env.LAKE_MOBILE_H || "844");

app.commandLine.appendSwitch("disable-gpu");
app.whenReady().then(() => {
  const win = new BrowserWindow({
    width: W,
    height: H,
    show: true,
    backgroundColor: "#ffffff",
    webPreferences: { contextIsolation: true, sandbox: false },
  });
  win.loadURL(URL);
});
app.on("window-all-closed", () => app.quit());
