/**
 * 便携包导入进行中标记（**零依赖模块**：sync/导入两侧只共享这一个布尔量）。
 *
 * 为什么单开文件：bridge/sync.ts 是移动端入口模块；若直接 import importPortable 会把
 * 映射/原生封装/测试用 sqlite 依赖拖进入口图。这里只放标记，打包成本为 0。
 */
let running = false;

export function setPortableImportRunning(value: boolean): void {
  running = value;
}

export function isPortableImportInProgress(): boolean {
  return running;
}
