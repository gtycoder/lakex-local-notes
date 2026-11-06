> 来源: https://www.yuque.com/yuque/developer/gfoax065u2v72isu
> 抓取: 2026-09-16 · 语雀开发者文档（本地参考副本，勿再分发）

---

# 介绍
<font style="color:rgb(51, 51, 51);">语雀富文本编辑器 LakexEditor 是由</font>`<font style="color:rgb(51, 51, 51);">yuque</font>`<font style="color:rgb(51, 51, 51);">开发的所见即所得富文本web编辑器。</font>

:::success
有相关的问题可以在[反馈区](https://www.yuque.com/feedbacks/new)留言

:::

:::color4
文档不完善，谨慎用于生产

:::

# 浏览器支持
1. Chrome 62， 68+
2. IOS Safari 11+
3. Mac Safari 13+
4. Firefox 100+

# CDN地址
:::color5
cdn 的地址只有 `VERSION` 的位置会变化，目前最新版本是 `1.32.0`

https://gw.alipayobjects.com/render/p/yuyan_npm/@alipay_lakex-doc/`VERSION`/umd/doc.css

https://gw.alipayobjects.com/render/p/yuyan_npm/@alipay_lakex-doc/`VERSION`/umd/doc.umd.js

:::

[https://gw.alipayobjects.com/render/p/yuyan_npm/@alipay_lakex-doc/1.24.0/umd/doc.css](https://gw.alipayobjects.com/render/p/yuyan_npm/@alipay_lakex-doc/1.24.0/umd/doc.css)

[https://gw.alipayobjects.com/render/p/yuyan_npm/@alipay_lakex-doc/1.24.0/umd/doc.umd.js](https://gw.alipayobjects.com/render/p/yuyan_npm/@alipay_lakex-doc/1.24.0/umd/doc.umd.js)

需要引入react的cdn地址

[https://unpkg.com/react@18/umd/react.production.min.js](https://unpkg.com/react@18/umd/react.production.min.js"></script>)

[https://unpkg.com/react-dom@18/umd/react-dom.production.min.js](https://unpkg.com/react-dom@18/umd/react-dom.production.min.js"></script>)

需要引入antd的样式cdn地址

[https://unpkg.com/antd@4.24.13/dist/antd.css](https://unpkg.com/antd@4.24.13/dist/antd.css)

# 创建demo
### 编辑器
```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>yuque编辑器</title>
  <link rel="stylesheet" type="text/css" href="https://gw.alipayobjects.com/render/p/yuyan_npm/@alipay_lakex-doc/1.24.0/umd/doc.css"/>
  <link rel="stylesheet" type="text/css" href="https://unpkg.com/antd@4.24.13/dist/antd.css"/>
</head>
<body>
  <div id="root" class="ne-doc-major-editor"></div>
  <script>
    window.onload = function () {
      const { createOpenEditor } = window.Doc;
      // 创建编辑器
      const editor = createOpenEditor(document.getElementById('root'), {
        input: {},
        image: {
          isCaptureImageURL() {
            return false;
          },
        },
      });
      // 设置内容
    	editor.setDocument('text/lake', '<p><span style="color: rgb(255, 111, 4),rgb(243, 48, 171)">欢迎来到yuque编辑器</span></p>');
      // 监听内容变动
      editor.on('contentchange', () => {
        console.info(editor.getDocument('text/lake'));
      });
    }
  </script>
  <script crossorigin src="https://unpkg.com/react@18/umd/react.production.min.js"></script>
  <script crossorigin src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js"></script>\
  <script src="https://gw.alipayobjects.com/render/p/yuyan_npm/@alipay_lakex-doc/1.24.0/umd/doc.umd.js"></script>
</body>
</html>
```

### 阅读器
```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>yuque编辑器</title>
  <link rel="stylesheet" type="text/css" href="https://gw.alipayobjects.com/render/p/yuyan_npm/@alipay_lakex-doc/1.24.0/umd/doc.css"/>
  <link rel="stylesheet" type="text/css" href="https://unpkg.com/antd@4.24.13/dist/antd.css"/>
</head>
<body>
  <div id="root" class="ne-doc-major-viewer"></div>
  <script>
    window.onload = function () {
      const { createOpenViewer } = window.Doc;
      // 创建阅读器
      const viewer = createOpenViewer(document.getElementById('root'), {
      });
      // 设置内容
      viewer.setDocument('text/lake', '<p><span style="color: rgb(255, 111, 4),rgb(243, 48, 171)">欢迎来到yuque编辑器</span></p>');
    }
  </script>
  <script crossorigin src="https://unpkg.com/react@18/umd/react.production.min.js"></script>
  <script crossorigin src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js"></script>
  <script src="https://gw.alipayobjects.com/render/p/yuyan_npm/@alipay_lakex-doc/1.24.0/umd/doc.umd.js"></script>
</body>
</html>
```

## 在线demo
[codepen](https://codepen.io/hugehard/embed/YzdWQVb?editors=1000)

## 其它 demo
[GitHub - ilimei/vscode-plugin-lake-editor: yuque editor for vscode local file](https://github.com/ilimei/vscode-plugin-lake-editor)

[GitHub - yuque/yuque-chrome-extension: 🚀🚀🚀 语雀浏览器插件](https://github.com/yuque/yuque-chrome-extension)

