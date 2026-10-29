"use client";
// #1239 캐치업 창 레포별 설정 — 카테고리마다 [표시][분석]. 전역(설정 > 캐치업)에서 켠 것만 여기서 끌 수 있음(전역 꺼짐 = 회색·못 바꿈).
// 줄·스위치 모양은 설정 > 캐치업 표와 같게(새 디자인 X), 열고 닫기는 캘린더 팝오버와 같게(바깥 클릭·Esc).
import { useEffect, useRef } from "react";
import { useT, useSetting, useToast, CUKEYS, CATCHUP_DEFAULTS, GKEYS, GIT_DEFAULTS } from "@mustard/core";
import type { RepoPrefKey } from "@/lib/useCatchupRepoPrefs";

export default function CatchupRepoPrefs({ isOff, set, onClose }: { isOff: (k: RepoPrefKey) => boolean; set: (k: RepoPrefKey, off: boolean) => Promise<boolean>; onClose: () => void }) {
  const t = useT();
  const toast = useToast();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const down = (e: MouseEvent) => { const el = e.target as Element; if (ref.current && !ref.current.contains(el) && !el.closest?.("[data-prefs-toggle]")) onClose(); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("mousedown", down); document.addEventListener("keydown", key);
    return () => { document.removeEventListener("mousedown", down); document.removeEventListener("keydown", key); };
  }, [onClose]);
  const g = {
    explainShow: useSetting<boolean>(CUKEYS.explainShow, CATCHUP_DEFAULTS.explainShow), explainAnalyze: useSetting<boolean>(CUKEYS.explainAnalyze, CATCHUP_DEFAULTS.explainAnalyze),
    commandsShow: useSetting<boolean>(CUKEYS.commandsShow, CATCHUP_DEFAULTS.commandsShow), commandsAnalyze: useSetting<boolean>(CUKEYS.commandsAnalyze, CATCHUP_DEFAULTS.commandsAnalyze),
    diffShow: useSetting<boolean>(CUKEYS.diffShow, CATCHUP_DEFAULTS.diffShow), diffAnalyze: useSetting<boolean>(GKEYS.autoExplainCommits, GIT_DEFAULTS.autoExplainCommits),
    sessionsShow: useSetting<boolean>(CUKEYS.sessionsShow, CATCHUP_DEFAULTS.sessionsShow), sessionsAnalyze: useSetting<boolean>(CUKEYS.sessionsAnalyze, CATCHUP_DEFAULTS.sessionsAnalyze),
    termsShow: useSetting<boolean>(CUKEYS.termsShow, CATCHUP_DEFAULTS.termsShow), termsAnalyze: useSetting<boolean>(CUKEYS.termsAnalyze, CATCHUP_DEFAULTS.termsAnalyze),
  } as Record<RepoPrefKey, boolean>;
  const rows: [string, string][] = [["explain", t("settings.catchupExplain")], ["commands", t("settings.catchupCommands")], ["diff", t("settings.catchupDiff")], ["sessions", t("settings.catchupSessions")], ["terms", t("settings.catchupTerms")]];
  const flip = async (k: RepoPrefKey) => { if (!(await set(k, !isOff(k)))) toast(t("learn.repoPrefsFailed")); };
  return (
    <div ref={ref} role="dialog" aria-label={t("learn.repoPrefs")}
      className="absolute right-2 top-full z-30 mt-1 w-72 rounded-xl border border-zinc-200 bg-white p-3 shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
      <p className="text-[12px] font-semibold text-zinc-700 dark:text-zinc-200">{t("learn.repoPrefs")}</p>
      <p className="mb-2 text-[11px] text-zinc-400 dark:text-zinc-500">{t("learn.repoPrefsDesc")}</p>
      <div className="flex flex-col gap-2">
        {rows.map(([id, label]) => (
          <div key={id} className="flex items-center justify-between gap-3">
            <span className="min-w-0 truncate text-[12px] font-medium text-zinc-700 dark:text-zinc-300">{label}</span>
            <div className="flex shrink-0 items-center gap-3">
              {([["Show", t("settings.catchupShow")], ["Analyze", t("settings.catchupAnalyze")]] as const).map(([suf, cap]) => {
                const k = `${id}${suf}` as RepoPrefKey; const globalOn = g[k]; const on = globalOn && !isOff(k);
                return (
                  <div key={suf} className="flex flex-col items-center gap-1" title={globalOn ? undefined : t("learn.repoPrefsGlobalOff")}>
                    <span className="text-[10px] font-medium text-zinc-400 dark:text-zinc-500">{cap}</span>
                    <button type="button" role="switch" aria-checked={on} aria-label={`${label} ${cap}`} disabled={!globalOn} onClick={() => void flip(k)}
                      className={`relative h-6 w-11 shrink-0 rounded-full transition disabled:opacity-50 ${on ? "bg-mustard-600 dark:bg-mustard-400" : "bg-zinc-400 dark:bg-zinc-700"}`}>
                      <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${on ? "left-[22px]" : "left-0.5"}`} />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
