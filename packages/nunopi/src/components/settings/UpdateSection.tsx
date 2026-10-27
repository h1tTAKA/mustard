"use client";
// 업데이트(#1200) — 지금 버전 + 지금 확인 + 자동 확인. 새 버전이면 릴리스 페이지 링크(다운로드·설치는 배포 채널 생기면).
import { useState } from "react";
import { IconLoader2, IconExternalLink } from "@tabler/icons-react";
import { useT, useSetting, setSetting, UPDATE_KEYS } from "@mustard/core";

type Result = { ok: boolean; current: string; latest?: string | null; newer?: boolean; url?: string | null };

export default function UpdateSection() {
  const t = useT();
  const auto = useSetting<boolean>(UPDATE_KEYS.auto, true);
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<Result | null>(null);
  const run = async () => {
    setBusy(true);
    const r = await window.nunopiDesktop?.checkUpdate?.().catch(() => null);
    setBusy(false); setRes(r ?? { ok: false, current: "" });
    if (r?.ok) setSetting(UPDATE_KEYS.lastAt, Date.now());
  };
  const status = !res ? null : !res.ok ? t("update.failed") : res.newer ? t("update.available", { v: res.latest ?? "" }) : t("update.upToDate");
  return (
    <section id="set-update" className="scroll-mt-4 space-y-4 rounded-2xl border border-zinc-200 p-4 dark:border-zinc-800">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">{t("update.check")}</p>
          <p className="text-xs text-zinc-400 dark:text-zinc-500">{res?.current ? t("update.current", { v: res.current }) : t("update.checkDesc")}</p>
        </div>
        <button type="button" onClick={() => void run()} disabled={busy}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-700 transition hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800">
          {busy && <IconLoader2 size={12} className="animate-spin" aria-hidden />}{t("update.checkNow")}
        </button>
      </div>
      {status && (
        <div className={`flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-xs ${res?.newer ? "bg-mustard-500/10 text-mustard-700 dark:text-mustard-400" : "bg-zinc-50 text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400"}`} role="status">
          <span>{status}</span>
          {res?.newer && res.url && <button type="button" onClick={() => void window.nunopiDesktop?.openExternal?.(res.url!)} className="inline-flex items-center gap-1 font-medium hover:underline">{t("update.open")}<IconExternalLink size={12} aria-hidden /></button>}
        </div>
      )}
      <label className="flex items-center justify-between gap-3">
        <span className="min-w-0">
          <span className="block text-sm text-zinc-700 dark:text-zinc-300">{t("update.auto")}</span>
          <span className="block text-xs text-zinc-400 dark:text-zinc-500">{t("update.autoDesc")}</span>
        </span>
        <input type="checkbox" checked={auto} onChange={(e) => setSetting(UPDATE_KEYS.auto, e.target.checked)} className="size-4 shrink-0 accent-mustard-500" />
      </label>
    </section>
  );
}
