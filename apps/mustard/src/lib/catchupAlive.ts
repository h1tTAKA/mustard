// 앱이 꺼져 있던 구간(#1068) — 서버(앱과 함께 뜨고 꺼짐)가 30초마다 하트비트 파일에 시각을 씀.
// 이 프로세스가 처음 물어볼 때: 이전 하트비트(지난 실행의 마지막 생존) ~ 이번 시작 = 꺼진 구간. 프로세스당 한 번만 돌려줌.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { aliveFile } from "@/lib/catchupStore";

const BEAT_MS = 30_000;
const MIN_GAP = 2 * 60_000;            // 이보다 짧으면 재시작 잠깐 — 무시
const MAX_GAP = 3 * 24 * 60 * 60_000;  // 아주 오래 꺼져 있었으면 최근 3일만
const g = globalThis as unknown as { __mustardAlive?: { prev: number; boot: number; taken: boolean } };

function beat() { try { mkdirSync(dirname(aliveFile()), { recursive: true }); writeFileSync(aliveFile(), JSON.stringify({ ts: Date.now() })); } catch { /* 디스크 문제 — 다음 박동 */ } }

// 하트비트 시작(처음 한 번) — 시작 전에 지난 실행의 마지막 시각을 읽어 둠.
export function ensureAlive(): void {
  if (g.__mustardAlive) return;
  let prev = 0; try { prev = Number(JSON.parse(readFileSync(aliveFile(), "utf8")).ts) || 0; } catch { /* 첫 실행 */ }
  g.__mustardAlive = { prev, boot: Date.now(), taken: false };
  beat(); setInterval(beat, BEAT_MS).unref?.();
}

// 꺼진 구간 [from, to] — 이 프로세스에서 처음 한 번만(두 번째부터 null). 첫 실행·짧은 재시작이면 null.
export function takeDownWindow(): { from: number; to: number } | null {
  ensureAlive();
  const a = g.__mustardAlive!;
  if (a.taken) return null;
  a.taken = true;
  if (!a.prev || a.boot - a.prev < MIN_GAP) return null;
  return { from: Math.max(a.prev, a.boot - MAX_GAP), to: a.boot };
}
