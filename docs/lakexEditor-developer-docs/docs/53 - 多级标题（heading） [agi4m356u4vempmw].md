> 来源: https://www.yuque.com/yuque/developer/agi4m356u4vempmw
> 抓取: 2026-09-16 · 语雀开发者文档（本地参考副本，勿再分发）

---

![](https://cdn.nlark.com/yuque/0/2024/png/525935/1722477334236-027b9968-e163-4050-897c-fc84a750dcd4.png)

阅读模式和编辑模式配置项相同。

# 配置项
## generateHashLink
`<font style="color:#7E45E8;">(url: string | URL, id: string) => string | null</font>`

根据当前页面地址和标题节点id生成hash链接。需自行处理链接的跳转行为，通常用于分享给别人快速跳转到指定文档位置。

## anchor
`<font style="color:#7E45E8;">boolean</font>`

标题锚点，点击锚点会**复制**当前标题的hash链接，默认为false。如果需要该功能，则必须配置`generateHashLink`，否则将会提示复制失败。

## folding
`<font style="color:#7E45E8;">boolean</font>`

标题折叠，点击会收起当前层级标题下的所有内容。默认启用该功能。

