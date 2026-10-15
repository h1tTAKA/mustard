import "server-only";
import { getSnaClient } from "@mustard/core/sna";
import type { AgentAnalyzeRequest, AgentAnalyzeResponse, AgentUsage } from "@mustard/core";
import type { AgentAnalyzeCallOptions, AgentProvider, AgentProviderKind } from "@mustard/core";
import {
  buildTextPrompt,
  mergeTextResults,
  normalizeTextOutput,
  parseTextStreamPartial,
  textModeResponse,
} from "./textMode";
import { buildExplainTokenPrompt, normalizeExplainTokenOutput, tokenModeResponse } from "./tokenMode";
import { buildExplainConceptPrompt, normalizeExplainConceptOutput, conceptModeResponse } from "./conceptMode";
import { buildChatPrompt, chatSystemPrompt, normalizeChatOutput, chatModeResponse, buildDeckAgentPrompt, deckAgentSystemPrompt } from "./chatMode";
import { buildCardExplainPrompt } from "./cardExplainMode";
import { codexConfigModel, mergeClaudeModels, type SnaModelOption } from "./modelCatalog";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  buildClaudePrompt,
  normalizeClaudeOutput,
  type ClaudeAvailabilityResult,
} from "./codePrompt";

// 분석/챗 런타임을 임베드 에이전트 런타임 서버(runOnce 스트림)로 처리하는 provider.
// claude-code / codex 두 런타임을 같은 로직으로 굴리되, runOnce 옵션만 런타임별로 분기한다.
// 프롬프트 빌더·정규화·partial 파싱·머지는 전부 기존 모듈 재사용.

type SnaRuntime = "claude-code" | "codex" | "opencode";

// 런타임별 기본 모델(#987 이전 하드코딩 그대로). 유저가 모드별 모델을 안 고르면 이걸 쓴다.
// runOnce는 model 미지정 시 SNA 글로벌 기본(claude-sonnet-4-6)을 주입한다 → codex/opencode엔
// 그 모델이 가서 실패("not supported"/"Model not found"). 그래서 비-claude는 모델 명시 필수.
// 환경마다 다르므로 env override(기본은 각 런타임의 합리적 기본).
// 유저 Codex 기본 모델(#1021) — $CODEX_HOME|~/.codex/config.toml의 최상위 model. 하드코딩(gpt-5.5)은 Codex 목록에서 이미 숨겨진
// 구버전이 됐던 것처럼 또 낡으므로 Codex 자신의 설정을 따른다. 없거나 못 읽으면 null → 폴백.
// 분석 요청마다 디스크를 읽지 않게 60초 캐시(#1022 리뷰) — 유저가 Codex 설정을 바꾸면 최대 1분 뒤 반영.
let codexModelCache: { at: number; model: string | null } | null = null;
function userCodexModel(): string | null {
  if (codexModelCache && Date.now() - codexModelCache.at < 60_000) return codexModelCache.model;
  let model: string | null = null;
  try { model = codexConfigModel(readFileSync(join(process.env.CODEX_HOME?.trim() || join(homedir(), ".codex"), "config.toml"), "utf8")); }
  catch { /* 없음·권한 — 폴백 */ }
  codexModelCache = { at: Date.now(), model };
  return model;
}

export function defaultSnaModel(runtime: SnaRuntime): string {
  if (runtime === "claude-code") return "sonnet"; // 별칭 = CLI가 최신 sonnet으로 해석
  if (runtime === "codex") return process.env.NUNOPI_CODEX_MODEL?.trim() || userCodexModel() || "gpt-5.6-sol";
  return process.env.NUNOPI_OPENCODE_MODEL?.trim() || "opencode/deepseek-v4-flash-free";
}

const CODE_SYSTEM_PROMPT = "You are a code analysis assistant. Return JSON only.";
// 카드 중복 묶기 — 경량. 프롬프트(요청 code)에 규칙·목록이 다 들어 있어 시스템은 출력형식만 강제.
// 산문·플래시카드 제안 없이 요청한 ```card-dedup 블록만 내게 해 토큰·지연을 최소화한다.
const DEDUP_SYSTEM_PROMPT =
  "You group duplicate flashcards. Output ONLY the requested ```card-dedup fenced block and nothing else — no prose, no explanation, no other code blocks.";
// Ask 아웃풋 퀴즈 — 생성+채점 겸용. 클라가 code에 MODE(GENERATE/GRADE)·재료·규칙·출력언어를 다 담아 보냄.
// 시스템은 형식(오직 ```json 블록)만 강제. 산문·다른 블록 금지로 파싱 안정성 확보.
const QUIZ_SYSTEM_PROMPT =
  "You create and grade active-recall quizzes. Follow the MODE (GENERATE or GRADE) and output language stated in the user message. Output ONLY the requested ```json fenced block and nothing else — no prose, no explanation, no other code blocks.";

interface RunResult {
  text: string;
  usage?: AgentUsage;
}

function toNum(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

function mapUsage(data: unknown): AgentUsage | undefined {
  if (typeof data !== "object" || data === null) return undefined;
  const d = data as Record<string, unknown>;
  const inputTokens = toNum(d.inputTokens);
  const outputTokens = toNum(d.outputTokens);
  const total = (inputTokens ?? 0) + (outputTokens ?? 0);
  if (inputTokens === undefined && outputTokens === undefined) {
    return undefined;
  }
  // 구독 런타임이라 SNA가 보고하는 costUsd는 실제 청구가 아닌 추정치 → 비용 미표시 원칙상 매핑 안 함.
  return {
    inputTokens,
    outputTokens,
    totalTokens: total > 0 ? total : undefined,
  };
}

// #1093 SNA 런타임 동시 세션 상한(기본 5) — 넘으면 "Max active sessions" 에러. 우리 호출(자동 설명·해설·요약·질문)을
// 프로세스 단위 슬롯으로 줄 세우고(1개는 다른 사용처 몫으로 남김), 그래도 상한이면(다른 곳이 쓰는 중) 기다렸다 재시도.
const SNA_SLOTS = 4;
// globalThis — Next가 라우트마다(analyze·observe·backfill) 이 모듈을 따로 번들해도 한 프로세스에서 한 줄.
const snaQ = ((globalThis as unknown as { __nunopiSnaQ?: { busy: number; waiters: (() => void)[] } }).__nunopiSnaQ ??= { busy: 0, waiters: [] });
async function acquireSnaSlot(signal?: AbortSignal): Promise<() => void> {
  while (snaQ.busy >= SNA_SLOTS) {
    let woken = false;
    await new Promise<void>((res) => {
      const wake = () => { woken = true; signal?.removeEventListener("abort", onAbort); res(); };
      const onAbort = () => { const i = snaQ.waiters.indexOf(wake); if (i >= 0) snaQ.waiters.splice(i, 1); res(); }; // 취소 = 줄에서 빠지고 바로 깸
      snaQ.waiters.push(wake);
      signal?.addEventListener("abort", onAbort, { once: true });
    });
    if (signal?.aborted) { if (woken) snaQ.waiters.shift()?.(); throw new Error("분석이 취소되었습니다."); } // 깨움을 받았으면 다음 대기자에게
  }
  snaQ.busy++;
  let done = false;
  return () => { if (done) return; done = true; snaQ.busy--; snaQ.waiters.shift()?.(); };
}
const isSessionLimit = (e: unknown) => /Max active sessions/i.test(e instanceof Error ? e.message : String(e));
const sleep = (ms: number, signal?: AbortSignal) => new Promise<void>((res) => { const t = setTimeout(res, ms); signal?.addEventListener("abort", () => { clearTimeout(t); res(); }, { once: true }); });

// 슬롯 잡고 실행, 상한 에러면 백오프(2s→최대 30s) 재시도 — 최대 10분. 다른 에러·취소는 그대로 던짐.
async function runViaSna(prompt: string, opts: Parameters<typeof runViaSnaOnce>[1]): Promise<RunResult> {
  const deadline = Date.now() + 10 * 60_000;
  for (let wait = 2000; ; wait = Math.min(wait * 2, 30_000)) {
    const release = await acquireSnaSlot(opts.signal);
    try { return await runViaSnaOnce(prompt, opts); }
    catch (e) {
      if (!isSessionLimit(e) || opts.signal?.aborted || Date.now() + wait > deadline) throw e;
    } finally { release(); }
    await sleep(wait, opts.signal);
    if (opts.signal?.aborted) throw new Error("분석이 취소되었습니다.");
  }
}

// runClaudeCli/codex exec 등가물 — runOnce 스트림을 누적해 { text, usage } 반환.
// 런타임별 분기: claude는 토큰 최적화 플래그(툴 정의 0 + 유저 설정 미로드)를 붙이고,
// codex는 그 플래그가 claude 전용이라 안 붙인다(어댑터가 알아서).
async function runViaSnaOnce(
  prompt: string,
  opts: {
    runtime: SnaRuntime;
    systemPrompt?: string;
    signal?: AbortSignal;
    onProgress?: (line: string) => void;
    onThinking?: (line: string) => void; // 추론(thinking) 누적 — 대기 구간 활동 표시용
    fullProgress?: boolean;
    effort?: boolean; // 분석은 low; 챗은 미강제
    model?: string; // #987 유저 선택 모델(미지정 = defaultSnaModel)
    workspace?: { cwd: string; addDirs?: string[] }; // #998 읽기 전용 작업 범위(서버 검증값)
  },
): Promise<RunResult> {
  if (opts.signal?.aborted) throw new Error("분석이 취소되었습니다.");
  const client = await getSnaClient();
  const isClaude = opts.runtime === "claude-code";
  const isCodex = opts.runtime === "codex";

  // low 기준 reasoningLevel: claude=1, codex=2 (SNA 매핑표). opencode는 미강제(모델별 상이).
  const reasoningLevel = opts.effort && isClaude ? 1 : opts.effort && isCodex ? 2 : undefined;
  const model = opts.model?.trim() || defaultSnaModel(opts.runtime);
  const runtimeOpts = isClaude
    ? {
        model,
        // 토큰 최적화: 유저 설정/CLAUDE.md/훅 미로드 + 툴 정의 0(PoC 실측 cacheRead 16143→0).
        // #998 workspace면 읽기 전용 내장 도구만(Read/Grep/Glob) + cwd=레포 + 추가 폴더(캐치업 기록). 쓰기·셸 도구 없음.
        providerOptions: { settingSources: [""], strictMcpConfig: true } as Record<string, unknown>,
        extraArgs: opts.workspace
          ? ["--tools", "Read,Grep,Glob", ...(opts.workspace.addDirs ?? []).flatMap((d) => ["--add-dir", d])]
          : ["--tools", ""],
        // SNA는 bypassPermissions가 아니면 PreToolUse 권한 훅을 심는데, runOnce엔 승인 주체가 없어 Read/Grep이 거부됨(#998 실측).
        // 도구 목록 자체가 읽기 전용(--tools Read,Grep,Glob)이라 확인을 건너뛰어도 쓰기·셸 불가. ⚠ codex엔 금지(= 샌드박스 해제).
        ...(opts.workspace ? { cwd: opts.workspace.cwd, permissionMode: "bypassPermissions" } : {}),
      }
    : isCodex && opts.workspace
      ? { model, cwd: opts.workspace.cwd } // #998 codex: SNA 기본 permissionMode → read-only 샌드박스
      : { model }; // codex/opencode: 모델만 명시(claude 플래그 미전달). opencode는 쓰기 제한 불확실 → 도구 범위 미전달

  let full = "";

  let segStart = 0; // #1081 마지막 도구 호출 뒤 답 시작 위치
  let think = ""; // 추론 누적
  let streamed = false;
  let usage: AgentUsage | undefined;

  for await (const ev of client.agent.runOnceStream({
    message: prompt,
    provider: opts.runtime,
    systemPrompt: opts.systemPrompt ?? CODE_SYSTEM_PROMPT,
    reasoningLevel,
    timeout: 600_000, // 큰/청크 분석 대비 충분히 크게.
    ...runtimeOpts,
  })) {
    if (opts.signal?.aborted) throw new Error("분석이 취소되었습니다.");
    const type = ev.type as string | undefined;
    if (type === "tool_use" || type === "tool_call" || type === "tool_result") {
      // #1081 도구를 쓰는 대화(질문 화면): 도구 호출 전에 쓴 중간 혼잣말("찾아볼게요", "Lines are long…")은 답이 아님 →
      // 마지막 도구 뒤에 쓴 글만 최종 답. 도구 없으면 segStart=0 그대로(기존과 동일).
      segStart = full.length;
    } else if (type === "assistant_delta") {
      streamed = true;
      full += (ev.delta as string | undefined) ?? "";
      // 비-full(코드/explain 진행 라벨)은 누적 끝 200자만 — runClaudeCli와 동일(델타 조각 X).
      opts.onProgress?.(opts.fullProgress ? full.slice(segStart) : full.slice(-200));
    } else if (type === "thinking_delta") {
      // 추론 조각 — 답변과 별개로 흘려 대기 구간에 "생각 중" 활동 표시.
      think += (ev.message as string | undefined) ?? "";
      opts.onThinking?.(think);
    } else if (type === "assistant" && !streamed) {
      full = (ev.message as string | undefined) ?? "";
      opts.onProgress?.(full);
    } else if (type === "complete") {
      usage = mapUsage(ev.data);
    } else if (type === "error") {
      throw new Error(String(ev.message ?? "runtime error"));
    }
  }

  const answer = full.slice(segStart).trim();
  return { text: answer || full, usage }; // 마지막 도구 뒤 글이 비면(드묾) 전체로
}

// SNA 도달 불가 시 모드별 에러 응답.
function unavailableResponse(
  request: AgentAnalyzeRequest,
  message: string,
  providerId: AgentProviderKind,
): AgentAnalyzeResponse {
  const warn = [{ code: "PARTIAL_PARSE" as const, message }];
  if (request.mode === "chat" || request.mode === "dedup-cards" || request.mode === "deck-agent" || request.mode === "quiz") return chatModeResponse(providerId, message, warn);
  if (request.mode === "explain-concept") return conceptModeResponse(providerId, [], warn);
  if (request.mode === "explain-token") return tokenModeResponse(providerId, [], warn);
  if (request.mode === "text") return textModeResponse(providerId, message, warn);
  return {
    providerId,
    language: request.detectedLanguage ?? "unknown",
    summary: message,
    lineExplanations: [],
    tokens: [],
    concepts: [],
    warnings: warn,
    createdAt: new Date().toISOString(),
  };
}

interface SnaProviderConfig {
  id: AgentProviderKind; // "claude-agent" | "codex-agent"
  runtime: SnaRuntime;
  label: string;
  mockEnv: string; // 테스트용 mock 응답 env 이름
}

// 런타임별 provider 인스턴스를 만든다(claude/codex 공통 로직 1벌).
function createSnaProvider(cfg: SnaProviderConfig): AgentProvider {
  const providerId = cfg.id;
  return {
    metadata: {
      id: cfg.id,
      label: cfg.label,
      description: "Code/text analysis & chat via the embedded agent runtime server (runOnce).",
      executionLocation: "local-server",
      dataHandling: "remote-provider",
      capabilities: {
        streaming: true,
        cancellation: true,
        fileSystemAccess: false,
        shellAccess: false,
        requiresApiKey: false,
        requiresLocalProcess: true,
      },
    },

    async analyze(
      request: AgentAnalyzeRequest,
      options?: AgentAnalyzeCallOptions,
    ): Promise<AgentAnalyzeResponse> {
      const isChat = request.mode === "chat";
      const isText = request.mode === "text";
      const isExplainToken = request.mode === "explain-token";
      const isExplainConcept = request.mode === "explain-concept";
      // 카드 디폴트 설명 — 챗처럼 자연어 마크다운을 fullProgress로 스트리밍(타이핑).
      const isCardExplain = request.mode === "explain-card";
      // 카드 중복 묶기 — 경량. 프롬프트는 요청 code 그대로, 저추론(low)·thinking/타이핑 스트림 없음.
      const isDedup = request.mode === "dedup-cards";
      // 덱 생성/분류 — 대화형 경량(저추론 + nunopi-cards 없음). 스트리밍·thinking은 활동 표시 위해 켠다.
      const isDeckAgent = request.mode === "deck-agent";
      // Ask 아웃풋 퀴즈 — dedup과 동형(블록만 출력, 저추론, 스트림/thinking 없음). 클라가 code에 컨텍스트 완성.
      const isQuiz = request.mode === "quiz";
      const isChatLike = isChat || isCardExplain;
      // 답변을 자유텍스트로 흘리고(summary) 스트리밍/추론을 보여주는 그룹(챗류 + 덱에이전트).
      const isChatStream = isChatLike || isDeckAgent;

      // 런타임 서버 도달 가능성 확인.
      try {
        await getSnaClient();
      } catch (e) {
        const message = `에이전트 런타임 서버에 연결하지 못했다: ${e instanceof Error ? e.message : String(e)}`;
        return unavailableResponse(request, message, providerId);
      }

      const prompt = isDedup || isQuiz
        ? request.code // 클라가 규칙+목록(또는 퀴즈 컨텍스트)을 이미 완성해 보냄.
        : isDeckAgent
        ? buildDeckAgentPrompt(request)
        : isCardExplain
        ? buildCardExplainPrompt(request)
        : isChat
        ? buildChatPrompt(request)
        : isExplainConcept
          ? buildExplainConceptPrompt(request)
          : isExplainToken
            ? buildExplainTokenPrompt(request)
            : isText
              ? buildTextPrompt(request)
              : buildClaudePrompt(request);

      const mockText = process.env[cfg.mockEnv]?.trim();
      // 정규화에 필요한 stub availability(메시지 cosmetic 용도로만 사용됨).
      const stubAvailability: ClaudeAvailabilityResult = {
        available: true,
        commandPath: "embedded-runtime",
        message: "embedded runtime",
      };

      if (mockText) {
        return isChatStream || isDedup || isQuiz
          ? normalizeChatOutput(mockText, providerId)
          : isExplainConcept
            ? normalizeExplainConceptOutput(mockText, providerId, request)
            : isExplainToken
              ? normalizeExplainTokenOutput(mockText, providerId, request)
              : isText
                ? normalizeTextOutput(mockText, providerId, request)
                : normalizeClaudeOutput(mockText, request, stubAvailability, prompt, undefined, providerId);
      }

      try {
        let streamOnProgress = options?.onProgress;
        // 챗/카드설명/덱에이전트는 답변을 누적 전체로 흘려 타이핑처럼 보이게 한다.
        let fullProgress = isChatStream;
        const prior = isText ? request.resumeFrom : undefined;
        if (isText && options?.onPartial) {
          const onPartial = options.onPartial;
          const startedAt = new Date().toISOString();
          let lastT = -1;
          let lastC = -1;
          let lastS = -1;
          streamOnProgress = (full: string) => {
            if (!full.includes("}")) return;
            const fresh = parseTextStreamPartial(full, providerId, startedAt);
            if (!fresh) return;
            const partial = prior ? mergeTextResults(prior, fresh) : fresh;
            const t = partial.terms?.length ?? 0;
            const c = partial.itConcepts?.length ?? 0;
            const s = partial.summary.length;
            if (t === lastT && c === lastC && s === lastS) return;
            lastT = t;
            lastC = c;
            lastS = s;
            onPartial(partial);
          };
          fullProgress = true;
        }

        const { text: rawText, usage } = await runViaSna(prompt, {
          runtime: cfg.runtime,
          // 챗은 언어별 튜터 시스템프롬프트 + thinking 살림(effort 미강제). 분석은 JSON 지시 + low.
          // 중복묶기는 블록만 내라는 경량 시스템프롬프트 + low(아래 effort).
          systemPrompt: isDedup ? DEDUP_SYSTEM_PROMPT : isQuiz ? QUIZ_SYSTEM_PROMPT : isDeckAgent ? deckAgentSystemPrompt(request.locale) : isChatLike ? chatSystemPrompt(request.locale) : CODE_SYSTEM_PROMPT,
          signal: options?.signal,
          onProgress: streamOnProgress,
          // 추론 표시는 챗류·덱에이전트에서만 — 분석/청크는 partial 파싱 경로라 미전달.
          onThinking: isChatStream ? options?.onThinking : undefined,
          fullProgress,
          // 덱에이전트는 저추론(그룹핑이라 깊은 추론 불필요) — 챗/카드설명만 고추론 허용.
          effort: !isChatLike,
          // 모드별 모델(#987) — 클라가 뷰별 providerSettings에 주입.
          model: (request.providerSettings?.[providerId as "claude-agent" | "codex-agent" | "opencode-agent"])?.model,
          workspace: isChat ? options?.workspace : undefined, // #998 캐치업 질문(chat)만 읽기 전용 도구
        });

        return isChatStream || isDedup || isQuiz
          ? normalizeChatOutput(rawText, providerId)
          : isExplainConcept
            ? normalizeExplainConceptOutput(rawText, providerId, request)
            : isExplainToken
              ? normalizeExplainTokenOutput(rawText, providerId, request)
              : isText
                ? (() => {
                    const fresh = normalizeTextOutput(rawText, providerId, request, usage);
                    return prior ? mergeTextResults(prior, fresh) : fresh;
                  })()
                : normalizeClaudeOutput(rawText, request, stubAvailability, prompt, usage, providerId);
      } catch (err) {
        if (options?.signal?.aborted) throw err; // 취소는 route로 전파(499)
        const message = err instanceof Error ? err.message : "runtime run failed";
        const warn = [{ code: "PARSE_FAILED" as const, message }];
        if (isChatStream || isDedup || isQuiz) return chatModeResponse(providerId, `런타임 실패: ${message}`, warn);
        if (isExplainConcept) return conceptModeResponse(providerId, [], warn);
        if (isExplainToken) return tokenModeResponse(providerId, [], warn);
        if (isText) return textModeResponse(providerId, `런타임 실패: ${message}`, warn);
        return {
          providerId,
          language: request.detectedLanguage ?? "unknown",
          summary: `런타임 실패: ${message}`,
          lineExplanations: [],
          tokens: [],
          concepts: [],
          warnings: warn,
          createdAt: new Date().toISOString(),
        };
      }
    },
  };
}

export const snaClaudeProvider = createSnaProvider({
  id: "claude-agent",
  runtime: "claude-code",
  label: "Claude Agent (runtime)",
  mockEnv: "NUNOPI_CLAUDE_MOCK_RESPONSE",
});

export const snaCodexProvider = createSnaProvider({
  id: "codex-agent",
  runtime: "codex",
  label: "Codex Agent (runtime)",
  mockEnv: "NUNOPI_CODEX_MOCK_RESPONSE",
});

export const snaOpenCodeProvider = createSnaProvider({
  id: "opencode-agent",
  runtime: "opencode",
  label: "OpenCode Agent (runtime)",
  mockEnv: "NUNOPI_OPENCODE_MOCK_RESPONSE",
});

// 하위 호환 별칭(기존 import 경로 유지).
export const snaAgentProvider = snaClaudeProvider;

// 모델 목록(#987) — 설정 화면 모델 선택용. SNA agent.listModels(Codex/OpenCode는 CLI 실시간, Claude는 SNA 고정 목록).
// SNA의 Claude 고정 목록은 구버전이라 별칭(fable/opus/sonnet/haiku)·최신 정식 ID를 우리 쪽에서 덧댐(#1021, modelCatalog.ts).
export type { SnaModelOption };
const RUNTIME_OF: Partial<Record<AgentProviderKind, SnaRuntime>> = {
  "claude-agent": "claude-code",
  "codex-agent": "codex",
  "opencode-agent": "opencode",
};

export async function listSnaModels(providerId: AgentProviderKind): Promise<{ models: SnaModelOption[]; defaultModel: string } | null> {
  const runtime = RUNTIME_OF[providerId];
  if (!runtime) return null;
  const client = await getSnaClient();
  const res = await client.agent.listModels(runtime);
  let models: SnaModelOption[] = res.models.filter((m) => !m.deprecated).map((m) => ({ id: m.id, label: m.label }));
  if (runtime === "claude-code") models = mergeClaudeModels(models);
  return { models, defaultModel: defaultSnaModel(runtime) };
}
