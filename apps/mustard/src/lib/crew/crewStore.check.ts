// crewStore 점검 — MUSTARD_CREW_DIR=<임시> node --experimental-strip-types src/lib/crew/crewStore.check.ts
import assert from "node:assert";
import { readdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { applyOp, boardFile, readBoard, sanitizeTask } from "./crewStore.ts";

assert.ok(process.env.MUSTARD_CREW_DIR, "임시 디렉터리 필수(실 보드 보호)");
const root = "/tmp/repo-crew";

assert.deepStrictEqual(readBoard(root), { version: 1, tasks: [] }, "없으면 빈 보드");
assert.throws(() => applyOp(root, { op: "create", title: "  " }), /title required/);

let b = applyOp(root, { op: "create", title: "로그인 버그" });
b = applyOp(root, { op: "create", title: "문서" });
b = applyOp(root, { op: "create", title: "준비 칸", status: "ready" });
const [a1, a2] = b.tasks.filter((t) => t.status === "backlog").sort((x, y) => x.order - y.order);
assert.deepStrictEqual([a1.title, a1.order, a2.title, a2.order], ["로그인 버그", 0, "문서", 1], "칸 맨 아래로 추가");

b = applyOp(root, { op: "move", id: a2.id, status: "backlog", index: 0 });
assert.deepStrictEqual(b.tasks.filter((t) => t.status === "backlog").sort((x, y) => x.order - y.order).map((t) => t.title), ["문서", "로그인 버그"], "같은 칸 순서 바꿈");

b = applyOp(root, { op: "move", id: a1.id, status: "ready", index: 0 });
const ready = b.tasks.filter((t) => t.status === "ready").sort((x, y) => x.order - y.order);
assert.deepStrictEqual(ready.map((t) => [t.title, t.order]), [["로그인 버그", 0], ["준비 칸", 1]], "다른 칸 맨 위로");
assert.deepStrictEqual(b.tasks.filter((t) => t.status === "backlog").map((t) => t.order), [0], "떠난 칸 번호 다시");

b = applyOp(root, { op: "update", id: a1.id, body: "재현: 새로고침 후 로그아웃" });
assert.strictEqual(b.tasks.find((t) => t.id === a1.id)?.body, "재현: 새로고침 후 로그아웃");
assert.throws(() => applyOp(root, { op: "move", id: a1.id, status: "nope" as never, index: 0 }), /bad status/);
assert.throws(() => applyOp(root, { op: "delete", id: "x" }), /task not found/);

b = applyOp(root, { op: "delete", id: ready[1].id });
assert.strictEqual(b.tasks.length, 2);
assert.strictEqual(readBoard(root).tasks.length, 2, "파일에 남음");

assert.strictEqual(sanitizeTask({ id: "x", title: "t", status: "weird" }), null, "모르는 칸 거부");

// 깨진 파일 — 빈 보드로 시작, 원본은 백업으로 남김
const r2 = "/tmp/repo-broken";
applyOp(r2, { op: "create", title: "a" });
writeFileSync(boardFile(r2), "{oops");
const dir = dirname(boardFile(r2));
assert.deepStrictEqual(readBoard(r2).tasks, [], "깨진 파일 = 빈 보드");
assert.strictEqual(readBoard(root).tasks.length, 2, "다른 레포 보드는 그대로");
assert.ok(readdirSync(dir).some((f) => f.startsWith("board.json.broken-")), "깨진 원본 백업");

console.log("crewStore.check ok");
