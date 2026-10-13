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
    await bridge.evaluate(() => {
      const popup = chrome.extension.getViews({ type: "popup" })[0];
      popup.document.getElementById("tab-license").click();
    });
    const proLayout = await bridge.evaluate(() => {
      const popup = chrome.extension.getViews({ type: "popup" })[0];
      const root = popup.document.documentElement;
      const panel = popup.document.getElementById("license-panel");
      const scrollers = Array.from(popup.document.querySelectorAll("*")).filter(node => {
        const css = popup.getComputedStyle(node);
        return css.overflowY === "auto" && node.clientHeight > 0 &&
          node.scrollHeight > node.clientHeight + 1;
      });
      panel.scrollTop = panel.scrollHeight;
      const privacy = popup.document.querySelector(".privacy-note").getBoundingClientRect();
      return {
        rootFits: root.scrollHeight <= root.clientHeight + 1,
        scrollers: scrollers.map(node => node.id),
        footerVisible: privacy.bottom <= popup.innerHeight
      };
    });
    assert.equal(proLayout.rootFits, true);
    assert.deepEqual(proLayout.scrollers, ["license-panel"]);
    assert.equal(proLayout.footerVisible, true);
    process.stdout.write(JSON.stringify({ proLayout }) + "\n");
  } finally {
    await browser.close();
  }
}

main().catch(error => { process.stderr.write(error.stack + "\n"); process.exitCode = 1; });
