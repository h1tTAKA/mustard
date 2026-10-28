"use client";
// 설정 > 터미널 > 세션 관리(#1211) — 데몬이 들고 있는 터미널 세션(앱을 꺼도 살아 있음) 목록과 끄기.
// 데스크톱 앱(Mustard)에만 있는 IPC라 타입은 여기서만 좁혀 씀(nunopi 단독 앱 타입엔 terminal이 없음).
import { useCallback, useEffect, useState } from "react";
import { IconRefresh, IconX, IconLoader2 } from "@tabler/icons-react";
import { useT, useConfirm } from "@mustard/core";

type Session = { id: string; cwd: string; process: string; pid: number; agent: string | null; sessionTitle: string };
type TermApi = { list(): Promise<Session[]>; kill(p: { id: string }): void };
const termApi = (): TermApi | undefined => (typeof window === "undefined" ? undefined : (window.nunopiDesktop as unknown as { terminal?: TermApi } | undefined)?.terminal);

// 홈 아래 경로는 ~로, 길면 마지막 두 단계만(표에서 한눈에)
function shortCwd(cwd: string): string {
  const home = cwd.match(/^\/(Users|home)\/[^/]+/)?.[0];
  const p = home && (cwd === home || cwd.startsWith(`${home}/`)) ? `~${cwd.slice(home.length)}` : cwd;
  const parts = p.split("/").filter(Boolean);
  return parts.length > 3 ? `…/${parts.slice(-2).join("/")}` : p || "/";
}

export default function TerminalSessionsSection() {
  const t = useT();
  const confirm = useConfirm();
  const [list, setList] = useState<Session[] | null>(null);
  const refresh = useCallback(() => { setList(null); void termApi()?.list().then(setList).catch(() => setList([])); }, []);
  useEffect(() => { refresh(); }, [refresh]);
  if (!termApi()) return null;

  const kill = async (s: Session) => {
    if (!(await confirm({ title: t("sessions.killTitle"), message: t("sessions.killConfirm", { name: s.agent || s.process || shortCwd(s.cwd) }), confirmText: t("sessions.kill"), tone: "warn" }))) return;
    termApi()?.kill({ id: s.id });
    setTimeout(refresh, 400); // 데몬이 pty를 정리한 뒤 다시 읽음
  };

  return (
    <div className="space-y-2 border-t border-zinc-200 pt-4 dark:border-zinc-800">
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">{t("sessions.title")}</span>
        {list && <span className="rounded-full border border-zinc-200 px-2 py-0.5 text-[11px] text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">{list.length}</span>}
        <button type="button" onClick={refresh} title={t("sessions.refresh")} aria-label={t("sessions.refresh")} className="ml-auto rounded p-1 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200">
          <IconRefresh size={14} stroke={2} aria-hidden />
        </button>
      </div>
      <p className="text-xs text-zinc-400 dark:text-zinc-500">{t("sessions.desc")}</p>
      <div className="max-h-72 divide-y divide-zinc-100 overflow-y-auto rounded-xl border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-700">
        {list === null ? <div className="flex items-center gap-1.5 px-3 py-2 text-xs text-zinc-400"><IconLoader2 size={12} className="animate-spin" aria-hidden />{t("sessions.loading")}</div>
          : list.length === 0 ? <div className="px-3 py-2 text-xs text-zinc-400">{t("sessions.empty")}</div>
          : list.map((s) => (
            <div key={s.id} className="group flex items-center gap-2.5 px-3 py-1.5">
              <span className={`size-1.5 shrink-0 rounded-full ${s.agent ? "bg-mustard-500" : "bg-emerald-500"}`} aria-hidden />
              <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-zinc-700 dark:text-zinc-300" title={s.cwd}>{shortCwd(s.cwd)}</span>
              <span className="max-w-[40%] shrink-0 truncate text-[11px] text-zinc-400 dark:text-zinc-500" title={s.sessionTitle || undefined}>{s.agent || s.process}{s.sessionTitle ? ` · ${s.sessionTitle}` : ""}</span>
              <button type="button" onClick={() => void kill(s)} title={t("sessions.kill")} aria-label={t("sessions.killFor", { name: shortCwd(s.cwd) })}
                className="shrink-0 rounded p-0.5 text-zinc-300 transition hover:bg-rose-50 hover:text-rose-500 dark:text-zinc-600 dark:hover:bg-rose-500/10"><IconX size={13} stroke={2} aria-hidden /></button>
            </div>
          ))}
      </div>
    </div>
  );
}
