export function shouldAcceptEditorChange(input: { initializing: boolean; previous: string; next: string }): boolean {
  return !input.initializing && input.previous !== input.next;
}
