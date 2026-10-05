// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { collectSelectionImageRefs, imageCardAssetRef } from "./selectionImages.js";

const NOTE = "11111111-1111-1111-1111-111111111111";
const src = (file: string) => "http://127.0.0.1:19876/" + NOTE + "/" + file;

function containerWith(html: string): HTMLElement {
  const el = document.createElement("div");
  el.innerHTML = html;
  document.body.appendChild(el);
  return el;
}
function rangeOver(el: Element): Range {
  const r = document.createRange();
  r.selectNodeContents(el);
  return r;
}

describe("选区图片 → 资产引用（多模态）", () => {
  it("克隆片段里的图片卡片被收集（含裸 img.ne-image），按磁盘名去重、去掉 token", () => {
    const el = containerWith(
      '<p>intro</p><ne-card data-card-name="image"><img class="ne-image" src="' + src("a_1.png") + '"></ne-card>' +
      '<ne-card data-card-name="image"><img class="ne-image" src="' + src("a_1.png") + '"></ne-card>' +
      '<img class="ne-image" src="' + src("b_2.jpg") + '">' +
      '<ne-card data-card-name="image"><img class="ne-image" src="' + src("c_3.png") + '?token=T"></ne-card>',
    );
    const refs = collectSelectionImageRefs(rangeOver(el));
    expect(refs.map((r) => r.filename)).toEqual(["a_1.png", "b_2.jpg", "c_3.png"]);
    expect(refs[0].noteId).toBe(NOTE);
    el.remove();
  });

  it("折叠选区 / null 返回空", () => {
    expect(collectSelectionImageRefs(null)).toEqual([]);
    const el = containerWith("<p>text</p>");
    const r = document.createRange();
    r.setStart(el.firstChild!, 0);
    r.collapse(true);
    expect(collectSelectionImageRefs(r)).toEqual([]);
    el.remove();
  });

  it("非本地资产（data:/外链）被跳过", () => {
    const el = containerWith(
      '<img class="ne-image" src="data:image/png;base64,AAAA"><img class="ne-image" src="https://example.com/x.png">',
    );
    expect(collectSelectionImageRefs(rangeOver(el))).toEqual([]);
    el.remove();
  });

  it("imageCardAssetRef：本地资产解析，非法返回 null", () => {
    expect(imageCardAssetRef(src("x.png"))).toEqual({ noteId: NOTE, filename: "x.png" });
    expect(imageCardAssetRef("data:image/png;base64,AAAA")).toBeNull();
    expect(imageCardAssetRef(null)).toBeNull();
  });
});
