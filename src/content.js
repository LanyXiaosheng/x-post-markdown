(function initContent() {
  "use strict";

  var hoveredArticle = null;
  var BUTTON_ATTR = "data-xmd-export-button";

  function firstText(root, selector) {
    var node = root.querySelector(selector);
    return node ? XMarkdown.cleanText(node.innerText || node.textContent) : "";
  }

  function getPostUrl(article, isArticle) {
    var selector = isArticle
      ? 'a[href*="/article/"], a[href*="/status/"]'
      : 'a[href*="/status/"]';
    var link = article.querySelector(selector);
    if (!link) return window.location.href;
    return new URL(link.getAttribute("href"), window.location.origin).href.split("?")[0];
  }

  function getAuthor(article) {
    var link = article.querySelector('a[href^="/"][role="link"]');
    var username = "";
    if (link) {
      var match = link.getAttribute("href").match(/^\/([^/]+)/);
      username = match ? match[1] : "";
    }
    var spans = Array.from(article.querySelectorAll('div[dir="ltr"] span'));
    var authorName = spans.length ? XMarkdown.cleanText(spans[0].innerText) : username;
    return { authorName: authorName, authorUsername: username };
  }

  function getMedia(article, body) {
    var items = [];
    var seen = {};
    article.querySelectorAll('img[src]').forEach(function (image) {
      if (image.closest(".xmd-export-button")) return;
      var src = image.currentSrc || image.src;
      var isAvatar = image.closest(
        '[data-testid="UserAvatar-Container"], [data-testid="Tweet-User-Avatar"], [data-testid="User-Name"]'
      );
      if (!src || seen[src] || isAvatar || /avatar|头像/i.test(image.alt || "")) return;
      if (XMarkdown.isEmojiText(image.alt)) return;
      if (body && body.indexOf(src) >= 0) return;
      seen[src] = true;
      items.push({ type: "image", url: src, alt: image.alt || "X 帖子图片" });
    });
    article.querySelectorAll("video").forEach(function (video) {
      var src = video.poster || video.src;
      if (src && !seen[src]) {
        seen[src] = true;
        items.push({ type: "video", url: src, alt: "X 帖子视频" });
      }
    });
    return items;
  }

  function findArticleTitle(article) {
    var title = article.querySelector(
      '[data-testid="twitter-article-title"], [data-testid="article-title"]'
    );
    return title ? XMarkdown.cleanText(title.innerText || title.textContent) : "";
  }

  function findArticleBody(article) {
    var blocks = [];
    var seenOffsets = {};
    article.querySelectorAll('[class*="longform-"]').forEach(function (block) {
      var offset = block.getAttribute("data-offset-key");
      if (!offset || seenOffsets[offset]) return;
      seenOffsets[offset] = true;
      blocks.push(block);
    });
    if (blocks.length) {
      var items = [];
      article.querySelectorAll('[class*="longform-"], table, img[src], video').forEach(function (node) {
        if (node.closest(".xmd-export-button")) return;
        var blockIndex = blocks.indexOf(node);
        if (blockIndex >= 0) {
          items.push({ kind: "block", node: node });
          return;
        }
        var insideBlock = blocks.some(function (block) {
          return block.contains(node);
        });
        if (insideBlock) return;
        if (node.tagName === "IMG") {
          var isAvatar = node.closest(
            '[data-testid="UserAvatar-Container"], [data-testid="Tweet-User-Avatar"], [data-testid="User-Name"]'
          );
          if (isAvatar || /avatar|头像/i.test(node.alt || "")) return;
          if (XMarkdown.isEmojiText(node.alt)) return;
          items.push({ kind: "image", node: node });
          return;
        }
        if (node.tagName === "VIDEO") {
          items.push({ kind: "video", node: node });
          return;
        }
        if (node.tagName === "TABLE") items.push({ kind: "table", node: node });
      });
      return XMarkdown.richContentToMarkdown(items);
    }

    var body = article.querySelector(
      '[data-testid="twitter-article-body"], [data-testid="twitter-article-content"], [data-testid="article-content"]'
    );
    return body ? XMarkdown.htmlToMarkdown(body) : "";
  }

  function extractPost(article) {
    if (!article) return null;
    var author = getAuthor(article);
    var time = article.querySelector("time");
    var title = findArticleTitle(article);
    var richBody = title ? findArticleBody(article) : "";
    var tweetText = article.querySelector('[data-testid="tweetText"]');
    var body = richBody || (tweetText ? XMarkdown.htmlToMarkdown(tweetText) : "");
    var quoteArticle = article.querySelector('[data-testid="tweet"] [data-testid="tweet"]');
    var post = {
      title: title,
      body: body,
      text: body || firstText(article, '[data-testid="tweetText"]'),
      authorName: author.authorName,
      authorUsername: author.authorUsername,
      publishedAt: time ? time.getAttribute("datetime") || XMarkdown.cleanText(time.innerText) : "",
      url: getPostUrl(article, Boolean(title)),
      media: title && richBody ? [] : getMedia(article, body)
    };
    if (quoteArticle && quoteArticle !== article) {
      post.quote = {
        text: firstText(quoteArticle, '[data-testid="tweetText"]'),
        url: getPostUrl(quoteArticle, false)
      };
    }
    if (!post.text) {
      post.text = XMarkdown.cleanText(article.innerText).replace(/^(赞|回复|转发|喜欢|分享).*$/gm, "").trim();
    }
    return post;
  }

  function findCurrentArticle() {
    if (hoveredArticle && document.contains(hoveredArticle)) return hoveredArticle;
    var articleTitle = document.querySelector(
      '[data-testid="twitter-article-title"], [data-testid="article-title"]'
    );
    if (articleTitle) {
      var article = articleTitle.closest("article");
      if (article) return article;
    }
    var detail = document.querySelector('main article[data-testid="tweet"]');
    return detail || document.querySelector('article[data-testid="tweet"]');
  }

  function notify(message, isError) {
    var previous = document.querySelector(".xmd-toast");
    if (previous) previous.remove();
    var toast = document.createElement("div");
    toast.className = "xmd-toast" + (isError ? " xmd-toast-error" : "");
    toast.setAttribute("role", isError ? "alert" : "status");
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(function () { toast.remove(); }, 5000);
  }

  function requestExport(article) {
    var target = article || findCurrentArticle();
    var post = extractPost(target);
    if (!post || (!post.text && !post.url)) {
      notify("没有找到可导出的帖子，请打开帖子详情页后重试。", true);
      return;
    }
    var articles = Array.from(document.querySelectorAll('article[data-testid="tweet"]'));
    post.kind = isCommentArticle(target, articles.indexOf(target), isDetailPage()) ? "comment" : "post";
    chrome.runtime.sendMessage({ type: "XMD_EXPORT", post: post }, function (response) {
      if (chrome.runtime.lastError || !response || !response.ok) {
        notify(response && response.error || "导出失败，请刷新 X 页面后重试。", true);
      } else {
        notify("Markdown 已开始下载", false);
      }
    });
  }

  function createExportButton(article) {
    var button = document.createElement("button");
    button.type = "button";
    button.className = "xmd-export-button";
    button.setAttribute("aria-label", "导出为 Markdown");
    button.title = "导出这条 X 帖子为 Markdown";
    var icon = document.createElement("img");
    icon.className = "xmd-export-icon";
    icon.src = chrome.runtime.getURL("assets/logo.svg");
    icon.alt = "";
    icon.setAttribute("aria-hidden", "true");
    icon.width = 24;
    icon.height = 24;
    button.appendChild(icon);
    button.addEventListener("click", function (event) {
      event.preventDefault();
      event.stopPropagation();
      requestExport(article);
    });
    return button;
  }

  function findHeaderAnchor(article) {
    var selectors = [
      '[data-testid="caret"]',
      '[role="button"][aria-label*="更多"]',
      'button[aria-label*="更多"]',
      '[role="button"][aria-label*="More"]',
      'button[aria-label*="More"]'
    ];
    for (var index = 0; index < selectors.length; index += 1) {
      var anchor = article.querySelector(selectors[index]);
      if (anchor && anchor.parentElement) return anchor;
    }
    return null;
  }

  function addButton(article) {
    if (article.hasAttribute(BUTTON_ATTR)) return;
    article.setAttribute(BUTTON_ATTR, "true");
    article.addEventListener("mouseenter", function () {
      hoveredArticle = article;
    });
    var button = createExportButton(article);
    var headerAnchor = findHeaderAnchor(article);
    if (headerAnchor && headerAnchor.parentElement) {
      headerAnchor.parentElement.insertBefore(button, headerAnchor);
      return;
    }
    var actions = article.querySelector('[role="group"]');
    (actions || article).appendChild(button);
  }

  function scanTweets() {
    document.querySelectorAll('article[data-testid="tweet"]').forEach(addButton);
  }

  function isDetailPage() {
    return /\/(?:status|article)\/\d+/.test(window.location.pathname);
  }

  function isCommentArticle(article, index, detailPage) {
    var articleText = article.innerText || "";
    var explicitReply = /(?:^|\n)\s*(?:Replying to|回复给|回复\s*@)/i.test(articleText);
    return explicitReply || (detailPage && index > 0);
  }

  function collectVisiblePosts() {
    var seen = {};
    var posts = [];
    var parentUrl = "";
    var detailPage = isDetailPage();
    document.querySelectorAll('article[data-testid="tweet"]').forEach(function (article) {
      if (article.parentElement && article.parentElement.closest('article[data-testid="tweet"]')) return;
      var post = extractPost(article);
      var key = post && post.url ? post.url : "";
      if (!post || seen[key] || (!post.text && !post.title && !post.url)) return;
      post.kind = isCommentArticle(article, posts.length, detailPage) ? "comment" : "post";
      if (post.kind === "post") {
        parentUrl = post.url;
      } else {
        post.parentUrl = parentUrl;
      }
      seen[key] = true;
      posts.push(post);
    });
    return posts;
  }

  chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
    if (message && message.type === "XMD_LIST_POSTS") {
      sendResponse({ ok: true, posts: collectVisiblePosts() });
      return true;
    }
    if (message && message.type === "XMD_EXPORT_CURRENT") {
      requestExport();
      sendResponse({ ok: true });
    }
    return false;
  });

  scanTweets();
  new MutationObserver(scanTweets).observe(document.body, { childList: true, subtree: true });
})();
