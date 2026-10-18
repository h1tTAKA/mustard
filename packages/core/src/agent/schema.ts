import type {
  CodeToken,
  ConceptOccurrence,
  ItConcept,
  ItTerm,
  SupportedLanguage,
  TranslateResponse,
  TranslateWarning,
} from "../translator/types";
import type { AgentProviderKind } from "./types";

// 분석 모드 — "code"(기본, 코드 분석) | "text"(IT 용어 글 분석)
// | "explain-token"(토큰 1개) | "explain-concept"(개념 1개) | "chat"(코드에 대한 자유 질문)
// | "explain-card"(카드 기본 설명) | "dedup-cards"(카드 의미 중복 묶기 — 경량, 블록만 출력)
// | "deck-agent"(덱 생성/분류 — 대화형 경량: 저추론·nunopi-cards 없음)
// | "quiz"(Ask 아웃풋 퀴즈 — 생성+채점 겸용, 경량: 블록만 출력)
// | "pr-review"(#1127 PR 에이전트 리뷰 — 클라가 프롬프트 완성, 리뷰어 시스템프롬프트, JSON만, 추론 깊이 유지).
export type AnalyzeMode = "code" | "text" | "explain-token" | "explain-concept" | "chat" | "explain-card" | "dedup-cards" | "deck-agent" | "quiz" | "pr-review";

// 학습 챗 한 메시지.
export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ProviderSettings {
  "openai-compatible"?: {
    baseUrl?: string;
    model?: string;
    apiKey?: string;
  };
  // model(#987): SNA가 CLI --model로 그대로 전달. 미지정 = 어댑터 기본 모델.
  "claude-agent"?: {
    cliPath?: string;
    model?: string;
  };
  "codex-agent"?: {
    cliPath?: string;
    model?: string;
  };
  "opencode-agent"?: {
    cliPath?: string;
    model?: string;
  };
}

export interface AgentAnalyzeRequest {
  code: string; // 분석 입력 — code 모드는 소스코드, text 모드는 붙여넣은 글.
  locale: "ko" | "ja" | "en"; // 분석 출력 언어.
  providerId: AgentProviderKind;
  mode?: AnalyzeMode; // 기본 "code".
  targetToken?: string; // mode "explain-token"일 때 설명할 토큰 텍스트.
  targetConcept?: string; // mode "explain-concept"일 때 설명할 개념 제목.
  // mode "explain-card"(암기 카드 디폴트 설명)용 — 맥락 독립 설명 생성.
  targetTerm?: string; // 설명할 용어/토큰.
  targetKind?: "token" | "concept" | "term"; // 코드 토큰/개념 vs 글 용어(예문 유무 분기).
  messages?: ChatMessage[]; // mode "chat"일 때 대화 내역(마지막이 사용자 질문).
  // 병렬 청크(2단계) 분석용 — code 모드에서만.
  outlineOnly?: boolean; // 1차: title/summary/concepts만 생성(lineExplanations 비움).
  lineRange?: { start: number; end: number }; // 2차: 이 줄 범위(1-based, 포함)만 lineExplanations 생성.
  knownConcepts?: { conceptId: string; title: string }[]; // 2차: conceptIds가 참조할 개념 목록(1차 결과).
  resumeFrom?: AgentAnalyzeResponse; // 이어서 분석: 이전 부분 결과(outline 재사용 + 이미 된 줄설명 시드). orchestrator 전용.
  detectedLanguage?: SupportedLanguage;
  userIntent?: string;
  // #998 캐치업 질문 — 레포 루트(서버가 절대·존재 폴더 검증 후 읽기 전용 도구 범위로). chat 모드만.
  workspaceRoot?: string;
  // #998 nunopi 학습모듈 꺼짐 → 카드 제안(nunopi-cards) 지시 생략.
  noCards?: boolean;
  options?: AgentAnalyzeOptions;
  providerSettings?: ProviderSettings;
}

export interface AgentAnalyzeOptions {
  maxLines?: number;
  includeTokens?: boolean;
  includeConcepts?: boolean;
  includeRawOutput?: boolean;
  timeoutMs?: number;
}

export interface AgentAnalyzeResponse {
  providerId: AgentProviderKind;
  mode?: AnalyzeMode; // 기본 "code". "text"면 terms/itConcepts를 사용.
  language: string;
  title?: string; // 핵심을 압축한 짧은 한국어 명사구 제목(히스토리 자동 제목용). 없으면 클라가 폴백.
  summary: string;
  // 코드 모드 필드 (text 모드에선 빈 배열).
  lineExplanations: AgentLineExplanation[];
  tokens: CodeToken[];
  concepts: ConceptOccurrence[];
  // 글(text) 모드 필드.
  terms?: ItTerm[]; // IT 용어 사전
  itConcepts?: ItConcept[]; // 관련 개념
  warnings: TranslateWarning[];
  rawText?: string;
  usage?: AgentUsage;
  createdAt: string;
}

export interface AgentLineExplanation {
  line: number;
  code: string;
  explanation: string;
  tokens?: string[]; // 그 줄의 의미 토큰 텍스트(lazy 사전: 칩으로 표시, 클릭 시 on-demand 설명).
  tokenIds?: string[]; // 레거시(사전 id 참조) — 하위호환용.
  conceptIds: string[];
  confidence?: number;
}

export interface AgentUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  estimatedCostUsd?: number;
}

export interface AgentToTranslateMapping {
  source: AgentAnalyzeResponse;
  response: TranslateResponse;
}
