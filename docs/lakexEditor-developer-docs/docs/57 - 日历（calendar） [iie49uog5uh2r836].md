> 来源: https://www.yuque.com/yuque/developer/iie49uog5uh2r836
> 抓取: 2026-09-16 · 语雀开发者文档（本地参考副本，勿再分发）

---

:::color4
1.14.0 后支持

:::

## startWeekDay<font style="background:#F8CED3;color:#70000D">可选</font>
`<font style="color:#601BDE;">number</font>`<font style="color:#601BDE;"> </font>0 - 6 表示周日到周六

以星期几作为开头，默认值是`0`表示周日。

```typescript
options = {
  calendar: {
    startWeekDay: 1, // 周一作为第一列
  }
}
```



## getDocReadURL<font style="background:#F8CED3;color:#70000D">可选</font>
`<font style="color:#601BDE;">(currentURL: string, cardId: string) => string</font>`

输出 html 的时候生成当前日历卡片的链接

`currentURL`取自通用配置中 [currenURL](https://yuque.antfin.com/lark/lakex-doc/ape08vkqhi6570lb#KtWEh)

```typescript
options = {
  calendar: {
    getDocReadURL: (currentURL: string, cardId: string) => {
      // html的超链接跳转会本页
      return currentURL + '#' + cardId;
    },
  }
}
```



