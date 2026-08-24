import { describe, expect, it } from "vitest";
import { getWorkspaceDisplayName } from "./workspaceName";

describe("getWorkspaceDisplayName", () => {
  it("shows local space when cloud sync is disabled", () => {
    expect(getWorkspaceDisplayName(false, { prefix: "remote-notes" })).toBe("本地空间");
  });

  it("shows local space before S3 has been configured", () => {
    expect(getWorkspaceDisplayName(true, null)).toBe("本地空间");
  });

  it("shows the normalized S3 object prefix when sync is enabled", () => {
    expect(getWorkspaceDisplayName(true, { prefix: " /team/lake-notes/ " })).toBe("team/lake-notes");
  });

  it("keeps an empty prefix in local-space mode", () => {
    expect(getWorkspaceDisplayName(true, { prefix: " / " })).toBe("本地空间");
  });
});
