import { useEffect, useRef, useState } from "react";
import { bridge } from "../bridge";
import { loadAiEnabled } from "../ai/aiSettings";
import { aiErrorInfoFromCode } from "../../core/aiErrors";
import { aiProviderDef, DEFAULT_AI_PROVIDER_ID } from "../../core/aiProviders";
import type { AiReasoningEffort, AiThinkingMode } from "../../core/aiProviders";
import { getNativeErrorMessage } from "../../lib/nativeErrors";
import { aiConnectionFingerprint, getVerifiedAiFingerprint, invalidateAiConnectionVerified, markAiConnectionVerified } from "./aiTestState";
import { aiProviderPreset, inferAiProviderId, readAiProviderId, writeAiProviderId } from "../ai/aiProviderPrefs";

/** 移动端原生通道的设置视图（无明文 Key；含思考参数）。 */
export interface AiSettingsMeta {
  baseUrl: string;
  model: string;
  hasKey: boolean;
  keyTail: string;
  temperature: number;
  reasoningEffort: AiReasoningEffort | null;
  thinking: AiThinkingMode | null;
}

export interface AiSettingsFormValues {
  baseUrl: string;
  model: string;
  apiKey: string;
  temperature: string;
  /** 空串 = 该供应商不支持/未设置（与桌面 AiSection 的「仅 supports* 才显示」一致）。 */
  reasoningEffort: string;
  thinking: string;
}

const EMPTY_FORM: AiSettingsFormValues = {
  baseUrl: "",
  model: "",
  apiKey: "",
  temperature: "",
  reasoningEffort: "",
  thinking: "",
};

/**
 * AI 接入表单：草稿、验证指纹与动作；关闭分类不丢设置草稿。
 *
 * 261114 用户点单：**与桌面一样先选服务供应商**（内置 AI_PROVIDERS 同一份目录）——
 * 切换供应商 = 用该家默认端点/模型/思考参数填充表单；当前选择只存本机（不含密钥、不同步），
 * Key 仍只有原生通道持有的一份（移动端与桌面的存储差异见 docs/HANDOFF / guide 10）。
 */
export function useAiSettingsForm(active: boolean) {
  // ── AI 助手（261023 P1）：开关与接入配置；Key 只在原生（Android Keystore），这里只显示尾号 ──
  const [aiEnabled, setAiEnabled] = useState(() => loadAiEnabled());
  const [aiMeta, setAiMeta] = useState<AiSettingsMeta | null>(null);
  const [aiForm, setAiForm] = useState<AiSettingsFormValues>(EMPTY_FORM);
  /** 当前供应商（本机偏好，打开时按已保存 baseUrl 反推优先）。 */
  const [aiProviderId, setAiProviderId] = useState<string>(() => readAiProviderId() ?? DEFAULT_AI_PROVIDER_ID);
  const initialized = useRef(false);
  const [aiMsg, setAiMsg] = useState("");
  /** 防御开启（261029）：只有**当前已保存的 AI 连接配置**测试通过过，才允许把开关打开。 */
  const [aiVerifiedFp, setAiVerifiedFp] = useState<string | null>(() => getVerifiedAiFingerprint());
  const aiIdentity = {
    baseUrl: aiMeta?.baseUrl ?? "",
    model: aiMeta?.model ?? "",
    hasKey: !!aiMeta?.hasKey,
    keyTail: aiMeta?.keyTail ?? "",
  };
  const aiVerified = aiVerifiedFp !== null && aiMeta !== null && aiVerifiedFp === aiConnectionFingerprint(aiIdentity);

  /** 已保存配置 + 供应商默认值 → 表单（思考参数：服务端没存过就回落该家默认）。 */
  const formFromSettings = (settings: AiSettingsMeta, providerId: string): AiSettingsFormValues => {
    const preset = aiProviderPreset(providerId);
    return {
      baseUrl: settings.baseUrl,
      model: settings.model,
      apiKey: "",
      temperature: String(settings.temperature),
      reasoningEffort: settings.reasoningEffort ?? preset.reasoningEffort,
      thinking: settings.thinking ?? preset.thinking,
    };
  };

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    void bridge.aiGetSettings().then((settings) => {
      if (cancelled) return;
      // 已保存的 baseUrl 就是真相：能反推出供应商就用它，其次本机记住的选择，最后默认第一家。
      const providerId = inferAiProviderId(settings.baseUrl) ?? readAiProviderId() ?? DEFAULT_AI_PROVIDER_ID;
      setAiProviderId(providerId);
      writeAiProviderId(providerId);
      setAiMeta(settings as AiSettingsMeta);
      if (!initialized.current) {
        initialized.current = true;
        setAiForm(formFromSettings(settings as AiSettingsMeta, providerId));
      }
    }).catch((error) => { if (!cancelled) setAiMsg("读取 AI 设置失败：" + getNativeErrorMessage(error)); });
    return () => { cancelled = true; };
  }, [active]);

  /** 切换供应商：填该家默认端点/模型/思考参数；连接验证立即失效（与桌面 switchAiProvider 同口径）。 */
  const switchProvider = (id: string): void => {
    if (!aiProviderDef(id)) return;
    setAiProviderId(id);
    writeAiProviderId(id);
    setAiForm((current) => ({ ...current, ...aiProviderPreset(id), apiKey: "" }));
    invalidateAiConnectionVerified();
    setAiVerifiedFp(null);
    setAiMsg("");
  };

  const saveAiSettingsForm = async (): Promise<void> => {
    const def = aiProviderDef(aiProviderId);
    const preset = aiProviderPreset(aiProviderId);
    const temperature = Number(aiForm.temperature);
    // 不支持的供应商显式送 null（清掉上一次切换残留的思考参数，避免把 A 家的参数发给 B 家）。
    const reasoningEffort = def?.supportsReasoning ? (aiForm.reasoningEffort || preset.reasoningEffort || "") : "";
    const thinking = def?.supportsThinking ? (aiForm.thinking || preset.thinking || "enabled") : "";
    try {
      await bridge.aiSaveSettings({
        baseUrl: aiForm.baseUrl.trim(),
        model: aiForm.model.trim(),
        ...(aiForm.apiKey.trim() ? { apiKey: aiForm.apiKey.trim() } : {}),
        ...(Number.isFinite(temperature) ? { temperature } : {}),
        reasoningEffort: (reasoningEffort as AiReasoningEffort) || null,
        thinking: (thinking as AiThinkingMode) || null,
      });
      const settings = await bridge.aiGetSettings();
      setAiMeta(settings as AiSettingsMeta);
      setAiForm(formFromSettings(settings as AiSettingsMeta, aiProviderId));
      setAiMsg("已保存");
    } catch (error) {
      setAiMsg("保存失败：" + (error as Error).message);
    }
  };

  const testAiConnection = async (): Promise<void> => {
    setAiMsg("正在测试…");
    try {
      const result = await bridge.aiTestConnection();
      if (!result.ok) {
        // 失败即视为未验证（防止"以前测通过过"继续放行）。
        invalidateAiConnectionVerified();
        setAiVerifiedFp(null);
        setAiMsg(aiErrorInfoFromCode({ code: result.code, status: result.status, detail: result.detail }).message);
        return;
      }
      // 通过：按「当时实际的已保存配置」的指纹记账；之后只有改动连接字段/换 Key 才会失效。
      const settings = await bridge.aiGetSettings().catch(() => null);
      if (settings) setAiMeta(settings as AiSettingsMeta);
      const fp = aiConnectionFingerprint({
        baseUrl: settings?.baseUrl ?? aiIdentity.baseUrl,
        model: settings?.model ?? aiIdentity.model,
        hasKey: settings ? settings.hasKey : aiIdentity.hasKey,
        keyTail: settings ? settings.keyTail : aiIdentity.keyTail,
      });
      markAiConnectionVerified(fp);
      setAiVerifiedFp(fp);
      setAiMsg("连通性正常");
    } catch (error) {
      invalidateAiConnectionVerified();
      setAiVerifiedFp(null);
      setAiMsg("测试失败：" + getNativeErrorMessage(error) + "；可重试测试连通性。");
    }
  };


  return {
    aiEnabled, setAiEnabled, aiMeta, setAiMeta, aiForm, setAiForm, aiMsg, setAiMsg, aiVerified,
    aiProviderId, switchProvider, activeProviderDef: aiProviderDef(aiProviderId),
    saveAiSettingsForm, testAiConnection,
  };
}
