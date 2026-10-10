(function initPopup() {
  "use strict";

  var button = document.getElementById("export");
  var status = document.getElementById("status");

  function setStatus(message, isError) {
    status.textContent = message;
    status.className = "status" + (isError ? " error" : "");
  }

  button.addEventListener("click", function () {
    button.disabled = true;
    setStatus("正在读取帖子…", false);
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      var tab = tabs[0];
      if (!tab || !tab.id) {
        setStatus("没有找到当前标签页。", true);
        button.disabled = false;
        return;
      }
      chrome.tabs.sendMessage(tab.id, { type: "XMD_EXPORT_CURRENT" }, function () {
        if (chrome.runtime.lastError) {
          setStatus("请刷新 X 页面后重试。", true);
        } else {
          setStatus("已开始下载 Markdown 文件。", false);
        }
        button.disabled = false;
      });
    });
  });
})();
