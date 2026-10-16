const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");

function event() {
  return { addListener(listener) { this.listener = listener; } };
}

function setup(downloadError) {
  const calls = [];
  let pending = 0;
  let maxPending = 0;
  const chrome = {
    contextMenus: { onClicked: event(), removeAll: cb => cb(), create() {} },
    commands: { onCommand: event() },
    tabs: { sendMessage() {}, query() {} },
    runtime: { onInstalled: event(), onStartup: event(), onMessage: event(), lastError: null },
    downloads: {
      download(options, callback) {
        calls.push(options);
        pending += 1;
        maxPending = Math.max(maxPending, pending);
        const error = downloadError && downloadError(options, calls.length);
        if (error === "throw") { pending -= 1; throw new Error("同步下载异常"); }
        setTimeout(() => {
          pending -= 1;
          chrome.runtime.lastError = error ? { message: error } : null;
          callback(error ? undefined : calls.length);
          chrome.runtime.lastError = null;
        }, 2);
      }
    }
  };
  const context = vm.createContext({ chrome, setTimeout, clearTimeout });
  context.importScripts = (...files) => files.forEach(file => {
    vm.runInContext(fs.readFileSync(path.join(__dirname, "../src", file), "utf8"), context);
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../src/background.js"), "utf8"), context);
  return {
    calls, context, maxPending: () => maxPending,
    send(message) {
      return new Promise(resolve => {
        assert.equal(chrome.runtime.onMessage.listener(message, {}, resolve), true);
      });
    }
  };
}

function post(id, extra) {
  return Object.assign({
    url: "https://x.com/ada/status/" + id,
    authorUsername: "ada", text: "正文 " + id, kind: "post", media: []
  }, extra);
}

test("single-post messages still download with ID or article title", async () => {
  const app = setup();
  assert.equal((await app.send({ type: "XMD_EXPORT", post: post(1) })).ok, true);
  assert.equal(app.calls[0].filename, "@ada-1.md");
  await app.send({ type: "XMD_EXPORT", post: post(2, { title: "长文标题" }) });
  assert.equal(app.calls[1].filename, "长文标题.md");
});

test("asynchronous batch queues 40 files, including missing URLs", async () => {
  const app = setup();
  const items = Array.from({ length: 40 }, (_, i) => post(i));
  delete items[10].url;
  const result = await app.send({ type: "XMD_EXPORT_BATCH", posts: items });
  assert.equal(result.count, 40);
  assert.equal(result.failed, 0);
  assert.equal(app.maxPending(), 1);
  assert.equal(app.calls.length, 40);
});

test("download errors are reported and subsequent items still run", async () => {
  const app = setup((options, index) => index === 2 ? "File access denied" : index === 3 ? "throw" : null);
  const result = await app.send({
    type: "XMD_EXPORT_BATCH", posts: [post(1), post(2), post(3), post(4)]
  });
  assert.equal(result.count, 2);
  assert.equal(result.failed, 2);
  assert.equal(app.calls.length, 4);
  assert.match(result.errors.join(" "), /File access denied/);
  assert.match(result.errors.join(" "), /同步下载异常/);
});

test("formatting failures do not abort the following download", async () => {
  const app = setup();
  const result = await app.send({
    type: "XMD_EXPORT_BATCH", posts: [post(1, { media: { length: 1 } }), post(2)]
  });
  assert.equal(result.count, 1);
  assert.equal(result.failed, 1);
});

test("comments alone merge; combined selection attaches comments to the matching post", async () => {
  const app = setup();
  const comment = post(3, { kind: "comment", parentUrl: post(1).url, text: "评论正文" });
  await app.send({ type: "XMD_EXPORT_BATCH", posts: [comment, post(4, { kind: "comment" })] });
  assert.equal(app.calls.length, 1);
  assert.equal(app.calls[0].filename, "评论汇总.md");
  await app.send({ type: "XMD_EXPORT_BATCH", posts: [post(1), comment] });
  assert.equal(app.calls.length, 2);
  assert.match(decodeURIComponent(app.calls[1].url), /## 评论\n/);
  assert.match(decodeURIComponent(app.calls[1].url), /评论正文/);
});

test("popup runner is usable without a background message round trip", async () => {
  const app = setup();
  const result = await app.context.XExport.runJobs(app.context.XExport.createJobs([post(1), post(2)]));
  assert.equal(result.count, 2);
  assert.equal(app.calls.length, 2);
});
