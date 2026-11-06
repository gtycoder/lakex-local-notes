> 来源: https://www.yuque.com/yuque/developer/xq5sqnuoi4ubc27w
> 抓取: 2026-09-16 · 语雀开发者文档（本地参考副本，勿再分发）

---

大纲会出现在编辑器/阅读器右侧，默认不开启。

# 编辑模式配置项
## enable
`<font style="color:#7E45E8;">boolean</font>`

是否开启，默认为false。

## normalView
`<font style="color:#7E45E8;">boolean</font>`

是否为展开状态，默认为true。不过需要注意的是，大纲在用户手动执行过展开或收起的操作后，会将当前状态保存在localstorage里，这种情况下会优先采用用户的上次行为而不是该配置项。

## allowModifyHash
`<font style="color:#7E45E8;">boolean</font>`

大纲被点击后是否允许改变 hash，默认为true。

# 阅读模式配置项
## enable
`<font style="color:#7E45E8;">boolean</font>`

是否开启，默认为false。

## allowModifyHash
`<font style="color:#7E45E8;">boolean</font>`

大纲被点击后是否允许改变 hash，默认为true。

## getContainer
`<font style="color:#7E45E8;">(() => HTMLElement) | null</font>`

指定挂载的TOC节点。

# 常见问题
## 编辑模式下大纲没有展示出来
执行`editor.setDocument`的时候要异步一下，可以包在`setTimeout`回调内。

