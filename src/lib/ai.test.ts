// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  aiChat: vi.fn(),
  onAiStream: vi.fn(() => () => undefined),
}));

vi.mock("./native", () => ({ native: { aiChat: mocks.aiChat, onAiStream: mocks.onAiStream } }));

import { runAiChat } from "./ai";

describe("桌面 AI 总开关：关闭时任何路径不出网", () => {
  beforeEach(() => {
    window.localStorage.clear();
    mocks.aiChat.mockReset().mockResolvedValue({ ok: true, text: "hi" });
    mocks.onAiStream.mockClear();
  });

  it("关闭时直接拒绝，不调用主进程（不产生任何网络请求）", async () => {
    window.localStorage.setItem("lakex-local-notes-v3.ai.enabled", "0");
    await expect(runAiChat("r1", [])).rejects.toThrow("AI 助手已关闭");
    expect(mocks.aiChat).not.toHaveBeenCalled();
  });

  it("开启时正常走主进程", async () => {
    await expect(runAiChat("r2", [])).resolves.toMatchObject({ ok: true });
    expect(mocks.aiChat).toHaveBeenCalledOnce();
  });
});
