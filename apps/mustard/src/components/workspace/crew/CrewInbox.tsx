"use client";
// Crew 대화 목록(#1392) — 메신저처럼: 맨 위 팀방, 그룹방, 봇 1:1 방. 행을 누르면 그 방(CrewChat), ←로 목록.
// 행 = 아바타(그룹은 멤버 합성)·이름·마지막 말·시간·안 읽음·작업 중 점. 필터 칩 전체/안 읽음. 새 그룹 = 봇 2개 이상 체크 + 이름.
// 안 읽음 = 방별 '본 글 수'를 브라우저 저장(기기 편의 값 — 지워져도 다 읽음으로 시작할 뿐).
import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { IconLayoutKanban, IconTrash, IconUsersPlus, IconX } from "@tabler/icons-react";
import { relocalize, useConfirm, useT, useToast, CREW_TEXT_KEYS } from "@mustard/core";
import type { CrewMsg } from "@/lib/crew/crewChat";
import type { CrewRole } from "@/lib/crew/crewRoleDefaults";
import CrewChat, { Avatar } from "./CrewChat";
import { isActiveRun, roleName, useCrewRoles, useCrewRuns } from "./crewUi";

const TEAM = "team"; // 목록에서 팀방(서버에선 room 없음)
type Group = { id: string; members: string[]; name?: string };
type Summary = { room: string; last: Pick<CrewMsg, "from" | "kind" | "text" | "ts" | "i18n">; count: number };
type Row = { id: string; kind: "team" | "group" | "dm"; members: string[]; name: string; last?: Summary["last"]; count: number };

const store = {
  get<T>(k: string, d: T): T { try { const v = localStorage.getItem(k); return v ? (JSON.parse(v) as T) : d; } catch { return d; } },
  set(k: string, v: unknown) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* 저장 못 해도 동작 */ } },
};
const time = (ts: number) => {
  const d = new Date(ts), now = new Date();
  return d.toDateString() === now.toDateString() ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : d.toLocaleDateString([], { month: "short", day: "numeric" });
};

// 그룹 아바타 — 멤버 얼굴을 2·3·4칸으로 합성
function GroupAvatar({ members, known, size = 40 }: { members: string[]; known: Set<string>; size?: number }) {
  const m = members.slice(0, 4);
  if (m.length <= 1) return <Avatar from={m[0] ?? "board"} known={known} size={size} />;
  const s = Math.round(size * (m.length === 2 ? 0.62 : 0.5));
  return (
    <span style={{ width: size, height: size }} className="relative grid shrink-0 grid-cols-2 place-items-center gap-px">
      {m.map((id, i) => (
        <span key={id} className={m.length === 3 && i === 0 ? "col-span-2" : m.length === 2 ? (i === 0 ? "self-start justify-self-start" : "self-end justify-self-end") : ""}>
          <Avatar from={id} known={known} size={s} />
        </span>
      ))}
    </span>
  );
}

export default function CrewInbox({ root }: { root: string }) {
  const t = useT();
  const toast = useToast();
  const confirm = useConfirm();
  const [roles] = useCrewRoles();
  const [runs] = useCrewRuns(root, () => {});
  const [groups, setGroups] = useState<Group[]>([]);
  const [sums, setSums] = useState<Summary[]>([]);
  const [open, setOpenState] = useState<string | null>(() => store.get<string | null>(`mustard:crew-room:${root}`, null));
  const [seen, setSeen] = useState<Record<string, number>>(() => store.get(`mustard:crew-seen:${root}`, {}));
  const [filter, setFilter] = useState<"all" | "unread">("all");
  const [dialog, setDialog] = useState<"new" | "settings" | null>(null);

  const setOpen = (id: string | null) => { setOpenState(id); store.set(`mustard:crew-room:${root}`, id); };
  const load = useCallback(() => {
    fetch(`/api/crew/rooms?root=${encodeURIComponent(root)}`).then((r) => r.json()).then((j) => {
      if (!j?.ok) return;
      setGroups(j.groups); setSums(j.summaries);
      // 처음 여는 레포 — 이미 있던 대화는 읽은 것으로(지난 기록 전부가 안 읽음으로 뜨지 않게)
      if (store.get<Record<string, number> | null>(`mustard:crew-seen:${root}`, null) === null) {
        const first = Object.fromEntries((j.summaries as Summary[]).map((s) => [s.room || TEAM, s.count]));
        setSeen(first); store.set(`mustard:crew-seen:${root}`, first);
      }
    }).catch(() => {});
  }, [root]);
  useEffect(() => { load(); const id = setInterval(load, 5000); return () => clearInterval(id); }, [load]);

  const known = useMemo(() => new Set(roles.map((r) => r.id)), [roles]);
  const name = useCallback((id: string) => roleName(t, roles, id), [roles, t]);
  const rows = useMemo<Row[]>(() => {
    const sum = new Map(sums.map((s) => [s.room || TEAM, s]));
    const all = roles.map((r) => r.id);
    const list: Row[] = [
      { id: TEAM, kind: "team", members: all, name: t("crewroom.team"), last: sum.get(TEAM)?.last, count: sum.get(TEAM)?.count ?? 0 },
      ...groups.map((g): Row => ({ id: g.id, kind: "group", members: g.members.filter((m) => known.has(m)), name: g.name || g.members.map(name).join(", "), last: sum.get(g.id)?.last, count: sum.get(g.id)?.count ?? 0 })),
      ...roles.map((r): Row => ({ id: `dm-${r.id}`, kind: "dm", members: [r.id], name: name(r.id), last: sum.get(`dm-${r.id}`)?.last, count: sum.get(`dm-${r.id}`)?.count ?? 0 })),
    ];
    // 최근 대화 순, 대화 없는 방은 원래 순서(팀방 → 그룹 → 봇)
    const order = new Map(list.map((r, i) => [r.id, i]));
    return list.sort((a, b) => (b.last?.ts ?? 0) - (a.last?.ts ?? 0) || order.get(a.id)! - order.get(b.id)!);
  }, [sums, groups, roles, known, name, t]);
  const unread = (r: Row) => Math.max(0, r.count - (seen[r.id] ?? 0));
  const current = open ? rows.find((r) => r.id === open) : undefined;

  // 연 방은 읽음으로(새 글이 와도 열려 있으면 계속)
  useEffect(() => {
    if (!current || (seen[current.id] ?? 0) === current.count) return;
    const next = { ...seen, [current.id]: current.count };
    setSeen(next); store.set(`mustard:crew-seen:${root}`, next); // eslint-disable-line react-hooks/set-state-in-effect -- 목록 요약이 오면 읽음 표시
  }, [current, seen, root]);

  const roomOp = async (body: Record<string, unknown>) => {
    const j = await (await fetch("/api/crew/rooms", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ root, ...body }) })).json();
    if (!j?.ok) throw new Error(j?.error);
    load();
    return j as { room?: Group; existing?: boolean };
  };

  if (current) {
    const roomId = current.kind === "team" ? undefined : current.id;
    return (
      <>
        <CrewChat key={current.id} root={root} room={roomId} title={current.name} members={current.kind === "team" ? undefined : current.members}
          dm={current.kind === "dm" ? current.members[0] : undefined} onBack={() => setOpen(null)}
          onSettings={current.kind === "group" ? () => setDialog("settings") : undefined} />
        {dialog === "settings" && current.kind === "group" && (
          <GroupDialog roles={roles} known={known} group={groups.find((g) => g.id === current.id)} onClose={() => setDialog(null)}
            onSave={async (members, gname) => {
              const g = groups.find((x) => x.id === current.id)!;
              try {
                const add = members.filter((m) => !g.members.includes(m));
                if (add.length) await roomOp({ op: "invite", id: g.id, members: add });
                for (const m of g.members.filter((x) => !members.includes(x))) await roomOp({ op: "remove", id: g.id, member: m });
                if ((g.name ?? "") !== gname) await roomOp({ op: "rename", id: g.id, name: gname });
                setDialog(null);
              } catch { toast(t("crewroom.failed"), "error"); }
            }}
            onDelete={async () => {
              if (!(await confirm({ message: t("crewroom.deleteConfirm"), danger: true, confirmText: t("crewroom.delete") }))) return;
              try { await roomOp({ op: "delete", id: current.id }); setDialog(null); setOpen(null); } catch { toast(t("crewroom.failed"), "error"); }
            }} />
        )}
      </>
    );
  }

  const shown = filter === "unread" ? rows.filter((r) => unread(r) > 0) : rows;
  const preview = (r: Row) => {
    const l = r.last;
    if (!l) return t("crewroom.noMsg");
    const text = (l.i18n ? t(l.i18n.key, l.i18n.vars) + (l.i18n.suffix ?? "") : relocalize(l.text, CREW_TEXT_KEYS, t)).replace(/\s+/g, " ");
    const by = l.from === "human" ? t("crewchat.you.name") : l.from === "board" ? "" : name(l.from);
    return r.kind === "dm" || !by ? text : `${by}: ${text}`;
  };
  const working = (r: Row) => [...runs.values()].some((x) => isActiveRun(x) && r.members.includes(x.role ?? ""));

  return (
    <div className="relative flex h-full min-h-0 flex-col bg-white dark:bg-[var(--s-pane)]">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-zinc-200 px-3 dark:border-zinc-800">
        <span className="truncate text-[13.5px] font-semibold text-zinc-900 dark:text-zinc-50">{t("crewchat.title")}</span>
        <span className="ml-auto truncate text-[11px] text-zinc-400 dark:text-zinc-500">{root.replace(/\/+$/, "").split("/").pop()}</span>
        <button type="button" onClick={() => setDialog("new")} title={t("crewroom.newGroup")} aria-label={t("crewroom.newGroup")}
          className="shrink-0 rounded-md p-1 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-white/10 dark:hover:text-zinc-200">
          <IconUsersPlus size={15} aria-hidden />
        </button>
      </div>
      <div className="flex shrink-0 gap-1.5 px-3 py-2">
        {(["all", "unread"] as const).map((f) => (
          <button key={f} type="button" onClick={() => setFilter(f)} aria-pressed={filter === f}
            className={`rounded-full px-2.5 py-0.5 text-[11.5px] font-medium transition ${filter === f ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900" : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-white/[0.06] dark:text-zinc-300 dark:hover:bg-white/10"}`}>
            {t(f === "all" ? "crewroom.all" : "crewroom.unread")}
          </button>
        ))}
      </div>
      <div className="nunopi-scroll min-h-0 flex-1 overflow-y-auto pb-2">
        {shown.map((r) => {
          const n = unread(r);
          return (
            <button key={r.id} type="button" onClick={() => setOpen(r.id)}
              className="flex h-[60px] w-full items-center gap-2.5 px-3 text-left transition hover:bg-zinc-50 dark:hover:bg-white/[0.04]">
              <span className="relative shrink-0">
                {r.kind === "dm" ? <Avatar from={r.members[0]} known={known} size={40} />
                  : r.kind === "team" ? <span className="flex h-10 w-10 items-center justify-center"><GroupAvatar members={r.members} known={known} /></span>
                  : <GroupAvatar members={r.members} known={known} />}
                {working(r) && <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-emerald-500 ring-2 ring-white dark:ring-[var(--s-pane)]" aria-hidden />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline gap-1.5">
                  <span className="truncate text-[13px] font-semibold text-zinc-900 dark:text-zinc-50">{r.name}</span>
                  {r.kind !== "dm" && <span className="shrink-0 text-[11px] tabular-nums text-zinc-400">{r.members.length}</span>}
                  {r.last && <span className="ml-auto shrink-0 text-[10.5px] tabular-nums text-zinc-400">{time(r.last.ts)}</span>}
                </span>
                <span className="mt-0.5 flex items-center gap-1.5">
                  <span className={`truncate text-[11.5px] ${r.last ? "text-zinc-500 dark:text-zinc-400" : "text-zinc-400 dark:text-zinc-500"}`}>
                    {r.last?.from === "board" && <IconLayoutKanban size={10} className="mr-0.5 inline align-[-1px]" aria-hidden />}{preview(r)}
                  </span>
                  {n > 0 && <span className="ml-auto flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded-full bg-mustard-500 px-1 text-[10.5px] font-bold tabular-nums text-zinc-900">{n > 99 ? "99+" : n}</span>}
                </span>
              </span>
            </button>
          );
        })}
      </div>
      {dialog === "new" && (
        <GroupDialog roles={roles} known={known} onClose={() => setDialog(null)}
          onSave={async (members, gname) => {
            try {
              const j = await roomOp({ op: "create", members, name: gname });
              if (j.existing) toast(t("crewroom.exists"), "success");
              setDialog(null);
              if (j.room) setOpen(j.room.id);
            } catch { toast(t("crewroom.failed"), "error"); }
          }} />
      )}
    </div>
  );
}

// 새 그룹 / 방 설정 — 봇 체크(2개 이상) + 이름. 설정이면 지우기도.
function GroupDialog({ roles, known, group, onClose, onSave, onDelete }: { roles: CrewRole[]; known: Set<string>; group?: Group; onClose: () => void; onSave: (members: string[], name: string) => void | Promise<void>; onDelete?: () => void }) {
  const t = useT();
  const [picked, setPicked] = useState<string[]>(group?.members ?? []);
  const [gname, setGname] = useState(group?.name ?? "");
  const [busy, setBusy] = useState(false);
  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 dark:bg-black/50" onClick={onClose} aria-hidden />
      <div role="dialog" aria-modal="true" aria-label={t(group ? "crewroom.settings" : "crewroom.newGroup")}
        className="relative flex max-h-[min(560px,85vh)] w-full max-w-sm flex-col overflow-hidden rounded-2xl border border-zinc-200/80 bg-white shadow-2xl ring-1 ring-black/5 dark:border-white/10 dark:bg-[#14151c] dark:ring-white/5">
        <div className="flex items-center px-4 pb-1 pt-4">
          <span className="mr-auto text-[14px] font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">{t(group ? "crewroom.settings" : "crewroom.newGroup")}</span>
          <button type="button" onClick={onClose} aria-label={t("crew.cancel")} className="rounded-md p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-white/10 dark:hover:text-zinc-200"><IconX size={15} aria-hidden /></button>
        </div>
        <div className="px-4 pb-2">
          <input value={gname} onChange={(e) => setGname(e.target.value)} maxLength={40} placeholder={t("crewroom.groupName")}
            className="w-full rounded-lg bg-zinc-100 px-3 py-2 text-[13px] text-zinc-800 outline-none placeholder:text-zinc-400 focus:ring-1 focus:ring-zinc-300 dark:bg-white/[0.06] dark:text-zinc-100 dark:focus:ring-white/15" />
          <div className="mt-2 text-[11.5px] text-zinc-500 dark:text-zinc-400">{t(group ? "crewroom.members" : "crewroom.newGroupHint")}</div>
        </div>
        <div className="nunopi-scroll min-h-0 flex-1 overflow-y-auto px-2 pb-2">
          {roles.map((r) => (
            <label key={r.id} className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 transition hover:bg-zinc-50 dark:hover:bg-white/[0.04]">
              <input type="checkbox" checked={picked.includes(r.id)} onChange={() => toggle(r.id)} className="h-4 w-4 shrink-0 accent-mustard-500" />
              <Avatar from={r.id} known={known} size={28} />
              <span className="truncate text-[12.5px] text-zinc-800 dark:text-zinc-100">{roleName(t, roles, r.id)}</span>
            </label>
          ))}
        </div>
        <div className="flex items-center gap-2 border-t border-zinc-100 px-4 py-3 dark:border-white/5">
          {onDelete && (
            <button type="button" onClick={onDelete} className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-[12px] font-medium text-rose-600 transition hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-500/10">
              <IconTrash size={13} aria-hidden />{t("crewroom.delete")}
            </button>
          )}
          <button type="button" disabled={picked.length < 2 || busy} onClick={async () => { setBusy(true); try { await onSave(picked, gname.trim()); } finally { setBusy(false); } }}
            className="ml-auto rounded-lg bg-mustard-500 px-3.5 py-1.5 text-[12.5px] font-semibold text-zinc-900 transition hover:bg-mustard-400 disabled:bg-zinc-200 disabled:text-zinc-400 dark:disabled:bg-white/10 dark:disabled:text-zinc-500">
            {t(group ? "crewroom.save" : "crewroom.create")}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
