/**
 * 移动端错误边界（261105）：**局部隔离**，绝不连累其它视图。
 *
 * 桌面同款思路见 src/features/editor/EditorErrorBoundary.tsx（按 noteId 隔离编辑器）。
 * 移动端此前 0 个 ErrorBoundary ⇒ 任意组件渲染异常会让 React 卸载整棵树（白屏），
 * 用户只能强杀重开；这里给「这一段加载失败」+ 重试 + 复制诊断。
 *
 * 用法：包住「大面板/编辑区」各自一层（根层再兜一层）。切换内容要重置状态时给 `key`。
 * 只用既有 kit 类（.mb-empty / .mb-btn / .mb-form__desc），不新增 CSS。
 */
import { Component, Fragment, type ErrorInfo, type ReactNode } from "react";
import { getNativeErrorMessage } from "../../lib/nativeErrors";
import { formatCrashEntries, readCrashLog, reportCrash } from "../lib/crashLog";
import { showToast } from "./toastBus";

export interface MobileErrorBoundaryProps {
  /** 隔离域（写进崩溃记录，便于排障定位）：如 app / workspace / settings / search / ai。 */
  scope: string;
  /** 标题；缺省按 scope 给一句人话。 */
  title?: string;
  children: ReactNode;
}

interface State {
  failed: boolean;
  /** 重试 = 换 generation 强制重建子树（与桌面 EditorErrorBoundary 同款）。 */
  generation: number;
  message: string;
}

export class MobileErrorBoundary extends Component<MobileErrorBoundaryProps, State> {
  state: State = { failed: false, generation: 0, message: "" };

  static getDerivedStateFromError(error: unknown): Partial<State> {
    return { failed: true, message: getNativeErrorMessage(error) };
  }

  componentDidCatch(error: unknown, info: ErrorInfo): void {
    reportCrash({
      scope: "boundary:" + this.props.scope,
      message: error,
      stack: (error instanceof Error ? error.stack ?? "" : "") + "\n组件栈:" + (info.componentStack ?? ""),
    });
  }

  private retry = (): void => {
    this.setState((state) => ({ failed: false, generation: state.generation + 1, message: "" }));
  };

  /** 复制诊断：隔离域 + 本段错误 + 最近几条全局崩溃记录 + 环境。 */
  private copyDiagnostics = async (): Promise<void> => {
    const lines = [
      "时间：" + new Date().toISOString(),
      "隔离域：" + this.props.scope,
      "错误：" + (this.state.message || "未知"),
      "环境：" + (typeof navigator === "undefined" ? "unknown" : navigator.userAgent),
      "",
      "最近崩溃记录：",
      ...formatCrashEntries(readCrashLog(5)).slice(-5),
    ];
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      showToast("诊断信息已复制");
    } catch {
      showToast("复制失败，请记录屏幕上的错误信息", { type: "error" });
    }
  };

  private titleOf(): string {
    if (this.props.title) return this.props.title;
    if (this.props.scope === "app") return "页面遇到问题";
    if (this.props.scope === "workspace") return "这个工作区加载失败";
    return "这一段加载失败";
  }

  render(): ReactNode {
    if (this.state.failed) {
      return (
        <div className="mb-empty" role="alert">
          <div>{this.titleOf()}</div>
          <p className="mb-form__desc">已隔离：其它内容不受影响，本机数据未改动。</p>
          {this.state.message && <p className="mb-form__desc">{this.state.message}</p>}
          <div className="mb-set-block__actions">
            <button type="button" className="mb-btn mb-btn--primary" onClick={this.retry}>重试</button>
            <button type="button" className="mb-btn mb-btn--secondary" onClick={() => void this.copyDiagnostics()}>复制诊断</button>
          </div>
        </div>
      );
    }
    return <Fragment key={this.state.generation}>{this.props.children}</Fragment>;
  }
}
