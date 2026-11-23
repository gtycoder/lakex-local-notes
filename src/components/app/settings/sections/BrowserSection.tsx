// 261112 R2-S7：设置页「browser」分组（纯搬移自 SettingsPanel.tsx；只改文件位置，不改任何设置项/文案）。
import type { SettingsPanelContext } from "../useSettingsPanelScope";
import { Group, Switch, Block, Item } from "../../../ui/settingsPrimitives";
import { Globe, ExternalLink } from "lucide-react";

export function BrowserSection({ c }: { c: SettingsPanelContext }) {
  const { openWeb, setWeb, webRun, webStatus, webText } = c;
  return (
    <>
              <>
              <Group title="浏览器端" icon={<Globe size={16} />}>
                <Switch itemId="browser-enabled" name="启用浏览器端" desc="在本机浏览器使用（同一份本地数据，仅监听 127.0.0.1）；开关即时生效，重启后恢复关闭。" checked={webStatus?.enabled ?? false} disabled={!webStatus || webRun.busy} onChange={(checked) => void setWeb(checked)} />
                <Block name="这是什么" desc="同一份本地库经 http://127.0.0.1:19880/ 提供给浏览器，数据不经过网络、不向局域网开放。" />
                <Block name="现状" desc="读写同一份本地数据；导出、整库备份等需系统目录框的操作仍在桌面端使用。" />
                {webStatus?.enabled && (
                  <Item itemId="browser-open" name="在本机浏览器打开" desc={webStatus.url}>
                    <button className="ln-btn ln-btn--outlined" onClick={() => void openWeb()}><ExternalLink size={14} /> 打开浏览器</button>
                  </Item>
                )}
                {webText && <Block desc={webText} />}
              </Group>
              </>
    </>
  );
}
