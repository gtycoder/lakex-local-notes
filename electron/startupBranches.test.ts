import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it, vi } from "vitest";

import { decideQuickNotesAvailability, type QuickNotesAvailability } from "./quickNotesAvailability.js";
import { decideSafeMode } from "./safeMode.js";
import {
  decideStartupCheckDepth,
  decideStartupRecovery,
  type CrashMarker,
  type StartupRecoveryCause,
  type StartupRecoveryDecision,
} from "./startupRecovery.js";

/**
 * 启动分支穷尽性（批次 A-4，2026-11-16）。
 *
 * 出处：`docs/arch/ELECTRON-LAYERING-AUDIT.md` §3 判据 #8 与 §5 批次 A ④。
 *
 * 审计结论：本仓启动期有 5 个**正交**判定（检查深度 / 恢复模式 / 安全模式 / 小记库可用性 /
 * 渲染层加载模式），它们决定「本次进程走哪条启动路径」。判据本身是纯函数，但**没有任何测试
 * 证明「每条分支都可达、且都被 main.ts 真的接上了」** —— 于是有两种静默退化：
 * ① 某个分支永远走不到（新增判据写死成常量，或被上游 if 挡掉）＝ 死分支；
 * ② 新增了一个分支值（联合类型加一个成员），但 main.ts 的装配没跟（该分支没被消费）。
 *
 * 本文件用两种手段闭合：
 * - **类型穷尽**：`satisfies Record<Union, true>` —— 联合类型新增成员时 **typecheck 直接红**
 *   （`npx tsc --noEmit` 覆盖 `electron/**`，本文件在覆盖范围内），不需要等运行时；
 * - **可达性**：每个分支值至少被一组输入产出一次（运行时断言），并断言
 *   `main.ts` 引用了全部 5 个判据 + 恢复模式先于建主窗口（顺序不变量）。
 *
 * ⚠️ 这里**只**证明「分支可达 + 接线完整」，具体判定语义仍由各自的单测负责
 * （`startupRecovery.test.ts` / `safeMode.test.ts` / `quickNotesAvailability.test.ts`）。
 */

// boot/paths.ts 在模块加载期读 app.isPackaged 与 LAKE_RENDERER，所以用可变 app 桩 + resetModules
// 来覆盖两条分支（这正是要证明「vite / scheme 都可达」的地方）。
const electronApp = vi.hoisted(() => ({ isPackaged: false }));
vi.mock("electron", () => ({
  app: {
    get isPackaged(): boolean {
      return electronApp.isPackaged;
    },
    getPath: (): string => "/tmp/lakex-startup-branches",
    setPath: (): void => {},
  },
}));

type PathsModule = typeof import("./boot/paths.js");

async function loadPaths(input: { isPackaged: boolean; rendererEnv?: string }): Promise<PathsModule> {
  vi.resetModules();
  electronApp.isPackaged = input.isPackaged;
  const previous = process.env.LAKE_RENDERER;
  if (input.rendererEnv === undefined) delete process.env.LAKE_RENDERER;
  else process.env.LAKE_RENDERER = input.rendererEnv;
  try {
    return await import("./boot/paths.js");
  } finally {
    if (previous === undefined) delete process.env.LAKE_RENDERER;
    else process.env.LAKE_RENDERER = previous;
  }
}

// ---------------------------------------------------------------------------
// 类型穷尽：联合类型一旦新增成员，下面任一个 satisfies 会让 tsc 报错。
// ---------------------------------------------------------------------------
const RECOVERY_MODES = { recovery: true, normal: true } satisfies Record<StartupRecoveryDecision["mode"], true>;
const RECOVERY_CAUSES = { open: true, integrity: true, none: true } satisfies Record<StartupRecoveryCause, true>;
const CHECK_DEPTHS = { light: true, deep: true } satisfies Record<ReturnType<typeof decideStartupCheckDepth>, true>;
const QUICK_NOTES_MODES = { ok: true, degraded: true } satisfies Record<QuickNotesAvailability["mode"], true>;
const RENDERER_MODES = { vite: true, scheme: true } satisfies Record<PathsModule["rendererMode"], true>;

describe("分支穷尽：每个判定值都可达（死分支会让 satisfies 之外的运行时断言红）", () => {
  it("decideStartupCheckDepth：light / deep 都可达", () => {
    const produced = new Set<string>();
    produced.add(decideStartupCheckDepth({})); // 无历史 ⇒ 深检（保守）
    produced.add(decideStartupCheckDepth({ previousRun: { lastRun: "dirty", at: new Date().toISOString() } }));
    produced.add(decideStartupCheckDepth({ previousRun: { lastRun: "clean", at: new Date().toISOString() } })); // light
    produced.add(decideStartupCheckDepth({ crashMarker: crashMarker({ occurrences: 1 }) })); // 有标记 ⇒ 深检
    expect([...produced].sort()).toEqual(Object.keys(CHECK_DEPTHS).sort());
  });

  it("decideStartupRecovery：normal / recovery(open) / recovery(integrity) 都可达", () => {
    const produced = new Set<string>();
    const causes = new Set<string>();
    const normal = decideStartupRecovery({});
    const open = decideStartupRecovery({ openError: new Error("boom") });
    const integrity = decideStartupRecovery({
      integrity: { ok: false, detail: "quick_check 失败", quickCheck: "err", foreignKeyErrors: 0, depth: "deep" },
    });
    for (const decision of [normal, open, integrity]) {
      produced.add(decision.mode);
      causes.add(decision.cause);
    }
    expect([...produced].sort()).toEqual(Object.keys(RECOVERY_MODES).sort());
    expect([...causes].sort()).toEqual(Object.keys(RECOVERY_CAUSES).sort());
    // 打开异常优先于完整性（顺序不变量：打不开就谈不上完整性）
    expect(decideStartupRecovery({
      openError: new Error("boom"),
      integrity: { ok: false, detail: "也失败", quickCheck: "err", foreignKeyErrors: 0, depth: "deep" },
    }).cause).toBe("open");
  });

  it("decideSafeMode：active / inactive 都可达（active 有两条独立入口）", () => {
    const produced = new Set<boolean>();
    // ① 上次已进入且用户没显式退出
    produced.add(decideSafeMode({ previous: { active: true, reason: "上次进入" } }).active);
    // ② 崩溃反复出现（occurrences ≥ 阈值）
    produced.add(decideSafeMode({ crashMarker: crashMarker({ occurrences: 2 }) }).active);
    // ③ 单次崩溃 ⇒ 不进安全模式
    produced.add(decideSafeMode({ crashMarker: crashMarker({ occurrences: 1 }) }).active);
    // ④ 全新启动
    produced.add(decideSafeMode({}).active);
    expect([...produced].sort()).toEqual([false, true]);
  });

  it("decideQuickNotesAvailability：ok / degraded 都可达", () => {
    const produced = new Set<string>();
    produced.add(decideQuickNotesAvailability({}).mode);
    produced.add(decideQuickNotesAvailability({ openError: new Error("quick-notes 坏了") }).mode);
    expect([...produced].sort()).toEqual(Object.keys(QUICK_NOTES_MODES).sort());
  });

  it("rendererMode：vite（dev）/ scheme（打包版）/ scheme（LAKE_RENDERER 覆盖）都可达", async () => {
    const produced = new Set<string>();
    produced.add((await loadPaths({ isPackaged: false })).rendererMode);
    produced.add((await loadPaths({ isPackaged: true })).rendererMode);
    produced.add((await loadPaths({ isPackaged: false, rendererEnv: "scheme" })).rendererMode);
    expect([...produced].sort()).toEqual(Object.keys(RENDERER_MODES).sort());
  });
});

describe("接线完整：main.ts 消费了全部启动判据，且顺序不变量成立", () => {
  // 不 import main.ts（会真的跑 Electron 启动流程）：只做源码文本断言。
  // C-04：启动判据散布在入口装配层（main + boot/*），文本断言合并读取；顺序断言仍锚 main.ts 自身。
  const dir = path.dirname(fileURLToPath(import.meta.url));
  const mainSource = ["main.ts", "boot/startupDecision.ts", "boot/quickNotesWiring.ts", "boot/protocolWiring.ts", "boot/recoveryWiring.ts"]
    .map((rel) => fs.readFileSync(path.join(dir, rel), "utf8"))
    .join("\n");
  const entrySource = fs.readFileSync(path.join(dir, "main.ts"), "utf8");

  it("5 个启动判据全部被 main.ts 引用（新增判据必须同时接线）", () => {
    for (const symbol of [
      "decideStartupCheckDepth(",
      "decideStartupRecovery(",
      "decideSafeMode(",
      "decideQuickNotesAvailability(",
      "rendererMode",
    ]) {
      expect(mainSource.includes(symbol), `启动装配层没有引用启动判据 ${symbol}（分支没被消费）`).toBe(true);
    }
  });

  it("顺序不变量：恢复模式先于建主窗口（且在恢复页后 return，不再继续普通启动）", () => {
    // C-04：恢复页装配 = enterStartupRecovery（boot/recoveryWiring 内部最终调 showRecoveryWindow）。
    const recoveryBranch = entrySource.indexOf('startupDecision.mode === "recovery"');
    const recoveryWindow = entrySource.indexOf("enterStartupRecovery(");
    // 261127：同名字面量还有一处 = focusOrCreateMainWindow（activate/second-instance 的补建入口，定义在
    // 启动路径之前）⇒ 取**最后一次**出现 = 普通启动路径上的那次建窗。
    const createWindow = entrySource.lastIndexOf("createWindow(mainWindowDeps())");
    expect(recoveryBranch).toBeGreaterThan(-1);
    expect(recoveryWindow).toBeGreaterThan(recoveryBranch);
    expect(createWindow, "createWindow(mainWindowDeps()) 必须在普通启动路径上").toBeGreaterThan(-1);
    expect(recoveryWindow, "恢复页必须先于建主窗口").toBeLessThan(createWindow);
    expect(entrySource.slice(recoveryWindow, createWindow), "恢复分支必须 return，不再继续普通启动").toContain("return;");
  });

  it("顺序不变量：私有协议注册与 userData 隔离都在 app ready 之前（模块顶层同步调用）", () => {
    const readyAt = mainSource.indexOf("app.whenReady()");
    expect(readyAt).toBeGreaterThan(-1);
    for (const call of ["applyUserDataPath();", "registerAppSchemePrivileges();", "installNativeSha256();"]) {
      const at = mainSource.indexOf(call);
      expect(at, `${call} 必须在 app.whenReady 之前执行`).toBeGreaterThan(-1);
      expect(at, `${call} 必须在 app.whenReady 之前执行`).toBeLessThan(readyAt);
    }
  });
});

/** 构造一个合法的 CrashMarker（类型要求 time/reason/stack/occurrences）。 */
function crashMarker(input: { occurrences: number }): CrashMarker {
  return {
    time: new Date().toISOString(),
    reason: "测试用崩溃原因",
    stack: "at test",
    occurrences: input.occurrences,
    recentTimes: [new Date().toISOString()],
  };
}
