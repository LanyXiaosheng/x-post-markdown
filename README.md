# X 帖子快捷导出 Markdown

一个无后端、无 API Key 的 Chrome Manifest V3 扩展，把当前 X 帖子保存为本地 .md 文件。

## 概述

扩展读取当前已经打开的 X 页面中的可见帖子，提取正文、作者、发布时间、原帖链接和媒体链接，并由 Chrome 直接下载 Markdown。

## 特性

- 当前帖子导出：点击帖子旁的导出图标，下载该条帖子。
- 批量识别与选择：打开扩展弹窗自动扫描当前页面已加载帖子，默认全选，可取消不需要的帖子后批量下载。
- 类型筛选与组合导出：区分帖子和评论；只选帖子单独导出，只选评论汇总导出，两者同时选择时把评论追加到对应帖子文件。
- 批量容错：弹窗直接调用 Chrome 下载接口，逐个提交文件，显示进度和实际失败原因。
- 表情保真：X 的 Emoji 图片按表情字符导出，例如 😭，不输出图片语法。
- 长文章保真：识别 X Article 标题、一级/二级/三级标题、粗体、斜体、链接、引用、代码块、有序/无序列表和 HTML 表格。
- 图片顺序保真：正文图片按文章原始位置插入，不再统一堆到文末。
- 帖子内快捷按钮：在每条帖子右上角菜单旁增加导出图标，支持时间线快速保存。
- 右键和快捷键：页面右键菜单以及 Ctrl+Shift+M / ⌘+Shift+M 都可触发导出。
- 本地优先：不调用 X API、不上传帖子内容，Markdown 在浏览器本地生成。

## 安装

1. 打开 chrome://extensions，开启“开发者模式”。
2. 点击“加载已解压的扩展”，选择本目录 x-post-markdown。
3. 登录 X，打开任意帖子详情页或时间线。
4. 打开扩展弹窗，筛选/勾选帖子和评论，点击“导出选中内容”；批量提交完毕前保持弹窗打开。
5. 单条导出可以直接点击帖子右上角的导出图标。

普通帖子下载文件名默认为 @用户名-帖子ID.md；X Article 使用长文标题.md。

## 更新到 0.2.0

解压 x-post-markdown-v0.2.0.zip，加载包含 manifest.json 的目录。
在 chrome://extensions 确认实际启用的扩展版本为 0.2.0，并刷新 X 页面。
弹窗副标题也会显示 v0.2.0，便于确认安装版本。

已开始下载表示 Chrome 已接受下载任务，最终保存状态以 Chrome 下载列表为准。
仅评论导出为一个评论汇总文件；帖子和评论一起勾选时，按所属帖子追加评论。
无法对应到选中帖子的评论会另存评论汇总，避免附到无关帖子。

## 验证

Node 内置测试：node --test tests/background.test.js tests/markdown.test.js。
浏览器集成测试：node tests/browser.test.js，使用测试环境提供的 Playwright。
可用 XMD_CHROMIUM 指定支持开发者扩展的 Chromium 可执行文件。
浏览器测试使用独立临时配置、模拟 X 页面和临时下载目录，不需要 X 登录。

## 主要模块

| 文件 | 职责 |
|------|------|
| src/content.js | 读取 X DOM、提取帖子、注入快捷按钮 |
| src/markdown.js | 生成 Front Matter，并把富文本 DOM 转成 Markdown |
| src/background.js | 注册右键菜单、快捷键，并按帖子/评论组合规则调用 Chrome 下载 API |
| src/export.js | 共享导出组合和异步下载队列，供弹窗与后台使用 |
| src/popup.* | 扫描当前页面、展示复选框并发起批量下载 |

## 目录结构

~~~text
x-post-markdown/
├── manifest.json
├── README.md
├── DESIGN.md
├── src/
│   ├── background.js
│   ├── content.css
│   ├── content.js
│   ├── export.js
│   ├── markdown.js
│   ├── popup.css
│   ├── popup.html
│   └── popup.js
└── tests/
    ├── markdown.test.js
    ├── background.test.js
    └── browser.test.js
~~~
