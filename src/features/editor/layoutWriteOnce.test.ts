// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  applyVideoLayout,
  mountVideoCardLayoutSync,
  type VideoAlignment,
} from "./videoCardOps";
import { mountMediaCardResize } from "./mediaCardResize";

/**
 * 「未变才写」写次数断言（AGENTS I2；261119 闪烁排查的验收口径）：
 * 布局投影器在目标值与现值一致时不得写 DOM（attr/style），静置场景 N 次扫描 = 0 写；
 * 真实变化（拖拽缩放、恢复布局）仍正常写。MutationObserver 统计 style/attr 变更。
 */
function videoCard(value: Record<string, unknown>) {
  const card = document.createElement("ne-card");
  card.setAttribute("data-card-name", "video");
  const cardData = {
    getCardValue: () => ({ ...value }),
    resetCardValue: (next: Record<string, unknown>) => Object.assign(value, next),
    sync: () => true,
    getStatus: () => value.status as string,
    getUrl: () => value.url as string,
    getTaskId: () => value.taskId as string,
    setStatus: (status: string) => { value.status = status; },
  };
  Object.defineProperty(card, "_neRef", {
    configurable: true,
    value: { _virtualNode: { _instance: { cardData, _task: {}, _ui: { _updateObserver: { _taskManager: { reset: () => undefined, _thread: { _taskIds: [], _runningTasks: [], _pendingTasks: [] } } } } } } },
  });
  return card;
}

/** 只统计真实 DOM 写（attr/style/元素节点）；触发扫描用的注释节点增删不算写。 */
function isDomWrite(record: MutationRecord): boolean {
  if (record.type !== "childList") return true;
  const nodes = [...record.addedNodes, ...record.removedNodes];
  return nodes.length > 0 && nodes.some((node) => node.nodeType !== Node.COMMENT_NODE);
}

function countMutations(target: Node, run: () => void | Promise<void>): Promise<number> {
  let count = 0;
  const observer = new MutationObserver((records) => {
    count += records.filter(isDomWrite).length;
  });
  observer.observe(target, { attributes: true, childList: true, subtree: true, characterData: true });
  return Promise.resolve()
    .then(run)
    .then(() => new Promise((resolve) => setTimeout(resolve, 5)))
    .then(() => {
      count += observer.takeRecords().filter(isDomWrite).length;
      observer.disconnect();
      return count;
    });
}

describe("布局投影器未变才写", () => {
  it("applyVideoLayout：同一布局重放 = 0 次 DOM 写；变化才写", async () => {
    const card = videoCard({});
    const layout = { widthPercent: 50, alignment: "center" as VideoAlignment };
    await countMutations(card, () => { applyVideoLayout(card, layout); });
    const idleWrites = await countMutations(card, () => {
      for (let i = 0; i < 10; i += 1) applyVideoLayout(card, { ...layout });
    });
    expect(idleWrites).toBe(0);
    const changeWrites = await countMutations(card, () => {
      applyVideoLayout(card, { widthPercent: 75, alignment: "right" });
    });
    expect(changeWrites).toBeGreaterThan(0);
    expect(card.getAttribute("data-video-width")).toBe("75");
    expect(card.getAttribute("data-video-align")).toBe("right");
    expect(card.style.getPropertyValue("--lake-video-max-width")).toBe("75%");
  });

  it("mountVideoCardLayoutSync：就绪后静置（contentchange 风暴）= 0 次布局写", async () => {
    const card = videoCard({ status: "done", url: "file:///demo.mp4", __videoWidth: 60, __videoAlign: "center" });
    const host = document.createElement("div");
    host.appendChild(card);
    const listeners = new Set<() => void>();
    const editor = {
      on: (_event: string, listener: () => void) => { listeners.add(listener); },
      off: (_event: string, listener: () => void) => { listeners.delete(listener); },
    };
    const dispose = mountVideoCardLayoutSync(host, editor, { interactive: true });
    await countMutations(host, () => undefined);
    // 静置扫描环：内容事件反复触发扫描，但值没变 ⇒ 零 DOM 写
    const idleWrites = await countMutations(host, () => {
      for (let i = 0; i < 8; i += 1) listeners.forEach((listener) => listener());
    });
    expect(idleWrites).toBe(0);
    // 真实变化（持久化布局改了再投影）⇒ 正常写
    const changeWrites = await countMutations(host, () => {
      applyVideoLayout(card, { widthPercent: 80, alignment: "left" });
      listeners.forEach((listener) => listener());
    });
    expect(changeWrites).toBeGreaterThan(0);
    dispose();
  });

  it("mountMediaCardResize：把手建立后重复扫描 = 0 次 DOM 写；尺寸变化才写", async () => {
    const card = videoCard({ status: "done", url: "file:///demo.mp4", __videoWidth: 60, __videoAlign: "left" });
    const done = document.createElement("div");
    done.className = "ne-card-video-done";
    card.appendChild(done);
    const host = document.createElement("div");
    host.appendChild(card);
    const dispose = mountMediaCardResize(host, true);
    await countMutations(host, () => undefined);
    const idleWrites = await countMutations(host, () => {
      for (let i = 0; i < 8; i += 1) {
        host.appendChild(document.createComment("scan"));
        host.lastChild?.remove();
      }
    });
    expect(idleWrites).toBe(0);
    dispose();
  });
});
