/** 图片/附件全屏预览位于普通浮层之上；只存窗口内关闭回调，不存文档数据。 */
const openPreviews = new Map<string, () => void>();
export function trackImmersivePreview(id: string, dismiss: (() => void) | null): void {
  openPreviews.delete(id);
  if (dismiss) openPreviews.set(id, dismiss);
}
export function dismissImmersivePreview(): boolean {
  const last = [...openPreviews.values()].at(-1);
  if (!last) return false;
  last();
  return true;
}
