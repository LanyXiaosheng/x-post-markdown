# X 帖子快捷导出 Markdown

一个无后端、无 API Key 的 Chrome Manifest V3 扩展，把当前 X 帖子保存为本地 .md 文件。

## 概述

扩展读取当前已经打开的 X 页面中的可见帖子，提取正文、作者、发布时间、原帖链接和媒体链接，并由 Chrome 直接下载 Markdown。

## 特性

- 当前帖子导出：点击扩展弹窗按钮，导出帖子详情页或当前页面中的帖子。
- 长文章保真：识别 X Article 标题、一级/二级/三级标题、粗体、斜体、链接、引用、代码块、有序/无序列表和 HTML 表格。
- 图片顺序保真：正文图片按文章原始位置插入，不再统一堆到文末。
- 帖子内快捷按钮：在每条帖子右上角菜单旁增加导出图标，支持时间线快速保存。
- 右键和快捷键：页面右键菜单以及 Ctrl+Shift+M / ⌘+Shift+M 都可触发导出。
- 本地优先：不调用 X API、不上传帖子内容，Markdown 在浏览器本地生成。

## 安装

1. 打开 chrome://extensions，开启“开发者模式”。
2. 点击“加载已解压的扩展”，选择本目录 x-post-markdown。
3. 登录 X，打开任意帖子详情页或时间线。
4. 点击扩展图标中的“导出当前帖子”，或点击帖子右上角的导出图标。

普通帖子下载文件名默认为 @用户名-帖子ID.md；X Article 使用长文标题.md。

## 主要模块

| 文件 | 职责 |
|------|------|
| src/content.js | 读取 X DOM、提取帖子、注入快捷按钮 |
| src/markdown.js | 生成 Front Matter，并把富文本 DOM 转成 Markdown |
| src/background.js | 注册右键菜单、快捷键并调用 Chrome 下载 API |
| src/popup.* | 提供扩展图标弹窗入口 |

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
│   ├── markdown.js
│   ├── popup.css
│   ├── popup.html
│   └── popup.js
└── tests/
    └── markdown.test.js
~~~
