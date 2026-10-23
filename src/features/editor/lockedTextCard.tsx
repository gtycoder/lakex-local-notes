/**
 * 「加密文本」卡（lake-locked-text）—— React 部分；密码学与落盘值模型见 `src/core/lockedText.ts`。
 *
 * 产品口径（用户 261023 定稿）：
 *   ① **加密存储**：正文只以密文写进 cardValue（→ .lake → S3 镜像）；② **无密码不可见正文**；
 *   ③ **多端同一个密码**：salt 与 KDF 参数随密文存，任意设备输入同一密码即可解开（端到端，本机派生密钥）。
 *
 * 结构性不变量（改这个文件前先读完，写错一条就等于"明文加了个壳"）：
 * - **明文只在组件内存里**：绝不 setDocument / 绝不调内核命令 / 绝不把明文或密码写进 cardValue。
 *   唯一会触发文档变脏的写操作 = `sealLockedText(...)` 之后 `updateCardValue(cipher)`。
 * - **未设密码的新卡不允许写正文**：先设密码（立刻落一份空密文），再编辑 ⇒ 永远不存在"明文落盘窗口"。
 * - **导出/复制/搜索只给占位**（`writeText/writeHtml`）⇒ 不会污染 md_cache / text_cache / 剪贴板 / DOCX。
 * - **密码不记忆、不落盘**：解锁只在本次组件生命周期内有效；关掉文档/重启应用要重新输入。
 * - 忘记密码 = 不可解（没有找回、没有托管）——UI 必须把这句话显示在设置密码处。
 * - **关标签/锁文档/退出前必须把未落盘的明文补写**（评审 B1）：会话缓存派生密钥后单次加密 <1ms，
 *   再加上 `lockedTextFlush` 注册表让生命周期入口先 await 本卡的 flush，避免"最后 250ms 明文丢失"。
 *
 * 与语雀 App 的 `lockedtext` 卡的关系：那是**内核内置节点名**、服务端加解密；内核会把它当未知卡
 * 走 fallback（「该卡片暂时无法显示」），**不会**走到本卡的节点上，所以这里没有"语雀旧卡态"。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  LOCKED_TEXT_CARD_NAME,
  LOCKED_TEXT_MIN_PASSWORD_CHARS,
  LockedTextError,
  createLockedTextSession,
  isLockedTextCipher,
  isValidLockedTextPassword,
  lockedTextExportHtml,
  lockedTextExportText,
  lockedTextKind,
  openLockedTextSession,
  openLockedTextWithSession,
  sealLockedText,
  type LockedTextCipher,
  type LockedTextSessionKey,
} from "../../core/lockedText";
import { LOCKED_TEXT_ICON_ID, LockedTextIconSymbol } from "./lockedTextIcon";
import { registerLockedTextFlush } from "./lockedTextFlush";
import { CUSTOM_CARD_SLASH_GROUP_TITLE, appendCustomCard, withCustomCardSlashItem } from "./customCardUtils";
import "./lockedTextCard.css";

/** 斜杠项名：官方规定必须是 `custom-${name}`（yuque-developer-docs 69）。 */
export const LOCKED_TEXT_SLASH_ITEM = `custom-${LOCKED_TEXT_CARD_NAME}`;
/** 斜杠主搜索词（与语雀一致：/jm）。 */
export const LOCKED_TEXT_MAIN_SEARCH = "/jm";
/** 自动加密防抖：密钥已在会话里缓存，单次加密 <1ms ⇒ 可以压得比 KDF 档短很多。 */
const COMMIT_DEBOUNCE_MS = 250;

interface LockedTextCardProps {
  mode: "edit" | "view";
  cardValue?: unknown;
  updateCardValue?: (value: LockedTextCipher) => void;
}

interface Session extends LockedTextSessionKey {
  /** 已加密落盘的明文快照（用于判断"是否有未落盘改动"）。 */
  plain: string;
}

type Phase = "setup" | "locked" | "unlocked" | "broken";

function describeError(error: unknown): string {
  if (error instanceof LockedTextError) {
    switch (error.code) {
      case "bad-password": return "密码错误";
      case "invalid-input": return "正文过长或参数不合法";
      case "invalid-value": return "数据格式不正确，已原样保留";
      case "crypto-unavailable": return "当前环境不支持加密（WebCrypto 不可用）";
      default: return "加密文本处理失败";
    }
  }
  return "加密文本处理失败";
}

function LockedTextCard({ mode, cardValue, updateCardValue }: LockedTextCardProps) {
  const kind = lockedTextKind(cardValue);
  const [session, setSession] = useState<Session | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [passwordInput, setPasswordInput] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [changing, setChanging] = useState(false);
  /** 最近一次"本卡自己写出去"的 ct：用来区分"确认是外部改动"（撤销/他端/历史恢复）。 */
  const lastWrittenCt = useRef<string | null>(null);
  // 供异步回调/生命周期 flush 读取最新会话（避免闭包拿到旧 key/salt）。必须在 commit 之前声明。
  const sessionRef = useRef<Session | null>(session);
  sessionRef.current = session;
  const draftRef = useRef(draft);
  draftRef.current = draft;

  const phase: Phase = session
    ? "unlocked"
    : kind === "cipher"
      ? "locked"
      : kind === "unknown"
        ? "broken"
        : "setup";

  /** 加密并落盘；成功返回 true。**只有这里允许调 updateCardValue**。
   *  `silent` = 自动保存（防抖 / 失焦 / 生命周期 flush）：不显示"处理中…"、不禁用输入。 */
  const commit = useCallback(async (plain: string, silent = false): Promise<boolean> => {
    const current = sessionRef.current;
    if (!current) return false;
    if (!updateCardValue) {
      setError("卡片未接入保存通道");
      return false;
    }
    if (!silent) setBusy(true);
    try {
      const cipher = await sealLockedText(current, plain);
      lastWrittenCt.current = cipher.ct;
      updateCardValue(cipher);
      setSession((prev) => (prev ? { ...prev, plain } : prev));
      setError(null);
      return true;
    } catch (err) {
      setError(describeError(err));
      return false;
    } finally {
      if (!silent) setBusy(false);
    }
  }, [updateCardValue]);

  // 自动加密：编辑后停顿即落密文（明文只在内存里停留这一小段时间）。
  useEffect(() => {
    if (mode !== "edit" || !session || draft === session.plain) return;
    const timer = window.setTimeout(() => { void commit(draft, true); }, COMMIT_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [mode, session, draft, commit]);

  // 生命周期入口（关标签 / 锁文档 / 退出）先 await 这里，把最后一段明文补写进密文。
  useEffect(() => registerLockedTextFlush(async () => {
    const current = sessionRef.current;
    if (!current || draftRef.current === current.plain) return false;
    return await commit(draftRef.current, true);
  }), [commit]);

  // 外部改动（撤销 / 重做 / 他端同步覆盖 / 历史恢复）：跟随刷新，避免"显示旧明文、下次编辑又把它写回去"。
  useEffect(() => {
    if (!session || mode !== "edit") return;
    if (!isLockedTextCipher(cardValue)) return;
    const ct = cardValue.ct;
    if (ct === lastWrittenCt.current) return;
    let cancelled = false;
    void openLockedTextWithSession(session, cardValue)
      .then((plain) => {
        if (cancelled) return;
        lastWrittenCt.current = ct;
        setSession((prev) => (prev ? { ...prev, plain } : prev));
        setDraft(plain);
        setError(null);
      })
      .catch(() => {
        if (cancelled) return;
        // 外部换了密码/换了内容而我们解不开：锁回只读态，绝不拿旧明文覆盖新密文。
        setSession(null);
        setDraft("");
        setError("卡片已被外部改动（撤销/同步/历史），请重新解锁");
      });
    return () => { cancelled = true; };
  }, [cardValue, mode, session]);

  const unlock = async () => {
    if (busy) return;
    if (!passwordInput) { setError("请输入密码"); return; }
    setBusy(true);
    try {
      const next = await openLockedTextSession(cardValue, passwordInput);
      lastWrittenCt.current = isLockedTextCipher(cardValue) ? cardValue.ct : null;
      setSession({ ...next });
      setDraft(next.plain);
      setPasswordInput("");
      setError(null);
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  };

  const setupPassword = async () => {
    if (busy) return;
    if (!isValidLockedTextPassword(passwordInput)) { setError(`密码至少 ${LOCKED_TEXT_MIN_PASSWORD_CHARS} 位`); return; }
    if (passwordInput !== passwordConfirm) { setError("两次输入的密码不一致"); return; }
    if (!updateCardValue) { setError("卡片未接入保存通道"); return; }
    setBusy(true);
    try {
      // 立刻落一份"空正文密文"：从这一刻起卡片在磁盘上就是加密态，没有明文窗口。
      const next = await createLockedTextSession(passwordInput);
      const cipher = await sealLockedText(next, "");
      lastWrittenCt.current = cipher.ct;
      updateCardValue(cipher);
      setSession({ ...next, plain: "" });
      setDraft("");
      setPasswordInput("");
      setPasswordConfirm("");
      setError(null);
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  };

  const changePassword = async () => {
    if (busy || !session) return;
    if (!isValidLockedTextPassword(passwordInput)) { setError(`密码至少 ${LOCKED_TEXT_MIN_PASSWORD_CHARS} 位`); return; }
    if (passwordInput !== passwordConfirm) { setError("两次输入的密码不一致"); return; }
    setBusy(true);
    try {
      // 改密码 = 新 salt + 新密钥（旧密码从此解不开），用当前明文重新落一份密文。
      const next = await createLockedTextSession(passwordInput);
      const cipher = await sealLockedText(next, draft);
      lastWrittenCt.current = cipher.ct;
      updateCardValue?.(cipher);
      setSession({ ...next, plain: draft });
      setChanging(false);
      setPasswordInput("");
      setPasswordConfirm("");
      setError(null);
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  };

  const lock = async () => {
    // 落盘失败就不锁：宁可让用户看见错误，也不静默丢编辑。
    if (session && draft !== session.plain && !(await commit(draft))) return;
    setSession(null);
    setDraft("");
    setChanging(false);
    setPasswordInput("");
    setPasswordConfirm("");
    setError(null);
  };

  const hint = phase === "setup"
    ? mode === "view" ? "未设置密码" : "设置密码后正文才会加密保存"
    : phase === "locked" ? "无密码不可见正文"
    : phase === "unlocked" ? "已解锁 · 仅本次会话有效"
    : "格式无法识别，已原样保留";

  const actions = phase === "unlocked" && mode === "edit" ? (
    <div className="lake-locked-text__actions">
      <button type="button" className="lake-locked-text__btn" disabled={busy}
        onClick={() => { setChanging((value) => !value); setPasswordInput(""); setPasswordConfirm(""); setError(null); }}>
        修改密码
      </button>
      <button type="button" className="lake-locked-text__btn" disabled={busy} onClick={() => { void lock(); }}>锁住</button>
    </div>
  ) : null;

  const form = (changing || phase === "setup") && mode === "edit" ? (
    <div className="lake-locked-text__row">
      <input className="lake-locked-text__field" type="password" aria-label="设置密码"
        autoComplete="new-password" placeholder={`密码（至少 ${LOCKED_TEXT_MIN_PASSWORD_CHARS} 位）`}
        value={passwordInput} onChange={(event) => setPasswordInput(event.target.value)} disabled={busy} />
      <input className="lake-locked-text__field" type="password" aria-label="再次输入密码"
        autoComplete="new-password" placeholder="再次输入密码"
        value={passwordConfirm} onChange={(event) => setPasswordConfirm(event.target.value)} disabled={busy}
        onKeyDown={(event) => { if (event.key === "Enter") { void (changing ? changePassword() : setupPassword()); } }} />
      <button type="button" className="lake-locked-text__btn lake-locked-text__btn--primary" disabled={busy}
        onClick={() => { void (changing ? changePassword() : setupPassword()); }}>
        {changing ? "确认" : "设置密码"}
      </button>
      {changing && (
        <button type="button" className="lake-locked-text__btn" disabled={busy} onClick={() => { setChanging(false); setPasswordInput(""); setPasswordConfirm(""); setError(null); }}>取消</button>
      )}
    </div>
  ) : null;

  const unlockRow = phase === "locked" ? (
    <div className="lake-locked-text__row">
      <input className="lake-locked-text__field" type="password" aria-label="请输入密码" autoComplete="current-password"
        placeholder="请输入密码" value={passwordInput} disabled={busy}
        onChange={(event) => setPasswordInput(event.target.value)}
        onKeyDown={(event) => { if (event.key === "Enter") void unlock(); }} />
      <button type="button" className="lake-locked-text__btn lake-locked-text__btn--primary" disabled={busy} onClick={() => { void unlock(); }}>解锁</button>
    </div>
  ) : null;

  const body = phase === "unlocked" ? (
    mode === "edit" ? (
      <textarea className="lake-locked-text__body" aria-label="加密文本正文" value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => { if (session && draft !== session.plain) void commit(draft, true); }}
        spellCheck={false} />
    ) : (
      <div className="lake-locked-text__body lake-locked-text__body--read">{draft}</div>
    )
  ) : phase === "broken" ? (
    <p className="lake-locked-text__note">加密文本数据格式无法识别（可能来自更新版本或其他应用）。已原样保留，不会改写。</p>
  ) : phase === "setup" ? (
    <p className="lake-locked-text__note">未设置密码。设置后正文只以密文保存，所有设备输入同一个密码即可查看。</p>
  ) : null;

  return (
    <div className="lake-locked-text" data-phase={phase} data-mode={mode}>
      <div className="lake-locked-text__head">
        <span className="lake-locked-text__title">加密文本</span>
        <span className="lake-locked-text__hint">{hint}</span>
        {actions}
      </div>
      {form}
      {unlockRow}
      {body}
      {error && <p className="lake-locked-text__error" role="alert">{error}</p>}
      {phase === "setup" && mode === "edit" && (
        <p className="lake-locked-text__warn">密码丢失后无法恢复（没有找回，也不存在服务端托管）：请自行保管。</p>
      )}
      {busy && <span className="lake-locked-text__note">处理中…</span>}
    </div>
  );
}

/** 卡片描述里**与 React 无关**的部分（同名同形对齐全仓 customCard 约定）。 */
export const LOCKED_TEXT_CARD_META = {
  name: LOCKED_TEXT_CARD_NAME,
  cardType: "block" as const,
  slash: {
    icon: LOCKED_TEXT_ICON_ID,
    mainSearch: LOCKED_TEXT_MAIN_SEARCH,
    label: "加密文本",
    description: "设置密码后加密保存，无密码不可见正文",
    keywords: ["加密", "密码", "加密文本", "locked", "lock", "secret", "jm"],
  },
  initValue: {} as Record<string, unknown>,
  /** 复制 / 导出：**永远只给占位**（明文只在组件内存里，不能经这里漏出去）。 */
  writeText: (): string => lockedTextExportText(),
  writeHtml: (): string => lockedTextExportHtml(),
};

/** 内核注册用的完整卡片描述（组件 + meta）。 */
export const lockedTextCardConfig = {
  ...LOCKED_TEXT_CARD_META,
  editorComponent: (props: { cardValue?: unknown; updateCardValue?: (value: LockedTextCipher) => void }) =>
    <LockedTextCard mode="edit" cardValue={props.cardValue} updateCardValue={props.updateCardValue} />,
  viewerComponent: (props: { cardValue?: unknown; updateCardValue?: (value: LockedTextCipher) => void }) =>
    <LockedTextCard mode="view" cardValue={props.cardValue} updateCardValue={props.updateCardValue} />,
};

/** 把本卡追加进内核的 `customCard.cards`（幂等；必须在 prepareCustomCards 之前调用）。 */
export function registerLockedTextCard(config: Record<string, unknown>): void {
  appendCustomCard(config, LOCKED_TEXT_CARD_META.name, lockedTextCardConfig, LockedTextIconSymbol);
}

/** 把斜杠项 `custom-lake-locked-text` 加进「小工具」分组（官方口径；幂等，其它组一字不动）。 */
export function withLockedTextSlashItem(groups: unknown[]): unknown[] {
  return withCustomCardSlashItem(groups, LOCKED_TEXT_SLASH_ITEM, CUSTOM_CARD_SLASH_GROUP_TITLE);
}
