export interface NoteSaveSnapshot {
  title: string;
  content: string;
}

/** Only user-visible note data makes a note dirty; derived caches are excluded. */
export function hasNoteSaveChanges(current: NoteSaveSnapshot, next: NoteSaveSnapshot): boolean {
  return current.title !== next.title || current.content !== next.content;
}
