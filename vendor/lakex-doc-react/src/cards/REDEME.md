## 目录结构
- icon.tsx  卡片的图标
- index.ts  卡片配置信息
- XXXEditor.tsx  编辑模式展现的组件
- XXXViewer.tsx  只读模式展现的组件
- types.ts  类型定义

## 卡片图标定义
```tsx
const MindMapIcon = () => {
  return <symbol id="custom-card-icon-mindmap" viewBox="0 0 1024 1024">
            <path d="..." ></path>
        </symbol>
}
```
注意以下一点
1：请在iconfont.com网站上下载图标的svg代码，然后将path内容复制到symbol内。path中的fill属性需要删除。不然在暗黑模式下可能颜色显示会出错
2：symbol中的id和index.ts配置项目中的icon需要一样

## 卡片配置信息
参考文档：https://www.yuque.com/yuque/developer/tik01se6xtqp6h3w
```javascript
export const mindMapCardConfig = {
  name: 'mindmap-card', // 卡片名称
  cardType: 'block' as const, // 'inline' | 'block' 卡片类型。分为行内和区块卡片，行内卡片布局时会和文本处于一行连续布局，区块卡片则独占一行
  editorComponent: MindMapEditor, // 编辑模式下的组件
  viewerComponent: MindMapViewer, // 只读模式下的组件
  initValue: { // 初始数据，需要和types.ts中的类型定义一致
    markdown: defaultMarkdown,
  },
  slash: { // 配置斜杠命令面板以及工具栏的cardselect菜单面板
    /** 图标，需要和icon.tsx中的id一致 */
    icon: 'icon-mindmap',
    /**
     * 斜杆面板的搜索提示，提示用户搜索，例如：/glk
     */
    mainSearch: '/mindmap',
    label: "思维导图",
    description: '用于梳理信息和头脑风暴',
    keywords: ['mindmap', '思维导图', '脑图', 'map'],
  },
  writeText: (value: IMindMapCardValue | null) => {
    return value?.markdown || '思维导图';
  },
  writeHtml: (value: IMindMapCardValue | null) => {
    if (!value?.markdown) return '<div>思维导图</div>';
    const lines = value.markdown.split('\n').map(line => line.trim()).filter(Boolean);
    return `<div style="padding:12px;background:#fafafa;border-radius:8px;">
      <strong>🧠 思维导图</strong>
      <pre style="margin-top:8px;font-size:12px;color:#666;">${lines.join('\n')}</pre>
    </div>`;
  },
};
```

## 编辑组件和预览组件
需要使用Component方式书写组件，不能使用hook的方式


## 在组件中获取语言和主题

```tsx
import Doc from "../../components/lakex/lakex";

// 获取语言
const lan = Doc.FrameworkInfra.Locale.getLanguage() === 'zhCN' ? 'zh-CN' : 'en-US';

// 获取主题
class MindMapViewerComponent extends React.Component<ICardProps<IMindMapCardValue>> {
    render(){
        const { editor } = this.props;
        const theme = editor.theme.currentThemeSchema.colorScheme; // dark or light
    }
}
```
