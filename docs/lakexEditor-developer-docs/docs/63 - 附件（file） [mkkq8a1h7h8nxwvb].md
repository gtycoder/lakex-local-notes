> 来源: https://www.yuque.com/yuque/developer/mkkq8a1h7h8nxwvb
> 抓取: 2026-09-16 · 语雀开发者文档（本地参考副本，勿再分发）

---

# 编辑模式配置项
## getFileDownloadURL
`<font style="color:#7E45E8;">Nullable<(src: string) => string></font>`

获取文件下载的链接，入参为文件远程保存的地址，返回值为文件下载链接地址

## getPreviewUrl
`<font style="color:#7E45E8;">Nullable<(src: string) => string></font>`

获取文件预览地址，入参为文件远程保存的地址，返回值为文件预览地址

## uploadFileURL
`<font style="color:#7E45E8;">string</font>`

文件上传地址，接口要求如下

| **请求方式** | `POST` |
| :---: | --- |
| **请求值** | `FormData`，具有字段`file`，类型为`File` |
| **响应值** | ```json {   "data": {     "url": "附件远程地址",     "size": "附件体积",     "filename": "附件名",     "extname": "附件扩展", 	} } ```  |


## createUploadPromise<font style="background:#F8CED3;color:#70000D">新</font>
`<font style="color:#7E45E8;">Nullable<(file: File) => Promise<{url:string; size:number; filename:string}>></font>`

自定义上传任务方法。

## canDownload
`<font style="color:#7E45E8;">(cardData: FileCardData) => boolean</font>`

是否允许下载

## canPreview
`<font style="color:#7E45E8;">(cardData: FileCardData) => boolean</font>`

是否允许预览

# 阅读模式配置项
## viewerTooltip
`<font style="color:#7E45E8;">(ui: IViewerCardUI<VLocalDocCardNode> | IViewerCardUI<VFileCardNode>)=>React.ReactNode</font>`

阅读态的卡片tooltip，鼠标hover到卡片节点能展示自定义react组件。

## canDownload
`<font style="color:#7E45E8;">(cardData: FileCardData) => boolean</font>`

是否允许下载

## canPreview
`<font style="color:#7E45E8;">(cardData: FileCardData) => boolean</font>`

是否允许预览

## onViewerInlineFileClick<font style="background:#F8CED3;color:#70000D">1.5.0</font>
`<font style="color:#7E45E8;">(e: MouseEvent, ui: IViewerCardUI<VFileCardNode>) => void</font>`

行内附件节点的点击会调用该方法，可以在这个方法里实现下载逻辑。

