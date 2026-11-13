// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ read: vi.fn(), save: vi.fn(), test: vi.fn(), list: vi.fn() }));
vi.mock("../bridge", () => ({ bridge: { aiGetSettings: mocks.read, aiSaveSettings: mocks.save, aiTestConnection: mocks.test, aiListModels: mocks.list } }));
import { useAiSettingsForm } from "./useAiSettingsForm";
let host: HTMLDivElement, root: Root, form: ReturnType<typeof useAiSettingsForm>;
function Harness({ active }: { active: boolean }) { form = useAiSettingsForm(active); return null; }
const settings = (model: string) => ({ baseUrl: "https://example.test/v1", model, hasKey: false, keyTail: "", temperature: .7, reasoningEffort: null, thinking: null });
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); localStorage.clear(); mocks.read.mockReset(); mocks.save.mockReset(); mocks.test.mockReset(); mocks.list.mockReset();
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
const render = (active: boolean) => act(async () => { root.render(createElement(Harness, { active })); });
it("关闭前的读取晚到，不覆盖重开后的设置", async () => {
  let resolve!: (value: ReturnType<typeof settings>) => void;
  mocks.read.mockReturnValueOnce(new Promise(r => { resolve = r; })).mockResolvedValueOnce(settings("最新模型"));
  await render(true); await render(false); await render(true);
  expect(form.aiForm.model).toBe("最新模型");
  await act(async () => resolve(settings("过期模型")));
  expect(form.aiMeta?.model).toBe("最新模型"); expect(form.aiForm.model).toBe("最新模型");
});
it("分类关闭和重开不会用已保存值覆盖未保存的表单草稿", async () => {
  mocks.read.mockResolvedValue(settings("已保存模型")); await render(true);
  act(() => form.setAiForm(current => ({ ...current, model: "草稿模型" })));
  await render(false); await render(true);
  expect(form.aiForm.model).toBe("草稿模型"); expect(form.aiMeta?.model).toBe("已保存模型");
});
it("打开时按已保存 baseUrl 反推供应商；切换供应商填该家默认值并本机记住", async () => {
  mocks.read.mockResolvedValue({ ...settings("deepseek-flash"), baseUrl: "https://api.deepseek.com/v1", reasoningEffort: null, thinking: null });
  await render(true);
  expect(form.aiProviderId).toBe("deepseek");
  // 保存过的配置没存思考参数 ⇒ 回落该家默认（DeepSeek：high/enabled）
  expect(form.aiForm.reasoningEffort).toBe("high");
  expect(form.aiForm.thinking).toBe("enabled");
  act(() => form.switchProvider("qwen"));
  expect(form.aiProviderId).toBe("qwen");
  expect(form.aiForm.baseUrl).toContain("dashscope");
  expect(form.aiForm.model).toBe("qwen-plus");
  expect(localStorage.getItem("lakex-local-notes-mobile.ai.provider")).toBe("qwen");
});

it("保存按供应商发送思考参数：支持家送 effort/thinking，不支持家显式清空", async () => {
  mocks.read.mockResolvedValue({ ...settings("deepseek-flash"), baseUrl: "https://api.deepseek.com/v1" });
  mocks.save.mockResolvedValue({ ok: true });
  await render(true);
  act(() => form.setAiForm((f) => ({ ...f, apiKey: "sk-test" })));
  await act(async () => { await form.saveAiSettingsForm(); });
  expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({
    reasoningEffort: "high",
    thinking: "enabled",
    apiKey: "sk-test",
  }));
  act(() => form.switchProvider("qwen"));
  act(() => form.setAiForm((f) => ({ ...f, baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1", model: "qwen-plus" })));
  await act(async () => { await form.saveAiSettingsForm(); });
  // 不支持思考参数的供应商：显式 null，清掉上一次切换残留。
  expect(mocks.save).toHaveBeenLastCalledWith(expect.objectContaining({ reasoningEffort: null, thinking: null, model: "qwen-plus" }));
});

it("获取模型列表：成功则展示候选，模型为空时自动填第一个", async () => {
  mocks.read.mockResolvedValue({ ...settings(""), baseUrl: "https://api.deepseek.com/v1" });
  mocks.list.mockResolvedValue({ ok: true, models: ["deepseek-flash", "deepseek-chat"] });
  await render(true);
  act(() => form.setAiForm((f) => ({ ...f, apiKey: "sk-draft" })));
  await act(async () => { await form.fetchAiModels(); });
  expect(mocks.list).toHaveBeenCalledWith({ baseUrl: "https://api.deepseek.com/v1", apiKey: "sk-draft" });
  expect(form.aiModels).toEqual(["deepseek-flash", "deepseek-chat"]);
  expect(form.aiForm.model).toBe("deepseek-flash");
  expect(form.aiMsg).toContain("已获取模型列表");
});

it("获取模型列表：失败原样给出原因；没有 Key 时不发请求", async () => {
  mocks.read.mockResolvedValue({ ...settings("模型") });
  await render(true);
  // 没有已存 Key、也没有草稿 Key ⇒ 先提示，绝不发注定失败的请求
  await act(async () => { await form.fetchAiModels(); });
  expect(mocks.list).not.toHaveBeenCalled();
  expect(form.aiMsg).toContain("请先填写 API Key");
  // 有草稿 Key ⇒ 请求失败时把供应商给的原因展示出来
  act(() => form.setAiForm((f) => ({ ...f, apiKey: "sk-draft" })));
  mocks.list.mockResolvedValue({ ok: false, code: "auth", status: 401, detail: "Invalid API key" });
  await act(async () => { await form.fetchAiModels(); });
  expect(form.aiModels).toBeNull();
  expect(form.aiMsg).toContain("Invalid API key");
});

it("原生测试通道拒绝时显示可重试的失败，结束测试状态", async () => {
  mocks.read.mockResolvedValue(settings("模型")); mocks.test.mockRejectedValue(new Error("原生通道断开")); await render(true);
  await act(async () => { await expect(form.testAiConnection()).resolves.toBeUndefined(); });
  expect(form.aiMsg).toContain("原生通道断开"); expect(form.aiMsg).not.toBe("正在测试…"); expect(form.aiVerified).toBe(false);
});
