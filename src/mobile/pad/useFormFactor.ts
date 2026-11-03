import { useSyncExternalStore } from "react";
import { currentFormFactor, subscribeFormFactor, type FormFactor } from "./formFactor";

/**
 * React 侧读形态档：直接订阅 formFactor store（**唯一 listener 在 installFormFactor**），
 * 不再每个组件各挂 resize/matchMedia（261103 P3；评审 W1「formFactor 三份表示」）。
 * SSR/无 window 时返回 compact（与生产首帧一致）。
 */
export function useFormFactor(): FormFactor {
  return useSyncExternalStore(subscribeFormFactor, currentFormFactor, () => "compact" as FormFactor);
}
