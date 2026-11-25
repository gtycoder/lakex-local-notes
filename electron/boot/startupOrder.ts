/**
 * 启动时序断言（C-04）：4 条不可动时序的机器判据（注释 + 断言，违反即抛）。
 * 顺序错了就是 P1/P2 级事故，不能只存在于评审记忆里：
 * ① registerAppSchemePrivileges 必须在模块顶层（app ready 前，Electron 硬要求）——
 *    断言 = main.ts 调用点检查 app.isReady()；
 * ② applyUserDataPath 必须先于任何 userDataDir()/workspaceRoot() 读取（否则隔离路径不生效）；
 * ③ serveAppDist 必须先于 createWindow（私有协议没起，窗口加载的页面 404）；
 * ④ installNativeSha256 必须先于任何正文/资产 hash 计算（同步/索引/历史全走它）。
 * 用法：动作点 mark*()，依赖点 assert*()；函数名即断言上下文。
 */
let userDataPathApplied = false;
let appDistServed = false;
let nativeSha256Installed = false;

/** ② applyUserDataPath 已执行（userData 路径已固定）。 */
export function markUserDataPathApplied(): void { userDataPathApplied = true; }
export function assertUserDataPathApplied(context: string): void {
  if (!userDataPathApplied) throw new Error(`[startup-order] ${context} 依赖 userData 路径固定：applyUserDataPath() 必须先于任何 userDataDir/workspaceRoot 读取`);
}

/** ③ serveAppDist 已执行（私有协议已能服务 dist）。 */
export function markAppDistServed(): void { appDistServed = true; }
export function assertAppDistServed(context: string): void {
  if (!appDistServed) throw new Error(`[startup-order] ${context} 依赖私有协议就绪：serveAppDist() 必须先于 createWindow()`);
}

/** ④ installNativeSha256 已执行（hash 走 node:crypto 而非纯 JS）。 */
export function markNativeSha256Installed(): void { nativeSha256Installed = true; }
export function assertNativeSha256Installed(context: string): void {
  if (!nativeSha256Installed) throw new Error(`[startup-order] ${context} 计算 hash 前必须先 installNativeSha256()`);
}
