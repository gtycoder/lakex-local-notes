import path from "node:path";
import { BrowserWindow } from "electron";
import { withTimeout } from "../src/core/asyncTimeout.js";

/**
 * 隐藏窗口把自包含 HTML 渲染为 PDF（思源同款 printToPDF 路线，零额外依赖）。
 * 输入是 exportPdfHtml 准备好的临时文件（图片已 data URI 内嵌，无网络依赖）。
 * 窗口不加载应用 preload，仅渲染导出内容；整条渲染链有超时，且任何退出路径都会销毁窗口。
 */
export async function renderPdfToBuffer(htmlPath: string): Promise<Buffer> {
  const win = new BrowserWindow({
    show: false,
    skipTaskbar: true,
    focusable: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  try {
    return await withTimeout((async () => {
      await win.loadFile(path.resolve(htmlPath));
      // 等所有图片完成加载（成功或失败都算；printToPDF 不等待会截断尚未解码的大图）。
      await Promise.race([
        win.webContents.executeJavaScript(
          `Promise.all([...document.images].map((img) => img.complete
            ? Promise.resolve()
            : new Promise((res) => { img.addEventListener("load", res, { once: true }); img.addEventListener("error", res, { once: true }); })))`,
        ),
        new Promise((resolve) => setTimeout(resolve, 30_000)),
      ]);
      return await win.webContents.printToPDF({
        pageSize: "A4",
        printBackground: true,
        margins: { top: 0.6, bottom: 0.65, left: 0.5, right: 0.5 },
        displayHeaderFooter: true,
        headerTemplate: "<div></div>",
        footerTemplate:
          '<div style="width:100%;font-size:9px;text-align:center;color:#8a8f99;"><span class="pageNumber"></span> / <span class="totalPages"></span></div>',
      });
    })(), 60_000, "PDF 导出超时（60 秒）");
  } finally {
    if (!win.isDestroyed()) win.destroy();
  }
}
