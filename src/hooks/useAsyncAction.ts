import { useCallback, useRef, useState } from "react";
import { getNativeErrorMessage } from "../lib/nativeErrors";

/**
 * 异步动作原语（DT-13，261028）：把「busy + 结果文案 + 失败文案 + finally 复位」收敛成一处。
 *
 * 为什么有它：设置面板此前有 10 组手写的 `const [xBusy, setXBusy] = useState(false)` +
 * `const [xMsg, setXMsg] = useState(null)`，每个动作都要自己写
 * `setBusy(true); setMsg(null); try { … } catch (e) { setMsg(getNativeErrorMessage(e)) } finally { setBusy(false) }`。
 * 抄十遍的结果是口径不一：有的忘了清旧提示、有的 catch 里只改了文案忘了字段、有的把错误写进别人的 msg。
 * 这里只收敛这套状态机，**不动任何 UI 结构与文案**（文案仍由调用方给成功文案 / 失败前缀）。
 *
 * 共享文案通道（channel）：主进程状态栏只有一个位置（`settings-statusbar`），历史上 gc/同步策略/S3 动作
 * 共用一个 `syncMsg` state（谁最后写谁显示）。要保留这条「最后写入者胜」的语义，就把
 * `{ message, setMessage }` 传进来：hook 不另建文案 state，仍读写调用方那条通道。
 */
export interface AsyncMessageChannel {
  message: string | null;
  setMessage(message: string | null): void;
}

export interface UseAsyncActionOptions {
  /** 共享文案通道（可选）；不传则文案存在 hook 内部 state。 */
  channel?: AsyncMessageChannel;
}

export interface AsyncRunOptions<T> {
  /** 成功文案：字符串，或由结果派生（返回 null = 不显示文案）。 */
  success?: string | ((result: T) => string | null);
  /** 失败文案前缀（默认直接展示 native 错误信息，不加前缀）。 */
  errorPrefix?: string;
  /** 开始前是否清空上一条提示（默认 true，等价于原代码的 `setMsg(null)`）。 */
  clearOnStart?: boolean;
}

export interface AsyncAction {
  busy: boolean;
  /** 最近一次提示（共享通道时即通道当前值）。 */
  message: string | null;
  /** 最近一次失败文案（成功或重新开始会清空）。 */
  error: string | null;
  /** 直接写提示（跳过异步动作的早退分支用，如「浏览器端不支持」）；会清掉上一条错误。 */
  setMessage(message: string | null): void;
  /** 只清提示，不动 busy（仍在跑的请求继续跑完）。 */
  reset(): void;
  /** 执行一次异步动作；busy 期间重入直接忽略（返回 undefined）。 */
  run<T>(action: () => Promise<T>, options?: AsyncRunOptions<T>): Promise<T | undefined>;
}

export function useAsyncAction(options: UseAsyncActionOptions = {}): AsyncAction {
  const [busy, setBusy] = useState(false);
  const [localMessage, setLocalMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** 同一实例不重入：迁移前调用方的 `if (xBusy) return` 由这里兜住（state 更新是异步的，必须用 ref）。 */
  const busyRef = useRef(false);
  /** 通道对象每帧都是新字面量（调用方直接传 { message: state, setMessage: setter }）⇒ 永远读最新一版。 */
  const channelRef = useRef<AsyncMessageChannel | undefined>(options.channel);
  channelRef.current = options.channel;

  /**
   * 写一条提示 = 写一个**新结果**：顺带清掉上一次的错误（迁移前各处 setXMsg 也是直接覆盖——同一条状态栏
   * 不能让「旧错误」盖住「新提示」）。
   */
  const setMessage = useCallback((next: string | null) => {
    setError(null);
    const channel = channelRef.current;
    if (channel) channel.setMessage(next);
    else setLocalMessage(next);
  }, []);

  const reset = useCallback(() => { setError(null); setMessage(null); }, [setMessage]);

  const run = useCallback(async <T,>(action: () => Promise<T>, runOptions: AsyncRunOptions<T> = {}): Promise<T | undefined> => {
    if (busyRef.current) return undefined;
    busyRef.current = true;
    setBusy(true);
    if (runOptions.clearOnStart !== false) { setError(null); setMessage(null); }
    try {
      const result = await action();
      if (typeof runOptions.success === "function") {
        const text = runOptions.success(result);
        if (text !== null) setMessage(text);
      } else if (runOptions.success) {
        setMessage(runOptions.success);
      }
      return result;
    } catch (reason) {
      const text = (runOptions.errorPrefix ?? "") + getNativeErrorMessage(reason);
      setError(text);
      // 共享通道：错误也落在同一条状态栏上（历史上 catch 里就是 `setSyncMsg(…)`）。
      if (channelRef.current) channelRef.current.setMessage(text);
      return undefined;
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, [setMessage]);

  const message = options.channel ? options.channel.message : localMessage;
  return { busy, message, error, setMessage, reset, run };
}
