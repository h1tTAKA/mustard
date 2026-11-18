// 실시간 해설 생성(#870) — observe 라우트(터미널 델타)와 꺼진 동안 재생(#1068, 에이전트 기록)이 함께 씀. 서버 전용.
import { snaClaudeProvider, snaCodexProvider, snaOpenCodeProvider } from "@mustard/nunopi/server";
import type { AgentAnalyzeRequest } from "@mustard/core";
import { emitNarration } from "@/lib/mcpActivity";
import { appendItems, repoPrefOff, readDay, dayKey } from "@/lib/catchupStore";
import { isRepeat, memoLines, type PastNarration } from "@/lib/narrationMemo";
import { beginNarrate } from "@/lib/narrateBusy";
import { narrationProvider, narrationModel, narrationLocale, narrationBeginner, narrationKnown } from "@/lib/narrationConfig";
import { translate } from "@mustard/core/messages";
import { isFailedNote } from "@/lib/failText";
import { CARD_HEADS } from "@/lib/catchupTerms";
import { KIND_GUIDE, classifyPrompt, parseKinds } from "@/lib/cardKindAI";
import type { CardKind } from "@/lib/catchupTerms";

// #1091 출력 언어 — 본문 지시가 한국어라 ko 아니면 맨 앞·끝에 못박음(제목 줄·소제목까지).
const LANG_NAME = { ko: "한국어", ja: "일본어(日本語)", en: "영어(English)" } as const;
const langRule = (loc: keyof typeof LANG_NAME) => `⚠️ 출력 언어: 제목 줄·소제목(용어 소제목 포함)·본문 전부 ${LANG_NAME[loc]}로 써. 아래 지시가 한국어여도 답은 ${LANG_NAME[loc]}.`;
// #1359 칸 이름 — 출력 언어로(첫 칸 '무슨 얘기냐면'은 소제목 없이 제목 밑 첫 문단 — 유저 요청)(본문 지시는 한국어). 풀이 칸 이름에 '용어'가 들어가야 캐치업 용어집(parseNarrationTerms)이 모음.
const HEADS = {
  code: { ko: "어떤 코드를 어떻게 바꿨나", ja: "どのコードをどう変えたか", en: "What code changed and how" }, // #1378 용어만 잔뜩이고 코드 설명이 없던 것(유저 지적)
  why: { ko: "왜 그렇게 하냐면", ja: "なぜそうするかというと", en: "Why it does this" },
  words: { ko: "나온 말·용어 풀이", ja: "出てきた言葉・用語", en: "Words & terms" }, // 화면은 이름을 카드 추가 칩으로
  cards: CARD_HEADS, // 화면은 이 칸을 글 대신 카드 맨 아래 칩 줄로(catchupTerms.splitCardSection)
} as const;
// #1359 유저 수준·아는 용어 — 초보가 아니면 기본 개발 말은 빼고, 유저가 '이미 알아요'로 고른 말은 풀이·카드 칸 어디에도 넣지 않게
// 한계: 아는 용어가 아주 많으면 앞 1200자만 프롬프트에(화면 숨김은 전부 적용)
const cutList = (xs: string[], max: number) => { const out: string[] = []; let n = 0; for (const x of xs) { if (n + x.length + 2 > max) break; out.push(x); n += x.length + 2; } return out.join(", "); }; // 용어 중간에서 안 자름(리뷰)
function termRules(): string {
  const known = narrationKnown();
  return (narrationBeginner() ? "" : " 유저는 개발자라 커밋·PR·머지·브랜치·푸시·풀·클론·저장소·터미널·디버그·빌드·배포·grep·ls·cd 같은 기본 개발 용어는 풀이하지 마.")
    + (known.length ? ` 유저가 이미 아는 말(풀이·카드 칸에 넣지 마): ${cutList(known, 1200)}.` : "")
    + " 풀이하지 않는 말은 **아예 언급하지 마** — \"이미 아시니 생략\", \"~는 아실 테니\" 같은 말도 쓰지 마.";
}
// #1359 해설 = CLI 에이전트가 하는 말·작업을 옆에서 바로 이해하게 — 에이전트 말이 무슨 뜻인지, 왜 그렇게 하는지·그러면 어떻게 되는지,
// 그 안에 나온 개념·용어 하나하나. 재료는 대화 기록(없으면 터미널 글자), 앞서 해설한 것을 넘겨 반복 대신 흐름을 이음.
function narrationPrompt(agent: string, material: string, fromTranscript: boolean, diff: string, memo: string[], loc: keyof typeof LANG_NAME): string {
  const h = (k: keyof typeof HEADS) => `### ${HEADS[k][loc] ?? HEADS[k].ko}`;
  const rule = loc === "ko" ? "" : `${langRule(loc)}\n\n`;
  return `${rule}너는 CLI 코딩 에이전트(${agent})가 일하는 걸 옆에서 보는 개발 초보에게, 에이전트가 **방금 한 말과 작업**을 실시간으로 풀어 주는 해설자야.
목표: 이걸 읽은 유저가 에이전트 말을 바로 이해하고 따라갈 수 있게 — 그 말이 무슨 뜻인지, 왜 그렇게 하자는 건지, 그러면 무엇이 어떻게 되는지, 그 안의 개념·용어까지.

아래 순서로 써(해당 없는 칸은 소제목째 빼):
맨 앞 줄: 지금 일의 핵심을 담은 짧은 제목(25자 안팎 명사구). "제목:"·#·** 금지.
그 다음 줄부터 소제목 없이 바로 첫 문단: 에이전트가 한 말·작업을 쉬운 말로 2~4문장. 유저가 맡긴 일과 이어서 "~하려고 → 지금 ~을 하고 있다". 앞서 해설한 흐름이 있으면 "앞에서 ~했고, 이제 ~"처럼 이어 줘. 에이전트 말을 그대로 옮기지 말고 뜻을 풀어.
${h("code")}
재료에 [코드 수정](또는 바뀐 코드 diff)이 있으면 **이 칸이 해설의 중심**: 어느 파일의 무엇을 바꿨는지, 바꾸기 전 → 바꾼 뒤를 핵심 몇 줄만 짧은 코드블록으로 보여 주고(코드블록 첫 줄에 언어 표시 필수 — \`\`\`dart·\`\`\`ts·\`\`\`python 등 그 파일 언어), 그 코드가 이제 무슨 일을 하게 됐는지·왜 그렇게 바꿨는지 1~3문장. 고친 곳이 여럿이면 중요한 것 1~2곳만. 코드는 재료에 있는 걸 줄여 옮기기만(새로 짓거나 고쳐 쓰지 마). diff에 이번 작업과 관계없는 변경이 섞여 있으면 대화의 [코드 수정]과 이어지는 것만. 코드를 안 바꾼 묶음(조사·테스트·빌드만)이면 소제목째 빼.
${h("why")}
에이전트가 왜 그렇게 판단·제안했는지, 그렇게 하면 무엇이 어떻게 되는지(앱·코드·다음 단계에 생기는 일) 1~3문장. 에이전트가 이유를 말했으면 그 이유를 풀고, 안 말했으면 재료에서 보이는 만큼만.
${h("words")}
에이전트 말·작업에 나온 **일반 개념·용어**(언어·프레임워크·도구·개발에서 두루 쓰는 말 — 다른 프로젝트에서도 통하는 것)를 **하나씩** "- **이름** — 쉬운 뜻 + 지금 이 맥락에서 무슨 의미인지" 0~6개. 위 코드 칸이 있으면 **그 코드에 나온 것 먼저**(코드를 읽는 데 필요한 순서로), 뜻에 "위 코드에서 ~하는 데 썼어요"처럼 이어 줘. 처음 보는 사람이 이름만으로는 뜻을 짐작하기 어려운 개념만 — 영어 뜻 그대로인 속성·인자 이름(size·color·width·height·padding·onTap 등)이나 "A의 B"(특정 위젯·함수의 속성)는 풀지 마. 그런 개념이 없으면 소제목째 빼. **이름은 일반형**으로 — 카드로 남겨 다른 작업에서도 쓰니, 이번 작업의 값·파일명·변수명을 이름에 넣지 말고(나쁨: \`sed -n 282,400p\` / 좋음: \`sed -n\`) 그 값은 뜻 쪽에 "여기선 282~400줄"처럼. 브랜치 이름·localhost·포트·이슈 번호·커밋 해시·파일 이름·이 레포에서 지은 이름·앱 이름은 어디에도 풀이하지 마. 항목 하나에 이름 하나(A / B로 묶지 마).${termRules()} 코드에 그대로 쓰는 이름(클래스·함수·메서드·위젯·속성·명령·파일)은 **반드시** 백틱으로 — 빠뜨리면 카드 종류(코드 토큰/IT용어)가 틀림: "- **\`PageController\`** — … [코드]", "- **재귀** — … [개념]". **줄 끝에 종류 표시 하나 필수**: ${KIND_GUIDE} 앞서 해설에서 풀이한 용어도 이번에 또 나왔으면 다시 써(되풀이해 보며 자연스럽게 익히게).
${h("cards")}
위 용어 풀이에 안 나왔지만 지금 일을 이해하는 데 바탕이 되는 일반 개념을 "- **이름** — 짧은 뜻(한 문장)" 0~3개(이름 하나씩·일반형, 코드 이름은 반드시 백틱, 줄 끝에 [코드]·[개념]·[IT] 중 하나). 이 레포에서 지은 이름·이번 작업의 값 금지, 이름만 봐도 아는 말 금지. 없으면 소제목째 빼.

📏 전체 300~800자(코드 칸이 있으면 코드 포함 400~1200자)로 완결(시작한 문장 끝맺기). 길이가 모자라면 용어 개수를 줄이고 코드 칸은 지켜. 재료에 보이는 사실만 — 짐작·일반론·칭찬 금지.
⚠️ 금지:
- 에이전트 내부 동작 해설 금지: 훅(PreToolUse 등)·도구 검색·기억 조회·스피너·상태 줄은 해설 대상이 아님. 재료가 그것뿐이면 딱 "SKIP".
- **반복 금지**: '앞서 해설한 것'과 같은 작업 이야기(같은 말·같은 작업)를 되풀이하게 되면 딱 "SKIP". 새로 생긴 말·작업만 다룸(용어가 겹치는 건 괜찮음).
- 작업 대행 금지(문안·커밋 메시지·코드 작성 X), 사람 이름 금지.
- **문서 작업·질문 답변뿐이면 딱 "SKIP"** — 문서(.md 학습정리·작업일지·plan·README 등) 읽기·쓰기·정리·형식 확인, 유저 질문·상담에 말로만 답함. 유저가 직접 보고 있어 해설이 필요 없음. 단 코드를 읽고 원인을 찾거나·테스트·빌드로 확인하는 작업은 코드 작업이라 해설함. SKIP일 땐 해설을 쓰다가 끝에 붙이지 말고 "SKIP" 한 단어만 출력.
${memo.length ? `\n## 앞서 해설한 것(이 레포, 최근 — 같은 작업 이야기는 되풀이 말고 이어 쓸 것)\n${memo.join("\n")}\n` : ""}
${material}
${diff.trim() ? `\n## 바뀐 코드(git diff HEAD, 일부 — 커밋 안 한 변경 전체라 이번 작업과 관계없는 것도 섞일 수 있음. 코드 칸 재료, 대화의 [코드 수정]이 우선)\n\`\`\`diff\n${diff}\n\`\`\`` : ""}
${fromTranscript ? "" : "\n(재료가 터미널 화면 글자라 스피너·상태 줄 같은 잡음이 섞여 있을 수 있음 — 무시하고 에이전트 말·작업만.)"}${rule ? `\n\n${langRule(loc)}` : ""}`;
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

// 같은 레포의 최근 해설(오늘, 30분 안, 6장, 오래된 것부터)
function recentNarrations(cwd: string, ts: number): PastNarration[] {
  try {
    return readDay(cwd, dayKey(ts)).filter((x) => x.kind === "narration" && x.ts < ts && ts - x.ts < 30 * 60_000)
      .sort((a, b) => a.ts - b.ts).slice(-6).map((x) => ({ ts: x.ts, title: String(x.target ?? ""), expl: String(x.expl ?? "") }));
  } catch { return []; }
}

// 재료(delta·diff) → AI 해설 → 캐치업 방출 + 날짜별 저장. ts = 카드 시각(재생이면 원래 시각). 해설 없음(SKIP 등)이면 false.
// 실패(구독 미가용·레이트리밋 등)는 throw — 호출부가 조용히 처리.
// material = 대화 기록 재료(liveTranscript.materialOf) — 있으면 그걸, 없으면 delta(터미널 글자)를 재료로
// timeoutMs = 실제로 시작할 때부터 재는 시간 제한(같은 레포 줄에서 기다린 시간은 안 셈 — 리뷰)
export async function narrate(cwd: string, agent: string, delta: string, diff: string, ts: number, opts: { providerId?: unknown; signal?: AbortSignal; material?: string; timeoutMs?: number } = {}): Promise<boolean> {
  if (repoPrefOff(cwd, "explainAnalyze")) return false; // #1239 이 레포만 해설 분석 끔(캐치업 창 레포 설정) — observe·backfill 공통 길목
  // #1359 같은 레포 해설은 한 줄로 — 동시에 돌면 둘 다 같은 '앞서 해설한 것'을 보고 같은 개념을 또 설명(리뷰)
  const prev = narrateChains.get(cwd) ?? Promise.resolve();
  const run = prev.catch(() => {}).then(async () => {
    const end = beginNarrate(cwd); // #1240 "만드는 중" 표시
    const signal = opts.timeoutMs ? AbortSignal.timeout(opts.timeoutMs) : opts.signal;
    try { return await narrateOnce(cwd, agent, delta, diff, ts, { ...opts, signal }); } finally { end(); }
  });
  narrateChains.set(cwd, run);
  try { return await run; } finally { if (narrateChains.get(cwd) === run) narrateChains.delete(cwd); }
}
const narrateChains = new Map<string, Promise<boolean>>();

// #1062 설정 > 캐치업 > 해설 AI — SNA(구독 CLI) 3종. 그 밖(openai-compatible 등)은 Claude로, 모델도 그 AI 것만 적용.
function narrationAI(providerId?: unknown) {
  const chosen = providerId === "codex" ? "codex-agent" : narrationProvider();
  const pid: "codex-agent" | "opencode-agent" | "claude-agent" = chosen === "codex-agent" || chosen === "opencode-agent" ? chosen : "claude-agent";
  const provider = pid === "codex-agent" ? snaCodexProvider : pid === "opencode-agent" ? snaOpenCodeProvider : snaClaudeProvider;
  const model = pid === chosen ? narrationModel() : ""; // 다른 AI로 대체되면 그 모델 id는 안 맞음 → 기본 모델
  return { pid, provider, model };
}

// #1369 저장된 카드 종류를 해설 AI로 다시 나눔(한 번에 최대 80장). 실패하면 throw — 호출부가 다음에 다시.
export async function classifyCardKinds(items: { name: string; def: string }[], signal?: AbortSignal): Promise<(CardKind | undefined)[]> {
  const { pid, provider, model } = narrationAI();
  const res = await provider.analyze({
    code: "card kinds", locale: "ko", providerId: pid, mode: "chat",
    messages: [{ role: "user", content: classifyPrompt(items) }],
    ...(model ? { providerSettings: { [pid]: { model } } } : {}),
  } as AgentAnalyzeRequest, { signal });
  const text = (res?.summary ?? "").trim();
  if (!text || isFailedNote(text) || res?.warnings?.some((w) => w.code === "PARSE_FAILED")) throw new Error(text || "no answer");
  const kinds = parseKinds(text, items.length);
  if (!kinds.some(Boolean)) throw new Error("unparsed answer"); // 하나도 못 읽으면 실패로 — 완료 표시 없이 다음에 다시(리뷰)
  return kinds;
}

async function narrateOnce(cwd: string, agent: string, delta: string, diff: string, ts: number, opts: { providerId?: unknown; signal?: AbortSignal; material?: string }): Promise<boolean> {
  // #1359 앞서 해설한 것(같은 레포, 최근 30분 6장) — 반복 대신 흐름을 잇게 프롬프트에, 그래도 새것 없는 카드는 버림
  const past: PastNarration[] = recentNarrations(cwd, ts);
  const memo = memoLines(past, (t) => new Date(t).toTimeString().slice(0, 5));
  const material = opts.material ?? `## 터미널 화면(에이전트 출력)\n${delta}`;
  const { pid, provider, model } = narrationAI(opts.providerId);
  const request: AgentAnalyzeRequest = {
    code: "repo terminal activity",
    locale: narrationLocale(), // #1091 앱 언어(본문 지시는 한국어여도 buildChatPrompt 끝 지시가 이김)
    providerId: pid,
    mode: "chat",
    messages: [{ role: "user", content: narrationPrompt(agent, material, !!opts.material, diff, memo, narrationLocale()) }],
    ...(model ? { providerSettings: { [pid]: { model } } } : {}), // #1062 해설 모델
  };
  const res = await provider.analyze(request, { signal: opts.signal });
  const summary = (res?.summary ?? "").trim();
  // #1093 런타임 실패(동시 세션 상한 등)는 summary에 문구를 담아 옴 → 카드로 내지 말고 실패로(호출부가 조용히 처리)
  if (isFailedNote(summary) || res?.warnings?.some((w) => w.code === "PARSE_FAILED")) throw new Error(summary || "runtime failed");
  // 모델이 실제 활동 없다고 판단하면 "SKIP" → 카드 방출 안 함(무의미 내레이션·토큰 낭비 방지).
  const skip = /^[\s*`_\-•>.:"'“”]*SKIP[\s*`_.!:"'“”]*$/m.test(summary) || /^[\s*`_\-•>]*SKIP(?![A-Za-z0-9_-])/.test(summary); // SKIP뿐인 줄(**SKIP**·`SKIP`·- SKIP 포함)이 어디 있든 해설 없음 — 끝에 붙여도(#1367). 맨 앞이 대문자 SKIP 낱말이면("SKIP — 이유"·"SKIP 문서만…") 해설 없음, SKIP-LOCKED·SKIPPED는 통과. 대문자만 — "Skip 버튼…" 같은 제목은 통과
  if (skip) console.log(`[narration] SKIP ${cwd.split("/").pop()} (delta ${delta.length}B, diff ${diff.length}B)`); // #1045 진단 — 왜 해설이 안 뜨나
  if (!summary || skip || summary.length <= 8) return false;
  const { title, note } = splitNarration(summary);
  if (isRepeat(title, note, past, diff.trim().length > 0)) { console.log(`[narration] repeat dropped ${cwd.split("/").pop()}: ${title}`); return false; } // #1359 같은 제목·이미 설명한 개념뿐
  const sent = emitNarration(cwd, title, cleanNote(note), ts);
  // #994 캐치업 날짜별 저장 — 서버에서 바로(패널이 안 열려 있어도 기록). key는 클라 SSE 키와 동일.
  if (sent) { try { appendItems(cwd, [{ key: `narration|${ts}|${sent.target}`, kind: "narration", target: sent.target, tool: "narration", ts, expl: sent.note }]); } catch { /* 저장 실패가 내레이션 막지 않게 */ } }
  return !!sent;
}
