> 来源: https://www.yuque.com/yuque/developer/api
> 抓取: 2026-09-16 · 语雀开发者文档（本地参考副本，勿再分发）

---

:::warning
⚠️ 注意事项：语雀开放 API 仅用于对语雀内容的正常读写，请合理使用语雀开放 API。系统识别异常行为后会进行屏蔽处理，可能会导致用户不可用等情形。

:::



# 身份认证
:::info
语雀所有的开放 API 都需要 Token 验证之后才能访问。

:::

在请求的 HTTP Headers 传入 `X-Auth-Token` 带入您的身份 Token 信息，用于完成认证。



## 个人用户认证 <font style="background:#F6E1AC;color:#664900">超级会员专享权益</font>
获取 Token 可通过点击语雀的个人头像，并进入 [个人设置](/settings/tokens) 页面拿到，如下图：

![](https://cdn.nlark.com/yuque/0/2023/png/84151/1680345283904-509c590e-b0b3-45a6-a9ff-aedde629b0c9.png)



`X-Auth-Token` 依据用户有的权限，决定了能获取到的数据，例如，假如 “小明” 这个账号是 “[语雀/帮助](/yuque/help)” 这个文档仓库的 `Owner`，那么通过他的 Token 可以获取到这个仓库的所有信息。



其他情况由具体的功能权限设定来决定能获取到什么样的数据，以及那些数据有修改权限。



## 企业团队身份认证 <font style="background:#F6E1AC;color:#664900">旗舰版空间专享权益</font>
空间内的团队，可进入<font style="color:#DF2A3F;">团队设置</font>页面进行获取（仅[旗舰版空间](https://www.yuque.com/about/price)可使用）。

![](https://cdn.nlark.com/yuque/0/2023/png/84151/1680345436472-0dce9c77-252c-4154-b562-522f43e845b8.png)



通过 `X-Auth-Token` ，语雀能够识别到当前访问的是哪个团队，可获取到该团队内的知识库、文档、以及成员等相关的数据。





# API 列表
[接口列表 · 语雀](https://www.yuque.com/yuque/developer/fadm9di79hgo6ggw)

