// 글(IT 용어) 분석 모드 — 프로바이더(claude/codex/openai)는 실행 방식만 다르고
// 프롬프트와 출력 정규화는 동일하므로 여기서 공용화한다. 각 프로바이더는
// request.mode === "text"일 때 buildTextPrompt로 프롬프트를 만들고 normalizeTextOutput으로
// 결과를 정규화한다.
import type { AgentAnalyzeRequest, AgentAnalyzeResponse, AgentUsage } from "@mustard/core";
import type { AgentProviderKind } from "@mustard/core";
import type { ItConcept, ItTerm, TranslateWarning } from "@mustard/core";
import { outputLanguageDirective } from "./outputLanguage";

const JSON_CODE_BLOCK_PATTERN = /```json\s*([\s\S]*?)```/i;

// IT 용어 글을 초보자용으로 분석하라는 프롬프트(JSON only).
const TEXT_HEADER = [
  "You are Nunopi's IT-term explainer for absolute beginners.",
  "The input is a piece of IT-related prose (e.g. an X/Twitter post, a tech article).",
  "It is NOT source code. Do not treat it as code.",
  "Explain it in the OUTPUT LANGUAGE given below so that even a beginner with no IT background understands.",
  "Return JSON only.",
  "",
  "Tone (IMPORTANT):",
  "- When the output language is Korean, write in plain declarative style ending in '~다' (평서체); in other languages use the equivalent plain neutral style (e.g. Japanese である/だ調, plain English).",
  "- Do NOT use polite/honorific or childish endings (Korean '~에요/~해요/~요', Japanese です/ます).",
  "- Match the dry, neutral tone of code analysis. Be easy and friendly but never use honorifics.",
];

function textTail(request: AgentAnalyzeRequest): string[] {
  return [
    "",
    outputLanguageDirective(request.locale),
    `Locale: ${request.locale}`,
    `User intent: ${request.userIntent ?? "Explain the IT terms in this text for a beginner."}`,
    "",
    "Text to analyze:",
    '"""',
    request.code,
    '"""',
  ];
}

// 이어서 분석(resume): 이미 뽑힌 용어를 제외하고 나머지만 뽑게 하는 추가 지시.
// resumeFrom 없으면 빈 배열(첫 분석은 영향 0).
function resumeDirectives(request: AgentAnalyzeRequest): string[] {
  const prior = request.resumeFrom;
  const doneTerms = (prior?.terms ?? []).map((t) => t.term).filter(Boolean);
  if (doneTerms.length === 0) return [];
  return [
    "",
    "RESUME — these IT terms were ALREADY extracted in a previous pass; do NOT repeat any of them:",
    doneTerms.map((t) => `- ${t}`).join("\n"),
    "Now CONTINUE: scan the text and output ONLY the IT terms that are NOT in the list above,",
    "plus their related concepts. Same JSON shape and order (terms first). You may leave",
    'summary and title as "" — they are already done. Do not re-extract listed terms.',
  ];
}

export function buildTextPrompt(request: AgentAnalyzeRequest): string {
  // 글 분석은 호출 1번으로 title/summary/terms(설명)/concepts(설명)를 한 방에 생성한다.
  return [
    ...TEXT_HEADER,
    "",
    "Coverage & output order (results STREAM to the user the instant each piece finishes):",
    "- Output the JSON fields in THIS EXACT ORDER: terms FIRST, then concepts, then summary, then title.",
    "- Emit terms in the order they appear in the text — write each term out AS SOON AS you encounter it, one by one. Do NOT plan the whole analysis before starting; start streaming terms immediately. (summary/title need the whole text, so they come LAST.)",
    "- Scan the ENTIRE text sentence by sentence and extract EVERY IT/tech term, acronym, and jargon that appears — do not skip any, even ones mentioned only once in passing. No artificial limit. (Still: do not invent terms not in the text, and do not split one idea into duplicates.)",
    "- Be GENEROUS with related concepts: for each term add the background/underlying ideas that help a beginner truly get it (the mechanism behind it, a foundational idea it builds on, or a closely related concept), linked via conceptIds. Don't be stingy — surfacing more genuinely useful concepts is the goal. Only skip concepts unrelated to this text.",
    "- Each term explanation: about 2 sentences (what it is + why it matters here; add one short everyday analogy only when it truly helps). Tight, no filler.",
    "- Each concept explanation: about 2 sentences, same beginner-friendly way.",
    "- summary: 3-5 sentences.",
    "",
    "Output JSON shape (keys in this order):",
    "{",
    '  "terms": [',
    "    {",
    '      "id": "string (unique, referenced by other terms.conceptIds via concepts)",',
    '      "term": "string (글에 실제로 등장한 IT 용어 그대로, 예: AMM, LP, 슬리피지, 오라클)",',
    '      "reading": "string (optional, 약어 풀이나 원어. 예: \\"AMM = Automated Market Maker\\")",',
    '      "explanation": "string (그 용어가 무슨 뜻인지+왜 중요한지 초보자 눈높이로 쉽게, 도움되면 짧은 비유 하나, 출력 언어 평서체로 약 2문장)",',
    '      "conceptIds": "string[] (이 용어 설명을 이해하려면 더 알아야 하는 concepts[].conceptId들)",',
    '      "bookmarkable": true',
    "    }",
    "  ],",
    '  "concepts": [',
    "    {",
    '      "conceptId": "string (unique)",',
    '      "title": "string (관련 개념 이름, 출력 언어)",',
    '      "explanation": "string (그 개념을 초보자 눈높이로 쉽게, 출력 언어 평서체로 약 2문장)"',
    "    }",
    "  ],",
    '  "summary": "string (글 전체를 IT를 모르는 초보자도 이해할 만큼 쉬운 출력 언어 평서체로 3-5문장 요약)",',
    '  "title": "string (이 글의 핵심 주제를 압축한 짧은 출력 언어 명사구 제목. 문장/마침표 금지, 6~24자, 구체적으로. 예: \\"AMM·슬리피지 입문\\")",',
    '  "warnings": [{ "code": "PARTIAL_PARSE | UNKNOWN_LANGUAGE | PARSE_FAILED | TOO_LONG", "message": "string" }]',
    "}",
    "",
    "Rules:",
    "- Extract ONLY IT/tech-related terms from the text. Ignore ordinary words.",
    "- For a term whose explanation itself uses another term a beginner likely doesn't know, add that to concepts and link it via the term's conceptIds.",
    "- Every term.id and every concept.conceptId must be UNIQUE across the whole response.",
    "- All explanations in the beginner-friendly output language, plain neutral tone, about 2 sentences, helpful but never padded.",
    "- Only include a PARTIAL_PARSE warning if the input was actually truncated; otherwise return an empty warnings array.",
    ...resumeDirectives(request),
    ...textTail(request),
  ].join("\n");
}

// 스트리밍 중 누적된(아직 미완인) JSON에서 "지금까지 완성된" 부분만 관대하게 뽑는다.
// 단일 호출 점진 표시용: summary가 닫히면 요약 먼저, terms/concepts의 객체가 하나씩
// 닫힐 때마다 그것만 추가. 완성 안 된 마지막 객체는 버린다. 실패해도 throw 금지(부분만 반환).
// createdAt은 호출자가 준 startedAt로 고정 — 모든 partial이 같은 createdAt이라 클라
// reset effect(`[result?.createdAt]`) 리마운트 thrash를 막는다(#110 교훈).
export function parseTextStreamPartial(
  accumText: string,
  providerId: AgentProviderKind,
  startedAt: string,
): AgentAnalyzeResponse | null {
  // ```json 펜스가 시작됐으면 그 뒤만 본다(아직 안 닫혔어도).
  let body = accumText;
  const fence = body.indexOf("```json");
  if (fence >= 0) body = body.slice(fence + "```json".length);

  const title = matchJsonString(body, "title");
  const summary = matchJsonString(body, "summary");
  const rawTerms = scanArrayObjects(body, "terms");
  const rawConcepts = scanArrayObjects(body, "concepts");

  // 표시할 게 아무것도 없으면(요약도 항목도) 아직 partial 발행 안 함.
  if (summary == null && rawTerms.length === 0 && rawConcepts.length === 0) {
    return null;
  }

  const terms = dedupeById(rawTerms.filter(isItTerm)).map((t) => ({
    ...t,
    conceptIds: t.conceptIds ?? [],
    bookmarkable: true,
  }));
  const itConcepts = dedupeByConceptId(rawConcepts.filter(isItConcept));

  return {
    providerId,
    mode: "text",
    language: "text",
    title: title && title.trim() ? title.trim() : undefined,
    summary: summary ?? "",
    lineExplanations: [],
    tokens: [],
    concepts: [],
    terms,
    itConcepts,
    warnings: [],
    createdAt: startedAt,
  };
}

// 누적 텍스트에서 `"key": "..."` 의 문자열 값을 디코드해 반환. 아직 안 닫혔으면 null.
function matchJsonString(body: string, key: string): string | null {
  const re = new RegExp(`"${key}"\\s*:\\s*"`);
  const m = re.exec(body);
  if (!m) return null;
  const open = m.index + m[0].length - 1; // 여는 따옴표 위치
  for (let i = open + 1; i < body.length; i++) {
    const ch = body[i];
    if (ch === "\\") {
      i++; // 이스케이프 다음 글자 건너뜀
      continue;
    }
    if (ch === '"') {
      try {
        return JSON.parse(body.slice(open, i + 1)) as string; // 따옴표 포함 디코드
      } catch {
        return null;
      }
    }
  }
  return null; // 문자열이 아직 안 닫힘
}

// `"key": [ {...}, {...}, ... ]` 에서 완성된 top-level 객체만 파싱해 배열로. 미완 마지막 객체는 제외.
function scanArrayObjects(body: string, key: string): unknown[] {
  const re = new RegExp(`"${key}"\\s*:\\s*\\[`);
  const m = re.exec(body);
  if (!m) return [];
  const out: unknown[] = [];
  let i = m.index + m[0].length; // '[' 바로 뒤
  while (i < body.length) {
    const ch = body[i];
    if (ch === "]") break; // 배열이 닫힘
    if (ch === "{") {
      const obj = scanBalancedObject(body, i);
      if (!obj) break; // 마지막 객체가 아직 미완 → 중단
      try {
        out.push(JSON.parse(obj.text));
      } catch {
        /* 형식 안 맞는 객체는 건너뜀 */
      }
      i = obj.end + 1;
      continue;
    }
    i++;
  }
  return out;
}

// start('{')부터 문자열/이스케이프/중괄호 깊이를 추적해 균형 잡힌 객체를 잘라낸다. 안 닫혔으면 null.
function scanBalancedObject(body: string, start: number): { text: string; end: number } | null {
  let depth = 0;
  let inStr = false;
  for (let i = start; i < body.length; i++) {
    const ch = body[i];
    if (inStr) {
      if (ch === "\\") {
        i++;
        continue;
      }
      if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') {
      inStr = true;
    } else if (ch === "{") {
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0) return { text: body.slice(start, i + 1), end: i };
    }
  }
  return null; // 안 닫힘
}

// 이어서 분석 결과 병합: 이전 부분 결과(prev) + 이번에 새로 받은 것(next).
// terms는 term 텍스트로 중복 제거(이전 것 우선·순서 유지), concepts는 next의 id를
// 프리픽스해 prev와 충돌 방지(+ next.terms.conceptIds도 같이 갱신), title 중복은 drop.
// summary/title은 prev에 있으면 prev 우선(이어서는 새로 안 만듦). usage 합산.
export function mergeTextResults(
  prev: AgentAnalyzeResponse,
  next: AgentAnalyzeResponse,
): AgentAnalyzeResponse {
  const prevTermTexts = new Set((prev.terms ?? []).map((t) => t.term));
  const prevTitleToId = new Map((prev.itConcepts ?? []).map((c) => [c.title, c.conceptId]));
  // 이미 쓰인 conceptId 전체 — 새 id가 이것과 안 겹치게(다중 resume 포함).
  const usedIds = new Set((prev.itConcepts ?? []).map((c) => c.conceptId));

  // next의 conceptId를 안전한 새 id로 재매핑. title이 prev에 이미 있으면 그 개념은
  // 버리되 참조를 prev의 기존 id로 redirect(끊긴 링크 방지). 아니면 충돌 없는 새 id 부여.
  const remap = new Map<string, string>();
  const newConcepts: ItConcept[] = [];
  for (const c of next.itConcepts ?? []) {
    const existing = prevTitleToId.get(c.title);
    if (existing != null) {
      remap.set(c.conceptId, existing); // 같은 개념 → 기존 것으로 연결
      continue;
    }
    let nid = `r-${c.conceptId}`;
    while (usedIds.has(nid)) nid = `_${nid}`; // 충돌 시 유니크해질 때까지(다중 resume 안전)
    usedIds.add(nid);
    remap.set(c.conceptId, nid);
    newConcepts.push({ ...c, conceptId: nid });
  }

  const newTerms = (next.terms ?? [])
    .filter((t) => !prevTermTexts.has(t.term)) // 이미 한 용어는 제외
    .map((t) => ({
      ...t,
      conceptIds: (t.conceptIds ?? []).map((id) => remap.get(id) ?? id),
    }));

  // prev 요약이 실제 요약이면 그대로(이어서는 새로 안 만듦). sentinel/빈 거면 next로.
  const prevSummary = prev.summary && prev.summary !== "요약을 생성하지 못했다." ? prev.summary : "";

  return {
    ...prev,
    terms: [...(prev.terms ?? []), ...newTerms],
    itConcepts: [...(prev.itConcepts ?? []), ...newConcepts],
    summary: prevSummary || next.summary || "",
    title: prev.title || next.title,
    usage: sumTextUsage(prev.usage, next.usage),
    warnings: [],
    createdAt: prev.createdAt, // 같은 항목 갱신(클라 reset effect thrash 방지).
  };
}

function sumTextUsage(a?: AgentUsage, b?: AgentUsage): AgentUsage | undefined {
  if (!a && !b) return undefined;
  const sum = (x?: number, y?: number) =>
    x == null && y == null ? undefined : (x ?? 0) + (y ?? 0);
  return {
    inputTokens: sum(a?.inputTokens, b?.inputTokens),
    outputTokens: sum(a?.outputTokens, b?.outputTokens),
    estimatedCostUsd:
      a?.estimatedCostUsd != null || b?.estimatedCostUsd != null
        ? (a?.estimatedCostUsd ?? 0) + (b?.estimatedCostUsd ?? 0)
        : undefined,
  };
}

// 프로바이더 출력(rawText)을 글 모드 AgentAnalyzeResponse로 정규화한다.
export function normalizeTextOutput(
  rawText: string,
  providerId: AgentProviderKind,
  request: AgentAnalyzeRequest,
  usage?: AgentUsage,
): AgentAnalyzeResponse {
  const parsed = parseTextPayload(rawText);

  if (!parsed) {
    return textModeResponse(
      providerId,
      "AI가 돌려준 응답을 글 분석 형식으로 해석하지 못했다. 다시 시도해 보라.",
      [
        {
          code: "PARSE_FAILED",
          message: "Text-mode output could not be normalized into the expected JSON schema.",
        },
      ],
      usage,
      rawText,
    );
  }

  const itConcepts = dedupeByConceptId(
    (Array.isArray(parsed.concepts) ? parsed.concepts : []).filter(isItConcept),
  );
  // 실제 생성된 개념 id 집합 — 용어의 conceptIds에서 헛 참조(dangling)·중복을 걸러
  // "관련 개념 N개" 표시 = 실제 강조될 카드 수가 되게 한다(모델이 안 만든 id 참조 제거).
  const conceptIdSet = new Set(itConcepts.map((c) => c.conceptId));
  const terms = dedupeById(
    (Array.isArray(parsed.terms) ? parsed.terms : []).filter(isItTerm),
  ).map((t) => ({
    // IT 용어는 전부 북마크 가능(모델 재량 무시). conceptIds는 중복 제거 + 존재하는 개념만.
    ...t,
    conceptIds: [...new Set(t.conceptIds ?? [])].filter((id) => conceptIdSet.has(id)),
    bookmarkable: true,
  }));

  return {
    providerId,
    mode: "text",
    language: "text",
    title: typeof parsed.title === "string" && parsed.title.trim() ? parsed.title.trim() : undefined,
    summary: parsed.summary ?? "요약을 생성하지 못했다.",
    lineExplanations: [],
    tokens: [],
    concepts: [],
    terms,
    itConcepts,
    warnings: Array.isArray(parsed.warnings) ? parsed.warnings.filter(isWarning) : [],
    usage,
    rawText,
    createdAt: new Date().toISOString(),
  };
}

// 글 모드 실패/안내용 응답(파싱 실패, 런타임 미탐지, 에러 등).
export function textModeResponse(
  providerId: AgentProviderKind,
  summary: string,
  warnings: TranslateWarning[],
  usage?: AgentUsage,
  rawText?: string,
): AgentAnalyzeResponse {
  return {
    providerId,
    mode: "text",
    language: "text",
    summary,
    lineExplanations: [],
    tokens: [],
    concepts: [],
    terms: [],
    itConcepts: [],
    warnings,
    usage,
    rawText,
    createdAt: new Date().toISOString(),
  };
}

interface TextNormalizedPayload {
  summary?: string;
  title?: string;
  terms?: unknown[];
  concepts?: unknown[];
  warnings?: TranslateWarning[];
}

function parseTextPayload(rawText: string): TextNormalizedPayload | null {
  const candidate = extractJsonCandidate(rawText);
  if (!candidate) return null;
  try {
    const parsed = JSON.parse(candidate);
    if (!isTextNormalizedPayload(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function extractJsonCandidate(rawText: string): string | null {
  const blockMatch = rawText.match(JSON_CODE_BLOCK_PATTERN);
  if (blockMatch?.[1]) return blockMatch[1].trim();
  const trimmed = rawText.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) return trimmed;
  return null;
}

function isTextNormalizedPayload(value: unknown): value is TextNormalizedPayload {
  if (!isRecord(value)) return false;
  if (value.summary !== undefined && typeof value.summary !== "string") return false;
  // terms/concepts는 배열 여부만 느슨히 검사하고, 요소 검증은 filter로 처리한다
  // (한 항목이 어긋나도 요약·나머지 항목을 잃지 않게).
  if (value.terms !== undefined && !Array.isArray(value.terms)) return false;
  if (value.concepts !== undefined && !Array.isArray(value.concepts)) return false;
  // warnings도 배열 여부만 느슨히 검사하고, 요소 검증은 normalize의 filter로 처리한다
  // (형식 안 맞는 warning 하나로 요약·용어를 통째로 잃지 않게).
  if (value.warnings !== undefined && !Array.isArray(value.warnings)) return false;
  return true;
}

function isItTerm(value: unknown): value is ItTerm {
  if (!isRecord(value)) return false;
  // id/term/explanation만 필수. conceptIds/bookmarkable은 normalize에서 기본값/강제하므로
  // 누락돼도 드랍하지 않는다(있으면 타입만 확인).
  return (
    typeof value.id === "string" &&
    typeof value.term === "string" &&
    typeof value.explanation === "string" &&
    (value.reading === undefined || typeof value.reading === "string") &&
    (value.conceptIds === undefined ||
      (Array.isArray(value.conceptIds) && value.conceptIds.every((id) => typeof id === "string")))
  );
}

function isItConcept(value: unknown): value is ItConcept {
  if (!isRecord(value)) return false;
  return (
    typeof value.conceptId === "string" &&
    typeof value.title === "string" &&
    typeof value.explanation === "string"
  );
}

function dedupeById(terms: ItTerm[]): ItTerm[] {
  const seen = new Set<string>();
  return terms.filter((t) => (seen.has(t.id) ? false : (seen.add(t.id), true)));
}

function dedupeByConceptId(concepts: ItConcept[]): ItConcept[] {
  const seen = new Set<string>();
  return concepts.filter((c) =>
    seen.has(c.conceptId) ? false : (seen.add(c.conceptId), true),
  );
}


function isWarning(value: unknown): value is TranslateWarning {
  if (!isRecord(value)) return false;
  return isWarningCode(value.code) && typeof value.message === "string";
}

function isWarningCode(value: unknown): value is TranslateWarning["code"] {
  return (
    value === "TOO_LONG" ||
    value === "PARSE_FAILED" ||
    value === "PARTIAL_PARSE" ||
    value === "UNKNOWN_LANGUAGE"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
