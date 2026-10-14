import type { AgentAnalyzeRequest, AgentAnalyzeResponse, AgentUsage } from "@mustard/core";
import type { AgentProviderKind } from "@mustard/core";
import { outputLanguageDirective, languageName } from "./outputLanguage";
import { coerceModelTokens, dedupeConcepts, dedupeTokens } from "./dedupe";
import { codeChunkDirectives } from "./codeChunkPrompt";
import type { ConceptOccurrence, TranslateWarning } from "@mustard/core";

// 코드 모드 프롬프트 빌더 + LLM 출력 정규화. 런타임(spawn) 무관한 순수 도메인 로직이라
// 임베드 런타임 provider(snaAgentProvider)가 그대로 재사용한다.

const JSON_CODE_BLOCK_PATTERN = /```json\s*([\s\S]*?)```/i;

// 런타임 도달성 메시지를 담는 형태(정규화 함수의 cosmetic 메시지에만 쓰임).
export interface ClaudeAvailabilityResult {
  available: boolean;
  commandPath?: string;
  message: string;
}

interface ClaudeNormalizedPayload {
  summary?: string;
  title?: string;
  language?: string;
  lineExplanations?: AgentAnalyzeResponse["lineExplanations"];
  tokens?: unknown[];
  concepts?: unknown[];
  warnings?: TranslateWarning[];
}

export function buildClaudePrompt(request: AgentAnalyzeRequest): string {
  return [
    "You are Nunopi's code analysis provider.",
    `Explain unfamiliar code for a beginner in ${languageName(request.locale)}.`,
    "Return JSON only.",
    "",
    "Output JSON shape:",
    "{",
    `  "title": "string (a short ${languageName(request.locale)} noun-phrase title capturing the core of this code. No sentence/period, 6-24 chars, specific. e.g. \\"유저 역할별 그룹화 유틸\\" in Korean)",`,
    '  "summary": "string",',
    '  "language": "string",',
    '  "lineExplanations": [',
    "    {",
    '      "line": number,',
    '      "code": "string",',
    '      "explanation": "string (markdown: plain-language summary + a per-part bullet breakdown, beginner-friendly)",',
    '      "conceptIds": string[]',
    "    }",
    "  ],",
    '  "concepts": [',
    `    { "conceptId": "string", "title": "string (${languageName(request.locale)})" }`,
    "  ],",
    '  "tokens": [',
    '    { "token": "string", "category": "string", "lines": number[] }',
    "  ],",
    '  "warnings": [{ "code": "PARTIAL_PARSE | UNKNOWN_LANGUAGE | PARSE_FAILED | TOO_LONG", "message": "string" }]',
    "}",
    "",
    "Per lineExplanations entry output only line/code/explanation/conceptIds (no per-line tokens array). The top-level `tokens` array holds universal reusable tokens for the whole code, per the token instructions below.",
    ...codeChunkDirectives(request),
    "Only include a PARTIAL_PARSE warning if input was truncated; otherwise empty warnings.",
    "",
    outputLanguageDirective(request.locale),
    `Locale: ${request.locale}`,
    `Requested provider: ${request.providerId}`,
    `Detected language: ${request.detectedLanguage ?? "unknown"}`,
    `User intent: ${request.userIntent ?? `Explain the code in beginner-friendly ${languageName(request.locale)}.`}`,
    "",
    "Code to analyze:",
    "```",
    request.code,
    "```",
  ].join("\n");
}

export function normalizeClaudeOutput(
  rawText: string,
  request: AgentAnalyzeRequest,
  availability: ClaudeAvailabilityResult,
  prompt: string,
  usage?: AgentUsage,
  providerId: AgentProviderKind = "claude-agent",
): AgentAnalyzeResponse {
  const parsed = parseClaudePayload(rawText);

  if (!parsed) {
    return {
      providerId,
      language: request.detectedLanguage ?? "unknown",
      summary: `Claude runtime detected at ${availability.commandPath}, but the returned payload did not match Nunopi's expected JSON schema.`,
      lineExplanations: [],
      tokens: [],
      concepts: [],
      warnings: [
        {
          code: "PARSE_FAILED",
          message:
            "Claude output could not be normalized into AgentAnalyzeResponse. Check the prompt contract or raw payload shape.",
        },
      ],
      rawText: `${prompt}\n\n--- RAW RESPONSE ---\n${rawText}`,
      createdAt: new Date().toISOString(),
    };
  }

  return {
    providerId,
    mode: "code",
    language: parsed.language ?? request.detectedLanguage ?? "unknown",
    title: typeof parsed.title === "string" && parsed.title.trim() ? parsed.title.trim() : undefined,
    summary:
      parsed.summary ??
      `Claude runtime detected at ${availability.commandPath}, and a normalized Claude payload was returned.`,
    lineExplanations: Array.isArray(parsed.lineExplanations)
      ? parsed.lineExplanations.filter(isLineExplanation)
      : [],
    tokens: dedupeTokens(coerceModelTokens(parsed.tokens)),
    concepts: dedupeConcepts(
      Array.isArray(parsed.concepts) ? parsed.concepts.filter(isConceptOccurrence) : [],
    ),
    warnings: Array.isArray(parsed.warnings) ? parsed.warnings.filter(isWarning) : [],
    usage,
    rawText,
    createdAt: new Date().toISOString(),
  };
}

function parseClaudePayload(rawText: string): ClaudeNormalizedPayload | null {
  const jsonCandidate = extractJsonCandidate(rawText);
  if (!jsonCandidate) return null;
  try {
    const parsed = JSON.parse(jsonCandidate);
    if (!isClaudeNormalizedPayload(parsed)) return null;
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

function isClaudeNormalizedPayload(value: unknown): value is ClaudeNormalizedPayload {
  if (!isRecord(value)) return false;
  if (value.summary !== undefined && typeof value.summary !== "string") return false;
  if (value.language !== undefined && typeof value.language !== "string") return false;
  // 배열 여부만 느슨히 검사하고, 요소 검증은 normalize의 filter로 처리한다
  // (요소 하나가 어긋나도 요약·나머지를 통째로 잃지 않게).
  if (value.lineExplanations !== undefined && !Array.isArray(value.lineExplanations)) return false;
  if (value.tokens !== undefined && !Array.isArray(value.tokens)) return false;
  if (value.concepts !== undefined && !Array.isArray(value.concepts)) return false;
  if (value.warnings !== undefined && !Array.isArray(value.warnings)) return false;
  return true;
}

function isConceptOccurrence(value: unknown): value is ConceptOccurrence {
  if (!isRecord(value)) return false;
  // lines/count는 optional(LLM outline은 안 보냄). conceptId/title만 필수.
  return (
    typeof value.conceptId === "string" &&
    typeof value.title === "string" &&
    (value.lines === undefined ||
      (Array.isArray(value.lines) && value.lines.every((line) => typeof line === "number"))) &&
    (value.count === undefined || typeof value.count === "number")
  );
}

function isLineExplanation(value: unknown): value is AgentAnalyzeResponse["lineExplanations"][number] {
  if (!isRecord(value)) return false;
  const stringArrayOrUndefined = (v: unknown) =>
    v === undefined || (Array.isArray(v) && v.every((item) => typeof item === "string"));
  return (
    typeof value.line === "number" &&
    typeof value.code === "string" &&
    typeof value.explanation === "string" &&
    stringArrayOrUndefined(value.tokens) &&
    stringArrayOrUndefined(value.tokenIds) &&
    Array.isArray(value.conceptIds) &&
    value.conceptIds.every((item) => typeof item === "string") &&
    (value.confidence === undefined || typeof value.confidence === "number")
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
