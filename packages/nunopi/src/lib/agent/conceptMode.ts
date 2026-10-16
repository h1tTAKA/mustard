// lazy 개념 설명 — 개념 카드를 클릭하면 그 개념 1개만 코드 맥락에서 on-demand로 설명한다.
// 토큰(tokenMode)과 같은 패턴. 프로바이더는 실행만 다르고 프롬프트/파싱은 공용.
import type { AgentAnalyzeRequest, AgentAnalyzeResponse } from "@mustard/core";
import type { AgentProviderKind } from "@mustard/core";
import type { ConceptOccurrence, TranslateWarning } from "@mustard/core";
import { outputLanguageDirective, languageName } from "./outputLanguage";
import { translate } from "@mustard/core/messages";

const JSON_CODE_BLOCK_PATTERN = /```json\s*([\s\S]*?)```/i;

// 코드 맥락에서 개념 1개만 초보자용으로 설명하라는 프롬프트(JSON only).
export function buildExplainConceptPrompt(request: AgentAnalyzeRequest): string {
  const target = request.targetConcept ?? "";
  return [
    "You are Nunopi's single-concept explainer for beginners.",
    `Explain ONE programming concept as it is used in the given code, in ${languageName(request.locale)}, for someone new to coding.`,
    "Return JSON only.",
    "",
    "Output JSON shape:",
    "{",
    `  "description": "string (beginner-friendly ${languageName(request.locale)} explanation of the concept as used here, 1-3 sentences)"`,
    "}",
    "",
    outputLanguageDirective(request.locale),
    `Locale: ${request.locale}`,
    `Detected language: ${request.detectedLanguage ?? "unknown"}`,
    `Concept to explain: ${JSON.stringify(target)}`,
    "",
    "Code context:",
    "```",
    request.code,
    "```",
  ].join("\n");
}

// 프로바이더 출력을 개념 1개(description 포함)를 담은 AgentAnalyzeResponse로 정규화.
export function normalizeExplainConceptOutput(
  rawText: string,
  providerId: AgentProviderKind,
  request: AgentAnalyzeRequest,
): AgentAnalyzeResponse {
  const description = parseDescription(rawText);
  const target = request.targetConcept ?? "";

  if (!description) {
    return conceptModeResponse(providerId, [], [
      { code: "PARSE_FAILED", message: translate(request.locale, "explain.conceptParseFailed", { target }) },
    ]);
  }

  const concept: ConceptOccurrence = {
    conceptId: target,
    title: target,
    lines: [],
    count: 0,
    description,
  };
  return conceptModeResponse(providerId, [concept], []);
}

// explain-concept 응답(개념 0~1개) 래퍼.
export function conceptModeResponse(
  providerId: AgentProviderKind,
  concepts: ConceptOccurrence[],
  warnings: TranslateWarning[],
): AgentAnalyzeResponse {
  return {
    providerId,
    mode: "explain-concept",
    language: "code",
    summary: "",
    lineExplanations: [],
    tokens: [],
    concepts,
    warnings,
    createdAt: new Date().toISOString(),
  };
}

function parseDescription(rawText: string): string | null {
  const candidate = extractJsonCandidate(rawText);
  if (!candidate) return null;
  try {
    const parsed = JSON.parse(candidate);
    if (parsed && typeof parsed === "object" && typeof (parsed as { description?: unknown }).description === "string") {
      return (parsed as { description: string }).description;
    }
    return null;
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
