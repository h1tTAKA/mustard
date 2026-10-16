"use client";
// 에이전트 팀 보드(#1098, 에픽 #1097) — 역할 에이전트에게 칸반 카드로 일을 맡기는 패널. 터미널 오른쪽 도크.
// 이번 단계: 칸 7개 + 수동 카드(추가·편집·삭제·드래그). 에이전트 실행은 에픽 2번부터.
// 보드는 서버 파일(~/.nunopi/crew)이 기준 — 화면은 연산만 보내고 돌아온 보드로 갱신(창 여러 개여도 덮어쓰기 없음).
import { useCallback, useEffect, useRef, useState } from "react";
import { IconLayoutKanban, IconPlus, IconTrash, IconX } from "@tabler/icons-react";
import { useConfirm, useT, useToast } from "@mustard/core";
import { CREW_STATUSES, type CrewBoard as Board, type CrewOp, type CrewStatus, type CrewTask } from "@/lib/crew/crewTypes";
import { relTime } from "@/lib/relTime";

// 칸 색 점 — 상태 구분(나 필요=주의, 막힘=빨강, 완료=초록, 실행 중=겨자).
const DOT: Record<CrewStatus, string> = {
  backlog: "bg-zinc-400", ready: "bg-sky-500", running: "bg-mustard-500", "needs-you": "bg-amber-500",
  review: "bg-violet-500", done: "bg-emerald-500", blocked: "bg-rose-500",
};

export default function CrewBoard({ root, onClose }: { root: string; onClose: () => void }) {
  const t = useT();
  const toast = useToast();
  const confirm = useConfirm();
  const [board, setBoard] = useState<Board | null>(null);
  const [failed, setFailed] = useState(false);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<CrewTask | null>(null);
  const [drag, setDrag] = useState<string | null>(null); // 끌고 있는 카드 id
  const [over, setOver] = useState<{ status: CrewStatus; index: number } | null>(null); // 놓일 자리(칸·순번)

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

  // 칸 위 드래그 — 마우스 Y가 어느 카드 중간보다 위인지로 끼울 순번 계산
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
        <button type="button" onClick={() => setAdding(true)} title={t("crew.addTask")} aria-label={t("crew.addTask")}
          className="flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1 text-[11px] font-medium text-mustard-700 transition hover:bg-mustard-500/10 dark:text-mustard-400 dark:hover:bg-zinc-800">
          <IconPlus size={13} stroke={2} aria-hidden />{t("crew.addTask")}
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
            return (
              <div key={s} onDragOver={(e) => onColumnDragOver(e, s)} onDrop={() => onDrop(s)}
                onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver((o) => (o?.status === s ? null : o)); }}
                className={`flex w-56 shrink-0 flex-col rounded-lg bg-zinc-50 dark:bg-zinc-900/60 ${over?.status === s ? "ring-1 ring-mustard-400/60" : ""}`}>
                <div className="flex shrink-0 items-center gap-1.5 px-2.5 py-2">
                  <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${DOT[s]}`} aria-hidden />
                  <span className="truncate text-[11.5px] font-semibold text-zinc-600 dark:text-zinc-300">{t(`crew.col.${s}`)}</span>
                  <span className="text-[10.5px] text-zinc-400">{cards.length}</span>
                </div>
                <div className="nunopi-scroll flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto px-1.5 pb-2">
                  {s === "backlog" && adding && <Composer onCancel={() => setAdding(false)} onSave={async (title, body) => { if (await apply({ op: "create", title, body })) setAdding(false); }} />}
                  {cards.map((c, i) => (
                    <div key={c.id}>
                      {over?.status === s && over.index === i && drag !== c.id && <div className="mb-1.5 h-0.5 rounded bg-mustard-500" aria-hidden />}
                      <button type="button" data-card={c.id} draggable
                        onDragStart={(e) => { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", c.id); setDrag(c.id); }}
                        onDragEnd={() => { setDrag(null); setOver(null); }}
                        onClick={() => setEditing(c)}
                        className={`w-full rounded-md border border-zinc-200 bg-white px-2.5 py-2 text-left shadow-sm transition hover:border-zinc-300 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:border-zinc-700 ${drag === c.id ? "opacity-40" : ""}`}>
                        <div className="line-clamp-2 text-[12px] font-medium leading-snug text-zinc-800 dark:text-zinc-100">{c.title}</div>
                        {c.body && <div className="mt-1 line-clamp-2 text-[11px] leading-snug text-zinc-500 dark:text-zinc-400">{c.body}</div>}
                        <div className="mt-1.5 text-[10px] text-zinc-400">{relTime(new Date(c.updatedAt).toISOString())}</div>
                      </button>
                    </div>
                  ))}
                  {over?.status === s && over.index >= cards.filter((c) => c.id !== drag).length && <div className="h-0.5 rounded bg-mustard-500" aria-hidden />}
                  {!cards.length && !(s === "backlog" && adding) && <div className="px-1 py-3 text-center text-[10.5px] text-zinc-400 dark:text-zinc-600">{t("crew.empty")}</div>}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {editing && (
        <div className="absolute inset-0 z-30 flex items-start justify-center bg-black/30 p-6" onClick={() => setEditing(null)}>
          <div className="w-full max-w-md rounded-lg border border-zinc-200 bg-white p-3 shadow-xl dark:border-zinc-800 dark:bg-zinc-950" onClick={(e) => e.stopPropagation()}>
            <div className="mb-2 text-[12px] font-semibold text-zinc-600 dark:text-zinc-300">{t("crew.editTask")}</div>
            <Composer initial={editing} onCancel={() => setEditing(null)}
              onSave={async (title, body) => { if (await apply({ op: "update", id: editing.id, title, body })) setEditing(null); }}
              onDelete={async () => {
                if (!(await confirm({ message: t("crew.deleteConfirm"), danger: true, confirmText: t("crew.delete") }))) return;
                if (await apply({ op: "delete", id: editing.id })) setEditing(null);
              }} />
          </div>
        </div>
      )}
    </div>
  );
}

// 카드 입력(추가·편집 공용) — Enter(제목)=저장, ⌘/Ctrl+Enter(설명)=저장, Esc=취소.
function Composer({ initial, onSave, onCancel, onDelete }: { initial?: CrewTask; onSave: (title: string, body: string) => void; onCancel: () => void; onDelete?: () => void }) {
  const t = useT();
  const [title, setTitle] = useState(initial?.title ?? "");
  const [body, setBody] = useState(initial?.body ?? "");
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { ref.current?.focus(); }, []);
  const save = () => { if (title.trim()) onSave(title.trim(), body); };
  const key = (e: React.KeyboardEvent, isBody: boolean) => {
    if (e.key === "Escape") { e.preventDefault(); onCancel(); }
    else if (e.key === "Enter" && !e.nativeEvent.isComposing && (!isBody || e.metaKey || e.ctrlKey)) { e.preventDefault(); save(); }
  };
  return (
    <div className="flex flex-col gap-1.5 rounded-md border border-mustard-500/50 bg-white p-2 dark:border-mustard-700/60 dark:bg-zinc-950">
      <input ref={ref} value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => key(e, false)} placeholder={t("crew.titlePlaceholder")} maxLength={200}
        className="w-full bg-transparent text-[12px] font-medium text-zinc-800 outline-none placeholder:text-zinc-400 dark:text-zinc-100" />
      <textarea value={body} onChange={(e) => setBody(e.target.value)} onKeyDown={(e) => key(e, true)} placeholder={t("crew.bodyPlaceholder")} rows={initial ? 6 : 3}
        className="nunopi-scroll w-full resize-none bg-transparent text-[11px] leading-snug text-zinc-600 outline-none placeholder:text-zinc-400 dark:text-zinc-300" />
      <div className="flex items-center gap-1">
        {onDelete && (
          <button type="button" onClick={onDelete} className="mr-auto flex items-center gap-1 rounded px-1.5 py-1 text-[11px] text-rose-500 transition hover:bg-rose-50 dark:hover:bg-rose-950/40">
            <IconTrash size={12} stroke={2} aria-hidden />{t("crew.delete")}
          </button>
        )}
        <span className={onDelete ? "" : "mr-auto"} />
        <button type="button" onClick={onCancel} className="rounded px-2 py-1 text-[11px] text-zinc-500 transition hover:bg-zinc-100 dark:hover:bg-zinc-800">{t("crew.cancel")}</button>
        <button type="button" onClick={save} disabled={!title.trim()} className="rounded bg-mustard-500 px-2 py-1 text-[11px] font-medium text-brown-900 transition hover:bg-mustard-400 disabled:opacity-40">{t("crew.save")}</button>
      </div>
    </div>
  );
}
