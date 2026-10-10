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
