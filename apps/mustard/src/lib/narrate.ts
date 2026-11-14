// 실시간 해설 생성(#870) — observe 라우트(터미널 델타)와 꺼진 동안 재생(#1068, 에이전트 기록)이 함께 씀. 서버 전용.
import { snaClaudeProvider, snaCodexProvider, snaOpenCodeProvider } from "@mustard/nunopi/server";
import type { AgentAnalyzeRequest } from "@mustard/core";
import { emitNarration } from "@/lib/mcpActivity";
import { appendItems, repoPrefOff } from "@/lib/catchupStore";
import { beginNarrate } from "@/lib/narrateBusy";
import { narrationProvider, narrationModel, narrationLocale } from "@/lib/narrationConfig";
import { translate } from "@mustard/core/messages";
import { isFailedNote } from "@/lib/failText";

// #1091 출력 언어 — 본문 지시가 한국어라 ko 아니면 맨 앞·끝에 못박음(제목 줄·소제목까지).
const LANG_NAME = { ko: "한국어", ja: "일본어(日本語)", en: "영어(English)" } as const;
const langRule = (loc: keyof typeof LANG_NAME) => `⚠️ 출력 언어: 제목 줄·소제목(용어 소제목 포함)·본문 전부 ${LANG_NAME[loc]}로 써. 아래 지시가 한국어여도 답은 ${LANG_NAME[loc]}.`;
// #1333 칸 이름 — 출력 언어로(본문 지시는 한국어라 그대로 두면 ja/en 답에도 한국어 소제목이 남음)
const HEADS = {
  now: { ko: "지금 하는 일", ja: "今していること", en: "What it's doing now" },
  changed: { ko: "바뀐 것", ja: "変わったこと", en: "What changed" },
  how: { ko: "어떻게 동작해요", ja: "どう動くか", en: "How it works" },
  concept: { ko: "알아둘 개념", ja: "知っておく概念", en: "Concept to know" },
  decided: { ko: "AI가 정한 것", ja: "AIが決めたこと", en: "What the AI decided" },
  check: { ko: "확인", ja: "確認", en: "Verification" },
  looking: { ko: "보고 있는 곳", ja: "見ている場所", en: "Where it's looking" },
} as const;
function narrationPrompt(agent: string, delta: string, diff: string, loc: keyof typeof LANG_NAME): string {
  const hasDiff = diff.trim().length > 0;
  const h = (k: keyof typeof HEADS) => `### ${HEADS[k][loc] ?? HEADS[k].ko}`;
  // #1333 바이브 코더가 실시간으로 이해하게 — 코드 강의 대신 "무엇이 왜 바뀌었고, 앱에서 뭐가 달라지고, AI가 대신 정한 게 뭔지".
  // 칸은 해당 없으면 소제목째 뺌(매번 다 채우지 않음). 사실(diff·로그에 보이는 것)만, 테스트는 실제로 돌린 것만.
  const task = hasDiff
    ? `위 **git diff가 방금 바뀐 진짜 코드**, 터미널 로그는 맥락이야. 아래 칸으로 정리해(해당 없는 칸은 소제목째 빼):
${h("now")}
1~2문장. 유저가 원한 것을 한 구절로 짚고("~하려고") → 그래서 AI가 지금 무엇을 하는지.
${h("changed")}
글머리 1~4개. 파일·함수 이름(백틱) + 그게 이제 **무엇을 하는지**(동작 수준). +/- 줄 중계 말고.
${h("how")}
핵심 한 군데만: 흐름을 \`A → B → C\`처럼 한 줄 + 1~2문장. 필요하면 3줄 이하 코드 조각.
${h("concept")}
처음 보는 사람이 막힐 개념 **하나만**: 무엇인지 1문장 + 이 레포에서 왜 필요한지 1문장.
${h("decided")}
유저에게 묻지 않고 AI가 정한 설계 선택(저장 방식·범위·예외 처리·기본값 등)만 "- 무엇 — 왜 중요한지(다르게 하면 무엇이 달라지는지)" 1~3개. diff·로그에 안 보이면 이 칸 빼.
${h("check")}
테스트·검사를 **실제로 돌렸는지와 결과**(로그에 보인 것만, 안 보이면 "아직 안 돌림"), 그리고 유저가 직접 해 볼 확인 한 가지.`
    : `아직 코드 변경(diff)은 없어. 에이전트가 무엇을 하려고 어떤 파일·영역을 보는지 정리해(해당 없는 칸은 소제목째 빼):
${h("now")}
1~2문장. 유저가 원한 것을 한 구절로 짚고 → 그래서 AI가 지금 무엇을 살펴보는지.
${h("looking")}
그 파일·함수가 코드베이스에서 맡은 역할 1~3개 글머리(백틱).
${h("concept")}
처음 보는 사람이 막힐 개념 **하나만**: 무엇인지 + 이 레포에서 왜 필요한지 2문장.
**제품 기능·UX 동작 서술(버튼 누르면 어디 가고 등) 금지 — 코드·구조·개념만.** 코드/구조 얘깃거리 없고 제품·상황 얘기뿐이면 딱 "SKIP"만.
- **브라우저·MCP 작업은 SKIP 아님(#1045)**: 에이전트가 인앱 브라우저나 MCP 도구(navigate·screenshot·click·new_tab 등)로 웹을 다루면, 그 출력에 보이는 **웹·개발 도구 개념**(DOM·선택자, URL·쿼리 인코딩, HTTP 상태·요청, 개발 서버·빌드·배포 설정, MCP 도구 호출 방식 등)을 위 칸으로. 화면에 뭐가 보였는지 중계는 말고 그 밑의 기술만.`;
  const material = hasDiff
    ? `## 실제 코드 변경 (git diff HEAD — 핵심 재료)
\`\`\`diff
${diff}
\`\`\`

## 터미널 로그 (보조 맥락)
${delta}`
    : `## 터미널 로그
${delta}`;

  const rule = loc === "ko" ? "" : `${langRule(loc)}\n\n`;
  return `${rule}너는 에이전틱 코딩(${agent})을 옆에서 지켜보는 개발 초보(바이브 코더)에게, AI가 방금 한 일을 **실시간으로 이해시키는** 짝꿍이야. 다 읽고 나면 유저가 "무엇이 왜 바뀌었고, 내 앱에서 뭐가 달라지고, AI가 나 대신 정한 게 뭔지"를 자기 말로 설명할 수 있어야 해.

📏 길이: 전체 350~700자로 **완결**(시작한 문장 반드시 끝맺기). 같은 요약을 칸마다 반복하지 마. 로그·diff에 보이는 사실만 — 짐작·일반론·칭찬·과장 금지.

⚠️ 절대 금지:
- **작업 대행 금지**: 너는 에이전트의 일을 대신 하는 게 아니라 가르치는 선생님이다. 회신 문안·이메일·릴리스 노트·커밋 메시지·문서·코드를 작성/초안하지 마("~처럼 보내면 될 것 같아요", "다시 뽑아드릴게요" 류 금지).
- 세션 중계(유저 지시를 그대로 옮기기 "~라고 하자", 에이전트 감정·의도 "혼났다/판단했다/보고했다", 사람 이름), 제품 기능·UX 동작 서술, 추측·일반론(릴리스 절차 등) 금지. 유저 목표는 "~하려고" 한 구절로만 연결.
- 활동이 코드·구조와 무관한 글쓰기·문안 작성·소통이면 딱 "SKIP"만. → 오직 코드·구조·개념 지식 전달.
- **문서화 작업이면 SKIP**: 마크다운 .md 파일 작성/수정, 학습정리·작업일지·공수시간·개념정리·plan·README·회고 등 문서 작업은 코드가 아니니 딱 "SKIP"만.

${task}

맨 앞 줄: 아주 짧은 제목(코드/개념 중심 명사구 25자 안팎). "제목:" 라벨·#·** 금지.
마지막에 필요하면 "## 용어" 소제목 아래 나온 **프로그래밍·개발·IT 용어만**(함수·문법·라이브러리·도구·명령어·개발 개념) "- **이름** — 쉬운 뜻" 2~4개. 이 앱이 다루는 주제의 도메인 지식(언어학·문자 표준·업무 용어 등)은 넣지 마. 없으면 생략. JSON·코드블록으로 용어 출력 금지.

${material}${rule ? `\n\n${langRule(loc)}` : ""}`;
}

// 모델이 그래도 끝에 JSON terms 배열을 붙이면 파싱해 읽기 좋은 목록으로 교체(백스톱).
// 정규식 백트래킹 회피 — 마지막 '['부터 끝까지를 JSON.parse로 직접 시도(문자열 파싱이라 안전).
function cleanNote(s: string): string {
  let t = s.trim();
  // 모델이 붙이는 용어 JSON 블록만 제거(본문 ## 용어 섹션에 이미 있음). ```diff 등 다른 코드블록은 보존!
  t = t.replace(/```nunopi-cards[\s\S]*?```/g, "").trim();               // ```nunopi-cards [...] ```
  t = t.replace(/```json\s*\[[\s\S]*?"term"[\s\S]*?\]\s*```/g, "").trim(); // ```json [ {term..} ] ```
  // 끝에 붙은 bare JSON terms 배열(코드펜스 없이)
  const nl = t.lastIndexOf("\n[");
  if (nl >= 0) {
    const tail = t.slice(nl + 1);
    if (/^\[\s*\{/.test(tail) && tail.includes('"term"')) { try { JSON.parse(tail); t = t.slice(0, nl).trim(); } catch { /* 진짜 배열 아님 → 유지 */ } }
  }
  // 끝에 본문 없이 소제목(## …)만 남으면(출력 truncate) 그 dangling 소제목 제거.
  return t.replace(/\n#{1,6}\s+[^\n]*$/, "").trim();
}

// summary → { title, note }. 첫 줄 = 제목(마크다운 heading·볼드·"제목:" 라벨 벗겨서), 나머지 = 본문.
function splitNarration(summary: string): { title: string; note: string } {
  const lines = summary.trim().split("\n");
  let i = 0;
  while (i < lines.length && !lines[i].trim()) i++;
  // #1333 제목 줄을 빼먹고 바로 "### 지금 하는 일"로 시작하면 — 그 소제목을 제목으로 먹지 않고 첫 문장에서 제목을 만듦(리뷰)
  if (/^#{2,6}\s/.test(lines[i] ?? "")) {
    const body = lines.slice(i).find((l) => l.trim() && !/^#{1,6}\s/.test(l.trim())) ?? "";
    const t = body.replace(/^[-*]\s*/, "").replace(/[`*]/g, "").split(/[。!?]|\.(?=\s|$)/)[0].trim(); // 문장 끝 마침표만(narrate.ts 같은 파일 이름에서 자르지 않게)
    return { title: (t.length > 42 ? `${t.slice(0, 41)}…` : t) || translate(narrationLocale(), "stream.liveWork"), note: lines.slice(i).join("\n").trim() };
  }
  let title = (lines[i] || "").trim()
    .replace(/^#{1,6}\s*/, "")            // # heading
    .replace(/^\*\*(.*)\*\*$/, "$1")      // **볼드**
    .replace(/^(제목|타이틀|title)\s*[:：]\s*/i, "") // "제목:" 라벨
    .trim();
  if (title.length > 42) { const cut = title.slice(0, 42); const sp = cut.lastIndexOf(" "); title = (sp > 20 ? cut.slice(0, sp) : cut).trim() + "…"; } // 단어경계 자르기(mid-word 잘림 방지)
  const note = lines.slice(i + 1).join("\n").trim();
  return { title: title || translate(narrationLocale(), "stream.liveWork"), note: note || title };
}

// 재료(delta·diff) → AI 해설 → 캐치업 방출 + 날짜별 저장. ts = 카드 시각(재생이면 원래 시각). 해설 없음(SKIP 등)이면 false.
// 실패(구독 미가용·레이트리밋 등)는 throw — 호출부가 조용히 처리.
export async function narrate(cwd: string, agent: string, delta: string, diff: string, ts: number, opts: { providerId?: unknown; signal?: AbortSignal } = {}): Promise<boolean> {
  if (repoPrefOff(cwd, "explainAnalyze")) return false; // #1239 이 레포만 해설 분석 끔(캐치업 창 레포 설정) — observe·backfill 공통 길목
  const end = beginNarrate(cwd); // #1240 캐치업 창 "만드는 중" — 성공·실패·SKIP 모두 끝에서 뺌
  try { return await narrateOnce(cwd, agent, delta, diff, ts, opts); } finally { end(); }
}

async function narrateOnce(cwd: string, agent: string, delta: string, diff: string, ts: number, opts: { providerId?: unknown; signal?: AbortSignal }): Promise<boolean> {
  // #1062 설정 > 캐치업 > 해설 AI — SNA(구독 CLI) 3종. 그 밖(openai-compatible 등)은 Claude로, 모델도 그 AI 것만 적용.
  const chosen = opts.providerId === "codex" ? "codex-agent" : narrationProvider();
  const pid = chosen === "codex-agent" || chosen === "opencode-agent" ? chosen : "claude-agent";
  const provider = pid === "codex-agent" ? snaCodexProvider : pid === "opencode-agent" ? snaOpenCodeProvider : snaClaudeProvider;
  const model = pid === chosen ? narrationModel() : ""; // 다른 AI로 대체되면 그 모델 id는 안 맞음 → 기본 모델
  const request: AgentAnalyzeRequest = {
    code: "repo terminal activity",
    locale: narrationLocale(), // #1091 앱 언어(본문 지시는 한국어여도 buildChatPrompt 끝 지시가 이김)
    providerId: pid,
    mode: "chat",
    messages: [{ role: "user", content: narrationPrompt(agent, delta, diff, narrationLocale()) }],
    ...(model ? { providerSettings: { [pid]: { model } } } : {}), // #1062 해설 모델
  };
  const res = await provider.analyze(request, { signal: opts.signal });
  const summary = (res?.summary ?? "").trim();
  // #1093 런타임 실패(동시 세션 상한 등)는 summary에 문구를 담아 옴 → 카드로 내지 말고 실패로(호출부가 조용히 처리)
  if (isFailedNote(summary) || res?.warnings?.some((w) => w.code === "PARSE_FAILED")) throw new Error(summary || "runtime failed");
  // 모델이 실제 활동 없다고 판단하면 "SKIP" → 카드 방출 안 함(무의미 내레이션·토큰 낭비 방지).
  if (/^SKIP\b/i.test(summary)) console.log(`[narration] SKIP ${cwd.split("/").pop()} (delta ${delta.length}B, diff ${diff.length}B)`); // #1045 진단 — 왜 해설이 안 뜨나
  if (!summary || /^SKIP\b/i.test(summary) || summary.length <= 8) return false;
  const { title, note } = splitNarration(summary);
  const sent = emitNarration(cwd, title, cleanNote(note), ts);
  // #994 캐치업 날짜별 저장 — 서버에서 바로(패널이 안 열려 있어도 기록). key는 클라 SSE 키와 동일.
  if (sent) { try { appendItems(cwd, [{ key: `narration|${ts}|${sent.target}`, kind: "narration", target: sent.target, tool: "narration", ts, expl: sent.note }]); } catch { /* 저장 실패가 내레이션 막지 않게 */ } }
  return !!sent;
}
