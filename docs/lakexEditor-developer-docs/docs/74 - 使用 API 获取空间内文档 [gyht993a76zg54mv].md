> 来源: https://www.yuque.com/yuque/developer/gyht993a76zg54mv
> 抓取: 2026-09-16 · 语雀开发者文档（本地参考副本，勿再分发）

---

> 当前功能仅[旗舰版空间](https://www.yuque.com/about/price)可使用
>



通过调用语雀开放 API，可以获取到空间内的团队、知识库以及文档。基于此，可以拉取语雀内容自行搭建服务进行访问或者保存。

方法如下：

:::info
1. 创建团队 Token，通过团队 Token 访问语雀开放接口
2. 获取特定团队下的知识库列表
3. 获取特定知识库下的文档列表
4. 获取特定文档的内容详情

:::



### 身份认证
开放 API 需要通过身份认证才能访问，获取团队 Token 的方式：进入团队设置页面，创建团队 Token（需要有团队管理权限）。

![](https://cdn.nlark.com/yuque/0/2023/png/84151/1680345436472-0dce9c77-252c-4154-b562-522f43e845b8.png)



Token 详细使用方式见：[https://www.yuque.com/yuque/developer/api#sAVSW](https://www.yuque.com/yuque/developer/api#sAVSW)



### 获取团队下的知识库
接口地址： `<font style="color:rgb(0, 0, 0);">/api/v2/groups/{login}/repos</font>`



### 获取知识库下的文档
接口地址： `<font style="color:rgb(0, 0, 0);">/api/v2/repos/{book_id}/docs</font>`



### 获取文档详情
接口地址：`<font style="color:rgb(0, 0, 0);">/api/v2/repos/{book_id}/docs/{id}</font>`



:::info
<font style="color:rgb(0, 0, 0);">上述接口的具体出入参请参考 </font>[接口列表](https://www.yuque.com/yuque/developer/openapi#H1GNu) 文档。

:::



