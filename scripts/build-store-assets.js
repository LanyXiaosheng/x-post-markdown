const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { chromium } = require("playwright");
const sharp = require("sharp");

const root = path.resolve(__dirname, "..");
const output = path.join(root, "store/assets");
const examples = [
  { name: "XMD 示例", handle: "xmd_demo", id: "10001", text: "把值得留下的内容，保存下来。\n\n这是一条演示帖子。打开 XMD，勾选已加载的帖子，即可保存为 Markdown。" },
  { name: "归档笔记", handle: "archive_demo", id: "10002", text: "批量整理阅读记录：\n1. 打开页面\n2. 选择帖子或评论\n3. 下载本地文件\n\n无需激活，当前版本全部免费。" },
  { name: "阅读清单", handle: "reading_demo", id: "10003", text: "正文、作者、时间、来源链接，都可以一起归档。\nEmoji 直接保留为字符：😭 ✨\n\n演示内容，仅用于展示界面。" },
  { name: "学习记录", handle: "study_demo", id: "10004", text: "长文请先在页面展开。\nXMD 处理当前实际加载的内容，图片以链接保留，Markdown 文件在本地生成。" }
];

function fixture() {
  return '<meta charset="utf-8"><main>' + examples.map(post =>
    '<article data-testid="tweet"><a role="link" href="/' + post.handle +
    '"><div dir="ltr"><span>' + post.name + '</span></div></a>' +
    '<a href="/' + post.handle + '/status/' + post.id + '"><time datetime="2026-10-19">2026年10月19日</time></a>' +
    '<div data-testid="tweetText">' + post.text.replace(/\n/g, "<br>") + '</div><div role="group"></div></article>'
  ).join("") + "</main>";
}

function escape(value) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
}

async function main() {
  await fs.mkdir(output, { recursive: true });
  const browser = await chromium.launchPersistentContext(
    await fs.mkdtemp(path.join(os.tmpdir(), "xmd-store-assets-")),
    {
      executablePath: process.env.XMD_CHROMIUM || chromium.executablePath(),
      headless: true,
      args: ["--disable-extensions-except=" + root, "--load-extension=" + root]
    }
  );
  try {
    const worker = browser.serviceWorkers()[0] || await browser.waitForEvent("serviceworker");
    const extensionId = new URL(worker.url()).host;
    const xPage = await browser.newPage();
    await xPage.route("https://x.com/**", route => route.fulfill({
      contentType: "text/html; charset=utf-8", body: fixture()
    }));
    await xPage.goto("https://x.com/home");
    await xPage.locator(".xmd-export-button").first().waitFor();
    const bridge = await browser.newPage();
    await bridge.goto("chrome-extension://" + extensionId + "/src/popup.html");
    const tabId = await bridge.evaluate(async () =>
      (await chrome.tabs.query({})).find(tab => tab.url === "https://x.com/home").id);
    const popup = await browser.newPage();
    await popup.setViewportSize({ width: 384, height: 600 });
    await popup.addInitScript(id => {
      chrome.tabs.query = (query, callback) => callback([{ id }]);
    }, tabId);
    await popup.goto("chrome-extension://" + extensionId + "/src/popup.html");
    await popup.locator(".post-row").nth(3).waitFor();
    const popupBytes = await popup.screenshot();
    await fs.writeFile(path.join(output, "popup-actual.png"), popupBytes);
    const preview = await browser.newPage();
    const logo = "data:image/png;base64," + (await fs.readFile(path.join(root, "assets/logo.png"))).toString("base64");
    const popupUrl = "data:image/png;base64," + popupBytes.toString("base64");
    const common = "body{margin:0;font-family:'Segoe UI','Microsoft YaHei',sans-serif;color:#171b16;background:#f7f8f2}" +
      "*{box-sizing:border-box} .pill{background:#ddff03;padding:8px 16px;border-radius:30px;font-size:16px;font-weight:700}" +
      "h1{font-size:60px;line-height:1.2;letter-spacing:-2px;margin:24px 0} p{font-size:23px;line-height:1.7;color:#69715d}" +
      ".brand{display:flex;gap:15px;align-items:center;font-size:27px;font-weight:800}.brand img{width:64px;height:64px}";
    await preview.setViewportSize({ width: 1280, height: 800 });
    await preview.setContent('<meta charset="utf-8"><style>' + common +
      ".layout{display:flex;width:1280px;height:800px;padding:62px 80px;gap:92px;align-items:center}" +
      ".copy{width:540px}.ticks{font-size:21px;line-height:2.1}.ticks b{margin-right:14px}" +
      ".product{width:384px;height:600px;border-radius:18px;box-shadow:0 20px 80px #17221926;overflow:hidden}" +
      ".note{font-size:13px;color:#858b7b;margin-top:18px}</style>" +
      '<main class="layout"><section class="copy"><div class="brand"><img src="' + logo + '">XMD · 帖子归档</div>' +
      '<h1>把值得留下的内容<br>保存成 Markdown</h1><span class="pill">当前版本全部免费</span>' +
      '<p>单帖、批量、长文和评论<br>在浏览器本地整理，下载到你的笔记库。</p>' +
      '<div class="ticks"><b>✓</b>默认全选，按需筛选<br><b>✓</b>无需账号或激活码<br><b>✓</b>不上传帖文到开发者服务器</div>' +
      '<div class="note">右侧为扩展实际界面截图 · 使用演示内容 · 只导出页面已加载的内容</div></section>' +
      '<img class="product" src="' + popupUrl + '"></main>');
    await preview.screenshot({ path: path.join(output, "screenshot-1-1280x800.png") });

    await preview.setContent('<meta charset="utf-8"><style>' + common +
      ".layout{width:1280px;height:800px;padding:56px 70px}.top{display:flex;justify-content:space-between;align-items:center}" +
      "h1{font-size:44px;margin:28px 0 12px}.cols{display:grid;grid-template-columns:1fr 1fr;gap:28px;margin-top:32px}" +
      ".panel{border:1px solid #dce1cf;border-radius:18px;background:white;padding:28px;min-height:340px}" +
      ".panel h2{margin:0 0 22px;font-size:22px}.check{padding:15px 0;border-bottom:1px solid #eceee5;font-size:19px}" +
      ".check b{display:inline-flex;align-items:center;justify-content:center;background:#ddff03;width:23px;height:23px;border-radius:5px;margin-right:12px}" +
      "pre{font:17px/1.65 Consolas,'Microsoft YaHei',monospace;white-space:pre-wrap;background:#171b16;color:#eff5e8;border-radius:12px;padding:23px;margin:0}" +
      ".foot{font-size:17px;color:#69715d;margin-top:27px}</style>" +
      '<main class="layout"><div class="top"><div class="brand"><img src="' + logo + '">XMD · 帖子归档</div>' +
      '<span class="pill">本地 Markdown 导出</span></div><h1>按需选择，内容留在自己的文件里</h1>' +
      '<p style="font-size:20px;margin:0">只保存帖子、汇总评论，或把选中的讨论追加到帖文下面。</p>' +
      '<div class="cols"><section class="panel"><h2>选择你要归档的内容</h2>' +
      '<div class="check"><b>✓</b>帖子 · 正文和来源</div><div class="check"><b>✓</b>评论 · 汇总或追加</div>' +
      '<div class="check"><b>✓</b>已展开长文 · 保留结构</div><p style="font-size:17px">批量提交期间保持弹窗打开。</p></section>' +
      '<section class="panel"><h2>输出为可编辑的 .md 文件</h2><pre>' +
      escape("# 我的阅读记录\n\n这是值得保存的正文。✨\n\n**重点内容**与原帖链接一起保留。\n\n## 评论\n\n### 读者\n这是一条选中的讨论。") +
      '</pre></section></div><div class="foot">功能示意 · 不自动遍历全部历史 · 媒体保留远程链接 · Markdown 可在常见笔记编辑器中打开</div></main>');
    await preview.screenshot({ path: path.join(output, "screenshot-2-1280x800.png") });

    await preview.setViewportSize({ width: 440, height: 280 });
    const promoArtwork = "data:image/png;base64," + (await fs.readFile(path.join(root, "store/source/promo-artwork.png"))).toString("base64");
    await preview.setContent('<meta charset="utf-8"><style>' + common +
      "body{background:#171b16;color:#ddff03}.tile{width:440px;height:280px;position:relative;overflow:hidden}" +
      ".art{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}" +
      ".copy{position:absolute;right:0;top:0;width:174px;height:100%;padding:20px 15px 20px 21px;display:flex;flex-direction:column;justify-content:center;background:linear-gradient(90deg,#171b16cc 0%,#171b16 22%)}" +
      ".brand img{width:32px;height:32px}.brand{font-size:22px;gap:8px}h1{font-size:20px;line-height:1.25;letter-spacing:-.5px;margin:18px 0 10px;color:#f5f8ef}" +
      "p{font-size:12px;line-height:1.6;color:#b8c1a8;margin:0}</style><div class=\"tile\"><img class=\"art\" src=\"" + promoArtwork +
      '\"><div class="copy"><div class="brand"><img src="' + logo + '">XMD</div><h1>把 X 帖<br>存为 Markdown</h1><p>批量 · 长文 · 评论<br>本地处理，当前免费</p></div></div>');
    await preview.screenshot({ path: path.join(output, "promo-440x280.png") });
    await fs.copyFile(path.join(root, "assets/icons/icon-128.png"), path.join(output, "icon-128.png"));
    for (const file of ["screenshot-1-1280x800.png", "screenshot-2-1280x800.png", "promo-440x280.png", "icon-128.png"]) {
      const metadata = await sharp(path.join(output, file)).metadata();
      process.stdout.write(file + " " + metadata.width + "x" + metadata.height + "\n");
    }
  } finally {
    await browser.close();
  }
}
main().catch(error => { process.stderr.write(error.stack + "\n"); process.exitCode = 1; });
