import React from "react";
import { renderToString } from "react-dom/server";
import { Doc, DefaultEditorConfig } from "lakex-editor-react-component";
import { uploadLakeResource } from "./resourceUpload";
import { BoardCard } from "./BoardCard";

export interface LakeEditorInstance {
  setDocument(type: "text/lake", content: string): void;
  getDocument(type: "text/lake"): string;
  on(event: string, listener: () => void): void;
  off?: (event: string, listener: () => void) => void;
  destroy?: () => void;
  destory?: () => void;
}

/** Deep merge: defaults ← overrides */
function deepMerge(base: Record<string, unknown>, overrides: Record<string, unknown>): Record<string, unknown> {
  const result = { ...base };
  for (const key of Object.keys(overrides)) {
    const ov = overrides[key];
    const bv = result[key];
    if (key === "customCard" && ov && typeof ov === "object" && !Array.isArray(ov) && bv && typeof bv === "object" && !Array.isArray(bv)) {
      const bo = bv as Record<string, unknown>;
      const oo = ov as Record<string, unknown>;
      result[key] = {
        ...bo,
        ...oo,
        cards: [...((bo.cards as unknown[]) || []), ...((oo.cards as unknown[]) || [])],
      };
    } else if (ov && typeof ov === "object" && !Array.isArray(ov) && bv && typeof bv === "object" && !Array.isArray(bv)) {
      result[key] = deepMerge(bv as Record<string, unknown>, ov as Record<string, unknown>);
    } else {
      result[key] = ov;
    }
  }
  return result;
}

/**
 * Prepare customCard cards for Doc.createOpenEditor().
 * LakexEditor's i() spreads card.config to top level and resolves
 * slash label/description from () => ({zhCN, enUS}) to strings.
 * Without this, registerCard() reads e.name as undefined.
 */
function prepareCustomCards(config: Record<string, unknown>): void {
  const cc = config.customCard as { cards?: unknown[] } | undefined;
  if (!cc?.cards) return;
  cc.cards = cc.cards.map((card: any) => {
    if (!card.config) return card;
    const cfg = card.config;
    const slash = { ...cfg.slash };
    if (typeof slash.label === "function") {
      const r = slash.label();
      slash.label = r.zhCN;
    }
    if (typeof slash.description === "function") {
      const r = slash.description();
      slash.description = r.zhCN;
    }
    return { ...cfg, slash };
  });
}

/** Render customCard icon SVG symbols into document.body */
function ensureCustomCardIcons(config: Record<string, unknown>): void {
  const SPRITE_ID = "icon-lakexui-custom-cards";
  if (document.getElementById(SPRITE_ID)) return;
  const cc = config.customCard as { cards?: Array<Record<string, unknown>> } | undefined;
  if (!cc?.cards) return;
  const icons = cc.cards
    .filter((c) => c.icon)
    .map((c) => renderToString(React.createElement(c.icon as React.ComponentType)));
  if (icons.length === 0) return;
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.id = SPRITE_ID;
  svg.setAttribute("aria-hidden", "true");
  svg.style.cssText = "position:absolute;width:0;height:0;overflow:hidden";
  svg.innerHTML = icons.join("");
  document.body.prepend(svg);
}

export function createLakeDocument(element: HTMLElement, mode: "viewer" | "editor", onChange: () => void, tocEnabled: boolean, noteId: string): LakeEditorInstance {
  const mount = document.createElement("div");
  mount.className = "lake-editor-mount ne-doc-major-editor";
  element.replaceChildren(mount);

  const customOptions: Record<string, unknown> = {
    disabledPlugins: mode === "viewer" ? ["save", "toolbar", "emoji"] : ["save", "emoji"],
    input: {},
    defaultFontsize: 18,
    toc: { enable: tocEnabled },
    codeblock: { codemirrorURL: "./vendor/lakex-doc/codemirror.js" },
    math: { KaTexURL: ["./vendor/lakex-doc/katex.min.js", "https://gw.alipayobjects.com/os/lib/katex/0.16.8/dist/contrib/mhchem.min.js"] },
    image: {
      createUploadPromise: (request: unknown) => uploadLakeResource(request, noteId),
      // 本地资源服务器 URL 必须排除，否则 Lake 每次 setDocument 都会重新下载并上传本地图片
      isCaptureImageURL: (url: string) => !url.startsWith("data:") && !url.startsWith("blob:") && !url.startsWith("http://127.0.0.1:19876/"),
    },
    file: {
      createUploadPromise: (request: unknown) => uploadLakeResource(request, noteId),
    },
    slash: {
      cardSelect: {
        general: {
          groups: (() => {
            const groups = (DefaultEditorConfig as any).slash?.cardSelect?.general?.groups?.filter(
              (g: any) => g.name !== "third-party-services"
            ) || [];
            for (const g of groups) {
              if (g.title === "程序员" || g.name === "developer") {
                if (!g.items.includes("custom-board-card")) { g.items = [...(g.items || []), "custom-board-card"]; }
                break;
              }
            }
            return groups;
          })(),
        },
        table: {
          groups: (DefaultEditorConfig as any).slash?.cardSelect?.table?.groups?.filter(
            (g: any) => g.name !== "third-party-services"
          ) || [],
        },
      },
    },
    customCard: { cards: [BoardCard] },
  };

  const mergedOptions = deepMerge(
    DefaultEditorConfig as Record<string, unknown>,
    customOptions
  );

  prepareCustomCards(mergedOptions);
  ensureCustomCardIcons(mergedOptions);

  const editor = mode === "viewer"
    ? (Doc as any).createOpenViewer(mount, mergedOptions)
    : (Doc as any).createOpenEditor(mount, mergedOptions);
  if (mode === "editor") editor.on("contentchange", onChange);
  return editor;
}

export function destroyLakeEditor(editor: LakeEditorInstance | null): void {
  try {
    editor?.destroy?.();
    if (!editor?.destroy) editor?.destory?.();
  } catch (error) {
    console.warn("Lake editor cleanup failed", error);
  }
}
