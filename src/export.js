(function initExport(global) {
  "use strict";

  function createJobs(items) {
    var posts = items.filter(function (item) { return item && item.kind !== "comment"; });
    var comments = items.filter(function (item) { return item && item.kind === "comment"; });
    if (!posts.length) return comments.length ? [{ comments: comments, summary: true }] : [];
    var jobs = posts.map(function (post) { return { post: post, comments: [] }; });
    var unmatched = [];
    comments.forEach(function (comment) {
      var job = jobs.find(function (entry) {
        return comment.parentUrl && entry.post.url === comment.parentUrl;
      });
      if (job) job.comments.push(comment);
      else unmatched.push(comment);
    });
    if (unmatched.length) jobs.push({ comments: unmatched, summary: true });
    return jobs;
  }

  function jobData(job) {
    if (job.summary) {
      return { markdown: XMarkdown.formatComments(job.comments), name: "评论汇总" };
    }
    var post = Object.assign({}, job.post || {}, { comments: job.comments || [] });
    var username = post.authorUsername ? "@" + post.authorUsername : "x-post";
    var sourceUrl = typeof post.url === "string" ? post.url : "";
    var id = (sourceUrl.match(/(?:status|article)\/(\d+)/) || [])[1] || Date.now();
    return {
      markdown: XMarkdown.formatPost(post),
      name: post.title || username + "-" + id
    };
  }

  function download(job) {
    return new Promise(function (resolve) {
      var settled = false;
      var timer = setTimeout(function () {
        finish({ ok: false, error: "Chrome 下载接口等待超过 20 秒，请检查下载提示。" });
      }, 20000);
      function finish(result) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(result);
      }
      try {
        var data = jobData(job);
        var filename = XMarkdown.safeFilename(data.name) + ".md";
        chrome.downloads.download({
          url: "data:text/markdown;charset=utf-8," + encodeURIComponent(data.markdown),
          filename: filename,
          saveAs: false,
          conflictAction: "uniquify"
        }, function (id) {
          var error = chrome.runtime.lastError;
          finish(error
            ? { ok: false, error: error.message, filename: filename }
            : { ok: Number.isInteger(id), downloadId: id, filename: filename });
        });
      } catch (error) {
        finish({ ok: false, error: error.message || String(error) });
      }
    });
  }

  async function runJobs(jobs, onProgress) {
    if (global.XLicense) await global.XLicense.authorize(jobs);
    var results = [];
    for (var index = 0; index < jobs.length; index += 1) {
      results.push(await download(jobs[index]));
      if (onProgress) onProgress(index + 1, jobs.length);
    }
    var failed = results.filter(function (result) { return !result.ok; });
    return {
      ok: jobs.length > 0 && failed.length === 0,
      count: results.length - failed.length,
      failed: failed.length,
      errors: failed.map(function (result) { return result.error || "Chrome 未返回下载编号。"; })
    };
  }

  global.XExport = { createJobs: createJobs, runJobs: runJobs };
})(globalThis);
