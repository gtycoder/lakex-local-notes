import { useEffect, useState } from "react";
import { TriangleAlert } from "lucide-react";
import { native, type SafeModeStateSnapshot } from "../../lib/native";
import { getNativeErrorMessage } from "../../lib/nativeErrors";

/**
 * 安全模式提示条（Batch3-B）：崩溃反复出现时，主进程以最小风险集合启动（不自动同步 / 不恢复标签页 /
 * 不预热内核），但主界面可看可编辑。这条常驻在顶部，给两个出口：
 * - **复制诊断**：崩溃现场 + 环境 + 日志路径写进系统剪贴板（直接贴 issue）；
 * - **退出安全模式（下次正常启动）**：写 active:false + 清崩溃标记 ⇒ 下次启动恢复正常行为。
 *
 * 判据在主进程（electron/safeMode.ts），这里只做接线与呈现；非安全模式时渲染 null。
 */
export function SafeModeBanner() {
  const [state, setState] = useState<SafeModeStateSnapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void native.getSafeModeState()
      .then((snapshot) => { if (alive) setState(snapshot); })
      .catch(() => { /* 桥不可用（浏览器端/老主进程）⇒ 不显示 */ });
    return () => { alive = false; };
  }, []);

  if (!state?.active) return null;

  const detail = [
    state.reason,
    typeof state.occurrences === "number" && state.occurrences > 0 ? "累计 " + state.occurrences + " 次异常" : "",
    state.crashTime ? "崩溃于 " + state.crashTime : "",
  ].filter(Boolean).join(" · ");

  const copyDiagnostics = async () => {
    setBusy(true);
    setNote(null);
    try {
      const result = await native.copySafeModeDiagnostics();
      setNote(result.ok ? "诊断已复制到剪贴板" : "复制失败，请到数据目录取日志");
    } catch (error) {
      setNote(getNativeErrorMessage(error));
    } finally {
      setBusy(false);
    }
  };
  const exitSafeMode = async () => {
    setBusy(true);
    setNote(null);
    try {
      const result = await native.exitSafeMode();
      if (result.ok) {
        // 只在本进程内收起提示条；真正的「下次启动正常」由主进程写入的状态决定。
        setState({ ...state, active: false });
      } else {
        // P2-C：写盘/回读失败 = 未生效。保留提示条并明说（不要假装已退出）。
        setNote("退出未生效：" + result.reason + "。请重启应用后再试（当前仍是安全模式）。");
      }
    } catch (error) {
      setNote(getNativeErrorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="safe-mode-banner">
      <div className="tab-gone-banner" role="status" aria-live="polite" data-safe-mode-banner>
        <TriangleAlert size={14} aria-hidden="true" />
        <span>
          安全模式：已关闭自动同步与标签恢复，用于排查崩溃{detail ? "（" + detail + "）" : ""}
          {note ? " — " + note : ""}
        </span>
        <button type="button" disabled={busy} onClick={() => void copyDiagnostics()}>复制诊断</button>
        <button type="button" disabled={busy} onClick={() => void exitSafeMode()}>退出安全模式（下次正常启动）</button>
      </div>
    </div>
  );
}
