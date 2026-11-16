import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Android「卸载保留数据」护栏（261117 用户点单）：
 * ① manifest 必须开 hasFragileUserData（Android 10+ 系统卸载对话框的「保留应用数据」）；
 * ② allowBackup 保持 false、且不得悄悄启用 Auto Backup（启用就要同时改 docs/mobile/UNINSTALL-DATA.md §3 与隐私说明）；
 * ③ 设置「关于」页的「卸载与换机」备份引导不得被删；
 * ④ 实现/限制文档必须在（系统卸载对话框的保留选项只在 Android 10+ 出现）。
 */
const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

describe("Android 卸载保留数据（261117）", () => {
  const manifest = read("../../../android/app/src/main/AndroidManifest.xml");

  it("application 声明 android:hasFragileUserData=\"true\"", () => {
    expect(manifest).toContain('android:hasFragileUserData="true"');
  });

  it("allowBackup 保持 false，且不配置 fullBackupContent / dataExtractionRules（理由见文档 §3）", () => {
    expect(manifest).toContain('android:allowBackup="false"');
    expect(manifest).not.toContain("android:fullBackupContent");
    expect(manifest).not.toContain("android:dataExtractionRules");
  });

  it("设置「关于」页保留「卸载与换机」备份引导（便携包 / 保留数据选项 / 签名约束）", () => {
    const about = read("./BasicSettingsSections.tsx");
    expect(about).toContain("卸载与换机");
    expect(about).toContain("保留应用数据");
    expect(about).toContain("便携包");
    // 261117 调研复核：启动器卸载通常也走系统确认框（未证实「一定不弹」）⇒ 文案不能写死；重装需同签名。
    expect(about).toContain("系统卸载确认框");
    expect(about).not.toContain("从桌面图标直接卸载");
    expect(about).toContain("同一签名");
  });

  it("文档写明能力与 Android 10+ 限制", () => {
    const doc = read("../../../docs/mobile/UNINSTALL-DATA.md");
    expect(doc).toContain("hasFragileUserData");
    expect(doc).toContain("Android 10");
    expect(doc).toContain("25MB");
  });
});
