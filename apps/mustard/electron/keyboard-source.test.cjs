// keyboard-source 점검 — node apps/mustard/electron/keyboard-source.test.cjs
const assert = require("node:assert");
const { pickSourceId } = require("./keyboard-source.cjs");

assert.strictEqual(pickSourceId([{ "Bundle ID": "com.apple.PressAndHold", InputSourceKind: "Non Keyboard Input Method" }, { "Bundle ID": "com.apple.inputmethod.Korean", "Input Mode": "com.apple.inputmethod.Korean.2SetKorean", InputSourceKind: "Input Mode" }]), "com.apple.inputmethod.Korean.2SetKorean");
assert.strictEqual(pickSourceId([{ InputSourceKind: "Keyboard Layout", "KeyboardLayout Name": "ABC" }]), undefined, "배열이면 현재 배열 ID로 넘김");
assert.strictEqual(pickSourceId([{ "Bundle ID": "com.example.im", InputSourceKind: "Keyboard Input Method" }]), "com.example.im");
assert.strictEqual(pickSourceId(null), undefined);
console.log("keyboard-source ok");
