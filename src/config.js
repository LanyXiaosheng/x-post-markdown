(function initConfig(global) {
  "use strict";
  global.XMDConfig = Object.freeze({
    product: "xmd",
    apiBase: "https://lanyxiaosheng.cloud:8443/xmd-api/v1",
    // Filled with the deployed service key before release; never trust a key returned by activation.
    publicKey: "B1bnMq_eDGOmRXXxBtn3tJxGZ7M3Da6HsTInDcZHrvI",
    licenseRequired: false
  });
})(globalThis);
