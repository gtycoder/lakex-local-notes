/**
 * DT-07：Lake 内核性能监控订阅（docInitPerf，code 55）——从 createLakeDocument 抽出。
 *
 * 原先这段是「只订阅、从不退订」：编辑器销毁后 monitorLog 监听仍挂在实例上，
 * 靠实例本身被回收才消失。独立成模块后返回 dispose（内核实例有 off 就摘监听），
 * 由 createLakeDocument 汇总进 __disposeExtras；解析/记录口径与原先逐字一致。
 *
 * 依赖方向：只依赖 LakeEditorInstance 的**类型**（import type，运行时擦除），
 * 记录动作由调用方回调注入，避免 lakeRuntime ↔ 本模块的循环依赖。
 */
import type { LakeEditorInstance } from "./lakeRuntime";

/** 与 `window.__lakePerfReport` 展示的字段一致。 */
export type LakeDocInitPerf = {
  parseTime: number;
  renderTime: number;
  nodeLength: unknown;
  total: number;
};

type MonitorLogPayload = { data?: { m1?: unknown; m2?: unknown; m4?: unknown } };

/** 订阅 monitorLog；返回退订函数（内核无 off 时为空操作）。 */
export function subscribeDocInitPerf(
  editor: LakeEditorInstance,
  onPerf: (perf: LakeDocInitPerf) => void
): () => void {
  const handler = (payload: MonitorLogPayload): void => {
    const d = payload?.data;
    if (d && typeof d.m1 === "number" && typeof d.m2 === "number") {
      onPerf({
        parseTime: d.m1,
        renderTime: d.m2,
        nodeLength: d.m4,
        total: (d.m1 || 0) + (d.m2 || 0),
      });
    }
  };
  // 内核 on/off 的声明签名不带 payload（闭源实例实际会传）；这里做一次 unknown 中转的窄化。
  const emitter = editor as unknown as {
    on?: (event: string, listener: (payload: MonitorLogPayload) => void) => void;
    off?: (event: string, listener: (payload: MonitorLogPayload) => void) => void;
  };
  try {
    emitter.on?.("monitorLog", handler);
  } catch { /* 非编辑器环境忽略 */ }
  return () => {
    try { emitter.off?.("monitorLog", handler); } catch { /* 忽略 */ }
  };
}
