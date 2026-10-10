(function initMarkdown(global) {
  "use strict";

  var FENCE = String.fromCharCode(96).repeat(3);
  var INLINE_FENCE = String.fromCharCode(96);

  function cleanText(value) {
    return (value || "")
      .replace(/\u00a0/g, " ")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  function escapeFrontmatter(value) {
    return String(value || "")
      .replace(/\\/g, "\\\\")
      .replace(/"/g, '\\"')
      .replace(/\n/g, " ");
  }

  function safeFilename(value) {
    var filename = (value || "x-post").replace(/[<>:"/\\|?*\x00-\x1F]/g, "-");
    return filename.replace(/\s+/g, " ").trim().slice(0, 100) || "x-post";
  }

  function getAttribute(node, name) {
    return node && node.getAttribute ? node.getAttribute(name) || "" : "";
  }

  function renderInline(node) {
    if (!node) return "";
    if (node.nodeType === 3) return node.nodeValue.replace(/\s+/g, " ");
    if (node.nodeType !== 1) return "";

    var tag = (node.tagName || "").toLowerCase();
    if (tag === "br") return "\n";
    if (tag === "table") return tableToMarkdown(node);
    if (tag === "video") {
      var videoUrl = getAttribute(node, "poster") || getAttribute(node, "src") || node.poster || node.src || "";
      return videoUrl ? "[视频](" + videoUrl + ")" : "";
    }
    if (tag === "img") {
      var imageUrl = getAttribute(node, "src");
      return imageUrl ? "![" + (getAttribute(node, "alt") || "图片") + "](" + imageUrl + ")" : "";
    }

    var content = Array.prototype.map.call(node.childNodes || [], renderInline).join("");
    var href = getAttribute(node, "href");
    var style = getAttribute(node, "style").toLowerCase();
    var className = typeof node.className === "string" ? node.className.toLowerCase() : "";
    var isBold = tag === "strong" || tag === "b" ||
      style.indexOf("font-weight") >= 0 && style.indexOf("bold") >= 0 ||
      className.indexOf("bold") >= 0;
    var isItalic = tag === "em" || tag === "i" ||
      style.indexOf("font-style") >= 0 && style.indexOf("italic") >= 0 ||
      className.indexOf("italic") >= 0;

    if (tag === "a" && href) {
      var linkText = cleanText(content) || href;
      return linkText === href ? href : "[" + linkText + "](" + href + ")";
    }
    if (tag === "code" && content.indexOf("\n") < 0) {
      return INLINE_FENCE + content.trim() + INLINE_FENCE;
    }
    if (tag === "del" || tag === "s") content = "~~" + content + "~~";
    if (isBold && content.trim()) content = "**" + content.trim() + "**";
    if (isItalic && content.trim()) content = "*" + content.trim() + "*";
    return content;
  }

  function renderInlineChildren(node) {
    return Array.prototype.map.call(node.childNodes || [], renderInline).join("");
  }

  function tableToMarkdown(table) {
    var rows = Array.prototype.map.call(table.querySelectorAll("tr"), function (row) {
      var cells = Array.prototype.map.call(row.querySelectorAll("th,td"), function (cell) {
        return cleanText(renderInlineChildren(cell)).replace(/\|/g, "\\|").replace(/\n/g, " ");
      });
      return cells.length ? cells : null;
    }).filter(Boolean);
    if (!rows.length) return "";
    var columnCount = rows.reduce(function (count, row) {
      return Math.max(count, row.length);
    }, 0);
    rows = rows.map(function (row) {
      while (row.length < columnCount) row.push("");
      return row;
    });
    var output = ["| " + rows[0].join(" | ") + " |"];
    output.push("| " + rows[0].map(function () { return "---"; }).join(" | ") + " |");
    rows.slice(1).forEach(function (row) {
      output.push("| " + row.join(" | ") + " |");
    });
    return output.join("\n") + "\n\n";
  }

  function renderBlock(node) {
    if (!node) return "";
    if (node.nodeType === 3) return cleanText(node.nodeValue);
    if (node.nodeType !== 1) return "";

    var tag = (node.tagName || "").toLowerCase();
    if (tag === "table") return tableToMarkdown(node);
    if (/^h[1-6]$/.test(tag)) {
      return "#".repeat(Number(tag.slice(1))) + " " + cleanText(renderInlineChildren(node)) + "\n\n";
    }
    if (tag === "hr") return "---\n\n";
    if (tag === "pre") return FENCE + "\n" + (node.textContent || "").trim() + "\n" + FENCE + "\n\n";
    if (tag === "blockquote") {
      return cleanText(renderInlineChildren(node)).split("\n").map(function (line) {
        return "> " + line;
      }).join("\n") + "\n\n";
    }
    if (tag === "ul" || tag === "ol") {
      var ordered = tag === "ol";
      var index = 0;
      return Array.prototype.map.call(node.children || [], function (child) {
        index += 1;
        var prefix = ordered ? index + ". " : "- ";
        return prefix + cleanText(renderInlineChildren(child));
      }).join("\n") + "\n\n";
    }
    if (tag === "li") return cleanText(renderInlineChildren(node)) + "\n";
    if (tag === "p") return cleanText(renderInlineChildren(node)) + "\n\n";
    if (tag === "div" || tag === "section" || tag === "article" || tag === "main") {
      return Array.prototype.map.call(node.childNodes || [], renderBlock).join("");
    }
    return renderInline(node);
  }

  function htmlToMarkdown(root) {
    if (!root) return "";
    return cleanText(Array.prototype.map.call(root.childNodes || [], renderBlock).join(""));
  }

  function blockType(block) {
    var className = typeof block.className === "string" ? block.className : "";
    var match = className.match(/longform-([a-z0-9-]+)/i);
    return match ? match[1].toLowerCase() : "unstyled";
  }

  function richBlockToMarkdown(block) {
    var text = cleanText(renderInlineChildren(block));
    if (!text) return "";
    var type = blockType(block);
    var depth = Number(getAttribute(block, "data-depth")) || 0;
    var indent = "  ".repeat(depth);
    if (type.indexOf("header-one") >= 0) return "# " + text;
    if (type.indexOf("header-two") >= 0) return "## " + text;
    if (type.indexOf("header-three") >= 0) return "### " + text;
    if (type.indexOf("blockquote") >= 0) return "> " + text.replace(/\n/g, "\n> ");
    if (type.indexOf("unordered-list-item") >= 0) return indent + "- " + text;
    if (type.indexOf("ordered-list-item") >= 0) return indent + "1. " + text;
    if (type.indexOf("code-block") >= 0) return FENCE + "\n" + text + "\n" + FENCE;
    return text;
  }

  function richBlocksToMarkdown(blocks) {
    return blocks.map(richBlockToMarkdown).filter(Boolean).join("\n\n");
  }

  function richContentToMarkdown(items) {
    return items.map(function (item) {
      if (item.kind === "block") return richBlockToMarkdown(item.node);
      if (item.kind === "table") return tableToMarkdown(item.node);
      if (item.kind === "image") return renderInline(item.node);
      if (item.kind === "video") {
        var videoUrl = getAttribute(item.node, "poster") ||
          getAttribute(item.node, "src") || item.node.poster || item.node.src || "";
        return videoUrl ? "[视频](" + videoUrl + ")" : "";
      }
      return "";
    }).filter(Boolean).join("\n\n");
  }

  function formatPost(post) {
    var body = cleanText(post.body || post.text);
    var heading = post.title || post.authorName || post.authorUsername || "X 帖子";
    var lines = ["---"];
    lines.push('author: "' + escapeFrontmatter(post.authorName || post.authorUsername || "") + '"');
    lines.push('username: "' + escapeFrontmatter(post.authorUsername || "") + '"');
    lines.push('published: "' + escapeFrontmatter(post.publishedAt || "") + '"');
    lines.push('url: "' + escapeFrontmatter(post.url || "") + '"');
    lines.push('source: "X"');
    lines.push("---", "", "# " + heading);
    if (post.publishedAt) lines.push("", "> " + post.publishedAt);
    if (post.title && post.authorName) lines.push("", "作者：@" + (post.authorUsername || post.authorName));
    lines.push("", body || "（帖子没有可提取的正文）");

    if (post.media && post.media.length) {
      lines.push("", "## 媒体");
      post.media.forEach(function (item) {
        if (item.type === "video") {
          lines.push("", "[视频](" + item.url + ")");
        } else {
          lines.push("", "![" + (item.alt || "X 帖子图片") + "](" + item.url + ")");
        }
      });
    }

    if (post.quote && post.quote.text) {
      lines.push("", "## 引用帖子", "", "> " + post.quote.text.replace(/\n/g, "\n> "));
      if (post.quote.url) lines.push(">", "> [查看原帖](" + post.quote.url + ")");
    }

    lines.push("", "---", "", "导出时间：" + new Date().toISOString());
    return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
  }

  global.XMarkdown = {
    cleanText: cleanText,
    formatPost: formatPost,
    htmlToMarkdown: htmlToMarkdown,
    richContentToMarkdown: richContentToMarkdown,
    richBlocksToMarkdown: richBlocksToMarkdown,
    safeFilename: safeFilename
  };
})(typeof globalThis !== "undefined" ? globalThis : window);
