# XMD · 帖子归档

Chrome Manifest V3 扩展，把 X 帖子、长文和评论保存为本地 Markdown。
无需 X API Key；帖文处理在本地完成。授权与订单通过独立后端处理。

## 概述

扩展读取当前已经打开的 X 页面中的可见帖子，提取正文、作者、发布时间、原帖链接和媒体链接，并由 Chrome 直接下载 Markdown。

## 特性

- 免费版：普通单帖导出。
- Pro：¥29.90 一次购买永久授权，绑定 1 个浏览器安装，解锁批量、长文、评论。
- 激活：签名凭证、本地缓存、联网续验。激活服务不接收帖文正文。
- 品牌：折页文档和保存箭头 logo，主题色 #ddff03，适配扩展工具栏和弹窗。

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

## 更新到 0.3.1

解压 x-post-markdown-v0.3.1.zip，加载包含 manifest.json 的目录。
在 chrome://extensions 确认实际启用的扩展版本为 0.3.1，并刷新 X 页面。
弹窗显示 v0.3.1。

“激活 Pro”页面可输入已有激活码。支付配置暂缺，购买入口显示待开通；
配置正式微信/支付宝商户信息并验证真实订单前，不接受收款。
生产激活服务为 https://lanyxiaosheng.cloud:8443/xmd-api/v1。
当前默认 443 端口从本机外部请求失败，8443 已通过外部健康检查及实际浏览器激活。

管理命令、支付配置与回调地址见 [后端文档](backend/README.md)。
永久授权使用 7 天签名缓存；联网自动续验，过期须再次联网。
更换或删除浏览器配置会产生新的安装标识，迁移需产品方处理。

已开始下载表示 Chrome 已接受下载任务，最终保存状态以 Chrome 下载列表为准。
仅评论导出为一个评论汇总文件；帖子和评论一起勾选时，按所属帖子追加评论。
无法对应到选中帖子的评论会另存评论汇总，避免附到无关帖子。

## 验证

Node 内置测试：node --test tests/background.test.js tests/markdown.test.js tests/license.test.js。
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
| src/license.js | 固定公钥校验授权、激活与续验、免费/Pro 访问控制 |
| src/activation-ui.js | 激活页面、支付待配置状态和收银台/二维码 |
| src/popup.* | 扫描当前页面、展示复选框并发起批量下载 |

## Logo 和构建

assets/logo.svg 为可编辑源文件，assets/logo.png 与 icons 为生成的图标资源。
scripts/build-icons.js 使用开发环境的 sharp 栅格化图标。
scripts/build-qr.js 使用 esbuild 打包 QRCode 和 TweetNaCl；
两者随扩展本地打包，保留各自许可证，不从 CDN 加载代码。
无需安装这些开发依赖就能加载发布 ZIP。

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
│   ├── license.js
│   ├── config.js
│   ├── activation-ui.js
│   ├── markdown.js
│   ├── popup.css
│   ├── popup.html
│   └── popup.js
└── tests/
    ├── markdown.test.js
    ├── background.test.js
    └── browser.test.js
~~~
