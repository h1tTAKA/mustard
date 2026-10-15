// catchupStore 점검 — MUSTARD_STREAM_DIR=<임시> node --experimental-strip-types src/lib/catchupStore.check.ts
import assert from "node:assert";
import { appendFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { appendItems, replaceItems, askCounts, dayKey, listDays, readAsk, readDay, readRecent, searchItems, sanitize, writeAsk } from "./catchupStore.ts";

assert.ok(process.env.MUSTARD_STREAM_DIR, "임시 디렉터리 필수(실 기록 보호)");
const root = "/tmp/repo-a";
const d1 = new Date(2026, 9, 5, 10).getTime(), d2 = new Date(2026, 9, 6, 9).getTime();
const it = (key: string, ts: number) => ({ key, kind: "narration" as const, target: key, tool: "narration", ts, expl: `설명 ${key}` });

assert.strictEqual(dayKey(d1), "2026-10-05");
assert.strictEqual(appendItems(root, [it("a", d1), it("b", d2), it("c", d2 + 1000)]), 3, "3개 추가");
assert.strictEqual(appendItems(root + "/", [it("a", d1), it("c", d2 + 1000)]), 0, "같은 날 같은 key 스킵(멱등), 끝 슬래시 정규화");
assert.deepStrictEqual(listDays(root), ["2026-10-06", "2026-10-05"], "날짜 최신순");
assert.deepStrictEqual(readDay(root, "2026-10-06").map((x) => x.key), ["c", "b"], "하루 최신순");
assert.deepStrictEqual(readRecent(root, 2).map((x) => x.key), ["c", "b"], "최근 limit");
assert.deepStrictEqual(readRecent(root, 10).map((x) => x.key), ["c", "b", "a"], "여러 날 이어서");
assert.deepStrictEqual(readDay(root, "../etc"), [], "날짜 형식 아니면 빈 배열(경로 탈출 차단)");
assert.strictEqual(sanitize({ key: "x", kind: "evil", target: "t", ts: 1, expl: "e" }), null, "모르는 kind 거부");
assert.strictEqual(sanitize({ key: "x", kind: "file", target: "t", ts: 1, expl: "  " }), null, "빈 설명 거부");
assert.deepStrictEqual(listDays("/tmp/none"), [], "없는 레포");
// 파일에 중복 줄이 생겨도(다중 프로세스 등) 읽을 때 key로 걸러냄
const dir = join(process.env.MUSTARD_STREAM_DIR!, readdirSync(process.env.MUSTARD_STREAM_DIR!)[0]);
appendFileSync(join(dir, "2026-10-06.jsonl"), JSON.stringify(it("b", d2)) + "\n");
assert.deepStrictEqual(readDay(root, "2026-10-06").map((x) => x.key), ["c", "b"], "중복 줄 읽기 dedupe");
// #1049 검색 — 전체 날짜, 최신순, 대소문자 무시, 빈 검색어는 빈 배열
assert.deepStrictEqual(searchItems(root, "", 10), [], "빈 검색어");
assert.ok(searchItems(root, readDay(root, "2026-10-05")[0].target.toUpperCase(), 10).some((x) => x.key === "a"), "지난 날짜도·대소문자 무시");
assert.strictEqual(searchItems(root, "없는검색어zzz", 10).length, 0);
// #998 질문 대화 저장·복원·배지
assert.strictEqual(readAsk(root, "narration|1|x"), null, "없는 대화 null");
const saved = writeAsk(root, { key: "narration|1|x", target: "x", messages: [{ role: "user", content: "q1" }, { role: "assistant", content: "a1" }, { role: "evil", content: "z" }, { role: "user", content: "q2" }] }, 99);
assert.strictEqual(saved?.messages.length, 3, "모르는 role 버림");
assert.deepStrictEqual(readAsk(root, "narration|1|x")?.messages.map((m) => m.content), ["q1", "a1", "q2"], "복원");
assert.deepStrictEqual(askCounts(root), { "narration|1|x": 2 }, "유저 질문 수 배지");
assert.strictEqual(writeAsk(root, { key: "", messages: [] }, 1), null, "빈 key 거부");
assert.deepStrictEqual(listDays(root), ["2026-10-06", "2026-10-05"], "ask 폴더가 날짜 목록에 안 섞임");
console.log("catchupStore ok");

// #1093 replaceItems — 같은 key 교체(복구), 다른 줄 보존, 실패 해설 카드는 읽을 때 숨김
{
  const r = "/tmp/repo-replace"; const t = new Date(2026, 9, 7, 9).getTime();
  appendItems(r, [{ ...it("diff|a|x.ts", t), kind: "diff" as never, expl: "런타임 실패: Max" }, it("keep", t)]);
  replaceItems(r, [{ ...it("diff|a|x.ts", t), kind: "diff" as never, expl: "정상 설명" }]);
  const day = readDay(r, "2026-10-07");
  assert.strictEqual(day.length, 2, "교체 후 줄 수 그대로");
  assert.strictEqual(day.find((x) => x.key === "diff|a|x.ts")?.expl, "정상 설명", "새 내용으로 교체");
  appendItems(r, [{ ...it("nar-fail", t), expl: "런타임 실패: Max active sessions" }]);
  assert.ok(!readDay(r, "2026-10-07").some((x) => x.key === "nar-fail"), "실패 해설 카드 숨김");
}
console.log("catchupStore.check ok");
