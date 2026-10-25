import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ syncWithV3: vi.fn(async () => ({ uploaded: 1, downloaded: 0, conflicts: 0, manifestId: "v3-g1", completedAt: new Date().toISOString(), durationMs: 1, supersededNotes: [] })) }));
vi.mock("./s3v3/desktopSync.js", () => ({ syncWithV3: mocks.syncWithV3 }));
import { syncNowViaEngine } from "./syncEngineController.js";

describe("桌面同步协议默认值", () => {
  beforeEach(() => { mocks.syncWithV3.mockClear(); delete process.env.LAKE_SYNC_PROTOCOL; });
  afterEach(() => { delete process.env.LAKE_SYNC_PROTOCOL; });
  it("未设置 env 时走 v3", async () => {
    const store = {} as never;
    const result = await syncNowViaEngine(store);
    expect(mocks.syncWithV3).toHaveBeenCalledTimes(1);
    expect(result.manifestId).toBe("v3-g1");
  });
});
