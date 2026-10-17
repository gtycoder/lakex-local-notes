export function nextSearchIndex(current: number, delta: number, length: number): number {
  if (length <= 0) return -1;
  return (current + delta + length) % length;
}

export function initialSearchIndex(length: number): number {
  return length > 0 ? 0 : -1;
}
