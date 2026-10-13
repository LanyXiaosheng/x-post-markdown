(function initPopupLayout() {
  "use strict";
  // Give Chrome intrinsic dimensions first. Reading the initial 25px popup viewport
  // into CSS would otherwise recreate its auto-sizing feedback loop.
  function fitAvailableHeight() {
    if (window.innerWidth < 200 || window.innerHeight < 180) return;
    document.documentElement.style.height = Math.min(600, window.innerHeight) + "px";
  }
  window.addEventListener("resize", fitAvailableHeight);
  document.addEventListener("DOMContentLoaded", function () {
    requestAnimationFrame(fitAvailableHeight);
  });
})();
