> 来源: https://www.yuque.com/yuque/developer/gut72wwo0o4fpigp
> 抓取: 2026-09-16 · 语雀开发者文档（本地参考副本，勿再分发）

---

# 编辑模式配置项
## readEmptyLine
`<font style="color:#7E45E8;">boolean</font>`

是否读取空行，默认为`false`，即使用html渲染文档会忽略空行。举个例子：

编辑器内容有一个空行

![](https://cdn.nlark.com/yuque/0/2024/png/525935/1722477294822-e71bd9c3-0dc5-48bd-ac08-f86d6abc2c81.png)

得到的html数据如下

```html
<div class="lake-content" typography="classic">
  <p id="u3468eb57" class="ne-p"><span class="ne-text">123</span></p>
  <p id="u53cb9d54" class="ne-p"><span class="ne-text"></span></p>
  <p id="uc3165bef" class="ne-p"><span class="ne-text">123</span></p>
</div>
```

如果没有配置该项，直接使用`text/html`格式初始化文档时，第二个空`p`会被忽略，渲染结果如下（和编辑模式不一致）

![](https://cdn.nlark.com/yuque/0/2024/png/525935/1722477294839-2c943bb0-acda-4c3b-9954-4f8312bf61f5.png)

