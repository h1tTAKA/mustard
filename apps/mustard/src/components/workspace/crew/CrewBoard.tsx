"use client";
// 에이전트 팀 보드(#1098, 에픽 #1097) — 역할 에이전트에게 칸반 카드로 일을 맡기는 패널. 터미널 오른쪽 도크.
// 커밋2: 패널 껍데기(제목·닫기). 칸반은 커밋3.
import { IconLayoutKanban, IconX } from "@tabler/icons-react";
import { useT } from "@mustard/core";

export default function CrewBoard({ root, onClose }: { root: string; onClose: () => void }) {
  const t = useT();
  return (
    <div className="relative flex h-full min-h-0 w-full flex-col bg-white dark:bg-[var(--s-pane)]" data-root={root}>
      <div className="flex shrink-0 items-center gap-1 border-b border-zinc-200 px-3 py-1.5 pr-6 dark:border-zinc-800">
        <IconLayoutKanban size={14} stroke={2} className="shrink-0 text-mustard-600 dark:text-mustard-400" aria-hidden />
        <span className="mr-auto truncate text-[13px] font-semibold text-zinc-700 dark:text-zinc-200">{t("crew.title")}</span>
        <button type="button" onClick={onClose} title={t("crew.close")} aria-label={t("crew.close")}
          className="shrink-0 rounded p-1 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200">
          <IconX size={13} stroke={2} aria-hidden />
        </button>
      </div>
      <div className="min-h-0 flex-1" />
    </div>
  );
}
