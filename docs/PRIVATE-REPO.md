# 私有开发仓说明（不导出到公开镜像）

本仓 `local-lakex-notes-private`（Gitee private）是**唯一真源**：

- `vendor/lakex-doc-react/`、`public/vendor/lakex-doc/`、`public/vendor/lakex/` 以 **vendored 形式入库**（含闭源内核）
- 可直接 `npm install` / `npm run dev` / 打包，不依赖任何私有 registry

公开镜像 `gitee.com/gtycoder/local-lakex-notes`（以及后续 GitHub 同名仓库）由本仓导出，**不含内核**：

- 导出：`npm run export:public`（`--push` 同时推 Gitee 公开仓）
- 公开仓 = **只读镜像**：不要在公开仓直接改代码；改动回流本仓后再导出
- 公开仓提交信息 = `chore(public): sync from private@<hash>`

## 日常流程

1. 在本仓开发、提交、推 `gitee-private`
2. `npm run export:public -- --push` 生成/更新公开镜像并推 `gitee-public`
3. GitHub 仓库（后续创建）指向同一个公开镜像仓：
   ```bash
   cd ../lake-notes-electron-public
   git remote add github git@github.com:<user>/local-lakex-notes.git
   git push github master
   ```

## 红线

- 内核产物**永不**推到公开 remote；导出脚本会排除并自检（`vendor/lakex-doc-react` / `public/vendor/lakex*`）
- 公开仓的 `.gitignore` 由导出脚本生成（含内核忽略块）；**本仓不要跟踪这个块**
- 继续保留仓库外私有备份：`../private/lakex-private-<stamp>.tar.gz`（`npm run backup:lakex`）
- 私有仓不要误设公开、不要加公开 remote
