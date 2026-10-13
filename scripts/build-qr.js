const fs = require("node:fs/promises");
const path = require("node:path");
const esbuild = require("esbuild");

async function build() {
  await esbuild.build({
    stdin: { contents: "globalThis.XMDQRCode = require('qrcode');", resolveDir: path.dirname(require.resolve("qrcode")) },
    bundle: true, platform: "browser", format: "iife", minify: true,
    outfile: path.resolve(__dirname, "../src/vendor/qrcode.js")
  });
  const license = path.join(path.dirname(require.resolve("qrcode/package.json")), "license");
  const licenseText = (await fs.readFile(license, "utf8")).trimEnd() + "\n";
  await fs.writeFile(path.resolve(__dirname, "../src/vendor/qrcode-LICENSE"), licenseText);
  await esbuild.build({
    stdin: { contents: "globalThis.XMDCrypto = require('tweetnacl');", resolveDir: path.dirname(require.resolve("tweetnacl")) },
    bundle: true, platform: "browser", format: "iife", minify: true,
    outfile: path.resolve(__dirname, "../src/vendor/ed25519.js")
  });
  await fs.copyFile(path.join(path.dirname(require.resolve("tweetnacl/package.json")), "LICENSE"),
    path.resolve(__dirname, "../src/vendor/ed25519-LICENSE"));
}
build().catch(error => { process.stderr.write(error.message + "\n"); process.exitCode = 1; });
