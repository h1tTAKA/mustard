// #1095 Electron main이 렌더러로 돌려주는 사용자 노출 문구(GitHub 연결·토큰·터미널 구분선)의 다국어.
// 앱 언어는 렌더러 localStorage라 main이 못 읽음 → 캐치업 config가 서버에서 저장하는 ~/.nunopi/narration-locale(#1091)을 읽음.
// ponytail: 문구 몇 개라 사전을 여기 둠(messages.ts는 TS라 CJS main에서 require 불가) — 늘어나면 빌드 단계에서 JSON으로 뽑기.
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { homedir } = require("node:os");

const FILE = join(homedir(), ".nunopi", "narration-locale");
let cache = { at: 0, v: "ko" };
function mainLocale() {
  if (Date.now() - cache.at < 5000) return cache.v;
  let v = "ko";
  try { const s = readFileSync(FILE, "utf8").trim(); if (s === "ja" || s === "en" || s === "ko") v = s; } catch { /* 없음 = ko */ }
  cache = { at: Date.now(), v };
  return v;
}

const DICT = {
  "gh.notInstalled": { ko: "gh(GitHub CLI)를 찾을 수 없음", ja: "gh(GitHub CLI)が見つかりません", en: "gh (GitHub CLI) not found" },
  "gh.notAuthed": { ko: "인증 필요 — 터미널에서 `gh auth login` 또는 `glab auth login`", ja: "認証が必要です — ターミナルで `gh auth login` または `glab auth login`", en: "Authentication required — run `gh auth login` or `glab auth login` in a terminal" },
  "gh.rateLimited": { ko: "API rate limit — 잠시 후 재시도", ja: "API レート制限 — しばらくして再試行してください", en: "API rate limit — try again shortly" },
  "gh.runError": { ko: "gh 실행 오류", ja: "gh 実行エラー", en: "gh execution error" },
  "gh.noCwd": { ko: "작업 디렉터리를 찾을 수 없음", ja: "作業ディレクトリが見つかりません", en: "Working directory not found" },
  "gh.parseFailed": { ko: "gh --json 출력 파싱 실패", ja: "gh --json の出力を解析できません", en: "Failed to parse gh --json output" },
  "token.noSafeStorage": { ko: "이 환경은 안전한 토큰 저장을 지원하지 않음(safeStorage 불가)", ja: "この環境は安全なトークン保存に対応していません(safeStorage 不可)", en: "Secure token storage is not available in this environment (safeStorage unavailable)" },
  "token.empty": { ko: "빈 토큰", ja: "トークンが空です", en: "Empty token" },
  "term.previousSession": { ko: "── 이전 세션 내용(재시작 전) ──", ja: "── 前回のセッション内容(再起動前) ──", en: "── Previous session (before restart) ──" },
};
const tm = (key) => (DICT[key] && (DICT[key][mainLocale()] || DICT[key].ko)) || key;

module.exports = { tm, mainLocale };
