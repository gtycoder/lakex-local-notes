import { ipcMain, type IpcMainInvokeEvent } from "electron";
import { encodeIpcError } from "./errors.js";
import { log } from "../logger.js";
import { describeError } from "../../src/core/logFormat.js";

export type IpcArgs = unknown[];
export type IpcHandler<Args extends IpcArgs> = (...args: Args) => unknown | Promise<unknown>;
export type IpcEventHandler<Args extends IpcArgs> = (event: IpcMainInvokeEvent, ...args: Args) => unknown | Promise<unknown>;

export interface IpcRegistrar {
  handle<Args extends IpcArgs>(channel: string, handler: IpcHandler<Args>): void;
  handleEvent<Args extends IpcArgs>(channel: string, handler: IpcEventHandler<Args>): void;
  /**
   * 已注册通道的调用表（Web 客户端复用同一批 handler，见 webApiServer.ts）。
   * 不含 validateSender（鉴权由传输层负责）；handleEvent 型通道注入 stub event
   * （sync_now 只用 event.sender.send 广播进度，HTTP 调用方拿返回值 SyncResult）。
   */
  readonly registry: ReadonlyMap<string, (args: unknown[]) => Promise<unknown>>;
}

/** HTTP 调用方的替代 event：sync_now 的 send 是进度推送，无窗口可推时为 no-op。 */
const HTTP_STUB_EVENT = {
  sender: { send: () => {} },
} as unknown as IpcMainInvokeEvent;

/** 超过这个耗时的通道记 warn（正式环境也留，便于事后定位慢 IPC）。 */
const SLOW_IPC_MS = 200;

/**
 * 每次 IPC 调用的耗时埋点（261023）：
 * - 成功：debug 全量（[perf] ipc.<channel> <ms>ms）；≥SLOW_IPC_MS 升为 warn；
 * - 失败：error（带通道名 + 耗时 + 错误摘要）。
 * 正式环境 file=info ⇒ 逐次调用不落盘，只留慢调用与失败，不会把日志刷爆。
 */
function logIpcCall(channel: string, startedAt: number, error?: unknown): void {
  const ms = Date.now() - startedAt;
  if (error !== undefined) {
    log.ipc.error("[ipc] " + channel + " 失败 " + ms + "ms " + describeError(error));
    return;
  }
  if (ms >= SLOW_IPC_MS) log.ipc.warn("[perf] ipc.slow " + channel + " " + ms + "ms");
  else log.ipc.debug("[perf] ipc." + channel + " " + ms + "ms");
}

export function createIpcRegistrar(validateSender: (event: IpcMainInvokeEvent) => void, afterInvoke?: (channel: string) => void): IpcRegistrar {
  const registry = new Map<string, (args: unknown[]) => Promise<unknown>>();
  const handleEvent = <Args extends IpcArgs>(channel: string, handler: IpcEventHandler<Args>) => {
    registry.set(channel, async (args: unknown[]) => {
      const startedAt = Date.now();
      try {
        const result = await handler(HTTP_STUB_EVENT, ...(args as Args));
        afterInvoke?.(channel);
        logIpcCall(channel, startedAt);
        return result;
      } catch (error) {
        logIpcCall(channel, startedAt, error);
        throw error;
      }
    });
    ipcMain.handle(channel, async (event, ...args) => {
      const startedAt = Date.now();
      try {
        validateSender(event);
        const result = await handler(event, ...(args as Args));
        afterInvoke?.(channel);
        logIpcCall(channel, startedAt);
        return result;
      } catch (error) {
        logIpcCall(channel, startedAt, error);
        // Electron 的 invoke 序列化不会可靠保留 Error 自定义字段；只抛出
        // 明确的可序列化 envelope，让 preload 能稳定恢复 code。
        throw encodeIpcError(error);
      }
    });
  };

  return {
    handle: <Args extends IpcArgs>(channel: string, handler: IpcHandler<Args>) => {
      handleEvent(channel, (_event, ...args) => handler(...(args as Args)));
    },
    handleEvent,
    registry,
  };
}
