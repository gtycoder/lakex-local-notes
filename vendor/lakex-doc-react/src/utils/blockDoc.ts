// 通过 Lakex 的 `json` 文档树操作块节点。
//
// Lakex 的真实 JSON 输出使用 DOM-like 结构：
//   { type: 'element', name: 'p', id, attrs: {}, children: [...] }
//   { type: 'text', name: '#text', id, attrs: {}, data: '...' }
//
// 文档也可能由用户以简写结构传入：
//   { type: 'p', children: [{ text: '...' }] }
//
// 下面的操作优先保持读到的结构风格，避免把 `type: "element"` 错改为
// `type: "h1"` 后又被 Lakex 解析回段落。

import type { LakexEditorInstance } from './blockDoc.types';

const DOC_FORMAT = 'json';

type NodeLocation = {
  node: any;
  parentArray: any[];
  parentNode: any | null;
  index: number;
};

function getChildArray(node: any): any[] | null {
  if (!node || typeof node !== 'object') return null;
  if (Array.isArray(node.children)) return node.children;
  if (Array.isArray(node.content)) return node.content;
  return null;
}

function getNodeName(node: any): string {
  if (!node || typeof node !== 'object') return '';
  if (node.type === 'element' || node.type === 'card') return String(node.name || '');
  return String(node.type || '');
}

function findNodeAndParent(root: any, id: string): NodeLocation | null {
  const roots = getChildArray(root) ?? (Array.isArray(root) ? root : []);

  const search = (arr: any[], parentNode: any | null): NodeLocation | null => {
    for (let index = 0; index < arr.length; index += 1) {
      const node = arr[index];
      if (node && typeof node === 'object' && node.id === id) {
        return { node, parentArray: arr, parentNode, index };
      }
      const children = getChildArray(node);
      if (children) {
        const found = search(children, node);
        if (found) return found;
      }
    }
    return null;
  };

  return search(roots, root);
}

function isAncestor(node: any, descendantId: string): boolean {
  const children = getChildArray(node);
  if (!children) return false;
  return children.some((child) => (
    child?.id === descendantId || isAncestor(child, descendantId)
  ));
}

function genId(): string {
  return `u${Math.random().toString(16).slice(2, 10)}`;
}

function regenerateIds(node: any): void {
  if (!node || typeof node !== 'object') return;
  if ('id' in node) node.id = genId();
  const children = getChildArray(node);
  children?.forEach(regenerateIds);
}

function isDomLikeDocument(doc: any): boolean {
  return doc?.type === 'element' || getChildArray(doc)?.some((node) => node?.type === 'element');
}

function createTextNode(domLike: boolean, text = ''): any {
  if (!domLike) return { text };
  return {
    type: 'text',
    id: genId(),
    name: '#text',
    attrs: {},
    data: text,
  };
}

function createElementNode(
  name: string,
  domLike: boolean,
  children: any[] = [],
  attrs: Record<string, unknown> = {},
): any {
  if (!domLike) return { type: name, id: genId(), attrs, children };
  return {
    type: 'element',
    id: genId(),
    name,
    attrs,
    children,
  };
}

function createBlockNode(name: string, domLike: boolean): any {
  if (name === 'hr') {
    return createElementNode('hr', domLike);
  }

  if (name === 'quote' || name === 'blockquote') {
    const paragraph = createElementNode('p', domLike, [createTextNode(domLike)]);
    return createElementNode(domLike ? 'quote' : 'blockquote', domLike, [paragraph]);
  }

  if (name === 'codeblock') {
    return createElementNode(
      'codeblock',
      domLike,
      [createTextNode(domLike)],
      { language: 'plain', customStyle: false },
    );
  }

  // 菜单只直接新增安全的文本块。未知类型仍按普通元素创建，交给
  // Lakex 自身的 JSON 解析器规范化。
  return createElementNode(name, domLike, [createTextNode(domLike)]);
}

function cloneNode<T>(node: T): T {
  return JSON.parse(JSON.stringify(node));
}

function findDescendantByName(node: any, name: string): any | null {
  if (getNodeName(node) === name) return node;
  const children = getChildArray(node);
  if (!children) return null;
  for (const child of children) {
    const found = findDescendantByName(child, name);
    if (found) return found;
  }
  return null;
}

function getLogicalBlockName(node: any): string {
  const name = getNodeName(node);
  if (name === 'oli') return 'ol';
  if (name === 'uli') return 'ul';
  if (name === 'tli') return 'taskList';
  if (name === 'quote' || name === 'blockquote') return 'quote';
  if (name === 'alert' || name === 'alertHole' || findDescendantByName(node, 'alert')) {
    return 'callout';
  }
  if (name === 'codeblock' || findDescendantByName(node, 'codeblock')) return 'codeblock';
  if (name === 'columns' || findDescendantByName(node, 'columns')) return 'columns';
  if (name === 'collapse' || findDescendantByName(node, 'collapse')) return 'collapse';
  return name;
}

function collectInlineTextNodes(node: any, domLike: boolean, output: any[]): void {
  if (!node || typeof node !== 'object') return;

  if (domLike && node.type === 'text') {
    output.push(cloneNode(node));
    return;
  }
  if (!domLike && typeof node.text === 'string') {
    output.push(cloneNode(node));
    return;
  }

  const children = getChildArray(node);
  children?.forEach((child) => collectInlineTextNodes(child, domLike, output));
}

function getSourceInlineContent(node: any, domLike: boolean): any[] {
  const output: any[] = [];
  collectInlineTextNodes(node, domLike, output);

  if (output.length > 0) return output;

  const codeNode = getLogicalBlockName(node) === 'codeblock'
    ? findDescendantByName(node, 'codeblock')
    : null;
  const code = codeNode?.attrs?.value?.code ?? node?.attrs?.value?.code;
  if (typeof code === 'string') return [createTextNode(domLike, code)];
  return [createTextNode(domLike)];
}

function getInlinePlainText(children: any[]): string {
  return children.map((child) => (
    child?.type === 'text' ? String(child.data || '') : String(child?.text || '')
  )).join('');
}

function createTextBlock(
  name: string,
  domLike: boolean,
  inlineChildren: any[],
  attrs: Record<string, unknown> = {},
): any {
  return createElementNode(name, domLike, inlineChildren.map(cloneNode), attrs);
}

function createConvertedBlock(
  targetName: string,
  domLike: boolean,
  inlineChildren: any[],
): any | null {
  if (/^(p|h[1-6])$/.test(targetName)) {
    return createTextBlock(targetName, domLike, inlineChildren);
  }

  const listTarget: Record<string, string> = {
    ol: 'oli',
    ul: 'uli',
    taskList: 'tli',
  };
  if (listTarget[targetName]) {
    return createTextBlock(listTarget[targetName], domLike, inlineChildren, {
      level: 0,
      start: 0,
      index: 0,
      indexType: 0,
      ...(targetName === 'taskList' ? { checked: false } : {}),
    });
  }

  if (targetName === 'quote') {
    const paragraph = createTextBlock('p', domLike, inlineChildren);
    return createElementNode(domLike ? 'quote' : 'blockquote', domLike, [paragraph]);
  }

  if (targetName === 'callout') {
    const paragraph = createTextBlock('p', domLike, inlineChildren);
    const alert = createElementNode('alert', domLike, [paragraph], { type: 'info' });
    return createElementNode('alertHole', domLike, [alert]);
  }

  if (targetName === 'columns') {
    const firstParagraph = createTextBlock('p', domLike, inlineChildren);
    const secondParagraph = createTextBlock('p', domLike, [createTextNode(domLike)]);
    const columns = createElementNode('columns', domLike, [
      createElementNode('column', domLike, [firstParagraph], { width: 0.5 }),
      createElementNode('column', domLike, [secondParagraph], { width: 0.5 }),
    ]);
    return createElementNode('containerHole', domLike, [columns]);
  }

  if (targetName === 'collapse') {
    const summary = createTextBlock('summary', domLike, inlineChildren);
    const body = createTextBlock('p', domLike, [createTextNode(domLike)]);
    const collapse = createElementNode('collapse', domLike, [summary, body], { open: 'true' });
    return createElementNode('containerHole', domLike, [collapse]);
  }

  if (targetName === 'codeblock') {
    const code = getInlinePlainText(inlineChildren);
    if (!domLike) {
      return createElementNode(
        'codeblock',
        false,
        [createTextNode(false, code)],
        { language: 'plain', customStyle: false },
      );
    }
    return createElementNode('codeblock', true, [], {
      value: {
        code,
        mode: 'plain',
        theme: 'Github Light',
      },
    });
  }

  return null;
}

export function readBlockDocument(editor: LakexEditorInstance): any | null {
  try {
    const raw = editor?.getDocument?.(DOC_FORMAT);
    if (raw == null) return null;
    return typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch {
    return null;
  }
}

export function writeBlockDocument(editor: LakexEditorInstance, doc: any): boolean {
  try {
    const value = typeof doc === 'string' ? doc : JSON.stringify(doc);
    editor?.setDocument?.(DOC_FORMAT, value);
    editor?.execCommand?.('focus', { preventScroll: true });
    return true;
  } catch {
    return false;
  }
}

export function moveBlock(
  editor: LakexEditorInstance,
  sourceId: string,
  targetId: string,
  insertAfter: boolean,
): boolean {
  if (!sourceId || !targetId || sourceId === targetId) return false;

  const doc = readBlockDocument(editor);
  if (!doc) return false;

  const source = findNodeAndParent(doc, sourceId);
  const target = findNodeAndParent(doc, targetId);
  if (!source || !target || isAncestor(source.node, targetId)) return false;

  source.parentArray.splice(source.index, 1);
  const relocatedTarget = findNodeAndParent(doc, targetId);
  if (!relocatedTarget) {
    source.parentArray.splice(source.index, 0, source.node);
    return false;
  }

  const insertionIndex = insertAfter
    ? relocatedTarget.index + 1
    : relocatedTarget.index;
  relocatedTarget.parentArray.splice(insertionIndex, 0, source.node);
  return writeBlockDocument(editor, doc);
}

export function deleteBlock(editor: LakexEditorInstance, id: string): boolean {
  const doc = readBlockDocument(editor);
  if (!doc) return false;

  const found = findNodeAndParent(doc, id);
  if (!found) return false;
  found.parentArray.splice(found.index, 1);

  // Lakex 需要至少一个可编辑块。删除最后一块时自动补一个空段落。
  if (found.parentNode === doc && found.parentArray.length === 0) {
    found.parentArray.push(createBlockNode('p', isDomLikeDocument(doc)));
  }

  return writeBlockDocument(editor, doc);
}

export function duplicateBlock(
  editor: LakexEditorInstance,
  id: string,
  insertAfter = true,
): boolean {
  const doc = readBlockDocument(editor);
  if (!doc) return false;

  const found = findNodeAndParent(doc, id);
  if (!found) return false;

  const clone = JSON.parse(JSON.stringify(found.node));
  regenerateIds(clone);
  found.parentArray.splice(insertAfter ? found.index + 1 : found.index, 0, clone);
  return writeBlockDocument(editor, doc);
}

export function convertBlock(
  editor: LakexEditorInstance,
  id: string,
  targetName: string,
): boolean {
  const doc = readBlockDocument(editor);
  if (!doc) return false;

  const found = findNodeAndParent(doc, id);
  if (!found) return false;

  if (getLogicalBlockName(found.node) === targetName) return true;

  const domLike = isDomLikeDocument(doc);
  const inlineChildren = getSourceInlineContent(found.node, domLike);
  const replacement = createConvertedBlock(targetName, domLike, inlineChildren);
  if (!replacement) return false;

  // 用结构完整的新块替换源块，避免 quote/alert/containerHole 相互转换时
  // 把新组件嵌进旧容器。保留根 id，便于 Lakex 重建 DOM 后维持块标识。
  replacement.id = found.node.id || replacement.id;
  found.parentArray[found.index] = replacement;
  return writeBlockDocument(editor, doc);
}

export function insertBlock(
  editor: LakexEditorInstance,
  referenceId: string,
  position: 'before' | 'after',
  newName: string,
): boolean {
  const doc = readBlockDocument(editor);
  if (!doc) return false;

  const found = findNodeAndParent(doc, referenceId);
  if (!found) return false;

  const newNode = createBlockNode(newName, isDomLikeDocument(doc));
  found.parentArray.splice(position === 'after' ? found.index + 1 : found.index, 0, newNode);
  return writeBlockDocument(editor, doc);
}
