(function initActivationUI() {
  "use strict";
  var state = document.getElementById("license-state");
  var planBadge = document.getElementById("plan-badge");
  var code = document.getElementById("activation-code");
  var activationStatus = document.getElementById("activation-status");
  var activateButton = document.getElementById("activate");
  var purchaseButton = document.getElementById("purchase");
  var paymentMethod = document.getElementById("payment-method");
  var purchaseStatus = document.getElementById("purchase-status");
  var checkoutLink = document.getElementById("checkout-link");
  var orderTimer;

  function showPanel(pro) {
    document.getElementById("export-panel").hidden = pro;
    document.getElementById("license-panel").hidden = !pro;
    document.getElementById("tab-export").classList.toggle("active", !pro);
    document.getElementById("tab-license").classList.toggle("active", pro);
    document.getElementById("tab-export").setAttribute("aria-pressed", String(!pro));
    document.getElementById("tab-license").setAttribute("aria-pressed", String(pro));
  }

  function showLicense(result) {
    planBadge.textContent = result.pro ? "Pro 已激活" : "免费版";
    document.getElementById("plan-action").textContent = result.pro ? "授权信息" : "激活 Pro";
    state.textContent = result.pro ? "永久 Pro 已激活 · 此浏览器安装" : "尚未激活 Pro · 普通单帖可免费导出";
    if (result.error) activationStatus.textContent = result.error;
  }

  async function loadPurchaseConfig() {
    try {
      var config = await XLicense.request("/config");
      if (!config.purchase_enabled) return;
      var methods = config.payment_methods || [];
      Array.from(paymentMethod.options).forEach(function (option) {
        option.disabled = methods.indexOf(option.value) < 0;
      });
      paymentMethod.value = methods[0] || "";
      paymentMethod.disabled = methods.length === 0;
      purchaseButton.disabled = methods.length === 0;
      purchaseButton.textContent = "购买永久 Pro · ¥" + (config.price_cents / 100).toFixed(2);
      purchaseStatus.textContent = "支付成功后自动领取激活码。";
    } catch (_) {
      purchaseStatus.textContent = "自动支付暂未开放。已有激活码可激活；网络连接失败时可稍后重试。";
    }
  }

  document.getElementById("tab-export").addEventListener("click", function () { showPanel(false); });
  document.getElementById("tab-license").addEventListener("click", function () {
    showPanel(true);
    loadPurchaseConfig();
  });
  document.getElementById("activation-form").addEventListener("submit", async function (event) {
    event.preventDefault();
    activateButton.disabled = true;
    activationStatus.className = "status";
    activationStatus.textContent = "正在校验激活码…";
    try {
      var result = await XLicense.activate(code.value);
      code.value = "";
      showLicense(result);
      activationStatus.textContent = "激活成功，全部导出功能已解锁。";
    } catch (error) {
      activationStatus.className = "status error";
      activationStatus.textContent = error.message;
    } finally {
      activateButton.disabled = false;
    }
  });

  async function checkOrder(orderId, id) {
    try {
      var order = await XLicense.request("/orders/" + encodeURIComponent(orderId) +
        "?installation_id=" + encodeURIComponent(id));
      if (order.status === "paid" && order.code) {
        showLicense(await XLicense.activate(order.code));
        purchaseStatus.textContent = "支付成功，Pro 已自动激活。";
        purchaseButton.disabled = false;
        return;
      }
      if (order.status === "expired" || order.status === "cancelled") {
        purchaseStatus.textContent = "订单已失效，请重新购买。";
        purchaseButton.disabled = false;
        return;
      }
      orderTimer = setTimeout(function () { checkOrder(orderId, id); }, 3000);
    } catch (error) {
      purchaseStatus.textContent = "查询订单失败：" + error.message;
      purchaseButton.disabled = false;
    }
  }

  purchaseButton.addEventListener("click", async function () {
    purchaseButton.disabled = true;
    clearTimeout(orderTimer);
    try {
      var id = await XLicense.installationId();
      var order = await XLicense.request("/orders", { provider: paymentMethod.value, installation_id: id });
      var url = order.checkout_url;
      var canvas = document.getElementById("payment-qr");
      if (order.qr_url && /^weixin:\/\/wxpay\//i.test(order.qr_url)) {
        await XMDQRCode.toCanvas(canvas, order.qr_url, { width: 190, margin: 2 });
        canvas.hidden = false;
      } else if (url && /^https:\/\//i.test(url)) {
        checkoutLink.href = url;
        checkoutLink.hidden = false;
      } else {
        throw new Error("支付配置未返回有效收银台信息，请联系产品方完成配置");
      }
      purchaseStatus.textContent = "扫码或打开支付页面完成付款。保持本弹窗打开以自动激活。";
      checkOrder(order.order_id, id);
    } catch (error) {
      purchaseStatus.textContent = error.message;
      purchaseButton.disabled = false;
    }
  });

  XLicense.refresh().then(showLicense).catch(function (error) {
    activationStatus.textContent = error.message;
  });
  globalThis.XMDActivationUI = { showPanel: showPanel };
})();
