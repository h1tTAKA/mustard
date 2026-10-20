// mcpActivity 점검 — node --experimental-strip-types src/lib/mcpActivity.check.ts
import assert from "node:assert";
import { extractConcept, emitToolCall, emitEdit, emitNarration, subscribe, recent, matchesRoot } from "./mcpActivity.ts";

// 개념 추출
assert.deepEqual(extractConcept("katchup_find_code", { name: "postMessage" }), { kind: "symbol", target: "postMessage" });
assert.deepEqual(extractConcept("katchup_trace_calls", { symbol: "getDb" }), { kind: "symbol", target: "getDb" });
assert.deepEqual(extractConcept("katchup_file_api", { file: "app/x.ts" }), { kind: "file", target: "app/x.ts" });
assert.deepEqual(extractConcept("katchup_search", { query: "멘션 흐름" }), { kind: "query", target: "멘션 흐름" });
assert.equal(extractConcept("katchup_repo_map", {}).kind, "repo");
assert.equal(extractConcept("katchup_check_freshness", {}), null, "freshness는 개념 아님");
assert.equal(extractConcept("katchup_find_code", {}), null, "빈 인자 스킵");

// emit → subscribe fan-out + recent(root 필터)
const got: string[] = [];
const unsub = subscribe((e) => got.push(`${e.kind}:${e.target}`));
emitToolCall("/repo/A", "katchup_find_code", { name: "foo" }, false, 1);
emitToolCall("/repo/B", "katchup_file_api", { file: "b.ts" }, false, 2);
emitToolCall("/repo/A", "katchup_check_freshness", {}, false, 3); // 스킵(개념 아님)
unsub();
emitToolCall("/repo/A", "katchup_find_code", { name: "after-unsub" }, false, 4); // 구독 해제 후 → 안 받음

assert.deepEqual(got, ["symbol:foo", "file:b.ts"], "fan-out은 개념 있는 것만, 해제 후 미수신");
const rA = recent("/repo/A", 10).map((e) => e.target);
assert.ok(rA.includes("foo") && rA.includes("after-unsub") && !rA.includes("b.ts"), "recent는 root A만");

// 편집 신호 + dedup
const got2: string[] = [];
const un2 = subscribe((e) => { if (e.kind === "edit") got2.push(`${e.tool}:${e.target}`); });
emitEdit("/repo/A", "Edit", "app/page.tsx", false, 10);
emitEdit("/repo/A", "Edit", "app/page.tsx", false, 11); // 직전과 동일 → dedup 스킵
emitEdit("/repo/A", "Bash", "npm test", false, 12);
emitEdit("/repo/A", "Edit", "app/page.tsx", false, 13); // 사이에 다른 편집 있었으니 다시 방출
un2();
assert.deepEqual(got2, ["Edit:app/page.tsx", "Bash:npm test", "Edit:app/page.tsx"], "편집 dedup(연속 동일만 스킵)");

// root 접두 양방향 매칭
assert.ok(matchesRoot("/repo/A/sub", "/repo/A"), "cwd 하위 매칭");
assert.ok(matchesRoot("/repo/A", "/repo/A/sub"), "역방향 매칭");
assert.ok(!matchesRoot("/repo/AB", "/repo/A"), "형제 접두 아님");
assert.ok(recent("/repo/A/sub", 20).some((e) => e.target === "app/page.tsx"), "하위 root로도 편집 조회");

// narration(#870) — note 실려 방출, 빈 note 스킵
const nar: string[] = [];
const un3 = subscribe((e) => { if (e.kind === "narration") nar.push(`${e.target}|${e.note ?? ""}`); });
assert.deepEqual(emitNarration("/repo/N", "코드 편집", "App.tsx의 상태 관리를 useReducer로 바꾸는 중", 20), { target: "코드 편집", note: "App.tsx의 상태 관리를 useReducer로 바꾸는 중" }, "방출 시 내용 반환(#994 저장용)");
assert.strictEqual(emitNarration("/repo/N", "빈", "   ", 21), null, "빈 note → 스킵(null)");
assert.strictEqual(emitNarration("/repo/N", "코드 편집", "다른 본문이지만 제목 같음", 22), null, "연속 동일 제목 → dedup 스킵(null)");
emitNarration("/repo/N", "테스트 실행", "vitest 돌림", 23); // 제목 다름 → 방출
un3();
assert.deepEqual(nar, ["코드 편집|App.tsx의 상태 관리를 useReducer로 바꾸는 중", "테스트 실행|vitest 돌림"], "narration 방출 + 빈 note·연속 동일 제목 스킵");
assert.ok(recent("/repo/N", 5).some((e) => e.kind === "narration" && e.note), "narration 링버퍼 조회");
assert.ok(emitNarration("/repo/C", "역할 · 카드", "1회차", 24, "crew|t1") && emitNarration("/repo/C", "역할 · 카드", "2회차", 25, "crew|t1"), "#1135 Crew 보고(tool 있음)는 같은 제목 연달아도 방출");

// #1049 문서 편집은 카드 안 띄움, 코드·명령은 그대로
{
  const got: string[] = []; const un = subscribe((e) => { if (e.root === "/doc") got.push(e.target); });
  emitEdit("/doc", "Write", "/doc/notes/01_학습정리.md", false, 1);
  emitEdit("/doc", "Edit", "/doc/src/a.ts", false, 2);
  emitEdit("/doc", "Bash", "cat README.md", false, 3);
  un();
  assert.deepStrictEqual(got, ["/doc/src/a.ts", "cat README.md"]);
}
console.log("mcpActivity.check OK");
