const path = require("node:path");
const fs = require("node:fs/promises");
const sharp = require("sharp");

async function build() {
  const assets = path.resolve(__dirname, "../assets");
  const logo = path.join(assets, "logo.svg");
  await fs.mkdir(path.join(assets, "icons"), { recursive: true });
  for (const size of [16, 32, 48, 128]) {
    await sharp(logo).resize(size, size).png().toFile(path.join(assets, "icons", "icon-" + size + ".png"));
  }
  await sharp(logo).resize(256, 256).png().toFile(path.join(assets, "logo.png"));
}

build().catch(error => { process.stderr.write(error.message + "\n"); process.exitCode = 1; });
