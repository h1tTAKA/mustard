// splitDiffByFile 점검 — node electron/github-bridge.test.cjs
const assert = require("node:assert");
const { splitDiffByFile } = require("./github-bridge.cjs");

const raw = [
  "diff --git a/src/a.ts b/src/a.ts", "index 1..2 100644", "--- a/src/a.ts", "+++ b/src/a.ts", "@@ -1 +1 @@", "-x", "+y",
  "diff --git a/old.md b/new.md", "similarity index 90%", "rename from old.md", "rename to new.md", "--- a/old.md", "+++ b/new.md", "@@ -1 +1 @@", "-a", "+b",
  "diff --git a/gone.txt b/gone.txt", "deleted file mode 100644", "--- a/gone.txt", "+++ /dev/null", "@@ -1 +0,0 @@", "-bye",
  'diff --git "a/my file.ts" "b/my file.ts"', "new file mode 100644", "--- /dev/null", '+++ "b/my file.ts"', "@@ -0,0 +1 @@", "+hi",
  "diff --git a/img.png b/img.png", "Binary files a/img.png and b/img.png differ",
  'diff --git "a/\\355\\225\\234.md" "b/\\355\\225\\234.md"', "--- \"a/\\355\\225\\234.md\"", "+++ \"b/\\355\\225\\234.md\"", "@@ -1 +1 @@", "-a", "+b",
  "",
].join("\n");
const m = splitDiffByFile(raw);
assert.deepStrictEqual(Object.keys(m), ["src/a.ts", "new.md", "gone.txt", "my file.ts", "img.png", "한.md"], "경로: 일반·이름변경(새 이름)·삭제·공백 따옴표·바이너리·한글(8진 이스케이프)");
assert.ok(m["src/a.ts"].includes("+y") && !m["src/a.ts"].includes("new.md"), "파일별로 잘림");
assert.ok(m["gone.txt"].includes("-bye"));
assert.deepStrictEqual(Object.keys(splitDiffByFile("")), []);
assert.strictEqual(splitDiffByFile(raw).constructor, undefined, "프로토타입 없음");
const emo = splitDiffByFile('diff --git "a/🙂 \\t.md" "b/🙂 \\t.md"\n--- "a/🙂 \\t.md"\n+++ "b/🙂 \\t.md"\n@@ -1 +1 @@\n-a\n+b\n');
assert.deepStrictEqual(Object.keys(emo), ["🙂 \t.md"], "이모지 + 이스케이프 섞인 경로");
// #1149 헤더만 있는 파일(바이너리·권한만·내용 없는 이름 변경) — 따옴표 한글, 경로 속 " b/", 공백 이름 변경
const only = (d) => Object.keys(splitDiffByFile(d));
assert.deepStrictEqual(only('diff --git "a/\\355\\225\\234.png" "b/\\355\\225\\234.png"\nBinary files differ\n'), ["한.png"], "따옴표 한글 바이너리");
assert.deepStrictEqual(only("diff --git a/s.ts b/s.ts\nold mode 100644\nnew mode 100755\n"), ["s.ts"], "권한만");
assert.deepStrictEqual(only("diff --git a/old.sh b/new.sh\nsimilarity index 100%\nrename from old.sh\nrename to new.sh\n"), ["new.sh"], "내용 없는 이름 변경");
assert.deepStrictEqual(only("diff --git a/docs/a b/notes.md b/docs/a b/notes.md\nBinary files differ\n"), ["docs/a b/notes.md"], "경로에 ' b/'");
assert.deepStrictEqual(only("diff --git a/x y b/z w\nsimilarity index 100%\nrename from x y\nrename to z w\n"), ["z w"], "공백 경로 이름 변경");
// #1151 오프라인 분류 — 네트워크 오류는 offline(인증보다 먼저), 오프라인 auth status 단독 문구는 not-authed(그래서 probe로 한 번 더)
const { classifyGhError, authDiagnose } = require("./github-bridge.cjs");
assert.strictEqual(classifyGhError({ stderr: 'Get "https://api.github.com/rate_limit": dial tcp: lookup api.github.com: no such host' }).kind, "offline");
assert.strictEqual(classifyGhError({ stderr: "error connecting to api.github.com\ncheck your internet connection or https://githubstatus.com" }).kind, "offline");
assert.strictEqual(classifyGhError({ stderr: "X Failed to log in to github.com account me (keyring)\n- The token in keyring is invalid.\n- To re-authenticate, run: gh auth login -h github.com" }).kind, "not-authed");
assert.strictEqual(classifyGhError({ stderr: "HTTP 401: Bad credentials (https://api.github.com/rate_limit)" }).kind, "not-authed");

// authDiagnose + probe — 가짜 gh(auth status는 늘 로그인 실패 문구, api는 MODE에 따라)
(async () => {
  const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fake-gh-"));
  const gh = path.join(dir, "gh");
  fs.writeFileSync(gh, `#!/bin/sh
if [ "$1" = auth ]; then echo "X Failed to log in to github.com account me (keyring)" >&2; echo "- To re-authenticate, run: gh auth login -h github.com" >&2; exit 1; fi
case "$MODE" in
  offline) echo 'Get "https://api.github.com/rate_limit": dial tcp: lookup api.github.com: no such host' >&2; exit 1;;
  ok) echo '{}'; exit 0;;
  *) echo "HTTP 401: Bad credentials" >&2; exit 1;;
esac
`, { mode: 0o755 });
  const run = (MODE, probe = ["api", "rate_limit"]) => authDiagnose({ gh, cwd: dir, env: { ...process.env, MODE }, probe });
  try {
    assert.strictEqual((await run("offline")).state, "offline", "인터넷 끊김 = 연결 안 됨");
    assert.strictEqual((await run("ok")).state, "ok", "API 되면 로그인 멀쩡");
    assert.strictEqual((await run("401")).state, "not-authed", "진짜 로그인 풀림");
    assert.strictEqual((await run("offline", null)).state, "not-authed", "probe 없으면(glab) 그대로");
    console.log("github-bridge.test ok");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
})().catch((e) => { console.error(e); process.exit(1); });
