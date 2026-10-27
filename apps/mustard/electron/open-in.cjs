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

// 열 폴더 검사 → 실제 경로 | null. 절대 경로·줄바꿈/NUL 없음 → realpath(., .., 심볼릭 링크 풀기) → 폴더인지 →
// .app 같은 번들 폴더는 거부(Finder나 open으로 열면 그 앱·설치기가 실행됨)(리뷰). 열 때도 이 실제 경로를 씀.
const BUNDLE = /\.(app|bundle|framework|plugin|prefPane|kext|workflow|saver|appex|pkg|mpkg|component|action|qlgenerator|mdimporter|xpc|colorPicker)$/i;
function safeDir(dir) {
  if (typeof dir !== "string" || !dir || /[\r\n\0]/.test(dir) || !path.isAbsolute(dir)) return null;
  try {
    const real = fs.realpathSync(dir);
    return fs.statSync(real).isDirectory() && !BUNDLE.test(real) ? real : null;
  } catch { return null; }
}

module.exports = { APPS, detect, safeDir };
