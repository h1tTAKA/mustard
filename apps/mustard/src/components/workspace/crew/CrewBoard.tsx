"use client";
// 에이전트 팀 보드(#1098, 에픽 #1097) — 역할 에이전트에게 칸반 카드로 일을 맡기는 패널. 터미널 오른쪽 도크.
// 이번 단계: 칸 7개 + 수동 카드(만들기·편집·삭제·드래그) + 담당 역할 지정. 에이전트 실행·커스텀 역할은 에픽 2번부터.
// 보드는 서버 파일(~/.nunopi/crew)이 기준 — 화면은 연산만 보내고 돌아온 보드로 갱신(창 여러 개여도 덮어쓰기 없음).
import { useCallback, useEffect, useState } from "react";
import { IconLayoutKanban, IconPlus, IconX } from "@tabler/icons-react";
import { useConfirm, useT, useToast } from "@mustard/core";
import { CREW_STATUSES, type CrewBoard as Board, type CrewOp, type CrewStatus, type CrewTask } from "@/lib/crew/crewTypes";
import { relTime } from "@/lib/relTime";
import { STATUS_DOT, RoleIcon } from "./crewUi";
import TaskDialog from "./TaskDialog";

type Dialog = { mode: "create"; status: CrewStatus } | { mode: "edit"; task: CrewTask };

export default function CrewBoard({ root, onClose }: { root: string; onClose: () => void }) {
  const t = useT();
  const toast = useToast();
  const confirm = useConfirm();
  const [board, setBoard] = useState<Board | null>(null);
  const [failed, setFailed] = useState(false);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [drag, setDrag] = useState<string | null>(null); // 끌고 있는 카드 id
  const [over, setOver] = useState<{ status: CrewStatus; index: number } | null>(null); // 놓일 자리(칸·순번, 끄는 카드 뺀 기준)

  const load = useCallback(() => {
    fetch(`/api/crew/board?root=${encodeURIComponent(root)}`).then((r) => r.json())
      .then((j) => { if (!j?.ok) throw new Error(); setBoard(j.board); setFailed(false); })
      .catch(() => setFailed(true));
  }, [root]);
  useEffect(() => { load(); }, [load]);
  // 다른 창에서 바꿨을 수 있음 — 창으로 돌아오면 다시 읽기
  useEffect(() => { window.addEventListener("focus", load); return () => window.removeEventListener("focus", load); }, [load]);

  const apply = async (op: CrewOp): Promise<boolean> => {
    try {
      const r = await fetch("/api/crew/board", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ root, ...op }) });
      const j = await r.json();
      if (!j?.ok) throw new Error(j?.error);
      setBoard(j.board);
      return true;
    } catch { toast(t("crew.saveFailed"), "error"); load(); return false; }
  };

  const column = (s: CrewStatus) => (board?.tasks ?? []).filter((x) => x.status === s).sort((a, b) => a.order - b.order);

  // 칸 위 드래그 — 마우스 Y가 어느 카드 중간보다 위인지로 끼울 순번 계산(끄는 카드는 빼고 셈)
  const onColumnDragOver = (e: React.DragEvent<HTMLDivElement>, s: CrewStatus) => {
    if (!drag) return;
    e.preventDefault();
    const cards = Array.from(e.currentTarget.querySelectorAll<HTMLElement>("[data-card]")).filter((el) => el.dataset.card !== drag);
    let index = cards.length;
    for (let i = 0; i < cards.length; i++) { const r = cards[i].getBoundingClientRect(); if (e.clientY < r.top + r.height / 2) { index = i; break; } }
    if (over?.status !== s || over.index !== index) setOver({ status: s, index });
  };
  const onDrop = (s: CrewStatus) => {
    const id = drag, at = over?.status === s ? over.index : column(s).length;
    setDrag(null); setOver(null);
    if (id) void apply({ op: "move", id, status: s, index: at });
  };

  return (
    <div className="relative flex h-full min-h-0 w-full flex-col bg-white dark:bg-[var(--s-pane)]">
      <div className="flex shrink-0 items-center gap-1 border-b border-zinc-200 px-3 py-1.5 pr-6 dark:border-zinc-800">
        <IconLayoutKanban size={14} stroke={2} className="shrink-0 text-mustard-600 dark:text-mustard-400" aria-hidden />
        <span className="mr-auto truncate text-[13px] font-semibold text-zinc-700 dark:text-zinc-200">{t("crew.title")}</span>
        <button type="button" onClick={() => setDialog({ mode: "create", status: "backlog" })}
          className="flex shrink-0 items-center gap-1 rounded-md border border-zinc-200 px-2 py-0.5 text-[11.5px] font-medium text-zinc-700 transition hover:border-zinc-300 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:border-zinc-600 dark:hover:bg-zinc-800">
          <IconPlus size={12} stroke={2.2} aria-hidden />{t("crew.newTask")}
        </button>
        <button type="button" onClick={onClose} title={t("crew.close")} aria-label={t("crew.close")}
          className="shrink-0 rounded p-1 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200">
          <IconX size={13} stroke={2} aria-hidden />
        </button>
      </div>

      {failed && !board ? (
        <div className="flex flex-1 items-center justify-center text-[12px] text-rose-500">{t("crew.loadFailed")}</div>
      ) : (
        <div className="nunopi-scroll flex min-h-0 flex-1 gap-2 overflow-x-auto p-2">
          {CREW_STATUSES.map((s) => {
            const cards = column(s);
            const shown = cards.filter((c) => c.id !== drag).length;
            return (
              <div key={s} onDragOver={(e) => onColumnDragOver(e, s)} onDrop={() => onDrop(s)}
                onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver((o) => (o?.status === s ? null : o)); }}
                className={`group/col flex w-60 shrink-0 flex-col rounded-xl border transition ${over?.status === s ? "border-mustard-500/40 bg-mustard-500/[0.04]" : "border-transparent bg-zinc-50 dark:bg-white/[0.025]"}`}>
                <div className="flex shrink-0 items-center gap-1.5 px-3 pb-1.5 pt-2.5">
                  <span className={`h-2 w-2 shrink-0 rounded-full ${STATUS_DOT[s]}`} aria-hidden />
                  <span className="truncate text-[12px] font-semibold text-zinc-700 dark:text-zinc-200">{t(`crew.col.${s}`)}</span>
                  <span className="text-[11px] tabular-nums text-zinc-400 dark:text-zinc-500">{cards.length}</span>
                  <button type="button" onClick={() => setDialog({ mode: "create", status: s })} title={t("crew.addToColumn")} aria-label={t("crew.addToColumn")}
                    className="ml-auto rounded p-0.5 text-zinc-400 opacity-0 transition hover:bg-zinc-200/70 hover:text-zinc-700 focus:opacity-100 group-hover/col:opacity-100 dark:hover:bg-white/10 dark:hover:text-zinc-200">
                    <IconPlus size={13} stroke={2} aria-hidden />
                  </button>
                </div>
                <div className="nunopi-scroll flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto px-2 pb-2">
                  {cards.map((c, i) => {
                    const vi = i - (drag && cards.slice(0, i).some((x) => x.id === drag) ? 1 : 0); // 끄는 카드 뺀 순번(onColumnDragOver와 같은 기준)
                    return (
                      <div key={c.id}>
                        {over?.status === s && over.index === vi && drag !== c.id && <div className="mb-1.5 h-0.5 rounded-full bg-mustard-500" aria-hidden />}
                        <button type="button" data-card={c.id} draggable
                          onDragStart={(e) => { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", c.id); setDrag(c.id); }}
                          onDragEnd={() => { setDrag(null); setOver(null); }}
                          onClick={() => setDialog({ mode: "edit", task: c })}
                          className={`w-full rounded-lg border border-zinc-200/80 bg-white px-3 py-2.5 text-left shadow-[0_1px_1px_rgba(0,0,0,0.03)] transition hover:border-zinc-300 hover:shadow-sm dark:border-white/[0.07] dark:bg-[#17181f] dark:hover:border-white/15 ${drag === c.id ? "opacity-40" : ""}`}>
                          <div className="line-clamp-2 text-[12.5px] font-medium leading-snug text-zinc-800 dark:text-zinc-100">{c.title}</div>
                          {c.body && <div className="mt-1 line-clamp-2 text-[11.5px] leading-snug text-zinc-500 dark:text-zinc-400">{c.body}</div>}
                          <div className="mt-2 flex items-center gap-1.5">
                            <span className="inline-flex min-w-0 items-center gap-1 rounded-md bg-zinc-100 px-1.5 py-0.5 text-[10.5px] text-zinc-600 dark:bg-white/[0.06] dark:text-zinc-300">
                              <RoleIcon role={c.role} size={11} />
                              <span className="truncate">{t(`crew.role.${c.role ?? "none"}`)}</span>
                            </span>
                            <span className="ml-auto shrink-0 text-[10.5px] tabular-nums text-zinc-400 dark:text-zinc-500">{relTime(new Date(c.updatedAt).toISOString())}</span>
                          </div>
                        </button>
                      </div>
                    );
                  })}
                  {over?.status === s && over.index >= shown && <div className="h-0.5 rounded-full bg-mustard-500" aria-hidden />}
                  {!cards.length && over?.status !== s && <div className="mx-1 rounded-lg border border-dashed border-zinc-200 py-4 text-center text-[11px] text-zinc-400 dark:border-white/10 dark:text-zinc-500">{t("crew.empty")}</div>}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {dialog && (
        <TaskDialog key={dialog.mode === "edit" ? dialog.task.id : `new-${dialog.status}`}
          initial={dialog.mode === "edit" ? dialog.task : undefined}
          status={dialog.mode === "edit" ? dialog.task.status : dialog.status}
          onClose={() => setDialog(null)}
          onSave={async (v) => {
            const ok = dialog.mode === "edit"
              ? await apply({ op: "update", id: dialog.task.id, title: v.title, body: v.body, role: v.role })
                && (v.status === dialog.task.status || await apply({ op: "move", id: dialog.task.id, status: v.status, index: column(v.status).length }))
              : await apply({ op: "create", title: v.title, body: v.body, role: v.role, status: v.status });
            if (ok) setDialog(null);
          }}
          onDelete={dialog.mode === "edit" ? async () => {
            if (!(await confirm({ message: t("crew.deleteConfirm"), danger: true, confirmText: t("crew.delete") }))) return;
            if (await apply({ op: "delete", id: dialog.task.id })) setDialog(null);
          } : undefined} />
      )}
    </div>
  );
}
