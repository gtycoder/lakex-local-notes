// 261112 R2-S7：设置页「ai」分组（纯搬移自 SettingsPanel.tsx；只改文件位置，不改任何设置项/文案）。
import type { SettingsPanelContext } from "../useSettingsPanelScope";
import { Group, Section, Field, Item, NumField, Block, Switch } from "../../../ui/settingsPrimitives";
import { Sparkles, EyeOff, Eye } from "lucide-react";
import { Select } from "../../../ui/Select";
import { AI_PROVIDERS, AI_REASONING_EFFORTS, AI_THINKING_MODES, type AiReasoningEffort, type AiThinkingMode } from "../../../../core/aiProviders";
import { saveAiEnabled } from "../../../../lib/aiEnabled";

export function AiSection({ c }: { c: SettingsPanelContext }) {
  const { activeAi, activeDef, aiDraft, aiEnableAlert, aiEnabled, aiErr, aiForceSave, aiKeyVisible, aiManualModel, aiModels, aiModelsRun, aiMsg, aiPending, aiProviderId, aiRun, fetchAiModels, forceSaveAi, saveAi, setAiDraft, setAiEnableAlert, setAiEnabled, setAiKeyVisible, setAiManualModel, switchAiProvider, testAi, testAndSaveAi } = c;
  return (
    <>
              <>
                <Group title="AI 助手" icon={<Sparkles size={16} />}>
                  <Section title="服务">
                    <Field itemId="ai-provider" name="供应商" desc="支持 OpenAI 兼容接口：内置 OpenAI、DeepSeek、通义千问、智谱、小米 MiMo，也可选「自定义」指向任意兼容端点（如 Ollama、vLLM）。切换供应商会重置为该家默认值。">
                      <Select label="AI 供应商" value={aiProviderId} onChange={(v) => void switchAiProvider(v)} options={AI_PROVIDERS.map((p) => ({ value: p.id, label: p.label }))} />
                    </Field>
                    <Field itemId="ai-base-url" name="Base URL" desc={"留空即用该家默认；可改成任意 OpenAI 兼容端点，例如 " + activeDef.defaultBaseUrl + "。"} error={aiErr.baseUrl}>
                      <span className="ln-input settings-input"><input className="ln-input__field" value={aiPending.baseUrl} placeholder={activeDef.defaultBaseUrl} spellCheck={false} onChange={(e) => setAiDraft((d) => ({ ...d, baseUrl: e.target.value }))} aria-label="Base URL" /></span>
                      <button className="ln-btn ln-btn--outlined" onClick={() => setAiDraft((d) => ({ ...d, baseUrl: activeDef.defaultBaseUrl }))}>恢复默认</button>
                    </Field>
                  </Section>

                  <Section title="凭据">
                    <Field
                      itemId="ai-api-key"
                      name={<>API Key <span className={"badge " + (activeAi?.hasApiKey ? "badge--accent" : "badge--muted")}>{activeAi?.hasApiKey ? "已保存" : "未配置"}</span></>}
                      desc="加密保存在本机（macOS Keychain），不同步、不上传；留空即沿用已保存的，输入新值即替换。"
                      error={aiErr.apiKey}
                    >
                      <span className="ln-input settings-input">
                        <input
                          className="ln-input__field"
                          type={aiKeyVisible ? "text" : "password"}
                          value={aiDraft.apiKey ?? ""}
                          placeholder={activeAi?.hasApiKey ? "留空沿用已保存的密钥" : "sk-..."}
                          autoComplete="off"
                          spellCheck={false}
                          onChange={(e) => setAiDraft((d) => ({ ...d, apiKey: e.target.value }))}
                          aria-label="API Key"
                        />
                        <button
                          type="button"
                          className="ln-iconbtn ln-iconbtn--compact"
                          aria-label={aiKeyVisible ? "隐藏 API Key" : "显示 API Key"}
                          aria-pressed={aiKeyVisible}
                          onClick={() => setAiKeyVisible((v) => !v)}
                        >{aiKeyVisible ? <EyeOff size={15} /> : <Eye size={15} />}</button>
                      </span>
                      {/* 清除：只删本机的 Key（换机/共享设备时抹掉），不清其它配置项 */}
                      {activeAi?.hasApiKey && (
                        <button className="ln-btn ln-btn--outlined" onClick={() => void saveAi({ providers: [{ id: aiProviderId, clearApiKey: true }] })}>清除</button>
                      )}
                    </Field>
                  </Section>

                  <Section title="模型与参数">
                    <Field itemId="ai-model" name="模型" desc="从供应商拉取候选会同时验证连通性；端点不实现 /models 时可手填。" error={aiErr.model}>
                      {aiModels && aiModels.length > 0 && !aiManualModel ? (
                        <Select label="AI 模型" value={aiPending.model} onChange={(v) => { if (v === "__manual__") { setAiManualModel(true); return; } setAiDraft((d) => ({ ...d, model: v })); }} options={[
                          ...aiModels.map((m) => ({ value: m, label: m })),
                          ...(aiPending.model && aiModels.indexOf(aiPending.model) < 0 ? [{ value: aiPending.model, label: aiPending.model }] : []),
                          { value: "__manual__", label: "手填…" },
                        ]} />
                      ) : (
                        <>
                          <span className="ln-input settings-input"><input className="ln-input__field" value={aiPending.model} placeholder={activeDef.defaultModel || "模型名"} onChange={(e) => setAiDraft((d) => ({ ...d, model: e.target.value }))} aria-label="AI 模型" /></span>
                          {aiModels && aiModels.length > 0 && <button className="ln-btn ln-btn--outlined" onClick={() => setAiManualModel(false)}>用列表</button>}
                        </>
                      )}
                      <button className="ln-btn ln-btn--outlined" disabled={aiModelsRun.busy} onClick={() => void fetchAiModels()}>{aiModelsRun.busy ? "拉取中…" : "获取模型列表"}</button>
                    </Field>
                    {activeDef.supportsReasoning && (
                      <Item itemId="ai-reasoning" name="思考强度" desc="推理强度：越高思考越深入、耗时越长（默认 high）。思考模式下温度不生效。">
                        <Select label="思考强度" className="ln-w-200" value={aiPending.reasoningEffort ?? activeDef.defaultReasoningEffort ?? "high"} onChange={(v) => setAiDraft((d) => ({ ...d, reasoningEffort: v as AiReasoningEffort }))} options={AI_REASONING_EFFORTS.map((v) => ({ value: v, label: v }))} />
                      </Item>
                    )}
                    {activeDef.supportsThinking && (
                      <Item itemId="ai-thinking" name="思考模式" desc="关闭可减少 token 消耗与等待时间；开启时温度不生效。">
                        <Select label="思考模式" className="ln-w-200" value={aiPending.thinking ?? "enabled"} onChange={(v) => setAiDraft((d) => ({ ...d, thinking: v as AiThinkingMode }))} options={AI_THINKING_MODES.map((v) => ({ value: v, label: v === "enabled" ? "开启" : "关闭" }))} />
                      </Item>
                    )}
                    {(!activeDef.supportsThinking || aiPending.thinking === "disabled") && (
                      <Item itemId="ai-temperature" name="温度" desc="0 更稳定、2 更发散。">
                        <NumField label="温度" step="any" min={0} max={2} floor={0} fallback={0.7} value={aiPending.temperature} onSave={(n) => setAiDraft((d) => ({ ...d, temperature: n }))} />
                      </Item>
                    )}
                  </Section>

                  <Section title="连通性">
                    <Block itemId="ai-test" name="测试并保存" desc="保存前先发一次最小真实请求：密钥或模型错误会拦住保存，网络或限流错误可以选择仍要保存。">
                      <div className="config-block__actions">
                        <button className="ln-btn ln-btn--outlined" disabled={aiRun.busy} onClick={() => void testAndSaveAi()}>{aiRun.busy ? "测试中…" : "测试并保存"}</button>
                        <button className="ln-btn ln-btn--outlined" disabled={aiRun.busy} onClick={() => void testAi()}>仅测试</button>
                        {aiForceSave && <button className="ln-btn ln-btn--outlined" onClick={() => void forceSaveAi()}>仍要保存</button>}
                      </div>
                      {aiErr.all && <div className="config-item__error">{aiErr.all}</div>}
                      {aiMsg && <div className="config-note">{aiMsg}</div>}
                    </Block>
                    <Switch
                      itemId="ai-enabled"
                      name="AI 助手"
                      desc="关闭后 AI 助手不出网，配置与 API Key 保留；重新打开即可继续使用。"
                      alert={aiEnableAlert}
                      checked={aiEnabled}
                      onChange={(checked) => {
                        // 与「启用云同步」同口径：没有可用配置就别让用户以为已经能用；配好后可随时关/开。
                        if (checked && !activeAi?.hasApiKey) {
                          setAiEnableAlert("先在上方填好供应商与 API Key 并保存，再开启 AI 助手。");
                          return;
                        }
                        setAiEnableAlert(null);
                        saveAiEnabled(checked);
                        setAiEnabled(checked);
                      }}
                    />
                  </Section>
                </Group>
                <Group title="说明">
                  <Block name="内容只在你主动触发时外发" desc="AI 只把你要处理的文本发给你配置的供应商；API Key 只保存在本机，不参与同步、S3 与备份。" />
                  <Block name="多轮对话只保留最近 40 条消息" desc="同一个 AI 面板内会记住上下文（把前面的问答一起发给模型），但最多只带最近 40 条消息（一问一答算 2 条），更早的不会再发送；关闭面板后记忆即清空，不做长期记忆。" />
                </Group>
              </>
    </>
  );
}
