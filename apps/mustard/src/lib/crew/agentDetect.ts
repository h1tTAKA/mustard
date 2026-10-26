// #1171 main이 남긴 에이전트 감지 결과(~/.nunopi/agent-detect.json, electron/agent-cli.cjs)를 Crew가 읽음.
// 시작 전 확인 — 못 찾음(로그인 셸 PATH까지 본 경우만 — shellOk)·로그인 필요면 바로 막힘(#1164: 예전엔 10분 '안 뜸'을 기다린 뒤에야, 이유 없이). 아래 sure 참고.
// sure = 막아도 되나(기록이 2분 안 것만 — 그 사이 설치·로그인했으면 옛 기록으로 막지 않게, 리뷰): 못 찾음은 셸 PATH까지 봤고 SNA도 자기 경로가 없을 때, 경로 깨짐은 SNA가 바로 그 깨진 경로를 받았을 때(감지가 늦게 끝나 SNA가 옛 찾기로 간 경우, 리뷰).
// 사용자가 경로를 직접 지정한 에이전트(custom)는 감지와 다를 수 있어 건너뜀. 기록이 없거나 15분 넘었으면(main이 10분마다 갱신 — 그 사이 설치·로그인했을 수 있음) 확인 안 함(리뷰).
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

// Crew provider → 감지 id(agent-cli.cjs AGENTS)
const ID: Record<string, string> = { "claude-code": "claude", codex: "codex", opencode: "opencode", grok: "grok", cursor: "cursor" };

type Detected = { id: string; status: "ok" | "broken" | "missing"; path?: string; version?: string | null; auth?: string; tried?: { path: string; error: string }[] };
export type AgentCheck =
  | { kind: "missing"; agent: string; sure: boolean }
  | { kind: "broken"; agent: string; path: string; err: string; sure: boolean }
  | { kind: "login"; agent: string; sure: boolean }
  | { kind: "ok"; agent: string; path: string; version: string };

export function checkAgent(provider: string, file = join(homedir(), ".nunopi", "agent-detect.json"), now = Date.now()): AgentCheck | null {
  const agent = ID[provider];
  if (!agent) return null;
  let j: { at?: number; list?: Detected[]; custom?: string[]; shellOk?: boolean; sna?: Record<string, string | undefined> | null };
  try { j = JSON.parse(readFileSync(file, "utf8")); } catch { return null; }
  if (!j.at || now - j.at > 15 * 60_000 || j.custom?.includes(agent)) return null;
  const a = j.list?.find((x) => x.id === agent);
  if (!a) return null;
  const sna = j.sna?.[agent], fresh = now - j.at <= 2 * 60_000;
  if (a.status === "missing") return { kind: "missing", agent, sure: fresh && !!j.shellOk && !(sna?.startsWith("/") && existsSync(sna)) };
  if (a.status === "broken") return { kind: "broken", agent, path: a.path ?? "", err: a.tried?.[0]?.error ?? "", sure: fresh && !!sna && !!a.tried?.some((t) => t.path === sna && t.error !== "timeout") }; // 시간 초과는 느린 첫 실행일 수 있음
  if (a.auth === "unauthenticated") return { kind: "login", agent, sure: fresh };
  return { kind: "ok", agent, path: a.path ?? "", version: a.version ?? "" };
}
