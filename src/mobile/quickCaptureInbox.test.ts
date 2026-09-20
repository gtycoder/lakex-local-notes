/**
 * 原生秒开「新建小记」框（QuickCaptureActivity）+ inbox 导入护栏（260920）。
 *
 * 链路：长按快捷方式 → QuickCaptureActivity（原生，不走 WebView/内核）→ 提交写
 *   filesDir/quick-capture-inbox/<uuid>.txt（草稿存 SharedPreferences）→ App 启动/回前台
 *   importQuickCaptureInbox() 读出来建成小记并删文件。
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

describe("原生秒开速记框 + inbox 导入", () => {
  it("原生 Activity 提交写 inbox、草稿本地保存", () => {
    const java = read("../../android/app/src/main/java/com/lakenotes/mobile/QuickCaptureActivity.java");
    expect(java).toMatch(/quick-capture-inbox/);
    expect(java).toMatch(/getSharedPreferences/);
    expect(java).toMatch(/showSoftInput/);
  });

  it("Manifest 声明了 QuickCaptureActivity（快捷方式直达）", () => {
    const mf = read("../../android/app/src/main/AndroidManifest.xml");
    expect(mf).toMatch(/android:name="\.QuickCaptureActivity"/);
    expect(mf).toMatch(/stateVisible/);
  });

  it("App 启动/回前台导入 inbox，正文走 bridge.createQuickNote", () => {
    const app = read("./MobileApp.tsx");
    expect(app).toMatch(/importQuickCaptureInbox\(/);
    expect(app).toMatch(/appStateChange/);
    const inbox = read("./quickCaptureInbox.ts");
    expect(inbox).toMatch(/bridge\.createQuickNote\(/);
    expect(inbox).toMatch(/Directory\.Data/);
    expect(inbox).toMatch(/deleteFile/);
  });
});
