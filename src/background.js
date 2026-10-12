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

  function downloadMarkdown(markdown, filenameBase, callback) {
    try {
      var filename = XMarkdown.safeFilename(filenameBase) + ".md";
      var url = "data:text/markdown;charset=utf-8," + encodeURIComponent(markdown);
      chrome.downloads.download({
        url: url,
        filename: filename,
        saveAs: false,
        conflictAction: "uniquify"
      }, function (downloadId) {
        if (chrome.runtime.lastError) {
          callback({ ok: false, error: chrome.runtime.lastError.message });
          return;
        }
        callback({ ok: Boolean(downloadId) });
      });
    } catch (error) {
      callback({ ok: false, error: error.message || String(error) });
    }
  }

  function downloadPost(post, comments, callback) {
    if (typeof comments === "function") {
      callback = comments;
      comments = [];
    }
    try {
      var data = Object.assign({}, post || {});
      data.comments = comments || [];
      var markdown = XMarkdown.formatPost(data);
      var username = data.authorUsername ? "@" + data.authorUsername : "x-post";
      var postUrl = typeof data.url === "string" ? data.url : "";
      var statusId = (postUrl.match(/(?:status|article)\/(\d+)/) || [])[1] || Date.now();
      var filenameBase = data.title || username + "-" + statusId;
      downloadMarkdown(markdown, filenameBase, callback);
    } catch (error) {
      callback({ ok: false, error: error.message || String(error) });
    }
  }

  function downloadComments(comments, callback) {
    downloadMarkdown(XMarkdown.formatComments(comments), "评论汇总", callback);
  }

  function groupComments(posts, comments) {
    var groups = posts.map(function (post) {
      return { post: post, comments: [] };
    });
    comments.forEach(function (comment) {
      var target = groups.find(function (group) {
        return comment.parentUrl && group.post.url === comment.parentUrl;
      });
      (target || groups[0]).comments.push(comment);
    });
    return groups;
  }

  function downloadJobs(jobs, sendResponse) {
    var index = 0;
    var succeeded = 0;
    var failed = 0;

    function next() {
      if (index >= jobs.length) {
        sendResponse({ ok: failed === 0, count: succeeded, failed: failed });
        return;
      }
      var job = jobs[index];
      index += 1;
      var done = function (result) {
        if (result.ok) succeeded += 1;
        else failed += 1;
        next();
      };
      if (job.type === "comments") downloadComments(job.comments, done);
      else downloadPost(job.post, job.comments, done);
    }

    if (!jobs.length) {
      sendResponse({ ok: false, count: 0, failed: 0 });
      return;
    }
    next();
  }

  function downloadBatch(posts, sendResponse) {
    var selectedPosts = posts.filter(function (post) {
      return post.kind !== "comment";
    });
    var selectedComments = posts.filter(function (post) {
      return post.kind === "comment";
    });
    if (!selectedPosts.length && selectedComments.length) {
      downloadJobs([{ type: "comments", comments: selectedComments }], sendResponse);
      return;
    }
    downloadJobs(groupComments(selectedPosts, selectedComments), sendResponse);
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
    if (message.type === "XMD_EXPORT_BATCH" && Array.isArray(message.posts)) {
      downloadBatch(message.posts, sendResponse);
      return true;
    }
    return false;
  });
})();
