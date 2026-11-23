// 261112 R2-S7：设置页「ai」分组（纯搬移自 SettingsPanel.tsx；只改文件位置，不改任何设置项/文案）。
import type { SettingsPanelContext } from "../useSettingsPanelScope";
import { Group, Section, Field, Item, NumField, Block, Switch } from "../../../ui/settingsPrimitives";
import { Sparkles, EyeOff, Eye } from "lucide-react";
import { AdaptiveSelect } from "../../../ui/AdaptiveSelect";
import { AI_PROVIDERS, AI_REASONING_EFFORTS, AI_THINKING_MODES, type AiReasoningEffort, type AiThinkingMode } from "../../../../core/aiProviders";
import { saveAiEnabled } from "../../../../lib/aiEnabled";

export function AiSection({ c }: { c: SettingsPanelContext }) {
  const { activeAi, activeDef, aiDraft, aiEnableAlert, aiEnabled, aiErr, aiForceSave, aiKeyVisible, aiManualModel, aiModels, aiModelsRun, aiMsg, aiPending, aiProviderId, aiRun, fetchAiModels, forceSaveAi, saveAi, setAiDraft, setAiEnableAlert, setAiEnabled, setAiKeyVisible, setAiManualModel, switchAiProvider, testAi, testAndSaveAi } = c;
  return (
    <>
              <>
                <Group title="AI 助手" icon={<Sparkles size={16} />}>
                  <Section title="服务">
                    <Field itemId="ai-provider" name="供应商" desc="OpenAI 兼容接口：内置 OpenAI、DeepSeek、通义千问、智谱、MiMo，或「自定义」指向任意兼容端点（Ollama、vLLM 等）；切换时重置为该家默认值。">
                      {/* 261116 用户裁决「做吧，都做」：闭态方向键会逐档触发写盘，属该设置项既有语义（切换供应商会重置默认值）。 */}
                      <AdaptiveSelect label="AI 供应商" value={aiProviderId} onChange={(v) => void switchAiProvider(v)} options={AI_PROVIDERS.map((p) => ({ value: p.id, label: p.label }))} />
                    </Field>
                    <Field itemId="ai-base-url" name="Base URL" desc="留空用该家默认，可改为任意兼容端点。" error={aiErr.baseUrl}>
                      <span className="ln-input settings-input"><input className="ln-input__field" value={aiPending.baseUrl} placeholder={activeDef.defaultBaseUrl} spellCheck={false} onChange={(e) => setAiDraft((d) => ({ ...d, baseUrl: e.target.value }))} aria-label="Base URL" /></span>
                      <button className="ln-btn ln-btn--outlined" onClick={() => setAiDraft((d) => ({ ...d, baseUrl: activeDef.defaultBaseUrl }))}>恢复默认</button>
                    </Field>
                  </Section>

                  <Section title="凭据">
                    <Field
                      itemId="ai-api-key"
                      name={<>API Key <span className={"badge " + (activeAi?.hasApiKey ? "badge--accent" : "badge--muted")}>{activeAi?.hasApiKey ? "已保存" : "未配置"}</span></>}
                      desc="本机加密保存（防误读，非安全边界），不同步不上传；留空沿用已存，输入即替换。"
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
                    <Field itemId="ai-model" name="模型" desc="「获取模型列表」会同时验证连通性；端点不支持 /models 时手填。" error={aiErr.model}>
                      {/* 动态候选 + `__manual__` 哨兵原样保留：选到「手填…」必须切手动输入，不写草稿模型。 */}
                      {aiModels && aiModels.length > 0 && !aiManualModel ? (
                        <AdaptiveSelect label="AI 模型" value={aiPending.model} onChange={(v) => { if (v === "__manual__") { setAiManualModel(true); return; } setAiDraft((d) => ({ ...d, model: v })); }} options={[
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
                      <Item itemId="ai-reasoning" name="思考强度" desc="越高思考越深入、耗时越长；思考模式下温度不生效。">
                        <AdaptiveSelect label="思考强度" className="ln-w-200" value={aiPending.reasoningEffort ?? activeDef.defaultReasoningEffort ?? "high"} onChange={(v) => setAiDraft((d) => ({ ...d, reasoningEffort: v as AiReasoningEffort }))} options={AI_REASONING_EFFORTS.map((v) => ({ value: v, label: v }))} />
                      </Item>
                    )}
                    {activeDef.supportsThinking && (
                      <Item itemId="ai-thinking" name="思考模式" desc="关闭省 token 与等待时间；开启时温度不生效。">
                        <AdaptiveSelect label="思考模式" className="ln-w-200" value={aiPending.thinking ?? "enabled"} onChange={(v) => setAiDraft((d) => ({ ...d, thinking: v as AiThinkingMode }))} options={AI_THINKING_MODES.map((v) => ({ value: v, label: v === "enabled" ? "开启" : "关闭" }))} />
                      </Item>
                    )}
                    {(!activeDef.supportsThinking || aiPending.thinking === "disabled") && (
                      <Item itemId="ai-temperature" name="温度" desc="0 更稳定、2 更发散。">
                        <NumField label="温度" step="any" min={0} max={2} floor={0} fallback={0.7} value={aiPending.temperature} onSave={(n) => setAiDraft((d) => ({ ...d, temperature: n }))} />
                      </Item>
                    )}
                  </Section>

                  <Section title="连通性">
                    <Block itemId="ai-test" name="测试并保存" desc="保存前先发最小请求验证：密钥/模型错误拦下保存，网络错误可「仍要保存」。">
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
                      desc="关闭即不出网；配置与 API Key 保留。"
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
                  <Block name="内容只在你主动触发时外发" desc="只在你触发时把所选内容发给所配供应商；API Key 仅存本机、不参与同步与备份。" />
                  <Block name="多轮对话只保留最近 40 条消息" desc="同一面板内携带最近 40 条上下文（一问一答算 2 条），更早不发送；关闭面板即清空。" />
                </Group>
              </>
    </>
  );
}
