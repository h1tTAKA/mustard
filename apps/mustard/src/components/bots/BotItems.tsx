"use client";
// 봇 홈 오른쪽 칸 [할 일](#1404 H5) — 봇이 만든 티켓(#번호) 목록 → 열면 상세(활동 시간순·상태 바꾸기·댓글).
// 티켓은 봇이 도구(bot_item_*)로 만들고, 주인은 여기서 보고 상태를 바꾸거나 댓글을 남김(댓글은 봇 대화로도 감 — 서버).
// 보이는 동안 몇 초마다 다시 읽음(봇이 대화 중에 바꿈). 좁은 폭(w-72) 기준.
import { useCallback, useEffect, useRef, useState } from "react";
import { IconArrowUp, IconCheck, IconChevronLeft } from "@tabler/icons-react";
import { useT, useToast } from "@mustard/core";
import { fmtDateTime } from "@/lib/relTime";
import type { BotItem, ItemStatus } from "@/lib/crew/crewBotItems";

const POLL_MS = 4_000;
const STATUSES: ItemStatus[] = ["open", "in-progress", "waiting", "needs-you", "done", "canceled"];
const closed = (s: ItemStatus) => s === "done" || s === "canceled";
// 상태 점 — 글자 없이도 구분되게 모양·색 둘 다(끝 = 체크)
const DOT: Record<ItemStatus, string> = {
  open: "border border-zinc-400 dark:border-zinc-500",
  "in-progress": "bg-mustard-500",
  waiting: "bg-sky-500",
  "needs-you": "bg-rose-500",
  done: "",
  canceled: "bg-zinc-300 dark:bg-zinc-600",
};
const Dot = ({ s }: { s: ItemStatus }) => s === "done"
  ? <IconCheck size={12} stroke={2.6} className="shrink-0 text-emerald-500" aria-hidden />
  : <span className={`mx-[2px] h-2 w-2 shrink-0 rounded-full ${DOT[s]}`} aria-hidden />;
const when = (at: number) => fmtDateTime(new Date(at).toISOString());

export default function BotItems({ botId, botName, active }: { botId: string; botName: string; active: boolean }) {
  const t = useT();
  const toast = useToast();
  const [items, setItems] = useState<BotItem[] | null>(null); // null = 아직 못 읽음
  const [error, setError] = useState(false);
  const [open, setOpen] = useState<number | null>(null); // 연 티켓 번호
  const seq = useRef(0);
  const reload = useCallback(() => {
    const my = ++seq.current;
    fetch(`/api/crew/bots/items?bot=${encodeURIComponent(botId)}`).then((r) => r.json()).then((j) => {
      if (my !== seq.current) return; // 늦게 온 옛 응답은 버림
      if (!j?.ok) throw new Error(j?.error);
      setItems(j.items); setError(false);
    }).catch(() => { if (my === seq.current) setError(true); });
  }, [botId]);
  useEffect(() => {
    if (!active) return;
    reload();
    const id = setInterval(() => { if (document.visibilityState === "visible") reload(); }, POLL_MS);
    return () => clearInterval(id);
  }, [active, reload]);

  const post = async (body: Record<string, unknown>): Promise<boolean> => {
    try {
      const j = await fetch("/api/crew/bots/items", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ bot: botId, ...body }), signal: AbortSignal.timeout(15_000) }).then((r) => r.json());
      if (!j?.ok) throw new Error(j?.error);
      reload();
      return true;
    } catch { toast(t("bots.items.saveFailed"), "error"); reload(); return false; }
  };

  const item = open !== null ? items?.find((i) => i.n === open) : undefined;
  if (item) return <ItemDetail item={item} botName={botName} onBack={() => setOpen(null)} post={post} />;
  if (!items) return error ? <p className="px-4 py-5 text-[12.5px] text-zinc-400 dark:text-zinc-500">{t("bots.items.loadFailed")}</p> : null;
  if (!items.length) return <p className="px-4 py-5 text-[12.5px] leading-relaxed text-zinc-400 dark:text-zinc-500">{t("bots.items.empty")}</p>;
  // 하는 중인 것 먼저(최근 바뀐 순), 끝난 것은 아래 흐리게
  const sorted = [...items].sort((a, b) => Number(closed(a.status)) - Number(closed(b.status)) || b.updatedAt - a.updatedAt);
  return (
    <ul className="nunopi-scroll flex min-h-0 flex-1 flex-col overflow-y-auto px-2 py-2">
      {sorted.map((i) => (
        <li key={i.n}>
          <button type="button" onClick={() => setOpen(i.n)}
            className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition hover:bg-zinc-100 dark:hover:bg-zinc-800 ${closed(i.status) ? "opacity-55" : ""}`}>
            <Dot s={i.status} />
            <span className="shrink-0 font-mono text-[11.5px] text-zinc-400 dark:text-zinc-500">#{i.n}</span>
            <span className={`min-w-0 flex-1 truncate text-[12.5px] text-zinc-800 dark:text-zinc-100 ${i.status === "canceled" ? "line-through" : ""}`} title={i.title}>{i.title}</span>
            <span className={`shrink-0 text-[11px] ${i.status === "needs-you" ? "font-medium text-rose-600 dark:text-rose-400" : "text-zinc-400 dark:text-zinc-500"}`}>{t(`bots.items.status.${i.status}`)}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function ItemDetail({ item, botName, onBack, post }: { item: BotItem; botName: string; onBack: () => void; post: (b: Record<string, unknown>) => Promise<boolean> }) {
  const t = useT();
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const busy = useRef(false); // 다시 그리기 전에 Enter를 두 번 눌러도 한 번만 보냄(state는 그 사이 옛 값, 리뷰)
  const endRef = useRef<HTMLDivElement>(null);
  // 새 활동이 오면 맨 아래(최신)로 — 대화처럼 아래가 최신
  useEffect(() => { endRef.current?.scrollIntoView({ block: "end" }); }, [item.n, item.activity.length]);
  const send = async () => {
    const text = draft.trim();
    if (!text || busy.current) return;
    busy.current = true; setSending(true);
    if (await post({ op: "comment", n: item.n, text })) setDraft("");
    busy.current = false; setSending(false);
  };
  const setStatus = (status: string) => { if (status !== item.status) void post({ op: "set", n: item.n, status }); };
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-col gap-2 border-b border-zinc-200 px-3 py-3 dark:border-zinc-800">
        <button type="button" onClick={onBack}
          className="inline-flex items-center gap-0.5 self-start rounded-md py-0.5 pr-1.5 text-[11.5px] text-zinc-500 transition hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200">
          <IconChevronLeft size={14} stroke={2} aria-hidden /> {t("bots.tab.items")}
        </button>
        <div className="text-[13.5px] font-semibold leading-snug text-zinc-900 [overflow-wrap:anywhere] dark:text-zinc-50">
          <span className="mr-1.5 font-mono text-[12px] font-normal text-zinc-400 dark:text-zinc-500">#{item.n}</span>{item.title}
        </div>
        <div className="flex items-center gap-2">
          <Dot s={item.status} />
          <select value={item.status} onChange={(e) => setStatus(e.target.value)} aria-label={t("bots.items.statusLabel")}
            className="h-7 w-32 shrink-0 rounded-md border border-zinc-200 bg-white px-1.5 text-[12px] text-zinc-700 outline-none focus:border-mustard-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200">
            {STATUSES.map((s) => <option key={s} value={s}>{t(`bots.items.status.${s}`)}</option>)}
          </select>
          <span className="min-w-0 truncate text-[11px] text-zinc-400 dark:text-zinc-500">{when(item.updatedAt)}</span>
        </div>
        {item.doneMeans && (
          <p className="text-[11.5px] leading-relaxed text-zinc-500 [overflow-wrap:anywhere] dark:text-zinc-400">
            <span className="font-medium">{t("bots.items.doneMeans")}</span> {item.doneMeans}
          </p>
        )}
      </div>
      <ol className="nunopi-scroll flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-3 py-3">
        {item.activity.map((a, i) => (
          <li key={i} className="flex flex-col gap-0.5 border-l-2 border-zinc-200 pl-2.5 dark:border-zinc-700">
            <div className="flex items-baseline gap-1.5 text-[11px] text-zinc-400 dark:text-zinc-500">
              <span className="min-w-0 truncate font-medium text-zinc-500 dark:text-zinc-400">{a.by === "owner" ? t("bots.items.me") : botName}</span>
              <span className="shrink-0">{when(a.at)}</span>
            </div>
            {a.kind === "created" && <p className="text-[12px] text-zinc-500 dark:text-zinc-400">{t("bots.items.created")}</p>}
            {a.kind === "status" && a.status && <p className="text-[12px] text-zinc-500 dark:text-zinc-400">{t("bots.items.statusTo", { status: t(`bots.items.status.${a.status}`) })}</p>}
            {a.kind === "edit" && (
              <p className="text-[12px] text-zinc-500 [overflow-wrap:anywhere] dark:text-zinc-400">
                {a.title !== undefined && t("bots.items.editTitle", { title: a.title })}
                {a.title !== undefined && a.doneMeans !== undefined && " · "}
                {a.doneMeans !== undefined && (a.doneMeans ? t("bots.items.editDone", { done: a.doneMeans }) : t("bots.items.editDoneCleared"))}
              </p>
            )}
            {a.text && <p className="whitespace-pre-wrap text-[12.5px] leading-relaxed text-zinc-700 [overflow-wrap:anywhere] dark:text-zinc-200">{a.text}</p>}
          </li>
        ))}
        <div ref={endRef} />
      </ol>
      <div className="flex items-end gap-1.5 border-t border-zinc-200 p-2 dark:border-zinc-800">
        <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={2} placeholder={t("bots.items.commentPh")}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(); } }} // 한글 조합 중 Enter는 글자 확정
          className="min-w-0 flex-1 resize-none rounded-lg border border-zinc-200 bg-white px-2 py-1.5 text-[12.5px] text-zinc-800 outline-none placeholder:text-zinc-400 focus:border-mustard-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100" />
        <button type="button" onClick={() => void send()} disabled={!draft.trim() || sending} title={t("bots.items.send")} aria-label={t("bots.items.send")}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-mustard-500 text-brown-900 transition hover:bg-mustard-400 disabled:opacity-40">
          <IconArrowUp size={15} stroke={2.4} aria-hidden />
        </button>
      </div>
    </div>
  );
}
