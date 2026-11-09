import { describe, expect, it, vi } from "vitest";
import { startAiWritingTurn, type AiWritingTurnDeps } from "./aiWritingTurn";

function makeDeps(overrides: Partial<AiWritingTurnDeps> = {}): AiWritingTurnDeps & { cancel: ReturnType<typeof vi.fn> } {
  return {
    run: async (_id, _messages, onDelta, onReasoning) => {
      onReasoning?.("先想");
      onDelta?.("答");
      onReasoning?.("再想");
      onDelta?.("案");
      return { ok: true };
    },
    cancel: vi.fn(async () => undefined),
    ...overrides,
  } as AiWritingTurnDeps & { cancel: ReturnType<typeof vi.fn> };
}

const MSGS = [{ role: "user" as const, content: "hi" }];
const NOW = () => 1000;

describe("startAiWritingTurn", () => {
  it("正常结束：正文与思考分别聚合，保留增量顺序", async () => {
    const partials: Array<{ content: string; reasoning: string }> = [];
    const turn = startAiWritingTurn({
      requestId: "r1", messages: MSGS, deps: makeDeps(), now: NOW,
      onPartial: (content, reasoning) => partials.push({ content, reasoning }),
    });
    const result = await turn.result;
    expect(result).toMatchObject({ content: "答案", reasoning: "先想再想", stopped: false, error: null, durationMs: 0 });
    expect(partials.map((p) => p.content)).toEqual(["", "答", "答", "答案"]);
  });

  it("供应商把正文放进最终结果时以结果为准（增量兜底）", async () => {
    const deps = makeDeps({ run: async () => ({ ok: true, text: "最终正文", reasoning: "最终思考" }) });
    const result = await startAiWritingTurn({ requestId: "r1", messages: MSGS, deps, now: NOW }).result;
    expect(result.content).toBe("最终正文");
    expect(result.reasoning).toBe("最终思考");
  });

  it("用户停止：置 stopped、保留已生成片段、只取消一次", async () => {
    const gate: { release: null | (() => void) } = { release: null };
    const cancel = vi.fn(async () => undefined);
    const deps: AiWritingTurnDeps = {
      run: async (_id, _messages, onDelta) => {
        onDelta?.("半截");
        await new Promise<void>((resolve) => { gate.release = resolve; });
        // abort 后部分供应商会**正常结束**流：这里模拟不抛错。
        return { ok: true };
      },
      cancel,
    };
    const turn = startAiWritingTurn({ requestId: "r-stop", messages: MSGS, deps, now: NOW });
    await Promise.resolve();
    turn.stop();
    turn.stop();
    gate.release?.();
    const result = await turn.result;
    expect(result).toMatchObject({ content: "半截", stopped: true, error: null });
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(cancel).toHaveBeenCalledWith("r-stop");
  });

  it("失败：error 落到结果，已生成片段保留", async () => {
    const deps = makeDeps({ run: async (_id, _m, onDelta) => { onDelta?.("片段"); throw new Error("网络不可达"); } });
    const result = await startAiWritingTurn({ requestId: "r1", messages: MSGS, deps, now: NOW }).result;
    expect(result.content).toBe("片段");
    expect(result.error).toBe("网络不可达");
    expect(result.stopped).toBe(false);
  });

  it("非 Error 抛出也给出可读错误", async () => {
    const deps = makeDeps({ run: async () => { throw "boom"; } });
    const result = await startAiWritingTurn({ requestId: "r1", messages: MSGS, deps, now: NOW }).result;
    expect(result.error).toBe("boom");
  });
});
