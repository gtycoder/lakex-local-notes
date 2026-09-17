import { shell } from "electron";
import { WEB_API_PORT, type WebServerController } from "../webApiServer.js";
import type { IpcRegistrar } from "./registrar.js";

/**
 * 浏览器端（桌面附属窗口）开关。**不落盘、不参与同步**：状态只活在本次进程内，
 * 每次启动都从"关闭"开始；设置里打开/关闭即时起停服务（无需重启应用）。
 * 不做局域网伺服（见设置页说明）。
 */
export function registerWebIpc(ipc: IpcRegistrar, controller: () => WebServerController | null): void {
  const fallback = () => ({ enabled: false, port: WEB_API_PORT, url: `http://127.0.0.1:${WEB_API_PORT}/` });
  ipc.handle("get_web_status", () => controller()?.getStatus() ?? fallback());
  ipc.handle("set_web_enabled", (enabled: unknown) => controller()?.setEnabled(enabled === true) ?? fallback());
  // 用系统默认浏览器打开当前地址。URL 由主进程按固定端口构造，**不接受渲染层传 URL**（避免开放重定向）。
  ipc.handle("open_web_client", async () => {
    const st = controller()?.getStatus();
    if (!st?.enabled) return { ok: false, reason: "浏览器端未开启" };
    try {
      await shell.openExternal(st.url);
      return { ok: true };
    } catch (e) {
      return { ok: false, reason: e instanceof Error ? e.message : "打开失败" };
    }
  });
}
