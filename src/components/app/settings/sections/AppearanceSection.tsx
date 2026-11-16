// 261112 R2-S7：设置页「appearance」分组（纯搬移自 SettingsPanel.tsx；只改文件位置，不改任何设置项/文案）。
// 261116 用户点单：主题从「4 个分段按钮」改成**下拉**（AdaptiveSelect）——以后新增主题只需往
//   LAKE_THEMES 加一项，这里零改动；值仍是 LAKE_THEMES 的 id（light / dark / warm / chat）。
import type { SettingsPanelContext } from "../useSettingsPanelScope";
import { Group, Item } from "../../../ui/settingsPrimitives";
import { AdaptiveSelect } from "../../../ui/AdaptiveSelect";
import { Monitor } from "lucide-react";
import { DEFAULT_THEME_ID, LAKE_THEMES, isLakeThemeId } from "../../../../lib/themes";

export function AppearanceSection({ c }: { c: SettingsPanelContext }) {
  const { onChange, settings } = c;
  return (
    <>
              <Group title="外观" icon={<Monitor size={16} />}>
                <Item itemId="appearance-theme" name="主题">
                  <AdaptiveSelect
                    label="主题"
                    value={settings.theme}
                    options={LAKE_THEMES.map((theme) => ({ value: theme.id, label: theme.label }))}
                    onChange={(value) => onChange({ theme: isLakeThemeId(value) ? value : DEFAULT_THEME_ID })}
                  />
                </Item>
              </Group>
    </>
  );
}
