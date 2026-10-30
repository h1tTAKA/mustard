"use client";
// #1252 캐치업 "만드는 중" 수 — 이 창 계수기(catchupBusy) + 서버 실시간 해설 수(poll일 때만 3초마다).
// 캐치업 화면(칩별 스피너)과 오른쪽 모드 줄의 캐치업 아이콘(점)이 같이 씀.
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { busyOf, subscribeBusy, type BusyCounts } from "@/lib/catchupBusy";

export function useCatchupBusy(root: string, poll: boolean): BusyCounts & { total: number } {
  const local = useSyncExternalStore(useCallback((f: () => void) => subscribeBusy(root, f), [root]), () => busyOf(root), () => busyOf(""));
  // 서버 수는 어느 레포 것인지 같이 들고 있음 — 레포가 바뀐 첫 화면에 옛 레포 수가 섞이지 않게(리뷰)
  const [srv, setSrv] = useState({ root: "", n: 0 });
  useEffect(() => {
    if (!poll) return;
    let alive = true;
    const set = (n: number) => { if (alive) setSrv({ root, n }); };
    const ask = () => fetch(`/api/repo/learn/busy?root=${encodeURIComponent(root)}`).then((r) => (r.ok ? r.json() : null))
      .then((j) => set(typeof j?.narrating === "number" ? j.narrating : 0)).catch(() => set(0)); // 실패·이상한 답이면 0(옛 수에 고정되지 않게, 리뷰)
    void ask();
    const id = setInterval(() => void ask(), 3000);
    return () => { alive = false; clearInterval(id); };
  }, [poll, root]);
  const explain = local.explain + (poll && srv.root === root ? srv.n : 0); // 안 물어보는 동안·다른 레포 값은 안 셈
  return { ...local, explain, total: explain + local.commands + local.diff + local.session };
}
