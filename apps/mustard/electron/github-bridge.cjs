// GitHub 패널(#809) gh CLI 브릿지(#810) — gh를 execFile(no-shell)로 실행하는 단일 창구 + 인증 진단.
// orca(stablyai/orca) src/main/github(gh-utils·auth-diagnose) 방식 채택: 유저 기존 gh auth 사용, --json 구조화.
// 서브3~5(checks/이슈/PR)는 이 헬퍼에 args만 조립해 재사용한다.
const { execFile } = require("node:child_process");
const { existsSync, statSync } = require("node:fs");
const { promisify } = require("node:util");
const pexecFile = promisify(execFile);
const { tm } = require("./main-i18n.cjs"); // #1095 사용자 노출 문구 다국어

// gh 에러 분류 — UI가 "설치 필요/인증 필요/rate limit" 등 안내를 그릴 수 있게.
function classifyGhError(e) {
  if (e?.code === "ENOENT") return { kind: "not-installed", detail: tm("gh.notInstalled") };
  const s = String(e?.stderr || e?.message || "").toLowerCase();
  // #964 glab은 미인증 시 "401 Unauthorized"로 나옴(gh 문구와 다름) → 401/unauthorized도 not-authed.
  if (/auth login|not logged|authentication|gh auth|no accounts|unauthorized|\b401\b/.test(s)) return { kind: "not-authed", detail: tm("gh.notAuthed") };
  if (/rate limit|api rate|\b403\b/.test(s)) return { kind: "rate-limited", detail: tm("gh.rateLimited") };
  const line = (String(e?.stderr || e?.message || "").split("\n").find((l) => l.trim()) || tm("gh.runError")).trim();
  return { kind: "error", detail: line.slice(0, 300) };
}

// gh 원시 실행. cwd=레포 디렉터리, args=배열(no-shell). env=주입 환경(토큰 폴백 GH_TOKEN, #826). 없으면 process.env.
// 성공 { ok, stdout } | 실패 { ok:false, kind, detail }.
async function ghRun({ gh, cwd, args, timeout = 15000, env }) {
  // cwd 없음/비디렉터리면 execFile이 ENOENT를 던져 gh 미설치로 오분류됨 → 먼저 걸러 error로.
  if (cwd && (!existsSync(cwd) || !statSync(cwd).isDirectory())) return { ok: false, kind: "error", detail: tm("gh.noCwd") };
  try {
    const { stdout } = await pexecFile(gh || "gh", args, { cwd, timeout, maxBuffer: 10_000_000, env: env || process.env });
    return { ok: true, stdout };
  } catch (e) {
    return { ok: false, ...classifyGhError(e) };
  }
}

// gh --json 실행 후 파싱. 성공 { ok, data } | 실패 { ok:false, kind, detail }. (호출부가 args에 --json,필드 포함)
async function ghJson({ gh, cwd, args, env }) {
  const r = await ghRun({ gh, cwd, args, env });
  if (!r.ok) return r;
  try { return { ok: true, data: JSON.parse(r.stdout || "null") }; }
  catch { return { ok: false, kind: "error", detail: tm("gh.parseFailed") }; }
}

// 인증 진단 — { state: "ok"|"not-installed"|"not-authed"|"rate-limited"|"error", detail? }.
// env에 GH_TOKEN 주입되면(#826) gh auth status가 그 토큰으로 exit 0 → ok.
async function authDiagnose({ gh, cwd, env }) {
  const r = await ghRun({ gh, cwd, args: ["auth", "status"], timeout: 8000, env });
  if (r.ok) return { state: "ok" };
  return { state: r.kind, detail: r.detail };
}

// PR diff(#1123) — `gh pr diff N` 전체를 파일별로 자름. 경로는 `+++ b/…`(삭제면 `--- a/…`)에서 — 이름에 공백 있어
// `diff --git "a/x y" "b/x y"`처럼 따옴표로 감싸져도 +++/--- 줄 기준이라 안전. 반환 { [path]: 그 파일의 diff 텍스트 }.
function unquote(p) {
  const s = p.trim();
  if (s.startsWith('"') && s.endsWith('"')) { try { return JSON.parse(s); } catch { return s.slice(1, -1); } }
  return s;
}
function splitDiffByFile(raw) {
  const out = {};
  const parts = String(raw || "").split(/^(?=diff --git )/m).filter((x) => x.startsWith("diff --git "));
  for (const part of parts) {
    const plus = part.match(/^\+\+\+ (.+)$/m), minus = part.match(/^--- (.+)$/m);
    let path = null;
    if (plus && unquote(plus[1]) !== "/dev/null") path = unquote(plus[1]).replace(/^b\//, "");
    else if (minus && unquote(minus[1]) !== "/dev/null") path = unquote(minus[1]).replace(/^a\//, "");
    if (!path) { // 바이너리·모드만 바뀜 등 +++/--- 없음 → 헤더에서
      const m = part.match(/^diff --git (?:"?a\/)(.+?)"? (?:"?b\/)(.+?)"?$/m);
      if (m) path = m[2];
    }
    if (path) out[path] = part;
  }
  return out;
}

module.exports = { ghRun, ghJson, authDiagnose, classifyGhError, splitDiffByFile };
