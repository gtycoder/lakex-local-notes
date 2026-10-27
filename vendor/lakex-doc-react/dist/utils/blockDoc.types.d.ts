export interface LakexEditorInstance {
    getDocument?: (type: string) => string | any;
    setDocument?: (type: string, text: string | any) => void;
    execCommand?: (...args: any[]) => any;
    view?: any;
    _view?: any;
    [key: string]: any;
}
