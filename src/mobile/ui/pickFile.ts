/**
 * 一次性「取一个本地文件」（首页新建面板的**拍摄 / 图片**用）。
 *
 * 与 `editor/EditorDockHost` 那份的分工：dock 复用同一个常驻 input，把文件**插进已经打开的编辑器**；
 * 这里只负责"取到 File"，交给 composer 的 initialInsert 走**同一个内核 insertFiles 通道**插入
 * （插入通道只有一条，见 EditorDockHost 头注释）。
 *
 * 取消也必须 resolve(null)：安卓返回键直接退出选择器时不会有 change 事件，
 * 靠 Chromium 的 `cancel` 事件 + focus 兜底，否则调用方的 await 永不落地。
 */
export function pickLocalFile(accept: string, capture?: "environment"): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    if (capture) input.setAttribute("capture", capture);
    input.style.display = "none";

    let done = false;
    const onFocus = (): void => {
      // 回到前台后给 change 一点时间；仍没有文件 = 用户取消了
      window.setTimeout(() => finish(input.files?.[0] ?? null), 300);
    };
    const finish = (file: File | null): void => {
      if (done) return;
      done = true;
      window.removeEventListener("focus", onFocus);
      input.remove();
      resolve(file);
    };

    input.addEventListener("change", () => finish(input.files?.[0] ?? null));
    input.addEventListener("cancel", () => finish(null));
    window.addEventListener("focus", onFocus, { once: true });
    document.body.appendChild(input);
    input.click();
  });
}
