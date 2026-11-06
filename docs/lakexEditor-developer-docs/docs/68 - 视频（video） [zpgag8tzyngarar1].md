> 来源: https://www.yuque.com/yuque/developer/zpgag8tzyngarar1
> 抓取: 2026-09-16 · 语雀开发者文档（本地参考副本，勿再分发）

---

## <font style="background:#F8CED3;color:#70000D">1.30.0</font>自定义组件
支持自定义组件配置，包含上传中、上传成功、上传失败三种状态的自定义组件。

## accept
`<font style="color:#7E45E8;">Nullable<string[]></font>`

配置可以接受的后缀名

## uploadFileURL
`<font style="color:#7E45E8;">Nullable<string></font>`

默认上传的URL，如果未配置`createUploadTask`，则会使用该url进行上传

| **请求方式** | `POST` |
| :---: | --- |
| **请求值** | `FormData`，具有字段`file`，类型为`File` |
| **响应值** | ```json {   "data": {     "url": "视频远程地址",     "size": "视频体积",     "filename": "视频名称" 	} } ```  |


## createUploadPromise
`<font style="color:#7E45E8;">Nullable<(data: File) => Promise<{url: string; size: number; filename: string;}>></font>`

简化版本的上传逻辑

```typescript
createOpenEditor(document.body, {
  video: {
    // 自定义上传逻辑
    createUploadPromise: file => {
      return Promise.resolve({
        url: URL.createObjectURL(file),
        size: file.size,
        filename: file.name,
      })
    },
  },
});
```

## crawlVideo
`<font style="color:#7E45E8;">Nullable<(src: string) => Promise<{url: string; size: number; filename: string;}>></font>`

视频转存。对老版本的lake数据和html数据的读取，**对阅读器不生效**。

## useOriginSrc
`<font style="color:#7E45E8;">(src: string) => boolean</font>`

是否使用原始资源地址。和`crawlVideo`配置类似，如果**不需要转存**可以仅配置该项。

