import { describe, expect, it } from "vitest";
import {
  DUPLICATE_NOTES_MAX_IDS,
  duplicateNoteTitle,
  forbidSelfNoteRefs,
  normalizeDuplicateIds,
  remapBlockIds,
  rewriteAssetNoteIds,
  summarizeDuplicateResults,
} from "./duplicateNotes";

describe("duplicateNoteTitle（副本命名：原名称 + 副本 + 时间）", () => {
  it("按本地时间拼 YYYY-MM-DD HH:mm:ss", () => {
    expect(duplicateNoteTitle("计划", new Date(2026, 10, 6, 22, 31, 7))).toBe("计划 副本 2026-11-06 22:31:07");
  });
  it("空标题回落无标题文档；首尾空白裁掉", () => {
    expect(duplicateNoteTitle("   ", new Date(2026, 0, 2, 3, 4, 5))).toBe("无标题文档 副本 2026-01-02 03:04:05");
    expect(duplicateNoteTitle(" 周报 ", new Date(2026, 0, 2, 3, 4, 5))).toBe("周报 副本 2026-01-02 03:04:05");
  });
});

describe("rewriteAssetNoteIds（副本正文不得引用原笔记资产）", () => {
  const from = "11111111-1111-4111-8111-111111111111";
  const to = "22222222-2222-4222-8222-222222222222";

  it("http 资源 URL 的 noteId 段被替换", () => {
    const html = '<img src="http://127.0.0.1:19876/' + from + '/1700_ab.png">';
    expect(rewriteAssetNoteIds(html, from, to)).toBe('<img src="http://127.0.0.1:19876/' + to + '/1700_ab.png">');
  });
  it("lake-asset:// 与 /note-assets/ 形态也覆盖", () => {
    expect(rewriteAssetNoteIds("lake-asset://" + from + "/a.png", from, to)).toBe("lake-asset://" + to + "/a.png");
    expect(rewriteAssetNoteIds("/var/data/note-assets/" + from + "/a.png", from, to)).toBe("/var/data/note-assets/" + to + "/a.png");
  });
  it("不在路径位置的同串文本不改（避免误伤正文）", () => {
    const text = "正文提到 " + from + " 这个 id 但没有斜杠";
    expect(rewriteAssetNoteIds(text, from, to)).toBe(text);
  });
  it("百分号编码形态（Lake 图片卡 value = data: 套 JSON 再整体编码）也替换", () => {
    // 真实落盘形态（261106 设备实测）：图片卡 value 里是 %2F{noteId}%2F
    const body = '<ne-card data-card-name="image" value="%7B%22src%22%3A%22http%3A%2F%2F127.0.0.1%3A19876%2F' + from + '%2F1700_ab.png%22%7D"></ne-card>';
    const out = rewriteAssetNoteIds(body, from, to);
    expect(out).toContain("%2F" + to + "%2F1700_ab.png");
    expect(out).not.toContain(from);
  });
  it("小写 %2f 也覆盖", () => {
    const body = "http%3A%2F%2F127.0.0.1%3A19876%2f" + from + "%2f1700_ab.png";
    expect(rewriteAssetNoteIds(body, from, to)).toBe("http%3A%2F%2F127.0.0.1%3A19876%2f" + to + "%2f1700_ab.png");
  });
  it("多个资源一次性全替换；from/id 相同或无内容时原样返回", () => {
    const body = "http://h/" + from + "/a.png 和 http://h/" + from + "/b.png";
    expect(rewriteAssetNoteIds(body, from, to)).toBe("http://h/" + to + "/a.png 和 http://h/" + to + "/b.png");
    expect(rewriteAssetNoteIds(body, from, from)).toBe(body);
    expect(rewriteAssetNoteIds("", from, to)).toBe("");
  });
});

describe("remapBlockIds（D 方案：副本块 id 全量换新，源码/副本并排不撞 id）", () => {
  const body = [
    '<h1 data-lake-id="u11111111" id="u11111111"><span data-lake-id="u22222222" id="u22222222">标题</span></h1>',
    '<p data-lake-id="11111111-1111-4111-8111-111111111111-body" id="11111111-1111-4111-8111-111111111111-body"><span data-lake-id="u33333333" id="u33333333">正文</span></p>',
    '<ul list="u44444444"><li fid="u44444444" data-lake-id="u55555555" id="u55555555"><span data-lake-id="u66666666" id="u66666666">项</span></li></ul>',
    '<p><card type="inline" name="image" value="data:%7B%22src%22%3A%22http%3A%2F%2F127.0.0.1%3A19876%2Fnote-1%2Fa.png%22%7D"></card></p>',
  ].join("");
  const remapped = (() => {
    let n = 0;
    return remapBlockIds(body, () => "u" + String(++n).padStart(8, "0"));
  })();

  it("所有块 id（含 {noteId}-body）都换成新值，旧 id 不再出现", () => {
    for (const oldId of ["u11111111", "u22222222", "u33333333", "u44444444", "u55555555", "u66666666", "11111111-1111-4111-8111-111111111111-body"]) {
      expect(remapped).not.toContain(oldId);
    }
    expect(remapped).toContain('id="u00000001"');
    expect(remapped).toContain('data-lake-id="u00000001"');
  });

  it("list/fid 引用跟着换（同一旧 id 引用到同一新 id）", () => {
    expect(remapped).toMatch(/<ul list="u0000000[0-9a-f]"|list="u0[0-9]{7}"/);
    const listId = /<ul list="([^"]+)"/.exec(remapped)![1];
    expect(remapped).toContain('fid="' + listId + '"');
  });

  it("资源 URL / data: 卡片值保持不动", () => {
    expect(remapped).toContain("http%3A%2F%2F127.0.0.1%3A19876%2Fnote-1%2Fa.png");
    expect(remapped).toContain('name="image"');
  });

  it("无 id 的正文原样返回；新 id 不与旧 id 冲突", () => {
    expect(remapBlockIds("<p>无 id</p>", () => "u99999999")).toBe("<p>无 id</p>");
    const clash = remapBlockIds('<p data-lake-id="u00000001" id="u00000001"></p>', () => "u00000001");
    expect(clash).not.toContain('id="u00000001"');
    expect(clash).toMatch(/id="u[0-9a-f]{8}"/);
  });
});

describe("forbidSelfNoteRefs（261107：副本禁止自引用）", () => {
  const self = "33333333-3333-4333-8333-333333333333";
  const source = "44444444-4444-4444-8444-444444444444";

  it("指向副本自己的明文引用 → 回退指向源目标", () => {
    expect(forbidSelfNoteRefs("见 <a href=\"lake-note://" + self + "\">自身</a>", self, source))
      .toBe("见 <a href=\"lake-note://" + source + "\">自身</a>");
  });
  it("百分号编码形态（卡片 value）也回退", () => {
    expect(forbidSelfNoteRefs("lake-note%3A%2F%2F" + self, self, source)).toBe("lake-note%3A%2F%2F" + source);
  });
  it("JSON 转义斜杠形态（lake-note:\/\/id）也回退", () => {
    expect(forbidSelfNoteRefs("lake-note:\\/\\/" + self, self, source)).toBe("lake-note:\\/\\/" + source);
  });
  it("其他目标的引用不被动（引用语义保持）", () => {
    const body = "lake-note://" + source + " 与 lake-note://55555555-5555-4555-8555-555555555555";
    expect(forbidSelfNoteRefs(body, self, source)).toBe(body);
  });
  it("self 与 fallback 相同/空输入时原样返回", () => {
    expect(forbidSelfNoteRefs("lake-note://" + self, self, self)).toBe("lake-note://" + self);
    expect(forbidSelfNoteRefs("", self, source)).toBe("");
  });
});

describe("normalizeDuplicateIds（请求级清洗，与 batchNotes 同口径）", () => {
  it("去重并保序", () => {
    expect(normalizeDuplicateIds(["a", "b", "a"])).toEqual({ ok: true, ids: ["a", "b"] });
  });
  it("空/非数组/超上限/非法 id 一律整批拒绝", () => {
    expect(normalizeDuplicateIds(undefined)).toMatchObject({ ok: false, reason: "invalid-input" });
    expect(normalizeDuplicateIds([])).toMatchObject({ ok: false, reason: "empty-ids" });
    expect(normalizeDuplicateIds(Array.from({ length: DUPLICATE_NOTES_MAX_IDS + 1 }, (_, i) => "n" + i)))
      .toMatchObject({ ok: false, reason: "too-many-ids" });
    expect(normalizeDuplicateIds(["ok", "../escape"])).toMatchObject({ ok: false, reason: "invalid-id" });
    expect(normalizeDuplicateIds(["ok", 3])).toMatchObject({ ok: false, reason: "invalid-id" });
  });
});

describe("summarizeDuplicateResults", () => {
  it("统计 done/failed", () => {
    expect(summarizeDuplicateResults([{ id: "a", ok: true, newId: "a2" }, { id: "b", ok: false, reason: "not-found" }, { id: "c", ok: true, newId: "c2" }]))
      .toEqual({ total: 3, done: 2, failed: 1 });
  });
});