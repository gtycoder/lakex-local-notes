// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ read: vi.fn(), test: vi.fn() }));
vi.mock("../bridge", () => ({ bridge: { aiGetSettings: mocks.read, aiTestConnection: mocks.test } }));
import { useAiSettingsForm } from "./useAiSettingsForm";
let host: HTMLDivElement, root: Root, form: ReturnType<typeof useAiSettingsForm>;
function Harness({ active }: { active: boolean }) { form = useAiSettingsForm(active); return null; }
const settings = (model: string) => ({ baseUrl: "https://example.test/v1", model, hasKey: false, keyTail: "", temperature: .7, reasoningEffort: null, thinking: null });
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); localStorage.clear(); mocks.read.mockReset(); mocks.test.mockReset();
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
it("原生测试通道拒绝时显示可重试的失败，结束测试状态", async () => {
  mocks.read.mockResolvedValue(settings("模型")); mocks.test.mockRejectedValue(new Error("原生通道断开")); await render(true);
  await act(async () => { await expect(form.testAiConnection()).resolves.toBeUndefined(); });
  expect(form.aiMsg).toContain("原生通道断开"); expect(form.aiMsg).not.toBe("正在测试…"); expect(form.aiVerified).toBe(false);
});
