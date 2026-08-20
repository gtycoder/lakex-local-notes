import { describe, expect, it } from "vitest";
import { filterSettingsNav } from "./settingsSearch";

describe("settings search", () => {
  it("matches labels and semantic keywords", () => {
    const items = [{ id: "editor" as const, label: "编辑器", keywords: "字号 大纲 工具栏" }, { id: "sync" as const, label: "云端与同步", keywords: "S3 上传" }];
    expect(filterSettingsNav(items, "字号").map((item) => item.id)).toEqual(["editor"]);
    expect(filterSettingsNav(items, "s3").map((item) => item.id)).toEqual(["sync"]);
  });
});
