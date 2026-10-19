const path = require("node:path");
const fs = require("node:fs/promises");
const sharp = require("sharp");

async function build() {
  const assets = path.resolve(__dirname, "../assets");
  const logo = path.resolve(__dirname, "../store/source/extension-icon.png");
  await fs.mkdir(path.join(assets, "icons"), { recursive: true });
  for (const size of [16, 32, 48, 128]) {
    let output = sharp(logo).resize(size === 128 ? 96 : size, size === 128 ? 96 : size, { fit: "contain" });
    if (size === 128) output = output.extend({
      top: 16, bottom: 16, left: 16, right: 16, background: { r: 0, g: 0, b: 0, alpha: 0 }
    });
    await output.png().toFile(path.join(assets, "icons", "icon-" + size + ".png"));
  }
  await sharp(logo).resize(256, 256, { fit: "contain" }).png().toFile(path.join(assets, "logo.png"));
}

build().catch(error => { process.stderr.write(error.message + "\n"); process.exitCode = 1; });
