// 다른 앱에서 열기(#1199) — 잘 알려진 편집기·터미널·git 앱 중 설치된 것만. 설정 없이 감지(앱 폴더에 있는지).
// 열기는 `open -a <앱 경로> <폴더>`(셸 안 거침), Finder는 shell.openPath. 맥 외 OS는 파일 관리자만.
const path = require("node:path");
const os = require("node:os");
const fs = require("node:fs");

// [id, 종류, .app 이름 후보(앞이 우선)]
const APPS = [
  ["vscode", "editor", ["Visual Studio Code"]],
  ["cursor", "editor", ["Cursor"]],
  ["windsurf", "editor", ["Windsurf"]],
  ["zed", "editor", ["Zed"]],
  ["sublime", "editor", ["Sublime Text"]],
  ["nova", "editor", ["Nova"]],
  ["xcode", "editor", ["Xcode"]],
  ["intellij", "editor", ["IntelliJ IDEA", "IntelliJ IDEA CE", "IntelliJ IDEA Ultimate"]],
  ["webstorm", "editor", ["WebStorm"]],
  ["pycharm", "editor", ["PyCharm", "PyCharm CE", "PyCharm Professional Edition"]],
  ["goland", "editor", ["GoLand"]],
  ["rustrover", "editor", ["RustRover"]],
  ["androidstudio", "editor", ["Android Studio"]],
  ["terminal", "terminal", ["Terminal"]],
  ["iterm", "terminal", ["iTerm"]],
  ["ghostty", "terminal", ["Ghostty"]],
  ["warp", "terminal", ["Warp"]],
  ["wezterm", "terminal", ["WezTerm"]],
  ["kitty", "terminal", ["kitty"]],
  ["alacritty", "terminal", ["Alacritty"]],
  ["githubdesktop", "git", ["GitHub Desktop"]],
  ["fork", "git", ["Fork"]],
  ["tower", "git", ["Tower"]],
  ["sourcetree", "git", ["Sourcetree"]],
  ["gitkraken", "git", ["GitKraken"]],
];
const ROOTS = () => ["/Applications", "/Applications/Utilities", "/System/Applications", "/System/Applications/Utilities", path.join(os.homedir(), "Applications")];

// 설치된 앱 → [{ id, kind, name, appPath }]. exists는 점검용으로 바꿔 끼울 수 있게.
function detect(exists = (p) => fs.existsSync(p), roots = ROOTS()) {
  const out = [];
  for (const [id, kind, names] of APPS) {
    let hit = null;
    for (const n of names) { for (const r of roots) { const p = path.join(r, `${n}.app`); if (exists(p)) { hit = { name: n, appPath: p }; break; } } if (hit) break; }
    if (hit) out.push({ id, kind, ...hit });
  }
  return out;
}

// 열 폴더 검사 — 절대 경로·존재하는 폴더·줄바꿈/NUL 없음
function okDir(dir) {
  if (typeof dir !== "string" || !dir || /[\r\n\0]/.test(dir) || !path.isAbsolute(dir)) return false;
  try { return fs.statSync(dir).isDirectory(); } catch { return false; }
}

module.exports = { APPS, detect, okDir };
