// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import {
  __resetUploadJournalCacheForTests,
  recordUploadDone,
  recordUploadError,
  recordUploadPending,
} from "./uploadJournal";
import {
  applyJournalEntryToCard,
  findImageCardValues,
  hasUnresolvedImageTask,
  repairUploadCards,
} from "./uploadCardRepair";

function card(value: Record<string, unknown>): string {
  return '<card type="inline" name="image" value="data:' + encodeURIComponent(JSON.stringify(value)) + '">';
}
function decode(content: string): Array<Record<string, unknown>> {
  return findImageCardValues(content).map((item) => JSON.parse(decodeURIComponent(item.value.replace(/^data:/, ""))));
}
const errorCard = (taskId: string) => card({ src: "", taskId, clientId: "k1", originalType: "url", originWidth: 1080, originHeight: 613, status: "error", errorMessage: "unknown error", id: "u2bbe31f8" });
const doneCard = (taskId: string) => card({ src: "http://127.0.0.1:19876/n1/old.png", taskId, name: "old.png", size: 10, status: "done", id: "u9" });

beforeEach(() => {
  localStorage.clear();
  __resetUploadJournalCacheForTests();
});

describe("uploadCardRepair（正文图卡回填）", () => {
  it("done：空 src + unknown error 的卡按 taskId 回填真实资产；幂等", () => {
    recordUploadPending({ taskId: "t1", noteId: "n1", type: "url", url: "https://cdn.example/a.png" });
    recordUploadDone("t1", { url: "http://127.0.0.1:19876/n1/abc.png", filename: "abc.png", size: 321, mimeType: "image/png" });
    const body = '<p>前</p>' + errorCard("t1") + '<p>后</p>';
    const first = repairUploadCards(body, "n1");
    expect(first.changed).toBe(true);
    expect(first.repairedTaskIds).toEqual(["t1"]);
    const values = decode(first.content);
    expect(values[0]).toMatchObject({ src: "http://127.0.0.1:19876/n1/abc.png", name: "abc.png", size: 321, status: "done" });
    expect(values[0].errorMessage).toBeUndefined();
    // 其他内容一个字节不动
    expect(first.content.startsWith("<p>前</p>")).toBe(true);
    expect(first.content.endsWith("<p>后</p>")).toBe(true);
    // 幂等
    const second = repairUploadCards(first.content, "n1");
    expect(second.changed).toBe(false);
  });

  it("error：把 unknown error 换成真实原因；已有真实原因的卡不重复改", () => {
    recordUploadPending({ taskId: "t2", noteId: "n1", type: "url", url: "https://cdn.example/b.png" });
    recordUploadError("t2", "下载超时（15s）");
    const first = repairUploadCards(errorCard("t2"), "n1");
    expect(first.changed).toBe(true);
    expect(decode(first.content)[0]).toMatchObject({ status: "error", errorMessage: "下载超时（15s）" });
    expect(repairUploadCards(first.content, "n1").changed).toBe(false);
  });

  it("已经 done 且有 src 的卡绝不覆盖（内核正常成功路径 / 回填后）", () => {
    recordUploadDone("t3", { url: "http://127.0.0.1:19876/n1/new.png", filename: "new.png", size: 2, mimeType: "image/png" });
    recordUploadPending({ taskId: "t3", noteId: "n1", type: "url", url: "https://cdn.example/c.png" });
    recordUploadDone("t3", { url: "http://127.0.0.1:19876/n1/new.png", filename: "new.png", size: 2, mimeType: "image/png" });
    const result = repairUploadCards(doneCard("t3"), "n1");
    expect(result.changed).toBe(false);
  });

  it("只修本 note 的 taskId；其他 note/未知 task 的卡保持原样", () => {
    recordUploadPending({ taskId: "t4", noteId: "n1", type: "url", url: "https://cdn.example/d.png" });
    recordUploadDone("t4", { url: "http://127.0.0.1:19876/n1/abc.png", filename: "abc.png", size: 3, mimeType: "image/png" });
    const body = errorCard("t4") + errorCard("other");
    const result = repairUploadCards(body, "n1");
    expect(result.changed).toBe(true);
    expect(result.repairedTaskIds).toEqual(["t4"]);
    const values = decode(result.content);
    expect(values[1].src).toBe("");
    expect(values[1].errorMessage).toBe("unknown error");
  });

  it("hasUnresolvedImageTask：空 src/unknown error 为未解决，done 或已带真实原因为已解决", () => {
    recordUploadPending({ taskId: "t5", noteId: "n1", type: "url", url: "https://x/a.png" });
    expect(hasUnresolvedImageTask(errorCard("t5"), "t5")).toBe(true);
    recordUploadDone("t5", { url: "http://local/a.png", filename: "a.png", size: 1, mimeType: "image/png" });
    expect(hasUnresolvedImageTask(doneCard("t5"), "t5")).toBe(false);
    expect(hasUnresolvedImageTask(card({ src: "", taskId: "t5", status: "error", errorMessage: "下载超时（15s）" }), "t5")).toBe(false);
  });

  it("applyJournalEntryToCard 只认 taskId 匹配且无 src 的卡", () => {
    const entry = { taskId: "t6", noteId: "n1", type: "url" as const, createdAt: Date.now(), status: "done" as const, output: { url: "http://local/a.png", filename: "a.png", size: 1, mimeType: "image/png" } };
    expect(applyJournalEntryToCard({ taskId: "t6", src: "" }, entry)).toMatchObject({ src: "http://local/a.png", status: "done" });
    expect(applyJournalEntryToCard({ taskId: "t6", src: "http://local/b.png" }, entry)).toBeNull();
    expect(applyJournalEntryToCard({ taskId: "other", src: "" }, entry)).toBeNull();
  });
});
