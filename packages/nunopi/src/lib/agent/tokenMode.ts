// lazy 토큰 사전 — 줄별 설명의 토큰 태그를 클릭하면 그 토큰 1개만 on-demand로 설명한다.
// 초기 분석에서 토큰 사전을 통째로 만들지 않아 출력/비용을 크게 줄인다.
// 프로바이더는 실행 방식만 다르고 프롬프트/파싱은 같으므로 여기서 공용화한다.
import type { AgentAnalyzeRequest, AgentAnalyzeResponse } from "@mustard/core";
import type { AgentProviderKind } from "@mustard/core";
import type { CodeToken, TranslateWarning } from "@mustard/core";
import { outputLanguageDirective, languageName } from "./outputLanguage";
import { translate } from "@mustard/core/messages";

const JSON_CODE_BLOCK_PATTERN = /```json\s*([\s\S]*?)```/i;

// 코드 맥락에서 토큰 1개만 초보자용으로 설명하라는 프롬프트(JSON only).
export function buildExplainTokenPrompt(request: AgentAnalyzeRequest): string {
  const target = request.targetToken ?? "";
  return [
    "You are Nunopi's single-token explainer for beginners.",
    `Explain ONE token as it is used in the given code, in ${languageName(request.locale)}, for someone new to coding.`,
    "Return JSON only (one token object).",
    "",
    "Output JSON shape:",
    "{",
    '  "token": "string (the token text, echo it back)",',
    '  "category": "react_hook | state_variable | state_setter | prop | function | event_handler | jsx_element | operator | keyword | punctuation | api_call | dependency_array | initial_value | css_selector | css_property | css_value | tailwind_utility | tailwind_layout | tailwind_spacing | tailwind_color | tailwind_responsive | tailwind_state",',
    `  "label": "string (short ${languageName(request.locale)} name)",`,
    `  "description": "string (beginner-friendly ${languageName(request.locale)} explanation, 1-3 sentences)",`,
    '  "example": "string (optional tiny usage example)"',
    "}",
    "",
    outputLanguageDirective(request.locale),
    `Locale: ${request.locale}`,
    `Detected language: ${request.detectedLanguage ?? "unknown"}`,
    `Token to explain: ${JSON.stringify(target)}`,
    "",
    "Code context:",
    "```",
    request.code,
    "```",
  ].join("\n");
}

// 프로바이더 출력(rawText)을 토큰 1개를 담은 AgentAnalyzeResponse로 정규화한다.
export function normalizeExplainTokenOutput(
  rawText: string,
  providerId: AgentProviderKind,
  request: AgentAnalyzeRequest,
): AgentAnalyzeResponse {
  const parsed = parseTokenPayload(rawText);
  const target = request.targetToken ?? "";

  if (!parsed) {
    return tokenModeResponse(providerId, [], [
      { code: "PARSE_FAILED", message: translate(request.locale, "explain.tokenParseFailed", { target }) },
    ]);
  }

  const token: CodeToken = {
    id: target || parsed.token || "token",
    token: parsed.token || target,
    category: (parsed.category as CodeToken["category"]) ?? "keyword",
    label: parsed.label ?? translate(request.locale, "token.defaultLabel"),
    description: parsed.description ?? "",
    example: parsed.example,
    lines: [],
    bookmarkable: true,
  };
  return tokenModeResponse(providerId, [token], []);
}

// explain-token 응답(토큰 0~1개) 래퍼.
export function tokenModeResponse(
  providerId: AgentProviderKind,
  tokens: CodeToken[],
  warnings: TranslateWarning[],
): AgentAnalyzeResponse {
  return {
    providerId,
    mode: "explain-token",
    language: "code",
    summary: "",
    lineExplanations: [],
    tokens,
    concepts: [],
    warnings,
    createdAt: new Date().toISOString(),
  };
}

interface TokenPayload {
  token?: string;
  category?: string;
  label?: string;
  description?: string;
  example?: string;
}

function parseTokenPayload(rawText: string): TokenPayload | null {
  const candidate = extractJsonCandidate(rawText);
  if (!candidate) return null;
  try {
    const parsed = JSON.parse(candidate);
    if (!isRecord(parsed)) return null;
    if (typeof parsed.description !== "string" && typeof parsed.token !== "string") return null;
    return parsed as TokenPayload;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
