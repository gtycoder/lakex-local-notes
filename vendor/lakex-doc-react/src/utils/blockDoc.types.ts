// src/utils/blockDoc.types.ts
// 编辑器实例的最小类型（与 lakex 的松散 any 兼容）

export interface LakexEditorInstance {
  getDocument?: (type: string) => string | any;
  setDocument?: (type: string, text: string | any) => void;
  execCommand?: (...args: any[]) => any;
  view?: any;
  _view?: any;
  [key: string]: any;
}
