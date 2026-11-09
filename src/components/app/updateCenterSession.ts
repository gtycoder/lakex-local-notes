/**
 * 更新中心「打开」状态（261109）：设置页入口与启动自动弹窗共用同一份会话状态。
 *
 * 为什么要一个模块级 store：设置页在「关于」里只放一行入口，真正的弹窗挂在 App 根
 * （全局唯一渲染点，见 UpdateCenter.tsx）；两边不在同一棵子树里，用 props 传会牵动
 * DesktopOverlays 的一长串 props。这里只保留最小状态（开/关 + 订阅），不引入状态库。
 */
import { native } from "../../lib/native";
import type { UpdateState } from "../../core/update/updateTypes";

let open = false;
const listeners = new Set<() => void>();

export function isUpdateCenterOpen(): boolean {
  return open;
}

export function subscribeUpdateCenter(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

function emit(): void {
  for (const listener of listeners) listener();
}

export function openUpdateCenter(): void {
  if (open) return;
  open = true;
  emit();
}

export function closeUpdateCenter(): void {
  if (!open) return;
  open = false;
  emit();
}

/** 每个版本最多自动弹一次（设备本地；与「忽略此版本」同属本机 UI 状态，不进 S3/正文）。 */
const AUTO_SHOWN_KEY = "lakex-local-notes-v3.update-auto-shown";

function readAutoShownVersion(): string {
  try { return window.localStorage.getItem(AUTO_SHOWN_KEY) ?? ""; } catch { return ""; }
}

function markAutoShown(version: string): void {
  try { window.localStorage.setItem(AUTO_SHOWN_KEY, version); } catch { /* 存储不可用时本会话仍会弹一次，可接受 */ }
}

/**
 * 启动自动检查发现新版本 ⇒ 自动弹一次更新中心（spec §2：每版本最多一次；已忽略的不弹）。
 * 返回取消订阅；App 挂载时安装一次。
 */
export function installUpdateCenterAutoOpen(): () => void {
  const maybeOpen = (state: UpdateState): void => {
    // 自动下载默认开 ⇒ 自动检查后状态可能直接是 downloading/downloaded，三种都要弹（每版本一次）。
    if (!state.lastCheckWasAuto || state.ignored || !state.manifest) return;
    if (state.status !== "available" && state.status !== "downloading" && state.status !== "downloaded") return;
    const version = state.manifest.version;
    if (readAutoShownVersion() === version) return;
    markAutoShown(version);
    openUpdateCenter();
  };
  const off = native.onUpdateState(maybeOpen);
  // 渲染层晚于主进程那次自动检查完成（重开窗口/刷新）⇒ 以当前状态补判一次。
  void native.updateGetState().then(maybeOpen).catch(() => undefined);
  return off;
}
