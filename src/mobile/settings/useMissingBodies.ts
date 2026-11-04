/**
 * 缺正文清单的加载（资源管理用，261104 B-lite）。
 *
 * 只在该页可见时扫描一次；动作完成后调 reload（列表与计数一起刷新）。
 * 扫描本身只 stat 正文文件、不读正文、不出网（见 data/missingBodies.ts），10 万文档也只是几批 stat。
 */
import { useCallback, useEffect, useState } from "react";
import { bridge } from "../bridge";
import type { MissingBodiesSnapshot } from "../data/missingBodies";

const EMPTY: MissingBodiesSnapshot = { cloudConfigured: false, docs: [], quickNotes: [] };

export function useMissingBodies(enabled: boolean): MissingBodiesSnapshot & { loading: boolean; reload: () => Promise<void> } {
  const [snapshot, setSnapshot] = useState<MissingBodiesSnapshot>(EMPTY);
  const [loading, setLoading] = useState(false);
  const reload = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      setSnapshot(await bridge.listMissingBodies());
    } catch (error) {
      // 扫描失败不该把设置页打断：保留上一次结果，控制台留线索。
      console.warn("[missing-body] 扫描失败", error);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    if (enabled) void reload();
  }, [enabled, reload]);
  return { ...snapshot, loading, reload };
}
