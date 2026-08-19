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
