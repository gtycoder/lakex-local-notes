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

/** 一笔"按文档 reload"的取消令牌（审计 F03）：不同文档互不取消，同文档最新一次胜出。 */
export interface NoteReloadToken { noteId: string; version: number; }
export interface NoteReloadGuard {
  next(noteId: string): NoteReloadToken;
  isCurrent(token: NoteReloadToken): boolean;
  clear(noteId: string): void;
}

export function createNoteReloadGuard(): NoteReloadGuard {
  const versions = new Map<string, number>();
  return {
    next(noteId) {
      const version = (versions.get(noteId) ?? 0) + 1;
      versions.set(noteId, version);
      return { noteId, version };
    },
    isCurrent(token) {
      return versions.get(token.noteId) === token.version;
    },
    clear(noteId) {
      versions.delete(noteId);
    },
  };
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