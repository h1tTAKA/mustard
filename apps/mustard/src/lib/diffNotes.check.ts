// diffNotes 점검 — node --experimental-strip-types src/lib/diffNotes.check.ts
import assert from "node:assert";
import { addNote, formatNote, formatNotes, isFull, markSent, removeNote, unsent, type DiffNote } from "./diffNotes.ts";

let l = addNote([], { path: "src/a.ts", line: 12, body: "  rename x  ", scope: "unstaged" }, "1", 100);
assert.deepStrictEqual(l, [{ path: "src/a.ts", line: 12, body: "rename x", scope: "unstaged", id: "1", createdAt: 100 }], "앞뒤 공백 정리");
assert.strictEqual(addNote(l, { path: "src/a.ts", line: 12, body: "rename x", scope: "unstaged" }, "2", 101).length, 1, "같은 diff·같은 자리·같은 글은 하나만");
assert.strictEqual(addNote(l, { path: "src/a.ts", line: 12, body: "rename x", scope: "commit:abc" }, "2b", 101).length, 2, "다른 diff의 같은 자리는 다른 메모");
l = addNote(l, { path: "src/b.ts", line: 9, startLine: 4, body: "split this", scope: "commit:abc" }, "3", 102);
assert.strictEqual(l[1].startLine, 4, "범위");
assert.ok(!("startLine" in addNote([], { path: "x", line: 4, startLine: 4, body: "y", scope: "unstaged" }, "4", 1)[0]), "시작=끝이면 한 줄");
assert.strictEqual(addNote(l, { path: "x", line: 3, startLine: 8, body: "y", scope: "unstaged" }, "5", 1).length, 2, "거꾸로 범위 거절");
assert.strictEqual(addNote(l, { path: "x", line: 3, body: "   ", scope: "unstaged" }, "6", 1).length, 2, "빈 글 거절");
assert.strictEqual(addNote([], { path: "", line: 3, body: "y", scope: "unstaged" }, "7", 1).length, 0, "경로 없음 거절");

// 보냄 표시 — 안 보낸 것만 다음 묶음, 보낸 자리에 같은 글을 다시 달 수 있음
const s = markSent(l, new Set(["1"]), 200);
assert.deepStrictEqual(unsent(s).map((x) => x.id), ["3"]);
assert.strictEqual(addNote(s, { path: "src/a.ts", line: 12, body: "rename x", scope: "unstaged" }, "8", 201).length, 3, "보낸 메모와 같은 글은 새로 달 수 있음(다시 지적)");
assert.deepStrictEqual(removeNote(s, "3").map((x) => x.id), ["1"]);

// Orca와 같은 보낼 글 형식
assert.strictEqual(formatNote({ path: "src/a.ts", line: 12, body: "rename x" }), 'File: src/a.ts\nLine: 12\nUser comment: "rename x"');
assert.strictEqual(formatNote({ path: "b.ts", line: 9, startLine: 4, body: 'say "hi"\nthen \\n' }), 'File: b.ts\nLines: 4-9\nUser comment: "say \\"hi\\"\\nthen \\\\n"', "따옴표·줄바꿈·역슬래시 이스케이프");
assert.strictEqual(formatNotes(l), formatNote(l[0]) + "\n\n" + formatNote(l[1]), "메모 사이 빈 줄");
// 어느 diff 기준인지 — 작업 폴더는 기본 형식 그대로, staged·커밋은 표시
assert.ok(formatNote({ path: "a.ts", line: 1, body: "x", scope: "unstaged" }).startsWith("File: a.ts\n"));
assert.ok(formatNote({ path: "a.ts", line: 1, body: "x", scope: "staged" }).startsWith("File: a.ts (staged)\n"));
assert.ok(formatNote({ path: "a.ts", line: 1, body: "x", scope: "commit:abcdef1234567" }).startsWith("File: a.ts (commit abcdef1)\n"));

// 200개 — 보낸 것부터 버리고, 전부 안 보낸 거면 거절(조용히 사라지지 않게)
const mk = (i: number, sent?: number): DiffNote => ({ id: `m${i}`, path: "f", line: i + 1, body: `b${i}`, scope: "unstaged", createdAt: i, ...(sent ? { sentAt: sent } : {}) });
const full = Array.from({ length: 200 }, (_, i) => mk(i, i === 5 ? 9 : undefined));
const add1 = addNote(full, { path: "f", line: 999, body: "new", scope: "unstaged" }, "n", 1);
assert.ok(add1.length === 200 && !add1.some((x) => x.id === "m5") && add1.some((x) => x.id === "n"), "보낸 것(m5)부터 버림");
const allUnsent = Array.from({ length: 200 }, (_, i) => mk(i));
assert.strictEqual(addNote(allUnsent, { path: "f", line: 999, body: "new", scope: "unstaged" }, "n", 1), allUnsent, "다 안 보낸 거면 거절(같은 목록 그대로)");
assert.ok(isFull(allUnsent) && !isFull(full));
console.log("diffNotes.check ok");
