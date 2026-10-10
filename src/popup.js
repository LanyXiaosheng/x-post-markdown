(function initPopup() {
  "use strict";

  var exportButton = document.getElementById("export");
  var selectAll = document.getElementById("select-all");
  var postList = document.getElementById("post-list");
  var scanTitle = document.getElementById("scan-title");
  var status = document.getElementById("status");
  var posts = [];

  function setStatus(message, isError) {
    status.textContent = message;
    status.className = "status" + (isError ? " error" : "");
  }

  function postLabel(post) {
    if (post.title) return post.title;
    if (post.authorName) return post.authorName + (post.authorUsername ? " @" + post.authorUsername : "");
    return post.authorUsername ? "@" + post.authorUsername : "X 帖子";
  }

  function postSummary(post) {
    var value = post.body || post.text || "（无可见正文）";
    return value.replace(/\s+/g, " ").trim().slice(0, 120);
  }

  function selectedPosts() {
    return Array.from(postList.querySelectorAll("input[data-post-index]:checked")).map(function (input) {
      return posts[Number(input.getAttribute("data-post-index"))];
    });
  }

  function syncSelection() {
    var selected = selectedPosts();
    var total = posts.length;
    selectAll.checked = total > 0 && selected.length === total;
    selectAll.indeterminate = selected.length > 0 && selected.length < total;
    exportButton.disabled = selected.length === 0;
    exportButton.textContent = selected.length
      ? "导出选中帖子（" + selected.length + "）"
      : "导出选中帖子";
  }

  function renderPosts() {
    postList.textContent = "";
    scanTitle.textContent = "识别到 " + posts.length + " 条帖子";
    if (!posts.length) {
      var empty = document.createElement("div");
      empty.className = "empty";
      empty.textContent = "当前页面没有识别到可导出的帖子。";
      postList.appendChild(empty);
      selectAll.checked = false;
      selectAll.indeterminate = false;
      syncSelection();
      return;
    }

    posts.forEach(function (post, index) {
      var row = document.createElement("label");
      row.className = "post-row";
      var checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = true;
      checkbox.setAttribute("data-post-index", String(index));
      checkbox.addEventListener("change", syncSelection);

      var copy = document.createElement("span");
      copy.className = "post-copy";
      var title = document.createElement("span");
      title.className = "post-title";
      title.textContent = postLabel(post);
      var summary = document.createElement("span");
      summary.className = "post-summary";
      summary.textContent = postSummary(post);
      copy.appendChild(title);
      copy.appendChild(summary);
      row.appendChild(checkbox);
      row.appendChild(copy);
      postList.appendChild(row);
    });
    syncSelection();
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
        setStatus(posts.length ? "已默认全选，可取消不需要的帖子。" : "请滚动页面加载帖子后重试。", false);
      });
    });
  }

  selectAll.addEventListener("change", function () {
    postList.querySelectorAll("input[data-post-index]").forEach(function (input) {
      input.checked = selectAll.checked;
    });
    syncSelection();
  });

  exportButton.addEventListener("click", function () {
    var selected = selectedPosts();
    if (!selected.length) return;
    exportButton.disabled = true;
    setStatus("正在下载 " + selected.length + " 个 Markdown 文件…", false);
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
