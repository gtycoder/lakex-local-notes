import { useEffect, useState } from "react";
import { bridge } from "../bridge";
import { loadAiEnabled } from "../ai/aiSettings";
import { aiErrorInfoFromCode } from "../../core/aiErrors";
import { aiConnectionFingerprint, getVerifiedAiFingerprint, invalidateAiConnectionVerified, markAiConnectionVerified } from "./aiTestState";

/** AI接入表单自己的草稿、验证指纹与动作；关闭分类不丢设置草稿。 */
export function useAiSettingsForm(active: boolean) {
  // ── AI 助手（261023 P1）：开关与接入配置；Key 只在原生（Android Keystore），这里只显示尾号 ──
  const [aiEnabled, setAiEnabled] = useState(() => loadAiEnabled());
  const [aiMeta, setAiMeta] = useState<{ baseUrl: string; model: string; hasKey: boolean; keyTail: string; temperature: number } | null>(null);
  const [aiForm, setAiForm] = useState({ baseUrl: "", model: "", apiKey: "", temperature: "" });
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
  useEffect(() => {
    if (!active) return;
    void bridge.aiGetSettings().then((settings) => {
      setAiMeta(settings);
      setAiForm({ baseUrl: settings.baseUrl, model: settings.model, apiKey: "", temperature: String(settings.temperature) });
    }).catch((error) => setAiMsg("读取 AI 设置失败：" + (error as Error).message));
  }, [active]);
  const saveAiSettingsForm = async (): Promise<void> => {
    try {
      const temperature = Number(aiForm.temperature);
      await bridge.aiSaveSettings({
        baseUrl: aiForm.baseUrl.trim(),
        model: aiForm.model.trim(),
        ...(aiForm.apiKey.trim() ? { apiKey: aiForm.apiKey.trim() } : {}),
        ...(Number.isFinite(temperature) ? { temperature } : {}),
      });
      const settings = await bridge.aiGetSettings();
      setAiMeta(settings);
      setAiForm({ baseUrl: settings.baseUrl, model: settings.model, apiKey: "", temperature: String(settings.temperature) });
      setAiMsg("已保存");
    } catch (error) {
      setAiMsg("保存失败：" + (error as Error).message);
    }
  };
  const testAiConnection = async (): Promise<void> => {
    setAiMsg("正在测试…");
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
    if (settings) setAiMeta(settings);
    const fp = aiConnectionFingerprint({
      baseUrl: settings?.baseUrl ?? aiIdentity.baseUrl,
      model: settings?.model ?? aiIdentity.model,
      hasKey: settings ? settings.hasKey : aiIdentity.hasKey,
      keyTail: settings ? settings.keyTail : aiIdentity.keyTail,
    });
    markAiConnectionVerified(fp);
    setAiVerifiedFp(fp);
    setAiMsg("连通性正常");
  };


  return { aiEnabled, setAiEnabled, aiMeta, setAiMeta, aiForm, setAiForm, aiMsg, setAiMsg, aiVerified, saveAiSettingsForm, testAiConnection };
}
