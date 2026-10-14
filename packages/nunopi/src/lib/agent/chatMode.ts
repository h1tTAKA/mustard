// 학습 챗 — 사용자가 보고 있는 코드에 대해 자유롭게 질문하면 튜터가 한국어로 답한다.
// 응답은 JSON이 아니라 자유 텍스트라, 답을 그대로 summary에 담아 반환한다.
import type { AgentAnalyzeRequest, AgentAnalyzeResponse } from "@mustard/core";
import type { AgentProviderKind } from "@mustard/core";
import type { TranslateWarning } from "@mustard/core";

const LANG_NAME: Record<AgentAnalyzeRequest["locale"], string> = {
  ko: "Korean",
  ja: "Japanese",
  en: "English",
};

// claude --system-prompt 등에 쓰는 튜터 시스템 프롬프트(프로즈, JSON 아님).
// 답변 언어는 사용자가 설정한 locale을 따른다(ko/ja/en).
// 가독성: 통짜 텍스트 대신 "스캔하기 쉬운" 구조화 마크다운을 요구(#748). 단 적응적 — 짧은 질문은 짧게.
export function chatSystemPrompt(locale: AgentAnalyzeRequest["locale"]): string {
  const name = LANG_NAME[locale] ?? "Korean";
  return [
    `You are Nunopi, a friendly coding tutor for a beginner. Answer in ${name}. Do not output JSON.`,
    `Write clean, scannable GitHub-flavored markdown so a beginner can read it at a glance:`,
    `- Break a longer answer into short sections with "##"/"###" headings.`,
    `- **Bold** the key terms; use "-" bullet lists for enumerations; keep paragraphs short (1–3 sentences).`,
    `- Put code in fenced blocks with a language tag (e.g. \`\`\`ts), and inline code/identifiers in backticks.`,
    `- When you compare or contrast things, use a GitHub markdown table.`,
    `- Use "> " callouts for a key tip/warning, and a "---" divider between major sections.`,
    `- A few emoji as section markers are fine, but keep it tasteful — do not overuse.`,
    `Adaptive: match structure to length. A short/simple answer stays a sentence or two with no headings; only add structure when it genuinely helps understanding.`,
  ].join("\n");
}

// 코드 + 대화 내역으로 챗 프롬프트를 만든다(마지막이 사용자 질문).
// codex처럼 system prompt를 못 받는 provider도 있어, 언어 지시를 본문에 반드시 포함한다.
export function buildChatPrompt(request: AgentAnalyzeRequest): string {
  const name = LANG_NAME[request.locale] ?? "Korean";
  const messages = request.messages ?? [];
  const transcript = messages
    .map((m) => `${m.role === "user" ? "User" : "Tutor"}: ${m.content}`)
    .join("\n");
  return [
    chatSystemPrompt(request.locale),
    "",
    "Code the user is learning:",
    "```",
    request.code,
    "```",
    "",
    "Conversation:",
    transcript,
    "",
    `Answer the user's last question about the code above in ${name}. Be friendly and to the point,`,
    `and format the answer as clean, scannable markdown per the style guide above (headings, bold, bullets,`,
    `fenced code with a language tag, a table when comparing) — but keep short answers short.`,
    // #1091 지시·코드 주석·대화가 다른 언어(캐치업 프롬프트는 한국어)여도 답은 설정 언어로 — 맨 끝이라 가장 강함.
    `OUTPUT LANGUAGE (CRITICAL): Write your ENTIRE answer — title line, headings, explanations, term lists and card definitions — in ${name},`,
    `even if the instructions, code comments or conversation above are in another language. Translate headings like "용어" too. Keep code and identifiers unchanged.`,
    ...(request.noCards ? ["Tutor:"] : cardInstruction(name)),
  ].join("\n");
}

// 카드 제안 지시(nunopi-cards) — nunopi 학습모듈 꺼짐(noCards)이면 생략(#998).
function cardInstruction(name: string): string[] {
  return [
    "",
    "After your answer, propose flashcards for the GENERAL programming/IT concepts and terms in your answer that a",
    "beginner would benefit from studying — the reusable knowledge, not this project's specifics. GOOD cards:",
    "widely-applicable concepts and terms like `IndexedDB`, `직렬화(serialization)`, `API 엔드포인트`, `관심사의 분리`,",
    "`로컬 저장소`, `비동기(async)`. Do NOT propose this repository's own file names, component names, route names,",
    "or custom function/variable identifiers (e.g. `historyDB`, `analyze route`, `LearningPanel`, `AnalyzeControls`)",
    "— those are project trivia, not vocabulary. Don't artificially limit the count; include all meaningful concepts",
    "(skip trivial/obvious words). Append AFTER your answer a fenced block EXACTLY like this (output it raw, do not describe it):",
    "```nunopi-cards",
    `[{"term":"<term>","definition":"<one-line beginner definition in ${name}>","kind":"concept|term"}]`,
    "```",
    "Block rules: general concepts/terms relevant to THIS answer; each term ONCE; definitions grounded in what you",
    "just explained; kind = concept(a programming concept) | term(a general IT term). If there is genuinely no",
    "general concept worth learning (e.g. the answer was only about this repo's own files), omit the block entirely.",
    "Tutor:",
  ];
}

// 덱 정리(생성/분류) 전용 시스템 프롬프트 — 챗과 달리 카드 제안(nunopi-cards) 없이,
// 간결한 대화 + 필요 시 컨텍스트가 지정한 펜스 블록만 낸다. 저추론(effort low)과 함께 씀.
export function deckAgentSystemPrompt(locale: AgentAnalyzeRequest["locale"]): string {
  const name = LANG_NAME[locale] ?? "Korean";
  return `You are Nunopi, a helper that organizes a learner's flashcards into decks. Reply briefly in ${name} (plain text / light markdown). When the user actually wants to build or sort decks, output the fenced block EXACTLY as the context specifies — nothing else extra. Do not propose flashcards or add unrelated content.`;
}

// 덱 에이전트 프롬프트 — code 슬롯엔 이미 카드 목록 + 블록 형식 규칙(deckSelect/deckAssign 컨텍스트)이 들어 있다.
// buildChatPrompt와 달리 nunopi-cards 블록 지시를 붙이지 않는다(불필요 출력·지연 제거).
export function buildDeckAgentPrompt(request: AgentAnalyzeRequest): string {
  const name = LANG_NAME[request.locale] ?? "Korean";
  const transcript = (request.messages ?? [])
    .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
    .join("\n");
  return [
    deckAgentSystemPrompt(request.locale),
    "",
    request.code, // 카드 목록 + 블록 형식 규칙(컨텍스트)
    "",
    "Conversation:",
    transcript,
    "",
    `Reply to the user's last message in ${name}. Be concise. Output the fenced block ONLY when actually building/sorting decks (exactly as the context above specifies).`,
    "Assistant:",
  ].join("\n");
}

// 자유 텍스트 답을 summary에 담은 응답으로 정규화.
export function normalizeChatOutput(
  rawText: string,
  providerId: AgentProviderKind,
): AgentAnalyzeResponse {
  const answer = rawText.trim();
  return chatModeResponse(providerId, answer || "(빈 응답)", []);
}

// 챗 응답 래퍼(성공 답 또는 실패/안내 메시지).
export function chatModeResponse(
  providerId: AgentProviderKind,
  summary: string,
  warnings: TranslateWarning[],
): AgentAnalyzeResponse {
  return {
    providerId,
    mode: "chat",
    language: "text",
    summary,
    lineExplanations: [],
    tokens: [],
    concepts: [],
    warnings,
    createdAt: new Date().toISOString(),
  };
}
