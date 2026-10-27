import React, { Suspense } from 'react';
import Doc from '../../components/lakex/lakex';
import type { ICardProps } from '../types';
import type { IDrawingBoardCardValue } from './types';

// LOCAL-CHANGE: 与 Editor 同理，画板内核懒加载（vendor 分包出独立 chunk）。
const DrawnixBoardCore = React.lazy(() => import('./DrawnixBoardCore'));

class DrawingBoardViewer extends React.Component<
  ICardProps<IDrawingBoardCardValue>
> {
  render() {
    const { cardValue, editor } = this.props;
    const locale =
      Doc.FrameworkInfra.Locale.getLanguage() === 'zhCN' ? 'zh-CN' : 'en-US';
    const hostTheme = editor?.theme?.currentThemeSchema?.colorScheme === 'dark' ? 'dark' : 'light';
    const theme = hostTheme;

    return (
      <div style={{ width: '100%', height: cardValue?.cardHeight || 560 }}>
        <Suspense fallback={null}>
          <DrawnixBoardCore value={cardValue} locale={locale} theme={theme} readOnly />
        </Suspense>
      </div>
    );
  }
}

export default DrawingBoardViewer;
