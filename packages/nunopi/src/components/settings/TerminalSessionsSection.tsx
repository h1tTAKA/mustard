"use client";
// 설정 > 터미널 > 세션 관리(#1211) — 데몬이 들고 있는 터미널 세션(앱을 꺼도 살아 있음) 목록과 끄기.
// 데스크톱 앱(Mustard)에만 있는 IPC라 타입은 여기서만 좁혀 씀(nunopi 단독 앱 타입엔 terminal이 없음).
import { useCallback, useEffect, useRef, useState } from "react";
import { IconRefresh, IconX, IconLoader2, IconTrash } from "@tabler/icons-react";
import { useT, useConfirm, useToast, useSetting, setSetting, WKEYS, WORKSPACE_DEFAULTS } from "@mustard/core";

type Session = { id: string; cwd: string; process: string; pid: number; agent: string | null; sessionTitle: string };
type TermApi = { list(opts?: { strict?: boolean }): Promise<Session[] | null>; killSession?(id: string): Promise<boolean>; clearSaved?(): Promise<{ ok: boolean; cleared: number }>; onExit?(cb: (p: { id: string }) => void): () => void };
type DaemonApi = { restart(): Promise<{ ok: boolean; reason?: string }> };
const desk = () => (typeof window === "undefined" ? undefined : (window.nunopiDesktop as unknown as { terminal?: TermApi; daemon?: DaemonApi } | undefined));
const termApi = (): TermApi | undefined => desk()?.terminal;

// 홈 아래 경로는 ~로, 길면 마지막 두 단계만(표에서 한눈에)
function shortCwd(cwd: string): string {
  const home = cwd.match(/^\/(Users|home)\/[^/]+/)?.[0];
  const p = home && (cwd === home || cwd.startsWith(`${home}/`)) ? `~${cwd.slice(home.length)}` : cwd;
  const parts = p.split("/").filter(Boolean);
  return parts.length > 3 ? `…/${parts.slice(-2).join("/")}` : p || "/";
}

export default function TerminalSessionsSection() {
  const t = useT();
  const confirm = useConfirm(), toast = useToast();
  const [busy, setBusy] = useState(false);
  const killOnClose = useSetting<boolean>(WKEYS.killTerminalsOnClose, WORKSPACE_DEFAULTS.killTerminalsOnClose); // 레포 탭 닫을 때 세션도 끄기
  const [list, setList] = useState<Session[] | null>(null);
  const seq = useRef(0); // 겹친 요청 중 마지막 응답만(늦게 온 옛 목록이 덮어쓰지 않게, 리뷰)
  const refresh = useCallback(() => {
    const n = ++seq.current;
    void termApi()?.list().then((l) => { if (n === seq.current) setList(l ?? []); }).catch(() => { if (n === seq.current) setList([]); });
  }, []);
  useEffect(() => { refresh(); }, [refresh]);
  // 세션이 실제로 끝나면(끄기·셸 종료) 목록 다시 — 고정 대기 대신 exit 신호로(리뷰)
  useEffect(() => { const off = termApi()?.onExit?.(() => refresh()); return () => { off?.(); }; }, [refresh]);
  if (!termApi()) return null;

  const kill = async (s: Session) => {
    if (!(await confirm({ title: t("sessions.killTitle"), message: t("sessions.killConfirm", { name: s.agent || s.process || shortCwd(s.cwd) }), confirmText: t("sessions.kill"), tone: "warn" }))) return;
    const ok = await termApi()?.killSession?.(s.id).catch(() => false);
    if (!ok) toast(t("sessions.killFailed"), "error");
  };

  // 전부 끄기 — 에이전트가 일하는 세션도 함께라 개수와 함께 확인
  // 확인 전에 목록을 새로 받아(그 사이 생긴 세션까지) 그 목록을 끔. 에이전트가 도는 세션은 이름을 보여 줌(리뷰)
  const killAll = async () => {
    const ss = await termApi()?.list({ strict: true }).catch(() => null); // 실패(null)와 빈 목록 구분(리뷰)
    if (!ss) { toast(t("sessions.killFailed"), "error"); refresh(); return; } // 목록 조회 자체가 실패
    if (!ss.length) { refresh(); return; } // 그 사이 다 끝남 — 화면만 갱신(리뷰)
    const agents = ss.filter((s) => s.agent).map((s) => `${s.agent} · ${shortCwd(s.cwd)}`);
    const detail = agents.length ? t("sessions.killAllAgents", { list: agents.slice(0, 5).join(", ") + (agents.length > 5 ? ` +${agents.length - 5}` : "") }) : undefined;
    if (!(await confirm({ title: t("sessions.killAllTitle"), message: t("sessions.killAllConfirm", { n: ss.length }), detail, confirmText: t("sessions.killAll"), tone: "warn" }))) return;
    const results = await Promise.all(ss.map((s) => termApi()?.killSession?.(s.id).catch(() => false)));
    if (results.some((r) => !r)) toast(t("sessions.killFailed"), "error");
    refresh();
  };
  // 저장된 스크롤백 — 닫힌 탭이 남긴 화면 기록(앱을 다시 켜면 탭에 다시 보이는 것). 살아 있는 세션은 그대로.
  const clearSaved = async () => {
    if (!(await confirm({ title: t("sessions.clearSaved"), message: t("sessions.clearSavedConfirm"), confirmText: t("sessions.clearDo"), tone: "warn" }))) return;
    const r = await termApi()?.clearSaved?.().catch(() => null);
    toast(r?.ok ? t("sessions.clearedN", { n: r.cleared }) : t("sessions.clearFailed"), r?.ok ? "success" : "error");
  };
  // 데몬 재시작 — 모든 세션이 꺼지고 앱이 다시 켜짐(데몬은 앱보다 오래 살아 옛 코드로 돌 수 있음)
  const restartDaemon = async () => {
    if (!(await confirm({ title: t("sessions.restart"), message: t("sessions.restartConfirm"), confirmText: t("sessions.restartDo"), tone: "warn" }))) return;
    setBusy(true);
    const r = await desk()?.daemon?.restart().catch(() => null);
    if (!r?.ok) { setBusy(false); toast(t("sessions.restartFailed"), "error"); } // 성공이면 앱이 다시 켜짐
  };
  const btn = "inline-flex items-center gap-1 rounded-lg border border-zinc-200 px-2.5 py-1 text-xs font-medium transition disabled:opacity-40 dark:border-zinc-700";

  return (
    <div className="space-y-2 border-t border-zinc-200 pt-4 dark:border-zinc-800">
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">{t("sessions.title")}</span>
        {list && <span className="rounded-full border border-zinc-200 px-2 py-0.5 text-[11px] text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">{list.length}</span>}
        <button type="button" onClick={() => void killAll()} disabled={!list?.length} title={t("sessions.killAll")} aria-label={t("sessions.killAll")} className="ml-auto rounded p-1 text-zinc-400 transition hover:bg-rose-50 hover:text-rose-500 disabled:opacity-30 dark:hover:bg-rose-500/10">
          <IconTrash size={14} stroke={2} aria-hidden />
        </button>
        <button type="button" onClick={refresh} title={t("sessions.refresh")} aria-label={t("sessions.refresh")} className="rounded p-1 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200">
          <IconRefresh size={14} stroke={2} aria-hidden />
        </button>
      </div>
      <p className="text-xs text-zinc-400 dark:text-zinc-500">{t("sessions.desc")}</p>
      <div className="flex items-center justify-between gap-3 py-1">
        <span className="min-w-0"><span className="block text-sm text-zinc-700 dark:text-zinc-300">{t("settings.killTerminalsOnClose")}</span><span className="block text-xs text-zinc-400 dark:text-zinc-500">{t("settings.killTerminalsOnCloseDesc")}</span></span>
        <button type="button" role="switch" aria-checked={killOnClose} aria-label={t("settings.killTerminalsOnClose")} onClick={() => setSetting(WKEYS.killTerminalsOnClose, !killOnClose)}
          className={`relative h-6 w-11 shrink-0 rounded-full transition ${killOnClose ? "bg-zinc-900 dark:bg-zinc-100" : "bg-zinc-400 dark:bg-zinc-700"}`}>
          <span className={`absolute top-0.5 h-5 w-5 rounded-full shadow transition-all ${killOnClose ? "left-[22px] bg-white dark:bg-zinc-900" : "left-0.5 bg-white"}`} />
        </button>
      </div>
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
      <div className="flex flex-wrap gap-2 pt-1">
        {termApi()?.clearSaved && <button type="button" onClick={() => void clearSaved()} className={`${btn} text-zinc-700 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800`}>{t("sessions.clearSaved")}</button>}
        {desk()?.daemon && <button type="button" onClick={() => void restartDaemon()} disabled={busy} className={`${btn} text-rose-600 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-500/10`}>{busy && <IconLoader2 size={12} className="animate-spin" aria-hidden />}{t("sessions.restart")}</button>}
      </div>
    </div>
  );
}
