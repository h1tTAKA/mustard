import assert from "node:assert";
import { parseGhosttyConfig } from "./ghosttyConfig.ts";

const r = parseGhosttyConfig(`
# 주석
font-family = "JetBrains Mono"
font-family = Symbols Nerd Font
font-size = 14.5
cursor-style = block_hollow
cursor-style-blink = false
copy-on-select = clipboard
macos-option-as-alt = left
window-padding-x = 6,10
theme = light:Builtin Light,dark:Dracula
background = #101010
palette = 1=#ff0000
background-opacity = 0.9
keybind = cmd+t=new_tab
`);
assert.strictEqual(r.settings.fontFamily, "JetBrains Mono, Symbols Nerd Font, monospace");
assert.strictEqual(r.settings.fontSize, 15);
assert.strictEqual(r.settings.cursorStyle, "block");
assert.strictEqual(r.settings.cursorBlink, false);
assert.strictEqual(r.settings.copyOnSelect, true);
assert.strictEqual(r.settings.macOptionAsAlt, "left");
assert.strictEqual(r.settings.paddingX, 6);
assert.deepStrictEqual(r.theme, { dark: "Dracula", light: "Builtin Light" });
assert.strictEqual(r.colorLines, "background = #101010\npalette = 1=#ff0000");
assert.ok(r.skipped.includes("background-opacity") && r.skipped.includes("keybind"));

assert.deepStrictEqual(parseGhosttyConfig("theme = Nord").theme, { dark: "Nord" });
assert.strictEqual(parseGhosttyConfig("font-family = A\nfont-family =\nfont-family = B").settings.fontFamily, "B, monospace", "빈 값 = 목록 비우기");
assert.ok(parseGhosttyConfig("cursor-style = weird").skipped.includes("cursor-style"), "이상한 값은 건너뜀");
assert.strictEqual(parseGhosttyConfig("font-size = 99").settings.fontSize, 28);
assert.deepStrictEqual(parseGhosttyConfig("font-family =").used, [], "비우기만 = 가져온 것 없음");
console.log("ghosttyConfig.check OK");
