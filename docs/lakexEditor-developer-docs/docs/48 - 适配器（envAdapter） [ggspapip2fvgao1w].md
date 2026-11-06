> 来源: https://www.yuque.com/yuque/developer/ggspapip2fvgao1w
> 抓取: 2026-09-16 · 语雀开发者文档（本地参考副本，勿再分发）

---

适配器是为了满足某些交互的响应在不同的设备环境下、或者不同业务场景下需要有不同的表现的需求。编辑模式和阅读模式都有自己的适配器。

# 原理
用户如果触发了编辑器节点上的DOMUI事件，编辑器会根据当前用户行为向外抛出事件，在阅读模式下事件通过`viewer`抛出，编辑模式下则通过`editor`抛出。`EnvAdapter`在被初始化时会去监听这些事件从而调用对应的方法。

# 阅读模式适配器
阅读模式支持下面几种交互自定义

| **方法** | **参数及类型** | **方法描述** |
| --- | --- | --- |
| `**openLink**`(url: string, isExternal: boolean) | `url: string`<br/> 链接URL   `isExternal: boolean`<br/> 是否要在新窗口中打开 | 打开链接。可以在打开链接前执行一些安全策略。 |
| `**openMentionLink**`(url: string, isExternal: boolean) | `url: string`<br/> 链接 URL   `isExternal`<br/> 是否是在新窗口中打开 | 打开提及人的链接 |
| `**previewImgs**`(imgs: IPreviewImgInfo[], index: number) | `{Array<{src:string; msrc:string; w:number; h:number}>}`<br/> 图片信息数组   `{number}`<br/> index 索引 | 预览图片，会获取到文档内所有图片，可以在此实现图片查看器。`src`为图片原始地址，`msrc`为图片压缩图地址。用户点击图片会触发该方法执行。 |
| `**longPressCard**`(params: Record<string, unknown>) | `{object}`<br/> params 参数，不同卡片长按可能需要不同的参数，业务自行约定 | 卡片长按事件。提供给移动端使用。入参需要自定义，可以参考[editUI和viewerUI](https://yuque.antfin-inc.com/lark/laphzd/vh3vxs011i3kbged)实现一个UI，然后在UI中通过`this.viewer.emitEvent('longPressCard', args);`传递参数、触发该方法的执行。 |


# 编辑模式适配器
编辑模式支持下面几种交互自定义

| **方法** | **参数及类型** | **方法描述** |
| --- | --- | --- |
| `**openLink**`(url: string, isExternal: boolean) | `url: string`<br/> 链接URL   `isExternal: boolean`<br/> 是否要在新窗口中打开 | 打开超链接 |
| `**openMentionLink**`(url: string, isExternal: boolean) | `url: string`<br/> 链接 URL   `isExternal`<br/> 是否是在新窗口中打开 | 打开 mention 链接 |
| `**openLocalLink**`(url: string) | `url: string`<br/> 链接 URL | 在本地打开链接 |
| `**openBookmarkLink**`(url: string) | `url: string`<br/> 书签链接 URL | 打开书签链接 |
| `**openThirdpartyLink**`(url: string) | `url: string`<br/> 三方服务链接 URL | 打开三方服务链接 |
| `**previewImgs**`(imgs: Array<{src:string; msrc:string; w:number; h:number; layoutSlef?:() => void;size?:number}>, index: number) | `imgs`<br/> 图片信息的数组   `index`<br/> 当前打开的图片在数组中的索引 | 预览图片 |
| `**longPressCard**`(params: any) | `{object}`<br/> params 参数，不同卡片长按可能需要不同的参数，业务自行约定 | 卡片长按事件处理 |


# demo
```javascript
window.onload = function () {
  const { createOpenEditor } = window.Doc;
  // 创建编辑器
  const editor = createOpenEditor(document.getElementById('root'), {
    envAdapter: {
      openLink: (url, isExternal) => {
        console.info(url, isExternal);
        window.open(url, isExternal ? '__blank': '__self');
      }
    },
  });
}
```

