// 빠른 명령 점검(#1194) — 실행: node --experimental-strip-types packages/core/src/quickCommands.check.ts
import assert from "node:assert";
import { normalizeQuickCommands, quickCommandsFor, quickShellInput } from "./quickCommands.ts";

// 정리 — 잘못된 것·빈 것·중복 id 버림, 셸은 enter 기본 켬, 에이전트는 enter 없음
const list = normalizeQuickCommands([
  { id: "a", name: "개발 서버", kind: "shell", text: "npm run dev" },
  { id: "b", name: "  ", kind: "shell", text: "x" },
  { id: "a", name: "중복", kind: "shell", text: "y" },
  { id: "c", name: "테스트 고치기", kind: "agent", text: "테스트 돌리고 실패 고쳐줘", enter: true, repo: "/r" },
  { id: "d", name: "입력만", kind: "shell", text: "git commit -m ", enter: false },
  null, 3, { name: "id 없음", text: "z" },
]);
assert.deepStrictEqual(list.map((c) => c.id), ["a", "c", "d"]);
assert.strictEqual(list[0].enter, true);
assert.strictEqual(list[1].enter, false, "에이전트는 enter 없음");
assert.strictEqual(list[1].repo, "/r");
assert.deepStrictEqual(normalizeQuickCommands("nope"), []);
assert.strictEqual(normalizeQuickCommands([{ id: "x", name: "n".repeat(200), text: "t".repeat(5000) }])[0].text.length, 4000, "길이 자르기");

// 이 레포 것 먼저, 다른 레포 것은 안 보임
assert.deepStrictEqual(quickCommandsFor(list, "/r").map((c) => c.id), ["c", "a", "d"]);
assert.deepStrictEqual(quickCommandsFor(list, "/other").map((c) => c.id), ["a", "d"]);
assert.deepStrictEqual(quickCommandsFor(list, null).map((c) => c.id), ["a", "d"]);

// 터미널 입력 — Enter 설정대로, 여러 줄은 줄마다
assert.strictEqual(quickShellInput(list[0]), "npm run dev\r");
assert.strictEqual(quickShellInput(list[2]), "git commit -m ", "입력만(Enter 없음)");
assert.strictEqual(quickShellInput({ id: "m", name: "m", kind: "shell", text: "a\nb\n\n", enter: true }), "a\rb\r");

console.log("quickCommands ok");
