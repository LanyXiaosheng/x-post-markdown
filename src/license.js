(function initLicense(global) {
  "use strict";
  var installPromise;

  function bytes(value) {
    var text = value.replace(/-/g, "+").replace(/_/g, "/");
    return Uint8Array.from(atob(text), function (char) { return char.charCodeAt(0); });
  }

  async function installationId() {
    if (!installPromise) {
      installPromise = (async function () {
        var stored = await chrome.storage.local.get("xmdInstallation");
        if (stored.xmdInstallation) return stored.xmdInstallation;
        var id = crypto.randomUUID();
        await chrome.storage.local.set({ xmdInstallation: id });
        return id;
      })();
    }
    return installPromise;
  }

  async function request(route, body) {
    var controller = new AbortController();
    var timer = setTimeout(function () { controller.abort(); }, 10000);
    try {
      var response = await fetch(XMDConfig.apiBase + route, {
        method: body ? "POST" : "GET",
        headers: body ? { "Content-Type": "application/json" } : {},
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
        credentials: "omit",
        cache: "no-store"
      });
      var data = await response.json();
      if (!response.ok) {
        var errorCode = typeof data.error === "string" ? data.error : data.error && data.error.message;
        var labels = {
          invalid_code: "激活码无效，请核对后重试",
          license_revoked: "此授权已被撤销，请联系产品方",
          installation_mismatch: "此激活码已绑定其他浏览器安装",
          installation_limit: "此激活码已绑定其他浏览器安装",
          purchase_unavailable: "支付尚未配置，暂未开放购买",
          rate_limited: "请求过于频繁，请稍后重试"
        };
        var error = new Error(labels[errorCode] || errorCode || data.message || "激活服务请求失败");
        error.status = response.status;
        throw error;
      }
      return data;
    } catch (error) {
      if (error.name === "AbortError") throw new Error("激活服务响应超时，请稍后重试");
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  async function verifyToken(token) {
    if (!XMDConfig.publicKey || typeof token !== "string") return null;
    try {
      var parts = token.split(".");
      if (parts.length !== 2) return null;
      var valid = XMDCrypto.sign.detached.verify(
        new TextEncoder().encode(parts[0]), bytes(parts[1]), bytes(XMDConfig.publicKey)
      );
      if (!valid) return null;
      var claims = JSON.parse(new TextDecoder().decode(bytes(parts[0])));
      var id = await installationId();
      if (claims.product !== "xmd" || claims.plan !== "pro" || claims.installation_id !== id) return null;
      if (!Number.isFinite(claims.exp) || claims.exp <= Date.now() / 1000) return null;
      return claims;
    } catch (_) {
      return null;
    }
  }

  async function status() {
    var stored = await chrome.storage.local.get("xmdLicense");
    var claims = await verifyToken(stored.xmdLicense);
    return { pro: Boolean(claims), claims: claims, token: stored.xmdLicense };
  }

  async function activate(code) {
    var id = await installationId();
    var result = await request("/activate", { code: code.trim(), installation_id: id });
    var claims = await verifyToken(result.token);
    if (!claims) throw new Error("激活凭证校验失败，请确认安装了官方最新版扩展");
    await chrome.storage.local.set({ xmdLicense: result.token });
    return { pro: true, claims: claims };
  }

  async function refresh() {
    var current = await status();
    if (!current.token) return current;
    try {
      var result = await request("/verify", {
        token: current.token,
        installation_id: await installationId()
      });
      var claims = await verifyToken(result.token);
      if (!claims) throw new Error("授权签名验证失败");
      await chrome.storage.local.set({ xmdLicense: result.token });
      return { pro: true, claims: claims };
    } catch (error) {
      if (error.status === 401 || error.status === 403) {
        await chrome.storage.local.remove("xmdLicense");
        return { pro: false, error: error.message };
      }
      return current;
    }
  }

  function needsPro(jobs) {
    return jobs.length > 1 || jobs.some(function (job) {
      return job.summary || job.comments && job.comments.length ||
        job.post && (job.post.title || job.post.kind === "comment");
    });
  }

  async function authorize(jobs) {
    if (!XMDConfig.licenseRequired || !needsPro(jobs)) return;
    var current = await status();
    if (!current.pro && current.token) current = await refresh();
    if (!current.pro) throw new Error("请激活 Pro 后导出批量、长文或评论。普通单帖可免费导出。");
  }

  global.XLicense = {
    activate: activate, authorize: authorize, installationId: installationId,
    needsPro: needsPro, refresh: refresh, request: request, status: status, verifyToken: verifyToken
  };
})(globalThis);
