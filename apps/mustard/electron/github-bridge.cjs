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
  // #1151 시간 초과(응답 없음) = 연결 안 됨 — stderr가 비면 message("Command failed: gh auth status …")가 인증 문구로 잡혀 로그인 필요로 오분류(리뷰)
  if (e?.killed) return { kind: "offline", detail: tm("gh.offline") };
  const s = String(e?.stderr || e?.message || "").toLowerCase();
  // #1151 인터넷 끊김 — 인증 검사보다 먼저(오프라인 gh 오류엔 "gh auth login" 안내가 섞여 나와 로그인 필요로 오분류됐음).
  // gh가 낸 오류 글(stderr)에서만 — message엔 실행 인자(검색어 등)가 들어 있어 오판(리뷰).
  if (/dial tcp|no such host|connection refused|connection reset|i\/o timeout|network is unreachable|tls handshake timeout|could not resolve host|error connecting to/.test(String(e?.stderr || "").toLowerCase())) return { kind: "offline", detail: tm("gh.offline") };
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
    return { ok: false, ...classifyGhError(e), ...(e?.killed ? { timedOut: true } : {}) }; // #1151 시간 초과(응답 없음)
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
// #1151 probe(gh만) — 오프라인 gh auth status는 네트워크 말 없이 "token invalid, gh auth login"만 냄 → 로그인 필요(또는 시간 초과)면 API를 한 번 더(rate_limit = 호출 한도 안 잡힘):
// probe가 네트워크 오류·시간 초과면 offline, 그 밖엔 원래 판정 그대로. probe가 성공해도 ok로 바꾸지 않음 — 기본 호스트만 묻는 거라 다른 호스트(GHE) 로그인 풀림을 가림(리뷰).
async function authDiagnose({ gh, cwd, env, probe }) {
  const r = await ghRun({ gh, cwd, args: ["auth", "status"], timeout: 8000, env });
  if (r.ok) return { state: "ok" };
  // offline은 detail 없이 — 화면 제목이 같은 말을 함(두 번 안 보이게, 리뷰). auth status부터 시간 초과면 probe 없이 바로(8초 + 8초 대기 방지, 리뷰).
  if (r.kind === "offline" || r.timedOut) return { state: "offline" };
  if (r.kind === "not-authed" && probe) {
    const p = await ghRun({ gh, cwd, args: probe, timeout: 8000, env });
    if (!p.ok && (p.kind === "offline" || p.timedOut)) return { state: "offline" };
  }
  return { state: r.kind, detail: r.detail };
}

// PR diff(#1123) — `gh pr diff N` 전체를 파일별로 자름. 경로는 `+++ b/…`(삭제면 `--- a/…`)에서 — 이름에 공백 있어
// `diff --git "a/x y" "b/x y"`처럼 따옴표로 감싸져도 +++/--- 줄 기준이라 안전. 반환 { [path]: 그 파일의 diff 텍스트 }.
// git은 비ASCII(한글 등)·특수문자 경로를 "…"로 감싸고 C식 이스케이프(\\, \", \t, \n, \NNN 8진 바이트)로 씀 → UTF-8로 복원(리뷰).
function unquote(p) {
  const s = p.trim();
  if (!(s.startsWith('"') && s.endsWith('"'))) return s;
  const body = Array.from(s.slice(1, -1)), bytes = []; // 코드 포인트 단위(이모지 등 서로게이트 쌍 안 쪼갬, 재리뷰)
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (ch !== "\\") { for (const b of Buffer.from(ch, "utf8")) bytes.push(b); continue; }
    const nx = body[i + 1];
    if (/[0-7]/.test(nx || "")) { const oct = body.slice(i + 1, i + 4).join(""); bytes.push(parseInt(oct, 8)); i += 3; continue; }
    bytes.push(({ n: 10, t: 9, r: 13, '"': 34, "\\": 92, a: 7, b: 8, f: 12, v: 11 })[nx] ?? (nx || "").charCodeAt(0)); i += 1;
  }
  return Buffer.from(bytes).toString("utf8");
}
function splitDiffByFile(raw) {
  const out = Object.create(null); // 'constructor' 같은 경로가 프로토타입과 안 섞이게(리뷰)
  const parts = String(raw || "").split(/^(?=diff --git )/m).filter((x) => x.startsWith("diff --git "));
  for (const part of parts) {
    const plus = part.match(/^\+\+\+ (.+)$/m), minus = part.match(/^--- (.+)$/m);
    let path = null;
    if (plus && unquote(plus[1]) !== "/dev/null") path = unquote(plus[1]).replace(/^b\//, "");
    else if (minus && unquote(minus[1]) !== "/dev/null") path = unquote(minus[1]).replace(/^a\//, "");
    if (!path) { // 바이너리·모드만 바뀜 등 +++/--- 없음 → 헤더에서
      // #1149 리뷰: 이름 바뀜·복사면 "rename to/copy to" 줄(접두어 없음, 안 헷갈림). 아니면 헤더 "a/X b/X"가 대칭이라 가운데서 자름(경로에 " b/"가 있어도).
      // 그래도 안 되면 정규식. 따옴표로 감싼 경로(한글 등 8진 이스케이프)는 unquote.
      const to = part.match(/^(?:rename|copy) to (.+)$/m);
      const head = (part.match(/^diff --git (.+)$/m) || [])[1] || "";
      const half = (head.length - 1) / 2, l = head.slice(0, half), r = head.slice(half + 1);
      if (to) path = unquote(to[1]);
      else if (Number.isInteger(half) && head[half] === " " && /^"?a\//.test(l) && /^"?b\//.test(r) && l.replace(/^("?)a\//, "$1") === r.replace(/^("?)b\//, "$1")) path = unquote(r.replace(/^("?)b\//, "$1"));
      else { const m = head.match(/^("?)a\/.+?\1 ("?)b\/(.+?)\2$/); if (m) path = m[2] ? unquote(`"${m[3]}"`) : m[3]; }
    }
    if (path) out[path] = part;
  }
  return out;
}

module.exports = { ghRun, ghJson, authDiagnose, classifyGhError, splitDiffByFile };
