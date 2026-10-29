import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
const F = readFileSync(new URL("./native/assetFs.ts", import.meta.url), "utf8");
const P = readFileSync(new URL("../../android/app/src/main/java/com/lakexlocalnotes/android/AssetSyncPlugin.kt", import.meta.url), "utf8");
describe("移动端资产文件操作原生化（261026）", () => {
  it("AssetSync 插件提供本地资产读写/删除/列目录（原子写）", () => {
    for (const name of ["writeLocal", "readLocal", "removeLocal", "listLocal"]) {
      expect(P).toContain("fun " + name + "(call: PluginCall)");
    }
    expect(P).toContain("atomicWriteBytes");
  });
  it("assetFs 优先走原生，旧 APK/非原生回退 Filesystem", () => {
    expect(F).toContain("nativeAssetFsAvailable");
    expect(F).toContain("NativeAssetSync.writeLocal");
    expect(F).toContain("NativeAssetSync.readLocal");
    expect(F).toContain("NativeAssetSync.listLocal");
    // 回退分支仍在（旧 APK 没有这些方法时行为不变）
    expect(F).toContain("Filesystem.writeFile");
  });
});
