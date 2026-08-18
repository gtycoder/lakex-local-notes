import { ipcMain, type IpcMainInvokeEvent } from "electron";

export type IpcArgs = unknown[];
export type IpcHandler<Args extends IpcArgs> = (...args: Args) => unknown | Promise<unknown>;
export type IpcEventHandler<Args extends IpcArgs> = (event: IpcMainInvokeEvent, ...args: Args) => unknown | Promise<unknown>;

export interface IpcRegistrar {
  handle<Args extends IpcArgs>(channel: string, handler: IpcHandler<Args>): void;
  handleEvent<Args extends IpcArgs>(channel: string, handler: IpcEventHandler<Args>): void;
}

export function createIpcRegistrar(validateSender: (event: IpcMainInvokeEvent) => void): IpcRegistrar {
  const handleEvent = <Args extends IpcArgs>(channel: string, handler: IpcEventHandler<Args>) => {
    ipcMain.handle(channel, (event, ...args) => {
      validateSender(event);
      return handler(event, ...(args as Args));
    });
  };

  return {
    handle: <Args extends IpcArgs>(channel: string, handler: IpcHandler<Args>) => {
      handleEvent(channel, (_event, ...args) => handler(...(args as Args)));
    },
    handleEvent,
  };
}
