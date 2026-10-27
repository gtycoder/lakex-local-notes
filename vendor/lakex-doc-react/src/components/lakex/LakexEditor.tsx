import { useEffect, useRef, useState } from "react";
import Doc from "./lakex";

import type {
  LakexEditorProps,
  LakexEditorContent,
  LakexEditorContentType,
  LakexEditorConfig,
  CustomCardConfig,
  CustomCard,
} from "./types";
import GetDefaultEditorConfig from "../../configs/editor";
import SvgIcon from "./icon";
import type {TIcon} from "./icon";
import { BlockHoverHandle } from "../BlockHoverHandle";
import { ImageToolbar } from "../plugin/imageToolbar/ImageToolbar";
import { BookmarkToolbar } from "../plugin/bookmark/BookmarkToolbar";

// 块操作菜单的辅助函数（selectBlockInEditor / runNativeConvert / copyDomBlock / copyText）
// 已迁移至 BlockHoverHandle/blockMenuHelpers，与菜单逻辑一并收敛到 BlockHoverHandle 文件夹。

function mergeConfig(
  defaults: LakexEditorConfig,
  user: Partial<LakexEditorConfig> | undefined
): LakexEditorConfig {
  if (!user) return defaults;
  const result: any = { ...defaults };
  for (const key of Object.keys(user) as (keyof LakexEditorConfig)[]) {
    const v = (user as any)[key];
    const dv = (result as any)[key];
    if (
      key === "customCard" &&
      v &&
      dv &&
      typeof v === "object" &&
      typeof dv === "object"
    ) {
      // 自定义卡片默认包含 mindMapCardConfig，用户新增 cards 时做追加
      result[key] = {
        ...dv,
        ...v,
        cards: [...(dv.cards || []), ...(v.cards || [])],
      };
    } else if (
      v &&
      typeof v === "object" &&
      !Array.isArray(v) &&
      dv &&
      typeof dv === "object" &&
      !Array.isArray(dv)
    ) {
      result[key] = { ...dv, ...v };
    } else {
      result[key] = v;
    }
  }
  return result;
}

export function LakexEditor(props: LakexEditorProps) {
  const containerRef = useRef<any>(null);
  const editorRef = useRef<any>(null);
  // editor 实例的 state 镜像：用于触发悬浮手柄 / 菜单的挂载与重渲染
  // （仅用 ref 不会触发渲染，会导致 BlockHoverHandle 永不挂载）
  const [editorInstance, setEditorInstance] = useState<any>(null);
  // 块悬浮手柄与右键菜单（状态/点击事件/动作执行/卡片选择）已整体封装进
  // BlockHoverHandle 组件（BlockHoverHandle 文件夹），这里只引用该组件。

  useEffect(() => {
    createEditor(props.content);
    return () => {
      if (editorRef.current) {
        editorRef.current.destroy();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const ed = editorRef.current;
    if (!ed) return;
    Doc.FrameworkInfra.Locale.setLanguage(props.language)
    const content = ed.getDocument("text/lake")
    ed.destroy()
    createEditor({type: 'text/lake', text: content})
  }, [props.dark, props.language]);

  useEffect(() => {
    const ed = editorRef.current;
    if (ed) {
      ed.destroy()
    }
    createEditor(props.content)
  }, [props.id]);

  const converCardConfig = (c: CustomCard): CustomCardConfig => {
    let slashLabel = c.config.slash.label
    let slashDesc = c.config.slash.description
    if (typeof slashLabel === 'function') {
      const lbs = slashLabel()
      slashLabel = props.language === 'en-us' ? lbs.enUS : lbs.zhCN
    }
    if (typeof slashDesc === "function") {
      const ds = slashDesc()
      slashDesc = props.language === 'en-us' ? ds.enUS : ds.zhCN;
    }
    return {
      ...c.config,
      slash: {
        ...c.config.slash,
        label: slashLabel,
        description: slashDesc,
      }
    }
  }

  const createEditor = (content?: LakexEditorContent) => {
    if (!containerRef.current) return;

    const { createOpenEditor } = Doc;
    const defaultConfig = GetDefaultEditorConfig(props.language)

    const propsConfigs = props.config ? {
      ...props.config,
      
      customCard: {
          cards: props.config.customCard?.cards.map((c) => converCardConfig(c)) as any,
      }
    } : {}
    const merged = props.disableMergeConfig ? propsConfigs : mergeConfig(
      {
        ...defaultConfig,
        placeholder: {
          tip: props.language === 'en-us' ? 'Type text...' : '开始写作...',
          emptyParagraphTip: props.language === 'en-us' ? 'Type / evoke more': '输入 / 唤起更多',
        },
        customCard: {
          cards: defaultConfig.customCard.cards.map((c) => converCardConfig(c)) as any,
        },
      },
      propsConfigs
    );

    const {
      drawingBoardAI,
      ...nativeEditorConfig
    } = merged as LakexEditorConfig;
    const editor = createOpenEditor(containerRef.current, {
      ...nativeEditorConfig,
      // bookmark 配置已写入默认配置（src/configs/editor.ts），
      // 业务侧可通过 props.config.bookmark 覆盖（detailAction / fetchDetailHandler / pasteLinkConvert）。
      darkMode: props.dark ? true : false,
    });

    // `drawingBoardAI` is a React adapter capability rather than a native
    // Lakex plugin option. Keep it on the editor instance so every drawing
    // card can use the correct service in multi-editor pages.
    editor.__lakexDrawingBoardAI = drawingBoardAI;

    // 设置内容
    if (content) {
      editor.setDocument(content.type, content.text);
    } else {
      editor.setDocument("text/lake", "<p></p>");
    }

    // 监听内容变动
    editor.on("contentchange", () => {
      if (props.onContentChange) {
        const cts: LakexEditorContent[] = [];
        const tp: LakexEditorContentType[] = [
          "text/lake",
          "text/html",
          "text/plain",
          "text/markdown",
          "json",
        ];
        tp.forEach((t) => {
          cts.push({
            type: t,
            text: editor.getDocument(t),
          });
        });
        props.onContentChange(cts);
      }
    });

    editorRef.current = editor;
    setEditorInstance(editor);
  };

  const getIcons = (): TIcon[] => {
    let icons: TIcon[] = []
    if (defaultConfig.customCard && !props.disableMergeConfig) {
      icons = defaultConfig.customCard.cards.filter(c => c.icon).map((c) => c.icon)
    }
    if (props.config?.customCard) {
      icons.push(...props.config.customCard.cards.filter(c => c.icon).map(c => c.icon))
    }
    return icons;
  }

  const defaultConfig = GetDefaultEditorConfig(props.language)
  
  return (
    <>
    <SvgIcon icons={getIcons()} />
    
    <div ref={containerRef} style={{width: '100%', height: '100%', position: 'relative'}}></div>
    <div className={props.dark ? 'lakex-dark-theme ne-typography-classic':'lakex-default-theme ne-typography-classic'}>
    
    {/* 块悬浮拖拽手柄（含右键上下文菜单，逻辑封装在 BlockHoverHandle 文件夹） */}
    {props.blockMenu !== false && editorInstance && (
      <BlockHoverHandle
        containerRef={containerRef}
        editor={editorInstance}
        language={props.language || 'zh-cn'}
        dark={props.dark}
        heading={props.config?.heading}
        onBlockAction={props.onBlockAction}
      />
    )}

    {/* 图片卡片浮动操作栏（点击/悬浮图片时显示在图片正上方） */}
    {editorInstance && (
      <ImageToolbar
        containerRef={containerRef}
        editor={editorInstance}
        language={props.language || 'zh-cn'}
        dark={props.dark}
      />
    )}

    {/* 书签卡片浮动操作栏（点击/悬浮书签时显示在卡片正上方，模式同 ImageToolbar） */}
    {editorInstance && (
      <BookmarkToolbar
        containerRef={containerRef}
        editor={editorInstance}
        language={props.language || 'zh-cn'}
        dark={props.dark}
      />
    )}
    </div>
    </>
  )
}
