const assert = require("node:assert");
const { parseAgentScreen, stripAnsi, lastTitle } = require("./agent-screen.cjs");
const E = "\x1b"; // ESC
const title = (t) => `${E}]0;${t}\x07`; // OSC 타이틀 세팅
const braille = "⠐"; // ⠐ 브라유 스피너 프레임
const idleGlyph = "✳"; // ✳
// agent/state만 비교(task는 케이스마다 다름)
const st = (buf) => { const r = parseAgentScreen(buf); return r ? `${r.agent}/${r.state}` : null; };

// stripAnsi: 색·OSC·제어 제거, 텍스트 보존
const colored = `${E}[38;2;217;119;87mClaude${E}[0m ${title("x")}? for shortcuts`;
assert.ok(!stripAnsi(colored).includes(E), "ESC 남음");
assert.ok(stripAnsi(colored).includes("Claude"), "텍스트 유실");

// lastTitle: 마지막 타이틀 페이로드
assert.strictEqual(lastTitle(title("aaa") + "junk" + title("bbb")), "bbb", "lastTitle 실패");

// task 추출: 타이틀 글리프 뗀 작업 텍스트
assert.strictEqual(parseAgentScreen(title(`${idleGlyph} Review notes`) + "? for shortcuts").task, "Review notes", "task 추출 실패");

// working: 브라유 스피너 타이틀 (본문에 tokens 없어도 — thinking with high effort 케이스)
const working = title(`${braille} Doing task`) + `${E}[36m✽${E}[0m Unfurling… (18s · thinking with high effort)`;
assert.strictEqual(st(working), "claude/working", "working 오판: " + st(working));

// working: 타이틀 없어도 본문 tokens 라인
const working2 = `✽ Improvising… (55s · ${E}[2m↓ 1.4k tokens${E}[0m)`;
assert.strictEqual(st(working2), "claude/working", "working2 오판: " + st(working2));

// waiting: 권한 프롬프트(마지막 수평선 이후). 커서이동 공백 증발 형태.
const waiting = title(`${idleGlyph} Task`) + `─────\nDoyouwanttoproceed?❯1.Yes2.NoEsctocancel·Tabtoamend·ctrl+etoexplain`;
assert.strictEqual(st(waiting), "claude/waiting", "waiting 오판: " + st(waiting));

// idle: ✳ 타이틀 + 프롬프트, working/waiting 마커 없음
const idle = title(`${idleGlyph} Review notes`) + `╭───╮\n│ > │\n╰───╯  ? for shortcuts`;
assert.strictEqual(st(idle), "claude/idle", "idle 오판: " + st(idle));

// idle: 대화에 권한 문구 인용(스크롤 위) + 바닥은 입력창 → idle(영역 스코핑).
const quotedNotLive = title(`${idleGlyph} Task`) +
  `I explained: "Do you want to proceed?" and "esc to cancel" and "1. Yes 2. No".\n`.repeat(20) +
  `✻ churned for 3m\n─────\n❯ \n⏸ manual mode on · ← for agents · ctrl+v to paste`;
assert.strictEqual(st(quotedNotLive), "claude/idle", "인용문 오판: " + st(quotedNotLive));

// 셸(타이틀·마커 없음) → null
const shell = `hong@mac nunopi % ls\nREADME.md  package.json  src`;
assert.strictEqual(st(shell), null, "셸을 에이전트로 오판");

// 우선순위: 스피너 타이틀 = 현재 작업 중(최신) → 본문 옛 권한보다 우선 = working.
const spinnerOverStale = title(`${braille} x`) + `─────\nDoyouwanttoproceed?❯1.Yes2.No Esctocancel`;
assert.strictEqual(st(spinnerOverStale), "claude/working", "스피너 우선 실패");

// 백그라운드 셸 실행 중(#966): idle-글리프 타이틀이어도 "N shell still running" → working(완료 오표시 방지).
const bgShell = title(`${idleGlyph} 게임 개발`) + `? for shortcuts\n✻ Cogitated for 15s · 1 shell still running\n❯ `;
assert.strictEqual(st(bgShell), "claude/working", "bg 셸 오판: " + st(bgShell));

// 백그라운드 전환 순간: "Running in the background" → working.
const bgManage = title(`${idleGlyph} task`) + `⎿ Running in the background (↓ to manage)\n? for shortcuts\n❯ `;
assert.strictEqual(st(bgManage), "claude/working", "bg 전환 오판: " + st(bgManage));

// #966 우선순위: BG는 stale 권한 프롬프트 잔재보다 우선 = working("?" 오표시 방지).
const bgOverStaleWaiting = title(`${idleGlyph} task`) + `─────\nDoyouwanttoproceed?❯1.Yes2.No Esctocancel\n✻ Brewed for 1m · 2 shells still running\n❯ `;
assert.strictEqual(st(bgOverStaleWaiting), "claude/working", "bg>stale waiting 실패: " + st(bgOverStaleWaiting));

// #966 오탐 방지: claude chrome/title 없이 "running in the background" 문구만 있는 일반 셸 → null(claude 아님).
const shellBgText = `hong@mac % ./deploy.sh\nStarting server, running in the background now.\nhong@mac % `;
assert.strictEqual(st(shellBgText), null, "일반 셸의 bg 문구를 claude로 오판: " + st(shellBgText));

// #979 회귀: 서브 끝난 뒤 푸터 ◯ 잔재·"done" 표시 + idle 글리프 → idle(화면 신호로 bg 에이전트 안 잡음)
const staleFooter = title(`${idleGlyph} task`) + `◯ general-purpose Scan repo for silent… 30s · ↓ 57.3k tokens\n✻ Brewed for 58s · done 12:19 PM\n❯ 이슈 3개 올리고`;
assert.strictEqual(st(staleFooter), "claude/idle", "끝난 서브 푸터 잔재로 working 오판: " + st(staleFooter));

// #989 titleHint — 출력이 많아 16KB tail에 타이틀이 없을 때 스트림 추적 타이틀로 판정(실측: 백그라운드 세션 working↔idle 깜빡임)
const noTitle = "x".repeat(20000) + "? for shortcuts";
assert.strictEqual((() => { const r = parseAgentScreen(noTitle, `${braille} Fix tests`); return r && `${r.agent}/${r.state}`; })(), "claude/working", "titleHint 스피너 → working");
// #1036 hint로만 남은 ✳(이전 턴)는 믿지 않음 — 마커 없으면 unknown, 라이브 마커 있으면 working
assert.strictEqual((() => { const r = parseAgentScreen(noTitle, `${idleGlyph} Fix tests`); return r && `${r.agent}/${r.state}`; })(), "claude/unknown", "titleHint ✳만 → unknown");
const midTurn = "x".repeat(20000) + "✻ Precipitating… (11m 10s · ↓ 46.8k tokens)\n? for shortcuts";
assert.strictEqual((() => { const r = parseAgentScreen(midTurn, `${idleGlyph} prev`); return r && `${r.agent}/${r.state}`; })(), "claude/working", "낡은 ✳ hint + 라이브 타이머 → working");
const quietRedraw = "x".repeat(20000) + "\u001b[2C6\u001b[1C✢\u001b[3D? for shortcuts";
assert.strictEqual((() => { const r = parseAgentScreen(quietRedraw, `${idleGlyph} prev`); return r && r.state; })(), "unknown", "조용한 재그리기 → unknown(가짜 완료 X)");
assert.strictEqual((() => { const r = parseAgentScreen(title(`${idleGlyph} new`) + "? for shortcuts", `${braille} old`); return r && r.state; })(), "idle", "tail 타이틀이 hint보다 우선");
assert.strictEqual(st(title(`${idleGlyph} done`) + "✻ Brewed for 2m · done\n❯ "), "claude/idle", "턴 끝 새 ✳ → idle(완료 신호는 유지)");

console.log("PASS — all assertions");
