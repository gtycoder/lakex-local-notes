import { ipcMain, type IpcMainInvokeEvent } from "electron";
import { encodeIpcError } from "./errors.js";

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

export function createIpcRegistrar(validateSender: (event: IpcMainInvokeEvent) => void, afterInvoke?: (channel: string) => void): IpcRegistrar {
  const registry = new Map<string, (args: unknown[]) => Promise<unknown>>();
  const handleEvent = <Args extends IpcArgs>(channel: string, handler: IpcEventHandler<Args>) => {
    registry.set(channel, async (args: unknown[]) => {
      const result = await handler(HTTP_STUB_EVENT, ...(args as Args));
      afterInvoke?.(channel);
      return result;
    });
    ipcMain.handle(channel, async (event, ...args) => {
      try {
        validateSender(event);
        const result = await handler(event, ...(args as Args));
        afterInvoke?.(channel);
        return result;
      } catch (error) {
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
