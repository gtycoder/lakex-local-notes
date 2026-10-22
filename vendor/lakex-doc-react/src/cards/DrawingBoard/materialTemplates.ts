import type { PlaitElement, Point } from "@plait/core";
import {
  ArrowLineMarkerType,
  ArrowLineShape,
  BasicShapes,
  createArrowLineElement,
  createGeometryElement,
  FlowchartSymbols,
  UMLSymbols,
} from "@plait/draw";

export type MaterialCategory =
  | "hot"
  | "teamwork"
  | "product"
  | "technology"
  | "thinking";

export interface MaterialTemplate {
  id: string;
  categories: MaterialCategory[];
  zh: string;
  en: string;
  /** Metadata mirrored from the selected Yuque material records. */
  sourceId?: number;
  docletId?: number;
  descriptionZh?: string;
  descriptionEn?: string;
  usageCount?: number;
  cover?: string;
  build: (locale: "zh-CN" | "en-US") => PlaitElement[];
}

type TemplateShape = BasicShapes | FlowchartSymbols | UMLSymbols;

const palette = {
  blue: { fill: "#E8F1FF", stroke: "#5B8FF9" },
  indigo: { fill: "#EEF0FF", stroke: "#6C7BD9" },
  green: { fill: "#EAF8F0", stroke: "#5BB98C" },
  yellow: { fill: "#FFF6D9", stroke: "#D9A441" },
  orange: { fill: "#FFF0E6", stroke: "#E58B50" },
  purple: { fill: "#F3EBFF", stroke: "#9B71D1" },
  cyan: { fill: "#E7F8F7", stroke: "#4FB6B2" },
  gray: { fill: "#F3F4F6", stroke: "#8B95A5" },
};

const box = (
  shape: TemplateShape,
  x: number,
  y: number,
  width: number,
  height: number,
  text: string,
  color: keyof typeof palette = "blue",
  fontSize = "13",
) =>
  createGeometryElement(
    shape,
    [
      [x, y],
      [x + width, y + height],
    ],
    text,
    {
      fill: palette[color].fill,
      strokeColor: palette[color].stroke,
      strokeWidth: 1.5,
    },
    { "font-size": fontSize, color: "#273142" },
  );

const arrow = (
  source: Point,
  target: Point,
  color = "#697586",
  marker = ArrowLineMarkerType.arrow,
) =>
  createArrowLineElement(
    ArrowLineShape.straight,
    [source, target],
    { marker: ArrowLineMarkerType.none },
    { marker },
    undefined,
    { strokeColor: color, strokeWidth: 1.5 },
  );

const label = (x: number, y: number, width: number, text: string) =>
  createGeometryElement(
    BasicShapes.text,
    [
      [x, y],
      [x + width, y + 26],
    ],
    text,
    undefined,
    { "font-size": "14", color: "#273142" },
  );

const choose = (
  locale: "zh-CN" | "en-US",
  zh: string,
  en: string,
) => (locale === "zh-CN" ? zh : en);

export const materialTemplates: MaterialTemplate[] = [
  {
    id: "product-milestones",
    categories: ["product"],
    zh: "产品里程碑",
    en: "Product milestones",
    sourceId: 18061212,
    docletId: 48173073,
    descriptionZh: "用于跟踪产品或项目开发的关键里程碑。",
    descriptionEn: "Track key milestones in product or project development.",
    usageCount: 23293,
    cover: "https://mdn.alipayobjects.com/huamei_0prmtq/afts/img/A*KA8xSYmgiYgAAAAAAAAAAAAADvuFAQ/original",
    build: (locale) => {
      const names = [
        choose(locale, "需求调研", "Research"),
        choose(locale, "方案设计", "Design"),
        choose(locale, "灰度发布", "Beta"),
        choose(locale, "正式发布", "Launch"),
      ];
      const colors: (keyof typeof palette)[] = ["blue", "purple", "orange", "green"];
      const elements: PlaitElement[] = [
        label(-250, -120, 200, choose(locale, "产品里程碑", "Product milestones")),
        arrow([-210, 10], [245, 10], "#94A3B8", ArrowLineMarkerType.arrow),
      ];
      names.forEach((name, index) => {
        const x = -230 + index * 145;
        elements.push(
          box(BasicShapes.ellipse, x, -12, 44, 44, "", colors[index]),
          box(BasicShapes.roundRectangle, x - 35, 62, 114, 48, name, colors[index], "12"),
          arrow([x + 22, 32], [x + 22, 62], "#94A3B8", ArrowLineMarkerType.none),
        );
      });
      return elements;
    },
  },
  {
    id: "tech-architecture",
    categories: ["technology"],
    zh: "技术架构图",
    en: "Technical architecture",
    build: (locale) => {
      const layers = [
        [choose(locale, "访问层", "Client"), ["Web", "Mobile", "API"], "blue"],
        [choose(locale, "服务层", "Services"), [choose(locale, "用户服务", "User"), choose(locale, "业务服务", "Business"), choose(locale, "消息服务", "Message")], "purple"],
        [choose(locale, "数据层", "Data"), ["MySQL", "Redis", "Object Storage"], "green"],
      ] as const;
      const elements: PlaitElement[] = [];
      layers.forEach(([layer, items, color], row) => {
        const y = -170 + row * 135;
        elements.push(label(-280, y + 20, 90, layer));
        items.forEach((item, column) => {
          const x = -155 + column * 150;
          elements.push(
            box(BasicShapes.roundRectangle, x, y, 120, 54, item, color, "11"),
          );
          if (row < layers.length - 1) {
            elements.push(
              arrow([x + 60, y + 54], [x + 60, y + 81], "#8993A4"),
            );
          }
        });
      });
      return elements;
    },
  },
  {
    id: "api-request-flow",
    categories: ["hot", "technology"],
    zh: "API 请求链路",
    en: "API request flow",
    build: (locale) => {
      const nodes = [
        choose(locale, "客户端", "Client"),
        "API Gateway",
        choose(locale, "鉴权服务", "Auth"),
        choose(locale, "业务服务", "Service"),
        "Database",
      ];
      const colors: (keyof typeof palette)[] = ["blue", "indigo", "purple", "cyan", "green"];
      const elements: PlaitElement[] = [];
      nodes.forEach((text, index) => {
        const x = -340 + index * 170;
        elements.push(box(BasicShapes.roundRectangle, x, -30, 125, 60, text, colors[index], "11"));
        if (index < nodes.length - 1) {
          elements.push(arrow([x + 125, 0], [x + 170, 0]));
        }
      });
      return elements;
    },
  },
  {
    id: "cicd-pipeline",
    categories: ["hot", "technology"],
    zh: "CI/CD 发布流水线",
    en: "CI/CD pipeline",
    build: (locale) => {
      const steps = [
        choose(locale, "提交代码", "Commit"),
        choose(locale, "构建镜像", "Build"),
        choose(locale, "自动化测试", "Test"),
        choose(locale, "部署发布", "Deploy"),
      ];
      const colors: (keyof typeof palette)[] = ["blue", "purple", "orange", "green"];
      const elements: PlaitElement[] = [
        label(-300, -110, 240, choose(locale, "CI/CD 发布流水线", "CI/CD pipeline")),
      ];
      steps.forEach((text, index) => {
        const x = -290 + index * 195;
        elements.push(
          box(FlowchartSymbols.process, x, -15, 145, 60, text, colors[index], "11"),
        );
        if (index < steps.length - 1) {
          elements.push(arrow([x + 145, 15], [x + 195, 15]));
        }
      });
      return elements;
    },
  },
  {
    id: "database-er-model",
    categories: ["hot", "technology"],
    zh: "数据库 ER 图",
    en: "Database ER diagram",
    build: (locale) => {
      const user = choose(locale, "用户\nid\nname", "User\nid\nname");
      const order = choose(locale, "订单\nid\nuser_id", "Order\nid\nuser_id");
      const item = choose(locale, "订单明细\nid\norder_id", "Order item\nid\norder_id");
      return [
        box(BasicShapes.rectangle, -300, -54, 130, 108, user, "blue", "11"),
        box(BasicShapes.rectangle, -65, -54, 130, 108, order, "purple", "11"),
        box(BasicShapes.rectangle, 170, -54, 130, 108, item, "green", "11"),
        arrow([-170, 0], [-65, 0], "#7A8699", ArrowLineMarkerType.none),
        arrow([65, 0], [170, 0], "#7A8699", ArrowLineMarkerType.none),
      ];
    },
  },
  {
    id: "frontend-module-map",
    categories: ["hot", "technology"],
    zh: "前端模块架构",
    en: "Frontend module map",
    build: (locale) => {
      const root = choose(locale, "Web 应用", "Web app");
      const modules = [
        choose(locale, "路由", "Router"),
        choose(locale, "页面模块", "Pages"),
        choose(locale, "状态管理", "State"),
        choose(locale, "组件库", "UI kit"),
      ];
      const colors: (keyof typeof palette)[] = ["blue", "purple", "cyan", "green"];
      const elements: PlaitElement[] = [
        box(BasicShapes.roundRectangle, -75, -155, 150, 56, root, "indigo"),
      ];
      modules.forEach((text, index) => {
        const x = -300 + index * 165;
        elements.push(
          box(BasicShapes.roundRectangle, x, 20, 130, 52, text, colors[index], "11"),
          arrow([0, -99], [x + 65, 20]),
        );
      });
      return elements;
    },
  },
  {
    id: "production-troubleshooting",
    categories: ["technology"],
    zh: "线上故障排查",
    en: "Production troubleshooting",
    build: (locale) => {
      const alert = choose(locale, "告警", "Alert");
      const checks = [
        choose(locale, "服务状态", "Service health"),
        choose(locale, "日志与指标", "Logs & metrics"),
        choose(locale, "依赖服务", "Dependencies"),
      ];
      const elements: PlaitElement[] = [
        box(FlowchartSymbols.terminal, -70, -155, 140, 52, alert, "orange"),
        box(FlowchartSymbols.decision, -75, -55, 150, 82, choose(locale, "是否可复现？", "Reproducible?"), "yellow", "11"),
        arrow([0, -103], [0, -55]),
      ];
      checks.forEach((text, index) => {
        const x = -260 + index * 190;
        elements.push(
          box(BasicShapes.roundRectangle, x, 100, 140, 50, text, ["blue", "purple", "green"][index] as keyof typeof palette, "11"),
          arrow([0, 27], [x + 70, 100]),
        );
      });
      return elements;
    },
  },
  {
    id: "idea-map",
    categories: ["thinking", "product"],
    zh: "产品创意图",
    en: "Product idea map",
    build: (locale) => {
      const center = choose(locale, "产品创意", "Product idea");
      const branches = [
        [-245, -140, choose(locale, "用户", "Users"), "blue"],
        [110, -140, choose(locale, "场景", "Scenarios"), "purple"],
        [-245, 100, choose(locale, "价值", "Value"), "green"],
        [110, 100, choose(locale, "风险", "Risks"), "orange"],
      ] as const;
      const elements: PlaitElement[] = [
        box(BasicShapes.ellipse, -72, -42, 144, 84, center, "yellow"),
      ];
      branches.forEach(([x, y, text, color]) => {
        elements.push(
          box(BasicShapes.roundRectangle, x, y, 135, 54, text, color),
          arrow(
            [x < 0 ? x + 135 : x, y < 0 ? y + 54 : y],
            [x < 0 ? -62 : 62, y < 0 ? -25 : 25],
            "#8993A4",
            ArrowLineMarkerType.none,
          ),
        );
      });
      return elements;
    },
  },
  {
    id: "user-experience-map",
    categories: ["product", "thinking"],
    zh: "用户体验地图",
    en: "User experience map",
    build: (locale) => {
      const center = choose(locale, "用户目标", "User goal");
      const stages = [
        choose(locale, "认知", "Discover"),
        choose(locale, "使用", "Use"),
        choose(locale, "复购", "Return"),
      ];
      const elements: PlaitElement[] = [
        box(BasicShapes.ellipse, -86, -34, 172, 68, center, "yellow"),
      ];
      stages.forEach((text, index) => {
        const x = -280 + index * 190;
        const y = 100;
        elements.push(box(BasicShapes.roundRectangle, x, y, 140, 52, text, ["blue", "purple", "green"][index] as keyof typeof palette));
        elements.push(arrow([0, 34], [x + 70, y]));
      });
      return elements;
    },
  },
  {
    id: "service-topology",
    categories: ["technology"],
    zh: "服务拓扑图",
    en: "Service topology",
    build: (locale) => {
      const client = choose(locale, "客户端", "Client");
      const services = ["API", choose(locale, "用户服务", "User"), choose(locale, "订单服务", "Order")];
      const elements: PlaitElement[] = [box(BasicShapes.roundRectangle, -70, -170, 140, 52, client, "blue")];
      services.forEach((text, index) => {
        const x = -260 + index * 190;
        elements.push(box(BasicShapes.roundRectangle, x, -30, 140, 52, text, "purple"), arrow([0, -118], [x + 70, -30]));
      });
      elements.push(box(FlowchartSymbols.database, -70, 100, 140, 58, choose(locale, "数据库", "Database"), "green"));
      services.forEach((_, index) => {
        const x = -260 + index * 190;
        elements.push(arrow([x + 70, 22], [0, 100]));
      });
      return elements;
    },
  },
  {
    id: "release-checklist",
    categories: ["technology", "teamwork"],
    zh: "发布检查清单",
    en: "Release checklist",
    build: (locale) => {
      const steps = [
        choose(locale, "代码冻结", "Code freeze"),
        choose(locale, "自动化测试", "Automated tests"),
        choose(locale, "灰度发布", "Canary release"),
        choose(locale, "全量上线", "Full release"),
      ];
      return steps.flatMap((text, index) => {
        const x = -300 + index * 200;
        return [
          box(FlowchartSymbols.process, x, -30, 150, 60, text, index === 3 ? "green" : "gray"),
          ...(index < steps.length - 1 ? [arrow([x + 150, 0], [x + 200, 0])] : []),
        ];
      });
    },
  },
];
