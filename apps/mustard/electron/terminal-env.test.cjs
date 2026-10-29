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
const ide = applyTerminalEnv({ VSCODE_IPC_HOOK_CLI: "/s", TMUX: "/tmp/t,1,0", TMUX_PANE: "%1" });
for (const k of ["VSCODE_IPC_HOOK_CLI", "TMUX", "TMUX_PANE"]) assert.ok(!(k in ide), `${k} 지움`);
const R = "/App/Resources/x";
assert.strictEqual(applyTerminalEnv({ GHOSTTY_RESOURCES_DIR: R, ZDOTDIR: `${R}/shell-integration/zsh`, GHOSTTY_ZSH_ZDOTDIR: "/Users/x/.zsh" }).ZDOTDIR, "/Users/x/.zsh", "셸 통합이 바꾼 ZDOTDIR은 원래대로");
assert.ok(!("ZDOTDIR" in applyTerminalEnv({ GHOSTTY_RESOURCES_DIR: R, ZDOTDIR: `${R}/shell-integration/zsh`, GHOSTTY_ZSH_ZDOTDIR: "" })), "원래 없었으면 지움");
assert.strictEqual(applyTerminalEnv({ GHOSTTY_RESOURCES_DIR: R, ZDOTDIR: "/mine", GHOSTTY_ZSH_ZDOTDIR: "/old" }).ZDOTDIR, "/mine", "통합 폴더가 아니면(사용자가 바꾼 값) 그대로");
assert.strictEqual(applyTerminalEnv({ GHOSTTY_RESOURCES_DIR: R, ZDOTDIR: `${R}-mine`, GHOSTTY_ZSH_ZDOTDIR: "/old" }).ZDOTDIR, `${R}-mine`, "글자 앞부분만 같은 다른 폴더는 그대로");
assert.strictEqual(applyTerminalEnv({ ZDOTDIR: "/mine" }).ZDOTDIR, "/mine", "사용자 ZDOTDIR은 그대로");
console.log("terminal-env.test ok");
