# @dlient/lakex-doc-react

React wrapper for the **lakex (YuQue) document editor**, packaged as a standalone,
publishable npm component.

It bundles:

- `LakexEditor` — a React component that mounts the lakex open editor via the
  framework's `createOpenEditor` API (no global `<script>` / `window.React` hack).
- `Doc` — the lakex-doc framework root object (ESM build of `@alipay/lakex-doc`).
- `CardResizer` — a reusable card wrapper that supports **click-to-select**
  (shows a border + a bottom drag handle), **drag-to-resize**, and
  **delete-on-`Delete`** when selected.
- `mindMapCardConfig` / `MindMapEditor` / `MindMapViewer` — a custom card
  (mind-map) built on [`@xiangfa/mindmap`](https://www.npmjs.com/package/@xiangfa/mindmap).
- `textToDiagramCard` — a custom card supporting Mermaid / Flowchart / PlantUML / Graphviz.
- `slashConfig` — default slash-menu configuration (includes the mindmap and
  text-to-diagram entries).

> 📖 [中文文档](README-zh.md)

## Requirements

- **React 18** (`react` / `react-dom` `^18`). The lakex framework is built against
  React 18 APIs (e.g. `ReactDOM.render`, `findDOMNode`) that were removed in
  React 19, so React 19 is **not** supported.

## Install

```bash
npm install @dlient/lakex-doc-react
# peer deps:
npm install react@^18 react-dom@^18
```

## Quick Start

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

> **Don't forget the CSS import.** Without `import '@dlient/lakex-doc-react/style.css'`
> the editor toolbar and cards will render as unstyled HTML.

---

## LakexEditor Props

The `<LakexEditor>` component accepts the following props:

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `id` | `string` | — | Document ID. When this value changes, the editor is destroyed and recreated, useful for switching documents. |
| `dark` | `boolean` | `false` | Enable dark mode. When this value changes, the editor re-renders to apply the new theme. |
| `language` | `"zh-cn" \| "en-us"` | `"zh-cn"` | Display language (UI text, placeholder hints, etc.). The editor re-renders when this value changes. |
| `content` | `LakexEditorContent` | — | Initial document content. Type is `{ type: LakexEditorContentType; text: string }`. |
| `onContentChange` | `(value: LakexEditorContent[]) => void` | — | Content change callback. Triggered on every edit, returns an array of 5 format snapshots. |
| `config` | `Partial<LakexEditorConfig>` | — | Underlying config passed to `createOpenEditor`, deep merged with built-in defaults. |
| `disableMergeConfig` | `boolean` | `false` | Disable config merging. When enabled, built-in defaults are ignored, only `config` prop is used. |
| `blockMenu` | `boolean` | `true` | Show the YuQue-style block handle on hover. The handle can be dragged to reorder blocks or clicked to open the block menu. |
| `onBlockAction` | `(action, data) => void` | — | Called after a block-menu action. Use the `aiOutline` action to connect your own AI writing service. |

### `LakexEditorContent`

```ts
interface LakexEditorContent {
  type: "text/lake" | "text/html" | "text/plain" | "text/markdown" | "json";
  text: string;
}
```

The `onContentChange` callback returns an array in the above format, containing snapshots of all 5 formats.

### Basic Usage Examples

```tsx
// Controlled usage: load document content
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

// Switch documents: change id to reload
<LakexEditor id={currentDocId} />
```

### Block handle and menu

Hover a paragraph, heading, list item, quote, code block, media block, table, or
custom block card to reveal the six-dot handle. Drag it to reorder blocks, or
click it to open actions such as turn into, delete, copy, cut, indent, copy link,
and add above/below.

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

Passed via `<LakexEditor config={...}>`, deep merged with built-in defaults.
Config reference: https://www.yuque.com/yuque/developer/hrz4raqhg9bsv9g9

### General Config

| Field | Type | Description |
|-------|------|-------------|
| `disabledPlugins` | `string[]` | List of disabled plugins. |
| `header` | `ComponentType<any>` | React component rendered above the document. |
| `uiSwitch` | `{ default?: "simple" \| "default" \| "small" }` | Editor type: simple / default / small. |
| `currentURL` | `string` | Current page URL used by some cards when outputting HTML. |
| `envAdapter` | `EnvAdapter \| null` | Adapter for handling interactions (open links, preview images) across devices/business scenarios. |
| `virtualRendering` | `boolean` | Enable virtual rendering (1.6.0+). |
| `scrollNode` | `HTMLElement \| (() => HTMLElement)` | Scroll container, required for reader outline. |
| `boundaryTopOffset` | `number` | Reader outline scroll offset. |
| `placeholder` | `string \| LakexEditorPlaceholder` | Placeholder text. `{ tip: string; emptyParagraphTip?: string }`. |

### Plugin Config

| Field | Type | Description |
|-------|------|-------------|
| `image` | `ImageConfig` | Image config: upload URL `uploadFileURL`, crawl-to-save `crawlURL`, custom upload `createUploadPromise`, accepted extensions `accept`, etc. |
| `input` | `InputConfig` | Input config: auto spacing `autoSpacing`, auto closing `autoClosing`. |
| `layout` | `LayoutConfig` | Layout mode: `"fixed"` 750px / `"adapt"` responsive. |
| `heading` | `HeadingConfig` | Heading config: anchor `anchor`, folding `folding`, hash link `generateHashLink`. |
| `video` | `VideoConfig` | Video config: upload `uploadFileURL`, custom upload `createUploadPromise`, video crawl `crawlVideo`. |
| `file` | `FileConfig` | Attachment config: download link `getFileDownloadURL`, preview `getPreviewUrl`, upload `uploadFileURL`. |
| `mention` | `MentionConfig` | Mention config: search API `mentionURL` / `onMentionSearch`, avatar origin, default list `defaultList`. |
| `dateCard` | `DateCardConfig` | Date card config: support mention date selection `supportMention`. |
| `calendar` | `CalendarConfig` | Calendar config: week start day `startWeekDay`, read link `getDocReadURL`. |
| `math` | `MathConfig` | Math config: KaTeX resource URL `KaTexURL`, hide when invisible `hideOnInvisible`. |
| `slash` | `SlashConfig` | Slash command menu config (see Custom Card section below). |
| `toc` | `TocEditingConfig` | Table of contents config: enable `enable`, default expand `normalView`, allow hash modify `allowModifyHash`. |
| `codeblock` | `CodeblockConfig` | Code block config: support custom style `supportCustomStyle`. |
| `audio` | `AudioConfig` | Audio config: upload `createUploadPromise`, playback URL query `queryAudioUrl`, custom player `playerComponent`. |
| `link` | `LinkConfig` | Link config: reader mode hover toolbar `vMiniToolbar`. |
| `htmlDataSource` | `HtmlDataSourceConfig` | HTML data source config: read empty lines `readEmptyLine`. |
| `fallbackcard` | `FallbackcardConfig` | Fallback card config: main tip `mainTipHTML`, sub tip `subTipHTML`. |
| `kernelAssistant` | `KernelAssistantConfig` | Kernel assistant config: emoji standalone font `supportEmoji`. |
| `defaultFontsize` | `DefaultFontsizeConfig` | Default font size config: `defaultFontsize` (12/13/14/15/16/19/22/24). |
| `toolbar` | `ToolbarConfig` | Toolbar config: `agentConfig.default` (default toolbar), `agentConfig.table` (table selection toolbar). |
| `customCard` | `CustomCardsConfig` | Custom card config (see section below). |
| `drawingBoardAI` | `DrawingBoardAIConfig` | AI board assistant service, connected through the `generate` callback. |

### config Usage Example

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

### AI board assistant

The AI toolbar entry is provider-neutral and does not store model credentials in
the browser. Connect it to your server with `drawingBoardAI.generate`. Send
`systemPrompt` as the model system message and `contextPrompt` as the user
message. The context contains the request history, exactly one latest canvas
JSON snapshot, and the newest request. The board validates the returned JSON
before creating native Drawnix/Plait elements.

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
        return result.json;
      },
    },
  }}
/>
```

Request memory is scoped to each board and updated only after a successful
generation. Each request serializes the live canvas again, so manual edits are
included without retaining earlier AI JSON snapshots.

The development EdgeFN proxy uses provider-side SSE by default while still
returning one complete JSON response to the board. Its total timeout, idle
timeout, retry count, and output-token limit are configurable with
`LAKEX_AI_REQUEST_TIMEOUT_MS`, `LAKEX_AI_IDLE_TIMEOUT_MS`,
`LAKEX_AI_MAX_RETRIES`, and `LAKEX_AI_MAX_TOKENS`.

See [`docs/lakex-drawing-board-json-format-skills.md`](docs/lakex-drawing-board-json-format-skills.md)
for the model-facing schema.

---

## Custom Card

Custom cards are the core extension mechanism of the lakex editor. You can insert any React component as a block or inline card in documents, and invoke them via the slash command (`/`) menu.

### Card Architecture Overview

```
src/cards/MyCard/
├── index.ts              ← Card config export (CustomCard)
├── types.ts              ← Card data type definition
├── MyCardEditor.tsx      ← Edit mode component
├── MyCardViewer.tsx      ← Read mode component
└── MyCard.css            ← Styles (optional)
```

### Core Type Definitions

#### `CustomCard` — Card Registration Object

```ts
interface CustomCard<TCardValue = any> {
  /** Custom SVG icon component (optional, for slash menu) */
  icon?: React.ElementType | React.ComponentType | React.FC;
  /** Card config */
  config: CustomCardConfig<TCardValue>;
}
```

Here's how to create a custom icon, where the symbol's id must match CustomCardConfig.slash.icon.
``` tsx
/** Custom Icon */
const customCardIcon = () => (
  <symbol id="icon-editor-h4" viewBox="0 0 256 256">
		<path d="M119.4 221.64c3.467-.173 6.023-1.213 7.67-3.12 1.647-1.907 2.47-4.333 2.47-7.28V48.48c0-2.947-.867-5.373-2.6-7.28s-4.333-2.86-7.8-2.86c-3.813 0-6.457.91-7.93 2.73-1.473 1.82-2.21 4.29-2.21 7.41v70.2H43.84v-70.2c0-2.947-.823-5.373-2.47-7.28-1.647-1.907-4.203-2.86-7.67-2.86-3.467 0-6.067.953-7.8 2.86-1.733 1.907-2.6 4.333-2.6 7.28v162.76c0 2.947.867 5.417 2.6 7.41 1.733 1.993 4.333 2.99 7.8 2.99 3.467-.173 6.023-1.213 7.67-3.12 1.647-1.907 2.47-4.333 2.47-7.28v-74.88H109v74.88c0 2.947.867 5.417 2.6 7.41 1.733 1.993 4.333 2.99 7.8 2.99ZM213.6 77.1c3.151 0 5.54 1.132 6.97 3.4 1.325 2.107 1.93 5.77 1.93 11.1v80.7h7.7c4.568 0 7.007 3.025 7.097 8.388l.003.312c0 5.558-2.444 8.7-7.1 8.7h-7.7V213c0 2.956-.607 5.078-1.985 6.32l-.17.144c-1.404 1.142-3.762 1.636-7.145 1.636-3.279 0-5.616-.584-7.026-1.906-1.419-1.33-2.074-3.418-2.074-6.194v-23.3h-54.5c-5.356 0-8.772-2.284-9.822-6.803l-.063-.285c-.298-2.084-.08-4.48.634-7.194.713-2.71 2.311-5.975 4.79-9.832l43.387-67.178c3.8-6.106 7.412-10.742 10.858-13.912 3.384-3.113 7.779-5.492 13.168-7.148l.833-.248h.215Zm-9.5 27.294L161.317 172.3H204.1v-67.906Z"
		fill="currentColor" fillRule="evenodd">
		</path>
	</symbol>
)
```

#### `CustomCardConfig` — Card Config

```ts
interface CustomCardConfig<TCardValue = any> {
  /** Card name, must be unique. Matches rendering component when reading data */
  name: string;
  /** Card type: 'inline' (same line as text) | 'block' (occupies full line) */
  cardType: 'inline' | 'block';
  /** Slash command menu config */
  slash: {
    icon: string;                    // Icon ID (matches SVG symbol id)
    mainSearch?: string;             // Search hint, e.g. '/mindmap'
    keywords?: string | string[];    // Search keywords
    label: string | (() => { zhCN: string; enUS: string });         // Menu display name
    description?: string | (() => { zhCN: string; enUS: string });  // Menu description
  };
  /** Initial card data, pass null if not needed */
  initValue: Record<string, any> | null;
  /** Edit mode component (supports functional or class components) */
  editorComponent: React.ComponentType<ICustomEditorCardProps<TCardValue>>;
  /** Read mode component (supports functional or class components) */
  viewerComponent: React.ComponentType<ICustomEditorCardProps<TCardValue>>;
  /** Custom plain text export (used for copy/export) */
  writeText: (value: TCardValue | null) => string;
  /** Custom HTML export (used for copy/export) */
  writeHtml: (value: TCardValue | null) => string;
}
```

#### `ICustomEditorCardProps` — Props Received by Component

```ts
interface ICustomEditorCardProps<TCardValue = any> {
  /** Lakex editor instance (can call execCommand, read theme, etc.) */
  editor: any;
  /** Current card data */
  cardValue: TCardValue;
  /** Update card data, triggers component re-render */
  updateCardValue: (value: TCardValue) => void;
  /** Card type: 'inline' | 'block' */
  cardType: 'inline' | 'block';
}
```

### Development Steps

#### 1. Define Card Data Type

```ts
// src/cards/MyCard/types.ts
export interface IMyCardValue {
  title: string;
  content: string;
  cardHeight?: number;  // Add this field if height drag is needed
}
```

#### 2. Write Edit Mode Component

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

> **About `CardResizer`**: This is an optional height drag wrapper component. It provides click-to-select (shows border), bottom drag handle for height adjustment, and Delete key to remove card when selected. If your card doesn't need height adjustment, you can skip it.

#### 3. Write Read Mode Component

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

#### 4. Write Card Icon and Config
``` tsx
/** Custom Icon */
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
  name: 'my-card',            // ← Unique name
  cardType: 'block',          // ← Block card
  editorComponent: MyCardEditor,
  viewerComponent: MyCardViewer,
  initValue: {
    title: 'Title',
    content: 'Content',
    cardHeight: 200,
  },
  slash: {
    icon: 'editor-main-text-drawing',  // ← Icon ID (see "Icons" section below)
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




#### 5. Register Card

**Pass via `config` prop**

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

> Cards passed via `config.customCard.cards` are **merged** with built-in default cards (mindmap, text-to-diagram), not overwritten.




---

### Configure Slash Menu

The slash menu is triggered by typing `/`. Custom cards need to be configured in **two places** to display correctly.

#### 1. `slash` Field in Card Config

Define the menu item's icon, name, description, and search keywords in `CustomCardConfig.slash` (see Step 4 above). This is required.

#### 2. Add Menu Item in `slash.ts`

Add the card name to the corresponding group in `cardSelect` config of `src/configs/slash.ts`:

```ts
// src/configs/slash.ts
const DefaultSlashConfig: SlashConfig = {
  cardSelect: {
    general: {       // ← general: menu in normal editing context
      groups: [
        // ...other groups
        {
          title: 'Developer',
          name: 'group-files',
          type: 'normal',
          items: [
            'codeblock',
            'math',
            'custom-text-to-diagram',   // ← Note the "custom-" prefix
            'custom-mindmap-card',      // ← Add "custom-" before name
            'custom-my-card',           // ← Your card
          ],
        },
      ],
    },
    table: { /* ... same structure, menu in table context ... */ },
    collapse: { /* ... same structure, menu in collapse block context ... */ },
  },
  disableQuickInput: false,  // Disable / quick input
};
```

#### Key Rule: `custom-` Prefix

In the `items` array of `slash.ts`, the key for custom cards **must be `"custom-" + card name`**.

| Card `name` | Key in slash items |
|-------------|---------------------|
| `mindmap-card` | `custom-mindmap-card` |
| `text-to-diagram` | `custom-text-to-diagram` |
| `my-card` | `custom-my-card` |

> Without the `custom-` prefix, the menu item cannot match the custom card, and clicking will not insert the card.

#### Three Contexts of `cardSelect`

| Context key | Trigger Scenario |
|-------------|------------------|
| `general` | Normal document editing (most common) |
| `table` | When cursor is inside a table |
| `collapse` | When cursor is inside a collapse block |

Typically, you need to add your card key in all three contexts, or at least in `general`.

#### Group Config Description

```ts
{
  title: 'Group Title',     // Group name displayed in menu
  name: 'group-xxx',       // Unique group identifier
  type: 'normal',          // Layout style: normal flow | icon small | column two-column
  items: [                 // Menu item list
    'p', 'h1',             // Built-in items use string directly
    'custom-my-card',      // Custom cards use "custom-" + name
    { name: 'columns', childMenus: ['columns2', 'columns3'] }, // Item with submenu
  ],
}
```

#### Search Functionality

Users can search menu items after typing `/`. Search matches:

- `slash.label` — Menu name (e.g., "My Card")
- `slash.keywords` — Keyword list (e.g., `['mycard', '我的卡片']`)
- `slash.mainSearch` — Search hint (e.g., `/mycard`)

Configuring `keywords` allows users to find your card with more terms.

---

### Icon Configuration

Card icons in the slash menu are implemented via SVG `<symbol>`. There are two ways to provide icons:

#### Option A: Use Built-in Framework Icons

The lakex framework includes a set of icons (e.g., `editor-main-mind-map`, `editor-main-text-drawing`, etc.), which can be referenced directly in `slash.icon`:

```ts
slash: {
  icon: 'editor-main-mind-map',  // ← Built-in framework icon ID
  // ...
}
```

This approach does not require defining `CustomCard.icon`.

#### Option B: Custom SVG Icon

If you need to use your own icon, provide a React component that returns `<symbol>` in `CustomCard.icon`:

```tsx
// src/cards/MyCard/MyCardIcon.tsx
const MyCardIcon = () => (
  <symbol id="my-custom-icon" viewBox="0 0 1024 1024">
    <path d="M512 64L64 512l448 448 448-448z" />
  </symbol>
);
export default MyCardIcon;
```

Then set it in the card registration object:

```ts
export const myCard: CustomCard = {
  icon: MyCardIcon,       // ← SVG symbol component
  config: myCardConfig,   // config.slash.icon must match symbol id
};
```

```ts
// config.slash.icon must match <symbol id="...">
slash: {
  icon: 'my-custom-icon',  // ← Matches <symbol id="my-custom-icon">
  // ...
}
```

> **Note**: Avoid setting `fill` color on `<path>` inside `<symbol>`. If a fixed color is set, the icon color won't change automatically when switching dark mode. Use `fill="currentColor"` to make the icon follow text color.

### Built-in Custom Cards

This component includes two built-in custom cards ready to use:

#### MindMap

- **Card name**: `mindmap-card`
- **Slash key**: `custom-mindmap-card`
- **Data type**: `{ markdown: string; cardHeight?: number }`
- **Based on**: `@xiangfa/mindmap`

#### TextToDiagram

- **Card name**: `text-to-diagram`
- **Slash key**: `custom-text-to-diagram`
- **Data type**: `{ code: string; type: 'mermaid' | 'flowchart' | 'plantuml' | 'graphviz'; cardHeight: number; showEditor?: boolean; showPreview?: boolean }`
- **Supports**: Mermaid, Flowchart, PlantUML, Graphviz

---

## Build from Source

```bash
npm install
npm run build      # vite (es + cjs) + .d.ts -> dist/
npm pack           # produce the tarball
```

## Patches (applied automatically)

This package patches [`@xiangfa/mindmap@0.7.1`](https://www.npmjs.com/package/@xiangfa/mindmap)
to add a `disableAutoFit` prop on `<MindMap>`. Without it, editing / adding a
node re-runs the library's internal `autoFit`, which resets the view zoom
(visually "auto-zooms") on every edit — not what you want inside a card.

The patch lives in [`patches/@xiangfa+mindmap+0.7.1.patch`](./patches) and is
applied automatically by `patch-package` through the package's `postinstall`
script when a consumer installs the package. **No manual step is required.**

> Why pin `@xiangfa/mindmap` to exactly `0.7.1`? `patch-package` patches file
> contents, so the dependency is pinned to the exact version the patch was
> generated against. If you need a different `@xiangfa/mindmap` version, you must
> regenerate the patch (`yarn patch-package @xiangfa/mindmap` in this repo) and
> update the pin.

## Notes

- The framework bundle (`lakex.js`, ~9.7 MB) is included in the published
  artifact; this is expected for a full rich-text editor.
- Styles are emitted to `dist/style.css` and must be imported once by the
  consumer (see Quick Start). They are marked as `sideEffects` so bundlers keep them.
- React 18 compatibility shims are applied internally: `ReactDOM.render` is
  redirected to `createRoot`, and deprecated `defaultProps` warnings from
  bundled third-party components are suppressed.
