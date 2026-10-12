const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const markdownSource = fs.readFileSync(path.join(__dirname, "..", "src", "markdown.js"), "utf8");
const backgroundSource = fs
  .readFileSync(path.join(__dirname, "..", "src", "background.js"), "utf8")
  .replace(/^importScripts\("markdown\.js"\);\s*/u, "");

function event() {
  const target = {};
  target.addListener = (listener) => { target.listener = listener; };
  return target;
}

const chrome = {
  contextMenus: {
    onClicked: event(),
    removeAll: (callback) => callback(),
    create: () => {}
  },
  downloads: {
    download: (options, callback) => {
      chrome.downloadOptions = options;
      chrome.downloadCount = (chrome.downloadCount || 0) + 1;
      callback(99);
    }
  },
  commands: { onCommand: event() },
  tabs: { sendMessage: () => {}, query: () => {} },
  runtime: {
    onInstalled: event(),
    onStartup: event(),
    onMessage: event(),
    lastError: null
  }
};

const context = { chrome, console, Date, encodeURIComponent };
vm.runInNewContext(markdownSource, context);
vm.runInNewContext(backgroundSource, context);

const post = {
  authorName: "Ada Lovelace",
  authorUsername: "ada",
  publishedAt: "2026-10-10T08:00:00.000Z",
  url: "https://x.com/ada/status/12345",
  text: "可导出的帖子",
  media: []
};
let response;
const handled = chrome.runtime.onMessage.listener({ type: "XMD_EXPORT", post }, {}, (value) => {
  response = value;
});

assert.equal(handled, true);
assert.equal(response.ok, true);
assert.equal(chrome.downloadOptions.filename, "@ada-12345.md");
assert.equal(chrome.downloadOptions.saveAs, false);
assert.equal(chrome.downloadOptions.conflictAction, "uniquify");
assert.match(decodeURIComponent(chrome.downloadOptions.url), /可导出的帖子/);

post.title = "从 0 到 1：个人视觉 IP";
chrome.runtime.onMessage.listener({ type: "XMD_EXPORT", post }, {}, (value) => {
  response = value;
});
assert.equal(response.ok, true);
assert.equal(chrome.downloadOptions.filename, "从 0 到 1：个人视觉 IP.md");

chrome.downloadCount = 0;
const secondPost = { ...post, title: "第二篇长文", url: "https://x.com/ada/article/67890" };
chrome.runtime.onMessage.listener(
  { type: "XMD_EXPORT_BATCH", posts: [post, secondPost] },
  {},
  (value) => { response = value; }
);
assert.equal(response.ok, true);
assert.equal(response.count, 2);
assert.equal(response.failed, 0);
assert.equal(chrome.downloadCount, 2);

const comment = {
  kind: "comment",
  parentUrl: post.url,
  authorName: "评论用户",
  authorUsername: "commenter",
  text: "评论内容",
  url: "https://x.com/commenter/status/999",
  media: []
};
chrome.downloadCount = 0;
chrome.runtime.onMessage.listener(
  { type: "XMD_EXPORT_BATCH", posts: [post, comment] },
  {},
  (value) => { response = value; }
);
assert.equal(response.ok, true);
assert.equal(response.count, 1);
assert.equal(chrome.downloadOptions.filename, "从 0 到 1：个人视觉 IP.md");
assert.match(decodeURIComponent(chrome.downloadOptions.url), /评论内容/);

chrome.downloadCount = 0;
chrome.runtime.onMessage.listener(
  { type: "XMD_EXPORT_BATCH", posts: [comment, { ...comment, url: "https://x.com/commenter/status/1000" }] },
  {},
  (value) => { response = value; }
);
assert.equal(response.ok, true);
assert.equal(response.count, 1);
assert.equal(chrome.downloadOptions.filename, "评论汇总.md");
assert.match(decodeURIComponent(chrome.downloadOptions.url), /评论内容/);

const malformedPost = { authorName: "No URL", text: "仍然可导出", media: [] };
chrome.downloadCount = 0;
chrome.runtime.onMessage.listener(
  { type: "XMD_EXPORT_BATCH", posts: [malformedPost, post] },
  {},
  (value) => { response = value; }
);
assert.equal(response.ok, true);
assert.equal(response.count, 2);
assert.equal(chrome.downloadCount, 2);
