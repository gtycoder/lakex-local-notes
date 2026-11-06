> 来源: https://www.yuque.com/yuque/developer/lunx6h
> 抓取: 2026-09-16 · 语雀开发者文档（本地参考副本，勿再分发）

---

为了让空间管理员可以实时关注空间内的安全操作日志，我们提供了基于 Webhook 的实时推送方式，让空间管理员可以接入自身的安全审计系统。



![](https://cdn.nlark.com/yuque/0/2023/png/84151/1675414710472-f8262498-2383-41e8-94c0-20524f93409f.png)

#### 功能描述
当语雀空间中有安全相关的操作日志产生时，语雀系统会实时向您添加的 webhook 地址上推送消息数据。其实质为一个包含[指定格式数据](#RdVzW)的 POST 请求。

此功能需要您自实现可接收 webhook 消息推送的服务。<font style="background-color:#FBDE28;">此功能暂不支持钉钉机器人推送</font>。



#### 推送数据格式


```json
{
  "data": {
    "action_type": "audit_log_create",  // Enum,			- audit_log_create:审计日志
    "webhook_subject_type": "",					// Enum,			同上, 兼容字段

    "action": "",												// Enum,			审计日志行为类型
                                        //						- public_share:对空间外分享
                                        //						- export:导出
                                        //						- invite:邀请加入空间
                                        //						- apply:申请加入空间
                                        //						- join:确认加入空间
                                        //						- delete:删除空间成员
    
    "organization_id": 123,							// Long,    	空间 ID
    "group_id": 777,							      // Long,    	团队 ID
    "actor_id": 666,							      // Long,    	操作人 ID
    "auditable_id": 456,							  // Long,		  审计对象 ID
    "auditable_type": "Doc",						// Enum,		  审计对象类型
                                        //						- Doc:文档
                                        //						- Book:知识库
                                        //						- GroupUser:团队成员
                                        //						- OrganizationUser:空间成员

    "ip": "",				                    // String,		操作人 IP
    "trace_id": "",				              // String,		Trace ID
    "created_at": "",										// String,		创建时间
    "updated_at": "",										// String,		更新时间
    
    "group": {													// [所属团队]
      "id": 123,												// Long,			ID
      "login": "账号",									  // String,		账号
      "name": "名称",										// String,		名称
    },
    "actor": {													// [操作人]
      "id": 123,												// Long,			ID
      "login": "账号",									  // String,		账号
      "name": "名称",										// String,		名称
      "avatar_url": "头像",							// String,		头像
    },
    "auditable": {											// [审计对象]
    },
	}
}
```



#### 关键字段说明
auditable 审计对象存在以下几种类型：

```json
// 文档, auditable_type === 'Doc'
{
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
}


// 知识库, auditable_type === 'Book'
{
  "id": 456,												// Long,			知识库ID
  "slug": "book1",									// String,		知识库路径
  "name": "知识库名称",								// String,		知识库名称
  "description": "简介",							// String,		知识库简介
}

// 团队成员, auditable_type === 'GroupUser'
{
  "group_id": 1,										// Long,			团队 ID
  "user_id": 123,										// Long,			用户 ID
  "role": 0,												// Enum,			权限
                                    //						- 0:管理员
                                    //						- 1:成员
                                    //						- 2:只读成员
  "status": 0,											// Enum,			状态
                                    //						- 0:已邀请
                                    //						- 1:已加入
                                    //						- 2:正在申请
}

// 空间成员, auditable_type === 'OrganizationUser'
{
  "organization_id": 1,							// Long,			空间 ID
  "user_id": 123,										// Long,			用户 ID
  "role": 0,												// Enum,			权限
                                    //						- 0:管理员
                                    //						- 1:成员
                                    //						- 2:外部联系人
  "status": 0,											// Enum,			状态
                                    //						- 0:已邀请
                                    //						- 1:已加入
                                    //						- 2:正在申请
  "name": "",												// String,		自定义昵称
  "avatar": "",											// String,		自定义头像
}
```



