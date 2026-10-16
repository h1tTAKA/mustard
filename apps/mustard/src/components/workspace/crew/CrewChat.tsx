"use client";
// Crew 팀 채팅(#1104, 에픽 #1097) — 역할 에이전트·보드·사람이 주고받는 레포별 채널. 오른쪽 패널(캐치업 ↔ GitHub 사이).
// 메신저형: 역할 아바타·이름·실행 AI·시간, 같은 보낸 이 연속은 묶기, 질문·관문·권한·막힘 강조, 카드 칩 → 보드에서 그 카드.
// 입력: @역할 = 그 역할에게 새 카드(그록봇식), 메시지에 답글 = 그 카드로 전달. 2초 폴링(since 이후만).
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { IconArrowBackUp, IconArrowUp, IconLayoutKanban, IconMessages, IconUser, IconX } from "@tabler/icons-react";
import { useT, useToast } from "@mustard/core";
import type { CrewMsg } from "@/lib/crew/crewChat";
import { PROVIDER_LABEL, RoleIcon, roleName, useCrewRoles } from "./crewUi";

export const CREW_OPEN_TASK_EVENT = "mustard:crew-open-task"; // detail = { root, taskId } — 보드 열고 그 카드 편집 창
// 보드 패널이 닫혀 있으면 이벤트 때 보드가 아직 없음 → 열고 나서 읽을 수 있게 마지막 요청을 남김
export const pendingOpen: { v: { root: string; taskId: string } | null } = { v: null };
export function openCrewTask(root: string, taskId: string) { pendingOpen.v = { root, taskId }; window.dispatchEvent(new CustomEvent(CREW_OPEN_TASK_EVENT, { detail: { root, taskId } })); }

// 역할별 아바타 색(같은 역할 = 같은 색). 사람·보드는 고정.
const TINTS = ["bg-sky-500/15 text-sky-700 dark:text-sky-300", "bg-violet-500/15 text-violet-700 dark:text-violet-300", "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  "bg-amber-500/15 text-amber-700 dark:text-amber-300", "bg-rose-500/15 text-rose-700 dark:text-rose-300", "bg-teal-500/15 text-teal-700 dark:text-teal-300", "bg-indigo-500/15 text-indigo-700 dark:text-indigo-300", "bg-orange-500/15 text-orange-700 dark:text-orange-300"];
const tint = (id: string) => TINTS[[...id].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7) % TINTS.length];
const time = (ts: number) => new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const LOUD = new Set(["question", "gate", "permission", "blocked"]);

export default function CrewChat({ root }: { root: string }) {
  const t = useT();
  const toast = useToast();
  const [roles] = useCrewRoles();
  const [msgs, setMsgs] = useState<CrewMsg[]>([]);
  const [text, setText] = useState("");
  const [reply, setReply] = useState<CrewMsg | null>(null);
  const [busy, setBusy] = useState(false);
  const [mention, setMention] = useState<{ q: string; at: number } | null>(null); // @ 자동완성
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const lastTs = useRef(0);
  const stick = useRef(true); // 맨 아래 보는 중이면 새 메시지에 따라 내려감

  const load = useCallback(() => {
    fetch(`/api/crew/chat?root=${encodeURIComponent(root)}&since=${lastTs.current}`).then((r) => r.json()).then((j) => {
      if (!j?.ok || !j.msgs.length) return;
      lastTs.current = j.msgs[j.msgs.length - 1].ts;
      setMsgs((prev) => { const seen = new Set(prev.map((m) => m.id)); return [...prev, ...(j.msgs as CrewMsg[]).filter((m) => !seen.has(m.id))].slice(-600); });
    }).catch(() => {});
  }, [root]);
  useEffect(() => { lastTs.current = 0; setMsgs([]); load(); const id = setInterval(load, 2000); return () => clearInterval(id); }, [load]); // eslint-disable-line react-hooks/set-state-in-effect -- 레포 바뀌면 비우고 다시
  useEffect(() => { const el = listRef.current; if (el && stick.current) el.scrollTop = el.scrollHeight; }, [msgs]);

  const who = useCallback((from: string) => (from === "human" ? t("crewchat.you") : from === "board" ? t("crewchat.board") : roleName(t, roles, from)), [roles, t]);
  const known = useMemo(() => new Set(roles.map((r) => r.id)), [roles]);

  const send = async () => {
    const body = text.trim();
    if (!body || busy) return;
    setBusy(true);
    try {
      const j = await (await fetch("/api/crew/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ root, text: body, replyTo: reply?.id }) })).json();
      if (!j?.ok) throw new Error(j?.error);
      setText(""); setReply(null); stick.current = true;
      if (j.created) toast(t("crewchat.created"), "success");
      load();
    } catch { toast(t("crewchat.sendFailed"), "error"); } finally { setBusy(false); }
  };

  // @ 뒤 글자로 역할 후보
  const onChange = (v: string, caret: number) => {
    setText(v);
    const m = /(^|\s)@([a-z0-9-]*)$/i.exec(v.slice(0, caret));
    setMention(m ? { q: m[2].toLowerCase(), at: caret - m[2].length } : null);
  };
  const candidates = mention ? roles.filter((r) => r.id.includes(mention.q) || roleName(t, roles, r.id).toLowerCase().includes(mention.q)).slice(0, 8) : [];
  const pick = (id: string) => {
    if (!mention) return;
    const v = `${text.slice(0, mention.at)}${id} ${text.slice(mention.at + mention.q.length)}`;
    setText(v); setMention(null);
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  // 본문의 @역할을 칩으로
  const renderText = (s: string) => s.split(/(@[a-z0-9][a-z0-9-]{0,39})/gi).map((part, i) => {
    const id = part.startsWith("@") ? part.slice(1).toLowerCase() : "";
    if (id === "you") return <span key={i} className="rounded bg-amber-500/15 px-1 font-medium text-amber-700 dark:text-amber-300">@{t("crewchat.you")}</span>;
    if (id && known.has(id)) return <span key={i} className="rounded bg-mustard-500/15 px-1 font-medium text-mustard-700 dark:text-mustard-400">@{roleName(t, roles, id)}</span>;
    return <span key={i}>{part}</span>;
  });

  return (
    <div className="flex h-full min-h-0 flex-col bg-white dark:bg-[var(--s-pane)]">
      <div className="flex h-10 shrink-0 items-center gap-1.5 border-b border-zinc-200 px-3 dark:border-zinc-800">
        <IconMessages size={15} stroke={2} className="text-mustard-600 dark:text-mustard-400" aria-hidden />
        <span className="text-[13px] font-semibold text-zinc-800 dark:text-zinc-100">{t("crewchat.title")}</span>
      </div>

      <div ref={listRef} onScroll={(e) => { const el = e.currentTarget; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40; }}
        className="nunopi-scroll min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {!msgs.length && <p className="mx-auto mt-10 max-w-xs text-center text-[12px] leading-relaxed text-zinc-400 dark:text-zinc-500">{t("crewchat.empty")}</p>}
        {msgs.map((m, i) => {
          const prev = msgs[i - 1];
          const grouped = !!prev && prev.from === m.from && prev.taskId === m.taskId && m.ts - prev.ts < 5 * 60_000 && !LOUD.has(m.kind);
          const isHuman = m.from === "human", isBoard = m.from === "board";
          const loud = LOUD.has(m.kind);
          const parent = m.replyTo ? msgs.find((x) => x.id === m.replyTo) : undefined;
          return (
            <div key={m.id} className={`group/msg relative flex gap-2.5 rounded-lg px-1.5 ${grouped ? "py-0.5" : "mt-2 py-1"} hover:bg-zinc-50 dark:hover:bg-white/[0.02]`}>
              <div className="w-7 shrink-0">
                {!grouped && (
                  <span className={`flex h-7 w-7 items-center justify-center rounded-lg ${isHuman ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900" : isBoard ? "bg-zinc-100 text-zinc-500 dark:bg-white/[0.06] dark:text-zinc-400" : tint(m.from)}`}>
                    {isHuman ? <IconUser size={14} aria-hidden /> : isBoard ? <IconLayoutKanban size={14} aria-hidden /> : <RoleIcon role={known.has(m.from) ? m.from : "custom"} size={14} />}
                  </span>
                )}
              </div>
              <div className="min-w-0 flex-1">
                {!grouped && (
                  <div className="flex flex-wrap items-baseline gap-x-1.5">
                    <span className="text-[12.5px] font-semibold text-zinc-800 dark:text-zinc-100">{who(m.from)}</span>
                    {m.provider && <span className="text-[10.5px] text-zinc-400 dark:text-zinc-500">{PROVIDER_LABEL[m.provider] ?? m.provider}</span>}
                    <span className="text-[10.5px] tabular-nums text-zinc-400 dark:text-zinc-500">{time(m.ts)}</span>
                    {m.taskId && m.taskTitle && (
                      <button type="button" onClick={() => openCrewTask(root, m.taskId!)} title={t("crewchat.openCard")}
                        className="inline-flex max-w-[12rem] items-center gap-1 truncate rounded bg-zinc-100 px-1.5 text-[10.5px] text-zinc-500 transition hover:bg-zinc-200 hover:text-zinc-800 dark:bg-white/[0.06] dark:text-zinc-400 dark:hover:bg-white/10 dark:hover:text-zinc-200">
                        <IconLayoutKanban size={10} aria-hidden /><span className="truncate">{m.taskTitle}</span>
                      </button>
                    )}
                  </div>
                )}
                {parent && <div className="mb-0.5 flex items-center gap-1 truncate text-[11px] text-zinc-400 dark:text-zinc-500"><IconArrowBackUp size={11} aria-hidden />{who(parent.from)}: {parent.text.slice(0, 80)}</div>}
                <div className={`whitespace-pre-wrap break-words text-[12.5px] leading-relaxed ${loud ? `mt-0.5 rounded-lg border px-2.5 py-1.5 ${m.kind === "blocked" ? "border-rose-300/60 bg-rose-50 text-rose-900 dark:border-rose-500/30 dark:bg-rose-500/[0.07] dark:text-rose-200" : "border-amber-300/60 bg-amber-50 text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/[0.07] dark:text-amber-100"}` : "text-zinc-700 dark:text-zinc-300"}`}>
                  {renderText(m.text)}
                </div>
              </div>
              {m.taskId && !isHuman && (
                <button type="button" onClick={() => { setReply(m); inputRef.current?.focus(); }} title={t("crewchat.reply")} aria-label={t("crewchat.reply")}
                  className="absolute right-1 top-1 rounded p-1 text-zinc-400 opacity-0 transition hover:bg-zinc-100 hover:text-zinc-700 group-hover/msg:opacity-100 dark:hover:bg-white/10 dark:hover:text-zinc-200">
                  <IconArrowBackUp size={13} aria-hidden />
                </button>
              )}
            </div>
          );
        })}
      </div>

      <div className="relative shrink-0 border-t border-zinc-200 p-2.5 dark:border-zinc-800">
        {candidates.length > 0 && (
          <div className="absolute bottom-full left-2.5 right-2.5 mb-1 rounded-xl border border-zinc-200 bg-white p-1 shadow-xl dark:border-white/10 dark:bg-[#1b1c24]">
            {candidates.map((r) => (
              <button key={r.id} type="button" onMouseDown={(e) => { e.preventDefault(); pick(r.id); }}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition hover:bg-zinc-100 dark:hover:bg-white/5">
                <span className={`flex h-5 w-5 items-center justify-center rounded ${tint(r.id)}`}><RoleIcon role={r.id} size={12} /></span>
                <span className="text-[12.5px] text-zinc-800 dark:text-zinc-100">{roleName(t, roles, r.id)}</span>
                <span className="ml-auto font-mono text-[10.5px] text-zinc-400">@{r.id}</span>
              </button>
            ))}
          </div>
        )}
        {reply && (
          <div className="mb-1.5 flex items-center gap-1.5 rounded-lg bg-zinc-100 px-2 py-1 text-[11.5px] text-zinc-600 dark:bg-white/[0.05] dark:text-zinc-300">
            <IconArrowBackUp size={12} aria-hidden />
            <span className="truncate">{t("crewchat.replyingTo", { who: who(reply.from) })}{reply.taskTitle ? ` · ${reply.taskTitle}` : ""}</span>
            <button type="button" onClick={() => setReply(null)} className="ml-auto rounded p-0.5 hover:bg-zinc-200 dark:hover:bg-white/10" aria-label={t("crew.cancel")}><IconX size={12} aria-hidden /></button>
          </div>
        )}
        <div className="flex items-end gap-1.5 rounded-xl border border-zinc-200 bg-white px-2.5 py-1.5 focus-within:border-zinc-400 dark:border-white/10 dark:bg-white/[0.03] dark:focus-within:border-white/25">
          <textarea ref={inputRef} value={text} rows={1} placeholder={t("crewchat.placeholder")}
            onChange={(e) => onChange(e.target.value, e.target.selectionStart)}
            onKeyDown={(e) => {
              if (candidates.length && (e.key === "Enter" || e.key === "Tab")) { e.preventDefault(); pick(candidates[0].id); return; }
              if (e.key === "Escape") { setMention(null); if (!mention) setReply(null); return; }
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(); }
            }}
            className="nunopi-scroll max-h-32 min-h-[22px] flex-1 resize-none bg-transparent py-0.5 text-[12.5px] leading-relaxed text-zinc-800 outline-none placeholder:text-zinc-400 [field-sizing:content] dark:text-zinc-100" />
          <button type="button" onClick={() => void send()} disabled={!text.trim() || busy} aria-label={t("crewchat.send")}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-mustard-500 text-brown-900 transition hover:bg-mustard-400 disabled:opacity-30">
            <IconArrowUp size={15} stroke={2.2} aria-hidden />
          </button>
        </div>
      </div>
    </div>
  );
}
