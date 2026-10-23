export type AgentProviderKind =
  | "claude-agent"
  | "codex-agent"
  | "opencode-agent"
  | "openai-app-server"
  | "openai-api-key"
  | "hermes-local"
  | "openai-compatible"
  | "mock";

export type AgentExecutionLocation =
  | "browser"
  | "local-server"
  | "desktop"
  | "remote-api";

export type AgentDataHandling =
  | "local-only"
  | "user-configured-endpoint"
  | "remote-provider";

export interface AgentProviderCapability {
  streaming: boolean;
  cancellation: boolean;
  fileSystemAccess: boolean;
  shellAccess: boolean;
  requiresApiKey: boolean;
  requiresLocalProcess: boolean;
}

export interface AgentProviderMetadata {
  id: AgentProviderKind;
  label: string;
  description: string;
  executionLocation: AgentExecutionLocation;
  dataHandling: AgentDataHandling;
  capabilities: AgentProviderCapability;
}

export interface AgentAnalyzeCallOptions {
  // 분석 취소용. fire되면 provider는 진행 중인 작업(CLI 프로세스/HTTP 요청)을 중단한다.
  signal?: AbortSignal;
  // 진행 출력 한 줄씩 흘리는 콜백(예: CLI provider의 stdout 라인). 실시간 상태 표시용.
  onProgress?: (line: string) => void;
  // #1162 사람이 기다리는 답(Crew 대화방) — SNA 줄 맨 앞(앱 켠 직후 자동 설명이 칸을 차지해도).
  priority?: boolean;
  // #1162 줄 서기 끝나 실제 실행 시작 — 무진행 타이머가 줄 선 시간을 안 세게.
  onStart?: () => void;
  // 모델 추론(reasoning/thinking) 누적을 흘리는 콜백 — 답변과 별개(과정). 대기 구간 활동 표시용.
  onThinking?: (line: string) => void;
  // #998 서버가 검증한 읽기 전용 작업 범위 — cwd=레포, addDirs=추가로 읽을 폴더(캐치업 기록). 클라 입력 아님.
  workspace?: { cwd: string; addDirs?: string[] };
  // 누적 부분 결과 콜백(청크 분석 전용) — outline·청크가 완료될 때마다 지금까지의
  // 누적 response를 흘려 화면에 점진 표시한다. 단일 호출 provider는 사용하지 않는다.
  onPartial?: (response: import("./schema").AgentAnalyzeResponse) => void;
  // 청크 진행률 콜백(청크 분석 전용) — 완료 조각 수/전체. 진행률 막대바용.
  onChunkProgress?: (done: number, total: number) => void;
}

export interface AgentProvider {
  metadata: AgentProviderMetadata;
  analyze(
    request: import("./schema").AgentAnalyzeRequest,
    options?: AgentAnalyzeCallOptions,
  ): Promise<import("./schema").AgentAnalyzeResponse>;
}
