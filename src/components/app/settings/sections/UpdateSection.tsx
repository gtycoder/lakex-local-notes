// 261112 R2-S7：设置页「update」分组（纯搬移自 SettingsPanel.tsx；只改文件位置，不改任何设置项/文案）。
import type { SettingsPanelContext } from "../useSettingsPanelScope";
import { UpdateCenterSection } from "../../UpdateCenter";

export function UpdateSection({ c: _c }: { c: SettingsPanelContext }) {
  return (
    <>
              <UpdateCenterSection />
    </>
  );
}
