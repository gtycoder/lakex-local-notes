> 来源: https://www.yuque.com/yuque/developer/doc-webhook
> 抓取: 2026-09-16 · 语雀开发者文档（本地参考副本，勿再分发）

---

# 概况
通过配置知识库或团队的 Webhooks，开发者能够在文档发生变动时**自动**获取到通知。

:::success
⚠️  **知识库 ** 如果配置了 「自动发布」功能后，文档的 更新/推送 操作暂不会发送 Webhook 通知。

:::



# 配置方式
在 **知识库** -> **设置 -> **<font style="color:#222222;">开发者设置</font>** **页面，会出现 Webhooks 配置地址。

![](https://cdn.nlark.com/yuque/0/2023/png/236800/1703046042579-fe831155-7ccf-47f0-a3f8-f8410f4ecbe3.png)



要给整个团队的文档添加 Webhook，可以在团队设置页进行设置：

![](https://cdn.nlark.com/yuque/0/2023/png/236800/1703046042565-867cdef9-becf-4518-92e7-fd61b349e2eb.png)

:::success
<font style="color:#F5222D;">确保 WebHook 配置的 URL 地址能够被语雀访问到，即要求它能够被互联网网络访问到。</font>

:::



# 推送给钉钉群
语雀 Webhooks 对[钉钉自定义机器人](https://ding-doc.dingtalk.com/doc#/serverapi2/qf2nxq)做了数据适配，如果添加的 Webhooks URL 是钉钉自定义机器人地址，那么会以 [钉钉 link 消息格式](https://ding-doc.dingtalk.com/doc#/serverapi2/qf2nxq#404d04c3)发送该知识库的文档 **发布 **和 **更新 **信息给机器人。由于钉钉开启了机器人的安全设置，需要在“自定义关键词”中添加“语雀”。

![配置截图](https://cdn.nlark.com/yuque/0/2020/png/84137/1580627939339-bc8c71eb-9fb1-47c0-b2d8-bf6e2b66d04b.png)

![钉钉上显示效果](https://cdn.nlark.com/yuque/0/2018/png/84137/1537246359489-dfae7658-3bab-4f11-8941-d031d28e4792.png)

# 推送给其他渠道


在文档发生变动时，语雀会**自动**使用 `HTTP POST` 请求已配置的 Webhook URL，具体的 `body` 是一个 JSON 数据结构，示例如下：

```json
POST http://someone.com/yuque/webhook

{
  "data": DataSerializer
}
```



## 推送数据格式说明
### 文档消息
```json
{
  "data": {
    "action_type": "publish",  					// Enum,			- publish:文档发布
                                        //						- update:文档更新
                                        //						- delete:文档删除
    "webhook_subject_type": "",					// Enum,			同上, 兼容字段
    "path": "",													// String,		文档相对路径 (不含域名)
    "url": "",													// String,		文档路径 (包含域名)
    "id": 123,													// Long,    	文档 ID
    "slug": "doc1",											// String,		文档路径
    "title": "标题",										  // String,		文档标题
    "body": "正文 Markdown 内容",				// String,		正文 Markdown 内容
    "body_html": "正文 HTML 内容",				// String,		正文 HTML 内容
    "created_at": "",										// String,		创建时间
    "updated_at": "",										// String,		更新时间
    "deleted_at": "",										// String,		删除时间
    "published_at": "",									// String,		发布时间
    "first_published_at": "",						// String,		首次发布时间
    "content_updated_at": "",						// String,		正文最近更新时间
    "user": {														// [文档所属用户/团队]
      "id": 123,												// Long,			ID
      "login": "账号",									  // String,		账号
      "name": "名称",										// String,		名称
      "avatar_url": "头像",							// String,		头像
    },
    "book": {														// [文档所属知识库]
      "id": 456,												// Long,			ID
      "slug": "book1",									// String,		路径
      "name": "知识库名称",								// String,		名称
      "description": "简介",							// String,		简介
    },
    "actor": {													// [消息触发者]
      "id": 123,												// Long,			ID
      "login": "账号",									  // String,		账号
      "name": "名称",										// String,		名称
      "avatar_url": "头像",							// String,		头像
    },
    "tags": [														// [文档自定义标签]
      {
        "id": 123,											// Long,			ID
        "title": "tag_name_1",					// String,		标签名称
        "created_at": "",								// String,		创建时间
        "updated_at": "",								// String,		更新时间
      },
      {
        "id": 124,
        "title": "tag_name_2",
        "created_at": "",
        "updated_at": "",
      },
    ],
	}
}
```

#### 表格正文内容格式
表格 body 字段 JSON 反序列化后格式如下：

```json
{
  "version": "1.0",
  "data": [
    {
      "name": "Sheet1",
      "index": 0,
      "rowCount": 100,
      "colCount": 4,
      "table": [
        ["参数名", "类型", "必填", "默认值"],
        ["name", "string", "1", ""],
        ["flag", "boolean", "0", "false"]
      ]
    },
    {
      "name": "Sheet2",
      "index": 0,
      "rowCount": 100,
      "colCount": 8,
      "table": []
    }
  ]
}
```

### 评论消息
```json
{
  "data": {
    "action_type": "comment_create",  	// Enum,			- comment_create:新增评论
                                        //						- comment_update:修改评论
                                        //						- comment_reply_create:回复评论
                                        //						- comment_reply_update:修改回复的评论
    "webhook_subject_type": "",					// Enum,			同上, 兼容字段
    "path": "",													// String,		评论相对路径 (不含域名)
    "url": "",													// String,		评论路径 (包含域名)
    "id": 123,													// Long,    	评论 ID
    "body_html": "正文 HTML 内容",				// String,		评论 HTML 内容
    "created_at": "",										// String,		创建时间
    "updated_at": "",										// String,		更新时间
    "user": {														// [创建评论的用户]
      "id": 123,												// Long,			ID
      "login": "账号",									  // String,		账号
      "name": "名称",										// String,		名称
      "avatar_url": "头像",							// String,		头像
    },
    "commentable": {										// [评论的文档]
      "path": "",													// String,		文档相对路径 (不含域名)
      "id": 123,													// Long,    	文档 ID
      "slug": "doc1",											// String,		文档路径
      "title": "标题",										  // String,		文档标题
      "body": "正文 Markdown 内容",				// String,		正文 Markdown 内容
      "body_html": "正文 HTML 内容",				// String,		正文 HTML 内容
      "created_at": "",										// String,		创建时间
      "updated_at": "",										// String,		更新时间
      "deleted_at": "",										// String,		删除时间
      "published_at": "",									// String,		发布时间
      "first_published_at": "",						// String,		首次发布时间
      "content_updated_at": "",						// String,		正文最近更新时间
      "user": {														// [文档所属用户/团队]
        "id": 123,												// Long,			ID
        "login": "账号",									  // String,		账号
        "name": "名称",										// String,		名称
        "avatar_url": "头像",							// String,		头像
      },
      "book": {														// [文档所属知识库]
        "id": 456,												// Long,			ID
        "slug": "book1",									// String,		路径
        "name": "知识库名称",								// String,		名称
        "description": "简介",							// String,		简介
      },
      "tags": [														// [文档自定义标签]
        {
          "id": 123,											// Long,			ID
          "title": "tag_name_1",					// String,		标签名称
          "created_at": "",								// String,		创建时间
          "updated_at": "",								// String,		更新时间
        },
        {
          "id": 124,
          "title": "tag_name_2",
          "created_at": "",
          "updated_at": "",
        },
      ],
    },
    "actor": {													// [消息触发者]
      "id": 123,												// Long,			ID
      "login": "账号",									  // String,		账号
      "name": "名称",										// String,		名称
      "avatar_url": "头像",							// String,		头像
    },
	}
}
```

### 评审消息
```json
{
  "data": {
    "action_type": "new_review",  			// Enum,			- new_review:发起评审
                                        //						- complete_review:完成评审
                                        //						- cancel_review:取消评审
    "webhook_subject_type": "",					// Enum,			同上, 兼容字段
    "path": "",													// String,		评审相对路径 (不含域名)
    "url": "",													// String,		评审路径 (包含域名)
    "id": 123,													// Long,    	评审 ID
    "name": "标题",											// String,		评审标题
    "body": "留言",											// String,		评审留言
    "created_at": "",										// String,		创建时间
    "updated_at": "",										// String,		更新时间
    "user": {														// [发起评审的用户]
      "id": 123,												// Long,			ID
      "login": "账号",									  // String,		账号
      "name": "名称",										// String,		名称
      "avatar_url": "头像",							// String,		头像
    },
    "target": {													// [评审的文档]
      "path": "",													// String,		文档相对路径 (不含域名)
      "id": 123,													// Long,    	文档 ID
      "slug": "doc1",											// String,		文档路径
      "title": "标题",										  // String,		文档标题
      "body": "正文 Markdown 内容",				// String,		正文 Markdown 内容
      "body_html": "正文 HTML 内容",				// String,		正文 HTML 内容
      "created_at": "",										// String,		创建时间
      "updated_at": "",										// String,		更新时间
      "deleted_at": "",										// String,		删除时间
      "published_at": "",									// String,		发布时间
      "first_published_at": "",						// String,		首次发布时间
      "content_updated_at": "",						// String,		正文最近更新时间
      "user": {														// [文档所属用户/团队]
        "id": 123,												// Long,			ID
        "login": "账号",									  // String,		账号
        "name": "名称",										// String,		名称
        "avatar_url": "头像",							// String,		头像
      },
      "book": {														// [文档所属知识库]
        "id": 456,												// Long,			ID
        "slug": "book1",									// String,		路径
        "name": "知识库名称",								// String,		名称
        "description": "简介",							// String,		简介
      },
      "tags": [														// [文档自定义标签]
        {
          "id": 123,											// Long,			ID
          "title": "tag_name_1",					// String,		标签名称
          "created_at": "",								// String,		创建时间
          "updated_at": "",								// String,		更新时间
        },
        {
          "id": 124,
          "title": "tag_name_2",
          "created_at": "",
          "updated_at": "",
        },
      ],
    },
    "actor": {													// [消息触发者]
      "id": 123,												// Long,			ID
      "login": "账号",									  // String,		账号
      "name": "名称",										// String,		名称
      "avatar_url": "头像",							// String,		头像
    },
	}
}
```







