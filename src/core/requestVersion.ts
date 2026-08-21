/**
 * Small guard for async UI work where only the latest request may commit results.
 * It does not cancel the underlying operation; callers can add AbortController
 * later when the transport supports it.
 */
export interface RequestVersion {
  next(): number;
  invalidate(): number;
  isCurrent(version: number): boolean;
}

export function createRequestVersion(): RequestVersion {
  let current = 0;
  return {
    next() {
      current += 1;
      return current;
    },
    invalidate() {
      current += 1;
      return current;
    },
    isCurrent(version) {
      return version === current;
    },
  };
}