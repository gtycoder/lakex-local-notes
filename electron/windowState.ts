import fs from "node:fs";
import path from "node:path";

export interface WindowState {
  x: number;
  y: number;
  width: number;
  height: number;
  maximized: boolean;
  fullscreen: boolean;
}

export interface WorkArea {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const DEFAULT_WINDOW_STATE: WindowState = {
  x: 0,
  y: 0,
  width: 1280,
  height: 820,
  maximized: false,
  fullscreen: false,
};

const MIN_WIDTH = 720;
const MIN_HEIGHT = 480;

function finiteNumber(value: number | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function clampWindowState(input: Partial<WindowState>, workArea: WorkArea): WindowState {
  const rawWidth = input.width;
  const rawHeight = input.height;
  const rawX = input.x;
  const rawY = input.y;
  const width = finiteNumber(rawWidth) && rawWidth > 0 ? Math.min(workArea.width, Math.max(MIN_WIDTH, rawWidth)) : Math.min(workArea.width, DEFAULT_WINDOW_STATE.width);
  const height = finiteNumber(rawHeight) && rawHeight > 0 ? Math.min(workArea.height, Math.max(MIN_HEIGHT, rawHeight)) : Math.min(workArea.height, DEFAULT_WINDOW_STATE.height);
  const x = finiteNumber(rawX) ? Math.min(workArea.x + workArea.width - width, Math.max(workArea.x, rawX)) : workArea.x + Math.round((workArea.width - width) / 2);
  const y = finiteNumber(rawY) ? Math.min(workArea.y + workArea.height - height, Math.max(workArea.y, rawY)) : workArea.y + Math.round((workArea.height - height) / 2);
  return { x, y, width, height, maximized: input.maximized === true, fullscreen: input.fullscreen === true };
}

/**
 * boot 遮罩窗口的几何（261127）：与主窗口**最终形态**对齐，但**绝不走原生窗口状态转换**。
 *
 * macOS 上对 splash（frameless / resizable:false / 几百毫秒后就销毁）调用 `setFullScreen(true)` 或
 * `maximize()` 会启动一次系统全屏过渡；splash 随即被 hide + destroy ⇒ 过渡中断，屏幕上留下**一块纯白
 * backing window**（无标题、无红绿灯；Dock 菜单里多一条窗口条目，Space/Dock 状态一起坏掉，用户只能重启）。
 * 实测复现：window-state.json 带 `fullscreen:true` 时启动，第二个窗口 = 空白过渡窗（详见 bootSplash 头注释）。
 * ⇒ splash 只按静态矩形摆放：最大化/全屏恢复直接铺满工作区，否则沿用上次普通 bounds。
 */
export function bootSplashBounds(state: WindowState, workArea: WorkArea): WorkArea {
  return state.maximized || state.fullscreen
    ? { x: workArea.x, y: workArea.y, width: workArea.width, height: workArea.height }
    : { x: state.x, y: state.y, width: state.width, height: state.height };
}

export function readWindowState(filePath: string): Partial<WindowState> {
  try {
    const value = JSON.parse(fs.readFileSync(filePath, "utf8")) as Partial<WindowState>;
    return value && typeof value === "object" ? value : {};
  } catch {
    return {};
  }
}

export function writeWindowState(filePath: string, state: WindowState): void {
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const tempPath = `${filePath}.tmp`;
    fs.writeFileSync(tempPath, JSON.stringify(state), "utf8");
    fs.renameSync(tempPath, filePath);
  } catch {
    // Window state is best-effort and must never block app shutdown.
  }
}
