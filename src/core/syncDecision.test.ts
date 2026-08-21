import { describe, expect, it } from "vitest";
import { mergeLockState } from "./syncDecision.js";

describe("sync lock decision", () => {
  it("uses the timestamped side when the other side has no timestamp", () => {
    expect(mergeLockState(false, null, true, "2026-08-20T00:00:00Z")).toEqual({ locked: true, at: "2026-08-20T00:00:00Z" });
    expect(mergeLockState(true, "2026-08-20T00:00:00Z", false, null)).toEqual({ locked: true, at: "2026-08-20T00:00:00Z" });
  });
  it("uses newer timestamps and keeps a lock on ties", () => {
    expect(mergeLockState(true, "2026-08-20T02:00:00Z", false, "2026-08-20T01:00:00Z")).toEqual({ locked: true, at: "2026-08-20T02:00:00Z" });
    expect(mergeLockState(false, "2026-08-20T01:00:00Z", true, "2026-08-20T02:00:00Z")).toEqual({ locked: true, at: "2026-08-20T02:00:00Z" });
    expect(mergeLockState(false, "2026-08-20T01:00:00Z", true, "2026-08-20T01:00:00Z")).toEqual({ locked: true, at: "2026-08-20T01:00:00Z" });
  });
});