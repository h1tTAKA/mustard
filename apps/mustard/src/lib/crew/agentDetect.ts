// #1171 main이 남긴 에이전트 감지 결과(~/.nunopi/agent-detect.json, electron/agent-cli.cjs)를 Crew가 읽음.
// 시작 전 확인 — 못 찾음(로그인 셸 PATH까지 본 경우만 — shellOk)·로그인 필요면 바로 막힘(#1164: 예전엔 10분 '안 뜸'을 기다린 뒤에야, 이유 없이). 경로 깨짐은 '안 뜸' 이유로만 붙임.
// 사용자가 경로를 직접 지정한 에이전트(custom)는 감지와 다를 수 있어 건너뜀. 기록이 없거나 15분 넘었으면(main이 10분마다 갱신 — 그 사이 설치·로그인했을 수 있음) 확인 안 함(리뷰).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

// Crew provider → 감지 id(agent-cli.cjs AGENTS)
const ID: Record<string, string> = { "claude-code": "claude", codex: "codex", opencode: "opencode", grok: "grok", cursor: "cursor" };

type Detected = { id: string; status: "ok" | "broken" | "missing"; path?: string; version?: string | null; auth?: string; tried?: { path: string; error: string }[] };
export type AgentCheck =
  | { kind: "missing"; agent: string; sure: boolean }
  | { kind: "broken"; agent: string; path: string; err: string }
  | { kind: "login"; agent: string }
  | { kind: "ok"; agent: string; path: string; version: string };

export function checkAgent(provider: string, file = join(homedir(), ".nunopi", "agent-detect.json"), now = Date.now()): AgentCheck | null {
  const agent = ID[provider];
  if (!agent) return null;
  let j: { at?: number; list?: Detected[]; custom?: string[]; shellOk?: boolean };
  try { j = JSON.parse(readFileSync(file, "utf8")); } catch { return null; }
  if (!j.at || now - j.at > 15 * 60_000 || j.custom?.includes(agent)) return null;
  const a = j.list?.find((x) => x.id === agent);
  if (!a) return null;
  if (a.status === "missing") return { kind: "missing", agent, sure: !!j.shellOk };
  if (a.status === "broken") return { kind: "broken", agent, path: a.path ?? "", err: a.tried?.[0]?.error ?? "" };
  if (a.auth === "unauthenticated") return { kind: "login", agent };
  return { kind: "ok", agent, path: a.path ?? "", version: a.version ?? "" };
}
