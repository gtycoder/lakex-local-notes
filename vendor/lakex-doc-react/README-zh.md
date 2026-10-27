# @dlient/lakex-doc-react

**lakex（语雀）文档编辑器**的 React 封装，打包为独立的、可发布的 npm 组件。

它包含：

- `LakexEditor` — 通过框架的 `createOpenEditor` API 挂载 lakex 开放编辑器的 React 组件（无需全局 `<script>` / `window.React` 技巧）。
- `Doc` — lakex-doc 框架根对象（`@alipay/lakex-doc` 的 ESM 构建）。
- `CardResizer` — 可复用的卡片包装器，支持**点击选中**（显示边框 + 底部拖拽手柄）、**拖拽调整大小**，以及选中后**按 `Delete` 删除**。
- `mindMapCardConfig` / `MindMapEditor` / `MindMapViewer` — 基于 [`@xiangfa/mindmap`](https://www.npmjs.com/package/@xiangfa/mindmap) 构建的自定义卡片（思维导图）。
- `textToDiagramCard` — 支持 Mermaid / Flowchart / PlantUML / Graphviz 的自定义卡片。
- `slashConfig` — 默认斜杠菜单配置（包含思维导图和文本绘图条目）。

> 📖 [English Documentation](README.md)

## 要求

- **React 18**（`react` / `react-dom` `^18`）。lakex 框架基于 React 18 API（如 `ReactDOM.render`、`findDOMNode`）构建，这些 API 在 React 19 中已被移除，因此**不支持** React 19。

## 安装

```bash
npm install @dlient/lakex-doc-react
# peer deps:
npm install react@^18 react-dom@^18
```

## 快速开始

```tsx
import { LakexEditor } from '@dlient/lakex-doc-react';
import '@dlient/lakex-doc-react/style.css'; // required: editor + framework styles

export default function App() {
  return (
    <div style={{ height: '100vh' }}>
      <LakexEditor
        language="zh-cn"
        dark={false}
        onContentChange={(contents) => console.log(contents)}
      />
    </div>
  );
}
```

> **不要忘记导入 CSS。** 没有 `import '@dlient/lakex-doc-react/style.css'` 的话，编辑器工具栏和卡片将渲染为未样式化的 HTML。

---

## LakexEditor Props

`<LakexEditor>` 组件接受以下 props：

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `id` | `string` | — | 文档 ID。当此值变化时，编辑器会销毁并重新创建，用于切换文档。 |
| `dark` | `boolean` | `false` | 是否启用暗黑模式。当此值变化时，编辑器会重新渲染以应用新主题。 |
| `language` | `"zh-cn" \| "en-us"` | `"zh-cn"` | 显示语言（界面文案、占位提示等）。当此值变化时编辑器会重新渲染。 |
| `content` | `LakexEditorContent` | — | 初始文档内容。类型为 `{ type: LakexEditorContentType; text: string }`。 |
| `onContentChange` | `(value: LakexEditorContent[]) => void` | — | 内容变化回调。每次编辑都会触发，回传 5 种格式的内容数组。 |
| `config` | `Partial<LakexEditorConfig>` | — | 透传给 `createOpenEditor` 的底层配置，会与内置默认配置深度合并。 |
| `disableMergeConfig` | `boolean` | `false` | 禁用配置合并。启用后内置默认配置不生效，仅使用 `config` prop 传入的配置。 |
| `blockMenu` | `boolean` | `true` | 是否显示语雀风格的行首悬浮按钮；支持拖拽排序和点击打开块菜单。 |
| `onBlockAction` | `(action, data) => void` | — | 块菜单动作完成后的回调；可通过 `aiOutline` 动作接入业务侧 AI 写作服务。 |

### `LakexEditorContent`

```ts
interface LakexEditorContent {
  type: "text/lake" | "text/html" | "text/plain" | "text/markdown" | "json";
  text: string;
}
```

`onContentChange` 回调会返回上述格式的数组，包含所有 5 种格式的快照。

### 基本用法示例

```tsx
// 受控用法：加载文档内容
<LakexEditor
  id="doc-001"
  content={{ type: 'text/lake', text: '<p>Hello <strong>world</strong></p>' }}
  dark={isDark}
  language="zh-cn"
  onContentChange={(contents) => {
    const html = contents.find(c => c.type === 'text/html');
    console.log('HTML:', html?.text);
  }}
/>

// 切换文档：改变 id 即可重新加载
<LakexEditor id={currentDocId} />
```

### 行首按钮和块菜单

鼠标悬浮段落、标题、列表项、引用、代码块、媒体、表格或块卡片时，行首会显示六点按钮。拖拽按钮可调整块顺序，点击按钮可执行转换、删除、复制、剪切、缩进、复制链接以及在上下方新增等操作。

```tsx
<LakexEditor
  blockMenu
  onBlockAction={(action, { blockElement, payload }) => {
    if (action === 'aiOutline') {
      openAiWriter({ blockId: blockElement.id, method: payload });
    }
  }}
/>
```

---

## LakexEditorConfig

通过 `<LakexEditor config={...}>` 传入，与内置默认配置深度合并。
配置参考：https://www.yuque.com/yuque/developer/hrz4raqhg9bsv9g9

### 通用配置

| 字段 | 类型 | 说明 |
|------|------|------|
| `disabledPlugins` | `string[]` | 禁用的插件列表。 |
| `header` | `ComponentType<any>` | 文档上方渲染的 React 组件。 |
| `uiSwitch` | `{ default?: "simple" \| "default" \| "small" }` | 编辑器类型：simple 精简 / default 标准 / small 小型。 |
| `currentURL` | `string` | 输出 HTML 时部分卡片用到的当前页面链接。 |
| `envAdapter` | `EnvAdapter \| null` | 适配器，处理不同设备/业务场景的交互（打开链接、预览图片等）。 |
| `virtualRendering` | `boolean` | 是否开启虚拟渲染（1.6.0+）。 |
| `scrollNode` | `HTMLElement \| (() => HTMLElement)` | 滚动容器，阅读器大纲需要配置真实滚动容器。 |
| `boundaryTopOffset` | `number` | 阅读器大纲滚动偏移量。 |
| `placeholder` | `string \| LakexEditorPlaceholder` | 占位文案。`{ tip: string; emptyParagraphTip?: string }`。 |

### 插件配置

| 字段 | 类型 | 说明 |
|------|------|------|
| `image` | `ImageConfig` | 图片配置：上传地址 `uploadFileURL`、抓取转存 `crawlURL`、自定义上传 `createUploadPromise`、可接受后缀 `accept` 等。 |
| `input` | `InputConfig` | 输入配置：中英文自动空格 `autoSpacing`、符号自动补全 `autoClosing`。 |
| `layout` | `LayoutConfig` | 布局模式：`"fixed"` 标宽 750px / `"adapt"` 自适应。 |
| `heading` | `HeadingConfig` | 标题配置：锚点 `anchor`、折叠 `folding`、hash 链接 `generateHashLink`。 |
| `video` | `VideoConfig` | 视频配置：上传 `uploadFileURL`、自定义上传 `createUploadPromise`、视频转存 `crawlVideo`。 |
| `file` | `FileConfig` | 附件配置：下载链接 `getFileDownloadURL`、预览 `getPreviewUrl`、上传 `uploadFileURL`。 |
| `mention` | `MentionConfig` | 提及配置：搜索接口 `mentionURL` / `onMentionSearch`、头像 origin、默认列表 `defaultList`。 |
| `dateCard` | `DateCardConfig` | 日期卡片配置：是否支持 mention 选择日期 `supportMention`。 |
| `calendar` | `CalendarConfig` | 日历配置：每周起始日 `startWeekDay`、阅读链接 `getDocReadURL`。 |
| `math` | `MathConfig` | 公式配置：KaTeX 资源地址 `KaTexURL`、不可见时隐藏 `hideOnInvisible`。 |
| `slash` | `SlashConfig` | 斜杠命令菜单配置（详见下方自定义卡片章节）。 |
| `toc` | `TocEditingConfig` | 编辑模式大纲配置：是否开启 `enable`、默认展开 `normalView`、修改 hash `allowModifyHash`。 |
| `codeblock` | `CodeblockConfig` | 代码块配置：是否支持自定义样式 `supportCustomStyle`。 |
| `audio` | `AudioConfig` | 音频配置：上传 `createUploadPromise`、播放地址查询 `queryAudioUrl`、自定义播放组件 `playerComponent`。 |
| `link` | `LinkConfig` | 链接配置：阅读模式 hover 工具栏 `vMiniToolbar`。 |
| `htmlDataSource` | `HtmlDataSourceConfig` | HTML 数据源配置：是否读取空行 `readEmptyLine`。 |
| `fallbackcard` | `FallbackcardConfig` | 异常卡片配置：主提示 `mainTipHTML`、次提示 `subTipHTML`。 |
| `kernelAssistant` | `KernelAssistantConfig` | 内核辅助配置：emoji 独立字体 `supportEmoji`。 |
| `defaultFontsize` | `DefaultFontsizeConfig` | 默认字号配置：`defaultFontsize`（支持 12/13/14/15/16/19/22/24）。 |
| `toolbar` | `ToolbarConfig` | 工具栏配置：`agentConfig.default`（默认工具栏）、`agentConfig.table`（表格选区工具栏）。 |
| `customCard` | `CustomCardsConfig` | 自定义卡片配置（详见下方章节）。 |
| `drawingBoardAI` | `DrawingBoardAIConfig` | AI 画板助手服务。通过 `generate` 回调连接业务侧模型接口。 |

### config 使用示例

```tsx
import { LakexEditor } from '@dlient/lakex-doc-react';
import '@dlient/lakex-doc-react/style.css';

<LakexEditor
  dark={false}
  language="zh-cn"
  config={{
    image: {
      uploadFileURL: 'https://your-api.com/upload',
    },
    mention: {
      onMentionSearch: async (input) => {
        const res = await fetch(`/api/search?q=${input}`);
        return res.json();
      },
    },
    toolbar: {
      agentConfig: {
        default: {
          items: ['undo', 'redo', '|', 'bold', 'italic', 'underline'],
        },
      },
    },
  }}
/>
```

### AI 画板助手

画板工具栏中的 AI 入口不绑定模型厂商，也不会在浏览器中保存 API Key。业务层通过 `drawingBoardAI.generate` 把 `systemPrompt` 作为系统消息、`contextPrompt` 作为用户消息发送给自己的服务端。`contextPrompt` 已组合用户需求历史、当前画布唯一一份最新 JSON 和本轮需求；旧的 AI JSON 不会重复进入上下文。画板会校验返回的 JSON，再转换成 Drawnix/Plait 原生元素。

```tsx
<LakexEditor
  config={{
    drawingBoardAI: {
      generate: async ({
        description,
        systemPrompt,
        contextPrompt,
        locale,
        signal,
      }) => {
        const response = await fetch('/api/ai/drawing-board', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            description,
            systemPrompt,
            contextPrompt,
            locale,
          }),
          signal,
        });
        if (!response.ok) throw new Error('AI request failed');
        const result = await response.json();
        // 可以返回 JSON 对象，也可以返回仅包含 JSON 的字符串
        return result.json;
      },
    },
  }}
/>
```

需求历史按画板实例隔离，只在一次生成成功后写入，最多保留最近 20 条且限制总字符数。每轮请求都会重新读取当前画布，因此用户手工绘制、移动、改字后的内容也会进入下一轮上下文。清空画布后再次打开助手会自动开始新会话，也可以点击“新对话”主动清空需求历史。

画板格式规范见 [`docs/lakex-drawing-board-json-format-skills.md`](docs/lakex-drawing-board-json-format-skills.md)。建议服务端启用模型的 JSON/Structured Output 模式，并保留超时、鉴权和用量限制。

#### 本地示例接入 EdgeFN / GLM

示例项目内置了仅在 Vite 开发服务器运行的代理。复制环境变量模板：

```bash
cp examples/.env.example examples/.env.local
```

然后在 `examples/.env.local` 中填写新生成的密钥：

```dotenv
LAKEX_AI_API_KEY=replace-with-your-new-api-key
LAKEX_AI_ENDPOINT=https://api.edgefn.net/v1/chat/completions
LAKEX_AI_MODEL=GLM-5.2
LAKEX_AI_STREAM=true
LAKEX_AI_REQUEST_TIMEOUT_MS=360000
LAKEX_AI_IDLE_TIMEOUT_MS=120000
LAKEX_AI_MAX_RETRIES=1
LAKEX_AI_MAX_TOKENS=8192
VITE_LAKEX_AI_USE_MOCK=false
```

运行 `npm run examples` 后，浏览器只访问同源的 `/api/ai/drawing-board`。密钥由本地 Vite Node 进程读取，不会出现在浏览器请求、前端 bundle 或 Git 提交中。代理默认使用服务商的 SSE 流式响应消除长 JSON 的首字节等待，但会在服务端收集完整内容并仍以普通 JSON 返回给画板；429、5xx 和网络错误默认退避重试一次。总请求上限默认为 6 分钟，连续 2 分钟没有收到任何数据才判定超时。关闭生成弹窗时，请求会通过 `AbortSignal` 一并取消。部署生产环境时，应把相同代理逻辑迁移到正式后端或 Serverless Function。

---

## 自定义卡片（Custom Card）

自定义卡片是 lakex 编辑器扩展能力的核心机制。你可以在文档中插入任意 React 组件作为块级或行内卡片，并通过斜杠命令（`/`）菜单唤起。

### 卡片架构概览

```
src/cards/MyCard/
├── index.ts              ← 卡片配置导出（CustomCard）
├── types.ts              ← 卡片数据类型定义
├── MyCardEditor.tsx      ← 编辑模式组件
├── MyCardViewer.tsx      ← 阅读模式组件
└── MyCard.css            ← 样式（可选）
```

### 核心类型定义

#### `CustomCard` — 卡片注册对象

```ts
interface CustomCard<TCardValue = any> {
  /** 自定义 SVG 图标组件（可选，用于斜杠菜单图标） */
  icon?: React.ElementType | React.ComponentType | React.FC;
  /** 卡片配置 */
  config: CustomCardConfig<TCardValue>;
}
```

以下是一个自定义图标的方法，其中 symbol的id 要和CustomCardConfig.slash.icon 一致。
``` tsx
/** 自定义图标 */
const customCardIcon = () => (
  <symbol id="icon-editor-h4" viewBox="0 0 256 256">
		<path d="M119.4 221.64c3.467-.173 6.023-1.213 7.67-3.12 1.647-1.907 2.47-4.333 2.47-7.28V48.48c0-2.947-.867-5.373-2.6-7.28s-4.333-2.86-7.8-2.86c-3.813 0-6.457.91-7.93 2.73-1.473 1.82-2.21 4.29-2.21 7.41v70.2H43.84v-70.2c0-2.947-.823-5.373-2.47-7.28-1.647-1.907-4.203-2.86-7.67-2.86-3.467 0-6.067.953-7.8 2.86-1.733 1.907-2.6 4.333-2.6 7.28v162.76c0 2.947.867 5.417 2.6 7.41 1.733 1.993 4.333 2.99 7.8 2.99 3.467-.173 6.023-1.213 7.67-3.12 1.647-1.907 2.47-4.333 2.47-7.28v-74.88H109v74.88c0 2.947.867 5.417 2.6 7.41 1.733 1.993 4.333 2.99 7.8 2.99ZM213.6 77.1c3.151 0 5.54 1.132 6.97 3.4 1.325 2.107 1.93 5.77 1.93 11.1v80.7h7.7c4.568 0 7.007 3.025 7.097 8.388l.003.312c0 5.558-2.444 8.7-7.1 8.7h-7.7V213c0 2.956-.607 5.078-1.985 6.32l-.17.144c-1.404 1.142-3.762 1.636-7.145 1.636-3.279 0-5.616-.584-7.026-1.906-1.419-1.33-2.074-3.418-2.074-6.194v-23.3h-54.5c-5.356 0-8.772-2.284-9.822-6.803l-.063-.285c-.298-2.084-.08-4.48.634-7.194.713-2.71 2.311-5.975 4.79-9.832l43.387-67.178c3.8-6.106 7.412-10.742 10.858-13.912 3.384-3.113 7.779-5.492 13.168-7.148l.833-.248h.215Zm-9.5 27.294L161.317 172.3H204.1v-67.906Z"
		fill="currentColor" fillRule="evenodd">
		</path>
	</symbol>
)
```

#### `CustomCardConfig` — 卡片配置

```ts
interface CustomCardConfig<TCardValue = any> {
  /** 卡片名称，需唯一。读取数据时根据该字段匹配渲染组件 */
  name: string;
  /** 卡片类型：'inline' 行内卡片（与文字同行）| 'block' 区块卡片（独占一行） */
  cardType: 'inline' | 'block';
  /** 斜杠命令菜单配置 */
  slash: {
    icon: string;                    // 图标 ID（对应 SVG symbol 的 id）
    mainSearch?: string;             // 搜索提示，如 '/mindmap'
    keywords?: string | string[];    // 搜索关键字
    label: string | (() => { zhCN: string; enUS: string });         // 菜单显示名称
    description?: string | (() => { zhCN: string; enUS: string });  // 菜单描述
  };
  /** 卡片初始数据，不需要则传 null */
  initValue: Record<string, any> | null;
  /** 编辑模式组件（支持函数组件或类组件） */
  editorComponent: React.ComponentType<ICustomEditorCardProps<TCardValue>>;
  /** 阅读模式组件（支持函数组件或类组件） */
  viewerComponent: React.ComponentType<ICustomEditorCardProps<TCardValue>>;
  /** 自定义纯文本导出（复制/导出时使用） */
  writeText: (value: TCardValue | null) => string;
  /** 自定义 HTML 导出（复制/导出时使用） */
  writeHtml: (value: TCardValue | null) => string;
}
```

#### `ICustomEditorCardProps` — 组件接收的 Props

```ts
interface ICustomEditorCardProps<TCardValue = any> {
  /** lakex 编辑器实例（可调用 execCommand、读取主题等） */
  editor: any;
  /** 当前卡片数据 */
  cardValue: TCardValue;
  /** 更新卡片数据，触发组件重新渲染 */
  updateCardValue: (value: TCardValue) => void;
  /** 卡片类型：'inline' | 'block' */
  cardType: 'inline' | 'block';
}
```

### 开发步骤

#### 1. 定义卡片数据类型

```ts
// src/cards/MyCard/types.ts
export interface IMyCardValue {
  title: string;
  content: string;
  cardHeight?: number;  // 如需支持高度拖拽，加上这个字段
}
```

#### 2. 编写编辑模式组件

```tsx
// src/cards/MyCard/MyCardEditor.tsx
import React from 'react';
import { ICustomEditorCardProps } from '../../components/lakex/types';
import { IMyCardValue } from './types';
import CardResizer from '../../components/CardResizer';

class MyCardEditor extends React.Component<ICustomEditorCardProps<IMyCardValue>> {
  render() {
    const { cardValue, updateCardValue } = this.props;
    return (
      <CardResizer
        height={cardValue.cardHeight || 200}
        min={100}
        onResize={(h) => updateCardValue({ ...cardValue, cardHeight: h })}
      >
        <div style={{ padding: 16 }}>
          <input
            value={cardValue.title}
            onChange={(e) => updateCardValue({ ...cardValue, title: e.target.value })}
          />
          <textarea
            value={cardValue.content}
            onChange={(e) => updateCardValue({ ...cardValue, content: e.target.value })}
          />
        </div>
      </CardResizer>
    );
  }
}

export default MyCardEditor;
```

> **关于 `CardResizer`**：这是一个可选的高度拖拽包裹组件。它提供点击选中（显示边框）、底部拖动条调整高度、选中后按 Delete 删除卡片等交互。如果你的卡片不需要高度调整，可以不用它。

#### 3. 编写阅读模式组件

```tsx
// src/cards/MyCard/MyCardViewer.tsx
import React from 'react';
import { ICustomEditorCardProps } from '../../components/lakex/types';
import { IMyCardValue } from './types';

const MyCardViewer: React.FC<ICustomEditorCardProps<IMyCardValue>> = ({ cardValue }) => {
  return (
    <div style={{ padding: 16, border: '1px solid #eee', borderRadius: 8 }}>
      <h3>{cardValue.title}</h3>
      <p>{cardValue.content}</p>
    </div>
  );
};

export default MyCardViewer;
```

#### 4. 编写卡片图标和配置
``` tsx
/** 自定义图标 */
// src/cards/MyCard/Icon.tsx
const MyCardIcon = () => (
  <symbol id="icon-editor-h4" viewBox="0 0 256 256">
		<path d="M119.4 221.64c3.467-.173 6.023-1.213 7.67-3.12 1.647-1.907 2.47-4.333 2.47-7.28V48.48c0-2.947-.867-5.373-2.6-7.28s-4.333-2.86-7.8-2.86c-3.813 0-6.457.91-7.93 2.73-1.473 1.82-2.21 4.29-2.21 7.41v70.2H43.84v-70.2c0-2.947-.823-5.373-2.47-7.28-1.647-1.907-4.203-2.86-7.67-2.86-3.467 0-6.067.953-7.8 2.86-1.733 1.907-2.6 4.333-2.6 7.28v162.76c0 2.947.867 5.417 2.6 7.41 1.733 1.993 4.333 2.99 7.8 2.99 3.467-.173 6.023-1.213 7.67-3.12 1.647-1.907 2.47-4.333 2.47-7.28v-74.88H109v74.88c0 2.947.867 5.417 2.6 7.41 1.733 1.993 4.333 2.99 7.8 2.99ZM213.6 77.1c3.151 0 5.54 1.132 6.97 3.4 1.325 2.107 1.93 5.77 1.93 11.1v80.7h7.7c4.568 0 7.007 3.025 7.097 8.388l.003.312c0 5.558-2.444 8.7-7.1 8.7h-7.7V213c0 2.956-.607 5.078-1.985 6.32l-.17.144c-1.404 1.142-3.762 1.636-7.145 1.636-3.279 0-5.616-.584-7.026-1.906-1.419-1.33-2.074-3.418-2.074-6.194v-23.3h-54.5c-5.356 0-8.772-2.284-9.822-6.803l-.063-.285c-.298-2.084-.08-4.48.634-7.194.713-2.71 2.311-5.975 4.79-9.832l43.387-67.178c3.8-6.106 7.412-10.742 10.858-13.912 3.384-3.113 7.779-5.492 13.168-7.148l.833-.248h.215Zm-9.5 27.294L161.317 172.3H204.1v-67.906Z"
		fill="currentColor" fillRule="evenodd">
		</path>
	</symbol>
)
export default MyCardIcon
```
```ts
// src/cards/MyCard/index.ts
import { CustomCard, CustomCardConfig } from '../../components/lakex/types';
import MyCardEditor from './MyCardEditor';
import MyCardViewer from './MyCardViewer';
import { IMyCardValue } from './types';
import MyCardIcon from "./Icon.tsx"

const myCardConfig: CustomCardConfig<IMyCardValue> = {
  name: 'my-card',            // ← 唯一名称
  cardType: 'block',          // ← 区块卡片
  editorComponent: MyCardEditor,
  viewerComponent: MyCardViewer,
  initValue: {
    title: '标题',
    content: '内容',
    cardHeight: 200,
  },
  slash: {
    icon: 'editor-main-text-drawing',  // ← 图标 ID（见下方"图标"说明）
    mainSearch: '/mycard',
    label: () => ({ zhCN: '我的卡片', enUS: 'My Card' }),
    description: () => ({ zhCN: '自定义卡片示例', enUS: 'Custom card example' }),
    keywords: ['mycard', '我的卡片'],
  },
  writeText: (value) => value?.content || '',
  writeHtml: (value) => `<div>${value?.content || ''}</div>`,
};

export const myCard: CustomCard = {
  icon: MyCardIcon,
  config: myCardConfig,
};
```




#### 5. 注册卡片

**通过 `config` prop 传入**

```tsx
import { LakexEditor } from '@dlient/lakex-doc-react';
import '@dlient/lakex-doc-react/style.css';
import { myCard } from './cards/MyCard';

<LakexEditor
  config={{
    customCard: {
      cards: [myCard],
    },
  }}
/>
```

> 通过 `config.customCard.cards` 传入的卡片会与内置默认卡片（思维导图、文本绘图）**追加合并**，不会覆盖。




---

### 配置斜杠命令（Slash Menu）

斜杠命令是用户通过输入 `/` 唤起的菜单面板。自定义卡片需要在**两个地方**配置才能正确显示在菜单中。

#### 1. 卡片配置中的 `slash` 字段

在 `CustomCardConfig.slash` 中定义菜单项的图标、名称、描述和搜索关键字（见上方步骤 4）。这是必填项。

#### 2. `slash.ts` 中添加菜单项

在 `src/configs/slash.ts` 的 `cardSelect` 配置中，将卡片名称添加到对应的分组：

```ts
// src/configs/slash.ts
const DefaultSlashConfig: SlashConfig = {
  cardSelect: {
    general: {       // ← general: 普通编辑环境下的菜单
      groups: [
        // ...其他分组
        {
          title: '程序员',
          name: 'group-files',
          type: 'normal',
          items: [
            'codeblock',
            'math',
            'custom-text-to-diagram',   // ← 注意前缀 "custom-"
            'custom-mindmap-card',      // ← name 前加 "custom-"
            'custom-my-card',           // ← 你的卡片
          ],
        },
      ],
    },
    table: { /* ... 同上，table 环境下的菜单 ... */ },
    collapse: { /* ... 同上，折叠块环境下的菜单 ... */ },
  },
  disableQuickInput: false,  // 是否禁用 / 快捷输入
};
```

#### 关键规则：`custom-` 前缀

在 `slash.ts` 的 `items` 数组中，自定义卡片的 key **必须是 `"custom-" + 卡片 name`**。

| 卡片 `name` | slash items 中的 key |
|-------------|---------------------|
| `mindmap-card` | `custom-mindmap-card` |
| `text-to-diagram` | `custom-text-to-diagram` |
| `my-card` | `custom-my-card` |

> 不加 `custom-` 前缀会导致菜单项无法匹配到自定义卡片，点击后不会插入卡片。

#### `cardSelect` 的三种环境

| 环境 key | 触发场景 |
|----------|---------|
| `general` | 普通文档编辑（最常用） |
| `table` | 光标在表格内时 |
| `collapse` | 光标在折叠块内时 |

通常需要在三种环境中都添加你的卡片 key，或至少在 `general` 中添加。

#### 分组配置说明

```ts
{
  title: '分组标题',        // 菜单中显示的分组名
  name: 'group-xxx',      // 分组唯一标识
  type: 'normal',         // 布局样式：normal 普通流式 | icon 小图标 | column 两栏
  items: [                // 菜单项列表
    'p', 'h1',            // 内置项直接用字符串
    'custom-my-card',     // 自定义卡片用 "custom-" + name
    { name: 'columns', childMenus: ['columns2', 'columns3'] }, // 带子菜单的项
  ],
}
```

#### 搜索功能

用户输入 `/` 后可以搜索菜单项。搜索匹配范围：

- `slash.label` — 菜单名称（如"我的卡片"）
- `slash.keywords` — 关键字列表（如 `['mycard', '我的卡片']`）
- `slash.mainSearch` — 搜索提示（如 `/mycard`）

配置 `keywords` 可以让用户用更多词汇搜到你的卡片。

---

### 图标（Icon）配置

斜杠菜单中的卡片图标通过 SVG `<symbol>` 实现。有两种方式提供图标：

#### 方式 A：使用框架内置图标

lakex 框架自带了一批图标（如 `editor-main-mind-map`、`editor-main-text-drawing` 等），可以直接在 `slash.icon` 中引用：

```ts
slash: {
  icon: 'editor-main-mind-map',  // ← 框架内置图标 ID
  // ...
}
```

这种方式不需要额外定义 `CustomCard.icon`。

#### 方式 B：自定义 SVG 图标

如果需要使用自己的图标，在 `CustomCard.icon` 中提供一个返回 `<symbol>` 的 React 组件：

```tsx
// src/cards/MyCard/MyCardIcon.tsx
const MyCardIcon = () => (
  <symbol id="my-custom-icon" viewBox="0 0 1024 1024">
    <path d="M512 64L64 512l448 448 448-448z" />
  </symbol>
);
export default MyCardIcon;
```

然后在卡片注册对象中设置：

```ts
export const myCard: CustomCard = {
  icon: MyCardIcon,       // ← SVG symbol 组件
  config: myCardConfig,   // config.slash.icon 需与 symbol id 一致
};
```

```ts
// config.slash.icon 必须与 <symbol id="..."> 一致
slash: {
  icon: 'my-custom-icon',  // ← 对应 <symbol id="my-custom-icon">
  // ...
}
```

> **注意**：`<symbol>` 中的 `<path>` 尽量不要设置 `fill` 颜色。如果设置了固定颜色，切换暗黑模式时图标颜色不会自动变化。使用 `fill="currentColor"` 可以让图标跟随文字颜色。

### 内置自定义卡片

本组件内置了两个自定义卡片，可直接使用：

#### 思维导图（MindMap）

- **卡片 name**：`mindmap-card`
- **slash key**：`custom-mindmap-card`
- **数据类型**：`{ markdown: string; cardHeight?: number }`
- **基于**：`@xiangfa/mindmap`

#### 文本绘图（TextToDiagram）

- **卡片 name**：`text-to-diagram`
- **slash key**：`custom-text-to-diagram`
- **数据类型**：`{ code: string; type: 'mermaid' | 'flowchart' | 'plantuml' | 'graphviz'; cardHeight: number; showEditor?: boolean; showPreview?: boolean }`
- **支持**：Mermaid、Flowchart、PlantUML、Graphviz 四种图表类型

---

## Build from Source

```bash
npm install
npm run build      # vite (es + cjs) + .d.ts -> dist/
npm pack           # produce the tarball
```

## Patches (applied automatically)

本包会自动 patch [`@xiangfa/mindmap@0.7.1`](https://www.npmjs.com/package/@xiangfa/mindmap)，为 `<MindMap>` 添加 `disableAutoFit` prop。如果没有这个 prop，编辑/添加节点时会重新运行库内部的 `autoFit`，导致每次编辑都重置视图缩放（视觉上"自动缩放"）—— 这不是卡片内部想要的效果。

patch 文件位于 [`patches/@xiangfa+mindmap+0.7.1.patch`](./patches)，当用户安装本包时，`patch-package` 会通过 `postinstall` 脚本自动应用。**无需手动操作。**

> 为什么将 `@xiangfa/mindmap` 固定为 `0.7.1`？`patch-package` 是基于文件内容进行 patch 的，因此依赖必须固定到生成 patch 时的精确版本。如果需要使用其他版本的 `@xiangfa/mindmap`，必须重新生成 patch（在本仓库中执行 `yarn patch-package @xiangfa/mindmap`）并更新版本固定。

## Notes

- 框架 bundle（`lakex.js`，约 9.7 MB）包含在发布产物中；对于完整的富文本编辑器来说，这是预期的大小。
- 样式输出到 `dist/style.css`，使用者必须导入一次（见快速开始）。它们被标记为 `sideEffects`，以便打包工具保留它们。
- 内部应用了 React 18 兼容性垫片：`ReactDOM.render` 被重定向到 `createRoot`，并抑制了来自打包的第三方组件的废弃 `defaultProps` 警告。
