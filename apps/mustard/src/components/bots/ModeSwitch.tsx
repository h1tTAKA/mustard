"use client";
// 작업 모드 전환(#1397, 에픽 #1391 재정의 2) — 창 왼쪽 위 [레포 | 봇]. 레포 = 레포 탭 화면, 봇 = 봇 홈(레포 없이).
// 버튼 둘 + aria-pressed. 탭 역할(tablist)은 방향키 이동까지 갖춰야 해서 안 씀(리뷰).
import { IconFolder, IconRobot } from "@tabler/icons-react";
import { useT } from "@mustard/core";

export type WsMode = "repo" | "bots";

export default function ModeSwitch({ mode, onChange }: { mode: WsMode; onChange: (m: WsMode) => void }) {
  const t = useT();
  const items = [
    { id: "repo" as const, Icon: IconFolder, label: t("bots.modeRepo") },
    { id: "bots" as const, Icon: IconRobot, label: t("bots.modeBots") },
  ];
  return (
    <div role="group" aria-label={t("bots.modeLabel")}
      className="flex shrink-0 gap-0.5 rounded-lg bg-zinc-100 p-0.5 ring-1 ring-inset ring-zinc-200 dark:bg-zinc-800/60 dark:ring-zinc-700/60">
      {items.map(({ id, Icon, label }) => {
        const on = mode === id;
        return (
          <button key={id} type="button" aria-pressed={on} aria-label={label} title={label} onClick={() => onChange(id)}
            className={`flex h-6 items-center gap-1.5 whitespace-nowrap rounded-md px-2.5 text-[12px] max-[960px]:px-2 transition ${on ? "bg-white font-semibold text-zinc-900 shadow-sm dark:bg-zinc-700 dark:text-zinc-50" : "font-medium text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"}`}>
            <Icon size={14} stroke={2} className={on && id === "bots" ? "text-mustard-600 dark:text-mustard-400" : ""} aria-hidden />
            <span className="max-[960px]:hidden">{label}</span>{/* 좁은 창은 아이콘만(헤더가 이미 빽빽, 리뷰) */}
          </button>
        );
      })}
    </div>
  );
}
