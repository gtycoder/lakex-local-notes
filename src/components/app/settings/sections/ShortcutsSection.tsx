// 261112 R2-S7：设置页「shortcuts」分组（纯搬移自 SettingsPanel.tsx；只改文件位置，不改任何设置项/文案）。
import type { SettingsPanelContext } from "../useSettingsPanelScope";
import { Group, Block, Shortcut } from "../../../ui/settingsPrimitives";
import { Keyboard } from "lucide-react";

export function ShortcutsSection({ c: _c }: { c: SettingsPanelContext }) {
  return (
    <>
              <Group title="快捷键" icon={<Keyboard size={16} />}>
                <Block desc="当前版本先展示固定快捷键，暂不支持自定义。" />
                <Shortcut itemId="shortcut-search" name="打开全局搜索（标题和正文）" keys="⌘K" />
                <Shortcut itemId="shortcut-focus" name="进入或退出专注模式" keys="⌘⇧Enter" />
              <Shortcut itemId="shortcut-sidebar" name="收起或固定目录栏" keys="⌘]" />
                <Shortcut itemId="shortcut-move" name="在搜索结果中移动" keys="↑ / ↓" />
                <Shortcut itemId="shortcut-open" name="打开搜索结果并定位命中" keys="Enter" />
                <Shortcut itemId="shortcut-open-tab" name="在新标签打开并定位命中" keys="⌘Enter" />
                <Shortcut itemId="shortcut-esc" name="关闭当前菜单或浮层" keys="Esc" />
              </Group>
    </>
  );
}
