// @vitest-environment jsdom
/** AI 单会话（261107 P2）：打开新会话先清理旧会话；dismiss 幂等且不误关新会话。 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { closeAiAssistant, getAiAssistantSession, openAiAssistant } from "./aiAssistantSession";
import type { AiAssistantRequest } from "./aiAssistantRequest";

const request = (): AiAssistantRequest => ({
  context: { kind: "none" },
  placement: { kind: "floating" },
  outputs: [],
  applyOutput: () => false,
});

beforeEach(() => { closeAiAssistant(); });

describe("AI 单会话", () => {
  it("打开新会话会先清理旧会话；当前始终只有一个", () => {
    const firstCleanup = vi.fn();
    const secondCleanup = vi.fn();
    openAiAssistant(request(), firstCleanup);
    expect(getAiAssistantSession()).not.toBeNull();
    const second = openAiAssistant(request(), secondCleanup);
    expect(getAiAssistantSession()).toBe(second);
    expect(firstCleanup).toHaveBeenCalledTimes(1);
    expect(secondCleanup).not.toHaveBeenCalled();
  });

  it("关闭当前会话触发清理；重复 dismiss/关闭旧会话不误重新会话", () => {
    const cleanup = vi.fn();
    const handle = openAiAssistant(request(), cleanup);
    handle.dismiss();
    expect(getAiAssistantSession()).toBeNull();
    expect(cleanup).toHaveBeenCalledTimes(1);
    handle.dismiss();
    expect(cleanup).toHaveBeenCalledTimes(2); // 幂等清理自己的资源即可

    const nextCleanup = vi.fn();
    const next = openAiAssistant(request(), nextCleanup);
    // 旧 handle 再关闭：不能把新会话关掉
    handle.dismiss();
    expect(getAiAssistantSession()).toBe(next);
    expect(nextCleanup).not.toHaveBeenCalled();
    closeAiAssistant();
    expect(getAiAssistantSession()).toBeNull();
    expect(nextCleanup).toHaveBeenCalledTimes(1);
  });
});