// 261112 R2-S7：设置页「appearance」分组（纯搬移自 SettingsPanel.tsx；只改文件位置，不改任何设置项/文案）。
import type { SettingsPanelContext } from "../useSettingsPanelScope";
import { Group, Item, Seg } from "../../../ui/settingsPrimitives";
import { Monitor, Moon, Coffee, Sun } from "lucide-react";
import { LAKE_THEMES } from "../../../../lib/themes";

export function AppearanceSection({ c }: { c: SettingsPanelContext }) {
  const { onChange, settings } = c;
  return (
    <>
              <Group title="外观" icon={<Monitor size={16} />}>
                <Item itemId="appearance-theme" name="主题">
                  <Seg ariaLabel="主题">
                    {LAKE_THEMES.map((t) => (
                      <button key={t.id} className={`ln-segment__item ${settings.theme === t.id ? "is-active" : ""}`} aria-pressed={settings.theme === t.id} onClick={() => onChange({ theme: t.id })}>
                        {t.id === "dark" ? <Moon size={14} /> : t.id === "warm" ? <Coffee size={14} /> : <Sun size={14} />} {t.label}
                      </button>
                    ))}
                  </Seg>
                </Item>
              </Group>
    </>
  );
}
