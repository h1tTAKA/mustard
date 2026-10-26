// #1171 main이 남긴 에이전트 감지 결과(~/.nunopi/agent-detect.json, electron/agent-cli.cjs)를 Crew가 읽음.
// 시작 전 확인 — 문제가 보이면 main에 바로 다시 감지를 부탁(recheck)하고, 그 새 기록으로도 확실할 때(sure)만 막힘(#1164: 예전엔 10분 '안 뜸'을 기다린 뒤에야, 이유 없이).
// sure: 못 찾음은 셸 PATH까지 봤고 SNA도 자기 경로가 없을 때, 경로 깨짐은 SNA가 바로 그 깨진 경로를 받았을 때(감지가 늦게 끝나 SNA가 옛 찾기로 간 경우), 로그인 필요는 그대로. 옛 기록·캐시로는 안 막음(리뷰).
// 사용자가 경로를 직접 지정한 에이전트(custom)는 감지와 다를 수 있어 건너뜀. 기록이 없거나 15분 넘었으면(main이 10분마다 갱신 — 그 사이 설치·로그인했을 수 있음) 확인 안 함(리뷰).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const DIR = () => join(homedir(), ".nunopi");
const FILE = () => join(DIR(), "agent-detect.json");

// Crew provider → 감지 id(agent-cli.cjs AGENTS)
const ID: Record<string, string> = { "claude-code": "claude", codex: "codex", opencode: "opencode", grok: "grok", cursor: "cursor" };

type Detected = { id: string; status: "ok" | "broken" | "missing"; path?: string; version?: string | null; auth?: string; tried?: { path: string; error: string }[] };
type Record_ = { at?: number; list?: Detected[]; custom?: string[]; shellOk?: boolean; sna?: Record<string, string | undefined> | null };
export type AgentCheck =
  | { kind: "missing"; agent: string; sure: boolean }
  | { kind: "broken"; agent: string; path: string; err: string; sure: boolean }
  | { kind: "login"; agent: string; sure: boolean }
  | { kind: "ok"; agent: string; path: string; version: string };

const read = (file: string): Record_ | null => { try { return JSON.parse(readFileSync(file, "utf8")); } catch { return null; } };
export const detectAt = (file = FILE()) => read(file)?.at ?? 0;

// since = 이 시각 뒤에 만든 기록이어야 sure(막아도 됨) — 안 주면 sure는 항상 false(이유 표시용).
export function checkAgent(provider: string, file = FILE(), now = Date.now(), since = 0): AgentCheck | null {
  const agent = ID[provider];
  if (!agent) return null;
  const j = read(file);
  if (!j?.at || now - j.at > 15 * 60_000 || j.custom?.includes(agent)) return null;
  const a = j.list?.find((x) => x.id === agent);
  if (!a) return null;
  const sna = j.sna?.[agent], fresh = since > 0 && j.at >= since;
  if (a.status === "missing") return { kind: "missing", agent, sure: fresh && !!j.shellOk && !(sna?.startsWith("/") && existsSync(sna)) };
  // 시간 초과(느린 첫 실행)·버전을 찍고 0 아닌 값으로 끝난 건 실제론 뜰 수 있어 근거로 안 씀
  if (a.status === "broken") return { kind: "broken", agent, path: a.path ?? "", err: a.tried?.[0]?.error ?? "", sure: fresh && !!sna && !!a.tried?.some((t) => t.path === sna && t.error !== "timeout" && !/\d+\.\d+\.\d+/.test(t.error)) };
  if (a.auth === "unauthenticated") return { kind: "login", agent, sure: fresh };
  return { kind: "ok", agent, path: a.path ?? "", version: a.version ?? "" };
}

// main에 바로 다시 감지를 부탁(main이 이 파일을 1초마다 봄)하고 새 기록을 기다림 — 기록 시각, 시간 넘으면 0(main 없음 등)
export async function recheck(timeoutMs = 20_000, file = FILE()): Promise<number> {
  const since = Date.now();
  try { mkdirSync(DIR(), { recursive: true }); writeFileSync(join(DIR(), "agent-detect.request"), String(since)); } catch { return 0; }
  for (const end = since + timeoutMs; Date.now() < end; ) {
    await new Promise((r) => setTimeout(r, 500));
    if (detectAt(file) >= since) return since;
  }
  return 0;
}
