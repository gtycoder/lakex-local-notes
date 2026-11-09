/**
 * 更新中心快照 hook（useSyncExternalStore）。
 * 自动检查与设置页共用 updateCenterStore 的同一份状态，不各自轮询。
 */
import { useSyncExternalStore } from "react";
import {
  getUpdateCenterSnapshot,
  subscribeUpdateCenter,
  type UpdateCenterSnapshot,
} from "./updateCenterStore";

export function useUpdateCenter(): UpdateCenterSnapshot {
  return useSyncExternalStore(subscribeUpdateCenter, getUpdateCenterSnapshot, getUpdateCenterSnapshot);
}
