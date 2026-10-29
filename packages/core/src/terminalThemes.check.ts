// terminalThemes 점검 — node --experimental-strip-types packages/core/src/terminalThemes.check.ts
import assert from "node:assert";
import { parseGhosttyTheme as gh, completeColors as complete, normalizeHex as hex, packTheme, unpackTheme, MUSTARD_DARK, MUSTARD_LIGHT } from "./terminalThemes.ts";

const light = (h: string) => h === "#ffffff" || h === "#fdf6e3";
assert.strictEqual(hex("#ABC"), "#aabbcc");
assert.strictEqual(hex("282a36"), "#282a36", "# 없어도");
assert.strictEqual(hex("#12345"), null);
assert.strictEqual(hex("red"), null);

const dracula = gh("palette = 0=#21222c\npalette = 1=#ff5555\n# 주석\npalette = 15=#ffffff\npalette = 16=#123456\nbackground = #282a36\nforeground = #f8f8f2\ncursor-color = #f8f8f2\ncursor-text = #282a36\nselection-background = #44475a\nunknown = 1\n");
assert.strictEqual(dracula.black, "#21222c");
assert.strictEqual(dracula.brightWhite, "#ffffff");
assert.strictEqual(dracula.background, "#282a36");
assert.strictEqual(dracula.cursorAccent, "#282a36");
assert.ok(!("16" in dracula), "16번 이상 팔레트는 무시");

const full = complete(dracula, light)!;
assert.strictEqual(full.red, "#ff5555");
assert.strictEqual(full.green, MUSTARD_DARK.colors.green, "빈 칸은 어두운 배경이면 Mustard Dark로");
assert.strictEqual(complete({ background: "#ffffff", foreground: "#000000", red: "#ff0000" }, light)!.blue, MUSTARD_LIGHT.colors.blue, "밝은 배경이면 Mustard Light로");
assert.strictEqual(complete({ background: "#ffffff", foreground: "#000000", red: "#f00" }, light)!.cursor, "#000000", "커서 없으면 글자색");
assert.strictEqual(complete({ background: "#ffffff", red: "#f00" }, light), null, "글자색 없으면 거부");
assert.strictEqual(complete({ background: "#ffffff", foreground: "#000" }, light), null, "ANSI 하나도 없으면 거부");

const round = unpackTheme(packTheme(MUSTARD_DARK))!;
assert.deepStrictEqual(round, { name: MUSTARD_DARK.name, colors: { ...MUSTARD_DARK.colors } }, "선택 글자색 빈 칸도 왕복");
assert.strictEqual(unpackTheme(["x", "#000"]), null, "길이 틀리면 거부");
assert.strictEqual(unpackTheme(packTheme(MUSTARD_DARK).map((v, i) => (i === 1 ? "nope" : v))), null, "필수 색이 hex 아니면 거부");
console.log("terminalThemes ok");
