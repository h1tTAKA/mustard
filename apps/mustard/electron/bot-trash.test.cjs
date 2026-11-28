// bot-trash 점검 — node electron/bot-trash.test.cjs
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { trashTarget } = require("./bot-trash.cjs");

const work = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "bot-trash-test-"));
try {
  const bots = path.join(work, "bots"), outside = path.join(work, "outside");
  const ok = path.join(bots, ".deleted-my-bot-123");
  [ok, path.join(bots, "my-bot"), path.join(outside, ".deleted-x-1")].forEach((d) => fs.mkdirSync(d, { recursive: true }));
  fs.symlinkSync(path.join(outside, ".deleted-x-1"), path.join(bots, ".deleted-link-1"));
  assert.strictEqual(trashTarget(ok, bots), ok, "비켜 둔 폴더");
  assert.strictEqual(trashTarget(path.join(bots, "my-bot"), bots), null, "살아 있는 봇 폴더 거부");
  assert.strictEqual(trashTarget(path.join(outside, ".deleted-x-1"), bots), null, "봇 폴더 밖 거부");
  assert.strictEqual(trashTarget(path.join(bots, ".deleted-link-1"), bots), null, "밖을 가리키는 링크 거부");
  assert.strictEqual(trashTarget(`${bots}/my-bot/../.deleted-my-bot-123`, bots), ok, ".. 풀어서 판단");
  assert.strictEqual(trashTarget(bots, bots), null, "봇 폴더 자체 거부");
  assert.strictEqual(trashTarget(path.join(bots, ".deleted-nope-1"), bots), null, "없는 경로");
  assert.strictEqual(trashTarget(123, bots), null);
} finally { fs.rmSync(work, { recursive: true, force: true }); }
console.log("bot-trash OK");
