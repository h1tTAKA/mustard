"use client";
// 아키텍처 작업 목록(#1329) — 분석·흐름·깊이별 설명·둘러보기를 화면 밖(모듈)에서 추적. 화면을 떠나도 작업은 계속 돌고
// 돌아온 화면이 구독해 진행 표시·멈춤·이어하기를 보여 줌. 같은 키가 돌고 있으면 새로 시작하지 않음(중복 AI 호출 방지).
// 키: archJobKey(root, kind, feature). 한계: 앱을 끄면 목록·부분 결과는 사라짐(저장된 결과는 서버에 남음).
import { useSyncExternalStore } from "react";

export type ArchJobKind = "analyze" | "flow" | "depth" | "tour";
export type ArchJobStatus = "running" | "stopped" | "done" | "error";
export interface ArchJob {
  status: ArchJobStatus;
  mode?: string;                        // 어떤 동작인지(분석: reanalyze/update, 흐름: regen/update) — 이어하기 때 같은 동작으로
  done?: number; total?: number;        // 진행(둘러보기 묶음 등)
  partial?: unknown;                    // 이어하기용 부분 결과(둘러보기: 끝난 노드 설명)
  ctrl: AbortController;
  seq: number;                          // 끝남 알림 구분(같은 키를 다시 돌려도 화면이 새 끝남을 알게)
}

const jobs = new Map<string, ArchJob>();
const subs = new Set<() => void>();
let seq = 0;
const emit = () => { for (const f of subs) f(); };

export const archJobKey = (root: string, kind: ArchJobKind, feature = "") => `${root}\0${kind}\0${feature}`;
export const jobOf = (key: string): ArchJob | undefined => jobs.get(key);
export const isRunning = (key: string) => jobs.get(key)?.status === "running";

// 시작 — 이미 돌고 있으면 null(중복 방지). 멈춘 잡의 부분 결과는 이어받음(partial).
export function startJob(key: string, mode?: string): { signal: AbortSignal; partial: unknown; progress: (done: number, total: number, partial?: unknown) => void; finish: (ok: boolean) => void } | null {
  const prev = jobs.get(key);
  if (prev?.status === "running") return null;
  const ctrl = new AbortController();
  const job: ArchJob = { status: "running", mode, ctrl, seq: ++seq, partial: prev?.status === "stopped" ? prev.partial : undefined };
  jobs.set(key, job);
  emit();
  const mine = () => { const c = jobs.get(key); return c?.ctrl === ctrl && c.status === "running"; }; // 진행 때마다 새 객체로 바뀌니 ctrl로 확인(리뷰)
  return {
    signal: ctrl.signal,
    partial: job.partial,
    progress: (done, total, partial) => { if (!mine()) return; jobs.set(key, { ...jobs.get(key)!, done, total, ...(partial !== undefined ? { partial } : {}) }); emit(); },
    // 멈춤으로 끊긴 건 stopped 그대로(오류로 덮지 않음). 끝나면 부분 결과는 버림.
    finish: (ok) => { const cur = jobs.get(key); if (!cur || cur.ctrl !== ctrl || cur.status === "stopped") return; jobs.set(key, { ...cur, status: ok ? "done" : "error", partial: undefined, seq: ++seq }); emit(); },
  };
}

// 멈춤 — 요청 취소(서버가 request.signal로 에이전트도 끊음). 부분 결과는 이어하기용으로 남김.
export function stopJob(key: string) {
  const cur = jobs.get(key);
  if (!cur || cur.status !== "running") return;
  cur.ctrl.abort();
  jobs.set(key, { ...cur, status: "stopped", seq: ++seq });
  emit();
}

// 멈춤 표시를 지움(유저가 이어하지 않고 다른 걸 시작하거나 닫을 때).
export function clearJob(key: string) { if (jobs.get(key)?.status !== "running" && jobs.delete(key)) emit(); }

// 이 레포에서 도는 기능들(아키텍처 기능 목록 표시용)
export function runningFeatures(root: string): Set<string> {
  const out = new Set<string>();
  for (const [k, j] of jobs) { const [r, kind, f] = k.split("\0"); if (r === root && j.status === "running" && kind !== "analyze" && f) out.add(f); }
  return out;
}

export function subscribeJobs(f: () => void) { subs.add(f); return () => { subs.delete(f); }; }
let ver = 0;
subs.add(() => { ver++; });
const snap = () => ver;
// 작업 목록이 바뀔 때마다 다시 그림 — 값은 jobOf·runningFeatures로 읽음.
export function useArchJobs(): number { return useSyncExternalStore(subscribeJobs, snap, snap); }
