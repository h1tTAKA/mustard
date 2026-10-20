"use client";
// 에이전트 대화방(#1104·#1106·#1108, 에픽 #1097) — 역할 에이전트·보드·사람이 주고받는 레포별 방. 오른쪽 패널(캐치업 ↔ GitHub 사이).
// 채팅앱(단톡방)형: 방 헤더 + 멤버 프로필 줄(상태 점·누르면 @), 남은 왼쪽 아바타·이름·말풍선, 나는 오른쪽 겨자 말풍선, 보드 안내는 가운데 알림, 날짜 알약.
// 입력: @에이전트 = 그 역할에게 새 카드(그록봇식), 메시지에 답글 = 그 카드로 전달. 2초 폴링(since 이후만).
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { IconArrowBackUp, IconArrowUp, IconAt, IconLayoutKanban, IconSettings, IconUser, IconUsers, IconX } from "@tabler/icons-react";
import { Markdown, useT, useToast, relocalize, CREW_TEXT_KEYS } from "@mustard/core";
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
  if (from === "human") return <span style={s} className="flex shrink-0 items-center justify-center rounded-full bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"><IconUser size={size * 0.5} aria-hidden /></span>;
  if (from === "board") return <span style={s} className="flex shrink-0 items-center justify-center rounded-full bg-zinc-100 text-zinc-500 dark:bg-white/[0.07] dark:text-zinc-400"><IconLayoutKanban size={size * 0.5} aria-hidden /></span>;
  return <span style={s} className={`flex shrink-0 items-center justify-center rounded-full ${tint(from)}`}><RoleIcon role={known.has(from) ? from : "custom"} size={size * 0.5} /></span>;
}

const DECISION_KEYS = ["crewchat.decision.approve", "crewchat.decision.retry"];

export default function CrewChat({ root }: { root: string }) {
  const t = useT();
  // #1125 보드·시스템 메시지는 키로 지금 언어 번역(옛 메시지는 text를 틀과 맞춰 다시 번역), 사람이 친 말은 그대로(키 없는 옛 승인 버튼 문구만 — 고정 문장 통째 일치)
  const msgText = (m: CrewMsg) => (m.i18n ? t(m.i18n.key, m.i18n.vars) + (m.i18n.suffix ?? "") : m.from === "human" ? (m.kind === "decision" ? relocalize(m.text, DECISION_KEYS, t) : m.text) : relocalize(m.text, CREW_TEXT_KEYS, t));
  const toast = useToast();
  const [roles, setRoles] = useCrewRoles();
  const [runs, reloadRuns] = useCrewRuns(root, () => {});
  const [msgs, setMsgs] = useState<CrewMsg[]>([]);
  const [text, setText] = useState("");
  const [reply, setReply] = useState<CrewMsg | null>(null);
  const [busy, setBusy] = useState(false);
  const [mention, setMention] = useState<{ q: string; at: number } | null>(null); // @ 자동완성
  const [rolesOpen, setRolesOpen] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const lastTs = useRef(0);
  const stick = useRef(true); // 맨 아래 보는 중이면 새 메시지에 따라 내려감
  const channel = basename(root);

  const [answering, setAnswering] = useState<string[]>([]); // #1139 @ 없는 글에 답 쓰는 중인 역할
  const load = useCallback(() => {
    fetch(`/api/crew/chat?root=${encodeURIComponent(root)}&since=${lastTs.current}`).then((r) => r.json()).then((j) => {
      if (j?.ok) setAnswering((prev) => { const next = Array.isArray(j.answering) ? (j.answering as string[]) : []; return prev.join() === next.join() ? prev : next; });
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
    if (!r) return answering.includes(roleId) ? { kind: "working", card: t("crewchat.typing") } : { kind: "idle" };
    return { kind: r.state === "needs-permission" ? "waiting" : "working", card: titles.get(r.taskId) ?? "" };
  }, [runs, titles, answering, t]);
  // #1137 권한 알림 → 그 카드가 지금 권한 대기이고 그 카드의 마지막 권한 글이면 허락·거절 버튼(보드 카드 창까지 안 가도 되게)
  const lastPerm = useMemo(() => { const m = new Map<string, string>(); for (const x of msgs) if (x.kind === "permission" && x.taskId) m.set(x.taskId, x.id); return m; }, [msgs]);
  const [permBusy, setPermBusy] = useState(false);
  const answerPerm = async (taskId: string, approved: boolean) => {
    if (permBusy) return;
    setPermBusy(true);
    try {
      const j = await (await fetch("/api/crew/run", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ root, taskId, action: "permission", approved }) })).json();
      if (!j?.ok) throw new Error(j?.error);
    } catch (e) { toast(`${t("crew.runFailed")}: ${String((e as Error)?.message ?? e)}`, "error"); }
    finally { setPermBusy(false); reloadRuns(); }
  };
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
    setText(v); setMention(null);
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  // 본문의 @역할을 칩으로
  // #1139 에이전트 말은 마크다운으로(`코드`·**굵게**·목록). 코드 밖 글자만 손봄(리뷰): @역할 → 이름 칩(링크 꼴 + CSS),
  // 한 줄 바꿈 → 줄 바꿈 유지(마크다운은 합쳐 버림). 학습 카드 블록(```nunopi-cards```)은 옛 답에 저장돼 있어도 숨김.
  // 링크는 앱 창이 넘어가지 않게 — http(s)·mailto만 새 창(= 기본 브라우저), 그 밖(앱 내부 스킴·상대 주소)은 아무 일 없음.
  const mdEsc = (x: string) => x.replace(/[\\*_`[\]~|&]/g, "\\$&");
  const renderMd = (s: string) => (
    <Markdown className="crew-md text-[12.5px] leading-relaxed" onLink={(href) => { const m = /^#@([a-z0-9-]+)$/.exec(href); if (m) { if (m[1] !== "you") pick(m[1]); } else if (/^(https?:|mailto:)/i.test(href)) window.open(href, "_blank", "noopener"); return true; }}>
      {s.replace(/```nunopi-cards[\s\S]*?(```|$)/g, "").trim().split(/((?<=^|\n)[ \t]*```[\s\S]*?(?:```|$)|(?<=^|\n)[ \t]*~~~[\s\S]*?(?:~~~|$)|`[^`\n]+`)/).map((seg, i) => (i % 2 ? seg : seg
        .replace(/(?<![\w.*_/])@([a-z0-9][a-z0-9-]{0,39})/gi, (m0, id: string) => {
          const k = id.toLowerCase();
          // 링크 꼴 [@이름](#@역할) — globals.css .crew-md가 예전 칩 색(하늘·나는 호박)으로, 누르면 그 역할 @부르기(유저)
          return k === "you" ? `[@${mdEsc(t("crewchat.you.name"))}](#@you)` : known.has(k) ? `[@${mdEsc(roleName(t, roles, k))}](#@${k})` : m0;
        })
        .replace(/(?<!\n)\n(?!\n)/g, "  \n"))).join("")}
    </Markdown>
  );
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


  const statusDot = (k: "working" | "waiting" | "idle") => (k === "working" ? "bg-emerald-500" : k === "waiting" ? "bg-amber-500" : "bg-zinc-300 dark:bg-zinc-600");

  return (
    <div className="relative flex h-full min-h-0 flex-col bg-zinc-50 dark:bg-[#1a1b22]">
      {/* 방 헤더 — 이름·인원·관리 */}
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-zinc-200 bg-white px-3 dark:border-zinc-800 dark:bg-[var(--s-pane)]">
        <span className="truncate text-[13.5px] font-semibold text-zinc-900 dark:text-zinc-50">{t("crewchat.title")}</span>
        <span className="flex shrink-0 items-center gap-0.5 text-[11.5px] tabular-nums text-zinc-400"><IconUsers size={12} aria-hidden />{roles.length + 1}</span>
        {workingCount > 0 && <span className="flex shrink-0 items-center gap-1 rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-[10.5px] font-medium text-emerald-600 dark:text-emerald-400"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" aria-hidden />{workingCount}</span>}
        <span className="ml-auto truncate text-[11px] text-zinc-400 dark:text-zinc-500">{channel}</span>
        <button type="button" onClick={() => setRolesOpen(true)} title={t("crewchat.manageRoles")} aria-label={t("crewchat.manageRoles")}
          className="shrink-0 rounded-md p-1 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-white/10 dark:hover:text-zinc-200">
          <IconSettings size={14} aria-hidden />
        </button>
      </div>

      {/* 멤버 프로필 줄 — 누르면 @부르기, 상태 점(작업 중·내 확인 필요·대기) */}
      <div className="nunopi-scroll flex shrink-0 gap-1 overflow-x-auto border-b border-zinc-200 bg-white px-2 py-2 dark:border-zinc-800 dark:bg-[var(--s-pane)]">
        {roles.map((r) => {
          const st = status(r.id);
          return (
            <button key={r.id} type="button" onClick={() => pick(r.id)}
              title={`${roleName(t, roles, r.id)} · ${PROVIDER_LABEL[r.provider] ?? r.provider}\n${st.kind === "working" ? t("crewchat.statusWorking", { card: st.card ?? "" }) : st.kind === "waiting" ? t("crewchat.statusWaiting", { card: st.card ?? "" }) : roleDesc(t, roles, r.id)}`}
              className="flex w-[58px] shrink-0 flex-col items-center gap-1 rounded-lg py-1 transition hover:bg-zinc-100 dark:hover:bg-white/[0.05]">
              <span className="relative"><Avatar from={r.id} known={known} size={34} />
                <span className={`absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full ring-2 ring-white dark:ring-[var(--s-pane)] ${statusDot(st.kind)}`} aria-hidden />
              </span>
              <span className="w-full truncate px-0.5 text-center text-[10.5px] text-zinc-600 dark:text-zinc-300">{roleName(t, roles, r.id)}</span>
            </button>
          );
        })}
      </div>

      <div ref={listRef} onScroll={(e) => { const el = e.currentTarget; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40; }}
        className="nunopi-scroll min-h-0 flex-1 overflow-y-auto px-3 py-2">
        {!msgs.length && (
          <div className="flex h-full flex-col items-center justify-center px-6 text-center">
            <div className="mb-3 flex -space-x-2">{roles.slice(0, 5).map((r) => <span key={r.id} className="rounded-full ring-2 ring-zinc-50 dark:ring-[#1a1b22]"><Avatar from={r.id} known={known} size={36} /></span>)}</div>
            <div className="text-[14px] font-semibold text-zinc-800 dark:text-zinc-100">{t("crewchat.emptyTitle")}</div>
            <div className="mt-1 text-[12px] leading-relaxed text-zinc-500 dark:text-zinc-400">{t("crewchat.emptyHint")}</div>
          </div>
        )}
        {msgs.map((m, i) => {
          const prev = msgs[i - 1], nextM = msgs[i + 1];
          const newDay = !prev || dayKey(prev.ts) !== dayKey(m.ts);
          const sameRun = (a?: CrewMsg, b?: CrewMsg) => !!a && !!b && a.from === b.from && a.from !== "board" && a.taskId === b.taskId && dayKey(a.ts) === dayKey(b.ts) && b.ts - a.ts < 3 * 60_000;
          const first = !sameRun(prev, m) || newDay;               // 묶음 첫 메시지 = 아바타·이름
          const last = !sameRun(m, nextM);                          // 묶음 마지막 = 시간 표시
          const isMe = m.from === "human", isBoard = m.from === "board";
          const loud = LOUD.has(m.kind);
          const parent = m.replyTo ? msgs.find((x) => x.id === m.replyTo) : undefined;
          const cardChip = m.taskId && (m.taskTitle || titles.get(m.taskId)) && last ? (
            <button type="button" onClick={() => openCrewTask(root, m.taskId!)} title={t("crewchat.openCard")}
              className="mt-1 inline-flex max-w-[15rem] items-center gap-1 truncate rounded-full bg-white px-2 py-0.5 text-[10.5px] text-zinc-500 shadow-sm ring-1 ring-zinc-200 transition hover:text-zinc-800 dark:bg-white/[0.06] dark:text-zinc-400 dark:ring-white/10 dark:hover:text-zinc-200">
              <IconLayoutKanban size={10} aria-hidden /><span className="truncate">{m.taskTitle || titles.get(m.taskId)}</span>
            </button>
          ) : null;
          return (
            <div key={m.id}>
              {newDay && <div className="my-3 flex justify-center"><span className="rounded-full bg-zinc-200/70 px-3 py-0.5 text-[10.5px] font-medium text-zinc-600 dark:bg-white/[0.07] dark:text-zinc-400">{dayLabel(m.ts)}</span></div>}
              {isBoard ? (
                /* 보드 안내 — 가운데 알림 */
                <div className="my-2 flex flex-col items-center">
                  <div className={`max-w-[88%] rounded-xl px-3 py-1.5 text-center text-[11.5px] leading-relaxed ${m.kind === "blocked" ? "bg-rose-500/10 text-rose-700 dark:text-rose-300" : "bg-amber-500/10 text-amber-800 dark:text-amber-200"}`}>
                    <IconLayoutKanban size={11} className="mr-1 inline align-[-1px]" aria-hidden />{renderText(msgText(m))}
                  </div>
                  {cardChip}
                </div>
              ) : isMe ? (
                /* 나 — 오른쪽 옅은 겨자 말풍선(진한 겨자는 글자가 안 읽힘, #1135 유저) */
                <div className={`flex flex-col items-end ${first ? "mt-2.5" : "mt-0.5"}`}>
                  {parent && <div className="mb-0.5 max-w-[80%] truncate text-[10.5px] text-zinc-400"><IconArrowBackUp size={10} className="mr-0.5 inline" aria-hidden />{who(parent.from)}: {msgText(parent).slice(0, 60)}</div>}
                  <div className="flex max-w-[85%] items-end gap-1.5">
                    {last && <span className="shrink-0 pb-0.5 text-[9.5px] tabular-nums text-zinc-400">{time(m.ts)}</span>}
                    <div className={`whitespace-pre-wrap break-words rounded-2xl bg-mustard-500/12 px-3 py-1.5 text-[12.5px] leading-relaxed text-zinc-800 ring-1 ring-inset ring-mustard-500/35 dark:bg-mustard-400/12 dark:text-zinc-100 dark:ring-mustard-400/30 ${first ? "rounded-tr-md" : ""}`}>{renderText(msgText(m))}</div>
                  </div>
                  {cardChip}
                </div>
              ) : (
                /* 에이전트 — 왼쪽 아바타·이름·말풍선 */
                <div className={`group/msg flex gap-2 ${first ? "mt-2.5" : "mt-0.5"}`}>
                  <div className="w-8 shrink-0">{first && <Avatar from={m.from} known={known} />}</div>
                  <div className="flex min-w-0 max-w-[85%] flex-col items-start">
                    {first && (
                      <div className="mb-0.5 flex items-baseline gap-1.5 px-0.5">
                        <span className="text-[11.5px] font-medium text-zinc-700 dark:text-zinc-200">{who(m.from)}</span>
                        {m.provider && <span className="text-[10px] text-zinc-400 dark:text-zinc-500">{PROVIDER_LABEL[m.provider] ?? m.provider}</span>}
                      </div>
                    )}
                    <div className="flex items-end gap-1.5">
                      <div className={`min-w-0 break-words rounded-2xl px-3 py-1.5 text-[12.5px] leading-relaxed ${first ? "rounded-tl-md" : ""} ${loud ? (m.kind === "blocked" ? "bg-rose-50 text-rose-900 ring-1 ring-rose-300/60 dark:bg-rose-500/10 dark:text-rose-100 dark:ring-rose-500/30" : "bg-amber-50 text-amber-900 ring-1 ring-amber-300/60 dark:bg-amber-500/10 dark:text-amber-100 dark:ring-amber-500/30") : "bg-white text-zinc-800 shadow-sm ring-1 ring-zinc-200/70 dark:bg-white/[0.07] dark:text-zinc-100 dark:ring-white/5"}`}>
                        {renderMd(msgText(m))}
                      </div>
                      <span className="flex shrink-0 flex-col items-start gap-0.5 pb-0.5">
                        {m.taskId && (
                          <button type="button" onClick={() => { setReply(m); inputRef.current?.focus(); }} title={t("crewchat.reply")} aria-label={t("crewchat.reply")}
                            className="rounded-full p-0.5 text-zinc-400 opacity-0 transition hover:bg-zinc-200 hover:text-zinc-700 group-hover/msg:opacity-100 dark:hover:bg-white/10 dark:hover:text-zinc-200">
                            <IconArrowBackUp size={12} aria-hidden />
                          </button>
                        )}
                        {last && <span className="text-[9.5px] tabular-nums text-zinc-400">{time(m.ts)}</span>}
                      </span>
                    </div>
                    {m.kind === "permission" && m.taskId && lastPerm.get(m.taskId) === m.id && runs.get(m.taskId)?.state === "needs-permission" && (
                      <div className="mt-1 flex gap-1.5">
                        <button type="button" disabled={permBusy} onClick={() => void answerPerm(m.taskId!, false)} className="rounded-lg px-2.5 py-1 text-[12px] font-medium text-zinc-600 transition hover:bg-amber-100 disabled:opacity-50 dark:text-zinc-300 dark:hover:bg-white/10">{t("crew.deny")}</button>
                        <button type="button" disabled={permBusy} onClick={() => void answerPerm(m.taskId!, true)} className="rounded-lg bg-amber-500 px-2.5 py-1 text-[12px] font-semibold text-white transition hover:bg-amber-600 disabled:opacity-50">{t("crew.approve")}</button>
                      </div>
                    )}
                    {cardChip}
                  </div>
                </div>
              )}
            </div>
          );
        })}
        {answering.map((id) => ( /* #1139 답 쓰는 중 — 에이전트 말풍선 자리에 */
          <div key={`typing-${id}`} className="mt-2.5 flex items-center gap-2">
            <div className="w-8 shrink-0"><Avatar from={id} known={known} /></div>
            <span className="text-[11.5px] text-zinc-400 dark:text-zinc-500">{t("crewchat.typingBy", { role: roleName(t, roles, id) })}</span>
          </div>
        ))}
      </div>

      {/* 입력 — 둥근 입력칸 + @ + 보내기 */}
      <div className="relative shrink-0 border-t border-zinc-200 bg-white px-2.5 py-2 dark:border-zinc-800 dark:bg-[var(--s-pane)]">
        {candidates.length > 0 && (
          <div className="absolute bottom-full left-2.5 right-2.5 mb-1 rounded-xl border border-zinc-200 bg-white p-1 shadow-xl dark:border-white/10 dark:bg-[#1b1c24]">
            {candidates.map((r) => (
              <button key={r.id} type="button" onMouseDown={(e) => { e.preventDefault(); pick(r.id); }}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition hover:bg-zinc-100 dark:hover:bg-white/5">
                <Avatar from={r.id} known={known} size={22} />
                <span className="text-[12.5px] text-zinc-800 dark:text-zinc-100">{roleName(t, roles, r.id)}</span>
                <span className="ml-auto font-mono text-[10.5px] text-zinc-400">@{r.id}</span>
              </button>
            ))}
          </div>
        )}
        {reply && (
          <div className="mb-1.5 flex items-center gap-1.5 rounded-lg bg-zinc-100 px-2.5 py-1 text-[11.5px] text-zinc-600 dark:bg-white/[0.05] dark:text-zinc-300">
            <IconArrowBackUp size={12} aria-hidden />
            <span className="truncate">{t("crewchat.replyingTo", { who: who(reply.from) })}{reply.taskTitle ? ` · ${reply.taskTitle}` : ""}</span>
            <button type="button" onClick={() => setReply(null)} className="ml-auto rounded p-0.5 hover:bg-zinc-200 dark:hover:bg-white/10" aria-label={t("crew.cancel")}><IconX size={12} aria-hidden /></button>
          </div>
        )}
        <div className="flex items-end gap-1.5">
          <button type="button" onClick={() => { setText((v) => `${v}${v && !/\s$/.test(v) ? " " : ""}@`); setMention({ q: "", at: text.length + (text && !/\s$/.test(text) ? 2 : 1) }); inputRef.current?.focus(); }}
            title={t("crewchat.mentionButton")} aria-label={t("crewchat.mentionButton")}
            className="mb-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-800 dark:text-zinc-400 dark:hover:bg-white/10 dark:hover:text-zinc-100">
            <IconAt size={17} aria-hidden />
          </button>
          <textarea ref={inputRef} value={text} rows={1} placeholder={t("crewchat.placeholderShort")}
            onChange={(e) => onChange(e.target.value, e.target.selectionStart)}
            onKeyDown={(e) => {
              if (candidates.length && (e.key === "Enter" || e.key === "Tab")) { e.preventDefault(); pick(candidates[0].id); return; }
              if (e.key === "Escape") { setMention(null); if (!mention) setReply(null); return; }
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(); }
            }}
            className="nunopi-scroll max-h-32 min-h-[36px] flex-1 resize-none rounded-[18px] bg-zinc-100 px-3.5 py-2 text-[12.5px] leading-[1.45] text-zinc-800 outline-none placeholder:text-zinc-400 [field-sizing:content] focus:ring-1 focus:ring-zinc-300 dark:bg-white/[0.06] dark:text-zinc-100 dark:focus:ring-white/15" />
          <button type="button" onClick={() => void send()} disabled={!text.trim() || busy} aria-label={t("crewchat.send")}
            className="mb-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-mustard-500 text-brown-900 transition hover:bg-mustard-400 disabled:bg-zinc-200 disabled:text-zinc-400 dark:disabled:bg-white/10 dark:disabled:text-zinc-500">
            <IconArrowUp size={16} stroke={2.4} aria-hidden />
          </button>
        </div>
      </div>

      {rolesOpen && <RolesDialog roles={roles} onRoles={setRoles} onClose={() => setRolesOpen(false)} />}
    </div>
  );
}
