/**
 * 表格（usheet）当前工作表登记表（设备本地、只在渲染层内存里）。
 *
 * 用途：导出 CSV 时要知道"用户正看着哪张工作表"。工作表选择属于**本机视图**（AGENTS §4：
 * 当前工作表/缩放/选区不进正文、不进 S3）⇒ 不能写进 body，也不能由主进程读 localStorage。
 * 所以由打开的编辑器登记一个**按需读取**的 getter，导出动作取一次；文档没打开时取不到，
 * 后端回退到 sheetOrder 第一张（导出结果会带工作表名，UI 明确提示导的是哪张）。
 */
type SheetGetter = () => string | null;

const getters = new Map<string, SheetGetter>();

/** 注册某个 noteId 的活动工作表 getter；返回注销函数（编辑器卸载时必须调用）。 */
export function registerUsheetActiveSheet(noteId: string, getter: SheetGetter): () => void {
  getters.set(noteId, getter);
  return () => {
    if (getters.get(noteId) === getter) getters.delete(noteId);
  };
}

/** 读当前活动工作表 id；编辑器没打开 / getter 抛错时返回 null（调用方回退第一张工作表）。 */
export function usheetActiveSheetId(noteId: string): string | null {
  const getter = getters.get(noteId);
  if (!getter) return null;
  try {
    const id = getter();
    return typeof id === "string" && id.length > 0 ? id : null;
  } catch {
    return null;
  }
}
