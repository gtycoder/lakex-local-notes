import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * 安全模式**接线**护栏（Batch3-B）：判定/文件逻辑在 safeMode.test.ts 里做行为测试，
 * 这里只钉「哪些启动动作被跳过」与「三处 IPC 一致」，防止日后重构把某条静默接回来。
 *
 * 背景：崩溃标记（crash-marker.json）此前只写日志提示，没有安全模式 ⇒ 崩溃循环里用户既没界面也没出口。
 */
const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const MAIN = read("./main.ts");
const PRELOAD = read("./preload.cjs");
const WEB = read("./webApiServer.ts");
const NATIVE = read("../src/lib/native.ts");
const APP = read("../src/App.tsx");
const BOOTSTRAP = read("../src/hooks/useBootstrap.ts");
const BANNER = read("../src/components/app/SafeModeBanner.tsx");
const SAFE_MODE = read("./safeMode.ts");

describe("主进程：安全模式判定 + 跳过自动动作（Batch3-B）", () => {
  it("判定接在读取崩溃标记之后（纯函数 + 持久状态）", () => {
    expect(MAIN).toContain("decideSafeMode({ previous: readSafeModeState(userDataDir), crashMarker");
    expect(MAIN).toMatch(/safeModeActive = safeModeDecision\.active;/);
    expect(MAIN).toMatch(/if \(safeModeDecision\.active\) \{\n\s+writeSafeModeState\(userDataDir, safeModeDecision\.state\);/);
  });

  it("不自动同步：定时器 / 开应用对齐+续传 / 退出前同步 三处都跳过", () => {
    // ① interval 定时器
    expect(MAIN).toMatch(/if \(safeModeActive\) return;\n\s+if \(!autoSyncAllowed\) return;/);
    // ② 开启应用时对齐 + 未完成同步续传
    expect(MAIN).toContain("if (!safeModeActive && autoSyncAllowed && canTouchNetwork(");
    // ③ before-quit 那次
    expect(MAIN).toMatch(/if \(safeModeActive\) return;\n\s+const cfg = store\.getSyncSettings\(\);/);
  });

  it("安全模式不清崩溃标记（诊断线索保留）；正常启动才消费", () => {
    expect(MAIN).toContain("if (startupDecision.crashMarker && !safeModeActive) removeCrashMarker(userDataDir);");
    expect(MAIN).toContain("if (!safeModeActive) removeSafeModeState(userDataDir);");
  });

  it("状态文件在 userData 下、不进 git（仓内不出现该文件）", () => {
    expect(SAFE_MODE).toContain('export const SAFE_MODE_FILE = "safe-mode.json";');
    expect(SAFE_MODE).toContain("path.join(userDataDir, SAFE_MODE_FILE)");
  });
});

describe("渲染层：不恢复标签页 / 不预热内核 / 顶部提示条", () => {
  it("启动时安全模式跳过标签恢复", () => {
    expect(BOOTSTRAP).toMatch(/savedSession && !safeMode\?\.active \? sanitizeTabSession/);
  });

  it("内核 chunk 预取按安全模式判定（异步问一次主进程）", () => {
    expect(APP).toContain("<SafeModeBanner />");
    expect(APP).toMatch(/if \(!state\.active\) prefetchEditorKernel\(\);/);
  });

  it("提示条文案与两个出口（复制诊断 / 退出安全模式）", () => {
    expect(BANNER).toContain("安全模式：已关闭自动同步与标签恢复，用于排查崩溃");
    expect(BANNER).toContain(">复制诊断<");
    expect(BANNER).toContain("退出安全模式（下次正常启动）");
    expect(BANNER).toContain("data-safe-mode-banner");
  });
});

describe("IPC 三处一致（注册 / preload / native / Web）", () => {
  it("三条通道在四处都有", () => {
    for (const channel of ["get_safe_mode_state", "exit_safe_mode", "copy_safe_mode_diagnostics"]) {
      expect(PRELOAD, "preload 缺 " + channel).toContain('invoke("' + channel + '")');
      expect(WEB, "WEB_METHODS 缺 " + channel).toContain('"' + channel + '"');
    }
    expect(NATIVE).toContain("getSafeModeState: () => api().getSafeModeState()");
    expect(NATIVE).toContain("exitSafeMode: () => api().exitSafeMode()");
    expect(NATIVE).toContain("copySafeModeDiagnostics: () => api().copySafeModeDiagnostics()");
    // 注册侧在 electron/ipc/registerSafeMode.ts（由 ipcChannelParity.test.ts 统一校验 ①↔②↔③）。
    expect(read("./ipc/registerSafeMode.ts")).toContain('ipc.handle("get_safe_mode_state"');
  });
});
