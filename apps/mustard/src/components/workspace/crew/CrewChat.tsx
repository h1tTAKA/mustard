"use client";
// 에이전트 대화방(#1104·#1106, 에픽 #1097) — 역할 에이전트·보드·사람이 주고받는 레포별 채널. 오른쪽 패널(캐치업 ↔ GitHub 사이).
// Slack형: 채널 헤더(# 레포 · 멤버 아바타 묶음), 멤버(봇 프로필) 목록 — 상태(작업 중·내 확인 필요·대기), 날짜 구분선, 말풍선 없는 행 메시지.
// 입력: @에이전트 = 그 역할에게 새 카드(그록봇식), 메시지에 답글 = 그 카드로 전달. 2초 폴링(since 이후만).
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { IconArrowBackUp, IconArrowUp, IconAt, IconHash, IconLayoutKanban, IconSettings, IconUser, IconUsers, IconX } from "@tabler/icons-react";
import { useT, useToast } from "@mustard/core";
import type { CrewMsg } from "@/lib/crew/crewChat";
import type { CrewRun } from "@/lib/crew/crewRunner";
import { PROVIDER_LABEL, RoleIcon, isActiveRun, roleDesc, roleName, useCrewRoles, useCrewRuns } from "./crewUi";
import RolesDialog from "./RolesDialog";

export const CREW_OPEN_TASK_EVENT = "mustard:crew-open-task"; // detail = { root, taskId } — 보드 열고 그 카드 편집 창
// 보드 패널이 닫혀 있으면 이벤트 때 보드가 아직 없음 → 열고 나서 읽을 수 있게 마지막 요청을 남김
export const pendingOpen: { v: { root: string; taskId: string } | null } = { v: null };
export function openCrewTask(root: string, taskId: string) { pendingOpen.v = { root, taskId }; window.dispatchEvent(new CustomEvent(CREW_OPEN_TASK_EVENT, { detail: { root, taskId } })); }

// 역할별 아바타 색(같은 역할 = 같은 색). 사람·보드는 고정.
const TINTS = ["bg-sky-500/15 text-sky-700 dark:text-sky-300", "bg-violet-500/15 text-violet-700 dark:text-violet-300", "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  "bg-amber-500/15 text-amber-700 dark:text-amber-300", "bg-rose-500/15 text-rose-700 dark:text-rose-300", "bg-teal-500/15 text-teal-700 dark:text-teal-300", "bg-indigo-500/15 text-indigo-700 dark:text-indigo-300", "bg-orange-500/15 text-orange-700 dark:text-orange-300"];
const tint = (id: string) => TINTS[[...id].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7) % TINTS.length];
const time = (ts: number) => new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const dayKey = (ts: number) => new Date(ts).toDateString();
const LOUD = new Set(["question", "gate", "permission", "blocked"]);
const basename = (p: string) => p.replace(/\/+$/, "").split("/").pop() || p;

function Avatar({ from, known, size = 32 }: { from: string; known: Set<string>; size?: number }) {
  const s = { width: size, height: size };
  if (from === "human") return <span style={s} className="flex shrink-0 items-center justify-center rounded-lg bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"><IconUser size={size * 0.5} aria-hidden /></span>;
  if (from === "board") return <span style={s} className="flex shrink-0 items-center justify-center rounded-lg bg-zinc-100 text-zinc-500 dark:bg-white/[0.07] dark:text-zinc-400"><IconLayoutKanban size={size * 0.5} aria-hidden /></span>;
  return <span style={s} className={`flex shrink-0 items-center justify-center rounded-lg ${tint(from)}`}><RoleIcon role={known.has(from) ? from : "custom"} size={size * 0.5} /></span>;
}

export default function CrewChat({ root }: { root: string }) {
  const t = useT();
  const toast = useToast();
  const [roles, setRoles] = useCrewRoles();
  const [runs] = useCrewRuns(root, () => {});
  const [msgs, setMsgs] = useState<CrewMsg[]>([]);
  const [text, setText] = useState("");
  const [reply, setReply] = useState<CrewMsg | null>(null);
  const [busy, setBusy] = useState(false);
  const [mention, setMention] = useState<{ q: string; at: number } | null>(null); // @ 자동완성
  const [showMembers, setShowMembers] = useState(false);
  const [rolesOpen, setRolesOpen] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const lastTs = useRef(0);
  const stick = useRef(true); // 맨 아래 보는 중이면 새 메시지에 따라 내려감
  const channel = basename(root);

  const load = useCallback(() => {
    fetch(`/api/crew/chat?root=${encodeURIComponent(root)}&since=${lastTs.current}`).then((r) => r.json()).then((j) => {
      if (!j?.ok || !j.msgs.length) return;
      lastTs.current = j.msgs[j.msgs.length - 1].ts;
      setMsgs((prev) => { const seen = new Set(prev.map((m) => m.id)); const add = (j.msgs as CrewMsg[]).filter((m) => !seen.has(m.id)); return add.length ? [...prev, ...add].slice(-600) : prev; });
    }).catch(() => {});
  }, [root]);
  useEffect(() => { lastTs.current = 0; setMsgs([]); load(); const id = setInterval(load, 2000); return () => clearInterval(id); }, [load]); // eslint-disable-line react-hooks/set-state-in-effect -- 레포 바뀌면 비우고 다시
  useEffect(() => { const el = listRef.current; if (el && stick.current) el.scrollTop = el.scrollHeight; }, [msgs]);

  const known = useMemo(() => new Set(roles.map((r) => r.id)), [roles]);
  const who = useCallback((from: string) => (from === "human" ? t("crewchat.you.name") : from === "board" ? t("crewchat.board") : roleName(t, roles, from)), [roles, t]);
  const titles = useMemo(() => { const m = new Map<string, string>(); for (const x of msgs) if (x.taskId && x.taskTitle) m.set(x.taskId, x.taskTitle); return m; }, [msgs]);
  // 멤버 상태 — 그 역할의 진행 중 실행(권한 대기면 내 확인 필요)
  const status = useCallback((roleId: string): { kind: "working" | "waiting" | "idle"; card?: string } => {
    const r = [...runs.values()].find((x: CrewRun) => x.role === roleId && isActiveRun(x));
    if (!r) return { kind: "idle" };
    return { kind: r.state === "needs-permission" ? "waiting" : "working", card: titles.get(r.taskId) ?? "" };
  }, [runs, titles]);
  const workingCount = roles.filter((r) => status(r.id).kind !== "idle").length;

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

  // @ 뒤 글자로 에이전트 후보
  const onChange = (v: string, caret: number) => {
    setText(v);
    const m = /(^|\s)@([a-z0-9-]*)$/i.exec(v.slice(0, caret));
    setMention(m ? { q: m[2].toLowerCase(), at: caret - m[2].length } : null);
  };
  const candidates = mention ? roles.filter((r) => r.id.includes(mention.q) || roleName(t, roles, r.id).toLowerCase().includes(mention.q)).slice(0, 8) : [];
  const pick = (id: string) => {
    const at = mention?.at ?? text.length;
    const q = mention?.q ?? "";
    const needAt = !mention; // 멤버 목록에서 누름 → @부터 넣음
    const v = `${text.slice(0, at)}${needAt ? `${text && !/\s$/.test(text) ? " " : ""}@` : ""}${id} ${text.slice(at + q.length)}`;
    setText(v); setMention(null); setShowMembers(false);
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  // 본문의 @역할을 칩으로
  const renderText = (s: string) => s.split(/(@[a-z0-9][a-z0-9-]{0,39})/gi).map((part, i) => {
    const id = part.startsWith("@") ? part.slice(1).toLowerCase() : "";
    if (id === "you") return <span key={i} className="rounded bg-amber-500/15 px-1 font-medium text-amber-700 dark:text-amber-300">@{t("crewchat.you.name")}</span>;
    if (id && known.has(id)) return <span key={i} className="rounded bg-sky-500/10 px-1 font-medium text-sky-700 dark:text-sky-300">@{roleName(t, roles, id)}</span>;
    return <span key={i}>{part}</span>;
  });

  const dayLabel = (ts: number) => {
    const d = new Date(ts), now = new Date(), y = new Date(now); y.setDate(now.getDate() - 1);
    if (dayKey(ts) === dayKey(now.getTime())) return t("crewchat.today");
    if (dayKey(ts) === dayKey(y.getTime())) return t("crewchat.yesterday");
    return d.toLocaleDateString([], { month: "long", day: "numeric", weekday: "short" });
  };

  const memberRow = (r: (typeof roles)[number]) => {
    const st = status(r.id);
    return (
      <button key={r.id} type="button" onClick={() => pick(r.id)} className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition hover:bg-zinc-100 dark:hover:bg-white/[0.05]">
        <span className="relative"><Avatar from={r.id} known={known} size={28} />
          <span className={`absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full ring-2 ring-white dark:ring-[var(--s-pane)] ${st.kind === "working" ? "bg-emerald-500" : st.kind === "waiting" ? "bg-amber-500" : "bg-zinc-300 dark:bg-zinc-600"}`} aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-1.5"><span className="truncate text-[12.5px] font-medium text-zinc-800 dark:text-zinc-100">{roleName(t, roles, r.id)}</span><span className="shrink-0 text-[10.5px] text-zinc-400 dark:text-zinc-500">{PROVIDER_LABEL[r.provider] ?? r.provider}</span></span>
          <span className={`block truncate text-[11px] ${st.kind === "working" ? "text-emerald-600 dark:text-emerald-400" : st.kind === "waiting" ? "text-amber-600 dark:text-amber-400" : "text-zinc-400 dark:text-zinc-500"}`}>
            {st.kind === "working" ? t("crewchat.statusWorking", { card: st.card ?? "" }) : st.kind === "waiting" ? t("crewchat.statusWaiting", { card: st.card ?? "" }) : roleDesc(t, roles, r.id) || t("crewchat.statusIdle")}
          </span>
        </span>
      </button>
    );
  };

  return (
    <div className="relative flex h-full min-h-0 flex-col bg-white dark:bg-[var(--s-pane)]">
      {/* 채널 헤더 — # 레포, 제목, 멤버 아바타 묶음(누르면 멤버 목록) */}
      <div className="flex h-11 shrink-0 items-center gap-1.5 border-b border-zinc-200 px-3 dark:border-zinc-800">
        <IconHash size={15} stroke={2.2} className="shrink-0 text-zinc-400" aria-hidden />
        <span className="truncate text-[13.5px] font-semibold text-zinc-800 dark:text-zinc-100">{channel}</span>
        <span className="truncate text-[11.5px] text-zinc-400 dark:text-zinc-500">· {t("crewchat.title")}</span>
        <button type="button" onClick={() => setShowMembers((v) => !v)} title={t("crewchat.members")} aria-pressed={showMembers}
          className={`ml-auto flex shrink-0 items-center gap-1.5 rounded-lg border px-1.5 py-1 transition ${showMembers ? "border-zinc-300 bg-zinc-100 dark:border-white/15 dark:bg-white/[0.07]" : "border-zinc-200 hover:bg-zinc-50 dark:border-white/10 dark:hover:bg-white/[0.04]"}`}>
          <span className="flex -space-x-1.5">
            {roles.slice(0, 3).map((r) => <span key={r.id} className="rounded-md ring-2 ring-white dark:ring-[var(--s-pane)]"><Avatar from={r.id} known={known} size={18} /></span>)}
          </span>
          <span className="text-[11.5px] tabular-nums text-zinc-600 dark:text-zinc-300">{roles.length}</span>
          {workingCount > 0 && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" aria-hidden />}
        </button>
      </div>

      {/* 멤버(저장된 에이전트 프로필) */}
      {showMembers && (
        <div className="absolute inset-x-0 top-11 z-20 max-h-[60%] border-b border-zinc-200 bg-white/95 shadow-lg backdrop-blur dark:border-zinc-800 dark:bg-[var(--s-pane)]/95">
          <div className="flex items-center px-3 pb-1 pt-2.5">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500">{t("crewchat.membersCount", { n: roles.length })}</span>
            <button type="button" onClick={() => setRolesOpen(true)} className="ml-auto flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-800 dark:text-zinc-400 dark:hover:bg-white/10 dark:hover:text-zinc-200">
              <IconSettings size={12} aria-hidden />{t("crewchat.manageRoles")}
            </button>
          </div>
          <div className="nunopi-scroll max-h-[calc(60vh-3rem)] overflow-y-auto px-1.5 pb-2">{roles.map(memberRow)}</div>
        </div>
      )}

      <div ref={listRef} onScroll={(e) => { const el = e.currentTarget; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40; }}
        className="nunopi-scroll min-h-0 flex-1 overflow-y-auto pb-2 pt-1">
        {!msgs.length && (
          <div className="px-3 pt-6">
            <div className="mb-3 flex items-center gap-2">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-zinc-100 text-zinc-500 dark:bg-white/[0.06] dark:text-zinc-400"><IconHash size={20} aria-hidden /></span>
              <div>
                <div className="text-[15px] font-semibold text-zinc-900 dark:text-zinc-50">#{channel}</div>
                <div className="text-[12px] text-zinc-500 dark:text-zinc-400">{t("crewchat.empty")}</div>
              </div>
            </div>
            <div className="rounded-xl border border-zinc-200 p-1.5 dark:border-white/10">{roles.map(memberRow)}</div>
          </div>
        )}
        {msgs.map((m, i) => {
          const prev = msgs[i - 1];
          const newDay = !prev || dayKey(prev.ts) !== dayKey(m.ts);
          const grouped = !newDay && !!prev && prev.from === m.from && prev.taskId === m.taskId && m.ts - prev.ts < 5 * 60_000 && !LOUD.has(m.kind) && !m.replyTo;
          const loud = LOUD.has(m.kind);
          const parent = m.replyTo ? msgs.find((x) => x.id === m.replyTo) : undefined;
          return (
            <div key={m.id}>
              {newDay && (
                <div className="relative my-2 flex items-center px-3" aria-hidden>
                  <span className="h-px flex-1 bg-zinc-200 dark:bg-white/10" />
                  <span className="mx-2 rounded-full border border-zinc-200 px-2.5 py-0.5 text-[10.5px] font-medium text-zinc-500 dark:border-white/10 dark:text-zinc-400">{dayLabel(m.ts)}</span>
                  <span className="h-px flex-1 bg-zinc-200 dark:bg-white/10" />
                </div>
              )}
              <div className={`group/msg relative flex gap-2.5 px-3 ${grouped ? "py-0.5" : "pt-2 pb-0.5"} hover:bg-zinc-50 dark:hover:bg-white/[0.025]`}>
                <div className="w-8 shrink-0">
                  {grouped
                    ? <span className="block pt-0.5 text-right text-[9.5px] tabular-nums text-zinc-400 opacity-0 group-hover/msg:opacity-100">{time(m.ts)}</span>
                    : <Avatar from={m.from} known={known} />}
                </div>
                <div className="min-w-0 flex-1">
                  {!grouped && (
                    <div className="flex flex-wrap items-baseline gap-x-1.5">
                      <span className="text-[13px] font-bold text-zinc-900 dark:text-zinc-50">{who(m.from)}</span>
                      {m.provider && <span className="rounded bg-zinc-100 px-1 text-[10px] font-medium text-zinc-500 dark:bg-white/[0.07] dark:text-zinc-400">{PROVIDER_LABEL[m.provider] ?? m.provider}</span>}
                      <span className="text-[10.5px] tabular-nums text-zinc-400 dark:text-zinc-500">{time(m.ts)}</span>
                    </div>
                  )}
                  {parent && <div className="mb-0.5 flex items-center gap-1 truncate border-l-2 border-zinc-300 pl-1.5 text-[11px] text-zinc-400 dark:border-white/15 dark:text-zinc-500"><IconArrowBackUp size={11} aria-hidden />{who(parent.from)}: {parent.text.slice(0, 80)}</div>}
                  <div className={`whitespace-pre-wrap break-words text-[13px] leading-[1.55] ${loud ? `mt-1 rounded-lg border-l-[3px] px-2.5 py-1.5 ${m.kind === "blocked" ? "border-rose-500 bg-rose-50 text-rose-900 dark:bg-rose-500/[0.08] dark:text-rose-200" : "border-amber-500 bg-amber-50 text-amber-900 dark:bg-amber-500/[0.08] dark:text-amber-100"}` : "text-zinc-800 dark:text-zinc-200"}`}>
                    {renderText(m.text)}
                  </div>
                  {m.taskId && (m.taskTitle || titles.get(m.taskId)) && !grouped && (
                    <button type="button" onClick={() => openCrewTask(root, m.taskId!)} title={t("crewchat.openCard")}
                      className="mt-1 inline-flex max-w-full items-center gap-1 truncate rounded-md border border-zinc-200 px-1.5 py-0.5 text-[11px] text-zinc-500 transition hover:border-zinc-300 hover:bg-zinc-50 hover:text-zinc-800 dark:border-white/10 dark:text-zinc-400 dark:hover:bg-white/[0.04] dark:hover:text-zinc-200">
                      <IconLayoutKanban size={11} aria-hidden /><span className="truncate">{m.taskTitle || titles.get(m.taskId)}</span>
                    </button>
                  )}
                </div>
                {m.taskId && m.from !== "human" && (
                  <button type="button" onClick={() => { setReply(m); inputRef.current?.focus(); }} title={t("crewchat.reply")} aria-label={t("crewchat.reply")}
                    className="absolute right-2 top-1 flex items-center gap-1 rounded-md border border-zinc-200 bg-white px-1.5 py-0.5 text-[11px] text-zinc-500 opacity-0 shadow-sm transition hover:text-zinc-800 group-hover/msg:opacity-100 dark:border-white/10 dark:bg-[#1b1c24] dark:text-zinc-400 dark:hover:text-zinc-200">
                    <IconArrowBackUp size={12} aria-hidden />{t("crewchat.reply")}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* 입력 상자 */}
      <div className="relative shrink-0 px-3 pb-3 pt-1">
        {candidates.length > 0 && (
          <div className="absolute bottom-full left-3 right-3 mb-1 rounded-xl border border-zinc-200 bg-white p-1 shadow-xl dark:border-white/10 dark:bg-[#1b1c24]">
            {candidates.map((r) => (
              <button key={r.id} type="button" onMouseDown={(e) => { e.preventDefault(); pick(r.id); }}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition hover:bg-zinc-100 dark:hover:bg-white/5">
                <Avatar from={r.id} known={known} size={20} />
                <span className="text-[12.5px] text-zinc-800 dark:text-zinc-100">{roleName(t, roles, r.id)}</span>
                <span className="ml-auto font-mono text-[10.5px] text-zinc-400">@{r.id}</span>
              </button>
            ))}
          </div>
        )}
        <div className="rounded-xl border border-zinc-300 bg-white focus-within:border-zinc-400 focus-within:shadow-sm dark:border-white/15 dark:bg-white/[0.03] dark:focus-within:border-white/25">
          {reply && (
            <div className="flex items-center gap-1.5 border-b border-zinc-100 px-2.5 py-1 text-[11.5px] text-zinc-600 dark:border-white/5 dark:text-zinc-300">
              <IconArrowBackUp size={12} aria-hidden />
              <span className="truncate">{t("crewchat.replyingTo", { who: who(reply.from) })}{reply.taskTitle ? ` · ${reply.taskTitle}` : ""}</span>
              <button type="button" onClick={() => setReply(null)} className="ml-auto rounded p-0.5 hover:bg-zinc-100 dark:hover:bg-white/10" aria-label={t("crew.cancel")}><IconX size={12} aria-hidden /></button>
            </div>
          )}
          <textarea ref={inputRef} value={text} rows={1} placeholder={t("crewchat.placeholder", { channel })}
            onChange={(e) => onChange(e.target.value, e.target.selectionStart)}
            onKeyDown={(e) => {
              if (candidates.length && (e.key === "Enter" || e.key === "Tab")) { e.preventDefault(); pick(candidates[0].id); return; }
              if (e.key === "Escape") { setMention(null); if (!mention) setReply(null); return; }
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(); }
            }}
            className="nunopi-scroll block max-h-40 min-h-[40px] w-full resize-none bg-transparent px-3 pt-2.5 text-[13px] leading-relaxed text-zinc-800 outline-none placeholder:text-zinc-400 [field-sizing:content] dark:text-zinc-100" />
          <div className="flex items-center gap-1 px-1.5 pb-1.5">
            <button type="button" onClick={() => { setText((v) => `${v}${v && !/\s$/.test(v) ? " " : ""}@`); setMention({ q: "", at: text.length + (text && !/\s$/.test(text) ? 2 : 1) }); inputRef.current?.focus(); }}
              title={t("crewchat.mentionButton")} aria-label={t("crewchat.mentionButton")}
              className="rounded-md p-1.5 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-white/10 dark:hover:text-zinc-200">
              <IconAt size={15} aria-hidden />
            </button>
            <button type="button" onClick={() => setShowMembers((v) => !v)} title={t("crewchat.members")} aria-label={t("crewchat.members")}
              className="rounded-md p-1.5 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-white/10 dark:hover:text-zinc-200">
              <IconUsers size={15} aria-hidden />
            </button>
            <span className="ml-1 truncate text-[10.5px] text-zinc-400 dark:text-zinc-500">{t("crewchat.hint")}</span>
            <button type="button" onClick={() => void send()} disabled={!text.trim() || busy} aria-label={t("crewchat.send")}
              className="ml-auto flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-mustard-500 text-brown-900 transition hover:bg-mustard-400 disabled:bg-zinc-200 disabled:text-zinc-400 dark:disabled:bg-white/10 dark:disabled:text-zinc-500">
              <IconArrowUp size={15} stroke={2.2} aria-hidden />
            </button>
          </div>
        </div>
      </div>

      {rolesOpen && <RolesDialog roles={roles} onRoles={setRoles} onClose={() => setRolesOpen(false)} />}
    </div>
  );
}
