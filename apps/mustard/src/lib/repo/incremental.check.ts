// incremental.ts self-check(#1320) — 앱 미import. 실행: node --experimental-strip-types src/lib/repo/incremental.check.ts
import assert from "node:assert";
import { fileHash, fileSig, snapOf, diffSnap, type FileCache } from "./incremental.ts";
import type { SymbolInfo } from "./symbols.ts";

const sym = (name: string, signature?: string): SymbolInfo => ({ id: `a.ts#${name}`, name, kind: "function", signature, startIndex: 0, endIndex: 1, startRow: 0 } as SymbolInfo);

// 내용 해시 — 한 글자라도 다르면 다름.
assert.notStrictEqual(fileHash("a"), fileHash("b"));
assert.strictEqual(fileHash("x"), fileHash("x"));

// 구조 서명 — 순서·줄번호 무관, 시그니처·import가 바뀌면 다름.
const s1 = fileSig(["./b", "./c"], [sym("f", "(x)"), sym("g")]);
assert.strictEqual(s1, fileSig(["./c", "./b"], [sym("g"), { ...sym("f", "(x)"), startRow: 99 }]), "순서·줄 바뀜은 같은 서명");
assert.notStrictEqual(s1, fileSig(["./b", "./c"], [sym("f", "(x, y)"), sym("g")]), "시그니처 바뀌면 다름");
assert.notStrictEqual(s1, fileSig(["./b"], [sym("f", "(x)"), sym("g")]), "import 빠지면 다름");
assert.notStrictEqual(s1, fileSig(["./b", "./c"], [sym("f", "(x)"), sym("g"), sym("h")]), "함수 추가면 다름");

// 스냅샷 비교 — 주석만(내용만) / 구조 / 추가 / 삭제.
const old: FileCache = { "a.ts": { hash: "h1", sig: "s1" }, "b.ts": { hash: "h2", sig: "s2" }, "c.ts": { hash: "h3", sig: "s3" } };
const cur: FileCache = { "a.ts": { hash: "h1x", sig: "s1" }, "b.ts": { hash: "h2x", sig: "s2x" }, "d.ts": { hash: "h4", sig: "s4" } };
const d = diffSnap(snapOf(old), snapOf(cur));
assert.deepStrictEqual(d.changed, ["a.ts", "b.ts", "d.ts"]);
assert.deepStrictEqual(d.structural, ["b.ts", "d.ts"], "a는 내용만 바뀜 → 구조 변화 아님");
assert.deepStrictEqual(d.removed, ["c.ts"]);
assert.deepStrictEqual(diffSnap(snapOf(old), snapOf(old)), { changed: [], structural: [], removed: [] }, "같으면 빈 차분");

console.log("incremental.check OK");
