/**
 * 小记卡片预览解析器（零内核）的回归。fixture 全部取自**真实内核输出**（260919 采样），
 * 这样内核方言变了、或我们误加白名单外的格式，测试会先报出来。
 */
import { describe, expect, it } from "vitest";
import { parseQuickNotePreview, parsePreviewRuns, toggleTaskInBody } from "./quickNotePreviewParser";

describe("小记预览解析（白名单块）", () => {
  it("段落与标题", () => {
    const nodes = parseQuickNotePreview(
      `<p data-lake-id="a" id="a" class="ne-p"><span data-lake-id="b" id="b">普通段落</span></p>`
      + `<h1 data-lake-id="c" id="c"><span data-lake-id="d" id="d">标题行</span></h1>`,
    );
    expect(nodes).toEqual([
      { kind: "paragraph", runs: [{ text: "普通段落" }] },
      { kind: "heading", level: 1, runs: [{ text: "标题行" }] },
    ]);
  });

  it("无序/有序列表（真实内核标记）", () => {
    const ul = `<ul list="uc020389f"><li fid="u2d32d06c" data-lake-id="uf74b4c47" id="uf74b4c47"><span data-lake-id="u88174976" id="u88174976">无序项</span></li></ul>`;
    const ol = `<ol list="ubccfa543"><li fid="u2d32d06c" data-lake-id="ude138a9c" id="ude138a9c"><span data-lake-id="u0837082c" id="u0837082c">有序项</span></li></ol>`;
    expect(parseQuickNotePreview(ul)).toEqual([
      { kind: "list", ordered: false, depth: 0, items: [{ runs: [{ text: "无序项" }], task: false, checked: false }] },
    ]);
    expect(parseQuickNotePreview(ol)).toEqual([
      { kind: "list", ordered: true, depth: 0, items: [{ runs: [{ text: "有序项" }], task: false, checked: false }] },
    ]);
  });

  it("待办：checkbox 卡 → task+checked，且不在文本里留痕", () => {
    const task = (state: string, text: string) =>
      `<ul list="ua5ce7fa1" class="lake-list"><li fid="u2d32d06c" data-lake-id="u61b54cd0" id="u61b54cd0" class="lake-list-node lake-list-task"><card type="inline" name="checkbox" value="data:${state}"></card><span data-lake-id="u3a5d9e09" id="u3a5d9e09">${text}</span></li></ul>`;
    expect(parseQuickNotePreview(task("false", "待办项"))).toEqual([
      { kind: "list", ordered: false, depth: 0, items: [{ runs: [{ text: "待办项" }], task: true, checked: false, checkboxIndex: 0 }] },
    ]);
    expect(parseQuickNotePreview(task("true", "已完成"))).toEqual([
      { kind: "list", ordered: false, depth: 0, items: [{ runs: [{ text: "已完成" }], task: true, checked: true, checkboxIndex: 0 }] },
    ]);
  });

  it("引用（blockquote 里仍是块）与分割线（块卡 hr）", () => {
    const quote = `<blockquote data-lake-id="ued5abf7c" id="ued5abf7c"><p data-lake-id="x" id="x"><span>引用项</span></p></blockquote>`;
    expect(parseQuickNotePreview(quote)).toEqual([
      { kind: "quote", nodes: [{ kind: "paragraph", runs: [{ text: "引用项" }] }] },
    ]);
    const hr = `<card type="block" name="hr" value="data:%7B%22id%22%3A%22BtU4L%22%7D"></card>`;
    expect(parseQuickNotePreview(hr)).toEqual([{ kind: "divider" }]);
  });

  it("媒体卡（图片/附件）→ media 节点，带文件名用于匹配资源", () => {
    const image = `<p data-lake-id="p" id="p"><card type="inline" name="image" value="data:${encodeURIComponent(JSON.stringify({ src: "http://127.0.0.1:19876/quick-notes/abc/1789_aaa.png" }))}"></card></p>`;
    expect(parseQuickNotePreview(image)).toEqual([
      { kind: "media", cardName: "image", filename: "1789_aaa.png", label: null },
    ]);
    const file = `<card type="inline" name="file" value="data:${encodeURIComponent(JSON.stringify({ src: "http://127.0.0.1:19876/quick-notes/abc/1789_bbb.pdf" }))}"></card>`;
    expect(parseQuickNotePreview(file)).toEqual([
      { kind: "media", cardName: "file", filename: "1789_bbb.pdf", label: null },
    ]);
  });

  it("视频卡用 url、音频卡用 audioId（真实内核字段名不同，只读 src 会让整卡显示「资源缺失」）", () => {
    // 真实采样：video 块卡 {status,name,url,…}；audio 卡 {status,audioId,fileName,fileSize,…}
    const video = `<card type="block" name="video" value="data:${encodeURIComponent(JSON.stringify({ status: "uploaded", name: "viaCommand.mp4", url: "http://127.0.0.1:19876/quick-notes/abc/1789800324039_669d327b.mp4" }))}"></card>`;
    expect(parseQuickNotePreview(video)).toEqual([
      { kind: "media", cardName: "video", filename: "1789800324039_669d327b.mp4", label: "viaCommand.mp4" },
    ]);
    const audio = `<card type="inline" name="audio" value="data:${encodeURIComponent(JSON.stringify({ status: "transcoded", audioId: "http://127.0.0.1:19876/quick-notes/abc/1789800348953_835be104.mp3", fileName: "probe2.mp3", fileSize: 8586 }))}"></card>`;
    expect(parseQuickNotePreview(audio)).toEqual([
      { kind: "media", cardName: "audio", filename: "1789800348953_835be104.mp3", label: "probe2.mp3" },
    ]);
    // 附件卡带原始展示名（磁盘名在 src 里）：文件条显示 name，匹配资源仍用 src 末段
    const pdf = `<card type="inline" name="file" value="data:${encodeURIComponent(JSON.stringify({ src: "http://127.0.0.1:19876/quick-notes/abc/1789800370840_0eff2c68.pdf", name: "报告.pdf", ext: "pdf" }))}"></card>`;
    expect(parseQuickNotePreview(pdf)).toEqual([
      { kind: "media", cardName: "file", filename: "1789800370840_0eff2c68.pdf", label: "报告.pdf" },
    ]);
  });

  it("段落里文字与行内卡混排：按出现顺序拆开，卡片不再被整段丢掉", () => {
    // 真实采样：「先打字再点图片/附件」的内核正文就是这个形状（卡插进当前段落）
    const card = (name: string, file: string) => `<card type="inline" name="${name}" value="data:${encodeURIComponent(JSON.stringify({ src: `http://127.0.0.1:19876/quick-notes/abc/${file}` }))}"></card>`;
    const body = `<p data-lake-id="p" id="p"><span>附件展示验证</span>${card("image", "1789_img.png")}${card("file", "1789_doc.pdf")}</p>`
      + `<p data-lake-id="q" id="q">${card("image", "1789_only.png")}</p>`;
    expect(parseQuickNotePreview(body)).toEqual([
      { kind: "paragraph", runs: [{ text: "附件展示验证" }] },
      { kind: "media", cardName: "image", filename: "1789_img.png", label: null },
      { kind: "media", cardName: "file", filename: "1789_doc.pdf", label: null },
      { kind: "media", cardName: "image", filename: "1789_only.png", label: null },
    ]);
  });

  it("行内标记：加粗/斜体/下划线/行内代码/链接", () => {
    expect(parsePreviewRuns(`<strong><span>加粗</span></strong>普通<em>斜</em>`)).toEqual([
      { text: "加粗", bold: true },
      { text: "普通" },
      { text: "斜", italic: true },
    ]);
    expect(parsePreviewRuns(`<u>下划线</u><code>code</code>`)).toEqual([
      { text: "下划线", underline: true },
      { text: "code", code: true },
    ]);
    expect(parsePreviewRuns(`<a href="https://example.com">链接</a>`)).toEqual([
      { text: "链接", link: "https://example.com" },
    ]);
  });

  it("白名单外的块 → 占位（不改写原文，也不吞掉后续内容）", () => {
    const body = `<table data-lake-id="t" id="t"><tr><td>表格</td></tr></table>`
      + `<card type="block" name="codeblock" value="data:x"></card>`
      + `<p data-lake-id="p" id="p"><span>后面的段落</span></p>`;
    expect(parseQuickNotePreview(body)).toEqual([
      { kind: "unsupported", label: "table" },
      { kind: "unsupported", label: "codeblock" },
      { kind: "paragraph", runs: [{ text: "后面的段落" }] },
    ]);
  });

  it("展开态工具栏的样式：删除线 / 字号 / 颜色 / 背景 / 对齐 / 行高 / 缩进（真实内核标记）", () => {
    // 删除线
    expect(parsePreviewRuns(`<del><span data-lake-id="a" id="a">样式A</span></del>`)).toEqual([
      { text: "样式A", strike: true },
    ]);
    // 字号（class）+ 颜色/背景（style 在同层 span 上）
    expect(parsePreviewRuns(`<span data-lake-id="b" id="b" class="lake-fontsize-18">字号</span>`)).toEqual([
      { text: "字号", fontSize: 18 },
    ]);
    expect(parsePreviewRuns(`<span data-lake-id="c" id="c" style="color: #FF0000">颜色</span>`)).toEqual([
      { text: "颜色", color: "#FF0000" },
    ]);
    expect(parsePreviewRuns(`<span data-lake-id="d" id="d" style="background-color: #FFFF00">背景</span>`)).toEqual([
      { text: "背景", background: "#FFFF00" },
    ]);
    // 嵌套：字号里套颜色 ⇒ 两者都要保留
    expect(parsePreviewRuns(`<span class="lake-fontsize-22"><span style="color: #1890FF">两样</span></span>`)).toEqual([
      { text: "两样", fontSize: 22, color: "#1890FF" },
    ]);
    // 段级：对齐 + 行高
    expect(parseQuickNotePreview(`<p data-lake-id="e" id="e" class="lake-lineheight-2" style="text-align: center"><span>行高</span></p>`)).toEqual([
      { kind: "paragraph", runs: [{ text: "行高" }], align: "center", lineHeight: 2 },
    ]);
    // 列表项也能带段级样式；缩进层级来自 `<ul data-lake-indent="1">`
    expect(parseQuickNotePreview(`<ul list="u1" data-lake-indent="1" class="lake-list"><li fid="u2" data-lake-id="f" id="f" class="lake-lineheight-2" style="text-align: center"><span>缩进项</span></li></ul>`)).toEqual([
      { kind: "list", ordered: false, depth: 1, items: [{ runs: [{ text: "缩进项" }], task: false, checked: false, align: "center", lineHeight: 2 }] },
    ]);
  });

  it("待办勾选：按序号翻转 checkbox 值（toggleTaskInBody 纯函数）", () => {
    const cb = (state: string) => `<card type="inline" name="checkbox" value="data:${state}"></card>`;
    const body = `<ul class="lake-list"><li class="lake-list-node lake-list-task">${cb("false")}<span>甲</span></li><li class="lake-list-node lake-list-task">${cb("false")}<span>乙</span></li></ul>`;
    const one = toggleTaskInBody(body, 1, true);
    expect(one).toContain('value="data:true"');
    expect((one.match(/data:false/g) || []).length).toBe(1);
    // 只动指定序号那一个
    expect(one.indexOf('data:true')).toBeGreaterThan(one.indexOf("乙</span>") - 200);
    expect(toggleTaskInBody(one, 1, false)).toBe(body);
    expect(toggleTaskInBody(body, 9, true)).toBe(body);
  });

  it("空/异常输入不抛错", () => {
    expect(parseQuickNotePreview("")).toEqual([]);
    expect(parseQuickNotePreview("<p>未闭合").length).toBeLessThanOrEqual(1);
    expect(parseQuickNotePreview("<").length).toBeLessThanOrEqual(1);
  });
});
