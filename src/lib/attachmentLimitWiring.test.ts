import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const DESKTOP = readFileSync(new URL("../desktop/useDesktopShell.ts", import.meta.url), "utf8");
const MOBILE = readFileSync(new URL("../mobile/MobileApp.tsx", import.meta.url), "utf8");
const DESKTOP_SETTINGS = readFileSync(new URL("../components/app/settings/sections/EditorSection.tsx", import.meta.url), "utf8");
const MOBILE_SETTINGS = readFileSync(new URL("../mobile/settings/SettingsDrawer.tsx", import.meta.url), "utf8");

describe("附件超限提示接线", () => {
  it("桌面订阅共享错误总线，并提供打开附件设置的动作", () => {
    expect(DESKTOP).toContain("subscribeAttachmentLimitErrors");
    expect(DESKTOP).toContain('setSettingsCategory("editor")');
    expect(DESKTOP).toContain('label: "打开设置"');
  });

  it("移动端订阅共享错误总线并用 error toast 展示", () => {
    expect(MOBILE).toContain('import("../lib/attachmentLimit")');
    expect(MOBILE).toContain("subscribeAttachmentLimitErrors");
    expect(MOBILE).toContain('type: "error"');
  });

  it("两端设置说明明确覆盖图片、视频、PDF 和附件", () => {
    for (const source of [DESKTOP_SETTINGS, MOBILE_SETTINGS]) {
      expect(source).toContain("图片、视频、PDF");
      expect(source).toContain("附件大小上限");
    }
  });
});
