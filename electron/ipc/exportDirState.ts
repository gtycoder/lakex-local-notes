/**
 * 「系统选择框选过的导出目录」唯一记录（261106 收敛）：导出类 IPC 只认本进程系统选择框的返回值，
 * 防止渲染层传任意路径把文件写到用户没选过的地方。
 *
 * 写入点：pick_export_dir（单个导出）与 export_notes_batch（批量导出缺省弹框）；
 * 读取点：export_note / export_ink_page_svg / save_ink_page_png / export_notes_batch 的 dirPath 校验。
 */
let lastPicked: string | null = null;

export function rememberPickedExportDir(dir: string | null): void {
  lastPicked = dir && dir.length > 0 ? dir : null;
}

export function pickedExportDir(): string | null {
  return lastPicked;
}
