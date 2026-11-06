> 来源: https://www.yuque.com/yuque/developer/xtks4cc7gqmvgrun
> 抓取: 2026-09-16 · 语雀开发者文档（本地参考副本，勿再分发）

---

![](https://cdn.nlark.com/yuque/0/2024/png/525935/1710404063817-ef17e02e-d3e9-48a9-bbae-0369e7b63b17.png)

仅支持编辑模式。

# 编辑模式配置项
可以只传一个字符串，如

```typescript
const option = {
  placeholder: "请输入文字"
};
```

也支持配置一个对象

## tip
`<font style="color:#7E45E8;">string</font>`

编辑器空内容时展示的提示文案。配置效果等价于直接配置一个字符串。

## emptyParagraphTip
`<font style="color:#7E45E8;">string</font>`

在光标聚焦的空段落首的提示文案。单独配置不生效。

```javascript
const option = {
  placeholder: {
    tip: '请输入文字',
    emptyParagraphTip: '输入 / 唤起更多',
  },
};
```

