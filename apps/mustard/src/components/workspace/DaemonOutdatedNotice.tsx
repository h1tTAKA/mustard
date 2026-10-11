"use client";

// 옛 터미널 데몬 알림(#1036) — 데몬은 앱 재시작에도 살아남아 옛 코드로 돌 수 있음(예: 완료 알림 훅이 꺼진 9월 데몬).
// 레이아웃을 건드리지 않게 오른쪽 아래 작은 카드. 재시작하면 열린 터미널이 꺼지니 유저가 고름("나중에" = 이번 실행 동안 숨김).
import { useEffect, useState } from "react";
import { IconAlertTriangle, IconLoader2 } from "@tabler/icons-react";
import { useT } from "@mustard/core";

export default function DaemonOutdatedNotice() {
  const t = useT();
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const api = window.nunopiDesktop?.daemon;
    if (!api) return;
    let alive = true;
    const t1 = setTimeout(() => { void api.status().then((s) => { if (alive && s.outdated) setShow(true); }).catch(() => {}); }, 3000); // 부팅 직후 연결 정착 뒤
    return () => { alive = false; clearTimeout(t1); };
  }, []);
  if (!show) return null;
  const restart = async () => {
    setBusy(true);
    const r = await window.nunopiDesktop?.daemon?.restart().catch(() => ({ ok: false }));
    if (!r?.ok) setBusy(false); // 성공이면 앱이 재실행됨
  };
  return (
    <div role="status" className="fixed bottom-4 right-4 z-[60] w-[320px] rounded-lg border border-amber-300 bg-white p-3 text-[12px] shadow-lg dark:border-amber-700/60 dark:bg-zinc-900">
      <div className="flex items-start gap-2">
        <IconAlertTriangle size={15} stroke={2} className="mt-0.5 shrink-0 text-amber-500" aria-hidden />
        <div className="min-w-0 flex-1">
          <div className="font-medium text-zinc-800 dark:text-zinc-100">{t("daemon.outdatedTitle")}</div>
          <div className="mt-0.5 leading-relaxed text-zinc-500 dark:text-zinc-400">{t("daemon.outdatedBody")}</div>
          <div className="mt-2 flex justify-end gap-1.5">
            <button type="button" onClick={() => setShow(false)} className="rounded-md px-2 py-0.5 text-[11px] text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800">{t("daemon.later")}</button>
            <button type="button" disabled={busy} onClick={() => void restart()} className="inline-flex items-center gap-1 rounded-md bg-mustard-500 px-2 py-0.5 text-[11px] font-medium text-zinc-900 hover:bg-mustard-400 disabled:opacity-50">
              {busy && <IconLoader2 size={11} className="animate-spin" aria-hidden />}{t("daemon.restart")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
