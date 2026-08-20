export interface LockMergeResult {
  locked: boolean;
  at: string | null;
}

/**
 * Field-level LWW for the read-only lock. A timestamped side wins; equal
 * timestamps are conservative and keep the lock if either side is locked.
 */
export function mergeLockState(localLocked: boolean, localAt: string | null, remoteLocked: boolean, remoteAt: string | null): LockMergeResult {
  if (!localAt || !remoteAt) {
    if (!localAt && !remoteAt) return { locked: remoteLocked, at: null };
    return localAt ? { locked: localLocked, at: localAt } : { locked: remoteLocked, at: remoteAt };
  }
  if (remoteAt > localAt) return { locked: remoteLocked, at: remoteAt };
  if (remoteAt < localAt) return { locked: localLocked, at: localAt };
  return { locked: localLocked || remoteLocked, at: localAt };
}
