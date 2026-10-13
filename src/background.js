importScripts("config.js", "vendor/ed25519.js", "license.js", "markdown.js", "export.js");

(function initBackground() {
  "use strict";

  var MENU_ID = "xmd-export-current-post";

  function createMenu() {
    chrome.contextMenus.removeAll(function () {
      chrome.contextMenus.create({
        id: MENU_ID,
        title: "导出当前 X 帖子为 Markdown",
        contexts: ["page", "selection"],
        documentUrlPatterns: [
          "https://x.com/*",
          "https://www.x.com/*",
          "https://twitter.com/*",
          "https://mobile.twitter.com/*"
        ]
      });
    });
  }

  function runExport(jobs, sendResponse) {
    XExport.runJobs(jobs).then(sendResponse).catch(function (error) {
      sendResponse({ ok: false, count: 0, failed: jobs.length, error: error.message, errors: [error.message] });
    });
  }

  chrome.runtime.onInstalled.addListener(createMenu);
  chrome.runtime.onStartup.addListener(createMenu);

  chrome.contextMenus.onClicked.addListener(function (info, tab) {
    if (info.menuItemId !== MENU_ID || !tab || !tab.id) return;
    chrome.tabs.sendMessage(tab.id, { type: "XMD_EXPORT_CURRENT" });
  });

  chrome.commands.onCommand.addListener(function (command) {
    if (command !== "export-current-post") return;
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      if (tabs[0] && tabs[0].id) chrome.tabs.sendMessage(tabs[0].id, { type: "XMD_EXPORT_CURRENT" });
    });
  });

  chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
    if (!message) return false;
    if (message.type === "XMD_EXPORT" && message.post) {
      runExport([{ post: message.post, comments: [] }], sendResponse);
      return true;
    }
    if (message.type === "XMD_EXPORT_BATCH" && Array.isArray(message.posts)) {
      try {
        runExport(XExport.createJobs(message.posts), sendResponse);
      } catch (error) {
        sendResponse({ ok: false, count: 0, failed: 0, errors: [error.message] });
      }
      return true;
    }
    return false;
  });
})();
