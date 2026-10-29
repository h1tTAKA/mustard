"use client";
// #1239 레포별 캐치업 설정 — 서버 prefs.json(이 레포만 끈 항목). 실제 적용 = 전역 켬 && 여기서 안 끔.
// 같은 창의 캐치업 화면·커밋 자동 설명이 같은 값을 보게 모듈 캐시 + 이벤트로 나눔.
import { useCallback, useEffect, useMemo, useState } from "react";
import type { RepoPrefKey } from "@/lib/catchupStore";

export type { RepoPrefKey };
const EVT = "nunopi:catchup-repo-prefs"; // detail = { root, off }
const cache = new Map<string, RepoPrefKey[]>();
const NONE: RepoPrefKey[] = [];
const chain = new Map<string, Promise<unknown>>(); // 레포별 저장 줄
const announce = (root: string, off: RepoPrefKey[]) => { cache.set(root, off); window.dispatchEvent(new CustomEvent(EVT, { detail: { root, off } })); };
const load = (root: string) => fetch(`/api/repo/stream/prefs?root=${encodeURIComponent(root)}`).then((r) => r.json())
  .then((j) => (j?.ok && Array.isArray(j.off) ? (j.off as RepoPrefKey[]) : null)).catch(() => null);

export function useCatchupRepoPrefs(root: string) {
  const [got, setGot] = useState<{ root: string; off: RepoPrefKey[] } | null>(null);
  useEffect(() => {
    if (!root) return;
    let alive = true;
    const on = (e: Event) => { const d = (e as CustomEvent<{ root: string; off: RepoPrefKey[] }>).detail; if (d?.root === root) setGot({ root, off: d.off }); };
    window.addEventListener(EVT, on);
    void load(root).then((off) => { if (alive && off) { cache.set(root, off); setGot({ root, off }); } });
    return () => { alive = false; window.removeEventListener(EVT, on); };
  }, [root]);
  // 서버 값 받기 전엔 캐시(다른 훅이 이미 받은 값), 그것도 없으면 다 켬(전과 같음)
  const off = useMemo(() => (got?.root === root ? got.off : cache.get(root) ?? NONE), [got, root]);
  const isOff = useCallback((k: RepoPrefKey) => off.includes(k), [off]);
  // 바꾸면 바로 모든 훅에 알리고 저장. 저장은 레포마다 한 줄로 차례대로(#1238 별표에서 배운 것 — 연타해도 옛 목록이 나중에 덮지 않게),
  //  새 값은 가장 최근 값(cache)에서 계산. 응답으로 덮지 않고, 실패면 서버 값으로 되돌림(false — 호출부가 안내).
  const set = useCallback((k: RepoPrefKey, isOffNow: boolean) => {
    const cur = cache.get(root) ?? off;
    const next = isOffNow ? [...cur.filter((x) => x !== k), k] : cur.filter((x) => x !== k);
    announce(root, next);
    const run = (chain.get(root) ?? Promise.resolve()).catch(() => {}).then(() =>
      fetch("/api/repo/stream/prefs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ root, off: next }), signal: AbortSignal.timeout(8000) })
        .then((r) => r.json()).catch(() => null));
    chain.set(root, run);
    return run.then(async (j) => {
      if (j?.ok) return true;
      const back = await load(root); if (back && chain.get(root) === run) announce(root, back); // 뒤에 또 바꿨으면 그쪽이 맡음
      return false;
    });
  }, [root, off]);
  return { off, isOff, set };
}
