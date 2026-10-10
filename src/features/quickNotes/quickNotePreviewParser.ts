/**
 * 小记**卡片预览**的**快路径**解析器（261010 定稿：快路径 + 内核只读兜底）。
 *
 * 分工：小记的**存储**永远由内核产出（编辑态挂内核 ⇒ `.qnote.body` 是标准 lake 标记）；
 * **时间线卡片**默认走这里（零内核实例、零 per-card 代价），把常见块翻译成轻量节点交给 React 画：
 *   段落 / 标题 H1–H6 / 无序列表 / 有序列表 / 待办（勾选框）/ 引用 / 分割线 /
 *   加粗·斜体·下划线·行内代码·链接 / 图片·附件（视频音频同属附件卡）
 *
 * **还原不了的块**（表格、代码块、公式、画板、思维导图、日历、日期、表情…）在这里降级为 `unsupported` 节点 ——
 * 它不再是"占位显示"，而是**切换渲染器的信号**：`QuickNotePreview` 见到它就整条卡片改挂**内核只读视图**
 * （`QuickNoteKernelPreview`）。⇒ 格式覆盖度由内核保证，这里只需覆盖常见块。只读展示，绝不改写原文。
 *
 * 实测标记形态（真实内核输出，260919 采样）：
 *   <h1 data-lake-id id><span …>标题</span></h1>
 *   <ul list="u…"><li fid data-lake-id id><span …>无序项</span></li></ul>
 *   <ol list="u…"><li …>有序项</li></ol>
 *   <ul list="u…" class="lake-list"><li … class="lake-list-node lake-list-task">
 *     <card type="inline" name="checkbox" value="data:false"></card><span …>待办</span></li></ul>
 *   <blockquote data-lake-id id>…（里面仍是 p/ul/ol）…</blockquote>
 *   <card type="block" name="hr" value="data:%7B%22id%22%3A%22…%22%7D"></card>
 *   <card type="inline" name="image" value="data:%7B%22src%22%3A%22…%2F1789…png%22…%7D"></card>
 */

export interface PreviewRun {
  text: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  code?: boolean;
  link?: string;
  /** 字号（px）：内核写成 `class="lake-fontsize-N"`。 */
  fontSize?: number;
  color?: string;
  background?: string;
}

export interface PreviewListItem {
  runs: PreviewRun[];
  /** 待办项（内核 `<li class="…lake-list-task">` + checkbox 卡）。 */
  task: boolean;
  checked: boolean;
  /** 该待办 checkbox 卡在正文里的**序号**（0 基，按出现顺序）—— 预览里点击勾选时用它精确改写正文。 */
  checkboxIndex?: number;
  /** 段落级样式（内核把 text-align / lake-lineheight-N 写在 `li` 上）。 */
  align?: TextAlign;
  lineHeight?: number;
}

export type TextAlign = "left" | "center" | "right" | "justify";

export type QuickNotePreviewNode =
  | { kind: "paragraph"; runs: PreviewRun[]; align?: TextAlign; lineHeight?: number }
  | { kind: "heading"; level: number; runs: PreviewRun[]; align?: TextAlign; lineHeight?: number }
  | { kind: "list"; ordered: boolean; items: PreviewListItem[]; depth: number }
  | { kind: "quote"; nodes: QuickNotePreviewNode[] }
  | { kind: "divider" }
  /**
   * 媒体卡：`filename`（= URL 末段，磁盘文件名）用于在资源清单里找到对应资源，
   * `label` 是卡片自带的**原始展示名**（附件卡的 `name` / 音频卡的 `fileName`），取不到时回落资源名。
   */
  | { kind: "media"; cardName: string; filename: string | null; label: string | null }
  /**
   * 快路径**还原不了**的块（表格/代码块/公式/画板/思维导图/日历/日期/表情…）。
   *
   * 它不再是"占位显示"，而是**切换渲染器的信号**：出现任意一个 ⇒ 整条卡片改由内核只读视图渲染
   * （见 quickNoteKernelPreview / hasUnsupportedNodes）。渲染层仍保留了兜底文案，防止未知环境漏渲染。
   */
  | { kind: "unsupported"; label: string };

/**
 * 快路径能否还原这段正文的**唯一判据**：有没有出现 `unsupported` 节点。
 *
 * 判据直接取解析器自己的输出（不再维护第二份"内核卡片白名单"）—— 两份清单必然漂移，
 * 而这里只要解析器认不出来，就交给内核，**永远不会出现"显示不出来"的格式**。
 */
export function hasUnsupportedNodes(nodes: QuickNotePreviewNode[]): boolean {
  return nodes.some((node) => node.kind === "unsupported" || (node.kind === "quote" && hasUnsupportedNodes(node.nodes)));
}

const BLOCK_TAGS = new Set(["p", "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "blockquote"]);
const MEDIA_CARD_NAMES = new Set(["image", "video", "audio", "file", "localdoc"]);
const ALIGN_VALUES = new Set<string>(["left", "center", "right", "justify"]);

/** 找 `<tag …>` 的配对结束位置（返回 `</tag>` 之后的索引；未闭合返回 null）。 */
function findClose(html: string, start: number, tag: string): number | null {
  const openRe = new RegExp(`<${tag}(?=[\\s/>])`, "gi");
  const closeRe = new RegExp(`</${tag}\\s*>`, "gi");
  let depth = 0;
  let i = start;
  while (i < html.length) {
    openRe.lastIndex = i;
    closeRe.lastIndex = i;
    const open = openRe.exec(html);
    const close = closeRe.exec(html);
    if (!close) return null;
    if (open && open.index < close.index) {
      depth += 1;
      i = open.index + open[0].length;
      continue;
    }
    depth -= 1;
    i = close.index + close[0].length;
    if (depth <= 0) return i;
  }
  return null;
}

/** 取开始标签的属性串与结束位置（`<tag …>`）。 */
function readOpenTag(html: string, start: number): { attrs: string; end: number } | null {
  const gt = html.indexOf(">", start);
  if (gt < 0) return null;
  const open = html.slice(start, gt + 1);
  const m = /^<[a-zA-Z0-9-]+([\s\S]*?)\/?>$/.exec(open);
  return { attrs: m ? m[1] : "", end: gt + 1 };
}

function attr(attrs: string, name: string): string | null {
  const m = new RegExp(`${name}\\s*=\\s*"([^"]*)"`, "i").exec(attrs);
  return m ? m[1] : null;
}

function decodeEntities(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

/** 卡片 value → 结构化字段（`data:` + encodeURIComponent(JSON)，也可能直接是 JSON）。 */
function decodeCardValue(value: string | null): Record<string, unknown> | null {
  if (!value) return null;
  let raw = value;
  if (raw.startsWith("data:")) raw = raw.slice("data:".length);
  try {
    const json = raw.startsWith("{") ? raw : decodeURIComponent(raw);
    const parsed = JSON.parse(json) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function basename(url: unknown): string | null {
  if (typeof url !== "string" || !url) return null;
  const clean = decodeURIComponent(url.split("?")[0]);
  const name = clean.split("/").pop() ?? "";
  return name || null;
}

/** 段落级样式：内核把对齐写在 `style="text-align: center"`、行高写成 `class="lake-lineheight-N"`。 */
export function readBlockStyle(attrs: string): { align?: TextAlign; lineHeight?: number } {
  const style = attr(attrs, "style") ?? "";
  const cls = attr(attrs, "class") ?? "";
  const alignMatch = /text-align\s*:\s*([a-z]+)/i.exec(style);
  const align = alignMatch && ALIGN_VALUES.has(alignMatch[1].toLowerCase()) ? (alignMatch[1].toLowerCase() as TextAlign) : undefined;
  const lineMatch = /lake-lineheight-(\d+(?:\.\d+)?)/.exec(cls);
  const lineHeight = lineMatch ? Number(lineMatch[1]) : undefined;
  return { ...(align ? { align } : {}), ...(lineHeight ? { lineHeight } : {}) };
}

/** 行内样式：`<span class="lake-fontsize-N">` / `style="color: …;background-color: …"`。 */
function readSpanStyle(attrs: string): { fontSize?: number; color?: string; background?: string } {
  const style = attr(attrs, "style") ?? "";
  const cls = attr(attrs, "class") ?? "";
  const out: { fontSize?: number; color?: string; background?: string } = {};
  const sizeMatch = /lake-fontsize-(\d+)/.exec(cls);
  if (sizeMatch) out.fontSize = Number(sizeMatch[1]);
  const colorMatch = /(?:^|;)\s*color\s*:\s*([^;]+)/i.exec(style);
  if (colorMatch) out.color = colorMatch[1].trim();
  const bgMatch = /background-color\s*:\s*([^;]+)/i.exec(style);
  if (bgMatch) out.background = bgMatch[1].trim();
  return out;
}

/** 行内标记 → runs（白名单：加粗/斜体/下划线/行内代码/链接；其余标签透明处理）。 */
export function parsePreviewRuns(html: string): PreviewRun[] {
  const runs: PreviewRun[] = [];
  const state = { bold: 0, italic: 0, underline: 0, code: 0, strike: 0, link: null as string | null };
  /** `<span>` 承载字号/颜色/背景（可嵌套：字号里套颜色）；合并时后者覆盖前者。 */
  const spanStack: Array<{ fontSize?: number; color?: string; background?: string }> = [];
  let text = "";
  const flush = () => {
    if (!text) return;
    const run: PreviewRun = { text: decodeEntities(text) };
    if (state.bold) run.bold = true;
    if (state.italic) run.italic = true;
    if (state.underline) run.underline = true;
    if (state.strike) run.strike = true;
    if (state.code) run.code = true;
    if (state.link) run.link = state.link;
    for (const span of spanStack) {
      if (span.fontSize) run.fontSize = span.fontSize;
      if (span.color) run.color = span.color;
      if (span.background) run.background = span.background;
    }
    runs.push(run);
    text = "";
  };
  let i = 0;
  while (i < html.length) {
    const lt = html.indexOf("<", i);
    if (lt < 0) { text += html.slice(i); break; }
    text += html.slice(i, lt);
    const m = /^<(\/?)([a-zA-Z0-9-]+)([^>]*)>/.exec(html.slice(lt, lt + 400));
    if (!m) { text += html[lt]; i = lt + 1; continue; }
    const closing = m[1] === "/";
    const tag = m[2].toLowerCase();
    const attrs = m[3] ?? "";
    const step = lt + m[0].length;
    if (!closing && tag === "br") { flush(); runs.push({ text: "\n" }); i = step; continue; }
    const bump = (key: "bold" | "italic" | "underline" | "code" | "strike", delta: number) => {
      flush();
      state[key] = Math.max(0, state[key] + delta);
    };
    if (tag === "strong" || tag === "b") bump("bold", closing ? -1 : 1);
    else if (tag === "em" || tag === "i") bump("italic", closing ? -1 : 1);
    else if (tag === "u") bump("underline", closing ? -1 : 1);
    else if (tag === "del" || tag === "s" || tag === "strike") bump("strike", closing ? -1 : 1);
    else if (tag === "code") bump("code", closing ? -1 : 1);
    else if (tag === "a") {
      flush();
      state.link = closing ? null : attr(attrs, "href");
    }
    else if (tag === "span") {
      flush();
      if (closing) spanStack.pop();
      else spanStack.push(readSpanStyle(attrs));
    }
    // 其余标签（card/…）透明：文本照收，格式不动
    i = step;
  }
  flush();
  return runs;
}

function parseListItems(html: string, state: { checkbox: number }): PreviewListItem[] {
  const items: PreviewListItem[] = [];
  let i = 0;
  const lower = html.toLowerCase();
  while (i < html.length) {
    const lt = lower.indexOf("<li", i);
    if (lt < 0) break;
    const open = readOpenTag(html, lt);
    if (!open) break;
    const close = findClose(html, lt, "li");
    if (close == null) break;
    const inner = html.slice(open.end, close).replace(/<\/li\s*>$/i, "");
    const task = /lake-list-task/.test(attr(open.attrs, "class") ?? "");
    // 待办勾选状态在内嵌的 checkbox 卡里（`value="data:true|false"`）
    const checkbox = /<card[^>]*name="checkbox"[^>]*value="([^"]*)"/i.exec(inner);
    const checked = checkbox ? /true/i.test(checkbox[1]) : false;
    const withoutCheckbox = inner.replace(/<card[^>]*name="checkbox"[^>]*>\s*<\/card>/gi, "");
    const item: PreviewListItem = { runs: parsePreviewRuns(withoutCheckbox), task, checked, ...readBlockStyle(open.attrs) };
    if (task) { item.checkboxIndex = state.checkbox; state.checkbox += 1; }
    items.push(item);
    i = close;
  }
  return items;
}

function parseCardNode(attrs: string): QuickNotePreviewNode[] {
  const name = (attr(attrs, "name") ?? "").toLowerCase();
  const value = decodeCardValue(attr(attrs, "value"));
  if (name === "hr") return [{ kind: "divider" }];
  if (MEDIA_CARD_NAMES.has(name)) {
    // 资源 URL 的字段名**按卡类型不同**（260920 用真实内核输出采样核对）：
    //   图片 / 附件卡 → `src`；视频块卡 → `url`；音频卡 → `audioId`（= canonical URL）。
    // 之前只读 `src` ⇒ 视频/音频卡解析不出文件名，卡片预览一律显示「附件（资源缺失）」。
    const url = value?.src ?? value?.url ?? value?.audioId;
    // 展示名同理：附件卡 `name`（"报告.pdf"）、音频卡 `fileName`；图片卡没有原始名（只有磁盘名）。
    const label = value?.name ?? value?.fileName;
    return [{
      kind: "media",
      cardName: name,
      filename: basename(url),
      label: typeof label === "string" && label ? label : null,
    }];
  }
  return [{ kind: "unsupported", label: name || "card" }];
}

/**
 * 把段落内的行内卡按顺序切开：`[{ text }, { card: 属性串 }, { text }…]`。
 *
 * 为什么需要（260920 用户报「已保存小记的附件卡片展示不对」的真因之一）：行内媒体卡（图片/附件）
 * 是插进**当前段落**的，所以「先打字再点图片」的正文是 `<p><span>文字</span><card image></card></p>`。
 * 旧实现要求段落里"只有一张卡"才当媒体渲染，混合段落直接按纯文本处理 ⇒ 卡片被静默丢掉
 * （真实数据里一条小记的图片/附件因此整段消失）。这里改成按卡切开、文字与媒体各自成节点。
 */
function splitParagraphCards(html: string): Array<{ text: string } | { card: string }> {
  const parts: Array<{ text: string } | { card: string }> = [];
  let cursor = 0;
  while (cursor < html.length) {
    const lt = html.toLowerCase().indexOf("<card", cursor);
    if (lt < 0) break;
    const open = readOpenTag(html, lt);
    if (!open) break;
    if (lt > cursor) parts.push({ text: html.slice(cursor, lt) });
    parts.push({ card: open.attrs });
    cursor = findClose(html, lt, "card") ?? open.end;
  }
  if (cursor < html.length) parts.push({ text: html.slice(cursor) });
  return parts;
}

/** 解析小记正文 → 预览节点（宽容：不认识的一律降级为占位，绝不抛错）。 */
/**
 * 预览里勾选/取消待办：按序号把正文里第 N 个 checkbox 卡的 `value` 在 `data:true|false` 之间翻转。
 * 纯字符串改写（只动那一个卡片值），用于「点一下卡片预览里的复选框就完成待办」。
 */
export function toggleTaskInBody(body: string, checkboxIndex: number, checked: boolean): string {
  if (!body || typeof body !== "string") return body;
  let seen = -1;
  return body.replace(/<card\b[^>]*name="checkbox"[^>]*value="(data:(?:true|false))"[^>]*>/gi, (match, value: string) => {
    seen += 1;
    if (seen !== checkboxIndex) return match;
    return match.replace(value, `data:${checked ? "true" : "false"}`);
  });
}

export function parseQuickNotePreview(body: string, state: { checkbox: number } = { checkbox: 0 }): QuickNotePreviewNode[] {
  if (!body || typeof body !== "string") return [];
  const nodes: QuickNotePreviewNode[] = [];
  let i = 0;
  while (i < body.length) {
    const lt = body.indexOf("<", i);
    if (lt < 0) break;
    const m = /^<([a-zA-Z0-9-]+)/.exec(body.slice(lt, lt + 60));
    if (!m) { i = lt + 1; continue; }
    const tag = m[1].toLowerCase();
    if (tag === "card") {
      const open = readOpenTag(body, lt);
      const close = findClose(body, lt, "card");
      if (!open) { i = lt + 1; continue; }
      nodes.push(...parseCardNode(open.attrs));
      i = close ?? open.end;
      continue;
    }
    if (BLOCK_TAGS.has(tag)) {
      const open = readOpenTag(body, lt);
      const close = findClose(body, lt, tag);
      if (!open) { i = lt + 1; continue; }
      const inner = body.slice(open.end, close == null ? body.length : close - `</${tag}>`.length);
      if (tag === "ul" || tag === "ol") {
        // 缩进层级挂在列表容器上（`<ul data-lake-indent="1">`），实时内核 DOM 用的是项自身的 ne-level。
        const indentAttr = attr(open.attrs, "data-lake-indent") ?? attr(open.attrs, "level");
        const depth = indentAttr && Number.isFinite(Number(indentAttr)) ? Number(indentAttr) : 0;
        nodes.push({ kind: "list", ordered: tag === "ol", items: parseListItems(inner, state), depth });
      } else if (tag === "blockquote") {
        nodes.push({ kind: "quote", nodes: parseQuickNotePreview(inner, state) });
      } else if (tag.length === 2 && tag.startsWith("h")) {
        const runs = parsePreviewRuns(inner);
        if (runs.some((run) => run.text.trim())) nodes.push({ kind: "heading", level: Number(tag[1]), runs, ...readBlockStyle(open.attrs) });
      } else {
        // 段落：文字与行内媒体卡混排时**按出现顺序拆成多个节点**（旧实现只认"整段只有一张卡"，混排时卡片被丢）
        for (const part of splitParagraphCards(inner)) {
          if ("card" in part) { nodes.push(...parseCardNode(part.card)); continue; }
          const runs = parsePreviewRuns(part.text);
          if (runs.some((run) => run.text.trim())) nodes.push({ kind: "paragraph", runs, ...readBlockStyle(open.attrs) });
        }
      }
      i = close ?? body.length;
      continue;
    }
    // 白名单外的块（table / pre / ne-card-root / div …）
    const open = readOpenTag(body, lt);
    const close = findClose(body, lt, tag);
    nodes.push({ kind: "unsupported", label: tag });
    i = close ?? (open?.end ?? lt + 1);
  }
  return nodes;
}
