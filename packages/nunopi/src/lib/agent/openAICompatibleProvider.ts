import type { AgentAnalyzeRequest, AgentAnalyzeResponse, AgentUsage } from "@mustard/core";
import type { AgentAnalyzeCallOptions, AgentProvider } from "@mustard/core";
import type { ConceptOccurrence, TranslateWarning } from "@mustard/core";
import { outputLanguageDirective, languageName } from "./outputLanguage";
import { buildCardExplainPrompt } from "./cardExplainMode";
import { coerceModelTokens, dedupeConcepts, dedupeTokens } from "./dedupe";
import { buildTextPrompt, normalizeTextOutput, textModeResponse } from "./textMode";
import { buildExplainTokenPrompt, normalizeExplainTokenOutput, tokenModeResponse } from "./tokenMode";
import { buildExplainConceptPrompt, normalizeExplainConceptOutput, conceptModeResponse } from "./conceptMode";
import { chatSystemPrompt, buildChatPrompt, normalizeChatOutput, chatModeResponse, deckAgentSystemPrompt, buildDeckAgentPrompt } from "./chatMode";
import { codeChunkDirectives } from "./codeChunkPrompt";
import { translate } from "@mustard/core/messages";

interface OpenAICompatibleConfig {
  baseUrl: string;
  model: string;
  apiKey?: string;
}

interface OpenAICompatibleMessage {
  role: "system" | "user";
  content: string;
}

interface OpenAICompatibleRequestBody {
  model: string;
  messages: OpenAICompatibleMessage[];
  temperature: number;
  stream: boolean;
  stream_options: { include_usage: boolean };
}

interface OpenAIStreamChunk {
  // reasoning_content: 추론 모델(o-series/deepseek 등)이 답변과 별도로 흘리는 사고 델타.
  choices?: Array<{ delta?: { content?: string; reasoning_content?: string } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

interface OpenAICompatibleNormalizedPayload {
  summary?: string;
  title?: string;
  language?: string;
  lineExplanations?: AgentAnalyzeResponse["lineExplanations"];
  tokens?: unknown[];
  concepts?: unknown[];
  warnings?: TranslateWarning[];
}

interface OpenAICompatibleChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string | Array<{ type?: string; text?: string }>;
    };
  }>;
}

export const openAICompatibleProvider: AgentProvider = {
  metadata: {
    id: "openai-compatible",
    label: "Local LLM",
    description:
      "Provider scaffold for OpenAI-style local or remote LLM endpoints such as Ollama gateways, vLLM, LiteLLM, or Hermes servers.",
    executionLocation: "local-server",
    dataHandling: "user-configured-endpoint",
    capabilities: {
      streaming: false,
      cancellation: false,
      fileSystemAccess: false,
      shellAccess: false,
      requiresApiKey: false,
      requiresLocalProcess: false,
    },
  },
  async analyze(
    request: AgentAnalyzeRequest,
    options?: AgentAnalyzeCallOptions,
  ): Promise<AgentAnalyzeResponse> {
    const config = resolveOpenAICompatibleConfig(request);
    const requestBody = buildOpenAICompatibleRequestBody(request, config);
    const mockResponse = process.env.NUNOPI_OPENAI_COMPAT_MOCK_RESPONSE?.trim();

    if (mockResponse) {
      return normalizeOpenAICompatibleResponse(mockResponse, request, config, requestBody);
    }

    return fetchOpenAICompatibleResponse(
      request,
      config,
      requestBody,
      options?.signal,
      options?.onProgress,
      options?.onThinking,
    );
  },
};

function normalizeOpenAICompatibleResponse(
  rawResponse: string,
  request: AgentAnalyzeRequest,
  config: OpenAICompatibleConfig,
  requestBody: OpenAICompatibleRequestBody,
  usage?: AgentUsage,
): AgentAnalyzeResponse {
  const content = extractOpenAICompatibleContent(rawResponse) ?? rawResponse;

  // 챗은 자유 텍스트, 글 모드는 텍스트 정규화, explain-token/concept는 각 1개.
  // 중복묶기(dedup-cards)·덱에이전트(deck-agent)도 자유 텍스트(블록 포함)를 그대로 담아 클라가 파싱.
  if (request.mode === "chat" || request.mode === "explain-card" || request.mode === "dedup-cards" || request.mode === "deck-agent" || request.mode === "quiz") {
    return normalizeChatOutput(content, "openai-compatible");
  }
  if (request.mode === "explain-concept") {
    return normalizeExplainConceptOutput(content, "openai-compatible", request);
  }
  if (request.mode === "explain-token") {
    return normalizeExplainTokenOutput(content, "openai-compatible", request);
  }
  if (request.mode === "text") {
    return normalizeTextOutput(content, "openai-compatible", request, usage);
  }

  const parsed = parseOpenAICompatiblePayload(content);

  if (!parsed) {
    return {
      providerId: "openai-compatible",
      language: request.detectedLanguage ?? "unknown",
      summary:
        `OpenAI-compatible endpoint for ${config.model} at ${config.baseUrl} returned a payload that Nunopi could not normalize.`,
      lineExplanations: [],
      tokens: [],
      concepts: [],
      warnings: [
        {
          code: "PARSE_FAILED",
          message:
            "OpenAI-compatible output could not be normalized into AgentAnalyzeResponse. Check the response content or JSON contract.",
        },
      ],
      rawText: JSON.stringify(
        {
          request: requestBody,
          rawResponse,
        },
        null,
        2,
      ),
      createdAt: new Date().toISOString(),
    };
  }

  return {
    providerId: "openai-compatible",
    mode: "code",
    language: parsed.language ?? request.detectedLanguage ?? "unknown",
    title: typeof parsed.title === "string" && parsed.title.trim() ? parsed.title.trim() : undefined,
    summary:
      parsed.summary ??
      `OpenAI-compatible endpoint for ${config.model} at ${config.baseUrl} returned a normalized payload.`,
    lineExplanations: Array.isArray(parsed.lineExplanations)
      ? parsed.lineExplanations.filter(isLineExplanation)
      : [],
    tokens: dedupeTokens(coerceModelTokens(parsed.tokens)),
    concepts: dedupeConcepts(
      Array.isArray(parsed.concepts) ? parsed.concepts.filter(isConceptOccurrence) : [],
    ),
    warnings: Array.isArray(parsed.warnings) ? parsed.warnings.filter(isWarning) : [],
    usage,
    rawText: rawResponse,
    createdAt: new Date().toISOString(),
  };
}

function resolveOpenAICompatibleConfig(request: AgentAnalyzeRequest): OpenAICompatibleConfig {
  const userSettings = request.providerSettings?.["openai-compatible"];
  return {
    baseUrl: normalizeBaseUrl(
      userSettings?.baseUrl?.trim() ||
      process.env.NUNOPI_OPENAI_COMPAT_BASE_URL?.trim() ||
      "http://localhost:11434/v1",
    ),
    model:
      userSettings?.model?.trim() ||
      process.env.NUNOPI_OPENAI_COMPAT_MODEL?.trim() ||
      "hermes-3",
    apiKey:
      userSettings?.apiKey?.trim() ||
      process.env.NUNOPI_OPENAI_COMPAT_API_KEY?.trim() ||
      undefined,
  };
}

async function fetchOpenAICompatibleResponse(
  request: AgentAnalyzeRequest,
  config: OpenAICompatibleConfig,
  requestBody: OpenAICompatibleRequestBody,
  signal?: AbortSignal,
  onProgress?: (line: string) => void,
  onThinking?: (line: string) => void,
): Promise<AgentAnalyzeResponse> {
  const endpoint = `${config.baseUrl}/chat/completions`;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (config.apiKey) headers["Authorization"] = `Bearer ${config.apiKey}`;

  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(requestBody),
      signal,
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      const httpMsg = `HTTP ${res.status} ${res.statusText}: ${errText.slice(0, 200)}`;
      if (request.mode === "chat" || request.mode === "explain-card" || request.mode === "dedup-cards" || request.mode === "deck-agent" || request.mode === "quiz") {
        return chatModeResponse("openai-compatible", translate(request.locale, "provider.httpError", { status: res.status }), [{ code: "PARSE_FAILED", message: httpMsg }]);
      }
      if (request.mode === "explain-concept") {
        return conceptModeResponse("openai-compatible", [], [{ code: "PARSE_FAILED", message: httpMsg }]);
      }
      if (request.mode === "explain-token") {
        return tokenModeResponse("openai-compatible", [], [{ code: "PARSE_FAILED", message: httpMsg }]);
      }
      if (request.mode === "text") {
        return textModeResponse(
          "openai-compatible",
          `OpenAI-compatible endpoint at ${endpoint} returned HTTP ${res.status}.`,
          [{ code: "PARSE_FAILED", message: httpMsg }],
          undefined,
          errText,
        );
      }
      return {
        providerId: "openai-compatible",
        language: request.detectedLanguage ?? "unknown",
        summary: `OpenAI-compatible endpoint at ${endpoint} returned HTTP ${res.status}.`,
        lineExplanations: [],
        tokens: [],
        concepts: [],
        warnings: [{ code: "PARSE_FAILED", message: httpMsg }],
        rawText: errText,
        createdAt: new Date().toISOString(),
      };
    }

    // SSE 스트림 파싱 — data: {json} 라인마다 delta.content를 누적하고 흘린다.
    let content = "";
    let reasoning = ""; // 추론(reasoning_content) 누적 — 대기 활동 표시용
    let rawAll = ""; // 전체 본문 — stream:true를 무시한 엔드포인트 폴백용
    let usage: AgentUsage | undefined;
    if (res.body) {
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const text = decoder.decode(value, { stream: true });
        rawAll += text;
        buf += text;
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) continue;
          const data = trimmed.slice(5).trim();
          if (data === "[DONE]") continue;
          let chunk: OpenAIStreamChunk;
          try {
            chunk = JSON.parse(data) as OpenAIStreamChunk;
          } catch {
            continue;
          }
          const delta = chunk.choices?.[0]?.delta?.content;
          if (typeof delta === "string" && delta) {
            content += delta;
            // 챗·덱에이전트는 전체 누적(실시간 타이핑), 그 외는 진행 라벨용 끝 200자.
            onProgress?.(request.mode === "chat" || request.mode === "deck-agent" ? content : content.slice(-200));
          }
          const rdelta = chunk.choices?.[0]?.delta?.reasoning_content;
          if (typeof rdelta === "string" && rdelta) {
            reasoning += rdelta;
            onThinking?.(reasoning);
          }
          if (chunk.usage) {
            usage = {
              inputTokens: chunk.usage.prompt_tokens,
              outputTokens: chunk.usage.completion_tokens,
            };
          }
        }
      }
    } else {
      rawAll = await res.text();
    }

    // SSE delta가 하나도 없으면(엔드포인트가 stream:true 무시 → 일반 JSON 본문)
    // 전체 본문을 넘긴다. normalize가 chat-completion 형태에서 content를 추출한다.
    return normalizeOpenAICompatibleResponse(
      content || rawAll,
      request,
      config,
      requestBody,
      usage,
    );
  } catch (err) {
    // 사용자 취소는 route로 전파(499 처리).
    if (signal?.aborted) throw err;
    const netMsg = err instanceof Error ? err.message : "Network error.";
    if (request.mode === "chat" || request.mode === "explain-card" || request.mode === "dedup-cards" || request.mode === "deck-agent" || request.mode === "quiz") {
      return chatModeResponse("openai-compatible", translate(request.locale, "provider.connectFailed"), [{ code: "PARSE_FAILED", message: netMsg }]);
    }
    if (request.mode === "explain-concept") {
      return conceptModeResponse("openai-compatible", [], [{ code: "PARSE_FAILED", message: netMsg }]);
    }
    if (request.mode === "explain-token") {
      return tokenModeResponse("openai-compatible", [], [{ code: "PARSE_FAILED", message: netMsg }]);
    }
    if (request.mode === "text") {
      return textModeResponse(
        "openai-compatible",
        `Failed to reach OpenAI-compatible endpoint at ${endpoint}.`,
        [{ code: "PARSE_FAILED", message: netMsg }],
      );
    }
    return {
      providerId: "openai-compatible",
      language: request.detectedLanguage ?? "unknown",
      summary: `Failed to reach OpenAI-compatible endpoint at ${endpoint}.`,
      lineExplanations: [],
      tokens: [],
      concepts: [],
      warnings: [{ code: "PARSE_FAILED", message: netMsg }],
      createdAt: new Date().toISOString(),
    };
  }
}

function buildOpenAICompatibleRequestBody(
  request: AgentAnalyzeRequest,
  config: OpenAICompatibleConfig,
): OpenAICompatibleRequestBody {
  return {
    model: config.model,
    messages: buildOpenAICompatibleMessages(request),
    temperature: 0.2,
    // 토큰을 실시간으로 받고(SSE), 마지막 청크에 usage를 포함시킨다.
    stream: true,
    stream_options: { include_usage: true },
  };
}

function buildOpenAICompatibleMessages(
  request: AgentAnalyzeRequest,
): OpenAICompatibleMessage[] {
  // 챗: 튜터 시스템 + 코드/대화 프롬프트.
  if (request.mode === "chat") {
    return [
      { role: "system", content: chatSystemPrompt(request.locale) },
      { role: "user", content: buildChatPrompt(request) },
    ];
  }
  // #1091 카드 디폴트 설명 — 없던 분기(코드 분석 프롬프트로 빠졌음). SNA와 같은 프롬프트, 자유 텍스트.
  if (request.mode === "explain-card") {
    return [
      { role: "system", content: chatSystemPrompt(request.locale) },
      { role: "user", content: buildCardExplainPrompt(request) },
    ];
  }
  // 중복묶기: 요청 code에 규칙+카드목록이 완성돼 있음. 블록만 내라는 경량 시스템.
  if (request.mode === "dedup-cards") {
    return [
      { role: "system", content: "You group duplicate flashcards. Output ONLY the requested ```card-dedup fenced block and nothing else." },
      { role: "user", content: request.code },
    ];
  }
  // 덱 에이전트: 대화형 + 필요 시 컨텍스트가 지정한 블록. nunopi-cards 없음.
  if (request.mode === "deck-agent") {
    return [
      { role: "system", content: deckAgentSystemPrompt(request.locale) },
      { role: "user", content: buildDeckAgentPrompt(request) },
    ];
  }
  // 퀴즈: 요청 code에 MODE(GENERATE/GRADE)·재료·규칙·출력언어가 완성돼 있음. 블록만 내라는 경량 시스템.
  if (request.mode === "quiz") {
    return [
      { role: "system", content: "You create and grade active-recall quizzes. Follow the MODE and output language in the user message. Output ONLY the requested ```json fenced block and nothing else." },
      { role: "user", content: request.code },
    ];
  }
  // explain-concept: 개념 1개 설명 프롬프트.
  if (request.mode === "explain-concept") {
    return [
      {
        role: "system",
        content: "You are Nunopi's single-concept explainer for beginners. Return JSON only.",
      },
      { role: "user", content: buildExplainConceptPrompt(request) },
    ];
  }
  // explain-token: 토큰 1개 설명 프롬프트.
  if (request.mode === "explain-token") {
    return [
      {
        role: "system",
        content: "You are Nunopi's single-token explainer for beginners. Return JSON only.",
      },
      { role: "user", content: buildExplainTokenPrompt(request) },
    ];
  }
  // 글 모드는 공용 텍스트 프롬프트를 user 메시지로 사용한다.
  if (request.mode === "text") {
    return [
      {
        role: "system",
        content: "You are Nunopi's IT-term explainer for absolute beginners. Return JSON only.",
      },
      { role: "user", content: buildTextPrompt(request) },
    ];
  }
  return [
    {
      role: "system",
      content: [
        "You are Nunopi's OpenAI-compatible analysis provider.",
        `Explain unfamiliar code for a beginner in ${languageName(request.locale)}.`,
        "Return JSON only.",
        "Expected JSON shape:",
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
        "Per lineExplanations entry output only line/code/explanation/conceptIds (no per-line tokens array). The top-level `tokens` array holds universal reusable tokens for the whole code, per the token instructions below.",
        ...codeChunkDirectives(request),
      ].join("\n"),
    },
    {
      role: "user",
      content: [
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
      ].join("\n"),
    },
  ];
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
}

function extractOpenAICompatibleContent(rawResponse: string): string | null {
  try {
    const parsed = JSON.parse(rawResponse) as OpenAICompatibleChatCompletionResponse;
    const firstContent = parsed.choices?.[0]?.message?.content;

    if (typeof firstContent === "string") {
      return firstContent;
    }

    if (Array.isArray(firstContent)) {
      return firstContent
        .map((item) => (item.type === "text" && typeof item.text === "string" ? item.text : ""))
        .filter(Boolean)
        .join("\n");
    }

    return null;
  } catch {
    return null;
  }
}

function parseOpenAICompatiblePayload(
  rawText: string,
): OpenAICompatibleNormalizedPayload | null {
  const jsonCandidate = extractJsonCandidate(rawText);

  if (!jsonCandidate) {
    return null;
  }

  try {
    const parsed = JSON.parse(jsonCandidate);

    if (!isOpenAICompatibleNormalizedPayload(parsed)) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

function extractJsonCandidate(rawText: string): string | null {
  const jsonBlockMatch = rawText.match(/```json\s*([\s\S]*?)```/i);

  if (jsonBlockMatch?.[1]) {
    return jsonBlockMatch[1].trim();
  }

  const trimmed = rawText.trim();

  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    return trimmed;
  }

  return null;
}

function isOpenAICompatibleNormalizedPayload(
  value: unknown,
): value is OpenAICompatibleNormalizedPayload {
  if (!isRecord(value)) {
    return false;
  }

  if (value.summary !== undefined && typeof value.summary !== "string") {
    return false;
  }

  if (value.language !== undefined && typeof value.language !== "string") {
    return false;
  }

  // lineExplanations도 배열 여부만 느슨히 검사하고, 요소 검증은 normalize의 filter로 처리한다
  // (줄설명 하나가 conceptIds 누락 등으로 어긋나도 요약·나머지 줄을 통째로 잃지 않게).
  if (value.lineExplanations !== undefined && !Array.isArray(value.lineExplanations)) {
    return false;
  }

  // tokens/concepts는 배열인지만 느슨히 검사하고, 요소 검증은 normalize의 filter에서.
  if (value.tokens !== undefined && !Array.isArray(value.tokens)) {
    return false;
  }

  if (value.concepts !== undefined && !Array.isArray(value.concepts)) {
    return false;
  }

  // warnings도 배열인지만 느슨히 검사하고, 요소 검증은 normalize의 filter로 처리한다
  // (형식 안 맞는 warning 하나로 요약·줄별 설명을 통째로 잃지 않게).
  if (value.warnings !== undefined && !Array.isArray(value.warnings)) {
    return false;
  }

  return true;
}


function isConceptOccurrence(value: unknown): value is ConceptOccurrence {
  if (!isRecord(value)) {
    return false;
  }

  // lines/count는 optional(LLM outline은 안 보냄). conceptId/title만 필수.
  return (
    typeof value.conceptId === "string" &&
    typeof value.title === "string" &&
    (value.lines === undefined ||
      (Array.isArray(value.lines) && value.lines.every((line) => typeof line === "number"))) &&
    (value.count === undefined || typeof value.count === "number")
  );
}


function isLineExplanation(
  value: unknown,
): value is AgentAnalyzeResponse["lineExplanations"][number] {
  if (!isRecord(value)) {
    return false;
  }

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
  if (!isRecord(value)) {
    return false;
  }

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
