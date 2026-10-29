// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { hostCapabilities, hostCapabilitiesFrom } from "./hostCapabilities";

interface FakeWin {
  lakeNative?: { capabilities?: Record<string, boolean> };
}

const fakeWin = () => window as unknown as FakeWin;

beforeEach(() => {
  delete fakeWin().lakeNative;
});

describe("hostCapabilitiesFrom（能力矩阵归一）", () => {
  it("未声明任何能力 → 按桌面兜底（旧实现 nativeDialog 缺省 true 一致）", () => {
    expect(hostCapabilitiesFrom(undefined)).toEqual({
      browserClient: false,
      localFileSystem: true,
      importExport: true,
      nativeDialog: true,
      windowControls: true,
      globalShortcuts: true,
    });
  });

  it("Web shim 显式声明 → 浏览器端无本机目录框/窗口控制，但导出可用", () => {
    const caps = hostCapabilitiesFrom({
      browserClient: true,
      localFileSystem: false,
      importExport: true,
      nativeDialog: false,
      windowControls: false,
      globalShortcuts: false,
    });
    expect(caps.browserClient).toBe(true);
    expect(caps.localFileSystem).toBe(false);
    expect(caps.importExport).toBe(true);
    expect(caps.nativeDialog).toBe(false);
    expect(caps.windowControls).toBe(false);
    expect(caps.globalShortcuts).toBe(false);
  });

  it("只声明 browserClient=true → 宿主专属能力按浏览器兜底（不误开目录框/窗口控制）", () => {
    const caps = hostCapabilitiesFrom({ browserClient: true });
    expect(caps.localFileSystem).toBe(false);
    expect(caps.nativeDialog).toBe(false);
    expect(caps.windowControls).toBe(false);
    expect(caps.globalShortcuts).toBe(false);
    // 缺省不把未声明的能力当成可用（旧 shim 不声明 importExport 时入口按不可用处理）
    expect(caps.importExport).toBe(false);
  });
});

describe("hostCapabilities（读桥接层）", () => {
  it("读 window.lakeNative.capabilities", () => {
    fakeWin().lakeNative = { capabilities: { browserClient: true, nativeDialog: false } };
    const caps = hostCapabilities();
    expect(caps.browserClient).toBe(true);
    expect(caps.localFileSystem).toBe(false);
  });

  it("桥接未就绪 → 与旧实现一致抛错（不静默降级）", () => {
    expect(() => hostCapabilities()).toThrow(/原生桥接未就绪/);
  });
});
