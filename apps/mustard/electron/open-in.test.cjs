// open-in 점검 — node electron/open-in.test.cjs
const assert = require("node:assert");
const os = require("node:os");
const fs = require("node:fs");
const path = require("node:path");
const { APPS, detect, safeDir } = require("./open-in.cjs");

assert.strictEqual(new Set(APPS.map((a) => a[0])).size, APPS.length, "id 겹침 없음");
const have = new Set(["/Applications/Cursor.app", "/Users/x/Applications/Zed.app", "/System/Applications/Utilities/Terminal.app", "/Applications/PyCharm CE.app"]);
const got = detect((p) => have.has(p), ["/Applications", "/System/Applications/Utilities", "/Users/x/Applications"]);
assert.deepStrictEqual(got.map((a) => a.id), ["cursor", "zed", "pycharm", "terminal"], "설치된 것만, 목록 순서");
assert.strictEqual(got.find((a) => a.id === "pycharm").appPath, "/Applications/PyCharm CE.app", "이름 후보");
// 번들 폴더 — 임시로 만든 Fake.app으로(리눅스 CI에서도 실제로 거부 규칙을 타게)
const tmp = fs.realpathSync(os.tmpdir());
const work = fs.mkdtempSync(path.join(tmp, "open-in-test-"));
try {
  const fake = path.join(work, "Fake.app");
  fs.mkdirSync(path.join(fake, "Contents"), { recursive: true });
  assert.ok([fake, `${fake}/`, `${fake}/.`, `${fake}/Contents/..`].every((p) => safeDir(p) === null), "번들 폴더는 ., .., 끝 / 써도 거부");
  const link = path.join(work, "link");
  fs.symlinkSync(fake, link);
  assert.strictEqual(safeDir(link), null, "번들로 가는 심볼릭 링크도 거부");
  assert.strictEqual(safeDir(path.join(fake, "Contents")), path.join(fake, "Contents"), "번들 안쪽 보통 폴더는 됨");
} finally { fs.rmSync(work, { recursive: true, force: true }); }
assert.strictEqual(safeDir(`${tmp}/.`), tmp, "실제 경로로 돌려줌");
assert.ok(!safeDir("relative/dir") && !safeDir("/no/such/dir/x") && !safeDir(`${tmp}\n`) && !safeDir(__filename), "폴더 검사");
console.log("open-in.test ok");
