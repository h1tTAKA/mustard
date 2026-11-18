// catchupBusy 점검 — node --experimental-strip-types src/lib/catchupBusy.check.ts
import assert from "node:assert";
import { beginBusy, busyOf, subscribeBusy } from "./catchupBusy.ts";

let calls = 0;
const off = subscribeBusy("/r", () => calls++);
const a = beginBusy("/r", "diff"), b = beginBusy("/r", "diff"), c = beginBusy("/r", "explain");
assert.deepStrictEqual(busyOf("/r"), { explain: 1, diff: 2, session: 0 });
const snap = busyOf("/r");
a(); a(); // 두 번 불러도 한 번만
assert.deepStrictEqual(busyOf("/r"), { explain: 1, diff: 1, session: 0 });
assert.notStrictEqual(busyOf("/r"), snap, "바뀌면 새 객체(스냅샷 비교)");
assert.strictEqual(busyOf("/r"), busyOf("/r"), "안 바뀌면 같은 객체");
b(); c();
assert.deepStrictEqual(busyOf("/r"), { explain: 0, diff: 0, session: 0 });
assert.deepStrictEqual(busyOf("/other"), { explain: 0, diff: 0, session: 0 }, "레포마다 따로");
assert.strictEqual(calls, 6, "바뀔 때마다 알림(시작 3 + 끝 3 — a를 두 번 불러도 한 번)");
off();
beginBusy("/r", "session")();
assert.strictEqual(calls, 6, "구독 끊으면 알림 없음");
console.log("catchupBusy ok");
