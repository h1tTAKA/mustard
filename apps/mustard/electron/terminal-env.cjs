// #1226 터미널 셸의 색 능력 환경변수 — 앱을 어떻게 켰든(Dock·Finder면 COLORTERM 없음, 다른 터미널 안이면 그 터미널 값) 같게.
// CLI(Claude Code 등)는 COLORTERM이 truecolor일 때만 24비트 색(diff 줄 배경 등)을 씀.
const FOREIGN = /^(TERM_PROGRAM_VERSION|TERM_SESSION_ID|ITERM_\w+|LC_TERMINAL(_VERSION)?|KITTY_\w+|WEZTERM_\w+|GHOSTTY_\w+|ALACRITTY_\w+|WT_SESSION|WT_PROFILE_ID|VTE_VERSION)$/;

function applyTerminalEnv(env) {
  for (const k of Object.keys(env)) if (FOREIGN.test(k)) delete env[k]; // 앱을 켠 다른 터미널의 세션 값은 물려주지 않음
  env.TERM = "xterm-256color";
  env.COLORTERM = "truecolor";
  env.TERM_PROGRAM = "Mustard";
  return env;
}

module.exports = { applyTerminalEnv };
