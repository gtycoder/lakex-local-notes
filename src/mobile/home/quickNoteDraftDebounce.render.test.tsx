// @vitest-environment jsdom
/**
 * 速记 composer 草稿防抖「内核就绪边缘」护栏（261119）。
 *
 * 现场：草稿防抖 300ms 到点时内核分包/实例化往往还没好（0.3–0.9s），getBody() 只能拿到 "" ⇒
 * saveQuickNoteDraft 写下 body:""，把恢复出来的富正文草稿覆盖掉，下次恢复只剩纯文本（富格式丢）。
 * 修复口径（QuickNoteComposer 的落草稿 effect）：
 *   ① flush 等内核就绪 —— editorReady 进依赖，就绪前不排防抖、就绪后照常 300ms 落库；
 *   ② 空 body 一律不写（text 有值而 body 空 = 内核没交出正文，写下去就是丢富格式）。
 * 本文件用真实挂载把「未就绪不写空 body、就绪后正常写」两条钉住。
 */
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  getQuickNoteDraft: vi.fn(),
  saveQuickNoteDraft: vi.fn(),
  clearQuickNoteDraft: vi.fn(),
  /** QuickNoteEditor 桩收到的 props（onReady / onTextChange 由测试显式触发，时序确定）。 */
  editorProps: null as null | {
    initialBody: string;
    onReady: (api: { getBody: () => string; getText: () => string; focus: () => void }) => void;
    onTextChange: (text: string) => void;
  },
  /** 内核桩正文：未就绪 = 没有 api；就绪后由测试给值。 */
  kernelBody: "",
}));

vi.mock("../bridge", () => ({
  bridge: {
    getQuickNoteDraft: () => h.getQuickNoteDraft(),
    saveQuickNoteDraft: (draft: unknown) => { h.saveQuickNoteDraft(draft); return Promise.resolve(); },
    clearQuickNoteDraft: () => h.clearQuickNoteDraft(),
    getCloudState: async () => ({ mode: "manual", configured: false }),
  },
}));
vi.mock("../../features/quickNotes/QuickNoteEditor", () => ({
  QuickNoteEditor: (props: {
    initialBody: string;
    onReady: (api: { getBody: () => string; getText: () => string; focus: () => void }) => void;
    onTextChange: (text: string) => void;
  }) => {
    h.editorProps = props;
    return createElement("div", { "data-testid": "kernel-host" });
  },
}));
vi.mock("../editor/EditorDockHost", () => ({ EditorDockHost: () => null }));
vi.mock("./MobileQuickNoteTagSheet", () => ({ MobileQuickNoteTagSheet: () => null }));
vi.mock("../../features/editor/clipboardHtml", () => ({ installPasteInterceptor: () => undefined }));
vi.mock("../../features/editor/resourceUpload", () => ({ uploadLakeResource: async () => { throw new Error("not-used"); } }));
vi.mock("../editor/execCommand", () => ({
  editorCommandFailureMessage: () => "",
  execEditorCommandResult: () => ({ ok: true }),
}));
vi.mock("../lib/actionError", () => ({ toastActionError: () => undefined }));
vi.mock("../ui/toastBus", () => ({ showToast: () => undefined }));
vi.mock("../ui/haptics", () => ({ successFeedback: () => undefined, warnFeedback: () => undefined }));
vi.mock("../native/nativeKeyboard", () => ({ showNativeKeyboard: () => undefined }));
vi.mock("../hooks/useCaretIntoView", () => ({ useCaretIntoView: () => undefined }));
vi.mock("../hooks/viewportShell", () => ({ shellHeight: () => 0 }));
vi.mock("../sync/syncSettingsStore", () => ({ subscribeSyncSettings: () => () => undefined }));

import { QuickNoteComposer } from "./QuickNoteComposer";

const RICH_BODY = "<p>你好<b>富格式</b></p>";
const DRAFT = { id: "qn_draft01", text: "你好", body: RICH_BODY, tagIds: [] as string[], images: [] };

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

const flush = async () => {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  h.getQuickNoteDraft.mockReset().mockResolvedValue({ ...DRAFT });
  h.saveQuickNoteDraft.mockReset();
  h.clearQuickNoteDraft.mockReset().mockResolvedValue(undefined);
  h.editorProps = null;
  h.kernelBody = "";
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const mount = async () => {
  await act(async () => {
    root.render(createElement(QuickNoteComposer, {
      draft: true,
      tagOptions: [],
      onSaved: async () => undefined,
      onCancel: () => undefined,
    }));
    await Promise.resolve();
  });
  await flush();
};

const ready = (body: string) => {
  h.kernelBody = body;
  act(() => {
    h.editorProps!.onReady({ getBody: () => h.kernelBody, getText: () => "你好", focus: () => undefined });
  });
};

describe("草稿防抖 × 内核就绪（261119）", () => {
  it("内核未就绪不写空 body（防抖到点也不落库，富正文草稿不被 body:\"\" 覆盖）", async () => {
    await mount();
    // 草稿已恢复（写作卡挂上内核桩），但 onReady 还没来 —— 分包/实例化中。
    expect(h.editorProps).toBeTruthy();
    await act(async () => { vi.advanceTimersByTime(5_000); });
    expect(h.saveQuickNoteDraft).not.toHaveBeenCalled();
    // 草稿本体没被空 body 覆盖
    expect(h.getQuickNoteDraft).toHaveBeenCalled();
  });

  it("内核就绪后正常写（300ms 防抖落原样 body）", async () => {
    await mount();
    ready(RICH_BODY);
    await act(async () => { vi.advanceTimersByTime(299); });
    expect(h.saveQuickNoteDraft).not.toHaveBeenCalled();
    await act(async () => { vi.advanceTimersByTime(1); });
    expect(h.saveQuickNoteDraft).toHaveBeenCalledWith({ id: DRAFT.id, text: DRAFT.text, body: RICH_BODY, tagIds: [] });
  });

  it("就绪后正文仍为空 ⇒ 不写（空 body 草稿等于丢富格式）", async () => {
    await mount();
    ready("");
    act(() => { h.editorProps!.onTextChange("你好"); });
    await act(async () => { vi.advanceTimersByTime(5_000); });
    expect(h.saveQuickNoteDraft).not.toHaveBeenCalled();
  });

  it("就绪后正文变化 ⇒ 空档 300ms 正常落库（不影响既有防抖节奏）", async () => {
    await mount();
    ready(RICH_BODY);
    await act(async () => { vi.advanceTimersByTime(300); });
    expect(h.saveQuickNoteDraft).toHaveBeenCalledTimes(1);
    h.kernelBody = "<p>改过了</p>";
    act(() => { h.editorProps!.onTextChange("改过了"); });
    await act(async () => { vi.advanceTimersByTime(300); });
    expect(h.saveQuickNoteDraft).toHaveBeenLastCalledWith({ id: DRAFT.id, text: "改过了", body: "<p>改过了</p>", tagIds: [] });
  });
});
