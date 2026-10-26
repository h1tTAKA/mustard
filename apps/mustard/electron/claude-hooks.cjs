// 관리형 Claude 훅(#989) — 에이전트 상태의 권위 신호. 화면 긁기는 출력이 많으면 타이틀을 놓쳐
// 작업 중↔완료가 깜빡였다(가짜 알림). Claude가 직접 "턴 끝(Stop)·권한 필요(PermissionRequest)"를 알려주게 한다.
// - 위치: <CLAUDE_CONFIG_DIR|~/.claude>/settings.json(유저 전역). #764처럼 레포 파일을 더럽히지 않는다.
// - Mustard 터미널에서만 동작: 데몬이 pty env에 MUSTARD_TERM_ID를 넣고, 훅 명령은 그 값이 없으면 바로 끝난다.
// - 전송: sh + curl(네이티브 claude엔 node가 PATH에 없을 수 있음). 엔드포인트는 파일에서 읽어 포트 변동에 안전.
// - 버전 게이트: Claude 1.0.23~2.1.100은 모르는 훅 이벤트 하나에 settings.json 전체(권한·다른 훅)를 버린다 → CLI가 아는 이벤트만.
const { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync, chmodSync } = require("node:fs");
const { execFile } = require("node:child_process");
const { join, dirname } = require("node:path");
const { homedir } = require("node:os");

const MARKER = "MUSTARD_TERM_ID"; // 우리 훅 식별(명령 문자열에 포함) — 이걸 가진 엔트리만 넣고 뺀다
// 이벤트별 최초 지원 버전.
const EVENTS = [
  { name: "UserPromptSubmit", since: "1.0.53" },
  { name: "PostToolUse", since: "1.0.23", matcher: "" },
  { name: "Stop", since: "1.0.31" },
  { name: "PermissionRequest", since: "2.0.45" },
  { name: "StopFailure", since: "2.1.78" },
  { name: "PostCompact", since: "2.1.76" }, // 수동 /compact 종료 = 알림 없는 done(Stop 안 옴). PreCompact는 미등록
];
const UNRESOLVED_VERSION = "1.0.64"; // 버전 확인 실패 시 가정 — 최신 이벤트는 안 넣음

function cmpVersion(a, b) {
  const pa = a.split(".").map(Number), pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) { const d = (pa[i] || 0) - (pb[i] || 0); if (d) return d; }
  return 0;
}
function parseVersion(out) { const m = String(out || "").match(/\b(\d+\.\d+\.\d+)\b/); return m ? m[1] : null; }

const shq = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`; // sh 단일따옴표 이스케이프
function hookCommand(endpointFile, event) {
  // MUSTARD_TERM_ID 없으면(Mustard 밖 claude) sh 한 번으로 종료. 실패해도 항상 exit 0(claude 방해 금지).
  // 엔드포인트 파일 = ".../hook?k=<부팅 토큰>" → 뒤에 &event·&term 붙임(토큰은 파일에만, settings.json엔 없음).
  return `[ -n "$${MARKER}" ] && curl -sS -m 2 --noproxy 127.0.0.1 -X POST "$(cat ${shq(endpointFile)})&event=${event}&term=$${MARKER}" -H 'Content-Type: application/json' --data-binary @- >/dev/null 2>&1; exit 0`;
}

// 순수 함수 — 기존 settings에서 우리 엔트리만 빼고 버전이 아는 이벤트로 다시 넣는다(다른 키·다른 훅 보존).
function mergeHooks(settings, endpointFile, version) {
  const v = version || UNRESOLVED_VERSION;
  const out = { ...settings };
  const hooks = { ...(settings.hooks && typeof settings.hooks === "object" ? settings.hooks : {}) };
  for (const [ev, list] of Object.entries(hooks)) {
    if (!Array.isArray(list)) continue;
    const kept = list
      .map((g) => (g && Array.isArray(g.hooks) ? { ...g, hooks: g.hooks.filter((h) => !(h && typeof h.command === "string" && h.command.includes(MARKER))) } : g))
      .filter((g) => !(g && Array.isArray(g.hooks) && g.hooks.length === 0));
    if (kept.length) hooks[ev] = kept; else delete hooks[ev];
  }
  for (const e of EVENTS) {
    if (cmpVersion(v, e.since) < 0) continue;
    const group = { hooks: [{ type: "command", command: hookCommand(endpointFile, e.name) }] };
    if (e.matcher !== undefined) group.matcher = e.matcher;
    hooks[e.name] = [...(hooks[e.name] || []), group];
  }
  out.hooks = hooks;
  return out;
}

function settingsPath() {
  const dir = process.env.CLAUDE_CONFIG_DIR?.trim() || join(homedir(), ".claude");
  return join(dir, "settings.json");
}

function probeClaudeVersion(cliPath) {
  return new Promise((resolve) => {
    if (!cliPath) return resolve(null);
    execFile(cliPath, ["--version"], { timeout: 5000 }, (err, stdout) => resolve(err ? null : parseVersion(stdout)));
  });
}

// 부팅 시 1회 — 엔드포인트 기록 + settings.json 병합. 파싱 실패하면 절대 안 건드림(유저 설정 보호).
async function installClaudeHooks({ userData, appBase, cliPath, token = "" }) {
  const endpointFile = join(userData, "mustard-hook-endpoint");
  // 토큰(#989 리뷰): 127.0.0.1 바인딩이어도 브라우저 페이지가 로컬 포트로 POST해 가짜 상태·알림을 만들 수 있음 → 부팅마다 새 토큰.
  try {
    writeFileSync(endpointFile, `${appBase}/api/agent/status/hook?k=${encodeURIComponent(token)}`, { mode: 0o600 });
    chmodSync(endpointFile, 0o600); // mode는 새 파일에만 적용 — 예전 부팅이 만든 0644 파일도 좁힘(#989 리뷰)
  } catch (e) { return { ok: false, reason: `endpoint: ${e?.message || e}` }; }
  const file = settingsPath();
  let current = {};
  if (existsSync(file)) {
    try { current = JSON.parse(readFileSync(file, "utf8")); } catch { return { ok: false, reason: "settings.json parse failed — 미수정" }; }
    if (!current || typeof current !== "object" || Array.isArray(current)) return { ok: false, reason: "settings.json not an object — 미수정" };
    // hooks가 객체가 아니면(배열 등 비정상) 병합 시 구조가 깨짐 → 손대지 않음(#989 리뷰).
    if (current.hooks !== undefined && (!current.hooks || typeof current.hooks !== "object" || Array.isArray(current.hooks))) return { ok: false, reason: "settings.hooks not an object — 미수정" };
  }
  const version = await probeClaudeVersion(cliPath);
  const next = mergeHooks(current, endpointFile, version);
  const before = JSON.stringify(current), after = JSON.stringify(next);
  if (before === after) return { ok: true, changed: false, version };
  try {
    mkdirSync(dirname(file), { recursive: true });
    const tmp = `${file}.mustard-tmp`;
    writeFileSync(tmp, JSON.stringify(next, null, 2) + "\n");
    renameSync(tmp, file); // 원자적 교체 — 쓰다 죽어도 반쪽 파일 안 남음
  } catch (e) { return { ok: false, reason: `write: ${e?.message || e}` }; }
  return { ok: true, changed: true, version };
}

module.exports = { installClaudeHooks, mergeHooks, hookCommand, parseVersion, MARKER };
