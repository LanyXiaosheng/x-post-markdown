importScripts("markdown.js");

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

  function downloadPost(post, sendResponse) {
    var markdown = XMarkdown.formatPost(post);
    var username = post.authorUsername ? "@" + post.authorUsername : "x-post";
    var statusId = (post.url.match(/(?:status|article)\/(\d+)/) || [])[1] || Date.now();
    var filenameBase = post.title || username + "-" + statusId;
    var filename = XMarkdown.safeFilename(filenameBase) + ".md";
    var url = "data:text/markdown;charset=utf-8," + encodeURIComponent(markdown);
    chrome.downloads.download({
      url: url,
      filename: filename,
      saveAs: false,
      conflictAction: "uniquify"
    }, function (downloadId) {
      if (chrome.runtime.lastError) {
        sendResponse({ ok: false, error: chrome.runtime.lastError.message });
        return;
      }
      sendResponse({ ok: Boolean(downloadId) });
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
      downloadPost(message.post, sendResponse);
      return true;
    }
    return false;
  });
})();
