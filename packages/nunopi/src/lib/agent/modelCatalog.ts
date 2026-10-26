// 모델 목록 보강(#987 → #1021) — 순수 함수(import 없음, check 가능). snaAgentProvider가 사용.
// SNA의 Claude 고정 목록은 구버전이고 SNA 레포 갱신은 보류 → 우리 쪽에서 최신을 덧댄다.
// 2026-10-09 CLI 실측: `claude --help` 별칭 fable/opus/sonnet, 최신 Fable 5.1·Opus 5.5·Sonnet 5·Haiku 4.5.
export interface SnaModelOption { id: string; label: string; latest?: boolean }

// 별칭 = CLI가 그 계열 최신으로 해석(새 모델이 나와도 그대로 동작) → 맨 위.
export const CLAUDE_ALIASES: SnaModelOption[] = [
  { id: "fable", label: "Fable", latest: true },
  { id: "opus", label: "Opus", latest: true },
  { id: "sonnet", label: "Sonnet", latest: true },
  { id: "haiku", label: "Haiku", latest: true },
];
// 최신 정식 ID — 버전 고정이 필요할 때. 한계: 새 계열 나오면 여기 갱신(SNA 목록이 최신화되면 제거 가능).
export const CLAUDE_LATEST: SnaModelOption[] = [
  { id: "claude-fable-5-1", label: "Claude Fable 5.1" },
  { id: "claude-opus-5-5", label: "Claude Opus 5.5" },
  { id: "claude-sonnet-5", label: "Claude Sonnet 5" },
  { id: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5" },
];

// 별칭 → 최신 정식 ID → SNA 목록의 나머지(구버전 등) 순, id 중복 제거(앞이 우선 — SNA의 구버전 라벨 별칭은 버림).
export function mergeClaudeModels(sna: SnaModelOption[]): SnaModelOption[] {
  const seen = new Set<string>();
  return [...CLAUDE_ALIASES, ...CLAUDE_LATEST, ...sna].filter((m) => (seen.has(m.id) ? false : (seen.add(m.id), true)));
}

// Codex 설정(config.toml) 최상위 `model = "..."` — 유저가 Codex에 정한 기본 모델을 따른다(하드코딩이 낡지 않게).
// 테이블([profiles.x] 등) 안의 model은 무시: 첫 테이블 헤더 전까지만 본다.
export function codexConfigModel(toml: string): string | null {
  const top = toml.split(/^\s*\[/m)[0] ?? "";
  return /^\s*model\s*=\s*["']([^"'\n]+)["']/m.exec(top)?.[1]?.trim() || null;
}
