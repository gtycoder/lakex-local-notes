import React from 'react';
import type { DiagramType, ITextToDiagramCardValue } from './types';
export interface TextToDiagramCoreProps {
    value: ITextToDiagramCardValue;
    readOnly: boolean;
    locale: string;
    theme: 'light' | 'dark';
    onChange?: (value: Partial<ITextToDiagramCardValue>) => void;
}
interface TextToDiagramCoreState {
    code: string;
    type: DiagramType;
    showEditor: boolean;
    showPreview: boolean;
    isFullscreen: boolean;
    svgString: string | null;
    error: string | null;
    isRendering: boolean;
}
declare class TextToDiagramCore extends React.Component<TextToDiagramCoreProps, TextToDiagramCoreState> {
    private lineNumbersRef;
    private fullscreenRef;
    private renderToken;
    private mounted;
    private renderTimer;
    constructor(props: TextToDiagramCoreProps);
    componentDidMount(): void;
    componentDidUpdate(prevProps: TextToDiagramCoreProps, prevState: TextToDiagramCoreState): void;
    componentWillUnmount(): void;
    private get isZh();
    private t;
    private handleCodeChange;
    private handleTypeChange;
    private handleTemplateChange;
    private toggleEditor;
    private togglePreview;
    private handleFullscreenChange;
    private toggleFullscreen;
    private handleCodeScroll;
    private scheduleRender;
    private renderDiagram;
    private renderPlantUML;
    private renderGraphviz;
    private renderFlowchart;
    /**
     * flowchart.ts v3.0.1 的 drawOptions 合并不正确，顶层颜色选项会被默认黑白覆盖。
     * 这里对渲染出的 SVG 做后处理，把默认黑/白替换成暗黑模式配色。
     */
    private applyFlowchartDarkTheme;
    private renderToolbar;
    private renderEditor;
    private renderPreview;
    render(): import("react/jsx-runtime").JSX.Element;
}
export default TextToDiagramCore;
