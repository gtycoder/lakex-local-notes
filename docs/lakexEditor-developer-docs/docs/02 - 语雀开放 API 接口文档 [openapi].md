> 来源: https://www.yuque.com/yuque/developer/openapi
> 抓取: 2026-09-16 · 语雀开发者文档（本地参考副本，勿再分发）

---

# 最新消息
| **日期** | **公告** |
| --- | --- |
| 2023/11/24 | 我们更新了接口文档，现在更容易使用，并且还能直接导入到 Postman 等流行工具中。 |
| 2022/04/10 | [语雀开放 API 访问范围变更](/yuque/developer/vzippmige58g7r9t)<font style="color:rgb(38, 38, 38);"> </font> |


# 如何使用接口
+ 接口域名为 `https://www.yuque.com`，但要注意访问空间内资源需要使用该空间的子域名。
+ 请注意，我们的服务有使用次数的限制：每小时最多 5000 次请求，每秒最多 100 次请求。如果请求太频繁，可能需要稍后重试。
+ 当您调用我们的接口时，会看到 `X-RateLimit-Limit`（总次数限制）和 `X-RateLimit-Remaining`（剩余次数）这样的信息，这有助于您了解当前的使用情况。
+ 最后请注意，个人或团队下的所有 Token 共享同一个使用次数限制。

# 重要的概念
+ 日期和时间：我们使用标准的格式（[ISO 8601](https://en.wikipedia.org/wiki/ISO_8601)）通常是 UTC 时间，所以在处理这些值时请确保格式正确。
+ 网址路径：我们的网址有一定的格式，比如`https://www.yuque.com/yuque/developer/api`。这里面包含了用户或团队的名称、知识库的标识，以及文档的标识。



```plain
https://www.yuque.com/yuque/developer/api        [文档完整访问路径]
                        |
                        +-- yuque/               [团队或用户的登录名(group_login)]
                                |
                                +-- developer/   [知识库的标识(book_slug)]
                                       |
                                       +-- api   [文档的标识(doc_slug)]
```



# 字段解释
+ 我们的接口文档里有一些常用字段，了解它们将帮助您高效使用我们的服务，例如：
    - `group_login`代表团队的网址路径。
    - `book_slug`代表知识库的路径。
    - `doc_slug`代表文档的路径。
    - `book_id`代表知识库的 ID。
    - `doc_id`代表文档的 ID。
+ 我们的部分 API 有进行重载, 例如:
    - 不知道 `book_id`的时候可以根据文档 url 路径 **获取文档详情**:
        * `GET /api/v2/repos/{group_login}/{book_slug}/docs/{doc_slug}`
    - 使用 `book_id` 和 `doc_id` 可以更快捷的 **获取文档详情**:
        * `GET /api/v2/repos/{book_id}/docs/{doc_id}`
    - 文档里有很多类似的重载接口, 方便您应对不同的使用场景。

# 接口文档更新记录
想了解最新的接口文档，请点击以下链接进行下载

+ **点击此处下载最新接口文档**：
    - OAS: [yuque_openapi_20260722.yaml](https://www.yuque.com/attachments/yuque/0/2026/yaml/1589428/1784709077652-444e8223-e9ce-40d6-b7cb-c5b2275bef1d.yaml)
    - HTML: [yuque_openapi_20260722.html](https://www.yuque.com/attachments/yuque/0/2026/html/1589428/1784709068410-0d8c5ee8-1dd5-4c11-89ab-5994ab122fcd.html)
+ 最近的更新包括了获取数据表详情、批量变更知识库目录、搜索 API 的改进，以及其他一些优化和修复。

