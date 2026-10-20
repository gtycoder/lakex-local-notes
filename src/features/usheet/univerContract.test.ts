/**
 * Univer（表格内核）**升级护栏** —— 在 `npm test` 时对着 **node_modules 里实装的内核产物**核对：
 *   ① 所有 `@univerjs/*` 必须**同一版本**且 package.json 里**精确锁定**（出现两份 core ⇒ DI token 不一致 ⇒ 静默失效）；
 *   ② 我们依赖的内核符号/配置键/DOM 钩子仍然存在（见 usheetKernelContract.ts）。
 *
 * 为什么要有它：内核改掉一个菜单 id / 配置键 / 命令 id 时，我们这边**不会报错**，只会"功能悄悄没了"
 * （例：图片菜单 id 变了 ⇒ 插图入口退回内核的 blob 流程；footer 配置键变了 ⇒ 新建工作表又变 1000×20）。
 * 静态存在性由本测试守；运行时行为（粘贴落点、菜单项、默认尺寸）由 `scripts/usheet-kernel-probes.mjs` 守。
 * 升级流程见 `docs/USHEET-UPGRADE.md`。
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  UNIVER_COMMAND_IDS,
  UNIVER_CONFIG_KEYS,
  UNIVER_CONTEXT_MENU_INSERT_PATH,
  UNIVER_DOM_HOOKS,
  UNIVER_FEATURE_NAMES,
  UNIVER_MENU_ITEM_IDS,
  UNIVER_PATCH_HOOKS,
} from "./usheetKernelContract";

const ROOT = process.cwd();

/** 我们真正依赖的内核包（扫这些就够；别把整个 node_modules 读进来）。 */
const UNIVER_PACKAGES = [
  "@univerjs/presets",
  "@univerjs/preset-sheets-core",
  "@univerjs/preset-sheets-drawing",
  "@univerjs/sheets",
  "@univerjs/sheets-ui",
  "@univerjs/sheets-drawing-ui",
  "@univerjs/drawing-ui",
  "@univerjs/sheets-numfmt-ui",
  "@univerjs/sheets-numfmt",
  "@univerjs/core",
  "@univerjs/ui",
  "@univerjs/docs-ui",
  "@univerjs/engine-render",
  "@univerjs/design",
];

/** 把实装内核的 ESM 产物拼起来（index.js + facade.js），供"符号还在不在"的静态核对。 */
function univerBundleText(): string {
  const parts: string[] = [];
  for (const pkg of UNIVER_PACKAGES) {
    for (const rel of ["lib/es/index.js", "lib/es/facade.js", "lib/index.css"]) {
      const file = `${ROOT}/node_modules/${pkg}/${rel}`;
      if (existsSync(file)) parts.push(readFileSync(file, "utf8"));
    }
  }
  return parts.join("\n");
}

const BUNDLE = univerBundleText();

describe("Univer 依赖版本（升级护栏①）", () => {
  it("package.json 里所有 @univerjs/* 必须精确锁定（不许 ^ / ~ / * / latest）", () => {
    const pkg = JSON.parse(readFileSync(`${ROOT}/package.json`, "utf8")) as { dependencies?: Record<string, string> };
    const univerDeps = Object.entries(pkg.dependencies ?? {}).filter(([name]) => name.startsWith("@univerjs/"));
    expect(univerDeps.length).toBeGreaterThan(0);
    for (const [name, range] of univerDeps) {
      expect(range, `${name} 必须精确锁定版本（presets 与 engine-render 分叉会出现两份 @univerjs/core）`).toMatch(/^\d+\.\d+\.\d+/);
    }
  });

  it("node_modules 里所有 @univerjs/* 实装版本必须完全一致", () => {
    const dir = `${ROOT}/node_modules/@univerjs`;
    const installed: Array<[string, string]> = [];
    for (const name of readdirSync(dir)) {
      const file = `${dir}/${name}/package.json`;
      if (!existsSync(file)) continue;
      const meta = JSON.parse(readFileSync(file, "utf8")) as { name?: string; version?: string };
      if (meta.version) installed.push([meta.name ?? name, meta.version]);
    }
    expect(installed.length).toBeGreaterThan(5);
    // @univerjs/icons 是**独立发版**的图标集（当前 1.43.x），不跟主包版本线走 ⇒ 只对主包要求同版本。
    const mainPackages = installed.filter(([name]) => name !== "@univerjs/icons");
    const versions = [...new Set(mainPackages.map(([, v]) => v))];
    expect(versions.length, `@univerjs/* 版本分叉了：${JSON.stringify(installed)}`).toBe(1);
    // @univerjs/core、ui、sheets-ui 等必须是同一份（重复副本会让 DI token 对不上）
    for (const required of ["@univerjs/core", "@univerjs/ui", "@univerjs/sheets-ui", "@univerjs/engine-render"]) {
      expect(installed.some(([n]) => n === required), `缺少实装 ${required}`).toBe(true);
    }
  });
});

describe("Univer 内核触点仍存在（升级护栏②）", () => {
  const symbols: Array<[string, string]> = [
    // 只核对**内核**命令 id；our* 是我们自己注册的，不在内核产物里
    ...Object.entries(UNIVER_COMMAND_IDS).filter(([key]) => !key.startsWith("our")),
    ...UNIVER_MENU_ITEM_IDS.map((id) => [id, id] as [string, string]),
    ...UNIVER_CONFIG_KEYS.map((k) => [k, k] as [string, string]),
    ...UNIVER_FEATURE_NAMES.map((k) => [k, k] as [string, string]),
    ...UNIVER_DOM_HOOKS.map((k) => [k, k] as [string, string]),
    ...UNIVER_CONTEXT_MENU_INSERT_PATH.map((k) => [k, k] as [string, string]),
    // footer 的四个开关（只给 addSheetButtonConfig 会把它们顶掉 ⇒ 必须同时存在才安全）
    ...["sheetBar", "statisticBar", "zoomSlider"].map((k) => [k, k] as [string, string]),
    // 我们用的 facade API 与图标名
    ...[
      ["createMenu", "createMenu"],
      ["appendTo", "appendTo"],
      ["updateMenuConfig", "updateMenuConfig"],
      ["insertCellImageAsync", "insertCellImageAsync"],
      ["setRowCount", "setRowCount"],
      ["AddImageIcon", "AddImageIcon"],
    ] as Array<[string, string]>,
  ];

  it("契约里的每个符号都能在实装内核里找到（失败即：该符号所在机制被改名/移除）", () => {
    const missing = symbols.filter(([, needle]) => !BUNDLE.includes(needle)).map(([label]) => label);
    expect(missing, `这些内核符号在实装产物里找不到了（升级后需要逐个核对并更新 usheetKernelContract.ts）：${missing.join(", ")}`).toEqual([]);
  });
});

describe("Univer 补丁仍生效（升级护栏③）", () => {
  it("补丁文件在仓库里（不是只改了本地 node_modules）", () => {
    expect(
      existsSync(`${ROOT}/${UNIVER_PATCH_HOOKS.patchFile}`),
      `缺少 ${UNIVER_PATCH_HOOKS.patchFile}：本地 node_modules 改了却没生成补丁 ⇒ 换机 / CI / 重新安装都拿不到修复`,
    ).toBe(true);
  });

  it("floating 容器挂在实例宿主内（@univerjs/ui 补丁没被升级冲掉）", () => {
    // 补丁前：内核把 floating 层 portal 到 document.body ⇒ 逃出标签宿主，切文档后浮层残留
    // （用户 261009 报的表格黄叹号，见 usheetKernelContract.ts 的 UNIVER_PATCH_HOOKS 注释）。
    expect(
      BUNDLE.includes(UNIVER_PATCH_HOOKS.legacyBodyMount),
      `@univerjs/ui 又出现「${UNIVER_PATCH_HOOKS.legacyBodyMount}」⇒ 补丁没应用` +
        `（本机安装失败时 patch-package 不会以非零码退出，务必按 ${UNIVER_PATCH_HOOKS.patchFile} / docs/USHEET-UPGRADE.md §4.7 重生成）`,
    ).toBe(false);
    for (const needle of [UNIVER_PATCH_HOOKS.mountedInHost, UNIVER_PATCH_HOOKS.removedSafely, UNIVER_PATCH_HOOKS.floatingMarker]) {
      expect(BUNDLE.includes(needle), `补丁形态缺失：${needle}`).toBe(true);
    }
  });
});
