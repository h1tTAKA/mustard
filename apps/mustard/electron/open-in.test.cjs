// open-in 점검 — node electron/open-in.test.cjs
const assert = require("node:assert");
const os = require("node:os");
const { APPS, detect, okDir } = require("./open-in.cjs");

assert.strictEqual(new Set(APPS.map((a) => a[0])).size, APPS.length, "id 겹침 없음");
const have = new Set(["/Applications/Cursor.app", "/Users/x/Applications/Zed.app", "/System/Applications/Utilities/Terminal.app", "/Applications/PyCharm CE.app"]);
const got = detect((p) => have.has(p), ["/Applications", "/System/Applications/Utilities", "/Users/x/Applications"]);
assert.deepStrictEqual(got.map((a) => a.id), ["cursor", "zed", "pycharm", "terminal"], "설치된 것만, 목록 순서");
assert.strictEqual(got.find((a) => a.id === "pycharm").appPath, "/Applications/PyCharm CE.app", "이름 후보");
assert.ok(okDir(os.tmpdir()) && !okDir("relative/dir") && !okDir("/no/such/dir/x") && !okDir(`${os.tmpdir()}\n`) && !okDir(__filename), "폴더 검사");
console.log("open-in.test ok");
