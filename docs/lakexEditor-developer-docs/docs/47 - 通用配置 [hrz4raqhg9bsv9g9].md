> 来源: https://www.yuque.com/yuque/developer/hrz4raqhg9bsv9g9
> 抓取: 2026-09-16 · 语雀开发者文档（本地参考副本，勿再分发）

---

在创建编辑器的时候需要传递的配置，已经带有一个开箱即用的配置，如果有修改的地方可以参考子文档进行更改。

:::success
**<font style="color:#DF2A3F;">除通用配置外</font>**

**<font style="color:#DF2A3F;">其余各插件配置：插件名</font>**<font style="color:#DF2A3F;">是配置项的一级</font>`<font style="color:#DF2A3F;">key</font>`<font style="color:#DF2A3F;">，每个插件名就是</font>**<font style="color:#DF2A3F;">文档标题</font>**<font style="color:#DF2A3F;">里的英文单词</font>

:::

# 配置方式
`createOpenEditor/createOpenViewer`第二个参数支持一个对象

```typescript
const { createOpenEditor } = window.Doc;

const editor = createOpenEditor(document.body, {
  // 通用配置
  disabledPlugins:[],
  // 插件配置，参考各插件文档，key为插件名
  image:{...},
  clipboard:{...},
})
```

## 禁用插件
`<font style="color:#BA9BF2;">disabledPlugins: Array<string></font>`

支持传入一个插件列表，列表项为插件的名称字符串。

## 标题组件
`<font style="color:#BA9BF2;">header: React.Component | React.FunctionComponent</font>`

在文档上方渲染一个组件

## 编辑器类型
`<font style="color:#BA9BF2;">uiSwitch: { default: 'simple' | 'default' | 'small' }</font>`

小窗口编辑器传入 simple 即可或者 small

## 当前页面链接
`<font style="color:#BA9BF2;">currentURL: string</font>`

输出 html 的时候一些卡片会用到

## 适配器（envAdapter）
`<font style="color:#BA9BF2;">envAdapter: null | EnvAdapter</font>`

适配器是为了满足某些交互的响应在不同的设备环境下、或者不同业务场景下需要有不同的表现的需求。编辑模式和阅读模式都有自己的适配器。

## 虚拟渲染 (1.6.0 之后支持)
`<font style="color:#BA9BF2;">virtualRendering: boolean</font>`

## 暗黑模式（1.12.0 之后支持）
`<font style="color:#BA9BF2;">darkMode: boolean</font>`

## scrollNode
`<font style="color:#BA9BF2;">scrollNode: HTMLElement| () => HTMLElement</font>`

配置滚动容器，某些默认行为需要指定正确的滚动容器才能生效。未配置 scrollNode 建议直接让编辑器固定高度。

阅读器大纲需求配置真实的滚动容器。

## boundaryTopOffset `阅读器配置`
`number`

目前会影响大纲的滚动偏移量。

