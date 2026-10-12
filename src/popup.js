(function initPopup() {
  "use strict";

  var exportButton = document.getElementById("export");
  var selectAll = document.getElementById("select-all");
  var filterPost = document.getElementById("filter-post");
  var filterComment = document.getElementById("filter-comment");
  var postCount = document.getElementById("post-count");
  var commentCount = document.getElementById("comment-count");
  var postList = document.getElementById("post-list");
  var scanTitle = document.getElementById("scan-title");
  var status = document.getElementById("status");
  var posts = [];

  function setStatus(message, isError) {
    status.textContent = message;
    status.className = "status" + (isError ? " error" : "");
  }

  function postKind(post) {
    return post.kind === "comment" ? "comment" : "post";
  }

  function postLabel(post) {
    if (post.title) return post.title;
    if (post.authorName) return post.authorName + (post.authorUsername ? " @" + post.authorUsername : "");
    return post.authorUsername ? "@" + post.authorUsername : "X 内容";
  }

  function postSummary(post) {
    var value = post.body || post.text || "（无可见正文）";
    return value.replace(/\s+/g, " ").trim().slice(0, 120);
  }

  function isKindVisible(kind) {
    return kind === "comment" ? filterComment.checked : filterPost.checked;
  }

  function visibleInputs() {
    return Array.from(postList.querySelectorAll("input[data-post-index]")).filter(function (input) {
      return !input.closest(".post-row").hidden;
    });
  }

  function selectedPosts() {
    return visibleInputs().filter(function (input) {
      return input.checked;
    }).map(function (input) {
      return posts[Number(input.getAttribute("data-post-index"))];
    });
  }

  function syncSelection() {
    var visible = visibleInputs();
    var selected = selectedPosts();
    selectAll.checked = visible.length > 0 && selected.length === visible.length;
    selectAll.indeterminate = selected.length > 0 && selected.length < visible.length;
    exportButton.disabled = selected.length === 0;
    exportButton.textContent = selected.length
      ? "导出选中内容（" + selected.length + "）"
      : "导出选中内容";
  }

  function applyFilters() {
    postList.querySelectorAll(".post-row").forEach(function (row) {
      row.hidden = !isKindVisible(row.getAttribute("data-kind"));
    });
    syncSelection();
  }

  function renderPosts() {
    postList.textContent = "";
    var postTotal = posts.filter(function (post) { return postKind(post) === "post"; }).length;
    var commentTotal = posts.length - postTotal;
    postCount.textContent = String(postTotal);
    commentCount.textContent = String(commentTotal);
    scanTitle.textContent = "识别到 " + posts.length + " 条内容";
    if (!posts.length) {
      var empty = document.createElement("div");
      empty.className = "empty";
      empty.textContent = "当前页面没有识别到可导出的内容。";
      postList.appendChild(empty);
      selectAll.checked = false;
      selectAll.indeterminate = false;
      syncSelection();
      return;
    }

    posts.forEach(function (post, index) {
      var kind = postKind(post);
      var row = document.createElement("label");
      row.className = "post-row";
      row.setAttribute("data-kind", kind);
      var checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = true;
      checkbox.setAttribute("data-post-index", String(index));
      checkbox.addEventListener("change", syncSelection);

      var copy = document.createElement("span");
      copy.className = "post-copy";
      var title = document.createElement("span");
      title.className = "post-title";
      var badge = document.createElement("span");
      badge.className = "post-kind" + (kind === "comment" ? " comment" : "");
      badge.textContent = kind === "comment" ? "评论" : "帖子";
      title.appendChild(badge);
      title.appendChild(document.createTextNode(postLabel(post)));
      var summary = document.createElement("span");
      summary.className = "post-summary";
      summary.textContent = postSummary(post);
      copy.appendChild(title);
      copy.appendChild(summary);
      row.appendChild(checkbox);
      row.appendChild(copy);
      postList.appendChild(row);
    });
    applyFilters();
  }

  function findActiveTab(callback) {
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      var tab = tabs[0];
      if (!tab || !tab.id) {
        setStatus("没有找到当前标签页。", true);
        callback(null);
        return;
      }
      callback(tab);
    });
  }

  function scanCurrentPage() {
    findActiveTab(function (tab) {
      if (!tab) return;
      chrome.tabs.sendMessage(tab.id, { type: "XMD_LIST_POSTS" }, function (response) {
        if (chrome.runtime.lastError || !response || !response.ok) {
          scanTitle.textContent = "无法识别当前页面";
          setStatus("请打开 X 页面并刷新后重试。", true);
          return;
        }
        posts = response.posts || [];
        renderPosts();
        setStatus(posts.length ? "帖子和评论默认全选，可用上方筛选。" : "请滚动页面加载内容后重试。", false);
      });
    });
  }

  selectAll.addEventListener("change", function () {
    visibleInputs().forEach(function (input) {
      input.checked = selectAll.checked;
    });
    syncSelection();
  });

  filterPost.addEventListener("change", applyFilters);
  filterComment.addEventListener("change", applyFilters);

  exportButton.addEventListener("click", function () {
    var selected = selectedPosts();
    if (!selected.length) return;
    exportButton.disabled = true;
    setStatus("正在按类型导出 " + selected.length + " 条内容…", false);
    chrome.runtime.sendMessage({ type: "XMD_EXPORT_BATCH", posts: selected }, function (response) {
      if (chrome.runtime.lastError || !response) {
        setStatus("批量导出失败，请刷新 X 页面后重试。", true);
        exportButton.disabled = false;
        return;
      }
      if (response.ok) {
        setStatus("已开始下载 " + response.count + " 个 Markdown 文件。", false);
      } else {
        setStatus("已下载 " + response.count + " 个，失败 " + response.failed + " 个。", true);
      }
      exportButton.disabled = false;
    });
  });

  scanCurrentPage();
})();
