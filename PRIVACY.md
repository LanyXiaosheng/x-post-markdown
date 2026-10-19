# XMD · 帖子归档隐私政策 / Privacy Policy

生效日期 / Effective date: 2026-10-19

本政策适用于 Chrome Web Store 发布的 XMD 免费版（0.4.x）。
This policy applies to the free XMD Chrome extension, version 0.4.x.

## 功能与本地处理 / Purpose and local processing

XMD 将用户在 X/Twitter 页面中选择的已加载帖子、长文和评论转换为本地 Markdown 文件。
为完成此功能，扩展会在用户打开弹窗或触发导出时读取相关页面内容，包括正文、
作者显示名/用户名、发布时间、帖文链接和媒体链接，并在扩展的临时内存中处理。
扩展会在 X/Twitter 页面添加导出按钮；不会对其他网站进行内容扫描。

XMD converts selected, already-loaded X/Twitter posts, articles and replies into local Markdown files.
When you open its popup or trigger export, it reads the relevant text, author names/handles,
publication dates, post URLs and media URLs and processes them in temporary extension memory.
It adds export controls on X/Twitter only and does not scan other websites.

## 不上传与不追踪 / No upload or tracking

免费版不把帖文内容或使用记录传送给开发者服务器，不使用分析、广告、追踪或支付 SDK，
不要求账户、激活码或支付。它不读取密码、登录 Cookie 或完整浏览历史，
也不在开发者服务器保存用户档案。

The free extension does not transmit post content or usage records to a developer server.
It includes no analytics, advertising, tracking or payment SDK, and requires no account,
activation code or payment. It does not read passwords, login cookies or full browsing history,
or maintain user profiles on developer servers.

## 下载与保留 / Downloads and retention

Markdown 文件通过 Chrome 下载接口保存到用户选择的本地下载位置。
扩展不另行持久保存帖子库。关闭弹窗或页面后，临时处理数据随相关上下文释放；
下载文件由用户自行管理和删除。卸载扩展不会删除已导出的文件。
文件中的远程媒体链接如果在 Markdown 阅读器中打开，该阅读器可能向 X 或相应
媒体服务发出请求；这些后续请求由阅读器和媒体服务处理。

Chrome's downloads API saves Markdown files locally. XMD does not persist an additional post library.
Temporary data is released when its popup/page contexts close. You control and can delete the
downloaded files; uninstalling the extension does not delete exports. If a Markdown reader loads
remote media links in an export, that reader may contact X or its media hosts independently.

## 权限 / Permissions

- activeTab：在用户打开扩展时定位当前标签页，向其 X 内容脚本请求导出数据。
- contextMenus：在 X/Twitter 页面提供右键导出入口。
- downloads：保存用户请求的 Markdown 文件。
- X/Twitter 域名访问：读取相关页面 DOM 并放置导出按钮。

These permissions identify the active page, add X/Twitter context-menu controls, read the relevant
X/Twitter page DOM and save requested files. The extension requests no arbitrary-site access,
browser-history permission or authentication-cookie access.

## 数据使用承诺 / Limited use

读取的数据仅用于用户请求的 Markdown 导出，不出售、不用于广告或信用评估，
不与数据经纪商共享，开发者不会通过本扩展接收或人工查看这些导出内容。
XMD 对用户数据的使用遵守 Chrome Web Store User Data Policy，包括其 Limited Use 要求。

Data read by XMD is used solely for the requested Markdown exports, not sold or used for advertising
or credit decisions, and not shared with data brokers. The developer does not receive or manually
review that exported content through the extension. XMD's use of user data complies with the
Chrome Web Store User Data Policy, including its Limited Use requirements.

## 联系与变更 / Contact and changes

支持与隐私问题：通过产品仓库提交问题。请勿在公开问题中粘贴敏感帖文或个人凭据。
Support and privacy questions: use the product's issue tracker. Do not post sensitive content
or credentials in public issues.

https://github.com/LanyXiaosheng/x-post-markdown/issues

未来若数据处理方式发生变化，将更新本政策和商店披露；本免费版不启用历史付费模块。
Any future change to data handling will be reflected in this policy and store disclosures.
The historical paid modules are not enabled in this free release.
