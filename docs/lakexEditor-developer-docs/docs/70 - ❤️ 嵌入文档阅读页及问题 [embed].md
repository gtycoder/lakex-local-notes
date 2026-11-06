> 来源: https://www.yuque.com/yuque/developer/embed
> 抓取: 2026-09-16 · 语雀开发者文档（本地参考副本，勿再分发）

---

:::color3
‼️ 受 [浏览器安全策略](https://developers.google.cn/privacy-sandbox/blog/cookie-countdown-2024jan?authuser=3&hl=zh-cn%E8%BF%99%E4%B8%AA%E6%96%87%E6%A1%A3%E5%8F%91%E7%BB%99%E7%94%A8%E6%88%B7%E4%B9%88) 影响，<font style="color:rgb(0, 0, 0);">嵌入模式只支持公开文档页，私密文档如需集成展示</font>，可通过[ API ](https://www.yuque.com/yuque/developer)获取内容。

:::

## 接口说明
语雀文档提供了嵌入式的阅读器供三方使用，可以用过 iframe 的方式把嵌入式阅读器集成到第三方的系统中去来使用语雀的展示能力，在语雀的文档页url中加上这样的参数 `view=doc_embed` 和 `from={your_appname}` 就可以得到一个纯展示功能的文档阅读器。最简单的用法请参照下面这个例子：

```plain
https://www.yuque.com/yuque/blog/digital_garden?view=doc_embed&from=asite
```

传入 `view=doc_embed` 和 `from={your_appname}` 两个参数即可启用嵌入式文档阅读器，打开之后就是 [这样](https://www.yuque.com/yuque/blog/digital_garden?view=doc_embed&from=asite) 的。

> your_appname:  无需申请，建议填写你团队/应用的英文名
>



![](https://cdn.nlark.com/yuque/0/2022/png/84145/1651208952411-3be089eb-7172-4f9b-8316-871b469e31f7.png)



**更加详细的使用方法请参照下面的表格：**

| 参数名 | 描述 | 类型 | 值 |
| --- | --- | --- | --- |
| view | 开启嵌入式文档阅读器，必传项 | 字符串 | view=doc_embed |
| from | 调用方的名字，必传项 | 字符串 | from=your_appname |
| title | 是否显示标题 | 布尔值 | title=1: 显示标题<br/>title=0：隐藏标题 |
| outline | 是否显示右侧大纲 | 布尔值 | outline=1：显示大纲<br/>outline=0：隐藏大纲 |
| translate | 根据参数进行翻译 | 字符串 | 支持多语种<br/>translate=en<br/>translate=zh |




翻译支持的语种:

| en | 英语 | English |
| --- | --- | --- |
| zh | 中文 | Chinese |
| ru | 俄罗斯语 | Russian |
| pt | 葡萄牙语 | Portuguese |
| es | 西班牙语 | Spanish |
| fr | 法语 | French |
| ja | 日语 | Japanese |
| ar | 阿拉伯语 | Arabic |
| de | 德语 | German |
| it | 意大利语 | Italian |
| ko | 韩语 | Korean |
| tr | 土耳其语 | Turkish |
| vi | 越南语 | Vietnamese |
| pl | 波兰语 | Polish |
| he | 希伯来语 | Hebrew |
| id | 印尼语 | Indonesian |
| hi | 印地语 | Hindi |
| nl | 荷兰语 | Dutch |
| th | 泰语 | Thai |




## 页面发送给父页面的消息
嵌入页面和父页面会通过 postMessage 的方式通信，目前开放了下边几种消息：

```javascript
// 高度发生变化
const heightChangeMessage = {
  type: 'doc_height_change',
  payload: {
    height: 2048,
  },
};
window.parent.postMessage(heightChangeMessage, '*');

// 文档准备好
const docReadyMessage = {
  url: document.location.href,
  type: 'doc_ready',
  payload: {
    height,
    outline: data.outline,
  },
};

// 点击大纲触发
const hashChangeMessage = {
  url: document.location.href,
  type: 'hashchange',
  message: {
    newURL,
    oldURL,
    href,
  },
};
```

在 iframe 的窗口大小发生变化时，会重触发计算高度并发送高度变化的消息。

