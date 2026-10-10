const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "..", "src", "markdown.js"), "utf8");
const context = { globalThis: {} };
vm.runInNewContext(source, context);
const { formatPost, safeFilename } = context.globalThis.XMarkdown;

function element(tagName, className, children, attributes) {
  const values = attributes || {};
  return {
    nodeType: 1,
    tagName: tagName.toUpperCase(),
    className: className || "",
    childNodes: children || [],
    getAttribute(name) {
      return values[name] || "";
    }
  };
}

function text(value) {
  return { nodeType: 3, nodeValue: value };
}

const richMarkdown = context.globalThis.XMarkdown.richBlocksToMarkdown([
  element("div", "longform-header-two", [text("配图规则")]),
  element("div", "longform-unstyled", [
    element("span", "", [text("重点内容")], { style: "font-weight: bold" })
  ]),
  element("div", "longform-unordered-list-item", [text("列表项")])
]);

assert.equal(richMarkdown, "## 配图规则\n\n**重点内容**\n\n- 列表项");

const headerCell = element("th", "", [text("项目")]);
const valueCell = element("td", "", [text("说明")]);
headerCell.querySelectorAll = () => [];
valueCell.querySelectorAll = () => [];
const headerRow = element("tr", "", [headerCell]);
const valueRow = element("tr", "", [valueCell]);
headerRow.querySelectorAll = () => headerRow.childNodes;
valueRow.querySelectorAll = () => valueRow.childNodes;
const table = element("table", "", [headerRow, valueRow]);
table.querySelectorAll = () => table.childNodes;
const tableRoot = { childNodes: [table] };
assert.match(context.globalThis.XMarkdown.htmlToMarkdown(tableRoot), /\| 项目 \|/);
assert.match(context.globalThis.XMarkdown.htmlToMarkdown(tableRoot), /\| --- \|/);

const markdown = formatPost({
  title: "文章标题",
  authorName: "Ada Lovelace",
  authorUsername: "ada",
  publishedAt: "2026-10-10T08:00:00.000Z",
  url: "https://x.com/ada/status/12345",
  text: "第一行\n第二行",
  media: [{ type: "image", url: "https://pbs.twimg.com/a.jpg", alt: "图" }]
});

assert.match(markdown, /^---/);
assert.match(markdown, /# 文章标题/);
assert.match(markdown, /author: "Ada Lovelace"/);
assert.match(markdown, /第一行\n第二行/);
assert.match(markdown, /!\[图\]\(https:\/\/pbs.twimg.com\/a\.jpg\)/);
assert.equal(safeFilename("@ada-12345"), "@ada-12345");
assert.equal(safeFilename("bad/name?.md"), "bad-name-.md");
