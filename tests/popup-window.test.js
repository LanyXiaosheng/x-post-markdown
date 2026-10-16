const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { chromium } = require("playwright");

async function main() {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "xmd-popup-window-"));
  const browser = await chromium.launchPersistentContext(profile, {
    executablePath: process.env.XMD_CHROMIUM || chromium.executablePath(),
    headless: true,
    args: [
      "--disable-extensions-except=" + (process.env.XMD_EXTENSION || path.resolve(__dirname, "..")),
      "--load-extension=" + (process.env.XMD_EXTENSION || path.resolve(__dirname, ".."))
    ]
  });
  try {
    const worker = browser.serviceWorkers()[0] || await browser.waitForEvent("serviceworker");
    const id = new URL(worker.url()).host;
    const bridge = await browser.newPage();
    await bridge.goto("chrome-extension://" + id + "/src/popup.html");
    await bridge.evaluate(() => chrome.action.openPopup());
    await bridge.waitForFunction(() => chrome.extension.getViews({ type: "popup" }).length > 0);
    const size = await bridge.evaluate(() => {
      const popup = chrome.extension.getViews({ type: "popup" })[0];
      const body = popup.document.body;
      return {
        width: popup.innerWidth, height: popup.innerHeight,
        bodyWidth: body.getBoundingClientRect().width,
        bodyHeight: body.getBoundingClientRect().height,
        text: body.innerText.slice(0, 80)
      };
    });
    process.stdout.write(JSON.stringify(size) + "\n");
    assert.ok(size.width >= 360, "原生弹窗宽度不能收缩为空白小块");
    assert.ok(size.height >= 400, "原生弹窗高度不能收缩");
    assert.match(size.text, /XMD/);
    const layout = await bridge.evaluate(() => {
      const popup = chrome.extension.getViews({ type: "popup" })[0];
      const root = popup.document.documentElement;
      const scrollers = Array.from(popup.document.querySelectorAll("*")).filter(node => {
        const css = popup.getComputedStyle(node);
        return css.overflowY === "auto" && node.clientHeight > 0 &&
          node.scrollHeight > node.clientHeight + 1;
      });
      const footer = popup.document.querySelector(".hint").getBoundingClientRect();
      return {
        rootFits: root.scrollHeight <= root.clientHeight + 1,
        scrollers: scrollers.map(node => node.id),
        footerVisible: footer.bottom <= popup.innerHeight,
        free: popup.document.body.innerText.includes("全部免费"),
        hasPurchase: Boolean(popup.document.getElementById("purchase"))
      };
    });
    assert.equal(layout.rootFits, true);
    assert.ok(layout.scrollers.every(id => id === "post-list"));
    assert.equal(layout.footerVisible, true);
    assert.equal(layout.free, true);
    assert.equal(layout.hasPurchase, false);
    process.stdout.write(JSON.stringify({ layout }) + "\n");
  } finally {
    await browser.close();
  }
}

main().catch(error => { process.stderr.write(error.stack + "\n"); process.exitCode = 1; });
