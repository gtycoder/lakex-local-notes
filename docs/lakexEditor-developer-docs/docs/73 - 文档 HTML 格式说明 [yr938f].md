> 来源: https://www.yuque.com/yuque/developer/yr938f
> 抓取: 2026-09-16 · 语雀开发者文档（本地参考副本，勿再分发）

---

> 本文档描述的内容，适用于 2021年 4 月 13 日之后**<font style="color:#F5222D;">创建</font>**的或者**<font style="color:#F5222D;">重新编辑</font>**过的文档。在此之前创建并未发生编辑的文档，返回结果不变。
>



基于各种原因，我们对文档的 HTML 格式进行了优化，主要包含以下两个方面。



## 内联css样式
之前的返回结果中，HTML 标签中携带了大量的样式信息，以下是对比效果。



### 阅读效果
![](https://cdn.nlark.com/yuque/0/2021/png/405557/1619509870852-4bfd9f2d-dd19-4e30-a25a-4c2028962f45.png)

### 原 HTML 结果
![](https://cdn.nlark.com/yuque/0/2021/png/405557/1619510085178-39219c01-b834-4bf3-a41e-5cf44c8b8d51.png)



### 现 HTML 结果
![](https://cdn.nlark.com/yuque/0/2021/png/405557/1619510004264-3c4b0464-4419-4f8b-a792-5c031c8282e3.png)

以上示例，只设置了：字体颜色、加粗以及背景色，原有的HTML数据中除了这些用户明确设置的信息之外，还携带了很多其他样式信息，在更新之后，返回结果将变更为仅包含用户设置过的样式信息。





## 代码高亮


本次变更生效之后，我们在返回的 html 格式中将不再对代码进行高亮，如有需要，请使用方自己实现代码高亮。

下面是代码块变化的对比图。



### 阅读效果
![](https://cdn.nlark.com/yuque/0/2021/png/405557/1619509533892-38720c38-f477-4f60-ac83-76d493e547c4.png)



### 原 HTML 结果


![](https://cdn.nlark.com/yuque/0/2021/png/405557/1619509159045-285ae404-8d70-457d-9be6-bae68310e885.png)



### 现 HTML 结果
![](https://cdn.nlark.com/yuque/0/2021/png/405557/1621502842673-693faa3c-c3c4-4d05-b97d-3998f0709791.png)

在新的 HTML 结果中，`<pre>` 标签对应了原始文档中的代码块，其 `data-language`属性表示用户选择的语言。使用方可以使用代码高亮库在前端对 pre 标签内的代码进行高亮处理。





## 应对样式变化带来的影响


由于新的策略会省略掉非用户设置的样式信息，所以会导致部分依赖这些样式的使用方的页面出现非预期的表现，为应对这种问题，我们提供了一份css 来解决该问题，使用方在自己的页面中引入我们的 CSS 即可。



> 注1：由于 css 源码会随着时间的推移而变更升级，为了避免使用方需要经常 check 我们变更的成本，我们会保持 css 的路径名不随着源码的变更而变更。这就意味着，在我们更新了 css 代码之后，由于最终用户的浏览器缓存，可能会有一段时间内新变更的样式不会生效，由此带来的影响需要使用方自己评估。
>
> 
>
> 注2：由于 css 源码较少，我们提供的 CDN 地址中的源码是未压缩的。
>
> 
>
> 注3：css 不能解决代码高亮的问题，代码高亮仍需要使用方自行解决。
>



CDN地址为：

[http://editor.yuque.com/ne-editor/lake-content-v1.css](http://editor.yuque.com/ne-editor/lake-content-v1.css)



下表记录 css 文件更新历史：

| **日期** | **详情** | **是否兼容** |
| --- | --- | --- |
| 2020-05-20 | 完善细节 | 兼容升级，使用方无感知 |
| 2023-02-23 | 更新部分涉及颜色和分栏结构的样式 | 部分颜色值有变化 |




## 代码块支持的语言列表
目前，语雀的代码块支持的语言如下：

```plain
[
    "Plain Text",
    "Bash",
    "Basic",
    "C",
    "C++",
    "C#",
    "CSS",
    "Dart",
    "Diff",
    "Dockerfile",
    "Erlang",
    "Git",
    "Go",
    "GraphQL",
    "Groovy",
    "HTML",
    "HTTP",
    "Java",
    "JavaScript",
    "JSON",
    "JSX",
    "KaTeX",
    "Kotlin",
    "Less",
    "Makefile",
    "Markdown",
    "MATLAB",
    "Nginx",
    "Objective-C",
    "Pascal",
    "Perl",
    "PHP",
    "PowerShell",
    "Protobuf",
    "Python",
    "R",
    "Ruby",
    "Rust",
    "Scala",
    "Shell",
    "SQL",
    "PL/SQL",
    "Swift",
    "TypeScript",
    "VB.net",
    "Velocity",
    "XML",
    "YAML",
    "sTeX",
    "LaTeX",
    "SystemVerilog",
    "Tcl",
    "Verilog",
    "Vue",
    "Lua"
]
```



## 如何区别新旧数据格式


新数据格式的内容区域被包含在一个 className 为 `lake-content` 的 div 中，如下所示：

```html
<h1>示例</h1>
<div class="lake-content" typography="classic">
  <p class="ne-p"><span class="ne-text">测试</span></p>
</div>

```



旧数据格式的的内容区域被包含在一个 className 为 `lake-engine` 的 div 中，如下所示：

```html
<h1>示例</h1>
<div class="lake-content-editor-core lake-engine lake-typography-classic" data-lake-element="root" data-selection-undefined="%7B%22path%22%3A%5B%5B0%2C0%2C0%2C2%5D%2C%5B0%2C0%2C0%2C2%5D%5D%2C%22active%22%3Atrue%7D">
  <p data-lake-id="uedf6b7ae" id="uedf6b7ae" style="font-size: 14px; color: rgb(38, 38, 38); line-height: 1.74; letter-spacing: 0.05em; outline-style: none; overflow-wrap: break-word; margin: 0px;"><span>测试</span></p>
</div>
```

