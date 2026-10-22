import React from 'react';
import type { ThemeMode } from '@xiangfa/mindmap';
import type { ICardProps } from '../types';
import type { IMindMapCardValue } from './types';
import '@xiangfa/mindmap/style.css';
interface MindMapEditorState {
    markdown: string;
    height: number;
    theme: ThemeMode;
}
declare class MindMapEditor extends React.Component<ICardProps<IMindMapCardValue>, MindMapEditorState> {
    private mindMapRef;
    constructor(props: ICardProps<IMindMapCardValue>);
    private saveData;
    componentWillUnmount(): void;
    render(): import("react/jsx-runtime").JSX.Element;
}
export default MindMapEditor;
