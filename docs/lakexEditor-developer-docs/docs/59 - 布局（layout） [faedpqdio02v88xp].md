> 来源: https://www.yuque.com/yuque/developer/faedpqdio02v88xp
> 抓取: 2026-09-16 · 语雀开发者文档（本地参考副本，勿再分发）

---

编辑模式和阅读模式配置项相同。

:::success
编辑器的容器需要带有样式

+ 阅读器 `ne-doc-major-viewer`
+ 编辑器 `ne-doc-major-editor`

:::

# 配置项
## layout
`<font style="color:#7E45E8;">'fixed' | 'adapt'</font>`

布局模式，默认为`adapt`

+ fixed：标宽模式，编辑器最大宽度`750px`
+ adapt：超宽模式，编辑器自适应容器宽度。



## demo
```typescript
window.onload = function () {
  const { createOpenEditor } = window.Doc;
  // 创建编辑器
  const dom = document.getElementById('root');
  // 需要确保容器包含ne-doc-major-editor
  dom.classList.add('ne-doc-major-editor');
  const editor = createOpenEditor(dom, {
    layout: 'fixed',
  });
}
```

