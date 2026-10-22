import { Component, Fragment, type ErrorInfo, type ReactNode } from "react";

/**
 * 编辑器错误边界（260919 表格崩溃隔离；260930 审计 F14 补真实重试）。
 * 第三方内核渲染/状态异常不应连累整窗：崩了只显示占位。
 * key 由调用方按 noteId-reloadKey 给，切文档时边界状态自然重置。
 * keep-alive 下切换标签只改 visible、不重置本边界，所以文案必须是可执行的重试——不是「切标签即可恢复」。
 */
export class EditorErrorBoundary extends Component<{ noteId: string; children: ReactNode }, { failed: boolean; generation: number }> {
  state = { failed: false, generation: 0 };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error("[editor] crashed", this.props.noteId, error, info.componentStack);
  }
  /** 真实重试：换 mount generation 强制重建子树。 */
  private retry = () => {
    this.setState((state) => ({ failed: false, generation: state.generation + 1 }));
  };
  render() {
    if (this.state.failed) {
      return (
        <div className="empty-workspace-hint">
          该类型编辑器渲染出错（已隔离，未影响其他文档）。
          <button type="button" className="ln-btn ln-btn--secondary" onClick={this.retry}>重试</button>
          <span>若仍无法恢复，请关闭该标签后重新打开。</span>
        </div>
      );
    }
    return <Fragment key={this.state.generation}>{this.props.children}</Fragment>;
  }
}
