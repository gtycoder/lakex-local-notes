/**
 * 长按计时单一来源护栏 + 共享核心单测（D2，261022）。
 *
 * 背景：长按曾有两份计时器 —— 桌面编辑器 features/editor/longPress.ts（450ms/10px，原生 touch，吞 click）
 * 与移动端唯一实现 mobile/ui/useLongPress.ts（350ms/10px，React hook，震动）。AGENTS §3#14 要求
 * 「同一个交互语义只有一套」，§7#20 要求长按过的那一次吞掉随后的 click。
 * 261022 把状态机收拢到 lib/longPressTimer.ts；本文件守住两件事：
 *   ① 行为：共享核心的边界语义（到点/移动取消/清理/重复 start/click 吞）；
 *   ② 结构：两个消费者都引用同一核心、都不再自己持有 setTimeout（静态断言，防止再长回第二份）。
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLongPressTimer } from "./longPressTimer";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, "..");
const read = (rel: string): string => readFileSync(path.join(SRC, rel), "utf8");
const stripComments = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, "");

/** 默认参数 = 移动端 hook 的默认值（350ms / 10px）。 */
function makeTimer(overrides: Partial<Parameters<typeof createLongPressTimer>[0]> = {}) {
  const onFire = vi.fn();
  const feedback = vi.fn();
  const timer = createLongPressTimer({ ms: 350, moveCancelPx: 10, onFire, feedback, ...overrides });
  return { timer, onFire, feedback };
}

describe("长按计时核心（createLongPressTimer）", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("到点只触发一次：坐标取按下点、target 透传、反馈先于回调", () => {
    const { timer, onFire, feedback } = makeTimer();
    const target = new EventTarget();
    timer.start({ clientX: 10, clientY: 20 }, target);
    timer.move({ clientX: 14, clientY: 24 }); // 阈值内：仍算长按
    vi.advanceTimersByTime(349);
    expect(onFire).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onFire).toHaveBeenCalledTimes(1);
    expect(onFire).toHaveBeenCalledWith({ clientX: 10, clientY: 20 }, target);
    expect(feedback).toHaveBeenCalledTimes(1);
    expect(feedback.mock.invocationCallOrder[0]).toBeLessThan(onFire.mock.invocationCallOrder[0]);
    // 到点后再抬手/移动不会重复触发
    timer.end();
    timer.move({ clientX: 999, clientY: 999 });
    vi.advanceTimersByTime(1000);
    expect(onFire).toHaveBeenCalledTimes(1);
  });

  it("未到点不触发；到点前 end()/cancel() 即作废", () => {
    const a = makeTimer();
    a.timer.start({ clientX: 0, clientY: 0 });
    vi.advanceTimersByTime(300);
    a.timer.end();
    vi.advanceTimersByTime(1000);
    expect(a.onFire).not.toHaveBeenCalled();

    const b = makeTimer();
    b.timer.start({ clientX: 0, clientY: 0 });
    b.timer.cancel();
    vi.advanceTimersByTime(1000);
    expect(b.onFire).not.toHaveBeenCalled();
  });

  it("移动超过阈值取消（严格大于；坐标差 = 10px 仍继续）", () => {
    const inside = makeTimer();
    inside.timer.start({ clientX: 20, clientY: 20 });
    inside.timer.move({ clientX: 30, clientY: 30 });
    vi.advanceTimersByTime(350);
    expect(inside.onFire).toHaveBeenCalledTimes(1);

    const overX = makeTimer();
    overX.timer.start({ clientX: 20, clientY: 20 });
    overX.timer.move({ clientX: 31, clientY: 20 });
    vi.advanceTimersByTime(350);
    expect(overX.onFire).not.toHaveBeenCalled();

    const overY = makeTimer();
    overY.timer.start({ clientX: 20, clientY: 20 });
    overY.timer.move({ clientX: 20, clientY: -11 });
    vi.advanceTimersByTime(350);
    expect(overY.onFire).not.toHaveBeenCalled();
  });

  it("moveCancelPx=0（目录行拖拽）：一动就取消", () => {
    const { timer, onFire } = makeTimer({ moveCancelPx: 0 });
    timer.start({ clientX: 5, clientY: 5 });
    timer.move({ clientX: 6, clientY: 5 });
    vi.advanceTimersByTime(1000);
    expect(onFire).not.toHaveBeenCalled();
  });

  it("重复 start：只算最后一轮，且只触发一次", () => {
    const { timer, onFire, feedback } = makeTimer();
    timer.start({ clientX: 1, clientY: 1 });
    vi.advanceTimersByTime(300);
    timer.start({ clientX: 2, clientY: 2 });
    vi.advanceTimersByTime(349);
    expect(onFire).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onFire).toHaveBeenCalledTimes(1);
    expect(onFire).toHaveBeenCalledWith({ clientX: 2, clientY: 2 }, null);
    expect(feedback).toHaveBeenCalledTimes(1);
  });

  it("dispose 解绑：清掉在途计时，之后 start/move 全部失效", () => {
    const { timer, onFire } = makeTimer();
    timer.start({ clientX: 3, clientY: 4 });
    timer.dispose();
    vi.advanceTimersByTime(1000);
    expect(onFire).not.toHaveBeenCalled();
    timer.start({ clientX: 5, clientY: 6 });
    timer.move({ clientX: 6, clientY: 7 });
    vi.advanceTimersByTime(1000);
    expect(onFire).not.toHaveBeenCalled();
  });

  it("click 吞：短按不吞；长按触发后只吞一次；下一次按下重新计时", () => {
    const { timer } = makeTimer();
    // 短按
    timer.start({ clientX: 0, clientY: 0 });
    timer.end();
    vi.advanceTimersByTime(1000);
    expect(timer.consumeClickSuppression()).toBe(false);
    // 长按命中
    timer.start({ clientX: 0, clientY: 0 });
    vi.advanceTimersByTime(350);
    expect(timer.consumeClickSuppression()).toBe(true);
    expect(timer.consumeClickSuppression()).toBe(false); // 只吞一次
    // 下一轮长按重新置位
    timer.start({ clientX: 0, clientY: 0 });
    vi.advanceTimersByTime(350);
    expect(timer.consumeClickSuppression()).toBe(true);
  });

  it("移动取消 / 未到点 / dispose 都不产生 click 吞", () => {
    const canceled = makeTimer();
    canceled.timer.start({ clientX: 0, clientY: 0 });
    canceled.timer.move({ clientX: 50, clientY: 0 });
    vi.advanceTimersByTime(1000);
    expect(canceled.timer.consumeClickSuppression()).toBe(false);

    const pending = makeTimer();
    pending.timer.start({ clientX: 0, clientY: 0 });
    expect(pending.timer.consumeClickSuppression()).toBe(false);
    pending.timer.end();

    const disposed = makeTimer();
    disposed.timer.start({ clientX: 0, clientY: 0 });
    vi.advanceTimersByTime(350);
    disposed.timer.dispose();
    expect(disposed.timer.consumeClickSuppression()).toBe(false);
  });
});

describe("长按单一来源护栏（静态）", () => {
  const desktop = read("features/editor/longPress.ts");
  const mobile = read("mobile/ui/useLongPress.ts");
  const core = read("lib/longPressTimer.ts");

  it("两个消费者都引用同一个共享核心", () => {
    expect(desktop).toMatch(/from "\.\.\/\.\.\/lib\/longPressTimer"/);
    expect(mobile).toMatch(/from "\.\.\/\.\.\/lib\/longPressTimer"/);
  });

  it("消费者不再各自持有计时逻辑（setTimeout/clearTimeout 只在核心）", () => {
    const consumers: Array<[string, string]> = [
      ["features/editor/longPress.ts", desktop],
      ["mobile/ui/useLongPress.ts", mobile],
    ];
    for (const [name, src] of consumers) {
      expect(src, name + " 里又出现了 setTimeout").not.toMatch(/\bsetTimeout\s*\(/);
      expect(src, name + " 里又出现了 clearTimeout").not.toMatch(/\bclearTimeout\s*\(/);
      expect(src, name + " 里又出现了 window 计时器").not.toMatch(/window\.(?:set|clear)Timeout/);
    }
    expect(core).toMatch(/\bglobalThis\.setTimeout\s*\(/);
    expect(core).toMatch(/\bclearTimeout\s*\(/);
  });

  it("阈值/反馈按端参数化（桌面 450/10 不震动，移动端 350/10 震动）", () => {
    expect(desktop).toMatch(/LONG_PRESS_MS = 450/);
    expect(desktop).toMatch(/MOVE_TOLERANCE = 10/);
    expect(desktop).not.toMatch(/haptics|longPressFeedback|feedback\s*:/);
    expect(mobile).toMatch(/LONG_PRESS_MS = 350/);
    expect(mobile).toMatch(/LONG_PRESS_MOVE_PX = 10/);
    expect(mobile).toMatch(/from "\.\/haptics"/);
    expect(mobile).toMatch(/feedback:\s*longPressFeedback/);
  });

  it("桌面适配器保留「触发后吞 click」与返回解绑函数语义", () => {
    expect(desktop).toContain("consumeClickSuppression");
    expect(desktop).toContain('el.addEventListener("click", onClickCapture, true)');
    expect(desktop).toMatch(/return \(\) => \{[\s\S]*timer\.dispose\(\)/);
  });

  it("桌面入口不 import 移动端模块（跨端边界）", () => {
    const importSpecifiers = [...stripComments(desktop).matchAll(/import\s+(?:[^"']*?from\s+)?["']([^"']+)["']/g)].map((m) => m[1]);
    expect(importSpecifiers.filter((spec) => /(^|\/)mobile\//.test(spec))).toEqual([]);
    expect(importSpecifiers).toEqual(["../../lib/longPressTimer"]);
  });
});
