// settings 이관 점검(#1021) — 실행: node --experimental-strip-types packages/core/src/settings.check.ts
import assert from "node:assert";
import { migrateRenamed, withModel, stableSnapshot } from "./settings.ts";

const a: Record<string, unknown> = { "notif.suppressWhileFocused": false, x: 1 };
assert.strictEqual(migrateRenamed(a), true);
assert.deepStrictEqual(a, { x: 1, "notif.suppressWhileWatching": false }, "옛 값(false) 그대로 새 키로");
const b: Record<string, unknown> = { "notif.suppressWhileFocused": false, "notif.suppressWhileWatching": true };
migrateRenamed(b);
assert.deepStrictEqual(b, { "notif.suppressWhileWatching": true }, "새 키가 이미 있으면 새 값 우선, 옛 키만 삭제");
assert.strictEqual(migrateRenamed({ x: 1 }), false, "옛 키 없으면 무변경");
const c: Record<string, unknown> = { "catchup.commands": false, "catchup.terms": true };
migrateRenamed(c);
assert.deepStrictEqual(c, { "catchup.commandsAnalyze": false, "catchup.termsAnalyze": true }, "#1062 캐치업 옛 토글 → 분석 키");
// #1062 카테고리별 모델 — 그 프로바이더 설정에만 model 덮어씀, 빈 모델이면 그대로
const ps = { "claude-agent": { cliPath: "/x" } };
assert.deepStrictEqual(withModel(ps, "claude-agent", "opus"), { "claude-agent": { cliPath: "/x", model: "opus" } });
assert.strictEqual(withModel(ps, "claude-agent", ""), ps);
assert.deepStrictEqual(withModel(undefined, "codex-agent", "o3"), { "codex-agent": { model: "o3" } });
console.log("settings.check OK");

// #1231 객체 설정 값은 내용이 같으면 같은 참조(useSyncExternalStore 무한 렌더 방지)
const s1 = stableSnapshot("k", { name: "A", colors: { bg: "#000" } });
assert.strictEqual(stableSnapshot("k", { name: "A", colors: { bg: "#000" } }), s1, "같은 내용 = 같은 참조");
assert.notStrictEqual(stableSnapshot("k", { name: "B" }), s1, "내용이 바뀌면 새 값");
assert.strictEqual(stableSnapshot("n", 3), 3);
assert.strictEqual(stableSnapshot("u", undefined), undefined);
