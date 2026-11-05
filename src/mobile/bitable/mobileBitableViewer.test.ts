import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MobileBitableViewer } from "./MobileBitableViewer";

const ts = "2026-09-01T00:00:00.000Z";
const body = JSON.stringify({
  kind: "bitable",
  version: 1,
  activeTableId: "t1",
  tables: [
    {
      id: "t1",
      name: "第一个",
      activeViewId: "v1",
      views: [{ id: "v1", name: "表格视图", type: "grid", rowHeight: "low" }],
      fields: [
        { id: "f-text", name: "文本", type: "text" },
        { id: "f-bool", name: "布尔值", type: "boolean" },
        { id: "f-link", name: "链接", type: "link" },
        { id: "f-rate", name: "评分", type: "rating" },
        { id: "f-prog", name: "进度", type: "progress" },
        { id: "f-rel", name: "单向关联", type: "relationOneWay", relation: { tableId: "t2", allowMultiple: true } },
        { id: "f-created", name: "创建时间", type: "createdTime" },
      ],
      records: [
        {
          id: "r1",
          createdAt: ts,
          updatedAt: ts,
          values: {
            "f-text": "记录一",
            "f-bool": true,
            "f-link": "https://example.com/x",
            "f-rate": 4,
            "f-prog": 60,
            "f-rel": ["d1"],
          },
        },
      ],
    },
    {
      id: "t2",
      name: "目标表",
      activeViewId: "v2",
      views: [{ id: "v2", name: "表格视图", type: "grid", rowHeight: "low" }],
      fields: [{ id: "f-name", name: "名称", type: "text" }],
      records: [{ id: "d1", createdAt: ts, updatedAt: ts, values: { "f-name": "目标甲" } }],
    },
  ],
});

const render = (content: string) => renderToStaticMarkup(createElement(MobileBitableViewer, { noteId: "n1", content }));

describe("MobileBitableViewer 只读单元", () => {
  it("布尔/链接/评分/进度/关联都渲染只读控件（不是裸文本）", () => {
    const html = render(body);
    // 横向可滚动内容必须自己接管横滑，不能让外壳把右划手势拉成左侧目录抽屉。
    expect(html).toContain("data-prevent-swipe");
    expect(html).toContain('class="mbt-bool"');
    expect(html).toContain('type="checkbox"');
    expect(html).toContain('href="https://example.com/x"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain("mbt-star is-on");
    expect(html).toContain("mbt-progress-bar");
    expect(html).toContain("60%");
    expect(html).toContain("mbt-relation-chip");
    expect(html).toContain("目标甲");
    // 系统时间仍走展示文本（到分钟）
    expect(html).toContain("2026-09-01 08:00");
  });

  it("未知视图类型给明确只读回退提示（不空白）", () => {
    const unknown = JSON.stringify({
      kind: "bitable",
      version: 1,
      activeTableId: "t1",
      tables: [
        {
          id: "t1",
          name: "表",
          activeViewId: "vg",
          views: [{ id: "vg", name: "甘特视图", type: "gantt", rowHeight: "low" }],
          fields: [{ id: "f", name: "文本", type: "text" }],
          records: [{ id: "r", createdAt: ts, updatedAt: ts, values: { f: "x" } }],
        },
      ],
    });
    const html = render(unknown);
    expect(html).toContain("mbt-view-notice");
    expect(html).toContain("不支持「gantt」视图");
  });

  it("P2：看板 / 画册 / 日历视图分派到对应移动端实现（不再回退表格）", () => {
    const make = (type: string, extra: Record<string, unknown>) => JSON.stringify({
      kind: "bitable", version: 1, activeTableId: "t1",
      tables: [{
        id: "t1", name: "表", activeViewId: "v1",
        views: [{ id: "v1", name: "视图", type, rowHeight: "low", ...extra }],
        fields: [
          { id: "f-type", name: "类型", type: "select", options: [{ id: "o1", name: "复盘", color: "green" }] },
          { id: "f-text", name: "文本", type: "text" },
          { id: "f-date", name: "日期", type: "date" },
          { id: "f-file", name: "附件", type: "attachment" },
        ],
        records: [{ id: "r1", createdAt: ts, updatedAt: ts, values: { "f-type": "o1", "f-text": "x", "f-date": "2026-06-09" } }],
      }],
    });
    expect(render(make("kanban", { kanbanGroupFieldId: "f-type" }))).toContain("mbt-kanban");
    expect(render(make("gallery", { galleryCoverFieldId: "f-file" }))).toContain("mbt-gallery");
    expect(render(make("calendar", { calendarStartFieldId: "f-date" }))).toContain("mbt-calendar");
    // 这三种已实现视图不再出现「暂以表格展示」回退提示
    expect(render(make("kanban", { kanbanGroupFieldId: "f-type" }))).not.toContain("mbt-view-notice");
  });

  it("附件字段用文档类型图标（图片字段仍是缩略图）", () => {
    const files = JSON.stringify({
      kind: "bitable",
      version: 1,
      activeTableId: "t1",
      tables: [
        {
          id: "t1",
          name: "表",
          activeViewId: "v1",
          views: [{ id: "v1", name: "表格视图", type: "grid", rowHeight: "low" }],
          fields: [
            { id: "f-att", name: "附件", type: "attachment" },
            { id: "f-img", name: "图片", type: "image" },
          ],
          records: [
            {
              id: "r1",
              createdAt: ts,
              updatedAt: ts,
              values: {
                "f-att": [
                  { file: "1790700946314_aaaa1111.pdf", name: "【期神笔记】2024.pdf", size: 1 },
                  { file: "1790700946314_bbbb2222.jpg", name: "阿贝多.jpg", size: 2 },
                ],
                "f-img": [{ file: "1790700946314_cccc3333.jpg", name: "阿贝多.jpg", size: 3 }],
              },
            },
          ],
        },
      ],
    });
    const html = render(files);
    // 附件字段：类型图标 + 名称（触屏没有 hover，名称不能收进气泡）
    expect(html).toContain("bt-file-icon--pdf");
    expect(html).toContain("bt-file-icon--image");
    expect(html).toContain("mbt-attachment-file is-kind");
    // P2（261012）：移动端截断改走自有原语 .mb-ellipsis（mb-* 是移动端唯一来源，不再用桌面 .ln-ellipsis）
    expect(html).toContain('class="mbt-attachment-name mb-ellipsis"');
    // 计数口径：2 个类型图标（附件格里的 pdf + jpg），1 张缩略图（图片格，**不**变图标）
    // 每个图标类名形如 `lucide ... bt-file-icon bt-file-icon--pdf` ⇒ 用 `--` 形态计数（每个图标一次）
    expect((html.match(/bt-file-icon--/g) ?? []).length).toBe(2);
    expect((html.match(/class="mbt-attachment"/g) ?? []).length).toBe(1);
  });

  it("编辑态：两行头部（row1 = 表名/字段/筛选/＋，row2 = 视图页签）+ 网格可点，不再有编辑中徽标", () => {
    const html = renderToStaticMarkup(createElement(MobileBitableViewer, { noteId: "n1", content: body, editing: true, onChange: () => {} }));
    expect(html).toContain("mobile-bitable is-editing");
    expect(html).toContain('class="mbt-header"');
    expect(html).toContain("mbt-cell-btn");
    // 第 1 行：表名 + 三个动作；页签不再混在第 1 行
    expect(html).toContain('class="mbt-header__row1"');
    const row1 = html.slice(html.indexOf("mbt-header__row1"), html.indexOf("mbt-header__row2"));
    expect(row1).toContain('aria-label="数据表"');
    expect(row1).toContain('aria-label="字段管理"');
    expect(row1).toContain('aria-label="筛选"');
    expect(row1).toContain('aria-label="新增记录"');
    expect(row1).not.toContain('aria-label="视图"');
    // 第 2 行：视图页签 + 视图列表
    expect(html).toContain('class="mbt-header__row2"');
    const row2 = html.slice(html.indexOf("mbt-header__row2"));
    expect(row2).toContain('aria-label="视图"');
    expect(row2).toContain('aria-label="视图列表"');
    // 261103 五批：视图列表入口钉在最右 —— 页签容器与按钮之间必须有 spacer（否则按钮跟着页签跑）。
    expect(row2.indexOf("mbt-header__spacer")).toBeGreaterThan(row2.indexOf('aria-label="视图"'));
    expect(row2.indexOf("mbt-header__spacer")).toBeLessThan(row2.indexOf('aria-label="视图列表"'));
    expect(row2).not.toContain('aria-label="筛选"');
    // 261103 三批：头部不再有「编辑中 / 只读」徽标
    expect(html).not.toContain("编辑中");
    expect(html).not.toContain(">只读<");
  });

  it("阅读态不出现编辑部件（默认 props 渲染结果与旧只读视图一致）", () => {
    const html = render(body);
    expect(html).not.toContain("is-editing");
    expect(html).not.toContain("mbt-cell-btn");
    expect(html).not.toContain('aria-label="新增记录"');
    expect(html).not.toContain('aria-label="字段管理"');
    expect(html).not.toContain('aria-label="筛选"');
    // 只读单视图：第 2 行整段不渲染（头部只剩第 1 行的 ☰ + 表名）；也没有只读徽标
    expect(html).toContain('class="mbt-header__row1"');
    expect(html).not.toContain('class="mbt-header__row2"');
    expect(html).not.toContain('aria-label="视图列表"');
    expect(html).not.toContain(">只读<");
  });

  it("头部收口（261103 三/四批）：一个 header 两行、旧三行/徽标已删、三个入口图标互不相同", () => {
    const html = renderToStaticMarkup(createElement(MobileBitableViewer, { noteId: "n1", content: body, editing: true, onChange: () => {} }));
    // 一个 <header>，内部两行（row1 在 row2 之前）；旧的 视图页签行 / 元信息行 / 工具行 都不再存在
    expect((html.match(/class="mbt-header"/g) ?? []).length).toBe(1);
    expect(html.indexOf("mbt-header__row1")).toBeLessThan(html.indexOf("mbt-header__row2"));
    expect(html).not.toContain("mbt-views");
    expect(html).not.toContain("mbt-meta");
    expect(html).not.toContain("mbt-toolbar");
    expect(html).not.toContain("mbt-readonly");
    // 三个入口图标互不相同：视图列表 = LayoutList / 字段 = TableProperties / 筛选 = ListFilter
    expect(html).toContain("lucide-layout-list");
    expect(html).toContain("lucide-table-properties");
    expect(html).toContain("lucide-list-filter");
    // 同一功能只有一个入口：筛选一处；与它重复的「视图配置」已删
    expect((html.match(/aria-label="筛选"/g) ?? []).length).toBe(1);
    expect(html).not.toContain('aria-label="视图配置"');
    // 记录数移出头部（网格末尾统计行），头部在统计行之前
    expect(html).toContain("mbt-grid-foot");
    expect(html.indexOf("mbt-header")).toBeLessThan(html.indexOf("mbt-grid-foot"));
  });

  it("只读多视图：保留视图页签与视图列表（能切视图），仍无字段/筛选/＋", () => {
    const twoViews = JSON.stringify({
      kind: "bitable", version: 1, activeTableId: "t1",
      tables: [{
        id: "t1", name: "表", activeViewId: "v1",
        views: [
          { id: "v1", name: "表格一", type: "grid", rowHeight: "low" },
          { id: "v2", name: "表格二", type: "grid", rowHeight: "low" },
        ],
        fields: [{ id: "f", name: "文本", type: "text" }],
        records: [{ id: "r", createdAt: ts, updatedAt: ts, values: { f: "x" } }],
      }],
    });
    const html = render(twoViews);
    // 只读多视图：第 2 行仍在（页签能切），第 1 行只有表名
    expect(html).toContain('class="mbt-header__row2"');
    expect(html).toContain('aria-label="视图"');
    expect(html).toContain('aria-label="视图列表"');
    expect(html).not.toContain('aria-label="字段管理"');
    expect(html).not.toContain('aria-label="筛选"');
    expect(html).not.toContain('aria-label="新增记录"');
  });

  it("记录超过一页时给「加载更多」（完整模型不裁剪，只限制挂载行）", () => {
    const many = JSON.stringify({
      kind: "bitable",
      version: 1,
      activeTableId: "t1",
      tables: [{
        id: "t1",
        name: "大表",
        activeViewId: "v1",
        views: [{ id: "v1", name: "表格视图", type: "grid", rowHeight: "low" }],
        fields: [{ id: "f", name: "文本", type: "text" }],
        records: Array.from({ length: 120 }, (_, index) => ({
          id: "r" + index, createdAt: ts, updatedAt: ts, values: { f: "值" + index },
        })),
      }],
    });
    const html = renderToStaticMarkup(createElement(MobileBitableViewer, { noteId: "n1", content: many, editing: true, onChange: () => {} }));
    expect(html).toContain("120 条记录");
    expect(html).toContain("加载更多（已显示 100 / 120 条）");
    // 首屏只挂 100 行（窗口），不是把 120 行全渲染
    expect((html.match(/aria-label="文本"/g) ?? []).length).toBe(100);
  });

  it("条件填色在移动端只读表格复用桌面投影（背景 + 行侧）", () => {
    const filled = JSON.stringify({
      kind: "bitable",
      version: 1,
      activeTableId: "t1",
      tables: [
        {
          id: "t1",
          name: "表",
          activeViewId: "v1",
          views: [{
            id: "v1",
            name: "表格视图",
            type: "grid",
            rowHeight: "low",
            fillRules: [
              { id: "f1", mode: "row", color: "#FFE8E6", condition: { fieldId: "f", operator: "contains", value: "x" } },
              { id: "f2", mode: "rowSide", color: "#FA541C", condition: { fieldId: "f", operator: "contains", value: "x" } },
            ],
          }],
          fields: [{ id: "f", name: "文本", type: "text" }],
          records: [{ id: "r", createdAt: ts, updatedAt: ts, values: { f: "x" } }],
        },
      ],
    });
    const html = render(filled);
    expect(html).toContain("linear-gradient(color-mix(in srgb, #FFE8E6 62%, transparent), color-mix(in srgb, #FFE8E6 62%, transparent))");
    expect(html).toContain('data-fill-side=""');
    expect(html).toContain("--mbt-fill-side:#FA541C");
  });
});

const docWithForm = JSON.stringify({
  kind: "bitable", version: 1, activeTableId: "t1",
  tables: [{
    id: "t1", name: "收集表", activeViewId: "v-grid",
    views: [
      { id: "v-grid", name: "内容", type: "grid", rowHeight: "low" },
      { id: "v-form", name: "表单", type: "form", formFieldIds: ["f-type", "f-content"], formTitle: "观点收集", formDescription: "填完提交" },
    ],
    fields: [
      { id: "f-type", name: "类型", type: "select", required: true, options: [{ id: "o1", name: "复盘", color: "#2b7350" }] },
      { id: "f-content", name: "内容", type: "text", required: true },
    ],
    records: [{ id: "r1", createdAt: ts, updatedAt: ts, values: { "f-type": "o1", "f-content": "一条" } }],
  }],
});

describe("MobileBitableViewer 表单优先（261030）", () => {
  it("有表单视图时默认落在表单（填写态）：页签、必填标记、提交按钮", () => {
    const html = render(docWithForm);
    // 视图页签：表单 / 内容
    expect(html).toContain('aria-label="视图"');
    expect(html).toContain(">表单<");
    // 261103 四批：表格视图页签从「内容」改「表格」
    expect(html).toContain(">表格<");
    // 表单结构（填写态）：261030 用户点单去掉封面/重复标题/说明，只剩字段 + 提交
    expect(html).toContain("mbt-form-fields");
    expect(html).not.toContain("mbt-form-cover");
    expect(html).not.toContain("mbt-form-title");
    expect(html).toContain('aria-label="必填"');
    expect(html).toContain(">提交<");
    expect(html).toContain("mbt-form-meta");
    // 261103 三批：头部不再有只读徽标（表单分支同样走精简头部）
    expect(html).not.toContain(">只读<");
    // 多数据表入口（261030 用户点单：对齐钉钉的抽屉切换）始终可见
    expect(html).toContain('aria-label="数据表"');
    // 表单视图下没有表格
    expect(html).not.toContain("mbt-grid");
  });

  it("表单提交按钮默认可用；必填项没填时不会静默（错误只在交互后出现，静态渲染没有错误文案）", () => {
    const html = render(docWithForm);
    expect(html).not.toContain("必填项未填写");
  });
});

describe("MobileBitableViewer 坏正文（CORE-02）", () => {
  it("坏 JSON = 只读 + 横幅，不再是「这张多维表还没有数据表」", () => {
    const html = render("{ 不是 json");
    expect(html).toContain("data-bitable-parse-error");
    expect(html).toContain("已锁定为只读");
    expect(html).not.toContain("还没有数据表");
  });

  it("结构不对 / 异 kind 一律按坏正文（不落成空表）", () => {
    expect(render(JSON.stringify({ kind: "bitable", version: 9, tables: [] }))).toContain("data-bitable-parse-error");
    expect(render(JSON.stringify({ kind: "usheet", version: 1, workbook: {} }))).toContain("data-bitable-parse-error");
    expect(render("<p>这是一篇 Lake 文档</p>")).toContain("data-bitable-parse-error");
  });

  it("空正文 = 可编辑的默认数据表（不是坏正文、也不是「还没有数据表」）", () => {
    const html = render("");
    expect(html).not.toContain("data-bitable-parse-error");
    expect(html).not.toContain("还没有数据表");
    expect(html).toContain("mbt-grid");
  });
});
