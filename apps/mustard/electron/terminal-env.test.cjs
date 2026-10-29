// terminal-env 점검(#1226) — node apps/mustard/electron/terminal-env.test.cjs
const assert = require("node:assert");
const { applyTerminalEnv } = require("./terminal-env.cjs");

const dock = applyTerminalEnv({ PATH: "/usr/bin", HOME: "/Users/x" }); // Dock·Finder로 켠 앱(COLORTERM 없음)
assert.strictEqual(dock.COLORTERM, "truecolor", "트루컬러 알림");
assert.strictEqual(dock.TERM, "xterm-256color");
assert.strictEqual(dock.TERM_PROGRAM, "Mustard");
assert.strictEqual(dock.PATH, "/usr/bin", "다른 값은 그대로");
const nested = applyTerminalEnv({ COLORTERM: "", TERM: "screen", TERM_PROGRAM: "OtherTerm", TERM_PROGRAM_VERSION: "1.2", ITERM_SESSION_ID: "w0", LC_TERMINAL: "iTerm2", GHOSTTY_RESOURCES_DIR: "/x", TERMINFO: "/t" });
assert.strictEqual(nested.TERM_PROGRAM, "Mustard", "다른 터미널 안에서 켜도 우리 이름");
assert.strictEqual(nested.COLORTERM, "truecolor");
for (const k of ["TERM_PROGRAM_VERSION", "ITERM_SESSION_ID", "LC_TERMINAL", "GHOSTTY_RESOURCES_DIR"]) assert.ok(!(k in nested), `${k} 지움`);
assert.strictEqual(nested.TERMINFO, "/t", "모르는 값은 건드리지 않음");
console.log("terminal-env.test ok");
