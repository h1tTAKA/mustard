// #1226 터미널 셸의 색 능력 환경변수 — 앱을 어떻게 켰든(Dock·Finder면 COLORTERM 없음, 다른 터미널 안이면 그 터미널 값) 같게.
// CLI(Claude Code 등)는 COLORTERM이 truecolor일 때만 24비트 색(diff 줄 배경 등)을 씀.
// 편집기 통합 터미널·tmux 세션 값도 — 남으면 이 셸의 `code`·`tmux`가 바깥 세션에 붙음(리뷰).
const FOREIGN = /^(TERM_PROGRAM_VERSION|TERM_SESSION_ID|ITERM_\w+|LC_TERMINAL(_VERSION)?|KITTY_\w+|WEZTERM_\w+|GHOSTTY_\w+|ALACRITTY_\w+|WT_SESSION|WT_PROFILE_ID|VTE_VERSION|VSCODE_\w+|TMUX|TMUX_PANE|STY)$/;

function applyTerminalEnv(env) {
  // 셸 통합이 ZDOTDIR을 자기 폴더로 돌려 두고 원래 값을 따로 보관하는 경우 — 보관값을 지우기 전에 원래대로(rc 체인이 반쪽 되지 않게, 리뷰)
  // ZDOTDIR이 실제로 그 통합 폴더(리소스 폴더 아래)일 때만 — 사용자가 직접 바꾼 값은 건드리지 않음(재리뷰)
  const res = env.GHOSTTY_RESOURCES_DIR;
  if ("GHOSTTY_ZSH_ZDOTDIR" in env && res && typeof env.ZDOTDIR === "string" && (env.ZDOTDIR === res || env.ZDOTDIR.startsWith(res.replace(/\/+$/, "") + "/"))) {
    if (env.GHOSTTY_ZSH_ZDOTDIR) env.ZDOTDIR = env.GHOSTTY_ZSH_ZDOTDIR; else delete env.ZDOTDIR;
  }
  for (const k of Object.keys(env)) if (FOREIGN.test(k)) delete env[k]; // 앱을 켠 다른 터미널의 세션 값은 물려주지 않음
  env.TERM = "xterm-256color";
  env.COLORTERM = "truecolor";
  env.TERM_PROGRAM = "Mustard";
  return env;
}

module.exports = { applyTerminalEnv };
