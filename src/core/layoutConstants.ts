/**
 * 面板布局常量（中性层，261103 P9-3）。
 *
 * 由来：这些数值原先定义在 `src/desktop/desktopTypes.ts`（桌面壳），但 `src/features/outline/OutlineSidebar`
 * 只需要「大纲默认宽」一个数 ⇒ features 反向依赖 desktop 壳（check-arch 的 features-no-desktop 违规）。
 * 常量是纯数值、与实现无关，下沉到 core 后：features 只依赖 core；desktopTypes 仍 re-export，
 * 既有 import 路径不变（App/hooks/useDesktopShell 等零改动）。
 *
 * 改数值前先 grep 使用点；宽度在桌面 shell 里另有 clamp（MIN/MAX），别只改 DEFAULT。
 */
export const OUTLINE_SIDEBAR_DEFAULT_WIDTH = 280;
export const OUTLINE_SIDEBAR_MIN_WIDTH = 200;
export const OUTLINE_SIDEBAR_MAX_WIDTH = 420;

/** 左侧资料库侧栏宽（261103 P10：从 desktopTypes 下沉，components→desktop 违规清零）。 */
export const SIDEBAR_DEFAULT_WIDTH = 224;
export const SIDEBAR_MIN_WIDTH = 160;
export const SIDEBAR_MAX_WIDTH = 420;
