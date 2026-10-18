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
console.log("github-bridge.test ok");
