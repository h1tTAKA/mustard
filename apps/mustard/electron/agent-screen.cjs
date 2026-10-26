// pty 버퍼 스크레이핑 파서(#765) — Claude Code 등 CLI 에이전트의 터미널 출력을 읽어 상태 판정.
// 가장 강한 신호는 화면 본문이 아니라 OSC 터미널 타이틀.
//   - working: 타이틀 앞글자가 브라유 스피너(U+2800–28FF) 또는 사분원(U+25D0–25D3) — claude가 매 프레임 갱신.
//   - idle:    타이틀이 ✳(U+2733)로 시작.
//   - blocked/waiting: 본문에 권한/선택 프롬프트("do you want to proceed?" · "esc to cancel" · N.yes/no · tab to amend 등).
// 본문은 claude TUI가 커서 이동으로 배치 → ANSI 제거 시 공백 증발 → "공백 제거+소문자" compact에 매칭(렌더 그리드가
//   아니라 raw 스트림이라 공백이 남지 않음).

// escape 시퀀스 제거(본문용). OSC는 여기서 지우되, 타이틀은 아래 lastTitle이 raw에서 따로 추출.
// eslint-disable-next-line no-control-regex
const OSC = /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g;
// eslint-disable-next-line no-control-regex
const CSI = /\x1b\[[0-9;?]*[ -\/]*[@-~]/g;
// eslint-disable-next-line no-control-regex
const OTHER_ESC = /\x1b[@-Z\\-_]/g;
// eslint-disable-next-line no-control-regex
const CTRL = /[\x00-\x08\x0b-\x1f\x7f]/g;

function stripAnsi(s) {
  return String(s || "").replace(OSC, "").replace(CSI, "").replace(OTHER_ESC, "").replace(CTRL, "");
}

// 최근 raw tail(타이틀 추출용 — OSC 보존). 타이틀은 자주 갱신되므로 8KB면 최신 것 포함.
function recentRaw(buffer, tailBytes = 8000) {
  const raw = String(buffer || "");
  return raw.length > tailBytes ? raw.slice(-tailBytes) : raw;
}
// 본문 근사(공백 제거·소문자) — 커서이동으로 공백 증발하는 문제 대응.
function recentScreen(buffer, tailBytes = 8000) {
  return stripAnsi(recentRaw(buffer, tailBytes));
}

// 마지막 OSC 타이틀(]0; 또는 ]2;)의 페이로드. 없으면 "".
// eslint-disable-next-line no-control-regex
const TITLE_RE = /\x1b\][02];([^\x07\x1b]*)(?:\x07|\x1b\\)/g;
function lastTitle(rawTail) {
  const m = [...String(rawTail).matchAll(TITLE_RE)];
  return m.length ? m[m.length - 1][1] : "";
}
function firstCode(s) { return s ? s.codePointAt(0) : 0; }
// 타이틀에서 상태 글리프를 뗀 작업 설명 — Orca처럼 "지금 뭐 하는지" 서브라인용. 예: "⠐ Review notes" → "Review notes".
function titleTask(title) {
  const t = String(title).trim();
  const c = firstCode(t);
  const body = (isSpinnerGlyph(c) || isClaudeIdleGlyph(c)) ? t.slice(String.fromCodePoint(c).length).trim() : t;
  return body.slice(0, 120);
}
// 마지막 수평선(─ 3개 이상 라인) 이후 텍스트 = 현재 프롬프트/입력 박스 영역.
// claude 입력창·권한 박스는 ───── 로 둘러싸여 화면 하단에 뜬다. 대화에 인용된 마커는 이 위라 제외된다.
function afterLastRule(screen) {
  const lines = String(screen).split("\n");
  let idx = -1;
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (t.length >= 3 && /^[─━┄┅┈┉\s]+$/.test(t) && (t.match(/[─-╿]/g) || []).length >= 3) idx = i;
  }
  return idx >= 0 ? lines.slice(idx + 1).join("\n") : screen;
}
const isSpinnerGlyph = (c) => (c >= 0x2800 && c <= 0x28ff) || (c >= 0x25d0 && c <= 0x25d3); // 브라유/사분원
const isClaudeIdleGlyph = (c) => c === 0x2733; // ✳

// claude 본문 마커(compact = 공백제거+소문자).
const CLAUDE_WAITING = /doyouwantto|wouldyouliketo|esctocancel|tabtoamend|ctrl\+etoexplain|waitingforpermission|❯\d+\.(yes|no)|\b\d+\.(yes|no)\b|whatshouldclaudedoinstead|interrupted·|reviewyouranswers/i;
// 라이브 "작업 중" 신호: "esc to interrupt" | 라이브 토큰 카운터(↓/↑ 화살표+tokens) | 라이브 타이머 "(18s·…".
// ↓tokens가 핵심 — 작업 중 카운터는 "↓ 8.3k tokens"처럼 화살표 동반, idle 푸터 "…/clear to save 126.2k tokens"는
// 화살표 없음 → 화살표로 둘을 구분(#868). standalone tokens는 idle 푸터에 오매칭(#866), 타이머만으론 구분자
// 문자(·)가 빌드마다 달라 놓치던(작업중→완료 오판) 걸 화살표 매치가 구분자 무관하게 커버.
const CLAUDE_WORKING = /esctointerrupt|[↓↑][\d.]+[km]?tokens|\(\d+m?\d*s[·)]/i;
const CLAUDE_CHROME = /esctointerrupt|\?forshortcuts|claudecode|bypasspermissions|manualmodeon|foragents|tokens\)/i;
// 백그라운드 셸 실행 중(#966) — claude가 ctrl+b로 bash를 백그라운드로 돌리면 TUI는 idle 프롬프트로 복귀하지만
// 상태줄에 "· N shell(s) still running" 접미 또는 "Running in the background (↓ to manage)"를 남긴다.
// 이 신호가 최신 compact tail에 있으면 셸이 아직 돌고 있으니 "작업 중"으로 봐야 한다(idle→done 오표시 방지).
const CLAUDE_BG = /\d+shells?stillrunning|runninginthebackground/i;
// #979 백그라운드 '에이전트' 대기는 화면 신호로 안 잡음 — 푸터 ◯ 목록·Waiting 문구가 끝난 뒤에도 스크롤백 잔재로 남아
// 메인이 영원히 working으로 보였음. 대신 status route가 트랜스크립트(서브 jsonl+부모 종료 알림)로 판정.

// codex(보조 — 유저 주력은 claude).
const CODEX_WAITING = /actionrequired|allowcommand\?|pressentertoconfirmoresctocancel|doyoutrustthecontentsofthisdirectory|\[y\/n\]|yes\(y\)/i;
const CODEX_WORKING = /•working\(|working\([^)]*esctointerrupt|esctointerrupt/i;
const CODEX_CHROME = /openaicodex|codex(session|resume)/i;

// 포그라운드 프로세스명 → 에이전트 id | null. "존재" 판정용(버퍼가 상태를 못 잡아도 에이전트가 떠 있음을 안다).
const PROC_MATCH = [["claude", /claude/i], ["codex", /codex/i], ["gemini", /gemini/i], ["antigravity", /antigravity/i], ["hermes", /hermes/i], ["aider", /aider/i], ["opencode", /open-?code/i], ["cursor", /cursor/i], ["copilot", /copilot/i], ["amp", /^amp$/i], ["grok", /grok/i]];
function agentFromProcess(name) {
  const p = String(name || "").trim().toLowerCase().replace(/^-+/, "");
  if (!p) return null;
  for (const [id, re] of PROC_MATCH) if (re.test(p)) return id;
  return null;
}

// 버퍼 → { agent, state } | null. 알려진 에이전트 TUI가 아니면 null(셸 등).
function parseAgentScreen(buffer, titleHint = "") {
  // 타이틀은 넓게(입력 에코로 밀려도 확보). 전체 200k는 perf 낭비라 16KB.
  // #989 출력이 많으면 16KB tail에 타이틀이 아예 없음(실측 6/6) → 스트림 전체서 추적한 마지막 타이틀(titleHint)로 보완.
  const raw16 = recentRaw(buffer, 16000);
  const tailTitle = lastTitle(raw16);
  const title = tailTitle || titleHint || "";
  const freshTitle = !!tailTitle; // tail에 찍힌 타이틀인지(hint = 예전에 본 것)
  // 마지막 타이틀 "뒤"에 라이브 작업 마커가 있으면 그 타이틀은 지난 턴 것(#1036 리뷰: 새 턴 초반엔 이전 ✳가 아직 tail에 있음).
  const titleMatches = tailTitle ? [...raw16.matchAll(TITLE_RE)] : [];
  const lastTitleEnd = titleMatches.length ? titleMatches[titleMatches.length - 1].index + titleMatches[titleMatches.length - 1][0].length : 0;
  // 여기선 ↓tokens는 빼고 "esc to interrupt"·괄호 타이머만 — 끝난 서브에이전트 푸터("30s · ↓ 57k tokens")가 ✳ 뒤에 남아 있어도 working으로 안 보게.
  // 스피너 줄("✻ Precipitating…")도 — 바뀐 칸만 다시 그려 "esc to interrupt"가 통째로 안 올 수 있어서(#1036 재리뷰).
  // 끝난 뒤 요약 "✻ Worked for 30s"는 말줄임표가 없어 안 걸림.
  const workingAfterTitle = !!tailTitle && /esctointerrupt|\(\d+m?\d*s[·)]|[✢✳✶✻✽·*][a-z]+…/i.test(stripAnsi(raw16.slice(lastTitleEnd)).toLowerCase().replace(/\s+/g, ""));
  const tc = firstCode(title.trim());
  const wide = stripAnsi(recentRaw(buffer, 8000)).toLowerCase().replace(/\s+/g, "");    // 넓게 — chrome 감지(입력 에코 많아도 놓치지 않게)
  const compact = stripAnsi(recentRaw(buffer, 2500)).toLowerCase().replace(/\s+/g, ""); // 좁게 — 작업 마커(옛 tokens stale 방지)
  // ⚠️ 권한/대기 마커는 "마지막 수평선 이후"(현재 프롬프트 박스)에서만 매칭 — 대화에 인용된 "Do you want to
  //   proceed?" 같은 문구(박스 위 스크롤)를 실제 프롬프트로 오인하지 않게(영역 스코핑).
  const bottom = afterLastRule(stripAnsi(recentRaw(buffer, 4000))).toLowerCase().replace(/\s+/g, "");
  if (!wide && !title) return null;
  const task = titleTask(title); // "지금 뭐 하는지" 서브라인(타이틀의 작업 텍스트)

  // ── 신원 우선판정(#803) ──────────────────
  // 여러 CLI가 스피너 글리프·"esc to interrupt"·"? for shortcuts" 같은 공유 신호를 써서, 아래 claude 휴리스틱이
  // 다른 에이전트를 claude로 오판정한다(codex·antigravity 등). 각 에이전트 "전용 배너"를 claude보다 먼저 확정.
  // 순서 중요: antigravity 배너엔 "Gemini 3.1 Pro" 표기가 있어 gemini보다 먼저 둔다. (wide는 소문자·공백제거됨)
  const STRONG = [
    ["antigravity", /antigravity/],
    ["codex", /openaicodex|codex(session|resume)/],
    ["hermes", /hermes/],
    ["cursor", /cursoragent|cursorcli/],  // "Cursor Agent" 배너. grok보다 먼저(스크롤백 grok 오매칭 방지)
    ["grok", /grokcli|grok\d/],           // 배너/버전 동반만(맨 "grok" 단어는 대화·grep에도 흔해 sticky 오고정 방지)
    ["gemini", /geminicli|gemini\d/],     // "Gemini 2.5/3.x" 등 버전 동반. antigravity가 먼저라 그쪽 배너의 Gemini 표기엔 안 걸림
  ];
  const strongWaiting = () => title.toLowerCase().includes("action required") || CLAUDE_WAITING.test(bottom) || CODEX_WAITING.test(bottom);
  const strongWorking = () => isSpinnerGlyph(tc) || CLAUDE_WORKING.test(compact) || CODEX_WORKING.test(compact);
  for (const [id, re] of STRONG) {
    if (re.test(wide)) return { agent: id, state: strongWaiting() ? "waiting" : strongWorking() ? "working" : "idle", task };
  }

  // ── Claude ──────────────────────────────
  const claudeTitle = isSpinnerGlyph(tc) || isClaudeIdleGlyph(tc); // claude가 세팅한 상태 글리프 타이틀
  // CLAUDE_BG는 isClaude 게이트에 넣지 않는다(#966 리뷰) — "running in the background" 등은 일반 셸 출력에도 나올 수 있어
  // 그것만으로 claude 판정하면 오탐. claude 확정(title/chrome/working/waiting) 후 블록 안에서만 BG를 상태 신호로 쓴다.
  const isClaude = claudeTitle || CLAUDE_CHROME.test(wide) || CLAUDE_WORKING.test(compact) || CLAUDE_WAITING.test(bottom);
  if (isClaude) {
    if (isSpinnerGlyph(tc)) return { agent: "claude", state: "working", task };             // 스피너 타이틀 = 지금 작업 중(최우선)
    // 백그라운드 셸 실행 중(#966) — idle-글리프(✳)·stale 권한 프롬프트 잔재보다 우선. 셸이 도는 한 "작업 중".
    // 최신 compact tail에 접미가 있으면 현재 프레임이 idle 프롬프트+셸실행(권한 박스가 bottom 아님)이라 waiting은 잔재.
    if (CLAUDE_BG.test(compact)) return { agent: "claude", state: "working", task };
    if (CLAUDE_WAITING.test(bottom)) return { agent: "claude", state: "waiting", task };     // 권한/선택/인터럽트(바닥에서만)
    // #1036 ✳는 tail에 새로 찍혔을 때만 유휴 — 이 Claude 빌드는 타이틀을 턴 끝에만 보내서, 턴 도중엔 이전 턴의 ✳가
    // hint로 남아 있음. 그걸 믿으면 작업 중에도 idle → 1.5초 뒤 가짜 완료 알림(조용한 긴 Bash에서 실측).
    if (isClaudeIdleGlyph(tc) && freshTitle && !workingAfterTitle) return { agent: "claude", state: "idle", task };
    if (workingAfterTitle || CLAUDE_WORKING.test(compact)) return { agent: "claude", state: "working", task }; // 라이브 마커
    // 지난 턴 ✳만 hint로 남은 경우 = "모름"(조용한 작업은 마커가 tail에 없음) — main이 직전 상태 유지, 완료는 새 ✳·대기·Stop 훅으로만.
    // 타이틀을 아예 안 쓰는 에이전트(claude 크롬만 닮은 aider·copilot 등, tmux)는 예전처럼 idle(#1036 리뷰: 영원히 working 방지).
    if (isClaudeIdleGlyph(tc) && !freshTitle) return { agent: "claude", state: "unknown", task };
    return { agent: "claude", state: "idle", task };
  }

  // ── Codex(보조) ─────────────────────────
  const codexTitle = title.toLowerCase().includes("action required") || isSpinnerGlyph(tc);
  const isCodex = codexTitle || CODEX_CHROME.test(compact) || CODEX_WAITING.test(bottom) || CODEX_WORKING.test(compact);
  if (isCodex) {
    if (title.toLowerCase().includes("action required") || CODEX_WAITING.test(bottom)) return { agent: "codex", state: "waiting", task };
    if (isSpinnerGlyph(tc) || CODEX_WORKING.test(compact)) return { agent: "codex", state: "working", task };
    return { agent: "codex", state: "idle", task };
  }

  return null; // 셸 등
}

// 세션 작업 제목(#970) — 최근 tail(기본 8KB)서 마지막 OSC 타이틀 → 작업 텍스트. 타이틀 없으면 "".
// onData가 제목이 emit되는 순간 이걸로 잡아 저장(라이브 추적). 최근 tail만 보므로 이전 세션(ctrl+c 후 재시작)의
// 스크롤백 옛 타이틀은 안 잡힘 — extractTask(전체 스캔)의 세션 경계 오염 문제를 회피(#970 세션경계 fix).
function recentTitle(buffer, bytes = 8000) {
  return titleTask(lastTitle(recentRaw(buffer, bytes))) || "";
}

module.exports = { parseAgentScreen, agentFromProcess, stripAnsi, recentScreen, lastTitle, recentTitle };
