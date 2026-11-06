> 来源: https://www.yuque.com/yuque/developer/qh43l8i71b2m7bky
> 抓取: 2026-09-16 · 语雀开发者文档（本地参考副本，勿再分发）

---

链接跳转的逻辑并没有内置在编辑器内，![](https://cdn.nlark.com/yuque/0/2024/png/525935/1722477198579-8437e056-a0b0-4b8b-aa68-501a1a37bdcc.png)按钮点击默认没有跳转行为。请参考EnvAdapter进行配置：[适配器（envAdapter）](https://www.yuque.com/yuque/developer/ggspapip2fvgao1w)

# 阅读模式配置项
## vMiniToolbar
`<font style="color:#7E45E8;">(node: VLinkElement) => VLinkMiniToolbarItem[]</font>`

配置鼠标hover的情景工具栏。

![](https://cdn.nlark.com/yuque/0/2024/png/525935/1722477198548-1c70055d-2d44-405b-8106-ed7b2eac777b.png)

入参为当前hover的link元素。返回值类型如下：

```typescript
export type VLinkMiniToolbarItem = {
  tooltip: string;
  icon: React.ReactNode | string;
  onClick: (node: VBoxNode) => void;
};
```

