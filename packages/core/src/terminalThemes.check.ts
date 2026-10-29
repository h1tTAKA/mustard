// terminalThemes 점검 — node --experimental-strip-types packages/core/src/terminalThemes.check.ts
import assert from "node:assert";
import { parseGhosttyTheme as gh, completeColors as complete, normalizeHex as hex, packTheme, unpackTheme, MUSTARD_DARK, MUSTARD_GRAY, MUSTARD_LIGHT, resolveTermThemes as resolve, pickTermTheme as pick, readStoredTheme as stored, parseThemeFile as parse, addCustomThemes as addCustom, readOverrides, pickTermSlot } from "./terminalThemes.ts";

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
// 가져오기 — 형식 4종
const iterm = `<?xml version="1.0"?><plist><dict>
<key>Ansi 1 Color</key><dict><key>Blue Component</key><real>0.0</real><key>Green Component</key><real>0.0</real><key>Red Component</key><real>1</real></dict>
<key>Background Color</key><dict><key>Blue Component</key><real>0.2</real><key>Green Component</key><real>0.2</real><key>Red Component</key><real>0.2</real></dict>
<key>Foreground Color</key><dict><key>Blue Component</key><real>1</real><key>Green Component</key><real>1</real><key>Red Component</key><real>1</real></dict>
</dict></plist>`;
const it = parse("Neon.itermcolors", iterm, light);
assert.strictEqual(it.length, 1);
assert.strictEqual(it[0].name, "Neon", "이름 = 파일 이름");
assert.strictEqual(it[0].colors.red, "#ff0000");
assert.strictEqual(it[0].colors.background, "#333333");
const warp = parse("x.yaml", "name: Warp Night\naccent: '#ff00ff'\nbackground: '#101010'\nforeground: \"#eeeeee\"\ndetails: darker\nterminal_colors:\n  normal:\n    black: '#000000'\n    red: '#aa0000'\n  bright:\n    red: '#ff5555' # 주석\n", light);
assert.strictEqual(warp[0].name, "Warp Night");
assert.strictEqual(warp[0].colors.cursor, "#ff00ff", "커서 없으면 accent");
assert.strictEqual(warp[0].colors.red, "#aa0000");
assert.strictEqual(warp[0].colors.brightRed, "#ff5555");
const grad = parse("g.yml", "background:\n  top: '#202020'\n  bottom: '#000000'\nforeground: '#ffffff'\nterminal_colors:\n  normal:\n    red: '#ff0000'\n", light);
assert.strictEqual(grad[0].colors.background, "#202020", "그라데이션은 첫 색");
const wt = parse("wt.json", JSON.stringify({ name: "Campbell", background: "#0C0C0C", foreground: "#CCCCCC", purple: "#881798", red: "#C50F1F", cursorColor: "#FFFFFF" }), light);
assert.strictEqual(wt[0].colors.magenta, "#881798", "Windows Terminal purple = magenta");
const ours = parse("pack.json", JSON.stringify([{ name: "A", colors: MUSTARD_DARK.colors }, { name: "B", colors: MUSTARD_LIGHT.colors }]), light);
assert.deepStrictEqual(ours.map((t) => t.name), ["A", "B"]);
assert.strictEqual(parse("Dracula", "palette = 1=#ff5555\nbackground = #282a36\nforeground = #f8f8f2\n", light)[0].name, "Dracula", "Ghostty 테마");
assert.deepStrictEqual(parse("bad.json", "{oops", light), [], "깨진 JSON은 빈 목록");
assert.deepStrictEqual(parse("big", "x".repeat(300 * 1024), light), [], "256KB 넘으면 거부");
assert.strictEqual(parse("n\u0007ame.json", JSON.stringify({ colors: MUSTARD_DARK.colors }), light)[0].name, "name", "제어문자 제거");
const merged = addCustom([{ name: "A", colors: MUSTARD_GRAY.colors }, { name: "Z", colors: MUSTARD_GRAY.colors }, "junk"], ours);
assert.deepStrictEqual(merged.map((t) => t.name), ["A", "B", "Z"], "같은 이름은 바꿔 끼움, 깨진 값은 버림");
assert.strictEqual(merged[0].colors.background, MUSTARD_DARK.colors.background);
assert.deepStrictEqual(readOverrides({ red: "#F00", blue: "nope", hacker: "#000", background: "123456" }), { background: "#123456", red: "#ff0000" }, "hex·아는 키만");
assert.deepStrictEqual(readOverrides(null), {});
assert.strictEqual(pickTermSlot(resolve(undefined, undefined, undefined, "auto"), false), "light");
assert.strictEqual(pickTermSlot(resolve(undefined, undefined, false, "auto"), false), "dark", "라이트에도 다크용이면 다크 덮어쓰기");
assert.deepStrictEqual(addCustom([], [{ name: "A", colors: MUSTARD_DARK.colors }, { name: "A", colors: MUSTARD_LIGHT.colors }]).map((t) => t.colors.background), [MUSTARD_LIGHT.colors.background], "한 번에 같은 이름은 하나로(뒤에 온 것)");
assert.strictEqual(stored({ name: "x\u0007" + "y".repeat(200), colors: MUSTARD_DARK.colors })!.name.length, 80, "저장된 이름도 제어문자·길이 정리");
const t0 = Date.now(); parse("evil.itermcolors", "<dict>".repeat(40000), light); assert.ok(Date.now() - t0 < 500, "닫는 태그 없는 큰 입력도 빨리 끝");
console.log("terminalThemes ok");
