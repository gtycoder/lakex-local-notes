// @vitest-environment jsdom
/**
 * 261112 用户报：只插入一张图片，小记列表卡片的预览里却出现 2 张。
 * 根因：卡片上方用 note.firstImage 渲染**封面**（qn-card__img），下面的 QuickNotePreview 又把正文里的
 * 同一个 image 卡画了一遍（quick-note-preview-image）⇒ 同一张图出现两次。
 * 修法：HomePage 把「封面已展示的图」经 hiddenMediaNames 传给预览，预览跳过该 image 卡。
 * 本用例锁：① 传了 hiddenMediaNames ⇒ 预览里没有那张图、其余内容照常；② 不传 ⇒ 行为不变；③ HomePage 确实传了。
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { QuickNotePreview } from "./QuickNotePreview";

const FILE = "1794_a.png";
const URL_BASE = "http://127.0.0.1:19876/quick-notes/q1/" + FILE;
const imageCard = () => {
  const value = "data:" + encodeURIComponent(JSON.stringify({ src: URL_BASE + "?token=t", name: FILE, originWidth: 1080, originHeight: 2400 }));
  return '<p><card type="inline" name="image" value="' + value + '"></card></p>';
};
const body = imageCard() + '<p><span>Yyhh</span></p>';
const assets = [{ id: "i1", filename: FILE, mimeType: "image/png", width: 1080, height: 2400, size: 278755, hash: "h", url: URL_BASE + "?token=t&w=1024" }];

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});
const render = (hidden?: Set<string>) => {
  act(() => {
    root.render(createElement(QuickNotePreview, {
      body, assets, onImageClick: () => undefined, ellipsisClassName: "mb-ellipsis",
      ...(hidden ? { hiddenMediaNames: hidden } : {}),
    }));
  });
};

describe("QuickNotePreview · 封面图不在预览里重复渲染", () => {
  it("不传 hiddenMediaNames ⇒ 预览照常渲染图片（桌面/标签页行为不变）", () => {
    render();
    expect(host.querySelectorAll(".quick-note-preview-image").length).toBe(1);
    expect(host.textContent).toContain("Yyhh");
  });

  it("传了封面图 ⇒ 预览跳过该图片，其余内容保留", () => {
    render(new Set([FILE]));
    expect(host.querySelectorAll(".quick-note-preview-image").length).toBe(0);
    expect(host.textContent).toContain("Yyhh");
  });

  it("封面文件不匹配时仍渲染图片（只去重封面那一张，不误伤其它图）", () => {
    render(new Set(["other.png"]));
    expect(host.querySelectorAll(".quick-note-preview-image").length).toBe(1);
  });

  it("HomePage 把 note.firstImage 作为 hiddenMediaNames 传给预览（护栏）", () => {
    // jsdom 环境里 import.meta.url 不是 file: 协议 ⇒ 直接按仓库根相对路径读（vitest cwd = 仓库根）。
    const src = readFileSync("src/mobile/home/HomePage.tsx", "utf8");
    expect(src).toContain("hiddenMediaNames={thumbUrl && note.firstImage ? new Set([note.firstImage]) : undefined}");
  });
});
