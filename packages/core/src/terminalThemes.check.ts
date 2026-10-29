// terminalThemes 점검 — node --experimental-strip-types packages/core/src/terminalThemes.check.ts
import assert from "node:assert";
import { parseGhosttyTheme as gh, completeColors as complete, normalizeHex as hex, packTheme, unpackTheme, MUSTARD_DARK, MUSTARD_GRAY, MUSTARD_LIGHT, resolveTermThemes as resolve, pickTermTheme as pick, readStoredTheme as stored } from "./terminalThemes.ts";

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
// 옛 값 옮겨 읽기
assert.deepStrictEqual(resolve(undefined, undefined, undefined, "auto"), { dark: MUSTARD_DARK, light: MUSTARD_LIGHT, separate: true }, "옛 자동 = 모드별 따로");
assert.strictEqual(resolve(undefined, undefined, undefined, "gray").dark, MUSTARD_GRAY);
assert.strictEqual(resolve(undefined, undefined, undefined, "gray").separate, false, "옛 고정 = 테마 하나로");
assert.strictEqual(pick(resolve(undefined, undefined, undefined, "light"), true), MUSTARD_LIGHT, "옛 라이트 고정은 앱이 다크여도 라이트");
assert.strictEqual(pick(resolve(undefined, undefined, undefined, "auto"), false), MUSTARD_LIGHT);
assert.strictEqual(pick(resolve(undefined, undefined, undefined, "auto"), true), MUSTARD_DARK);
const drac = { name: "Dracula", colors: { ...MUSTARD_DARK.colors, background: "#282a36" } };
assert.strictEqual(resolve(drac, undefined, false, "light").dark.name, "Dracula", "새 값이 있으면 그걸");
assert.strictEqual(pick(resolve(drac, undefined, false, "auto"), false).name, "Dracula", "라이트에도 다크용");
assert.strictEqual(stored({ name: "x", colors: { background: "#000" } }), null, "색 빠진 저장값은 버림");
assert.strictEqual(stored("nope"), null);
console.log("terminalThemes ok");
