// 261112 R2-S7：设置页「editor」分组（纯搬移自 SettingsPanel.tsx；只改文件位置，不改任何设置项/文案）。
import { useEffect } from "react";
import type { SettingsPanelContext } from "../useSettingsPanelScope";
import { Group, Field, Switch } from "../../../ui/settingsPrimitives";
import { Type, Files, Paperclip, Home, LayoutGrid } from "lucide-react";
import { useHiddenDesktopSpaces } from "../../../../hooks/useHiddenDesktopSpaces";
import { DEFAULT_SPACE } from "../../../model/defaultSpace";
import { Select } from "../../../ui/Select";
import { fontSizeOptions, MAX_OPEN_TAB_OPTIONS } from "../../../../lib/settings";
import { isDefaultSpace, saveDefaultSpace, DEFAULT_SPACE_OPTIONS } from "../../../model/defaultSpace";

export function EditorSection({ c }: { c: SettingsPanelContext }) {
  const { defaultSpace, onChange, setDefaultSpace, settings } = c;
  // 261114 用户点单：仅「日记 / AI 写作」可关闭（关闭 = 隐藏一级入口，数据与落点都保留）。
  const { hidden, toggle } = useHiddenDesktopSpaces();
  const isHidden = (value: string) => (hidden as readonly string[]).includes(value);
  const visibleDefaultOptions = DEFAULT_SPACE_OPTIONS.filter((option) => !isHidden(option.value));
  // 默认空间被关闭 ⇒ 落点回知识库（否则下次启动会指向一个不可进入的空间）。
  useEffect(() => {
    if (isHidden(defaultSpace)) {
      setDefaultSpace(DEFAULT_SPACE);
      saveDefaultSpace(DEFAULT_SPACE);
    }
  }, [defaultSpace, hidden, setDefaultSpace]);
  return (
    <>
              <>
                <Group title="编辑器" icon={<Type size={16} />}>
                  <Field itemId="editor-font-size" name="正文字号" desc="调整编辑器正文的字号，只影响显示，不改文档内容。">
                    <Select label="正文字号" value={String(settings.fontSize)} onChange={(v) => onChange({ fontSize: Number(v) })} options={fontSizeOptions().map((fs) => ({ value: String(fs), label: `${fs} px` }))} />
                  </Field>
                  <Switch itemId="editor-outline-enhance" name="大纲增强" desc="开启后在桌面右栏使用增强大纲（可筛选、折叠、显示级别徽标）；关闭则使用 Lake 原生大纲。移动端始终使用应用的大纲面板。" checked={settings.outlineEnhance} onChange={(checked) => onChange({ outlineEnhance: checked })} />
                  <Switch itemId="editor-toolbar" name="显示固定工具栏" desc="编辑器顶部的固定工具栏。关闭后界面更简洁，格式操作改用浮动工具栏。" checked={settings.showToolbar} onChange={(checked) => onChange({ showToolbar: checked })} />
                  <Switch itemId="editor-floating-toolbar" name="浮动工具栏" desc="选中文字或图片时在选区旁弹出格式工具条；与固定工具栏互不影响。" checked={settings.floatingToolbar} onChange={(checked) => onChange({ floatingToolbar: checked })} />
                </Group>
                <Group title="标签页" icon={<Files size={16} />}>
                  <Field itemId="editor-max-open-tabs" name="最大同时打开标签数" desc="每个空间（文档、日记）各自独立计算，超过上限时自动关闭该空间最旧的标签（当前编辑的标签与钉住的标签除外），未保存内容会自动保存。">
                    <Select label="最大同时打开标签数" value={String(settings.maxOpenTabs)} onChange={(v) => onChange({ maxOpenTabs: Number(v) })} options={MAX_OPEN_TAB_OPTIONS.map((n) => ({ value: String(n), label: n + " 个" }))} />
                  </Field>
                  <Switch itemId="editor-clear-tabs-on-exit" name="退出时关闭全部标签" desc="开启后下次启动不恢复上次打开的标签；默认关闭。只保存在本机，不参与同步。" checked={settings.clearTabsOnExit} onChange={(checked) => onChange({ clearTabsOnExit: checked })} />
                </Group>
                <Group title="附件" icon={<Paperclip size={16} />}>
                  <Field itemId="editor-max-attachment" name="附件大小上限" desc="插入附件时的本机上限；同步与下载统一按协议上限（100 MiB），不受其他设备设置影响。">
                    <Select label="附件大小上限" value={String(settings.maxAttachmentBytes / (1024 * 1024))} onChange={(v) => onChange({ maxAttachmentBytes: Number(v) * 1024 * 1024 })} options={[
                      { value: "25", label: "25 MiB" }, { value: "50", label: "50 MiB" }, { value: "100", label: "100 MiB" },
                    ]} />
                  </Field>
                </Group>
                <Group title="空间" icon={<LayoutGrid size={16} />}>
                  <Switch itemId="space-ai-writing" name="AI 写作空间" desc="关闭后从本机空间菜单与 ⌘4 隐藏；仅本设备生效、不参与云同步（另一台设备不受影响）。AI 写作会话保留，可随时重新开启。" checked={!isHidden("ai-writing")} onChange={(checked) => toggle("ai-writing", checked)} />
                  <Switch itemId="space-diary" name="日记空间" desc="关闭后从本机空间菜单与 ⌘5 隐藏；仅本设备生效、不参与云同步（另一台设备不受影响）。日记数据保留，可随时重新开启。知识库 / 小记 / 标签固定显示。" checked={!isHidden("diary")} onChange={(checked) => toggle("diary", checked)} />
                </Group>
                <Group title="启动" icon={<Home size={16} />}>
                  <Field itemId="editor-default-space" name="默认空间" desc="启动时进入的空间，只保存在本机，不参与同步；任何时候都能用 ⌘1–5 切换（已关闭的空间不响应）。">
                    <Select label="默认空间" value={defaultSpace} onChange={(v) => { if (!isDefaultSpace(v)) return; setDefaultSpace(v); saveDefaultSpace(v); }} options={visibleDefaultOptions} />
                  </Field>
                </Group>
              </>
    </>
  );
}
