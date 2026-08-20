import { ipcMain, type IpcMainInvokeEvent } from "electron";
import { toIpcErrorPayload } from "./errors.js";

export type IpcArgs = unknown[];
export type IpcHandler<Args extends IpcArgs> = (...args: Args) => unknown | Promise<unknown>;
export type IpcEventHandler<Args extends IpcArgs> = (event: IpcMainInvokeEvent, ...args: Args) => unknown | Promise<unknown>;

export interface IpcRegistrar {
  handle<Args extends IpcArgs>(channel: string, handler: IpcHandler<Args>): void;
  handleEvent<Args extends IpcArgs>(channel: string, handler: IpcEventHandler<Args>): void;
}

export function createIpcRegistrar(validateSender: (event: IpcMainInvokeEvent) => void): IpcRegistrar {
  const handleEvent = <Args extends IpcArgs>(channel: string, handler: IpcEventHandler<Args>) => {
    ipcMain.handle(channel, async (event, ...args) => {
      try {
        validateSender(event);
        return await handler(event, ...(args as Args));
      } catch (error) {
        // Electron 的 invoke 序列化不会可靠保留 Error 自定义字段；只抛出
        // 明确的可序列化 envelope，让 preload 能稳定恢复 code。
        throw toIpcErrorPayload(error);
      }
    });
  };

  return {
    handle: <Args extends IpcArgs>(channel: string, handler: IpcHandler<Args>) => {
      handleEvent(channel, (_event, ...args) => handler(...(args as Args)));
    },
    handleEvent,
  };
}
