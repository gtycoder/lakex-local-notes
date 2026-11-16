import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// external 判据的唯一实现（vite.config.ts 用的也是它）：测试 import 同一份，避免规则两处漂移。
import { isMainProcessExternal as isExternal } from "./buildTarget.js";
import { stripComments } from "./testing/sourceText.js";

/**
 * 主进程分层与依赖方向护栏（批次 A-1 ~ A-5，2026-11-16）。
 *
 * 出处：`docs/arch/ELECTRON-LAYERING-AUDIT.md` §2.4（依赖图实测）与 §5 批次 A。
 *
 * ## 为什么需要它
 * 审计结论：本仓 `electron/` 已经是严格 TypeScript + 8 个子目录 + 0 环依赖，但**没有任何一条
 * 机器门禁** —— `scripts/check-arch.mjs:193` 的 import 方向扫描根只有 `src/core|mobile|features|components`，
 * 完全不覆盖 `electron/`。于是「层序」只存在于评审记忆里：一次顺手 import 就能让
 * `ipc/ → boot/`（装配层反向依赖）或 `electron/ → src/mobile/**` 悄悄成立，且不会有人发现。
 *
 * 本文件抄思源 PR 21151 的 `electron/architecture.test.ts` 做法：**遍历全部生产文件，
 * 逐条校验相对导入**，命中 `ALLOWED_DEPENDENCIES` 与 `SRC_IMPORT_ALLOWLIST` 才算过。
 * 新增一级目录/新增跨界依赖必须登记（含理由），否则直接红。
 *
 * ## 覆盖的判据（与审计文档 §5 批次 A 编号一致）
 * - R1 入口唯一：无人 import `electron/main.ts`（A-2）
 * - R2 一级目录登记制（A-3）
 * - R3 跨层依赖只沿登记方向（A-4）
 * - R4 `electron/` → `src/` 只能走白名单，逐条写理由（A-5）
 * - R5 每个非测试模块要么被入口可达、要么登记为测试支撑（防「写了没接进去」的死代码）
 * - R6 主进程 bare import 必须能被 `isMainProcessExternal` 判为 external（external 从 dependencies 派生，A-6）
 */

const ELECTRON_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(ELECTRON_DIR, "..");

/**
 * 允许出现的一级子目录（A-3）。**新增一级目录必须同时在这里和 ALLOWED_DEPENDENCIES 登记**，
 * 否则 R2 直接失败 —— 这是思源「allowedDependencies 未登记即失败」的做法。
 *
 * 批次 B（窗口层外迁）落地时才加 `window`；现在提前登记会让「目录还不存在」的规则静默失效。
 */
const REGISTERED_SUBDIRS = ["ai", "boot", "ipc", "portable", "quickNotes", "s3v3", "testing", "update", "webApi"] as const;
type Subdir = (typeof REGISTERED_SUBDIRS)[number];
type Layer = "entry" | "domain" | Subdir;

/**
 * 跨层依赖方向表（R3）。**当前实测**（审计 §2.4）每个方向的边上都有真实代码，没有一条是为了
 * 未来预留的：新增一条边就必须在对应层的数组里登记，并在提交说明写清为什么。
 *
 * 分层语义：
 * - `domain`：`electron/` 根平铺的领域/存储/编排层（83 个文件，81/82 被其他层引用）；
 *   它的「层」身份过去只存在于事实里，这里给它是**名字 + 边界**。
 * - `entry`：`electron/main.ts`，只允许出、不允许入。
 * - 子目录：按职责分层，方向只能向下（装配 → 子系统 → 领域），不允许反向或同层乱穿。
 *
 * `src/**` 的依赖方向不在这张表里（见 SRC_IMPORT_ALLOWLIST）。
 */
const ALLOWED_DEPENDENCIES: Record<Layer, readonly Layer[]> = {
  // 入口：唯一的装配点，可以 import 任何层（它就是把它们装起来的那个文件）。
  entry: ["domain", "ai", "boot", "ipc", "portable", "quickNotes", "s3v3", "update", "webApi"],
  // 领域层：可依赖子系统。现状只有三类边，都是「门面 re-export」或「编排委托」：
  //   - domain→webApi（7 条）= electron/webApiServer.ts 门面 re-export electron/webApi/*
  //   - domain→quickNotes（2 条）= electron/quickNotes.ts 门面 re-export electron/quickNotes/*
  //   - domain→s3v3（4 条）  = syncEngineController.ts 委托桌面同步适配
  //   - domain→ai（1 条）    = assetServer.ts 读 ai/localAttachments 的只读访问器，把「本机图片附件」
  //     按 token 以文件流返回给 <img>（261116 用户反馈：本机选的图片不能预览）。只读一个函数，
  //     不回写 AI 状态；AI 子系统的发送链路完全不感知资源服务。
  // 反向（ipc/boot → domain）是主流方向，见下面各层。
  domain: ["domain", "quickNotes", "s3v3", "webApi", "ai"],
  // IPC 注册层：装配各子系统的 handler。不允许依赖 boot/（装配层）与 webApi/（传输层的另一端）。
  ipc: ["domain", "ipc", "ai", "portable", "s3v3", "update"],
  // 启动装配层：负责把 IPC 注册表与各子系统接起来，所以它能依赖 ipc/ 与其他子系统；
  // 但反过来 ipc/ 不能依赖它（否则「装配」和「注册」互相咬住，启动顺序变成隐式约束）。
  boot: ["domain", "boot", "ipc", "update"],
  // 测试专用工具层：只被 *.test.ts 引用（不进产物、不在 R5 的可达集合里，登记在 TEST_SUPPORT_FILES）。
  testing: ["testing"],
  // 小记库：只依赖领域层（它自己的实现全在 quickNotes/ 内部）。
  quickNotes: ["domain", "quickNotes"],
  // S3 桌面适配：只依赖领域层（协议纯逻辑在 src/core/s3v3/）。
  s3v3: ["domain", "s3v3"],
  // AI 主进程侧：只依赖领域层。
  ai: ["domain", "ai"],
  // 便携包：只依赖领域层。
  portable: ["domain", "portable"],
  // 更新中心：只依赖领域层。
  update: ["domain", "update"],
  // 浏览器端：复用同一批 IPC handler（webApi/bridge.ts → ipc/errors.ts 的错误编码）。
  webApi: ["domain", "ipc", "webApi"],
};

/**
 * `electron/ → src/` 的白名单（R4）。`src/core/**` 是纯领域逻辑，允许任意引用（不上表）；
 * 其余 `src/` 前缀必须逐条登记并写理由 —— 因为主进程依赖渲染层是**方向倒置**，
 * 每一条都应是「共享纯函数」而不是「复用 UI」。
 */
interface SrcAllowEntry {
  /** 精确到文件（或目录前缀，以 `/` 结尾）。 */
  readonly target: string;
  /** 为什么主进程需要它（必填；空理由视为未登记）。 */
  readonly reason: string;
}

const SRC_IMPORT_ALLOWLIST: readonly SrcAllowEntry[] = [
  {
    target: "src/lib/types.ts",
    reason:
      "IPC 契约类型（NoteSummary / SyncResult / SyncProgress / S3Settings / 诊断报告…）的定义处，"
      + "主进程是 IPC 宿主，必须与 preload.cjs / WEB_METHODS / src/lib/native.ts 共用同一份类型；"
      + "跨端共享的领域类型已下沉 src/core/sharedTypes.ts（CORE-10），这里是 re-export 门面 + 渲染层专属类型。",
  },
  {
    target: "src/lib/layoutMetrics.ts",
    reason:
      "顶栏几何（TOPBAR_HEIGHT / TOPBAR_SEAM / TRAFFIC_LIGHT_DIAMETER）与 CSS --topbar-height 的单测胶水；"
      + "主进程用它把 macOS 红绿灯垂直居中到顶栏中心（main.ts 的 trafficLightPosition）。"
      + "两侧必须同源，复制常量会让「顶栏改高、红绿灯没跟」的几何事故复发。",
  },
  {
    target: "src/features/ink/inkGeometry.ts",
    reason: "手写板「笔迹 → SVG path」纯几何函数，electron/noteExport.ts 导出 PDF/SVG 时复用；屏显与导出必须同一份几何。",
  },
  {
    target: "src/features/ink/inkStrokeStyle.ts",
    reason: "手写板描边样式（笔宽/颜色/虚线）纯函数，导出必须与屏显一致，故复用同一实现。",
  },
  {
    target: "src/features/ink/inkPageTexts.ts",
    reason: "手写板页内文字的换行/行高纯函数，导出分页依赖它；下沉 core 需同时改渲染层 import（留待后续批次）。",
  },
];

/**
 * 测试支撑文件（R5 / R6）：文件名不带 `.test`，但只被测试引用、**不进产物**。
 * 登记它们的第二个作用：让「从 `electron/main.ts` 可达」的断言能精确表达
 * 「不可达集合 = 这三个」——新增死代码或漏接模块会立刻红。
 */
interface TestSupportEntry {
  readonly file: string;
  readonly reason: string;
}

const TEST_SUPPORT_FILES: readonly TestSupportEntry[] = [
  {
    file: "s3v3/deviceConformance.ts",
    reason: "设备一致性场景生成器（10 场景契约），只被 electron/s3v3/*.test.ts 与 src/mobile 的测试 import；含 vitest 依赖，故不进产物。",
  },
  {
    file: "s3v3/fileDeviceStore.ts",
    reason: "文件版 DeviceStore 测试替身（给 deviceConformance 用），无生产调用点。",
  },
  {
    file: "portable/zipTestReader.ts",
    reason: "便携包（.zip.lln）测试用的 zip 读取器，仅测试解包断言使用。",
  },
  {
    file: "testing/sourceText.ts",
    reason: "测试专用源码工具（剥注释后再做文本断言 / 扫 import）；被 architecture、buildContract、aiThinkingIpc 三个门禁共用，不进产物。",
  },
];

// ---------------------------------------------------------------------------
// import 扫描（注释剥离复用 electron/testing/sourceText.ts，与 buildContract/aiThinkingIpc 同一实现）
// 覆盖三种形态：静态 import/export-from、动态 import("literal")、**副作用 import "./x.js"**
// （最后一种原先漏扫：`import "./x.js"` 没有 from，会绕过全部方向规则）。
// ---------------------------------------------------------------------------

const STATIC_IMPORT_RE = /\b(?:import|export)\b\s+([\s\S]*?)\s+from\s*["']([^"']+)["']/g;
const DYNAMIC_IMPORT_RE = /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g;
const SIDE_EFFECT_IMPORT_RE = /\bimport\s*["']([^"']+)["']/g;

interface ImportRef {
  readonly file: string;
  readonly spec: string;
}

function collectFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectFiles(full, out);
    } else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) {
      out.push(full);
    }
  }
  return out;
}

/** 相对 spec 的磁盘真实路径（TS 的 `.js` spec 指向 `.ts` 源文件）。 */
function resolveSpec(fromFile: string, spec: string): string {
  const abs = path.resolve(path.dirname(fromFile), spec);
  if (fs.existsSync(abs) && fs.statSync(abs).isFile()) return abs;
  const tsVariant = abs.replace(/\.js$/, ".ts");
  if (fs.existsSync(tsVariant)) return tsVariant;
  const tsxVariant = abs.replace(/\.js$/, ".tsx");
  if (fs.existsSync(tsxVariant)) return tsxVariant;
  return abs;
}

function importsOf(file: string): string[] {
  const source = stripComments(fs.readFileSync(file, "utf8"));
  const specs: string[] = [];
  for (const match of source.matchAll(STATIC_IMPORT_RE)) specs.push(match[2]);
  for (const match of source.matchAll(DYNAMIC_IMPORT_RE)) specs.push(match[1]);
  for (const match of source.matchAll(SIDE_EFFECT_IMPORT_RE)) specs.push(match[1]);
  return specs;
}

function electronRelative(absFile: string): string {
  return path.relative(ELECTRON_DIR, absFile).split(path.sep).join("/");
}

function repoRelative(absFile: string): string {
  return path.relative(ROOT, absFile).split(path.sep).join("/");
}

function layerOf(relToElectron: string): Layer {
  const segments = relToElectron.split("/");
  if (segments.length === 1) return relToElectron === "main.ts" ? "entry" : "domain";
  return segments[0] as Subdir;
}

const FILES = collectFiles(ELECTRON_DIR);
const RELATIVE_IMPORTS: ImportRef[] = [];
const BARE_IMPORTS: ImportRef[] = [];
const UNRESOLVED: string[] = [];
for (const file of FILES) {
  for (const spec of importsOf(file)) {
    const ref = { file: electronRelative(file), spec };
    if (!spec.startsWith(".")) { BARE_IMPORTS.push(ref); continue; }
    RELATIVE_IMPORTS.push(ref);
    const resolved = resolveSpec(file, spec);
    if (!fs.existsSync(resolved)) UNRESOLVED.push(`${ref.file} → ${spec}`);
  }
}

describe("主进程分层：扫描器自检", () => {
  it("相对导入全部能解析到真实文件（扫描器不产生假条目）", () => {
    expect(UNRESOLVED, "以下相对导入解析不到文件：\n" + UNRESOLVED.join("\n")).toEqual([]);
  });

  it("扫到了预期的规模（防止扫描器静默失效）", () => {
    // 实测基线：146 个非测试文件、相对导入 ~360 条。给下界而不是精确值：新增文件不该红，
    // 但扫描器坏掉（例如注释剥离吃掉全部 import）必须红。
    expect(FILES.length).toBeGreaterThan(140);
    expect(RELATIVE_IMPORTS.length).toBeGreaterThan(300);
    expect(BARE_IMPORTS.length).toBeGreaterThan(150);
  });
});

describe("R1 入口唯一：electron/main.ts 只能出、不能入", () => {
  it("没有任何生产文件 import main.ts", () => {
    const importers = RELATIVE_IMPORTS
      .filter((ref) => repoRelative(resolveSpec(path.join(ELECTRON_DIR, ref.file), ref.spec)) === "electron/main.ts")
      .map((ref) => ref.file);
    expect(importers, "main.ts 必须是唯一入口，被 import 说明有模块反向依赖装配层").toEqual([]);
  });
});

describe("R2 一级目录登记制", () => {
  it("electron/ 下的一级目录都已在 REGISTERED_SUBDIRS 登记", () => {
    const actual = new Set<string>();
    for (const file of FILES) {
      const rel = electronRelative(file);
      if (rel.includes("/")) actual.add(rel.split("/")[0]);
    }
    const unregistered = [...actual].filter((dir) => !(REGISTERED_SUBDIRS as readonly string[]).includes(dir));
    expect(unregistered, "新增一级目录必须在 REGISTERED_SUBDIRS + ALLOWED_DEPENDENCIES 登记（写清职责与允许依赖）").toEqual([]);
  });

  it("ALLOWED_DEPENDENCIES 与 REGISTERED_SUBDIRS 一一对应（没有只登记一半的层）", () => {
    const declared = Object.keys(ALLOWED_DEPENDENCIES).filter((layer) => layer !== "entry" && layer !== "domain");
    expect([...declared].sort()).toEqual([...REGISTERED_SUBDIRS].sort());
  });
});

describe("R3 跨层依赖只沿登记方向", () => {
  it("没有未登记的跨层 import", () => {
    const violations: string[] = [];
    for (const ref of RELATIVE_IMPORTS) {
      const target = resolveSpec(path.join(ELECTRON_DIR, ref.file), ref.spec);
      const targetRel = electronRelative(target);
      if (targetRel.startsWith("..")) continue; // 指向 electron/ 之外（src/** 由 R4 管）
      const from = layerOf(ref.file);
      const to = layerOf(targetRel);
      if (from === to) continue;
      if (!ALLOWED_DEPENDENCIES[from].includes(to)) {
        violations.push(`${ref.file} → ${targetRel}（${from} → ${to} 未登记；${from} 允许：${ALLOWED_DEPENDENCIES[from].join(", ")}）`);
      }
    }
    expect(violations, "跨层依赖必须登记在 ALLOWED_DEPENDENCIES 并写明理由：\n" + violations.join("\n")).toEqual([]);
  });
});

describe("R4 electron → src 只走白名单", () => {
  const toSrc = RELATIVE_IMPORTS
    .map((ref) => ({ ref, target: repoRelative(resolveSpec(path.join(ELECTRON_DIR, ref.file), ref.spec)) }))
    .filter((entry) => entry.target.startsWith("src/"));

  it("src/core/** 之外，每条 src 依赖都能在 SRC_IMPORT_ALLOWLIST 找到条目", () => {
    const violations: string[] = [];
    for (const { ref, target } of toSrc) {
      if (target.startsWith("src/core/")) continue;
      const allowed = SRC_IMPORT_ALLOWLIST.some((entry) => target === entry.target);
      if (!allowed) violations.push(`${ref.file} → ${target}`);
    }
    expect(
      violations,
      "主进程依赖渲染层是方向倒置：每条都必须进 SRC_IMPORT_ALLOWLIST 并写理由（纯共享函数才允许，不要复用 UI）：\n" + violations.join("\n"),
    ).toEqual([]);
  });

  it("禁止的渲染层目录一条都不许出现", () => {
    const FORBIDDEN = ["src/mobile/", "src/components/", "src/hooks/", "src/desktop/", "src/styles/", "src/App"];
    const hits = toSrc.filter((entry) => FORBIDDEN.some((prefix) => entry.target.startsWith(prefix)));
    expect(hits.map((hit) => `${hit.ref.file} → ${hit.target}`), "主进程不得依赖渲染层专属目录（移动端/组件/hooks/桌面壳/样式）").toEqual([]);
  });

  it("白名单条目没有失效的（stale 必须删掉）", () => {
    const used = new Set(toSrc.map((entry) => entry.target));
    const stale = SRC_IMPORT_ALLOWLIST
      .map((entry) => entry.target)
      .filter((target) => !used.has(target));
    expect(stale, "以下白名单条目已无引用：删掉对应条目（否则白名单会越长越松）").toEqual([]);
  });

  it("白名单只允许精确文件：禁止目录前缀形态（一条登记会放行整棵子树）", () => {
    // 261116 review P1-4：原实现允许 `target.endsWith("/")` 的目录前缀，等于「登记一次、以后整棵子树都放行」，
    // 白名单会越长越松。现在只接受文件级 target；要加新依赖必须逐个文件登记。
    const dirEntries = SRC_IMPORT_ALLOWLIST.filter((entry) => entry.target.endsWith("/")).map((entry) => entry.target);
    expect(dirEntries, "白名单必须精确到文件，不允许目录前缀").toEqual([]);
  });

  it("每条白名单都必须写理由（空理由 = 未登记）", () => {
    for (const entry of SRC_IMPORT_ALLOWLIST) {
      expect(entry.reason.trim().length, `白名单 ${entry.target} 缺少理由`).toBeGreaterThan(20);
    }
  });
});

describe("R5 可达性：没有「写了没接进去」的死代码", () => {
  it("不可达集合恰好等于 TEST_SUPPORT_FILES", () => {
    const reachable = new Set<string>();
    const queue = [path.join(ELECTRON_DIR, "main.ts")];
    while (queue.length > 0) {
      const file = queue.pop() as string;
      if (reachable.has(file) || !fs.existsSync(file)) continue;
      reachable.add(file);
      for (const spec of importsOf(file)) {
        if (!spec.startsWith(".")) continue;
        const resolved = resolveSpec(file, spec);
        if (resolved.startsWith(ELECTRON_DIR) && resolved.endsWith(".ts")) queue.push(resolved);
      }
    }
    const unreachable = FILES.filter((file) => !reachable.has(file)).map(electronRelative).sort();
    const expected = TEST_SUPPORT_FILES.map((entry) => entry.file).sort();
    expect(
      unreachable,
      "有非测试模块从 electron/main.ts 不可达：要么接进入口，要么登记为测试支撑（TEST_SUPPORT_FILES）并写理由。",
    ).toEqual(expected);
  });

  it("测试支撑文件不得 import electron（否则会被误当生产代码）", () => {
    for (const entry of TEST_SUPPORT_FILES) {
      const specs = importsOf(path.join(ELECTRON_DIR, entry.file));
      expect(specs, `${entry.file} 是测试支撑，不应 import electron 运行期 API`).not.toContain("electron");
    }
  });
});

describe("R6 external 从 dependencies 派生（A-6）", () => {
  /**
   * 运行期依赖清单的唯一来源 = package.json `dependencies`（vite.config.ts 也是读它）。
   *
   * ⚠️ 261117 打包瘦身：**渲染层专用**的重包（`@univerjs/*` / `perfect-freehand` / `rxjs` 等）已移到
   * `devDependencies` —— 它们只被 `src/**` import、早被 vite 打进 `dist`，留在 `dependencies` 只会被
   * electron-builder 原样塞进 asar（实测 @univerjs 子树 123MB）。**这不是放宽判据**：R6 的规则一字未改，
   * 只是「主进程 runtime deps 清单」本身收窄了；下面新增的两条守则是防它涨回去。
   */
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  const runtimeDeps = Object.keys(pkg.dependencies ?? {});
  /** 测试支撑文件不进产物 ⇒ 它们的 import（如 vitest）不受 external 约束。 */
  const testSupport = new Set(TEST_SUPPORT_FILES.map((entry) => entry.file));

  it("生产代码的每个 bare import 都能被判为 external（否则会被打进 bundle，打包后才炸）", () => {
    const violations = BARE_IMPORTS
      .filter((ref) => !testSupport.has(ref.file))
      .filter((ref) => !isExternal(ref.spec, runtimeDeps))
      .map((ref) => `${ref.file} → ${ref.spec}`);
    expect(
      violations,
      "以下 bare import 既不是 node:/electron，也不在 package.json dependencies（也不是 @smithy/*）："
      + "它们会被打进 bundle。原生模块/带二进制的包必须先登记进 dependencies。：\n" + violations.join("\n"),
    ).toEqual([]);
  });

  it("dependencies 里的每个包都被判为 external（派生规则没有漏掉传递依赖白名单）", () => {
    for (const dep of runtimeDeps) {
      expect(isExternal(dep, runtimeDeps), `${dep} 在 dependencies 里却判为可打包`).toBe(true);
      expect(isExternal(`${dep}/sub`, runtimeDeps), `${dep}/sub 子路径也应 external`).toBe(true);
    }
    expect(isExternal("@smithy/service-client", runtimeDeps), "@aws-sdk 的传递依赖靠 @smithy/ 前缀兜底").toBe(true);
    expect(isExternal("node:fs", runtimeDeps)).toBe(true);
    expect(isExternal("electron", runtimeDeps)).toBe(true);
    expect(isExternal("electron/main", runtimeDeps)).toBe(true);
    expect(isExternal("lodash", runtimeDeps), "未登记的第三方包不该被 external（会被打进 bundle 才是对的）").toBe(false);
  });

  it("反方向：dependencies 里的每个包都必须被主进程生产代码 import（否则只是白塞进 asar）", () => {
    // 打包瘦身的核心不变量：**dependencies = 主进程运行时真正 require 的包**。
    // 渲染层专用包一旦回流到这里，asar 会立刻按 node_modules 原样膨胀（@univerjs 曾占 123MB）。
    const packages = new Set<string>();
    for (const ref of BARE_IMPORTS) {
      if (testSupport.has(ref.file)) continue;
      const spec = ref.spec;
      if (spec.startsWith("node:") || spec === "electron" || spec.startsWith("electron/")) continue;
      if (spec.startsWith("@smithy/")) continue; // @aws-sdk 的传递依赖，不单独声明
      const parts = spec.split("/");
      packages.add(spec.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0]);
    }
    const unused = runtimeDeps.filter((dep) => !packages.has(dep));
    expect(
      unused,
      "以下 dependencies 没有被任何主进程生产文件 import：它们只会被 electron-builder 原样打包进 asar。"
      + "如果它们是渲染层专用（已进 dist）⇒ 移到 devDependencies；如果确有运行时用途 ⇒ 在 buildTarget/本文档登记原因。",
    ).toEqual([]);
  });

  it("防回涨：渲染层专用重包不得回到 dependencies（打包瘦身 261117）", () => {
    const RENDERER_ONLY = ["@univerjs/", "perfect-freehand", "rxjs"] as const;
    const back = runtimeDeps.filter((dep) => RENDERER_ONLY.some((prefix) => (prefix.endsWith("/") ? dep.startsWith(prefix) : dep === prefix)));
    expect(back, "这些包只被 src/** import（已打进 dist），放在 dependencies 会让 asar 多出 ~123MB").toEqual([]);
    // 也不能悄悄删掉：构建期 vite 仍需要它们，必须在 devDependencies 里。
    for (const dep of Object.keys(pkg.devDependencies ?? {})) {
      if (!dep.startsWith("@univerjs/") && dep !== "perfect-freehand" && dep !== "rxjs") continue;
      expect(pkg.dependencies?.[dep], dep + " 必须留在 devDependencies").toBeUndefined();
    }
    expect(pkg.devDependencies?.["rxjs"], "rxjs 是 @univerjs 的 peer，必须作为 devDependency 保留").toBeTruthy();
  });

  it("vite.config.ts 仍从 package.json dependencies 派生 external（没有改回硬编码清单）", () => {
    const viteConfig = fs.readFileSync(path.join(ROOT, "vite.config.ts"), "utf8");
    expect(viteConfig, "external 判据必须 import 共享契约模块").toContain("isMainProcessExternal");
    expect(viteConfig, "必须从 package.json 读 dependencies 并注入").toContain("package.json");
    expect(viteConfig).toContain("mainPkg.dependencies");
    // 防回退：不允许出现「把包名逐个写进 external 数组」的旧写法
    expect(/external:\s*\[[^\]]*(better-sqlite3|sharp|electron-log)/.test(viteConfig), "external 不允许硬编码包名清单").toBe(false);
  });
});
