"use client";
// #1239 레포별 캐치업 설정 — 서버 prefs.json(이 레포만 끈 항목). 실제 적용 = 전역 켬 && 여기서 안 끔.
// 같은 창의 캐치업 화면·커밋 자동 설명이 같은 값을 보게 레포별 작은 저장소(모듈) + 구독. 규칙(#1238 별표에서 배운 것, 리뷰):
//  · 읽기·저장은 레포마다 한 줄로 차례대로 — 응답 순서 = 요청 순서.
//  · 화면 = 서버가 알려준 값 + 아직 저장 확정 안 된 변경(pending). 서버는 항목 하나씩 바꿔서 창 여러 개여도 서로 안 덮음.
//  · 처음 읽기 전(loaded=false)엔 분석을 꺼진 것으로 봄(못 읽으면 5초 뒤 다시) — 끈 분석이 첫 순간 돌지 않게.
import { useCallback, useSyncExternalStore } from "react";
import type { RepoPrefKey } from "@/lib/catchupStore";

export type { RepoPrefKey };
type Repo = { server: RepoPrefKey[]; pending: Map<RepoPrefKey, { off: boolean; n: number }>; loaded: boolean; view: { off: RepoPrefKey[]; loaded: boolean } };
const repos = new Map<string, Repo>();
const subs = new Map<string, Set<() => void>>();
const chain = new Map<string, Promise<unknown>>();
let seq = 0;
const EMPTY = { off: [] as RepoPrefKey[], loaded: false };

const repoOf = (root: string): Repo => {
  let r = repos.get(root);
  if (!r) { r = { server: [], pending: new Map(), loaded: false, view: EMPTY }; repos.set(root, r); }
  return r;
};
// 서버 값 + 대기 변경 → 화면 값(새 객체로 바꿔 구독자 깨움)
const publish = (root: string) => {
  const r = repoOf(root);
  const off = r.server.filter((k) => r.pending.get(k)?.off !== false);
  for (const [k, p] of r.pending) if (p.off && !off.includes(k)) off.push(k);
  r.view = { off, loaded: r.loaded };
  subs.get(root)?.forEach((f) => f());
};
const inLine = <T,>(root: string, f: () => Promise<T>) => { const p = (chain.get(root) ?? Promise.resolve()).catch(() => {}).then(f); chain.set(root, p); return p; };
const fetchJson = (url: string, init?: RequestInit) => fetch(url, { ...init, signal: AbortSignal.timeout(8000) }).then((r) => r.json()).catch(() => null);
const load = (root: string) => inLine(root, () => fetchJson(`/api/repo/stream/prefs?root=${encodeURIComponent(root)}`)).then((j) => {
  const r = repoOf(root);
  if (j?.ok && Array.isArray(j.off)) { r.server = j.off as RepoPrefKey[]; r.loaded = true; publish(root); return true; }
  return false;
});
const started = new Set<string>();
const ensure = (root: string) => {
  if (!root || started.has(root)) return;
  started.add(root);
  const tryLoad = () => void load(root).then((ok) => { if (!ok) setTimeout(tryLoad, 5000); });
  tryLoad();
};

export function useCatchupRepoPrefs(root: string) {
  const subscribe = useCallback((f: () => void) => {
    ensure(root);
    let set = subs.get(root); if (!set) { set = new Set(); subs.set(root, set); }
    set.add(f);
    return () => { set!.delete(f); };
  }, [root]);
  const view = useSyncExternalStore(subscribe, () => (root ? repoOf(root).view : EMPTY), () => EMPTY);
  const isOff = useCallback((k: RepoPrefKey) => view.off.includes(k), [view]);
  // 바꾸면 화면은 바로(대기 변경), 저장은 줄에 서서. 실패면 그 변경을 지우고 서버 값을 다시 읽음(false — 호출부가 안내).
  const set = useCallback((k: RepoPrefKey, off: boolean) => {
    const r = repoOf(root), n = ++seq;
    r.pending.set(k, { off, n }); publish(root);
    return inLine(root, () => fetchJson("/api/repo/stream/prefs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ root, key: k, off }) }))
      .then((j) => {
        if (r.pending.get(k)?.n === n) r.pending.delete(k); // 그새 또 바꿨으면 그 변경이 화면을 맡음
        if (j?.ok && Array.isArray(j.off)) { r.server = j.off as RepoPrefKey[]; r.loaded = true; publish(root); return true; }
        publish(root); void load(root);
        return false;
      });
  }, [root]);
  return { off: view.off, loaded: view.loaded, isOff, set };
}
