import React from 'react';
import mermaid from 'mermaid';
import * as flowchart from 'flowchart.ts';
import * as Viz from '@viz-js/viz';
import './TextToDiagram.css';
import type { DiagramType, ITextToDiagramCardValue } from './types';

// PlantUML 核心模块（含 viz-global 布局引擎）改为随包本地导入（原 CDN 动态加载见 LOCAL-CHANGES.md）。

// Mermaid 初始化配置，theme 会在主题变更时动态更新。
let currentMermaidTheme: 'default' | 'dark' = 'default';
mermaid.initialize({
  startOnLoad: false,
  securityLevel: 'loose',
  theme: 'default',
});

function reinitMermaid(theme: 'light' | 'dark') {
  const next = theme === 'dark' ? 'dark' : 'default';
  if (next === currentMermaidTheme) return;
  currentMermaidTheme = next;
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'loose',
    theme: next,
  });
}

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

// ── 模板定义 ──────────────────────────────────────────────
// 每种图表类型提供多个命名模板，切换类型时下拉框只显示当前类型的模板。
interface DiagramTemplate {
  name: string;
  nameEn: string;
  code: string;
}

const templates: Record<DiagramType, DiagramTemplate[]> = {
  mermaid: [
    {
      name: '流程图',
      nameEn: 'Flowchart',
      code: `flowchart TD
    A[Start] --> B{Decision}
    B -->|Yes| C[Process A]
    B -->|No| D[Process B]
    C --> E[End]
    D --> E`,
    },
    {
      name: '时序图',
      nameEn: 'Sequence',
      code: `sequenceDiagram
    participant Alice
    participant Bob
    Alice->>Bob: Hello Bob, how are you?
    Bob-->>Alice: I am good thanks!
    Alice->>Bob: Nice to meet you
    Bob-->>Alice: Nice to meet you too`,
    },
    {
      name: '类图',
      nameEn: 'Class',
      code: `classDiagram
    Animal <|-- Duck
    Animal <|-- Fish
    Animal <|-- Zebra
    Animal : +int age
    Animal : +String gender
    Animal: +isMammal()
    Animal: +mate()
    class Duck{
      +String beakColor
      +swim()
      +quack()
    }
    class Fish{
      -int sizeInFeet
      -canEat()
    }
    class Zebra{
      +bool is_wild
      +run()
    }`,
    },
    {
      name: '甘特图',
      nameEn: 'Gantt',
      code: `gantt
    title A Gantt Diagram
    dateFormat  YYYY-MM-DD
    section Section
    A task           :a1, 2024-01-01, 30d
    Another task     :after a1, 20d
    section Another
    Task in sec      :2024-01-12, 12d
    another task     :24d`,
    },
    {
      name: '饼图',
      nameEn: 'Pie',
      code: `pie title Pets adopted by volunteers
    "Dogs" : 386
    "Cats" : 85
    "Rats" : 15`,
    },
  ],
  flowchart: [
    {
      name: '基础流程',
      nameEn: 'Basic',
      code: `st=>start: Start
e=>end: End
op=>operation: My Operation
cond=>condition: Yes or No?

st->op->cond
cond(yes)->e
cond(no)->op`,
    },
    {
      name: '条件分支',
      nameEn: 'Conditional',
      code: `st=>start: Start
e=>end: End
op1=>operation: Operation 1
op2=>operation: Operation 2
cond=>condition: Go left or right?

st->cond
cond(yes)->op1->e
cond(no)->op2->e`,
    },
    {
      name: '并行任务',
      nameEn: 'Parallel',
      code: `st=>start: Start
e=>end: End
op1=>operation: My Operation
sub1=>subroutine: My Subroutine
cond=>condition: Yes or No?
io=>inputoutput: catch something...
para=>parallel: parallel tasks

st->op1->cond
cond(yes)->io->e
cond(no)->para
para(path1, bottom)->sub1(right)->op1
para(path2, top)->op1`,
    },
  ],
  plantuml: [
    {
      name: '时序图',
      nameEn: 'Sequence',
      code: `@startuml
Alice -> Bob : Hello
Bob -> Alice : Hi
@enduml`,
    },
    {
      name: '用例图',
      nameEn: 'Use Case',
      code: `@startuml
left to right direction
User --> (Login)
User --> (Logout)
(Login) ..> (Authentication) : <<include>>
@enduml`,
    },
    {
      name: '类图',
      nameEn: 'Class',
      code: `@startuml
class Animal {
  +String name
  +int age
  +void eat()
}
class Dog {
  +void bark()
}
Animal <|-- Dog
@enduml`,
    },
    {
      name: '活动图',
      nameEn: 'Activity',
      code: `@startuml
start
if (condition?) then (yes)
  :Process A;
else (no)
  :Process B;
endif
stop
@enduml`,
    },
  ],
  graphviz: [
    {
      name: '有向图',
      nameEn: 'Directed',
      code: `digraph G {
  rankdir=LR;
  A [label="Start"];
  B [label="Process"];
  C [label="End"];
  A -> B -> C;
}`,
    },
    {
      name: '无向图',
      nameEn: 'Undirected',
      code: `graph G {
  A -- B;
  B -- C;
  C -- A;
  B -- D;
  D -- E;
}`,
    },
    {
      name: '子图',
      nameEn: 'Subgraph',
      code: `digraph G {
  subgraph cluster_0 {
    label = "Process A";
    a1 -> a2 -> a3;
  }
  subgraph cluster_1 {
    label = "Process B";
    b1 -> b2 -> b3;
  }
  a3 -> b1;
  b3 -> a1;
}`,
    },
    {
      name: '形状样式',
      nameEn: 'Styled',
      code: `digraph G {
  rankdir=TB;
  node [shape=box, style=filled, fillcolor=lightblue];
  Start [shape=oval, fillcolor=lightgreen];
  End [shape=oval, fillcolor=lightcoral];
  Decision [shape=diamond, fillcolor=lightyellow];
  Start -> Decision;
  Decision -> Process1 [label="Yes"];
  Decision -> Process2 [label="No"];
  Process1 -> End;
  Process2 -> End;
}`,
    },
  ],
};

const typeLabels: Record<DiagramType, Record<string, string>> = {
  mermaid: { 'zh-CN': 'Mermaid', 'en-US': 'Mermaid' },
  flowchart: { 'zh-CN': 'Flowchart', 'en-US': 'Flowchart' },
  plantuml: { 'zh-CN': 'PlantUML', 'en-US': 'PlantUML' },
  graphviz: { 'zh-CN': 'Graphviz', 'en-US': 'Graphviz' },
};

// ── Viz.js (Graphviz) 单例 ────────────────────────────────
let vizInstance: Viz.Viz | null = null;

const ensureViz = async (): Promise<Viz.Viz> => {
  if (!vizInstance) {
    vizInstance = await Viz.instance();
  }
  return vizInstance;
};

// ── PlantUML 模块加载（CDN） ──────────────────────────────
interface PlantUMLModule {
  render: (
    lines: string[],
    targetId: string,
    options?: { dark?: boolean }
  ) => void;
  renderToString: (
    lines: string[],
    onSuccess: (svg: string) => void,
    onError: (message: string) => void
  ) => void;
}

let plantumlModulePromise: Promise<PlantUMLModule> | null = null;
let plantumlContainerCounter = 0;

const loadPlantUML = async (): Promise<PlantUMLModule> => {
  if (!plantumlModulePromise) {
    plantumlModulePromise = (async () => {
      // LOCAL-CHANGE: 原为 CDN（unpkg）动态加载，离线不可用；改为本地 @plantuml/core 静态导入。
      // @ts-ignore viz-global 为 UMD side-effect 脚本，无类型声明。
      await import("@plantuml/core/viz-global.js");
      // @ts-ignore 无类型声明。
      const mod = await import("@plantuml/core/plantuml.js");
      return mod as unknown as PlantUMLModule;
    })();
  }
  return plantumlModulePromise;
};

class TextToDiagramCore extends React.Component<
  TextToDiagramCoreProps,
  TextToDiagramCoreState
> {
  private lineNumbersRef = React.createRef<HTMLDivElement>();
  private fullscreenRef = React.createRef<HTMLDivElement>();
  private renderToken = 0;
  private mounted = false;
  private renderTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(props: TextToDiagramCoreProps) {
    super(props);
    const value: ITextToDiagramCardValue = props.value || ({} as ITextToDiagramCardValue);
    const initialType = value.type || 'mermaid';
    this.state = {
      code: value.code || templates[initialType][0].code,
      type: initialType,
      showEditor: value.showEditor !== false,
      showPreview: value.showPreview !== false,
      isFullscreen: false,
      svgString: null,
      error: null,
      isRendering: false,
    };
  }

  componentDidMount() {
    this.mounted = true;
    reinitMermaid(this.props.theme);
    this.renderDiagram();
    document.addEventListener('fullscreenchange', this.handleFullscreenChange);
  }

  componentDidUpdate(
    prevProps: TextToDiagramCoreProps,
    prevState: TextToDiagramCoreState
  ) {
    const { value, theme } = this.props;
    const { code, type, showEditor, showPreview } = this.state;

    // ── 区分"外部 prop 变更"与"自身 onChange 回流" ──
    // 外部变更：prop 值与当前 state 不同（说明是文档加载/撤销重做等外部操作）
    // 内部回流：prop 值与当前 state 相同（说明是我们自己的 onChange 回传）
    const propCodeChanged = prevProps.value.code !== value.code;
    const propTypeChanged = prevProps.value.type !== value.type;
    const propShowEditorChanged = prevProps.value.showEditor !== value.showEditor;
    const propShowPreviewChanged = prevProps.value.showPreview !== value.showPreview;

    const isExternalCodeChange = propCodeChanged && value.code !== code;
    const isExternalTypeChange = propTypeChanged && value.type !== type;
    const isExternalShowEditorChange =
      propShowEditorChanged && (value.showEditor !== false) !== showEditor;
    const isExternalShowPreviewChange =
      propShowPreviewChanged && (value.showPreview !== false) !== showPreview;

    if (
      isExternalCodeChange ||
      isExternalTypeChange ||
      isExternalShowEditorChange ||
      isExternalShowPreviewChange
    ) {
      // 外部变更：同步 state，renderDiagram 会在下一次 componentDidUpdate 触发
      const syncedType = value.type || type;
      this.setState({
        code: value.code ?? code,
        type: syncedType,
        showEditor: value.showEditor !== false,
        showPreview: value.showPreview !== false,
      });
      return;
    }

    // ── 主题变更时重新初始化 mermaid ──
    if (prevProps.theme !== theme) {
      reinitMermaid(theme);
    }

    // ── 代码/类型/主题变更时重新渲染图表 ──
    if (
      prevState.code !== code ||
      prevState.type !== type ||
      prevProps.theme !== theme
    ) {
      this.scheduleRender();
    }
  }

  componentWillUnmount() {
    this.mounted = false;
    if (this.renderTimer) {
      clearTimeout(this.renderTimer);
    }
    document.removeEventListener('fullscreenchange', this.handleFullscreenChange);
  }

  private get isZh() {
    return this.props.locale.startsWith('zh');
  }

  private t(zh: string, en: string) {
    return this.isZh ? zh : en;
  }

  // ── 用户事件处理 ──────────────────────────────────────────
  private handleCodeChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const code = e.target.value;
    this.setState({ code });
    this.props.onChange?.({ code });
  };

  private handleTypeChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const type = e.target.value as DiagramType;
    // 切换类型时，如果当前代码是旧类型的某个模板，则自动切换到新类型的第一个模板；
    // 否则保留用户自定义代码（用户可手动从模板下拉框选择）。
    const oldTemplates = templates[this.state.type];
    const isNewTypeTemplate = templates[type].some((t) => t.code === this.state.code);
    const isOldTypeTemplate = oldTemplates.some((t) => t.code === this.state.code);

    let code = this.state.code;
    if (!isNewTypeTemplate && isOldTypeTemplate) {
      code = templates[type][0].code;
    }

    this.setState({ type, code });
    this.props.onChange?.({ type, code });
  };

  private handleTemplateChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const idx = parseInt(e.target.value, 10);
    if (isNaN(idx)) return;
    const tpl = templates[this.state.type][idx];
    if (!tpl) return;
    this.setState({ code: tpl.code });
    this.props.onChange?.({ code: tpl.code });
  };

  private toggleEditor = () => {
    const next = !this.state.showEditor;
    if (!next && !this.state.showPreview) return;
    this.setState({ showEditor: next });
    this.props.onChange?.({ showEditor: next });
  };

  private togglePreview = () => {
    const next = !this.state.showPreview;
    if (!next && !this.state.showEditor) return;
    this.setState({ showPreview: next });
    this.props.onChange?.({ showPreview: next });
  };

  private handleFullscreenChange = () => {
    if (!this.mounted) return;
    this.setState({ isFullscreen: !!document.fullscreenElement });
  };

  private toggleFullscreen = () => {
    const el = this.fullscreenRef.current;
    if (!el) return;
    if (!document.fullscreenElement) {
      el.requestFullscreen?.().catch(() => {});
    } else {
      document.exitFullscreen?.().catch(() => {});
    }
  };

  private handleCodeScroll = (e: React.UIEvent<HTMLTextAreaElement>) => {
    const numbers = this.lineNumbersRef.current;
    if (numbers) {
      numbers.scrollTop = e.currentTarget.scrollTop;
    }
  };

  // ── 渲染调度（防抖 300ms，避免每次按键都触发渲染） ──
  private scheduleRender() {
    if (this.renderTimer) {
      clearTimeout(this.renderTimer);
    }
    this.renderTimer = setTimeout(() => {
      this.renderTimer = null;
      this.renderDiagram();
    }, 300);
  }

  // ── 核心渲染逻辑 ──────────────────────────────────────────
  private async renderDiagram() {
    const { code, type } = this.state;
    const token = ++this.renderToken;

    if (!code.trim()) {
      if (!this.mounted || token !== this.renderToken) return;
      this.setState({ svgString: null, error: null, isRendering: false });
      return;
    }

    this.setState({ isRendering: true, error: null });

    try {
      let svgString: string | null = null;

      if (type === 'mermaid') {
        const id = `text-to-diagram-mermaid-${token}`;
        const result = await mermaid.render(id, code);
        svgString = result.svg;
      } else if (type === 'plantuml') {
        svgString = await this.renderPlantUML(code);
      } else if (type === 'graphviz') {
        svgString = await this.renderGraphviz(code);
      } else if (type === 'flowchart') {
        svgString = this.renderFlowchart(code);
      }

      if (!this.mounted || token !== this.renderToken) return;
      this.setState({
        svgString,
        error: null,
        isRendering: false,
      });
    } catch (err) {
      if (!this.mounted || token !== this.renderToken) return;
      this.setState({
        error: err instanceof Error ? err.message : String(err),
        svgString: null,
        isRendering: false,
      });
    }
  }

  private async renderPlantUML(code: string): Promise<string> {
    const plantuml = await loadPlantUML();
    const isDark = this.props.theme === 'dark';

    // render() 需要一个 DOM 元素 id 作为渲染目标，且是异步写入。
    // 创建临时离屏容器，用 MutationObserver 监听 SVG 写入后提取。
    const containerId = `plantuml-target-${++plantumlContainerCounter}-${Date.now()}`;
    const container = document.createElement('div');
    container.id = containerId;
    container.style.position = 'absolute';
    container.style.left = '-9999px';
    container.style.top = '-9999px';
    document.body.appendChild(container);

    return new Promise<string>((resolve, reject) => {
      let settled = false;
      const cleanup = () => {
        observer.disconnect();
        clearTimeout(timeout);
        if (container.parentNode) {
          document.body.removeChild(container);
        }
      };

      const observer = new MutationObserver(() => {
        const svg = container.querySelector('svg');
        if (svg) {
          if (settled) return;
          settled = true;
          const svgString = new XMLSerializer().serializeToString(svg);
          cleanup();
          resolve(svgString);
        }
      });
      observer.observe(container, { childList: true, subtree: true });

      // 超时保护（15s）
      const timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(new Error('PlantUML rendering timeout'));
      }, 15000);

      try {
        plantuml.render(code.split('\n'), containerId, { dark: isDark });
      } catch (err) {
        if (settled) return;
        settled = true;
        cleanup();
        reject(err);
      }
    });
  }

  private async renderGraphviz(code: string): Promise<string> {
    const viz = await ensureViz();
    const svgEl = viz.renderSVGElement(code);
    return new XMLSerializer().serializeToString(svgEl);
  }

  private renderFlowchart(code: string): string {
    // flowchart.ts 的 chart.draw(container, options) 对应 flowchart.js 的 drawSVG。
    // 第二个参数 DrawOptions 继承 Partial<SVGOptions>，参考官方 playground 示例
    // 传入完整样式配置，暗黑/亮色模式使用不同配色。
    //
    // 注意：flowchart.ts v3.0.1 的选项合并函数会把顶层 primitive 选项（line-color、
    // fill 等）用默认值覆盖，因此 drawOptions 里的配色不会真正生效。这里仍保留参数，
    // 并在拿到 SVG 后做主题色后处理，以保证暗黑模式下线条/文字/填充都可见。
    const isDark = this.props.theme === 'dark';
    const tempContainer = document.createElement('div');
    tempContainer.style.position = 'absolute';
    tempContainer.style.left = '-9999px';
    tempContainer.style.top = '-9999px';
    document.body.appendChild(tempContainer);

    try {
      const chart = flowchart.parse(code);
      const drawOptions = {
        'line-width': 3,
        'line-length': 50,
        'text-margin': 10,
        'font-size': 14,
        'font': 'normal',
        'font-family': 'Helvetica',
        'font-weight': 'normal',
        'font-color': isDark ? '#e0e0e0' : '#333333',
        'line-color': isDark ? '#d4d4d4' : '#333333',
        'element-color': isDark ? '#d4d4d4' : '#333333',
        'fill': isDark ? '#2d2d30' : '#ffffff',
        'yes-text': 'yes',
        'no-text': 'no',
        'arrow-end': 'block',
        'scale': 1,
      };
      chart.draw(tempContainer, drawOptions);
      let svg = tempContainer.innerHTML;
      if (isDark) {
        svg = this.applyFlowchartDarkTheme(svg);
      }
      return svg;
    } finally {
      document.body.removeChild(tempContainer);
    }
  }

  /**
   * flowchart.ts v3.0.1 的 drawOptions 合并不正确，顶层颜色选项会被默认黑白覆盖。
   * 这里对渲染出的 SVG 做后处理，把默认黑/白替换成暗黑模式配色。
   */
  private applyFlowchartDarkTheme(svgString: string): string {
    const parser = new DOMParser();
    const doc = parser.parseFromString(svgString, 'image/svg+xml');
    const svg = doc.querySelector('svg');
    if (!svg) return svgString;

    const DARK_STROKE = '#d4d4d4';
    const DARK_FILL = '#2d2d30';
    const DARK_TEXT = '#e0e0e0';

    const isBlack = (value?: string | null) =>
      !!value &&
      (value.toLowerCase() === 'black' ||
        value === '#000' ||
        value === '#000000');
    const isWhite = (value?: string | null) =>
      !!value &&
      (value.toLowerCase() === 'white' ||
        value === '#fff' ||
        value === '#ffffff');

    const replaceStyle = (
      el: Element,
      prop: string,
      newValue: string,
      match: (value: string) => boolean
    ) => {
      const attrValue = el.getAttribute(prop);
      if (attrValue && match(attrValue)) {
        el.setAttribute(prop, newValue);
        return;
      }
      const style = el.getAttribute('style');
      if (style) {
        const regex = new RegExp(`(^|;)\\s*${prop}\\s*:\\s*([^;]+)`, 'i');
        const found = style.match(regex);
        if (found && match(found[2].trim())) {
          el.setAttribute(
            'style',
            style.replace(regex, `$1${prop}: ${newValue}`)
          );
        }
      }
    };

    svg.querySelectorAll('*').forEach((el) => {
      const tag = el.tagName.toLowerCase();

      // 描边：黑色 -> 浅灰（适用于所有元素，含 use/marker/形状）
      replaceStyle(el, 'stroke', DARK_STROKE, isBlack);

      if (tag === 'text') {
        // 文字填充：黑色 -> 浅灰文字色
        replaceStyle(el, 'fill', DARK_TEXT, isBlack);
      } else {
        // 非文字元素（path/line/use/marker/rect/ellipse…）：
        //  - fill 为黑色（箭头/标记/线条填充）-> 浅灰描边色
        //  - fill 为白色（形状填充）-> 暗色背景
        // 注意：箭头由 <defs><marker><use fill="black"> 引用 <path> 实现，
        //       use 元素不在 path/line 列表内，必须在此统一处理才能命中。
        replaceStyle(el, 'fill', DARK_STROKE, isBlack);
        replaceStyle(el, 'fill', DARK_FILL, isWhite);
      }
    });

    return new XMLSerializer().serializeToString(svg);
  }

  // ── UI 渲染 ──────────────────────────────────────────────
  private renderToolbar() {
    const { readOnly, locale } = this.props;
    const { type, showEditor, showPreview, isFullscreen } = this.state;
    const types: DiagramType[] = ['mermaid', 'flowchart', 'plantuml', 'graphviz'];
    const currentTemplates = templates[type];

    return (
      <div className="text-to-diagram-toolbar">
        <div className="text-to-diagram-title">{this.t('文本绘图', 'Text Diagram')}</div>
        <div className="text-to-diagram-tools">
          <select value={type} onChange={this.handleTypeChange} disabled={readOnly}>
            {types.map((t) => (
              <option key={t} value={t}>
                {typeLabels[t][locale] || typeLabels[t]['en-US']}
              </option>
            ))}
          </select>

          <select
            value=""
            onChange={this.handleTemplateChange}
            disabled={readOnly}
            className="text-to-diagram-template-select"
          >
            <option value="">{this.t('选择模板', 'Template')}</option>
            {currentTemplates.map((tpl, idx) => (
              <option key={idx} value={idx}>
                {this.isZh ? tpl.name : tpl.nameEn}
              </option>
            ))}
          </select>

          <button
            className={showEditor ? 'active' : ''}
            onClick={this.toggleEditor}
            title={this.t('显示/隐藏编辑器', 'Show/Hide Editor')}
          >
            {this.t('代码', 'Code')}
          </button>
          <button
            className={showPreview ? 'active' : ''}
            onClick={this.togglePreview}
            title={this.t('显示/隐藏预览', 'Show/Hide Preview')}
          >
            {this.t('预览', 'Preview')}
          </button>
          <button
            onClick={this.toggleFullscreen}
            title={this.t('全屏', 'Fullscreen')}
            className={isFullscreen ? 'active' : ''}
          >
            {isFullscreen ? this.t('退出', 'Exit') : this.t('全屏', 'Fullscreen')}
          </button>
        </div>
      </div>
    );
  }

  private renderEditor() {
    const { code, showEditor } = this.state;
    if (!showEditor) return null;

    const lineCount = code.split('\n').length;
    const lines = Array.from({ length: lineCount }, (_, i) => i + 1);

    return (
      <div className="text-to-diagram-editor-panel">
        <div className="text-to-diagram-editor-wrapper">
          <div className="text-to-diagram-line-numbers" ref={this.lineNumbersRef}>
            {lines.map((n) => (
              <div key={n}>{n}</div>
            ))}
          </div>
          <textarea
            className="text-to-diagram-code"
            value={code}
            onChange={this.handleCodeChange}
            onScroll={this.handleCodeScroll}
            readOnly={this.props.readOnly}
            spellCheck={false}
          />
        </div>
      </div>
    );
  }

  private renderPreview() {
    const { showPreview, svgString, error, isRendering } = this.state;
    if (!showPreview) return null;

    let content: React.ReactNode = null;
    if (isRendering) {
      content = (
        <div className="text-to-diagram-loading">
          {this.t('渲染中...', 'Rendering...')}
        </div>
      );
    } else if (error) {
      content = <div className="text-to-diagram-error">{error}</div>;
      } else if (svgString && svgString.trimStart().startsWith('<svg')) {
        content = (
          <div
            className="text-to-diagram-preview"
            dangerouslySetInnerHTML={{ __html: svgString }}
          />
        );
      } else if (svgString) {
        content = (
          <div className="text-to-diagram-error">
            {this.t('渲染结果不是有效的 SVG', 'Render result is not valid SVG')}
          </div>
        );
      } else {
      content = (
        <div className="text-to-diagram-empty">
          {this.t('输入代码生成图表', 'Enter code to generate diagram')}
        </div>
      );
    }

    return <div className="text-to-diagram-preview-panel">{content}</div>;
  }

  render() {
    const { isFullscreen } = this.state;
    const { theme } = this.props;
    const themeClass = theme === 'dark' ? ' dark' : '';

    return (
      <div
        ref={this.fullscreenRef}
        className={`text-to-diagram${isFullscreen ? ' fullscreen' : ''}${themeClass}`}
      >
        {this.renderToolbar()}
        <div className="text-to-diagram-panels">
          {this.renderEditor()}
          {this.renderPreview()}
        </div>
      </div>
    );
  }
}

export default TextToDiagramCore;
