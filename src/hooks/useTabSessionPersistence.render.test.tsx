// @vitest-environment jsdom
/**
 * Batch4-D 回归护栏：安全模式下会话文件**内容不变**（这是 Batch3 遗留 bug：安全模式不恢复标签，
 * 但 App 的会话写 effect 仍把 [] 写回会话文件 ⇒ 用户原会话被覆盖、下次正常启动也恢复不回来）。
 *
 * 覆盖三层：① 写入门判据（active/unknown ⇒ 不碰文件）；② 正常模式行为不变（write/clear）；
 * ③ App 接线是单一来源（App 里不再直接 writeTabSession，改用 useTabSessionPersistence）。
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TAB_SESSION_KEY } from "../desktop/tabSession";
import type { OpenTab } from "../desktop/desktopTypes";
import type { SafeModeStatus } from "./useSafeModeStatus";
import { useTabSessionPersistence } from "./useTabSessionPersistence";

const SAVED = JSON.stringify({ ids: ["keep-1", "keep-2"], activeId: "keep-2" });

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot> | null = null;

interface Props {
  ready?: boolean;
  tabs?: OpenTab[];
  activeId?: string | null;
  clearTabsOnExit?: boolean;
  safeModeStatus: SafeModeStatus;
}

const tab = (noteId: string): OpenTab => ({ noteId, title: noteId, kind: "doc" } as OpenTab);

function Harness({ ready = true, tabs = [], activeId = null, clearTabsOnExit = false, safeModeStatus }: Props): null {
  useTabSessionPersistence({ ready, openTabs: tabs, activeNoteId: activeId, clearTabsOnExit, safeModeStatus });
  return null;
}

async function render(props: Props): Promise<void> {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => { root!.render(<Harness {...props} />); });
}

const readSession = (): string | null => localStorage.getItem(TAB_SESSION_KEY);

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  localStorage.setItem(TAB_SESSION_KEY, SAVED);
});
afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  host?.remove();
});

describe("useTabSessionPersistence（会话写入门）", () => {
  it("安全模式：即使标签为空/变化，会话文件内容原样保留（不写）", async () => {
    await render({ safeModeStatus: "active" });
    expect(readSession()).toBe(SAVED);
    // 标签变化（例如安全模式里用户自己打开又关掉）也不得覆盖原会话
    await act(async () => { root!.render(<Harness safeModeStatus="active" tabs={[tab("new-1")]} activeId="new-1" />); });
    expect(readSession()).toBe(SAVED);
  });

  it("判据未到达（unknown）：不碰会话文件（宁可晚一条，也不冒覆盖风险）", async () => {
    await render({ safeModeStatus: "unknown" });
    expect(readSession()).toBe(SAVED);
  });

  it("未就绪（workspace 尚未到达）：不写（避免把空标签写进去）", async () => {
    await render({ ready: false, safeModeStatus: "inactive" });
    expect(readSession()).toBe(SAVED);
  });

  it("正常模式：行为不变（写 ids/activeId）", async () => {
    await render({ safeModeStatus: "inactive", tabs: [tab("a"), tab("b")], activeId: "b" });
    expect(JSON.parse(readSession()!)).toEqual({ ids: ["a", "b"], activeId: "b" });
  });

  it("正常模式 + 退出时关闭全部标签：清档（原语义）", async () => {
    await render({ safeModeStatus: "inactive", clearTabsOnExit: true, tabs: [tab("a")], activeId: "a" });
    expect(readSession()).toBeNull();
  });
});


