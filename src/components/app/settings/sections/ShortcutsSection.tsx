// 261114：快捷键清单改为**从注册表生成**（src/lib/shortcuts/registry.ts 单一来源）——
// 设置页与用户手册/匹配逻辑不再各自硬编码，改键位只改注册表 + guide/13。
import type { SettingsPanelContext } from "../useSettingsPanelScope";
import { Group, Block, Shortcut } from "../../../ui/settingsPrimitives";
import { Keyboard } from "lucide-react";
import { detectPlatform, formatCommandKeys, DISPLAY_ONLY_SHORTCUTS, SHELL_COMMANDS } from "../../../../lib/shortcuts/registry";

export function ShortcutsSection({ c: _c }: { c: SettingsPanelContext }) {
  const platform = detectPlatform();
  return (
    <>
              <Group title="快捷键" icon={<Keyboard size={16} />}>
                <Block desc="当前版本先展示固定快捷键（参考思源口径），暂不支持自定义。" />
                {SHELL_COMMANDS.map((command) => (
                  <Shortcut
                    key={command.id}
                    itemId={command.settingId}
                    name={command.label}
                    keys={formatCommandKeys(command, platform)}
                  />
                ))}
                {DISPLAY_ONLY_SHORTCUTS.map((row) => (
                  <Shortcut
                    key={row.settingId}
                    itemId={row.settingId}
                    name={row.label}
                    keys={platform === "mac" ? row.mac : row.other}
                  />
                ))}
              </Group>
    </>
  );
}
