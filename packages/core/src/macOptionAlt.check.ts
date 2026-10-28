// macOptionAlt 점검 — node --experimental-strip-types packages/core/src/macOptionAlt.check.ts
import assert from "node:assert";
import { effectiveMacOptionAsAlt as eff, readMacOptionAsAlt as read, altCharForCode as ch, isUsInputSource as us } from "./macOptionAlt.ts";

assert.ok(us("com.apple.keylayout.US") && us("com.apple.keylayout.ABC"));
assert.ok(!us("com.apple.inputmethod.Korean.2SetKorean") && !us("com.apple.keylayout.USInternational-PC") && !us(null));
assert.strictEqual(eff("auto", "com.apple.keylayout.ABC"), "both");
assert.strictEqual(eff("auto", "com.apple.inputmethod.Kotoeri.RomajiTyping.Japanese"), "off");
assert.strictEqual(eff("auto", null), "off", "모르면 Option 그대로");
assert.strictEqual(eff("left", null), "left");
assert.strictEqual(read(undefined, true), "both", "옛 스위치 켜짐 = 양쪽");
assert.strictEqual(read(undefined, false), "auto");
assert.strictEqual(read("right", true), "right", "새 값이 있으면 그걸");
assert.strictEqual(read("nope", false), "auto");
assert.strictEqual(ch("KeyB"), "b");
assert.strictEqual(ch("Digit3"), "3");
assert.strictEqual(ch("Period"), ".");
assert.strictEqual(ch("ArrowLeft"), null);
console.log("macOptionAlt ok");
