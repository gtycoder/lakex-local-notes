// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import {
  applyVideoLayout,
  normalizeVideoAlignment,
  normalizeVideoWidth,
  readVideoLayout,
  mountVideoCardLayoutSync,
  writeVideoLayout,
  type VideoAlignment,
} from "./videoCardOps";

function cardWithData(value: Record<string, unknown>) {
  const card = document.createElement("ne-card");
  card.setAttribute("data-card-name", "video");
  const taskManager = {
    reset: vi.fn(),
    _thread: {
      _taskIds: typeof value.taskId === "string" ? [value.taskId] : [],
      _runningTasks: [],
      _pendingTasks: [],
    },
  };

  const cardData = {
    getCardValue: vi.fn(() => ({ ...value })),
    resetCardValue: vi.fn((next: Record<string, unknown>) => Object.assign(value, next)),
    sync: vi.fn(() => true),
    getStatus: vi.fn(() => value.status as string),
    getUrl: vi.fn(() => value.url as string),
    getTaskId: vi.fn(() => value.taskId as string),
    setStatus: vi.fn((status: string) => { value.status = status; }),
  };
  const inst = { cardData, _task: {}, _ui: { _updateObserver: { _taskManager: taskManager } } };
  Object.defineProperty(card, "_neRef", {
    configurable: true,
    value: { _virtualNode: { _instance: inst } },
  });
  return { card, cardData, value, inst, taskManager };
}

describe("视频卡片布局值", () => {
  it("宽度按 10–100 取整，对齐只接受三个合法值", () => {
    expect(normalizeVideoWidth(undefined)).toBe(100);
    expect(normalizeVideoWidth(9)).toBe(10);
    expect(normalizeVideoWidth(53.6)).toBe(54);
    expect(normalizeVideoWidth(120)).toBe(100);
    expect(normalizeVideoAlignment("right")).toBe("right");
    expect(normalizeVideoAlignment("justify")).toBe("left");
  });

  it("无自定义字段时默认正文宽度 100% + 左对齐", () => {
    const { card } = cardWithData({ status: "done", url: "file:///demo.mp4" });
    expect(readVideoLayout(card)).toEqual({ widthPercent: 100, alignment: "left" });
  });

  it("投影宽度时使用正文可用宽度百分比，并保留持久化值", () => {
    const { card } = cardWithData({});
    const layout = applyVideoLayout(card, { widthPercent: 50, alignment: "center" as VideoAlignment });
    expect(layout).toEqual({ widthPercent: 50, alignment: "center" });
    expect(card.getAttribute("data-video-width")).toBe("50");
    expect(card.getAttribute("data-video-align")).toBe("center");
    expect(card.style.getPropertyValue("--lake-video-max-width")).toBe("50%");
  });

  it("写回走 resetCardValue + sync(false)，保留既有卡片字段", () => {
    const { card, cardData } = cardWithData({ status: "done", name: "demo.mp4", __spacing: "both" });
    expect(writeVideoLayout(card, { widthPercent: 75, alignment: "right" })).toBe(true);
    expect(cardData.resetCardValue).toHaveBeenCalledWith({
      status: "done",
      name: "demo.mp4",
      __spacing: "both",
      __videoWidth: 75,
      __videoAlign: "right",
    });
    expect(cardData.sync).toHaveBeenCalledWith(false);
    expect(card.getAttribute("data-video-width")).toBe("75");
    expect(card.getAttribute("data-video-align")).toBe("right");
  });

  it("新插入的 uploaded 视频归一为 done，并在上传任务都结束后清理残留任务", async () => {
    const { card, cardData, value, inst, taskManager } = cardWithData({
      status: "uploaded",
      taskId: "upload-1",
      url: "http://127.0.0.1/demo.mp4",
    });
    const done = document.createElement("div");
    done.className = "ne-card-video-done";
    card.appendChild(done);
    const host = document.createElement("div");
    host.appendChild(card);
    const dispose = mountVideoCardLayoutSync(host, {}, { interactive: true });
    expect(value.status).toBe("done");
    expect(cardData.setStatus).toHaveBeenCalledWith("done");
    expect(cardData.sync).toHaveBeenCalledWith(false);
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(taskManager.reset).toHaveBeenCalledTimes(1);
    expect(inst._task).toBeNull();
    dispose();
  });

  it("上传线程已结束后仍会清理卡实例的残留任务引用", async () => {
    const { card, value, inst, taskManager } = cardWithData({
      status: "uploaded",
      taskId: "upload-1",
      url: "http://127.0.0.1/demo.mp4",
    });
    taskManager._thread = null as never;
    const host = document.createElement("div");
    host.appendChild(card);
    const dispose = mountVideoCardLayoutSync(host, {}, { interactive: true });
    expect(value.status).toBe("done");
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(inst._task).toBeNull();
    expect(taskManager.reset).not.toHaveBeenCalled();
    dispose();
  });

  it("上传中的视频不会被终态清理误伤", async () => {
    const { card, value, inst, taskManager } = cardWithData({
      status: "uploading",
      taskId: "upload-live",
      url: "http://127.0.0.1/demo.mp4",
    });
    taskManager._thread = null as never;
    const host = document.createElement("div");
    host.appendChild(card);
    const dispose = mountVideoCardLayoutSync(host, {}, { interactive: true });
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(value.status).toBe("uploading");
    expect(inst._task).not.toBeNull();
    dispose();
  });

});
