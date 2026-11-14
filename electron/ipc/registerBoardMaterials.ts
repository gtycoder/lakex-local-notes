/**
 * 桌面 IPC：画板自定义素材文件夹（261114 用户点单）。
 *
 * 通道 `board_materials`（单入口 + op）：list / save / delete / open。
 * 文件 I/O 在 `electron/boardMaterials.ts`；这里只做请求校验 + shell 打开文件夹。
 * 素材是**设备本地**数据（不进 S3）；渲染层拿到的是条目数组，不接触真实路径（除返回 dir 用于展示）。
 */
import fs from "node:fs";
import { shell } from "electron";
import type { IpcRegistrar } from "./registrar.js";
import type { Store } from "../store.js";
import { IpcInputError } from "../../src/core/ipcLimits.js";
import { boardMaterialsDir, deleteBoardMaterial, listBoardMaterials, saveBoardMaterial } from "../boardMaterials.js";
import type { BoardMaterialsRequest } from "../../src/core/boardMaterialFile.js";

export interface BoardMaterialsIpcDeps {
  store: Store;
}

function asRequest(raw: unknown): BoardMaterialsRequest {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new IpcInputError("素材请求无效");
  const record = raw as Record<string, unknown>;
  const op = record.op;
  if (op === "list" || op === "open") return { op };
  if (op === "delete") {
    if (typeof record.file !== "string" || !record.file) throw new IpcInputError("素材文件名无效");
    return { op, file: record.file };
  }
  if (op === "save") {
    if (typeof record.name !== "string") throw new IpcInputError("素材名称无效");
    if (!Array.isArray(record.elements)) throw new IpcInputError("素材内容无效");
    const width = record.width;
    const height = record.height;
    const widthValue = typeof width === "number" && Number.isFinite(width) && width > 0 ? width : undefined;
    const heightValue = typeof height === "number" && Number.isFinite(height) && height > 0 ? height : undefined;
    return { op, name: record.name, elements: record.elements, ...(widthValue ? { width: widthValue } : {}), ...(heightValue ? { height: heightValue } : {}) };
  }
  throw new IpcInputError("未知的素材操作");
}

export function registerBoardMaterialsIpc(ipc: IpcRegistrar, deps: BoardMaterialsIpcDeps): void {
  ipc.handle("board_materials", async (raw: unknown) => {
    const request = asRequest(raw);
    const root = deps.store.rootPath;
    switch (request.op) {
      case "list":
        return await listBoardMaterials(root);
      case "save":
        return await saveBoardMaterial(root, { name: request.name, elements: request.elements, ...(request.width !== undefined ? { width: request.width } : {}), ...(request.height !== undefined ? { height: request.height } : {}) });
      case "delete":
        return await deleteBoardMaterial(root, request.file);
      case "open": {
        const dir = boardMaterialsDir(root);
        fs.mkdirSync(dir, { recursive: true });
        const error = await shell.openPath(dir);
        if (error) throw new Error("打开素材文件夹失败：" + error);
        return { dir };
      }
    }
  });
}
