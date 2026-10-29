// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { S3Settings } from "../../lib/types";

const mocks = vi.hoisted(() => ({
  getS3Settings: vi.fn(),
  saveS3Settings: vi.fn(),
  testS3Connection: vi.fn(),
  pickLocalFile: vi.fn(),
  encode: vi.fn(),
  decode: vi.fn(),
  decodeCode: vi.fn(),
  showToast: vi.fn(),
}));

vi.mock("../bridge", () => ({
  bridge: {
    getS3Settings: mocks.getS3Settings,
    saveS3Settings: mocks.saveS3Settings,
    testS3Connection: mocks.testS3Connection,
  },
}));
vi.mock("../ui/pickFile", () => ({ pickLocalFile: mocks.pickLocalFile }));
vi.mock("../../core/s3ConfigTransfer", () => ({
  encodeS3ConfigTransfer: mocks.encode,
  decodeS3ConfigTransferFile: mocks.decode,
  decodeS3ConfigTransfer: mocks.decodeCode,
}));
vi.mock("../ui/toastBus", () => ({ showToast: mocks.showToast }));
vi.mock("../../lib/nativeErrors", () => ({
  getNativeErrorMessage: (error: unknown) => (error as Error).message,
  reportNativeActionError: vi.fn(),
}));

import { S3_SECRET_MASK, useS3SettingsForm } from "./useS3SettingsForm";

const saved: S3Settings = {
  endpoint: "https://saved.example.com",
  region: "cn-saved-1",
  bucket: "saved-bucket",
  prefix: "saved-prefix",
  accessKeyId: "saved-ak",
  secretAccessKey: "saved-sk",
  forcePathStyle: false,
};

type Form = ReturnType<typeof useS3SettingsForm>;
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let form: Form;

function Harness({ open }: { open: boolean }) {
  form = useS3SettingsForm(open);
  return null;
}

const render = async (open = true) => {
  await act(async () => { root.render(createElement(Harness, { open })); });
};

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
  mocks.getS3Settings.mockResolvedValue(saved);
  mocks.saveS3Settings.mockResolvedValue(undefined);
  mocks.testS3Connection.mockResolvedValue("OK");
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

describe("useS3SettingsForm", () => {
  it("打开设置时回填配置，但 Secret 只显示掩码", async () => {
    await render();
    expect(form.settings).toEqual(saved);
    expect(form.form).toMatchObject({
      endpoint: saved.endpoint,
      region: saved.region,
      bucket: saved.bucket,
      prefix: saved.prefix,
      accessKeyId: saved.accessKeyId,
      secretAccessKey: S3_SECRET_MASK,
    });
  });

  it("Secret 未修改时保留旧值，修改后按新值保存", async () => {
    await render();
    await act(async () => { await form.save(); });
    expect(mocks.saveS3Settings).toHaveBeenLastCalledWith(expect.objectContaining({ secretAccessKey: "saved-sk" }));

    act(() => form.updateForm({ secretAccessKey: "new-sk" }));
    await act(async () => { await form.save(); });
    expect(mocks.saveS3Settings).toHaveBeenLastCalledWith(expect.objectContaining({ secretAccessKey: "new-sk", forcePathStyle: false }));
  });

  it("保存后回填桥返回的规范化 Endpoint/Region，并沿用保存成功状态", async () => {
    await render();
    mocks.getS3Settings.mockReset()
      .mockResolvedValueOnce(saved)
      .mockResolvedValueOnce({ ...saved, endpoint: "https://normalized.example.com", region: "cn-normalized-1" });
    await act(async () => { expect(await form.save()).toBe(true); });
    expect(form.form.endpoint).toBe("https://normalized.example.com");
    expect(form.form.region).toBe("cn-normalized-1");
    expect(form.testText).toBe("已保存");
  });

  it("从文件导入后强制虚拟托管，并用保存后的配置回填全部字段", async () => {
    await render();
    mocks.pickLocalFile.mockResolvedValue({
      size: 128,
      text: async () => "{}",
    });
    mocks.decode.mockResolvedValue({ ...saved, endpoint: "https://imported.example.com", forcePathStyle: true });
    const importedSaved = { ...saved, endpoint: "https://imported.example.com", forcePathStyle: false };
    mocks.getS3Settings.mockReset().mockResolvedValue(importedSaved);

    await act(async () => { await form.importFromFile(); });
    expect(mocks.saveS3Settings).toHaveBeenCalledWith(expect.objectContaining({
      endpoint: "https://imported.example.com",
      forcePathStyle: false,
    }));
    expect(form.form.endpoint).toBe("https://imported.example.com");
    expect(form.form.secretAccessKey).toBe(S3_SECRET_MASK);
    expect(mocks.showToast).toHaveBeenCalledWith("S3 配置已导入");
  });

  it("粘贴迁移码导入后强制虚拟托管，并用保存后的配置回填全部字段", async () => {
    await render();
    mocks.decodeCode.mockResolvedValue({ ...saved, endpoint: "https://pasted.example.com", forcePathStyle: true });
    const importedSaved = { ...saved, endpoint: "https://pasted.example.com", forcePathStyle: false };
    mocks.getS3Settings.mockReset().mockResolvedValue(importedSaved);

    await act(async () => { await form.importFromCode("  LLN1.pasted  "); });
    expect(mocks.decodeCode).toHaveBeenCalledWith("LLN1.pasted");
    expect(mocks.saveS3Settings).toHaveBeenCalledWith(expect.objectContaining({
      endpoint: "https://pasted.example.com",
      forcePathStyle: false,
    }));
    expect(form.form.endpoint).toBe("https://pasted.example.com");
    expect(form.form.secretAccessKey).toBe(S3_SECRET_MASK);
    expect(form.testText).toContain("S3 配置已从迁移码导入");
    expect(mocks.showToast).toHaveBeenCalledWith("S3 配置已导入");
  });

  it("迁移码无效时不保存，错误原样抛给调用方展示", async () => {
    await render();
    mocks.decodeCode.mockRejectedValue(new Error("不是 LakexLocalNotes 的 S3 迁移码（应以 LLN1. 开头）"));
    await act(async () => {
      await expect(form.importFromCode("not-a-code")).rejects.toThrow("不是 LakexLocalNotes 的 S3 迁移码");
    });
    expect(mocks.saveS3Settings).not.toHaveBeenCalled();
  });
});
