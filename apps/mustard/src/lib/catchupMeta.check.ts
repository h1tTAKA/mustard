// catchupMeta 점검 — node --experimental-strip-types src/lib/catchupMeta.check.ts
import assert from "node:assert";
import { byNewest, cardMeta, collectFacets, commitMs, tagMatches } from "./catchupMeta.ts";

const diff = (hash: string, tool: string, ts: number) => ({ kind: "diff", key: `diff|${hash}|a.ts`, tool, target: `a.ts @${hash.slice(0, 7)}`, ts });
const sess = (hash: string, tool: string, subject: string, ts: number) => ({ kind: "session", key: `session|${hash}`, tool, target: `${subject} @${hash.slice(0, 7)}`, ts });

assert.deepStrictEqual(cardMeta(diff("abcdef1234", "main · 고침", 1)), { hash: "abcdef1", branch: "main", agent: "" });
assert.deepStrictEqual(cardMeta(diff("abcdef1234", "diff", 1)), { hash: "abcdef1", branch: "", agent: "" }, "옛 diff 카드");
assert.deepStrictEqual(cardMeta(sess("1234567890", "Claude Code · feat/x", "추가", 1)), { hash: "1234567", agent: "Claude Code", branch: "feat/x" });
assert.strictEqual(cardMeta({ kind: "narration", key: "narration|1|x", tool: "narration" }), null);
assert.ok(tagMatches(sess("1234567890", "Codex · main", "s", 1), "hash", "1234567890"), "긴 해시도 앞 7자로");
assert.ok(tagMatches(sess("1234567890", "Codex · main", "s", 1), "agent", "Codex"));
assert.ok(!tagMatches(diff("abcdef1234", "main · x", 1), "agent", ""), "빈 값은 안 맞음");
assert.ok(!tagMatches({ kind: "file", key: "file|a", tool: "katchup" }, "branch", "main"));

const f = collectFacets([
  sess("bbbbbbb000", "Claude Code · feat/b", "새 기능", 30),
  diff("bbbbbbb000", "feat/b · 새 기능", 29),
  diff("aaaaaaa000", "diff", 20),
  sess("aaaaaaa000", "Codex · main", "옛 고침", 19),
  diff("ccccccc000", "main · 더 옛것", 10),
]);
assert.deepStrictEqual(f.branch.map((x) => x.value), ["feat/b", "main"], "브랜치 최신순·중복 없음(옛 diff 빈 브랜치 제외)");
assert.deepStrictEqual(f.agent.map((x) => x.value), ["Claude Code", "Codex"]);
assert.deepStrictEqual(f.hash.map((x) => [x.value, x.label]), [["bbbbbbb", "새 기능"], ["aaaaaaa", "옛 고침"], ["ccccccc", "더 옛것"]], "해시 label = 커밋 제목(옛 diff는 세션 제목으로 채움)");
assert.strictEqual(f.hash[0].ts, 30, "해시 시각 = 가장 최신 카드");
assert.strictEqual(collectFacets(Array.from({ length: 80 }, (_, i) => diff(`${String(i).padStart(7, "0")}abc`, `b${i} · s`, 100 - i)), 50).branch.length, 50, "종류마다 상한");
// #1244 같은 시각이면 key 순서(diff → session), 아니면 최신 먼저
assert.deepStrictEqual([{ ts: 5, key: "session|a" }, { ts: 5, key: "diff|a|y" }, { ts: 9, key: "z" }, { ts: 5, key: "diff|a|x" }].sort(byNewest).map((x) => x.key), ["z", "diff|a|x", "diff|a|y", "session|a"]);
// #1255 같은 초 커밋 = 커밋 순서(최신이 큼), 다른 초는 그대로
assert.deepStrictEqual(commitMs([{ ts: 20 }, { ts: 10 }, { ts: 10 }, { ts: 10 }, { ts: 9 }]).map((c) => c.ms), [20000, 10002, 10001, 10000, 9000]);
console.log("catchupMeta.check ok");
