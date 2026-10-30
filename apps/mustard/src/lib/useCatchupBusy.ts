"use client";
// #1252 캐치업 "만드는 중" 수 — 이 창 계수기(catchupBusy) + 서버 실시간 해설 수(poll일 때만 3초마다).
// 캐치업 화면(칩별 스피너)과 오른쪽 모드 줄의 캐치업 아이콘(점)이 같이 씀.
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { busyOf, subscribeBusy, type BusyCounts } from "@/lib/catchupBusy";

export function useCatchupBusy(root: string, poll: boolean): BusyCounts & { total: number } {
  const local = useSyncExternalStore(useCallback((f: () => void) => subscribeBusy(root, f), [root]), () => busyOf(root), () => busyOf(""));
  const [narrating, setNarrating] = useState(0);
  useEffect(() => {
    if (!poll) return;
    let alive = true;
    const ask = () => fetch(`/api/repo/learn/busy?root=${encodeURIComponent(root)}`).then((r) => r.json())
      .then((j) => { if (alive && typeof j?.narrating === "number") setNarrating(j.narrating); }).catch(() => {});
    void ask();
    const id = setInterval(() => void ask(), 3000);
    return () => { alive = false; clearInterval(id); };
  }, [poll, root]);
  const explain = local.explain + (poll ? narrating : 0); // 안 물어보는 동안의 옛 값은 안 셈
  return { ...local, explain, total: explain + local.commands + local.diff + local.session };
}
