> 来源: https://www.yuque.com/yuque/developer/gv1px9exihgr2yh1
> 抓取: 2026-09-16 · 语雀开发者文档（本地参考副本，勿再分发）

---

有很多卡片（图片，附件等）是需要后台支持上传文件的，上传方法都需要自定义配置。

### 图片配置上传
```javascript
const { createOpenEditor } = window.Doc;

const editor = createOpenEditor(document.getElementById('root'), {
  image: {
    isCaptureImageURL:(url) => {
      // 判断当前url是否需要转存
      // return true表示需要转存，会调用createUploadPromise
      // return false表示不需要转存，直接用于展示
      return false;
    },
		// 配置上传接口,要返回一个promise对象
    createUploadPromise: (request) => {
      const {type, data} = request;
      if(type === 'url') {
        // data 是一个url，表示需要转存
      } else if(type === 'file') {
        // data是一个File
      }

      return Promise.resolve({
        url: '上传成功后的图片url地址',
        size: 100, // 文件大小
        filename: '图片名称，例如image.png'
      });
    },
  },
})
```

### 附件配置上传
```javascript
const { createOpenEditor } = window.Doc;

const editor = createOpenEditor(document.getElementById('root'), {
  file: {
    // 配置上传接口,要返回一个promise对象
    createUploadPromise: (file) => {
      // file是一个File对象

      return Promise.resolve({
        url: '上传成功后的文件地址',
        size: 100, // 文件大小
        filename: '文件名称，例如attachment.zip'
      });
    },
  },
})
```

### 视频配置上传
```javascript
const { createOpenEditor } = window.Doc;

const editor = createOpenEditor(document.getElementById('root'), {
  video: {
    // 配置上传接口,要返回一个promise对象
    createUploadPromise: (file) => {
      // file是一个File对象

      return Promise.resolve({
        url: '上传成功后的视频地址',
        size: 100, // 文件大小
        filename: '文件名称，例如test.mp4',
        cover: '视频封面图片地址',
      });
    },
  },
})
```

### 下载
没有内置的下载方法，下载功能需要自行实现，根据卡片数据构造下载地址。参考文档：[附件（file）](https://www.yuque.com/yuque/developer/mkkq8a1h7h8nxwvb#G3jDB)。

