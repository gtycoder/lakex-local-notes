// @vitest-environment jsdom
/**
 * 设置页「内容输入类」行版式护栏（261102 用户点单 3b）。
 *
 * 用户口径：内容输入类设置项 = **标签在上、具体内容在下（全宽）**——长值（S3 Endpoint / AK / SK、
 * AI 接口地址与 Key）挤在标签右侧时窄屏只剩一百多像素，看不全、换行丑。
 * 判据两层：
 *   · 渲染层：Field 输出 .mb-set-item--field + __main 在前、__ctl 在后（kit.css 让 __ctl flex 1 1 100%），
 *     输入统一走 TextField 的 .mb-input 外壳（不再有 `<input class="mb-input">` 这第二套输入外观）；
 *   · 源码层：S3 / AI 的输入行必须用 Field，且 itemId 与两端共用 SETTING_ITEMS 对齐（settingsSearch 锚点）。
 * 不适用范围（本来适合同行，勿套 Field）：PickerSheet 选择器 / Switch / Seg 分段控件 /
 * 固定 96px 的短数字输入（NumField，一行放得下）。
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Field, TextField } from "../ui/settingsPrimitives";
import { SETTING_ITEMS } from "../../components/model/settingsSearch";

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

/** 设置页里所有内容输入行（S3 连接信息 + AI 接入）；顺序与 SettingsDrawer 一致。 */
const INPUT_ROW_IDS = [
  // 261113：S3 字段顺序对齐桌面（Endpoint → AK → SK → Bucket → Region → 前缀）
  "s3-endpoint",
  "s3-access-key",
  "s3-secret-key",
  "s3-bucket",
  "s3-region",
  "s3-prefix",
  // 261113：AI 顺序对齐桌面（接口地址 → API Key → 模型 → 温度）
  "ai-base-url",
  "ai-api-key",
  "ai-model",
  "ai-temperature",
];

// jsdom 环境下 import.meta.url 是 http(s) 形式（vitest 的 jsdom url），读源码走 cwd 相对路径。
const drawerSource = () => ["src/mobile/settings/SettingsDrawer.tsx", "src/mobile/settings/AiSettingsSection.tsx", "src/mobile/settings/BasicSettingsSections.tsx"].map(file => readFileSync(path.resolve(process.cwd(), file), "utf8")).join("\n");

describe("Field = 内容输入行的唯一行语义", () => {
  it("标签+说明在上、控件容器在后（占满下一行），保留 data-set-id", () => {
    const onSave = vi.fn();
    act(() => root.render(createElement(
      Field,
      { itemId: "s3-endpoint", name: "Endpoint", desc: "七牛形如 https://s3.cn-north-1.qiniucs.com" },
      createElement(TextField, { label: "Endpoint", value: "https://s3.cn-north-1.qiniucs.com", onSave }),
    )));
    const row = host.firstElementChild as HTMLElement;
    expect(row.classList.contains("mb-set-item")).toBe(true);
    // --field = kit.css 的「ctl 占满下一行」；缺这个修饰类就会退回「标签与输入框同行」。
    expect(row.classList.contains("mb-set-item--field")).toBe(true);
    expect(row.dataset.setId).toBe("s3-endpoint");

    const [main, ctl] = [...row.children] as HTMLElement[];
    expect(main.className).toContain("mb-set-item__main");
    expect(main.textContent).toContain("Endpoint");
    expect(main.querySelector(".mb-set-item__desc")!.textContent).toContain("qiniucs.com");
    expect(ctl.className).toContain("mb-set-item__ctl");

    // 输入外观只有一套：.mb-input 是外壳 span，input 本体不再自带 .mb-input。
    const input = ctl.querySelector("input")!;
    expect(input.getAttribute("aria-label")).toBe("Endpoint");
    expect(input.classList.contains("mb-input")).toBe(false);
    expect(input.parentElement!.classList.contains("mb-input")).toBe(true);
  });
});

describe("SettingsDrawer 的内容输入行（源码护栏）", () => {
  it("S3 / AI 输入行一律用 Field，不许退回 Item 或裸 .mb-set-item + input.mb-input", () => {
    const src = drawerSource();
    for (const id of INPUT_ROW_IDS) {
      expect(src, `${id} 应是 <Field itemId="${id}">（标签在上、控件占满下一行）`).toContain(`<Field itemId="${id}"`);
    }
    // 旧写法：<input className="mb-input"> 直接套在 input 上 = 第二套输入外观，也失去 .mb-input 的 44 触达内核。
    expect(src).not.toMatch(/<input[^>]*className="mb-input"/);
  });

  it("每个 Field 行都装的是文本输入（TextField），且没有漏网的内容输入行", () => {
    const src = drawerSource();
    const fieldBlocks = src.split("<Field ").slice(1).map((chunk) => {
      const end = chunk.indexOf("</Field>");
      expect(end, "Field 行必须有闭合标签").toBeGreaterThan(0);
      return chunk.slice(0, end);
    });
    expect(fieldBlocks.length, "Field 行数 = 内容输入行数").toBe(INPUT_ROW_IDS.length);
    for (const block of fieldBlocks) expect(block).toContain("<TextField ");
    const textFields = (src.match(/<TextField /g) ?? []).length;
    expect(textFields, "TextField 必须全部落在 Field 行内").toBe(INPUT_ROW_IDS.length);
  });

  it("短数字输入仍用 Item（96px 固定宽，一行放得下，不需要标签在上）", () => {
    const src = drawerSource();
    expect(src).toContain('<Item itemId="history-max-snapshots"');
    expect(src).toContain('<Item itemId="history-snapshot-interval"');
  });

  it("data-set-id 与两端共用 SETTING_ITEMS 对齐（settingsSearch 的定位锚点不漂移）", () => {
    const ids = new Set(SETTING_ITEMS.map((item) => item.id));
    for (const id of INPUT_ROW_IDS) expect(ids.has(id), `SETTING_ITEMS 缺少 ${id}`).toBe(true);
  });
});
