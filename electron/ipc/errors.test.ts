import { describe, expect, it } from "vitest";
import { IpcInputError } from "../ipcLimits";
import { AppError } from "../../src/core/storeErrors.js";
import { encodeIpcError, parseIpcError, toIpcErrorPayload } from "./errors";

describe("IPC error payloads", () => {
  it("preserves domain error codes", () => {
    expect(toIpcErrorPayload(new AppError("NotFound", "文档不存在"))).toEqual({
      name: "AppError", message: "文档不存在", code: "NOT_FOUND",
    });
    expect(toIpcErrorPayload(new IpcInputError("参数无效"))).toEqual({
      name: "IpcInputError", message: "参数无效", code: "INVALID_INPUT",
    });
    expect(toIpcErrorPayload(new AppError("NotConfigured", "尚未配置云同步"))).toEqual({
      name: "AppError", message: "尚未配置云同步", code: "NOT_CONFIGURED",
    });
  });

  it("normalizes unknown errors to INTERNAL without leaking extra fields", () => {
    expect(toIpcErrorPayload(new Error("网络失败"))).toEqual({
      name: "Error", message: "网络失败", code: "INTERNAL",
    });
    expect(toIpcErrorPayload({ message: "坏请求", code: "INVALID_INPUT", secret: "do not serialize" })).toEqual({
      name: "IpcError", message: "坏请求", code: "INVALID_INPUT",
    });
  });

  it("encodes the envelope in an Error for Electron invoke serialization", () => {
    const encoded = encodeIpcError(new AppError("NotConfigured", "尚未配置云同步"));
    expect(parseIpcError(encoded.message)).toMatchObject({ code: "NOT_CONFIGURED", message: "尚未配置云同步" });
    expect(parseIpcError("Error invoking remote method 'read_note': [LAKE_IPC_CODE:NOT_FOUND] 笔记不存在")).toMatchObject({ code: "NOT_FOUND", message: "笔记不存在" });
  });
});
