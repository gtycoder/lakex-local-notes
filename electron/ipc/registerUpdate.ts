import { shell } from "electron";
import type { IpcRegistrar } from "./registrar.js";
import { IpcInputError } from "../ipcLimits.js";
import { RELEASE_PAGE_BASE } from "../../src/core/update/updateManifest.js";
import type { UpdateSettingsPatch } from "../../src/core/update/updateTypes.js";
import type { UpdateService } from "../update/updateService.js";

/**
 * 更新中心 IPC（261109；通道登记/三方一致性见 electron/ipc/ipcChannelParity.test.ts）。
 *
 * 只暴露最小集：读状态/检查/下载/打开安装包/打开下载页/读写设置/忽略版本。
 * **打开安装包只接受 service 自己记录的路径**（渲染层不能传任意路径），避免变成任意文件执行入口。
 */
export function registerUpdateIpc(ipc: IpcRegistrar, deps: { service: UpdateService }): void {
  const { service } = deps;

  ipc.handle("update_get_state", () => service.getState());
  ipc.handle("update_check", () => service.check({ manual: true }));
  ipc.handle("update_download", () => service.download());

  ipc.handle("update_open_file", async () => {
    const state = service.getState();
    if (state.status !== "downloaded" || !state.downloadedPath) throw new IpcInputError("安装包尚未下载完成");
    const error = await shell.openPath(state.downloadedPath);
    if (error) throw new Error("打开安装包失败：" + error);
    return { ok: true, path: state.downloadedPath };
  });

  ipc.handle("update_open_release_page", async () => {
    const state = service.getState();
    const url = state.manifest?.releasePageUrl || RELEASE_PAGE_BASE + state.currentVersion;
    if (!url.startsWith("https://")) throw new IpcInputError("更新页地址无效");
    await shell.openExternal(url);
    return { ok: true, url };
  });

  ipc.handle("update_get_settings", () => service.getSettings());
  ipc.handle("update_set_settings", (patch: unknown) => {
    const value = patch && typeof patch === "object" ? patch : {};
    return service.setSettings(value as UpdateSettingsPatch);
  });
  ipc.handle("update_ignore_version", (version: unknown) => {
    if (typeof version !== "string") throw new IpcInputError("版本号无效");
    return service.ignoreVersion(version);
  });
}
