import { describe, expect, it } from "vitest";
import { createRequestVersion } from "./requestVersion";

describe("createRequestVersion", () => {
  it("returns increasing versions and recognizes only the latest one", () => {
    const guard = createRequestVersion();
    const first = guard.next();
    const second = guard.next();

    expect(second).toBeGreaterThan(first);
    expect(guard.isCurrent(first)).toBe(false);
    expect(guard.isCurrent(second)).toBe(true);
  });

  it("invalidates an in-flight request", () => {
    const guard = createRequestVersion();
    const request = guard.next();

    guard.invalidate();

    expect(guard.isCurrent(request)).toBe(false);
  });
});
