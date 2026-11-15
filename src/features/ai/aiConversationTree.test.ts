/**
 * 桌面 AI 助手「消息版本 / 分支」纯函数护栏（261116，对齐 chat-demo 的 branches.ts）。
 *
 * 锁六件事：
 * ① visiblePath 走当前路径；② versionsOf 取兄弟版本；③ 重新生成产生助手兄弟；
 * ④ 编辑提问 = 从该点分叉（非根 / 根两种）；⑤ 切版本后路径变化且旧分支可选回；
 * ⑥ 旧 schema / 坏数据读取时返回空（不写迁移）。
 */
import { describe, expect, it } from "vitest";
import {
  appendBranch,
  appendTurnText,
  createAiConversationSession,
  readAiConversationSession,
  removeTurn,
  selectVersion,
  serializeAiConversationSession,
  updateTurn,
  versionsOf,
  visiblePath,
  wireMessages,
  type AiConversationSession,
  type AiTurnDraft,
} from "./aiConversationTree";

const user = (id: string, text: string): AiTurnDraft => ({ id, role: "user", text });
const assistant = (id: string, text: string): AiTurnDraft => ({ id, role: "assistant", text });

/** 两轮线性对话：u1 → a1 → u2 → a2（u2 通过 a1 挂到树上）。 */
function twoRounds(): AiConversationSession {
  const first = appendBranch(createAiConversationSession(), null, [user("u1", "第一问"), assistant("a1", "回答一")]);
  return appendBranch(first, "a1", [user("u2", "第二问"), assistant("a2", "回答二")]);
}

const ids = (session: AiConversationSession) => visiblePath(session).map((turn) => turn.id);

describe("消息树：当前路径与兄弟版本", () => {
  it("空会话：路径为空、没有版本", () => {
    const empty = createAiConversationSession();
    expect(visiblePath(empty)).toEqual([]);
    expect(versionsOf(empty, "missing")).toEqual({ ids: [], index: -1 });
  });

  it("visiblePath 从 rootId 沿 selectedChildId 走到叶子；versionsOf 按 messages[] 顺序编号", () => {
    const session = twoRounds();
    expect(ids(session)).toEqual(["u1", "a1", "u2", "a2"]);
    expect(versionsOf(session, "a2")).toEqual({ ids: ["a2"], index: 0 });
    expect(versionsOf(session, "u2")).toEqual({ ids: ["u2"], index: 0 });
  });

  it("坏链/环不会把面板挂死：路径遇到重复节点就停", () => {
    const cyclic = appendBranch(createAiConversationSession(), null, [user("u1", "问"), assistant("a1", "答")]);
    cyclic.messages[0] = { ...cyclic.messages[0], selectedChildId: "a1" };
    cyclic.messages[1] = { ...cyclic.messages[1], selectedChildId: "u1" };
    expect(ids(cyclic)).toEqual(["u1", "a1"]);
  });
});

describe("重新生成：同一用户提问下新增助手兄弟版本", () => {
  it("新回答成为兄弟并选中，旧回答保留在树上", () => {
    const session = appendBranch(twoRounds(), "u2", [assistant("a3", "回答二·新")]);
    expect(ids(session)).toEqual(["u1", "a1", "u2", "a3"]);
    expect(session.messages.find((turn) => turn.id === "u2")?.selectedChildId).toBe("a3");
    expect(versionsOf(session, "a3")).toEqual({ ids: ["a2", "a3"], index: 1 });
    expect(versionsOf(session, "a2")).toEqual({ ids: ["a2", "a3"], index: 0 });
    expect(session.messages.some((turn) => turn.id === "a2")).toBe(true);
  });
});

describe("编辑提问：从该点分叉，旧分支保留", () => {
  it("非根提问新建兄弟（parentId 不变），后续消息走新分支；旧分支后续原样恢复", () => {
    const session = appendBranch(twoRounds(), "a1", [user("u3", "第二问·改"), assistant("a3", "改后回答")]);
    expect(ids(session)).toEqual(["u1", "a1", "u3", "a3"]);
    expect(session.messages.find((turn) => turn.id === "a1")?.selectedChildId).toBe("u3");
    expect(versionsOf(session, "u3")).toEqual({ ids: ["u2", "u3"], index: 1 });
    expect(session.messages.some((turn) => turn.id === "u2")).toBe(true);

    // 切回旧提问版本 ⇒ 连带恢复它自己选中的后续回答（a2）
    expect(ids(selectVersion(session, "u2"))).toEqual(["u1", "a1", "u2", "a2"]);
  });

  it("编辑根提问新建根版本并切换 rootId；切回旧根恢复整条旧分支", () => {
    const session = appendBranch(twoRounds(), null, [user("u0", "第一问·改"), assistant("a0", "新回答")]);
    expect(session.rootId).toBe("u0");
    expect(ids(session)).toEqual(["u0", "a0"]);
    expect(versionsOf(session, "u0")).toEqual({ ids: ["u1", "u0"], index: 1 });

    const back = selectVersion(session, "u1");
    expect(back.rootId).toBe("u1");
    expect(ids(back)).toEqual(["u1", "a1", "u2", "a2"]);
  });

  it("不在当前路径上的后续消息不能直接切过去（只允许切路径节点的兄弟）", () => {
    const session = appendBranch(twoRounds(), "a1", [user("u3", "第二问·改"), assistant("a3", "改后回答")]);
    // u2/a2 所在分支的父节点 a1 在路径上 ⇒ u2 是 u3 的兄弟，可以切（见上一条）；
    // 但更深的 a2 与 u2 并不是 u3 的兄弟（parentId 不同），不能拿它直接改路径。
    expect(selectVersion(session, "a2")).toBe(session);
  });
});

describe("切版本：路径跟随该分支", () => {
  it("切到助手旧版本后路径变化；再切回新版本", () => {
    const session = appendBranch(twoRounds(), "u2", [assistant("a3", "回答二·新")]);
    const old = selectVersion(session, "a2");
    expect(ids(old)).toEqual(["u1", "a1", "u2", "a2"]);
    expect(versionsOf(old, "a2")).toEqual({ ids: ["a2", "a3"], index: 0 });
    const latest = selectVersion(old, "a3");
    expect(ids(latest)).toEqual(["u1", "a1", "u2", "a3"]);
    expect(versionsOf(latest, "a3").index).toBe(1);
  });
});

describe("流式 / 停止 / 上下文", () => {
  it("增量写进指定助手版本；停止留下的半截回答不进后续上下文", () => {
    const streaming = appendTurnText(twoRounds(), "a2", "（续）");
    expect(streaming.messages.find((turn) => turn.id === "a2")?.text).toBe("回答二（续）");
    const interrupted = updateTurn(streaming, "a2", { interrupted: true });
    expect(wireMessages(visiblePath(interrupted))).toEqual([
      { role: "user", content: "第一问" },
      { role: "assistant", content: "回答一" },
      { role: "user", content: "第二问" },
    ]);
  });

  it("用户消息用 wireContent（首轮含选区/全文上下文），助手用正文", () => {
    const session = appendBranch(createAiConversationSession(), null, [
      { id: "u1", role: "user", text: "问", wireContent: "问 + 【选区】上下文" },
    ]);
    expect(wireMessages(visiblePath(session))).toEqual([{ role: "user", content: "问 + 【选区】上下文" }]);
  });

  it("停止时一个字都没生成 ⇒ 移除空助手版本，父提问回落到上一个版本", () => {
    const session = appendBranch(twoRounds(), "u2", [assistant("a3", "")]);
    const removed = removeTurn(session, "a3");
    expect(ids(removed)).toEqual(["u1", "a1", "u2", "a2"]);
    expect(removed.messages.some((turn) => turn.id === "a3")).toBe(false);
  });
});

describe("本地格式：schemaVersion 守卫（不写迁移）", () => {
  it("当前版本可序列化后读回；旧 schema / 无 schemaVersion / 坏 JSON / 断链都返回空", () => {
    const session = twoRounds();
    expect(readAiConversationSession(serializeAiConversationSession(session))).toEqual(session);

    const empty = createAiConversationSession();
    const oldLinear = JSON.stringify({
      rootId: "u1",
      messages: [
        { id: "u1", parentId: null, selectedChildId: "a1", role: "user", text: "第一问" },
        { id: "a1", parentId: "u1", selectedChildId: null, role: "assistant", text: "回答一" },
      ],
    });
    expect(readAiConversationSession(oldLinear)).toEqual(empty);
    expect(readAiConversationSession(JSON.stringify({ schemaVersion: 0, rootId: "u1", messages: [] }))).toEqual(empty);
    expect(readAiConversationSession("不是 JSON")).toEqual(empty);
    expect(readAiConversationSession(null)).toEqual(empty);
    expect(readAiConversationSession({ schemaVersion: 1, rootId: "u9", messages: [] })).toEqual(empty);
    expect(readAiConversationSession({
      schemaVersion: 1,
      rootId: "u1",
      messages: [{ id: "u1", parentId: null, selectedChildId: "ghost", role: "user", text: "问" }],
    })).toEqual(empty);
  });
});
