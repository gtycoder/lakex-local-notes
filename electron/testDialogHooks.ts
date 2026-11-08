/**
 * 开发/测试专用：替换 Electron 原生文件对话框的返回值。
 *
 * 目的：CDP/自动化无法操作系统 NSOpenPanel/NSSavePanel；为了回归「导入 / 导出 /
 * 从备份恢复」等 UI 流程，可在 dev 下用环境变量给 dialog 注入固定路径。
 *
 * 安全边界（硬约束）：
 * - `isPackaged === true` 时永远不安装（生产打包版零影响）；
 * - 三个环境变量都未设置时不安装；
 * - 只改主进程的 dialog 方法，不新增 IPC / preload / 渲染层入口；
 * - 路径来自环境变量，不做任何业务校验（仍由后续 IPC 正常校验）。
 */
export interface TestDialogEnv {
  LAKE_TEST_PICK_FILE?: string;
  LAKE_TEST_PICK_DIR?: string;
  LAKE_TEST_SAVE_FILE?: string;
}

export interface DialogLike {
  showOpenDialog: (...args: unknown[]) => Promise<{ canceled: boolean; filePaths: string[] }>;
  showSaveDialog: (...args: unknown[]) => Promise<{ canceled: boolean; filePath?: string }>;
}

interface OpenDialogOptionsLike {
  properties?: string[];
}

function trimmed(value: string | undefined): string | null {
  const next = value?.trim();
  return next ? next : null;
}

/**
 * 返回值 = 是否真的安装了替身。调用方可用它决定是否打 warning。
 * 纯函数式依赖注入，单测无需启动 Electron。
 */
export function installTestDialogHooks(deps: {
  dialog: DialogLike;
  isPackaged: boolean;
  env: TestDialogEnv;
}): boolean {
  if (deps.isPackaged) return false;
  const pickFile = trimmed(deps.env.LAKE_TEST_PICK_FILE);
  const pickDir = trimmed(deps.env.LAKE_TEST_PICK_DIR);
  const saveFile = trimmed(deps.env.LAKE_TEST_SAVE_FILE);
  if (!pickFile && !pickDir && !saveFile) return false;

  deps.dialog.showOpenDialog = async (...args: unknown[]) => {
    const options = args.at(-1) as OpenDialogOptionsLike | undefined;
    const wantsDirectory = options?.properties?.includes("openDirectory") === true;
    const chosen = wantsDirectory ? pickDir : pickFile;
    if (!chosen) return { canceled: true, filePaths: [] };
    return { canceled: false, filePaths: [chosen] };
  };
  deps.dialog.showSaveDialog = async () => {
    if (!saveFile) return { canceled: true };
    return { canceled: false, filePath: saveFile };
  };
  return true;
}
