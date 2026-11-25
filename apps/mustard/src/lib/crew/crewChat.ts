// Crew 팀 채팅(#1104, 에픽 #1097) — 레포별 채널. 역할 에이전트·보드·사람의 메시지를 시간순으로. 서버 전용.
// 저장 = ~/.nunopi/crew/<sha(root)>/chat.jsonl (한 줄 = 메시지, append). 동기 함수(같은 프로세스 안 경합 없음).
import { createHash, randomUUID } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

export type ChatKind = "start" | "handoff" | "question" | "permission" | "gate" | "blocked" | "human" | "decision" | "answer" | "meeting"; // answer = @ 없는 사람 글에 역할이 답, meeting = 팀 회의 발언(#1139)
export interface CrewMsg {
  id: string; ts: number;
  from: string;            // 역할 id | "human" | "board"
  kind: ChatKind;
  text: string;
  taskId?: string; taskTitle?: string;
  mentions?: string[];     // @역할(또는 "you" = 사람)
  provider?: string;       // 역할 메시지 — 실행 AI
  replyTo?: string;        // 사람 답글 — 대상 메시지 id
  // #1125 보드·시스템 문구는 번역 키도 저장 → 화면이 지금 언어로 번역(text = 저장 시점 언어, 옛 메시지·대체값)
  i18n?: { key: string; vars?: Record<string, string | number>; suffix?: string };
  room?: string;           // #1392 방 id(dm-역할 = 1:1, g-… = 그룹, crewRooms) — 없으면 팀방(옛 메시지 전부)
}

const normPath = (p: string) => p.replace(/\/+$/, "");
const sha = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 32);
const baseDir = () => process.env.MUSTARD_CREW_DIR || join(homedir(), ".nunopi", "crew");
export const chatFile = (root: string) => join(baseDir(), sha(normPath(root)), "chat.jsonl");
// 팀 지침 — 사람이 대화방에서 준 지침·지적(카드 아님). 이후 모든 실행 프롬프트에 붙음. 최근 30개만.
//  한계: 화면에서 보거나 지우는 곳은 아직 없음 — 파일(guidelines.json)을 지우면 초기화.
const guideFile = (root: string) => join(baseDir(), sha(normPath(root)), "guidelines.json");
export function readGuidelines(root: string): string[] {
  try { const v = JSON.parse(readFileSync(guideFile(root), "utf8")); return Array.isArray(v) ? v.filter((x) => typeof x === "string") : []; } catch { return []; }
}
export function addGuideline(root: string, text: string): string[] {
  const t = text.trim().slice(0, 1500);
  const list = t ? [...readGuidelines(root).filter((x) => x !== t), t].slice(-30) : readGuidelines(root);
  const f = guideFile(root);
  mkdirSync(dirname(f), { recursive: true });
  writeFileSync(f, JSON.stringify(list, null, 1));
  return list;
}
const KINDS = new Set<ChatKind>(["start", "handoff", "question", "permission", "gate", "blocked", "human", "decision", "answer", "meeting"]);

export function appendMsg(root: string, m: Omit<CrewMsg, "id" | "ts"> & { ts?: number }): CrewMsg {
  const msg: CrewMsg = { id: randomUUID(), ts: m.ts ?? Date.now(), ...m, text: String(m.text ?? "").slice(0, 8000) };
  const f = chatFile(root);
  mkdirSync(dirname(f), { recursive: true });
  appendFileSync(f, JSON.stringify(msg) + "\n");
  return msg;
}

// #1392 방 맞추기 — room "" = 팀방(room 없는 글), 그 밖 = 그 방 id
export const inRoom = (m: CrewMsg, room: string) => (m.room ?? "") === room;

// 최근 limit개(since 이후만). 깨진 줄은 건너뜀. room 주면 그 방만(안 주면 전 방 — 알림·엔진용)
export function readMsgs(root: string, since = 0, limit = 400, oldest = false, room?: string): CrewMsg[] {
  const f = chatFile(root);
  if (!existsSync(f)) return [];
  const out: CrewMsg[] = [];
  for (const line of readFileSync(f, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const m = JSON.parse(line) as CrewMsg;
      if (typeof m.id === "string" && typeof m.ts === "number" && typeof m.from === "string" && KINDS.has(m.kind) && typeof m.text === "string" && m.ts >= since && (room === undefined || inRoom(m, room))) out.push(m); // >= — 같은 ms 메시지 유실 방지(화면이 id로 중복 제거, 리뷰)
    } catch { /* 쓰다 죽은 줄 */ }
  }
  return oldest ? out.slice(0, limit) : out.slice(-limit); // #1167 oldest = 알림 확인(since가 한 쪽씩 앞으로 — 400개 넘게 밀려도 안 빠짐)
}

// #1392 방 목록 — 방마다 마지막 글·글 수(목록 미리보기). 파일 한 번 훑기.
export interface RoomSummary { room: string; last: Pick<CrewMsg, "from" | "kind" | "text" | "ts" | "i18n">; count: number }
const sumCache = new Map<string, { sig: string; v: RoomSummary[] }>(); // 목록이 5초마다 부름 — 파일이 그대로면 다시 안 훑음(리뷰)
export function roomSummaries(root: string): RoomSummary[] {
  const f = chatFile(root);
  let sig = "";
  try { const st = statSync(f); sig = `${st.size}:${st.mtimeMs}`; } catch { return []; }
  const hit = sumCache.get(f);
  if (hit?.sig === sig) return hit.v;
  const by = new Map<string, RoomSummary>();
  for (const m of readMsgs(root, 0, 100_000)) {
    const room = m.room ?? "";
    const prev = by.get(room);
    by.set(room, { room, last: { from: m.from, kind: m.kind, text: m.text.slice(0, 200), ts: m.ts, ...(m.i18n ? { i18n: m.i18n } : {}) }, count: (prev?.count ?? 0) + 1 });
  }
  const v = [...by.values()].sort((a, b) => b.last.ts - a.last.ts);
  sumCache.set(f, { sig, v });
  return v;
}

export const findMsg = (root: string, id: string) => readMsgs(root, 0, 100_000).find((m) => m.id === id);

// "@app-builder 이거 해줘" → 언급된 역할 id들(알려진 것만, 순서 유지·중복 제거)
export function parseMentions(text: string, known: Set<string>): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/@([a-z0-9][a-z0-9-]{0,39})/gi)) { const id = m[1].toLowerCase(); if (known.has(id) && !out.includes(id)) out.push(id); }
  return out;
}
