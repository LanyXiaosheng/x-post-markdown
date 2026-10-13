const test = require("node:test");
const assert = require("node:assert/strict");
const { webcrypto, generateKeyPairSync, sign } = require("node:crypto");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");

const keys = generateKeyPairSync("ed25519");
const publicKey = keys.publicKey.export({ type: "spki", format: "der" }).subarray(-32).toString("base64url");
const installation = "a352ac31-6c41-4fbc-8a3a-341829629211";

function token(overrides) {
  const payload = Buffer.from(JSON.stringify(Object.assign({
    product: "xmd", plan: "pro", installation_id: installation, exp: Math.floor(Date.now() / 1000) + 3600
  }, overrides))).toString("base64url");
  return payload + "." + sign(null, Buffer.from(payload), keys.privateKey).toString("base64url");
}

function setup(initial, fetchResponse) {
  const stored = Object.assign({ xmdInstallation: installation }, initial);
  const context = vm.createContext({
    crypto: webcrypto, atob, TextDecoder, TextEncoder, Uint8Array, setTimeout, clearTimeout, AbortController,
    fetch: fetchResponse || (() => Promise.reject(new Error("offline"))),
    chrome: { storage: { local: {
      async get(key) { return { [key]: stored[key] }; },
      async set(value) { Object.assign(stored, value); },
      async remove(key) { delete stored[key]; }
    } } }
  });
  context.XMDConfig = { publicKey, apiBase: "https://license.example/xmd-api/v1", licenseRequired: true };
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../src/vendor/ed25519.js"), "utf8"), context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../src/license.js"), "utf8"), context);
  return { client: context.XLicense, stored };
}

test("ordinary single post is free; bulk, long articles and comments require Pro", async () => {
  const { client } = setup();
  await client.authorize([{ post: { text: "正文" }, comments: [] }]);
  await assert.rejects(client.authorize([{ post: {} }, { post: {} }]), /激活 Pro/);
  await assert.rejects(client.authorize([{ post: { title: "长文" } }]), /激活 Pro/);
  await assert.rejects(client.authorize([{ summary: true, comments: [] }]), /激活 Pro/);
});

test("signed Pro unlocks all export jobs and remains valid offline within lease", async () => {
  const { client } = setup({ xmdLicense: token() });
  await client.authorize([{ post: {} }, { post: {} }]);
  assert.equal((await client.refresh()).pro, true);
});

test("tampered, expired, cross-device or non-Pro credentials never authorize", async () => {
  const { client } = setup();
  assert.equal(await client.verifyToken(token({ exp: 1 })), null);
  assert.equal(await client.verifyToken(token({ installation_id: crypto.randomUUID() })), null);
  assert.equal(await client.verifyToken(token({ plan: "free" })), null);
  const valid = token();
  assert.equal(await client.verifyToken(valid.slice(0, -5) + "AAAAA"), null);
});

test("revocation clears local entitlement when the server denies it", async () => {
  const { client, stored } = setup({ xmdLicense: token() }, async () => ({
    ok: false, status: 403, json: async () => ({ error: { message: "license_revoked" } })
  }));
  assert.equal((await client.refresh()).pro, false);
  assert.equal(stored.xmdLicense, undefined);
});

test("expired permanent entitlement renews online before Pro export", async () => {
  const renewed = token();
  const { client, stored } = setup({ xmdLicense: token({ exp: 1 }) }, async () => ({
    ok: true, status: 200, json: async () => ({ token: renewed })
  }));
  await client.authorize([{ post: {} }, { post: {} }]);
  assert.equal(stored.xmdLicense, renewed);
});
