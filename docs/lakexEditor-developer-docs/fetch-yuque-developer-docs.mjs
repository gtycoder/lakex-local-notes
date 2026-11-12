/**
 * 抓取语雀开发者文档（book: yuque/developer）为本地 Markdown 资料库。
 * 机制：页面内嵌 appData 含完整 toc（URL 编码 JSON）→ 逐篇用 /markdown?plain=true 导出。
 * 仅本地参考，勿提交进 git（第三方版权文档）。
 */
import fs from "node:fs";
import path from "node:path";

// 输出到仓外同级目录（第三方文档不进仓库）；可用 YUQUE_DOCS_OUT 覆盖。
const OUT = process.env.YUQUE_DOCS_OUT ?? path.resolve(import.meta.dirname, "../../../yuque-developer-docs");
const BOOK = "https://www.yuque.com/yuque/developer";
const SEED = BOOK + "/api";
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36";
const SLEEP = 260;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function get(url) {
  const res = await fetch(url, { headers: { "user-agent": UA, accept: "text/html,text/plain,text/markdown,*/*" } });
  if (!res.ok) throw new Error(url + " -> HTTP " + res.status);
  return await res.text();
}

function decodeAppData(html) {
  const key = "%7B%22id%22%3A75338";
  const start = html.indexOf(key);
  if (start < 0) throw new Error("appData not found");
  const ok = (c) => /[A-Za-z0-9%_.!~*'()\-]/.test(c);
  let a = start, b = start;
  while (a > 0 && ok(html[a - 1])) a--;
  while (b < html.length && ok(html[b])) b++;
  return JSON.parse(decodeURIComponent(html.slice(a, b)));
}

function sanitize(name) {
  return String(name).replace(/[\/:*?"<>|]/g, "_").replace(/\s+/g, " ").trim().slice(0, 80);
}

const html = await get(SEED);
const app = decodeAppData(html);
const book = app.book || app;
fs.mkdirSync(path.join(OUT, "docs"), { recursive: true });
fs.writeFileSync(path.join(OUT, "toc.json"), JSON.stringify(book.toc, null, 1));

// 顺序遍历 toc，TITLE 作为分节
const docs = [];
const sections = [];
let order = 0;
function walk(nodes, sec) {
  for (const n of nodes || []) {
    if (n.type === "TITLE") { walk(n.children, [...sec, n.title]); continue; }
    if (n.type === "DOC") {
      docs.push({ order: ++order, sec, title: n.title, slug: n.url, uuid: n.uuid });
      walk(n.children, sec);
    }
  }
}
walk(book.toc, []);
console.log("DOC count:", docs.length);

const index = [];
let ok = 0, fail = 0;
for (const d of docs) {
  const secPart = d.sec.length ? d.sec.join(" - ") + " - " : "";
  const base = String(d.order).padStart(2, "0") + " - " + sanitize(secPart + d.title) + " [" + d.slug + "]";
  const mdUrl = BOOK + "/" + d.slug + "/markdown?plain=true&linebreak=false&anchor=false";
  const srcUrl = BOOK + "/" + d.slug;
  try {
    const md = await get(mdUrl);
    const header = "> 来源: " + srcUrl + "\n> 抓取: " + new Date().toISOString().slice(0, 10) + " · 语雀开发者文档（本地参考副本，勿再分发）\n\n---\n\n";
    fs.writeFileSync(path.join(OUT, "docs", base + ".md"), header + md);
    index.push({ order: d.order, sec: d.sec, title: d.title, slug: d.slug, file: "docs/" + base + ".md", bytes: md.length });
    ok++;
    process.stdout.write(".");
  } catch (e) {
    fail++;
    process.stdout.write("x");
    index.push({ order: d.order, sec: d.sec, title: d.title, slug: d.slug, error: String(e.message) });
  }
  await sleep(SLEEP);
}
console.log("\nok:", ok, "fail:", fail);
fs.writeFileSync(path.join(OUT, "index.json"), JSON.stringify(index, null, 1));

const lines = [
  "# 语雀开发者文档（本地参考副本）",
  "",
  "> 来源: " + BOOK + " · 抓取日期: " + new Date().toISOString().slice(0, 10),
  "> 仅本地参考，**勿提交/再分发**（第三方版权文档）。正文由语雀自带 Markdown 导出获得。",
  "",
  "| # | 分节 | 标题 | 本地文件 | 原文 |",
  "|---|---|---|---|---|",
  ...index.map((x) => "| " + x.order + " | " + (x.sec.join(" / ") || "-") + " | " + x.title + " | " + (x.file ? "[" + x.file.replace("docs/", "") + "](" + x.file + ")" : "（抓取失败）") + " | [原](https://www.yuque.com/yuque/developer/" + x.slug + ") |"),
  "",
];
fs.writeFileSync(path.join(OUT, "README.md"), lines.join("\n"));
console.log("index written:", index.length);
