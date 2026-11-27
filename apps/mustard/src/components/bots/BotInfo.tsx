"use client";
// 봇 홈 오른쪽 칸(#1397) — 고른 봇의 이름·설명·실행 AI·권한·봇 폴더·만든 때, 목록에서 빼기.
// 빼기 = 목록에서만(역할·봇 폴더는 남음, H1 uninstall). 이름·색 바꾸기는 H3 설정 창에서.
import { IconFolderOpen, IconTrash } from "@tabler/icons-react";
import { useConfirm, useT, useToast } from "@mustard/core";
import { PROVIDER_LABEL } from "@/components/workspace/crew/crewUi";
import { fmtDateTime } from "@/lib/relTime";
import BotAvatar from "./BotAvatar";
import { botDesc, botName, type Bot } from "./useBots";

export default function BotInfo({ bot, error, onUninstall }: { bot: Bot | null; error: boolean; onUninstall: (id: string) => Promise<boolean> }) {
  const t = useT();
  const confirm = useConfirm();
  const toast = useToast();
  if (!bot) return <p className="px-4 py-5 text-[12.5px] text-zinc-400 dark:text-zinc-500">{t(error ? "bots.loadFailed" : "bots.pickHint")}</p>; // 못 읽었는데 "고르세요"는 거짓 안내(리뷰)
  const name = botName(t, bot);
  const canOpen = typeof window !== "undefined" && !!window.nunopiDesktop?.openIn;
  const openFolder = () => void window.nunopiDesktop?.openIn?.("finder", bot.home).then((r) => { if (!r?.ok) toast(t("openIn.failed", { app: "Finder" }), "error"); }, () => toast(t("openIn.failed", { app: "Finder" }), "error"));
  const uninstall = async () => {
    if (!(await confirm({ title: name, message: t("bots.uninstallConfirm"), detail: t("bots.uninstallDetail"), confirmText: t("bots.uninstall"), tone: "warn" }))) return;
    if (!(await onUninstall(bot.id))) toast(t("bots.uninstallFailed"), "error");
  };
  const row = (label: string, value: React.ReactNode) => (
    <div className="flex flex-col gap-0.5">
      <dt className="text-[11.5px] font-medium text-zinc-400 dark:text-zinc-500">{label}</dt>
      <dd className="min-w-0 text-[12.5px] text-zinc-700 dark:text-zinc-200">{value}</dd>
    </div>
  );
  return (
    <div className="nunopi-scroll flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-4 py-5">
      <div className="flex items-center gap-3">
        <BotAvatar name={name} color={bot.color} size={40} />
        <div className="min-w-0">
          <div className="truncate text-[14px] font-semibold text-zinc-900 dark:text-zinc-50">{name}</div>
          <div className="text-[11.5px] text-zinc-400 dark:text-zinc-500">{t("bots.info.created", { when: fmtDateTime(new Date(bot.createdAt).toISOString()) })}</div>
        </div>
      </div>
      <p className="text-[12.5px] leading-relaxed text-zinc-600 dark:text-zinc-300">{botDesc(t, bot)}</p>
      <dl className="flex flex-col gap-3">
        {row(t("bots.info.provider"), PROVIDER_LABEL[bot.provider] ?? bot.provider)}
        {row(t("bots.info.access"), t(`crew.access.${bot.access}`))}
        {row(t("bots.info.folder"), (
          <div className="flex items-center gap-1.5">
            <code className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-zinc-500 dark:text-zinc-400" title={bot.home}>{bot.home.replace(/^\/Users\/[^/]+/, "~")}</code>
            {canOpen && (
              <button type="button" onClick={openFolder} title={t("bots.info.openFolder")} aria-label={t("bots.info.openFolder")}
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200">
                <IconFolderOpen size={14} stroke={2} aria-hidden />
              </button>
            )}
          </div>
        ))}
      </dl>
      <div className="flex-1" />
      <button type="button" onClick={uninstall}
        className="inline-flex items-center justify-center gap-1.5 self-start rounded-lg px-2.5 py-1.5 text-[12px] font-medium text-zinc-500 transition hover:bg-rose-500/10 hover:text-rose-600 dark:text-zinc-400 dark:hover:text-rose-400">
        <IconTrash size={14} stroke={2} aria-hidden /> {t("bots.uninstall")}
      </button>
    </div>
  );
}
