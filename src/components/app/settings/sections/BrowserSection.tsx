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
                <Switch itemId="browser-enabled" name="启用浏览器端" desc="在本机浏览器中打开 LakexLocalNotes（与桌面端同一份本地数据）。只监听 127.0.0.1，不向局域网开放；开关即时生效，应用重启后恢复为关闭。" checked={webStatus?.enabled ?? false} disabled={!webStatus || webRun.busy} onChange={(checked) => void setWeb(checked)} />
                <Block name="这是什么" desc="浏览器端不向局域网开放：它把桌面端的同一份本地库通过本机地址 http://127.0.0.1:19880/ 交给浏览器，数据不经过网络。打开开关后，用浏览器访问该地址即可。" />
                <Block name="现状" desc="读写的是本机同一份数据；同步进度与待办会实时刷新；图片「另存为」走浏览器下载，附件在新标签打开。需要系统目录框的操作（导出、整库备份）请仍在桌面端使用。开关不保存，每次启动都从关闭开始。" />
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
