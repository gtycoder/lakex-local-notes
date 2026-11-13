import { Sparkles } from "lucide-react";
import { Group, Field, Block, Switch, TextField, Item } from "../ui/settingsPrimitives";
import { PickerSheet } from "../ui/PickerSheet";
import { bridge } from "../bridge";
import { saveAiEnabled } from "../ai/aiSettings";
import { clearAllConversations } from "../ai/aiChatStore";
import { confirmMobile } from "../ui/ConfirmDialog";
import { AI_PROVIDERS, AI_REASONING_EFFORTS, AI_THINKING_MODES } from "../../core/aiProviders";
import type { useAiSettingsForm } from "./useAiSettingsForm";

/**
 * AI 助手设置（移动端）。
 *
 * 261113 用户点单：顺序按桌面 AiSection 走 —— 服务（供应商 → 接口地址）→ 凭据（API Key，清除紧跟其后）
 * → 模型与参数（模型 → 思考强度 → 思考模式 → 温度）→ 连通性（保存/测试 → AI 助手开关）→ 本机历史。
 * 261114 用户点单：**与桌面一样先选服务供应商**（同一份 core/aiProviders 目录；思考参数只在该家支持时出现，
 * 与桌面「仅 supportsReasoning/supportsThinking 才显示」同口径；温度在思考模式开启时隐藏，同桌面）。
 * 行语义仍按 261102 3b：内容输入类一律 Field（标签在上、控件占满下一行）；选择器用 Item + PickerSheet。
 */
export function AiSettingsSection({ form }: { form: ReturnType<typeof useAiSettingsForm> }) {
  const {
    aiEnabled, setAiEnabled, aiMeta, setAiMeta, aiForm, setAiForm, aiMsg, setAiMsg, aiVerified,
    aiProviderId, switchProvider, activeProviderDef, saveAiSettingsForm, testAiConnection,
  } = form;
  const supportsThinking = activeProviderDef?.supportsThinking === true;
  const showTemperature = !supportsThinking || aiForm.thinking !== "enabled";
  return (
            <Group title="AI 助手" icon={<Sparkles size={16} />}>
              {/* 服务：供应商 → 接口地址（桌面 AiSection 的「服务」段同序） */}
              <Item itemId="ai-provider" name="供应商" desc="内置常见 OpenAI 兼容供应商；切换会用该家默认接口地址与模型。">
                <PickerSheet
                  label="供应商"
                  value={aiProviderId}
                  options={AI_PROVIDERS.map((provider) => ({ value: provider.id, label: provider.label }))}
                  onChange={(value) => switchProvider(value)}
                />
              </Item>
              <Field itemId="ai-base-url" name="接口地址" desc={"OpenAI 兼容端点；留空或填该家默认即可（默认 " + (activeProviderDef?.defaultBaseUrl ?? "") + "）。"}>
                <TextField label="接口地址" value={aiForm.baseUrl} placeholder={activeProviderDef?.defaultBaseUrl ?? "https://api.deepseek.com/v1"} onSave={(v) => setAiForm((form) => ({ ...form, baseUrl: v }))} />
              </Field>
              {/* 凭据：Key 与「清除」紧邻（与桌面 AiSection 的凭据段同构） */}
              <Field itemId="ai-api-key" name="API Key" desc="只保存在本机安全存储，页面里看不到明文；这里只显示尾号。移动端只保存一份 Key，切换供应商后请确认它属于该家。">
                <TextField label="API Key" type="password" value={aiForm.apiKey} placeholder={aiMeta?.hasKey ? aiMeta.keyTail + "（留空＝不改）" : "sk-…"} onSave={(v) => setAiForm((form) => ({ ...form, apiKey: v }))} />
              </Field>
              <Block itemId="ai-key-clear" name="清除 API Key" desc={aiMeta?.hasKey ? "当前已配置（" + aiMeta.keyTail + "）；清除后需要重新填写才能使用。" : "尚未配置，无需清除。"}>
                <div className="ai-settings__actions">
                  <button type="button" className="mb-btn mb-btn--secondary mb-btn--danger-text" disabled={!aiMeta?.hasKey} onClick={() => {
                    void confirmMobile({ title: "清除 API Key？", body: "清除后 AI 将无法联网，直到重新填写。", confirmText: "清除", danger: true })
                      .then(async (ok) => {
                        if (!ok) return;
                        try {
                          await bridge.aiSaveSettings({ apiKey: "" });
                          const settings = await bridge.aiGetSettings();
                          setAiMeta(settings);
                          setAiMsg("已清除 API Key");
                        } catch (error) { setAiMsg("清除失败：" + (error as Error).message); }
                      });
                  }}>清除 API Key</button>
                </div>
              </Block>
              {/* 模型与参数（思考强度 / 思考模式只在该家支持时出现；温度在思考模式开启时隐藏） */}
              <Field itemId="ai-model" name="模型">
                <TextField label="模型" value={aiForm.model} placeholder={activeProviderDef?.defaultModel || "模型名"} onSave={(v) => setAiForm((form) => ({ ...form, model: v }))} />
              </Field>
              {activeProviderDef?.supportsReasoning && (
                <Item itemId="ai-reasoning" name="思考强度" desc="推理强度：越高思考越深入、耗时越长（默认 high）。">
                  <PickerSheet
                    label="思考强度"
                    value={aiForm.reasoningEffort || (activeProviderDef.defaultReasoningEffort ?? "high")}
                    options={AI_REASONING_EFFORTS.map((effort) => ({ value: effort, label: effort }))}
                    onChange={(value) => setAiForm((form) => ({ ...form, reasoningEffort: value }))}
                  />
                </Item>
              )}
              {supportsThinking && (
                <Item itemId="ai-thinking" name="思考模式" desc="关闭可减少 token 消耗与等待时间；开启时温度不生效。">
                  <PickerSheet
                    label="思考模式"
                    value={aiForm.thinking === "disabled" ? "disabled" : "enabled"}
                    options={AI_THINKING_MODES.map((mode) => ({ value: mode, label: mode === "enabled" ? "开启" : "关闭" }))}
                    onChange={(value) => setAiForm((form) => ({ ...form, thinking: value }))}
                  />
                </Item>
              )}
              {showTemperature && (
                <Field itemId="ai-temperature" name="温度">
                  <TextField label="温度" value={aiForm.temperature} placeholder="0.7" onSave={(v) => setAiForm((form) => ({ ...form, temperature: v }))} />
                </Field>
              )}
              {/* 连通性 */}
              <Block itemId="ai-actions" name="保存与连通性">
                <div className="ai-settings__actions">
                  <button type="button" className="mb-btn mb-btn--primary" onClick={() => void saveAiSettingsForm()}>保存</button>
                  <button type="button" className="mb-btn mb-btn--secondary" onClick={() => void testAiConnection()}>测试连通性</button>
                </div>
                {aiMsg && <div className="mb-form__desc">{aiMsg}</div>}
              </Block>
              {/* 261029 用户点单：AI 必须先配置好接口/模型/Key 才能开启 ⇒ 开关放在配置区下方（原在 Group 最上面）。 */}
              <Switch
                itemId="ai-enabled"
                name="AI 助手"
                desc={aiVerified
                  ? "开启后 AI 才会联网；请先在上面填好供应商、接口、模型与 API Key 并保存。与云同步无关，关掉同步也能用 AI。"
                  : aiEnabled
                    ? "当前配置还没通过测试；改动供应商、接口、模型或 Key 后需要重新测试。可随时关闭，但再次开启前必须测试通过。"
                    : "先填好供应商、接口、模型与 API Key 并保存，点「测试连通性」通过后才能开启；未通过时点击开关只提示、不会打开。"}
                checked={aiEnabled}
                onChange={(checked) => {
                  // 261029 FIX-M：不再禁灰；未验证时点击开启只给提示、保持关闭（实质仍是「测试通过才能开」）。
                  if (checked && !aiVerified) {
                    setAiMsg("先填好供应商、接口、模型与 API Key，点「测试连通性」通过后才能开启 AI。");
                    return;
                  }
                  saveAiEnabled(checked);
                  setAiEnabled(checked);
                  setAiMsg("");
                }}
              />
              {/* 本机对话（移动端独有；桌面无此项 ⇒ 排在最后，不打断配置段的桌面顺序） */}
              <Block itemId="ai-history" name="已保存的对话" desc="最多保留 50 条、30 天；保存在本机，含资料快照，不含 API Key，也不参与云同步。">
                <div className="ai-settings__actions">
                  <button type="button" className="mb-btn mb-btn--secondary" onClick={() => {
                    void confirmMobile({ title: "清空全部历史对话？", body: "只影响本机保存的 AI 对话，不影响笔记与同步。", confirmText: "清空", danger: true })
                      .then((ok) => { if (!ok) return; void clearAllConversations().then(() => setAiMsg("已清空本机保存的 AI 历史对话")); });
                  }}>清空全部对话</button>
                </div>
              </Block>
            </Group>
  );
}
