import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  buildDoneFileCardValue,
  decodeCardValue,
  encodeCardValue,
  fileKindOf,
  formatFileSize,
  parseFileCardValue,
  scanFileCards,
  type AttachmentKind,
} from "./fileCard.js";
import { fileKindOf as assetFileKindOf, type AssetFileKind } from "./assetNaming.js";

/** 构造一个与 Lake 序列化一致的 card 文本：<card type="block" name="file" value="data:{enc}"> */
function cardHtml(value: Record<string, unknown>): string {
  return '<card type="block" name="file" value="' + encodeCardValue(value) + '"></card>';
}

describe("fileCard", () => {
  const localValue = {
    src: "http://127.0.0.1:19876/note-abc/1787733338672_a1b2c3d4.pdf",
    name: "需求文档.pdf",
    size: 2048,
    ext: "pdf",
    type: "application/pdf",
    status: "done",
    mode: "card",
    download: true,
    id: "ufile1",
  };

  it("round-trips value encode/decode", () => {
    const encoded = encodeCardValue(localValue);
    expect(encoded.startsWith("data:")).toBe(true);
    expect(decodeCardValue(encoded)).toEqual(localValue);
  });

  it("parses a file card value and resolves local asset ref", () => {
    const parsed = parseFileCardValue(encodeCardValue(localValue).slice("data:".length));
    expect(parsed?.src).toBe(localValue.src);
    expect(parsed?.name).toBe("需求文档.pdf");
    expect(parsed?.size).toBe(2048);
    expect(parsed?.status).toBe("done");
  });

  it("rejects malformed values", () => {
    expect(parseFileCardValue("%7B%22broken")).toBeNull();
    expect(parseFileCardValue(encodeURIComponent("not-json"))).toBeNull();
    expect(parseFileCardValue(encodeURIComponent('{"size": 1}'))).toBeNull(); // 无 src
  });

  it("data: 前缀在 URI 解码前/后出现都能容忍（D-07 superset）", () => {
    const obj = { src: "http://127.0.0.1:19876/n/a.png", name: "a.png" };
    // 内核标准形态：前缀在编码串之前
    expect(decodeCardValue("data:" + encodeURIComponent(JSON.stringify(obj)))).toEqual(obj);
    // 前缀本身也被 URI 编码（解码后才出现）
    expect(decodeCardValue(encodeURIComponent("data:" + JSON.stringify(obj)))).toEqual(obj);
    // 无前缀
    expect(decodeCardValue(encodeURIComponent(JSON.stringify(obj)))).toEqual(obj);
  });

  it("裸 JSON（未经 URI 编码）原样解析：值里的 %xx 不被二次解码改坏", () => {
    expect(decodeCardValue('{"src":"a%20b.png"}')).toEqual({ src: "a%20b.png" });
    expect(decodeCardValue('data:{"src":"a%20b.png"}')).toEqual({ src: "a%20b.png" });
  });

  it("数组/字面量/坏值一律回 null（三套 fixture 对拍后的统一口径：card value 只收对象）", () => {
    expect(decodeCardValue("data:" + encodeURIComponent("[1,2]"))).toBeNull();
    expect(decodeCardValue("[1,2]")).toBeNull();
    expect(decodeCardValue("data:" + encodeURIComponent("true"))).toBeNull();
    expect(decodeCardValue("data:x")).toBeNull();
    expect(decodeCardValue("")).toBeNull();
    expect(decodeCardValue(null)).toBeNull();
    expect(decodeCardValue(undefined)).toBeNull();
  });

  it("scans file cards in lake content with local refs", () => {
    const content = [
      "<p>before</p>",
      cardHtml(localValue),
      cardHtml({ src: "data:application/pdf;base64,AAAA", name: "x.pdf", size: 4, ext: "pdf", id: "ufile2" }),
      '<p><card type="inline" name="image" value="data:%7B%22src%22%3A%22http%3A%2F%2F127.0.0.1%3A19876%2Fn%2F1.png%22%7D"></card></p>',
    ].join("");
    const cards = scanFileCards(content);
    expect(cards).toHaveLength(2);
    expect(cards[0].cardId).toBe("ufile1");
    expect(cards[0].ref).toEqual({ space: "note", noteId: "note-abc", filename: "1787733338672_a1b2c3d4.pdf" });
    expect(cards[1].ref).toBeNull(); // data URL 非本地资产
    expect(cards[0].raw).toContain('name="file"');
  });

  it("builds a done file card value", () => {
    const v = buildDoneFileCardValue({ src: "http://127.0.0.1:19876/n/f.pdf", name: "F.PDF", size: 100, type: "application/pdf" });
    expect(v.status).toBe("done");
    expect(v.ext).toBe("pdf");
    expect(v.mode).toBe("card");
    expect(v.download).toBe(true);
  });

  it("classifies attachment kinds by extension", () => {
    expect(fileKindOf("a.png")).toBe("image");
    expect(fileKindOf("b.PDF")).toBe("pdf");
    expect(fileKindOf("c.mp3")).toBe("audio");
    expect(fileKindOf("d.mp4")).toBe("video");
    expect(fileKindOf("e.docx")).toBe("document");
    expect(fileKindOf("f.zip")).toBe("archive");
    expect(fileKindOf("g.xyz")).toBe("other");
  });

  it("formats file sizes for display", () => {
    expect(formatFileSize(0)).toBe("0 B");
    expect(formatFileSize(512)).toBe("512 B");
    expect(formatFileSize(2048)).toBe("2 KB");
    expect(formatFileSize(25 * 1024 * 1024)).toBe("25 MB");
    expect(formatFileSize(3.5 * 1024 * 1024)).toBe("3.5 MB");
  });
});

describe("D-07 卡片 value 编解码单一来源（core/fileCard）", () => {
  const read = (rel: string): string => readFileSync(new URL(rel, import.meta.url), "utf8");

  it("两份私有副本已删，改 import core/fileCard（防再长回来）", () => {
    for (const rel of ["../features/editor/uploadCardRepair.ts", "../features/quickNotes/quickNotePreviewParser.ts"]) {
      const src = read(rel);
      expect(src, rel).not.toContain("function decodeCardValue");
      expect(src, rel).not.toContain("function encodeCardValue");
      expect(src, rel).toContain('from "../../core/fileCard');
    }
  });
});

describe("CORE-07 fileKindOf 与图标分类同源", () => {
  // 图标分流 = assetNaming.fileKindOf（11 类，文件的单一扩展名表）；
  // 预览分流 = fileCard.fileKindOf（7 桶）。这里锁死「预览类型 = 图标类型的投影」。
  // Record<AssetFileKind, …> 同时是完整性护栏：新增 11 类之一时此表必须跟着改。
  const previewOfIconKind: Record<AssetFileKind, AttachmentKind> = {
    image: "image",
    pdf: "pdf",
    audio: "audio",
    video: "video",
    archive: "archive",
    doc: "document",
    sheet: "document",
    slide: "document",
    code: "document",
    text: "document",
    file: "other",
  };

  const extMatrix = [
    "png", "jpg", "jpeg", "gif", "webp", "avif", "svg", "bmp", "tiff",
    "pdf",
    "doc", "docx", "rtf", "epub", "odt", "pages",
    "xls", "xlsx", "csv", "tsv", "numbers",
    "ppt", "pptx", "key",
    "zip", "rar", "7z", "tar", "gz", "xz",
    "mp3", "wav", "flac", "ogg", "m4a",
    "mp4", "mov", "webm", "mkv", "avi",
    "txt", "md", "markdown", "log",
    "ts", "tsx", "js", "json", "py", "yml", "yaml", "sql", "apk", "bin",
  ];

  it("每个扩展名：预览类型 = 图标类型的投影（单一来源）", () => {
    for (const ext of extMatrix) {
      const iconKind = assetFileKindOf("x." + ext);
      expect(previewOfIconKind[iconKind], ext).toBe(fileKindOf("x." + ext));
    }
  });

  it("图标认得出来的扩展名，预览不得落到「其他」", () => {
    // 修前红：x.ts 图标 = code（代码文件），预览却 = other（其他）——「图标对、行为错」。
    for (const ext of extMatrix) {
      const iconKind = assetFileKindOf("x." + ext);
      expect(iconKind, ext).not.toBe("file");
      expect(fileKindOf("x." + ext), ext).not.toBe("other");
    }
    // 具体分歧点的定点断言
    expect(assetFileKindOf("x.ts")).toBe("code");
    expect(fileKindOf("x.ts")).toBe("document");
    expect(fileKindOf("x.docx")).toBe("document"); // doc → document（同类型、不同桶名）
  });

  it("未知 / 无扩展名 / 空串：图标 file ⇔ 预览 other", () => {
    for (const name of ["x.qqq", "README", "", "x.", "【未命名】"]) {
      expect(assetFileKindOf(name), name).toBe("file");
      expect(fileKindOf(name), name).toBe("other");
    }
  });

  it("大小写 / 带点 / URL 末段同口径（调用点传 name || src）", () => {
    expect(fileKindOf("A.PNG")).toBe("image");
    expect(fileKindOf(".PDF")).toBe("pdf");
    expect(fileKindOf("http://127.0.0.1:19876/note-assets/n/1789800370840_0eff2c68.ts")).toBe("document");
    expect(fileKindOf("http://127.0.0.1:19876/note-assets/n/1789800370840_0eff2c68.mp4")).toBe("video");
  });
});
