import { describe, expect, it } from "vitest";
import { createImageThumbUploadTracker } from "./imageThumbUploadTracker";

const SRC = "http://127.0.0.1:19876/quick-notes/q1/1794_a.jpg";

function card(value: Record<string, unknown>): string {
  return '<p><card type="inline" name="image" value="data:' + encodeURIComponent(JSON.stringify(value)) + '"></card></p>';
}

/** 假调度器：按注册顺序执行，记录取消。 */
function fakeClock() {
  const queue: Array<{ delay: number; run: () => void; cancelled: boolean }> = [];
  return {
    schedule: (delay: number, run: () => void) => {
      const item = { delay, run, cancelled: false };
      queue.push(item);
      return () => { item.cancelled = true; };
    },
    /** 执行下一个未取消的回调；返回是否执行了。 */
    runNext(): boolean {
      for (let i = 0; i < queue.length; i += 1) {
        if (!queue[i].cancelled) {
          const item = queue.splice(i, 1)[0];
          item.run();
          return true;
        }
      }
      return false;
    },
    get live(): number { return queue.filter((q) => !q.cancelled).length; },
  };
}

describe("imageThumbUploadTracker（边界 A：新插入图片放行）", () => {
  it("未启用（宽度缺省 / allow 不是 Set）⇒ 完全不登记", () => {
    const clock = fakeClock();
    const allow = new Set<string>();
    const off = createImageThumbUploadTracker({ width: 0, allow, readBody: () => card({ src: SRC, originWidth: 10, originHeight: 10 }), schedule: clock.schedule });
    off.onUploaded({ url: SRC });
    expect(off.pendingCount()).toBe(0);
    expect(clock.live).toBe(0);
    expect(allow.size).toBe(0);

    const noSet = createImageThumbUploadTracker({ width: 1024, allow: undefined, readBody: () => "", schedule: clock.schedule });
    noSet.onUploaded({ url: SRC });
    expect(noSet.pendingCount()).toBe(0);
  });

  it("正文里已有正数 origin ⇒ 第一次读就放行（不污染、无残留定时器）", () => {
    const clock = fakeClock();
    const allow = new Set<string>();
    const logs: string[] = [];
    const tracker = createImageThumbUploadTracker({
      width: 1024, allow,
      readBody: () => card({ src: SRC, originWidth: 4032, originHeight: 3024 }),
      schedule: clock.schedule,
      log: (event, detail) => logs.push(event + ":" + detail.tries),
    });
    tracker.onUploaded({ url: SRC });
    expect(tracker.pendingCount()).toBe(1);
    expect(clock.runNext()).toBe(true);
    expect(allow.has("1794_a.jpg")).toBe(true);
    expect(tracker.pendingCount()).toBe(0);
    expect(clock.live).toBe(0);
    expect(logs).toEqual(["learned:1"]);
  });

  it("origin 迟到 ⇒ 退避重试直到出现（不在缺 origin 时放行）", () => {
    const clock = fakeClock();
    const allow = new Set<string>();
    let body = card({ src: SRC });
    const tracker = createImageThumbUploadTracker({ width: 1024, allow, readBody: () => body, schedule: clock.schedule });
    tracker.onUploaded({ url: SRC });
    clock.runNext();                        // 0ms：还没 origin
    expect(allow.size).toBe(0);
    expect(tracker.pendingCount()).toBe(1);
    body = card({ src: SRC, originWidth: 4032, originHeight: 3024 });
    clock.runNext();                        // 80ms：出现，放行
    expect(allow.has("1794_a.jpg")).toBe(true);
    expect(tracker.pendingCount()).toBe(0);
  });

  it("一直等不到 origin ⇒ 用满时点后放弃（不误放行）", () => {
    const clock = fakeClock();
    const allow = new Set<string>();
    const events: string[] = [];
    const tracker = createImageThumbUploadTracker({
      width: 1024, allow,
      readBody: () => card({ src: SRC }),
      schedule: clock.schedule,
      log: (event) => events.push(event),
    });
    tracker.onUploaded({ url: SRC });
    let guard = 0;
    while (tracker.pendingCount() > 0 && guard < 10) { clock.runNext(); guard += 1; }
    expect(allow.size).toBe(0);
    expect(tracker.pendingCount()).toBe(0);
    expect(clock.live).toBe(0);
    expect(events).toEqual(["giveup"]);
  });

  it("非本地资产（外链 / data URL）不登记；同一资产重复上传只登记一次", () => {
    const clock = fakeClock();
    const allow = new Set<string>();
    const tracker = createImageThumbUploadTracker({ width: 1024, allow, readBody: () => card({ src: SRC, originWidth: 1, originHeight: 1 }), schedule: clock.schedule });
    tracker.onUploaded({ url: "https://example.test/a.png" });
    tracker.onUploaded({ url: "data:image/png;base64,AAAA" });
    expect(tracker.pendingCount()).toBe(0);
    tracker.onUploaded({ url: SRC });
    tracker.onUploaded({ url: SRC });
    expect(tracker.pendingCount()).toBe(1);
    expect(clock.live).toBe(1);
  });

  it("上传 resolve 时正文里恰好一张「上传中且已有真实 origin」的卡 ⇒ 立即放行（不排定时器）", () => {
    const clock = fakeClock();
    const allow = new Set<string>();
    const events: string[] = [];
    const tracker = createImageThumbUploadTracker({
      width: 1024, allow,
      // 实测形态：src 还是空串，origin 已经是真实尺寸
      readBody: () => card({ src: "", originWidth: 640, originHeight: 480, status: "uploading" }),
      schedule: clock.schedule,
      log: (event) => events.push(event),
    });
    tracker.onUploaded({ url: SRC });
    expect(allow.has("1794_a.jpg")).toBe(true);
    expect(tracker.pendingCount()).toBe(0);
    expect(clock.live).toBe(0);
    expect(events).toEqual(["confirmed"]);
  });

  it("多张并发上传（数不清是哪张）⇒ 不即时放行，等 src 回填后按 origin 学习", () => {
    const clock = fakeClock();
    const allow = new Set<string>();
    let body = card({ src: "", originWidth: 640, originHeight: 480 }) + card({ src: "", originWidth: 320, originHeight: 200 });
    const tracker = createImageThumbUploadTracker({ width: 1024, allow, readBody: () => body, schedule: clock.schedule });
    tracker.onUploaded({ url: SRC });
    expect(allow.size).toBe(0);          // 两张都还没回填，不能瞎放
    expect(tracker.pendingCount()).toBe(1);
    body = card({ src: SRC, originWidth: 640, originHeight: 480 }) + card({ src: "", originWidth: 320, originHeight: 200 });
    clock.runNext();
    expect(allow.has("1794_a.jpg")).toBe(true);
  });

  it("唯一待上传卡但缺 origin（width 属性路径）⇒ 不即时放行，走重试（最终 giveup）", () => {
    const clock = fakeClock();
    const allow = new Set<string>();
    const tracker = createImageThumbUploadTracker({ width: 1024, allow, readBody: () => card({ src: "", width: 300 }), schedule: clock.schedule });
    tracker.onUploaded({ url: SRC });
    expect(allow.size).toBe(0);
    expect(tracker.pendingCount()).toBe(1);
    let guard = 0;
    while (tracker.pendingCount() > 0 && guard < 10) { clock.runNext(); guard += 1; }
    expect(allow.size).toBe(0);
  });

  it("并发里有一张带 origin 的待上传卡 ⇒ 仍不即时放行（身份不可证，禁止认错卡）", () => {
    const clock = fakeClock();
    const allow = new Set<string>();
    const body = card({ src: "", originWidth: 640, originHeight: 480 }) + card({ src: "", width: 300 });
    const tracker = createImageThumbUploadTracker({ width: 1024, allow, readBody: () => body, schedule: clock.schedule });
    tracker.onUploaded({ url: SRC });
    expect(allow.size).toBe(0);
  });

  it("正文里有「上传失败遗留的待上传卡」+ 我们这张 ⇒ 计数=2，不即时放行（防认错卡）", () => {
    const clock = fakeClock();
    const allow = new Set<string>();
    // 遗留卡：src 恒空但已有 origin；我们的卡：src 空、origin 还没写
    let body = card({ src: "", originWidth: 640, originHeight: 480 });
    const tracker = createImageThumbUploadTracker({ width: 1024, allow, readBody: () => body, schedule: clock.schedule });
    // 上传 resolve 时我们的卡也已序列化（src 空、无 origin）⇒ pending 总数 2
    body = card({ src: "", originWidth: 640, originHeight: 480 }) + card({ src: "" });
    tracker.onUploaded({ url: SRC });
    expect(allow.size).toBe(0);
    // 我们的卡回填 src 后按正文 origin 学习
    body = card({ src: "", originWidth: 640, originHeight: 480 }) + card({ src: SRC, originWidth: 4032, originHeight: 3024 });
    clock.runNext();
    expect(allow.has("1794_a.jpg")).toBe(true);
  });

  it("卡已完成但缺 origin（如带 width 属性跳过了解码）⇒ 绝不即时放行", () => {
    const clock = fakeClock();
    const allow = new Set<string>();
    const events: string[] = [];
    const tracker = createImageThumbUploadTracker({
      width: 1024, allow,
      readBody: () => card({ src: SRC, width: 300 }),  // 已完成、无 origin
      schedule: clock.schedule,
      log: (event) => events.push(event),
    });
    tracker.onUploaded({ url: SRC });
    expect(allow.size).toBe(0);          // 我们的卡已回填 src ⇒ 不走即时确认
    let guard = 0;
    while (tracker.pendingCount() > 0 && guard < 10) { clock.runNext(); guard += 1; }
    expect(allow.size).toBe(0);
    expect(events).toEqual(["giveup"]);
  });

  it("dispose 取消所有待确认（编辑器销毁后不再读正文）", () => {
    const clock = fakeClock();
    const allow = new Set<string>();
    let reads = 0;
    const tracker = createImageThumbUploadTracker({ width: 1024, allow, readBody: () => { reads += 1; return card({ src: SRC }); }, schedule: clock.schedule });
    tracker.onUploaded({ url: SRC });
    const readsAfterUpload = reads;
    tracker.dispose();
    expect(clock.live).toBe(0);
    expect(clock.runNext()).toBe(false);
    expect(reads).toBe(readsAfterUpload);   // dispose 后不再读正文
    expect(allow.size).toBe(0);
  });
});
