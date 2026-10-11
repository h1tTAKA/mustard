// shortcuts 점검(#1027) — 실행: node --experimental-strip-types packages/core/src/shortcuts.check.ts
import assert from "node:assert";
import { SHORTCUTS, appChords, chordFromEvent, findConflicts, formatChord, matchShortcut, normalizeChord } from "./shortcuts.ts";

const ev = (code: string, m: Partial<{ meta: boolean; ctrl: boolean; alt: boolean; shift: boolean }> = {}) =>
  ({ code, metaKey: !!m.meta, ctrlKey: !!m.ctrl, altKey: !!m.alt, shiftKey: !!m.shift });

assert.strictEqual(normalizeChord("shift+cmd+]"), "Mod+Shift+]", "수식키 순서·별칭 정규화");
assert.strictEqual(normalizeChord("Mod+k"), "Mod+K");
assert.strictEqual(normalizeChord("K"), null, "수식키 없는 단축키 거부");
assert.strictEqual(normalizeChord("Mod+A+B"), null, "키 두 개 거부");

assert.strictEqual(chordFromEvent(ev("BracketRight", { meta: true, shift: true }), true), "Mod+Shift+]", "⇧⌘] (e.key가 } 여도 code로)");
assert.strictEqual(chordFromEvent(ev("BracketRight", { meta: true, alt: true }), true), "Mod+Alt+]", "⌥가 e.key를 바꿔도 동일");
assert.strictEqual(chordFromEvent(ev("KeyC", { ctrl: true }), true), "Ctrl+C", "mac ⌃C는 Mod 아님(셸 몫)");
assert.strictEqual(chordFromEvent(ev("KeyK"), true), null, "수식키 없으면 null");
assert.strictEqual(chordFromEvent(ev("ShiftLeft", { shift: true }), true), null, "수식키만");

assert.strictEqual(matchShortcut("Mod+K", false)?.id, "palette", "터미널 밖 ⌘K = 팔레트");
assert.strictEqual(matchShortcut("Mod+K", true)?.id, "term.clear", "터미널 포커스 ⌘K = 화면 지우기(관례)");
assert.strictEqual(matchShortcut("Mod+Shift+P", true)?.id, "palette", "⇧⌘P는 터미널에서도 팔레트");
assert.strictEqual(matchShortcut("Mod+Alt+3", false)?.id, "repo.goto3");
assert.strictEqual(matchShortcut("Mod+9", false)?.arg, 9);
assert.strictEqual(matchShortcut("Mod+B", false, { "view.left": [] }), null, "끈 단축키");
assert.strictEqual(matchShortcut("Mod+J", false, { "view.left": ["Mod+J"] })?.id, "view.left", "사용자 덮어쓰기");

assert.deepStrictEqual(findConflicts({}), [], "기본값끼리는 경고 안 함(⌘K 팔레트↔지우기 의도)");
const c = findConflicts({ "view.left": ["Mod+L"] });
assert.ok(c.some((x) => x.chord === "Mod+L" && x.ids.includes("view.left") && x.ids.includes("view.right")), "사용자 지정이 겹치면 경고");

const ids = SHORTCUTS.map((s) => s.id);
assert.strictEqual(ids.length, new Set(ids).size, "id 중복 없음");
for (const s of SHORTCUTS) for (const d of s.defaults) {
  assert.ok(normalizeChord(d), `기본값 형식 ${s.id} ${d}`);
  assert.ok(!/^(Ctrl|Alt)\+[A-Z]$/.test(normalizeChord(d)!), `⌃/⌥+글자 기본값 금지 ${s.id}`);
}
assert.strictEqual(formatChord("Mod+Shift+]", true), "⇧⌘]");
assert.strictEqual(formatChord("Mod+Alt+=", true), "⌥⌘=");
assert.strictEqual(formatChord("Mod+Shift+]", false), "Ctrl+Shift+]");
// 인앱 브라우저용 앱 조합(#1034) — terminal 범위(⌘K 화면 지우기)는 빼되 같은 ⌘K 팔레트는 포함, 덮어쓰기 반영, 중복 없음
const ac = appChords();
assert.ok(ac.includes("Mod+K") && ac.includes("Mod+W") && ac.includes("Mod+1"));
assert.strictEqual(ac.length, new Set(ac).size);
const ac2 = appChords({ "view.left": [], palette: ["Mod+Shift+P"] });
assert.ok(!ac2.includes("Mod+B") && !ac2.includes("Mod+K"));
console.log("shortcuts.check OK");
