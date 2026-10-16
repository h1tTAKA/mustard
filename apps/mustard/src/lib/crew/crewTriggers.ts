// Crew 자동 계기(#1112, 에픽 #1097) — CI 실패·라벨 이슈·예약으로 카드를 저절로(Dots식 상시 에이전트). 서버 전용.
// 저장 = ~/.nunopi/crew/<sha(root)>/triggers.json. 판단 함수(scheduleDue·fresh)는 순수 — 점검 가능.
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

export type TriggerKind = "ci-failed" | "issue-label" | "schedule";
export interface CrewTrigger {
  id: string; kind: TriggerKind; enabled: boolean;
  pipeline: string[];                 // 빈 배열 = 자동 배정(범위 기획자부터)
  label?: string;                     // issue-label
  branch?: string;                    // ci-failed 대상(비면 레포 기본 브랜치)
  at?: string; everyHours?: number;   // schedule — 매일 "HH:MM" 또는 N시간마다
  title?: string; body?: string;      // schedule 카드 내용
  seen: string[];                     // 이미 카드로 만든(또는 켤 때 있던) CI 실행·이슈 id
  primed?: boolean;                   // 처음 한 번은 지금 있는 것을 '본 것'으로만(켜자마자 옛날 것 폭주 방지)
  lastFired?: number; lastError?: string; createdAt: number;
}

const normPath = (p: string) => p.replace(/\/+$/, "");
const sha = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 32);
const baseDir = () => process.env.MUSTARD_CREW_DIR || join(homedir(), ".nunopi", "crew");
const file = (root: string) => join(baseDir(), sha(normPath(root)), "triggers.json");
const ROLE_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;

function clean(x: unknown): CrewTrigger | null {
  if (!x || typeof x !== "object") return null;
  const t = x as Record<string, unknown>;
  if (typeof t.id !== "string" || !["ci-failed", "issue-label", "schedule"].includes(String(t.kind))) return null;
  const str = (v: unknown, n: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, n) : undefined);
  const at = str(t.at, 5);
  return {
    id: t.id.slice(0, 64), kind: t.kind as TriggerKind, enabled: t.enabled !== false,
    pipeline: Array.isArray(t.pipeline) ? t.pipeline.filter((r): r is string => typeof r === "string" && ROLE_RE.test(r)).slice(0, 20) : [],
    ...(str(t.label, 100) ? { label: str(t.label, 100) } : {}),
    ...(str(t.branch, 200) ? { branch: str(t.branch, 200) } : {}),
    ...(at && /^([01]\d|2[0-3]):[0-5]\d$/.test(at) ? { at } : {}),
    ...(typeof t.everyHours === "number" && t.everyHours >= 1 && t.everyHours <= 168 ? { everyHours: Math.floor(t.everyHours) } : {}),
    ...(str(t.title, 200) ? { title: str(t.title, 200) } : {}),
    ...(str(t.body, 8000) ? { body: str(t.body, 8000) } : {}),
    seen: Array.isArray(t.seen) ? t.seen.filter((s): s is string => typeof s === "string").slice(-500) : [],
    ...(t.primed === true ? { primed: true } : {}),
    ...(typeof t.lastFired === "number" ? { lastFired: t.lastFired } : {}),
    ...(str(t.lastError, 400) ? { lastError: str(t.lastError, 400) } : {}),
    createdAt: typeof t.createdAt === "number" ? t.createdAt : Date.now(),
  };
}

export function readTriggers(root: string): CrewTrigger[] {
  try { const j = JSON.parse(readFileSync(file(root), "utf8")); return Array.isArray(j) ? j.map(clean).filter((t): t is CrewTrigger => !!t) : []; } catch { return []; }
}
export function writeTriggers(root: string, list: CrewTrigger[]) {
  const f = file(root);
  mkdirSync(dirname(f), { recursive: true });
  writeFileSync(`${f}.tmp`, JSON.stringify(list, null, 1));
  renameSync(`${f}.tmp`, f);
}
export const hasTriggers = (root: string) => existsSync(file(root));

export type TriggerOp =
  | { op: "save"; trigger: Partial<CrewTrigger> & { kind: TriggerKind } } // id 없으면 새로
  | { op: "delete"; id: string };

export function applyTriggerOp(root: string, op: TriggerOp, now = Date.now()): CrewTrigger[] {
  const list = readTriggers(root);
  if (op.op === "delete") { writeTriggers(root, list.filter((t) => t.id !== op.id)); return readTriggers(root); }
  if (op.op !== "save") throw new Error("unknown op");
  const i = op.trigger.id ? list.findIndex((t) => t.id === op.trigger.id) : -1;
  const prev = i >= 0 ? list[i] : undefined;
  // 조건이 바뀌면(라벨·브랜치) 다시 '처음'부터 — 그 조건의 지금 것을 본 것으로
  const condChanged = prev && (prev.label !== op.trigger.label || prev.branch !== op.trigger.branch || prev.kind !== op.trigger.kind);
  const merged = clean({ ...prev, ...op.trigger, id: prev?.id ?? randomUUID(), createdAt: prev?.createdAt ?? now, seen: condChanged ? [] : prev?.seen ?? [], primed: condChanged ? false : prev?.primed ?? false });
  if (!merged) throw new Error("bad trigger");
  if (merged.kind === "issue-label" && !merged.label) throw new Error("label required");
  if (merged.kind === "schedule" && !merged.at && !merged.everyHours) throw new Error("schedule time required");
  if (merged.kind === "schedule" && !merged.title) throw new Error("title required");
  if (i >= 0) list[i] = merged; else list.push(merged);
  writeTriggers(root, list);
  return readTriggers(root);
}

// 예약이 지금 발동할 때인가 — 매일 HH:MM(오늘 그 시각이 지났고 오늘 아직 안 함) 또는 N시간마다(마지막 발동 + N시간).
export function scheduleDue(t: Pick<CrewTrigger, "at" | "everyHours" | "lastFired" | "createdAt">, now: number): boolean {
  if (t.everyHours) return now - (t.lastFired ?? t.createdAt) >= t.everyHours * 3_600_000;
  if (!t.at) return false;
  const [h, m] = t.at.split(":").map(Number);
  const today = new Date(now); today.setHours(h, m, 0, 0);
  if (now < today.getTime()) return false;
  return (t.lastFired ?? t.createdAt) < today.getTime(); // 오늘 그 시각 이후 아직 안 함(만든 직후 지난 시각은 내일부터)
}

// 새로 나타난 것만(본 것 제외), 순서 유지
export const freshIds = (seen: string[], ids: string[]) => ids.filter((id) => !seen.includes(id));
