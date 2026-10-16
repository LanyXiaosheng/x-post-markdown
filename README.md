# XMD · 帖子归档（免费版）

Chrome 扩展，将 X 帖子、长文和评论保存为本地 Markdown。
当前发布版本 0.4.0：全部导出功能免费，无需激活码、付费或授权服务器。
无需 X API Key；内容在浏览器本地处理。

## 功能

- 单帖：点击帖子旁的灰色下载箭头。
- 批量：打开弹窗自动识别已加载内容，默认全选，可按帖子/评论筛选或逐条取消。
- 评论：只选评论时汇总为一个文件；同时选择帖子和评论时追加到对应帖文。
- 长文：保留标题、粗体、列表、链接、表格及图片顺序；文件使用长文标题命名。
- 表情：直接输出 Emoji 字符。
- 主题：#ddff03，工具栏保留品牌 Logo；页内使用低干扰的细线图标。
- 快捷入口：扩展弹窗、帖子按钮、右键菜单、Ctrl+Shift+M。

只识别当前页面已加载的内容，不自动滚动。
普通帖子默认文件名为 @用户名-帖子ID.md；长文使用长文标题.md。
同名文件由 Chrome 自动追加序号。图片保留远程链接，不保存媒体文件。

## 安装和更新

1. 解压 x-post-markdown-v0.4.0-free.zip。
2. 打开 chrome://extensions，开启开发者模式。
3. 加载包含 manifest.json 的解压目录；已有安装可覆盖原目录后点击重新加载。
4. 确认扩展版本为 0.4.0，然后刷新 X 页面。

批量提交下载期间保持弹窗打开。
“已开始下载”表示 Chrome 接受任务，最终保存状态以浏览器下载列表为准。
本版不展示 Pro/激活/支付入口，也不请求激活或支付服务。

## 构建

运行 scripts/build-free.ps1，输出免费 ZIP 以及一个临时解压目录。
脚本只复制免费运行文件和品牌资源，不包括激活、支付、二维码、
签名验证库、授权配置和后端代码。

Logo 源文件为 assets/logo.svg，工具栏 PNG 使用 scripts/build-icons.js
及开发环境的 sharp 生成。直接加载发布包不需要 Node 或其他开发依赖。

## 验证

- node --test tests/background.test.js tests/markdown.test.js
- node tests/browser.test.js：模拟 X 页面、真实下载、免费长文、评论组合、缩放/滚动和无授权网络请求。
- node tests/popup-window.test.js：真实打开工具栏弹窗，验证尺寸及滚动布局。

浏览器测试需开发环境提供 Playwright，可通过 XMD_CHROMIUM 指定 Chromium，
通过 XMD_EXTENSION 测试打包后的解压目录。测试使用独立临时浏览器配置。

## 当前模块

| 文件 | 职责 |
| --- | --- |
| src/content.js / content.css | 读取 X 页面、识别帖子/评论、添加导出按钮 |
| src/markdown.js | 富文本与图文顺序转换 |
| src/export.js | 按选择组合文件并提交异步下载 |
| src/background.js | 单帖入口、快捷键、右键菜单 |
| src/popup.* / popup-layout.js | 免费批量导出界面和原生弹窗尺寸 |

历史付费模块和 backend 保留在源码仓库，供以后评估，免费版不加载也不打包。
既有服务器服务未因本次客户端免费发布而改动。
