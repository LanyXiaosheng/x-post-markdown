const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { chromium } = require("playwright");

async function main() {
  const extensionPath = process.env.XMD_EXTENSION || path.resolve(__dirname, "..");
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "xmd-browser-"));
  const browser = await chromium.launchPersistentContext(profile, {
    executablePath: process.env.XMD_CHROMIUM || chromium.executablePath(),
    headless: true,
    acceptDownloads: true,
    args: [
      "--disable-extensions-except=" + extensionPath,
      "--load-extension=" + extensionPath
    ]
  });
  try {
    const externalRequests = [];
    browser.on("request", request => {
      if (/^https?:/.test(request.url()) && !request.url().startsWith("https://x.com/")) {
        externalRequests.push(request.url());
      }
    });
    const downloadDir = path.join(profile, "downloads");
    fs.mkdirSync(downloadDir);
    const control = browser.pages()[0] || await browser.newPage();
    const cdp = await browser.newCDPSession(control);
    await cdp.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: downloadDir });
    const worker = browser.serviceWorkers()[0] || await browser.waitForEvent("serviceworker");
    const extensionId = new URL(worker.url()).host;
    const xPage = await browser.newPage();
    await xPage.route("https://x.com/**", route => route.fulfill({
      contentType: "text/html; charset=utf-8",
      body: '<meta charset="utf-8"><main>' + [1, 2, 3].map(index =>
        '<article data-testid="tweet"><a href="/tester" role="link">' +
        '<div dir="ltr"><span>测试作者</span></div></a>' +
        '<a href="/tester/status/' + index + '"><time datetime="2026-10-13">今天</time></a>' +
        '<div data-testid="tweetText">测试正文 ' + index + ' 😭</div><div role="group"></div></article>'
      ).join("") + "</main>"
    }));
    await xPage.goto("https://x.com/home");
    await xPage.locator(".xmd-export-button").first().waitFor();
    await xPage.locator("svg.xmd-export-icon path").first().waitFor();
    const bridge = await browser.newPage();
    await bridge.goto("chrome-extension://" + extensionId + "/src/popup.html");
    const tabId = await bridge.evaluate(async () => {
      const tabs = await chrome.tabs.query({});
      return tabs.find(tab => tab.url === "https://x.com/home").id;
    });
    const popup = await browser.newPage();
    const errors = [];
    popup.on("pageerror", error => errors.push(error.message));
    await popup.addInitScript(id => {
      chrome.tabs.query = (query, callback) => callback([{ id }]);
      chrome.runtime.sendMessage = () => { throw new Error("不应依赖批量后台消息"); };
    }, tabId);
    await popup.goto("chrome-extension://" + extensionId + "/src/popup.html");
    await popup.locator(".post-row").nth(2).waitFor();
    assert.equal(await popup.locator("input[data-post-index]:checked").count(), 3);
    assert.equal(await popup.locator("#license-panel, #activation-form, #purchase").count(), 0);
    assert.equal(await popup.evaluate(() => typeof XLicense), "undefined");
    await popup.locator("#export").click();
    await popup.waitForFunction(() => !document.querySelector("#export").disabled);
    const status = await popup.locator("#status").textContent();
    const downloads = await bridge.evaluate(() => chrome.downloads.search({}));
    assert.equal(errors.length, 0, errors.join("\n"));
    async function checkScrollLayout(panel) {
      await popup.waitForFunction(() =>
        document.documentElement.getBoundingClientRect().height <= window.innerHeight + 1);
      const layout = await popup.evaluate(panelSelector => {
        const root = document.documentElement;
        const expected = document.querySelector(panelSelector);
        const scrollers = Array.from(document.querySelectorAll("*")).filter(node => {
          const css = getComputedStyle(node);
          return (css.overflowY === "auto" || css.overflowY === "scroll") &&
            node.clientHeight > 0 && node.scrollHeight > node.clientHeight + 1;
        });
        return {
          rootFits: root.scrollHeight <= root.clientHeight + 1,
          scrollers: scrollers.map(node => node.id || node.className),
          expected: expected.id
        };
      }, panel);
      assert.equal(layout.rootFits, true, "根容器不能溢出并产生外层滚动");
      assert.ok(layout.scrollers.length <= 1, JSON.stringify(layout));
      if (layout.scrollers.length) assert.equal(layout.scrollers[0], layout.expected);
    }
    for (const height of [600, 400]) {
      await popup.setViewportSize({ width: 384, height });
      await checkScrollLayout("#post-list");
    }
    await popup.setViewportSize({ width: 384, height: 600 });
    async function setPopupZoom(factor) {
      await bridge.evaluate(async zoom => {
        const tabs = await chrome.tabs.query({});
        // This isolated profile creates the popup tab last; URL visibility does not require extra permissions.
        const target = tabs.sort((a, b) => b.id - a.id)[0];
        await chrome.tabs.setZoom(target.id, zoom);
      }, factor);
    }
    await setPopupZoom(1.5);
    await checkScrollLayout("#post-list");
    await setPopupZoom(1);
    if (process.env.XMD_PREVIEW_DIR) {
      await popup.setViewportSize({ width: 384, height: 600 });
      await popup.locator(".popup").screenshot({ path: path.join(process.env.XMD_PREVIEW_DIR, "export-panel.png") });
    }
    assert.match(status, /3 个 Markdown/);
    assert.equal(downloads.length, 3);
    for (const download of downloads) {
      assert.match(decodeURIComponent(download.url), /测试正文/);
    }
    let completedDownloads = [];
    for (let retry = 0; retry < 100; retry += 1) {
      completedDownloads = await popup.evaluate(() => chrome.downloads.search({}));
      if (completedDownloads.length === 3 && completedDownloads.every(file => file.state === "complete")) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.ok(completedDownloads.every(file => file.state === "complete"), "下载应完成");
    for (const download of completedDownloads) {
      const content = fs.readFileSync(download.filename, "utf8");
      assert.match(content, /测试正文/);
      assert.doesNotMatch(content, /chrome-extension:|assets\/logo\.svg/);
    }
    await xPage.goto("https://x.com/tester/status/1");
    await xPage.locator(".xmd-export-button").first().waitFor();
    await popup.reload();
    await popup.locator(".post-row").nth(2).waitFor();
    assert.equal(await popup.locator("#post-count").textContent(), "1");
    assert.equal(await popup.locator("#comment-count").textContent(), "2");

    async function exportSelection(expectedTotal, expectedContent) {
      await popup.locator("#export").click();
      await popup.waitForFunction(() => !document.querySelector("#export").disabled);
      let files = [];
      for (let retry = 0; retry < 100; retry += 1) {
        files = await bridge.evaluate(() => chrome.downloads.search({}));
        if (files.length === expectedTotal && files.every(file => file.state === "complete")) break;
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      assert.equal(files.length, expectedTotal);
      assert.ok(files.every(file => file.state === "complete"));
      const latest = files.sort((a, b) => b.id - a.id)[0];
      const content = fs.readFileSync(latest.filename, "utf8");
      assert.match(content, expectedContent);
      return content;
    }

    await popup.locator("#filter-comment").uncheck();
    assert.equal(await popup.locator(".post-row:visible").count(), 1);
    const onlyPost = await exportSelection(4, /测试正文 1/);
    assert.doesNotMatch(onlyPost, /测试正文 2/);
    await popup.locator("#filter-post").uncheck();
    await popup.locator("#filter-comment").check();
    const onlyComments = await exportSelection(5, /# 评论汇总/);
    assert.match(onlyComments, /测试正文 2/);
    assert.match(onlyComments, /测试正文 3/);
    await popup.locator("#filter-post").check();
    const combined = await exportSelection(6, /## 评论/);
    assert.match(combined, /测试正文 1/);
    assert.match(combined, /测试正文 2/);
    assert.match(combined, /测试正文 3/);

    await xPage.evaluate(() => {
      const article = document.querySelector('article[data-testid="tweet"]');
      const title = document.createElement("h1");
      title.dataset.testid = "twitter-article-title";
      title.textContent = "免费长文";
      article.appendChild(title);
      const block = document.createElement("div");
      block.className = "longform-unstyled";
      block.setAttribute("data-offset-key", "free-article");
      block.textContent = "完整长文正文";
      article.appendChild(block);
    });
    await popup.reload();
    await popup.locator(".post-row").nth(2).waitFor();
    await popup.locator("#filter-comment").uncheck();
    const longArticle = await exportSelection(7, /# 免费长文/);
    assert.match(longArticle, /完整长文正文/);

    await popup.evaluate(() => {
      chrome.downloads.download = () => { throw new Error("测试下载权限错误"); };
    });
    await popup.locator("#export").click();
    await popup.waitForFunction(() => !document.querySelector("#export").disabled);
    assert.match(await popup.locator("#status").textContent(), /测试下载权限错误/);
    assert.equal(errors.length, 0, errors.join("\n"));
    process.stdout.write(JSON.stringify({
      version: await popup.locator("#version").textContent(),
      status, completedFiles: 7,
      checks: ["无需授权批量落盘", "仅帖子", "仅评论", "帖子附带评论", "免费长文", "错误详情", "无授权网络请求"],
      errors
    }) + "\n");
    assert.deepEqual(externalRequests, []);
  } finally {
    await browser.close();
  }
}

main().catch(error => {
  process.stderr.write(error.stack + "\n");
  process.exitCode = 1;
});
