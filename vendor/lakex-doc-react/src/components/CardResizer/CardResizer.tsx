// src/editor/components/CardResizer/CardResizer.tsx
//
// 自定义卡片用的“底部高度拖动条”包裹组件（复刻 Lakex 框架 framework/uilib/src/card-resizer/card-resizer.ts 的交互）。
// 本组件自身就是一个 position: relative 的容器，会包裹住 children 并控制其高度，
// 同时在底部渲染一条可拖动的横条。
//
// 用法：
//   <CardResizer
//       height={height}
//       min={30}
//       onResize={(h) => this.props.updateCardValue({ ...this.props.cardValue, height: h })}
//   >
//       <MindMap />
//   </CardResizer>
//
// 交互说明：
//   - 点击卡片（卡片内任意位置）即进入“选中”态：显示卡片边框 + 底部拖动条常显；
//   - 点击卡片外部区域则取消选中，边框与拖动条隐藏（鼠标悬停到底部命中区时拖动条仍会临时显示）；
//   - 选中态下按 Delete / Backspace 键（焦点不在输入框时）触发 onDelete 回调，用于删除卡片；
//   - 按住底部横条上下拖动即可改变高度，松开后停止；
//   - 高度会被 clamp 到 [min, max] 区间内，并通过 onResize 回传。

import React from 'react';
import './CardResizer.css';

export interface CardResizerProps {
  /** 当前高度（px），同时作为包裹容器的高度 */
  height: number;
  /** 高度变化回调，参数为已经 clamp 到 [min, max] 的新高度 */
  onResize: (height: number) => void;
  /** 最小高度，默认 30 */
  min?: number;
  /** 最大高度，默认 Number.MAX_SAFE_INTEGER（不限） */
  max?: number;
  /** 附加到根包裹节点的自定义类名 */
  className?: string;
  /** 被包裹的内部组件（如 MindMap） */
  children?: React.ReactNode;
  /** 选中态下按 Delete / Backspace（焦点不在输入框时）触发，参数为触发按键的 DOM 事件目标，便于上层定位并删除卡片 */
  onDelete?: (target: EventTarget | null) => void;
  /**
   * Allows interactive card content to keep Delete / Backspace for itself.
   * Return false to prevent the resizer from deleting the surrounding card.
   */
  shouldHandleDeleteShortcut?: (event: KeyboardEvent) => boolean;
  /**
   * Interactive areas such as canvases do not necessarily take DOM focus.
   * Remember the last pointer target in this selector and leave Delete /
   * Backspace to that area until the user clicks another part of the card.
   */
  deleteShortcutExclusionSelector?: string;
}

export interface CardResizerState {
  /** 是否正在拖动高度 */
  dragging: boolean;
  /** 是否处于选中态（点击卡片后为真，显示边框 + 常显拖动条） */
  selected: boolean;
}

export class CardResizer extends React.Component<CardResizerProps, CardResizerState> {
  static defaultProps = {
    min: 30,
    max: Number.MAX_SAFE_INTEGER,
  };

  private startY = 0;
  private startHeight = 0;
  private interactiveDeleteScopeActive = false;
  private rootRef = React.createRef<HTMLDivElement>();

  constructor(props: CardResizerProps) {
    super(props);
    this.state = { dragging: false, selected: false };
    this.handleClick = this.handleClick.bind(this);
    this.handleDocMouseDown = this.handleDocMouseDown.bind(this);
    this.handleDocKeyDown = this.handleDocKeyDown.bind(this);
    this.handleMouseDown = this.handleMouseDown.bind(this);
    this.handleMouseMove = this.handleMouseMove.bind(this);
    this.handleMouseUp = this.handleMouseUp.bind(this);
  }

  componentDidMount(): void {
    // 监听 document 上的 mousedown，用于“点击卡片外部取消选中”
    document.addEventListener('mousedown', this.handleDocMouseDown);
    // 监听 document 上的 keydown，用于选中态下删除卡片
    if (typeof this.props.onDelete === 'function') document.addEventListener('keydown', this.handleDocKeyDown);
  }

  componentWillUnmount(): void {
    document.removeEventListener('mousedown', this.handleDocMouseDown);
    if (typeof this.props.onDelete === 'function') document.removeEventListener('keydown', this.handleDocKeyDown);
    document.removeEventListener('mousemove', this.handleMouseMove);
    document.removeEventListener('mouseup', this.handleMouseUp);
    document.body.style.userSelect = '';
  }

  // 选中态下按 Delete / Backspace（且焦点不在输入框）时，触发 onDelete 回调
  private handleDocKeyDown(e: KeyboardEvent): void {
    if (!this.state.selected) return;
    if (e.key !== 'Delete' && e.key !== 'Backspace') return;
    const target = e.target as HTMLElement | null;
    if (
      target &&
      (target.isContentEditable ||
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA')
    ) {
      return;
    }
    if (this.interactiveDeleteScopeActive) return;
    if (this.props.shouldHandleDeleteShortcut?.(e) === false) return;
    if (typeof this.props.onDelete === 'function') {
      e.preventDefault();
      this.props.onDelete(e.target);
    }
  }

  // 点击卡片内任意位置 -> 进入选中态（显示边框 + 常显拖动条）
  private handleClick(): void {
    this.setState({ selected: true });
  }

  private handlePointerDownCapture = (event: React.PointerEvent<HTMLDivElement>): void => {
    const selector = this.props.deleteShortcutExclusionSelector;
    if (!selector) return;
    const target = event.target as Element | null;
    this.interactiveDeleteScopeActive = !!target?.closest(selector);
  };

  // 点击发生在卡片根节点之外 -> 取消选中
  private handleDocMouseDown(e: MouseEvent): void {
    const root = this.rootRef.current;
    if (root && !root.contains(e.target as Node)) {
      this.interactiveDeleteScopeActive = false;
      this.setState({ selected: false });
    }
  }

  private handleMouseDown(e: React.MouseEvent): void {
    // 防止拖动时选中卡片内文本
    e.preventDefault();
    this.startY = e.clientY;
    this.startHeight = this.props.height;
    // 开始拖动也强制进入选中态
    this.setState({ dragging: true, selected: true });
    document.addEventListener('mousemove', this.handleMouseMove);
    document.addEventListener('mouseup', this.handleMouseUp);
    document.body.style.userSelect = 'none';
  }

  private handleMouseMove(e: MouseEvent): void {
    const delta = e.clientY - this.startY;
    let next = this.startHeight + delta;
    const { min = 30, max = Number.MAX_SAFE_INTEGER } = this.props;
    next = Math.max(min, Math.min(next, max));
    this.props.onResize(next);
  }

  private handleMouseUp(): void {
    this.setState({ dragging: false });
    document.removeEventListener('mousemove', this.handleMouseMove);
    document.removeEventListener('mouseup', this.handleMouseUp);
    document.body.style.userSelect = '';
  }

  render(): React.ReactNode {
    const { className, children, height } = this.props;
    const { selected } = this.state;
    const rootClass = ['ne-card-resizer-root', selected ? 'selected' : '', className]
      .filter(Boolean)
      .join(' ');
    return (
      <div
        ref={this.rootRef}
        className={rootClass}
        style={{ position: 'relative', height, width: '100%' }}
        onPointerDownCapture={this.handlePointerDownCapture}
        onClick={this.handleClick}
      >
        <div className="ne-card-resizer-content" style={{ height: '100%', width: '100%' }}>
          {children}
        </div>
        <div
          className="ne-card-resizer"
          onMouseDown={this.handleMouseDown}
          role="separator"
          aria-orientation="horizontal"
        >
          <div className="ne-card-resizer-trigger" />
        </div>
      </div>
    );
  }
}

export default CardResizer;
