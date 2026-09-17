import { describe, expect, it } from "vitest";
import {
  buildLakeImageCardValue,
  emptyLakeBody,
  escapeLakeHtml,
  lakeEmptyParagraph,
  lakeImageCardParagraph,
  lakeTextParagraph,
  WELCOME_NOTE_BODY,
} from "./lakeDocForm";

describe("Lake 正文写入形态（单一来源）", () => {
  it("空文档正文：纯文本级、带 noteId 标识", () => {
    expect(emptyLakeBody("abc")).toBe('<p id="abc-body" class="ne-p"><br></p>');
  });

  it("欢迎笔记正文固定不变（全设备一致）", () => {
    expect(WELCOME_NOTE_BODY).toContain('<h1 id="welcome" class="ne-h1">');
    expect(WELCOME_NOTE_BODY).toContain('<p id="welcome-body" class="ne-p">');
  });

  it("段落：含 data-lake-id / id / 内层 span，且文本按 Lake 规则转义", () => {
    expect(lakeTextParagraph("p1", "t1", 'a<b>&"c')).toBe(
      '<p data-lake-id="p1" id="p1" class="ne-p"><span data-lake-id="t1" id="t1">a&lt;b&gt;&amp;&quot;c</span></p>',
    );
    expect(lakeEmptyParagraph("p2")).toBe('<p data-lake-id="p2" id="p2" class="ne-p"><br /></p>');
    expect(escapeLakeHtml("&")).toBe("&amp;");
  });

  it("图片卡片：容器必须是 <card>，**绝不能是裸 <img>**（260917 的事故根因）", () => {
    const value = buildLakeImageCardValue({
      src: "http://127.0.0.1:19876/n1/a.png",
      cardId: "ucard",
      taskId: "utask",
      clientId: "n1",
      name: "a.png",
      size: 123,
      from: "quick-note",
      originWidth: 100,
      originHeight: 50,
    });
    const para = lakeImageCardParagraph("p3", value);
    expect(para).toContain('<card type="inline" name="image" value="data:');
    expect(para).not.toContain("<img");
    // value 可被无损还原，且关键字段齐备
    const encoded = para.slice(para.indexOf("data:") + 5, para.indexOf('"></card>'));
    const decoded = JSON.parse(decodeURIComponent(encoded)) as Record<string, unknown>;
    expect(decoded.src).toBe("http://127.0.0.1:19876/n1/a.png");
    expect(decoded.status).toBe("done");
    expect(decoded.ratio).toBe(1);
    expect(decoded.from).toBe("quick-note");
    // 尺寸未知时**序列化后**省略字段（JSON.stringify 丢 undefined），避免写进无意义的 null
    const noSize = JSON.parse(JSON.stringify(buildLakeImageCardValue({
      src: "s", cardId: "c", taskId: "t", clientId: "n", name: "f", size: 1,
    }))) as Record<string, unknown>;
    expect(Object.keys(noSize)).not.toContain("originWidth");
    expect(Object.keys(noSize)).not.toContain("from");
    // 字段**顺序**锁：与既有小记转换产物逐字节一致（换序 = 全库正文形态漂移，必须显式改这里）
    expect(Object.keys(decoded)).toEqual([
      "src", "taskId", "clientId", "originalType", "linkTarget", "name", "size", "from",
      "originWidth", "originHeight", "ratio", "status", "style", "showTitle", "title",
      "rotation", "crop", "id", "margin",
    ]);
  });
});
