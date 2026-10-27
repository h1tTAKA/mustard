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
const calc = "/System/Applications/Calculator.app";
assert.ok([calc, `${calc}/`, `${calc}/.`, `${calc}/Contents/..`].every((p) => safeDir(p) === null), "앱 번들 폴더는 ., .., 끝 / 써도 거부");
const tmp = fs.realpathSync(os.tmpdir());
const link = path.join(tmp, `open-in-test-${process.pid}`);
try { fs.symlinkSync(calc, link); assert.strictEqual(safeDir(link), null, "번들로 가는 심볼릭 링크도 거부"); } finally { try { fs.unlinkSync(link); } catch { /* 없음 */ } }
assert.strictEqual(safeDir(`${tmp}/.`), tmp, "실제 경로로 돌려줌");
assert.ok(!safeDir("relative/dir") && !safeDir("/no/such/dir/x") && !safeDir(`${tmp}\n`) && !safeDir(__filename), "폴더 검사");
console.log("open-in.test ok");
