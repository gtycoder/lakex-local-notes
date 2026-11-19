/**
 * cameraCaptureStub 自证（§7#21 口径）：不跑真机也必须证明**桩真的会命中**——
 * 把注入脚本求值在假 window/Capacitor 上，走与设备相同的调用形状（nativePromise(plugin, method, options)）：
 *  · install 后 CameraCapture.takePhoto / Filesystem.readFile 必须被拦截并计数（已知命中的样本）；
 *  · 未拦截的插件调用必须原样透传（别把整个原生桥掐死）；
 *  · canary（走 Capacitor.Plugins.* 代理链路）必须 ok:true 且计数 +1；
 *  · restore 后 nativePromise 必须回到原函数、桩全局必须消失；
 *  · fixture 字节必须是合法 PNG（坏样本先红，不许静默）。
 */
import { describe, expect, it } from "vitest";
import {
  PNG_BASE64,
  STUB_PHOTO_PATH,
  assertFixture,
  buildCanaryScript,
  buildInstallScript,
  buildRestoreScript,
} from "./cameraCaptureStub.mjs";

/** 假 window：nativePromise 是被分发层 call-time 查找的那一个（等价 native-bridge.js 注入的实现）。 */
function fakeWorld() {
  const calls: Array<[string, string]> = [];
  const orig = (pluginName: string, methodName: string) => {
    calls.push([pluginName, methodName]);
    return Promise.resolve({ passthrough: true });
  };
  const window: any = {
    Capacitor: {
      nativePromise: orig,
      Plugins: {
        // 设备上的真实代理分发形状：方法调用最终落回 Capacitor.nativePromise(plugin, method, options)。
        CameraCapture: { takePhoto: (options: unknown) => window.Capacitor.nativePromise("CameraCapture", "takePhoto", options) },
        Filesystem: { readFile: (options: unknown) => window.Capacitor.nativePromise("Filesystem", "readFile", options) },
      },
    },
  };
  return { window, orig, calls };
}

const run = (script: string, window: unknown): any => new Function("window", "return (" + script + ");")(window);

describe("cameraCaptureStub（拍照链路新桩点）", () => {
  it("fixture 是合法 PNG（样本自检）", () => {
    expect(assertFixture()).toBeGreaterThan(0);
    expect(Buffer.from(PNG_BASE64, "base64").subarray(0, 4)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  });

  it("install 拦截 takePhoto/readFile/deleteFile，其余透传（不掐死整座原生桥）", async () => {
    const { window, orig, calls } = fakeWorld();
    const installed = run(buildInstallScript(), window);
    expect(installed.ok).toBe(true);

    const photo = await window.Capacitor.nativePromise("CameraCapture", "takePhoto", {});
    expect(photo).toMatchObject({ cancelled: false, path: STUB_PHOTO_PATH, mimeType: "image/png" });
    expect(window.__lakeCameraStub.state.photoHits).toBe(1);

    const read = await window.Capacitor.nativePromise("Filesystem", "readFile", { path: STUB_PHOTO_PATH, directory: "DATA" });
    expect(read.data).toBe(PNG_BASE64);
    expect(window.__lakeCameraStub.state.readHits).toBe(1);

    await window.Capacitor.nativePromise("Filesystem", "deleteFile", { path: STUB_PHOTO_PATH });
    expect(window.__lakeCameraStub.state.readHits).toBe(1); // deleteFile 不计 read

    const other = await window.Capacitor.nativePromise("AssetSync", "downloadRemoteAsset", {});
    expect(other).toEqual({ passthrough: true });
    expect(calls).toEqual([["AssetSync", "downloadRemoteAsset"]]);
    expect(window.Capacitor.nativePromise).not.toBe(orig);
  });

  it("canary 走真实代理链路命中（§7#21 已知样本自证）", async () => {
    const { window } = fakeWorld();
    run(buildInstallScript(), window);
    const canary = await run(buildCanaryScript(), window);
    expect(canary).toMatchObject({ ok: true, photoHits: 1, readHits: 1, photoPath: STUB_PHOTO_PATH });
  });

  it("canary 在桩没打上/重复打桩时如实报错（看不见比报错危险）", async () => {
    const { window } = fakeWorld();
    expect(await run(buildCanaryScript(), window)).toMatchObject({ ok: false, reason: "stub-not-installed" });
    run(buildInstallScript(), window);
    expect(run(buildInstallScript(), window)).toMatchObject({ ok: false, reason: "already-installed" });
  });

  it("restore 原样放回 nativePromise 并清掉桩全局", async () => {
    const { window, orig } = fakeWorld();
    run(buildInstallScript(), window);
    const restored = run(buildRestoreScript(), window);
    expect(restored).toMatchObject({ ok: true, stubGone: true, restored: true, wasInstalled: true });
    expect(window.Capacitor.nativePromise).toBe(orig);
    expect(window.__lakeCameraStub).toBeUndefined();
    // 幂等：再还原不炸。
    expect(run(buildRestoreScript(), window)).toMatchObject({ ok: true, wasInstalled: false });
  });

  it("注入脚本不含反斜杠转义（§7#21：正则/转义一律不进注入脚本）", () => {
    for (const script of [buildInstallScript(), buildCanaryScript(), buildRestoreScript()]) {
      expect(script.includes("\\")).toBe(false);
    }
  });
});
