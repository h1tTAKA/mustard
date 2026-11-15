"use client";
// 채팅 모드(#1341) — 터미널 칸의 채팅 탭 바 + 활성 채팅(ChatSession). 탭 하나 = 서버 채팅 세션 하나(lib/chat/chatSessions, SNA).
// 탭 바는 터미널 탭 바와 같은 className, 오른쪽 끝 모드 전환 버튼은 부모(TerminalPane)가 넘겨줌. ＋ = 새 채팅, 시계 = 기록 패널.
// 기록 패널은 왼쪽·오른쪽 칸을 쓰지 않고 이 채팅 칸 안에 덮어 엶: 이 레포의 지난 채팅(다시 열기·지우기) + 터미널에서 했던 Claude 대화(가져오기).
// 탭 닫기 = 보관(기록에 남음). 탭 오른쪽 클릭 = 터미널에서 이어 하기·이어 하기 명령 복사·닫기.
// 터미널처럼 채팅이 하나도 없으면 하나를 바로 엶. 활성 탭은 레포별 localStorage.
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { IconPlus, IconX, IconLoader2, IconHistory, IconSearch, IconTrash, IconTerminal2, IconDownload } from "@tabler/icons-react";
import { useT, useConfirm, agentEnabled, getSetting, CHATKEYS, CHAT_DEFAULTS } from "@mustard/core";
import { AgentLogo } from "@/components/workspace/AgentLogo";
import ChatSession from "@/components/workspace/ChatSession";
import { P, PROVIDERS, post, type AppCommand, type Meta, type Provider } from "@/components/workspace/ChatComposer";

const MENU_W = 200;
export const CHAT_HANDOFF_EVENT = "mustard:chat-handoff";
const RESUME: Partial<Record<Provider, (cc: string) => string>> = { "claude-code": (cc) => `--resume ${cc}`, codex: (cc) => `resume ${cc}` };
const CLI: Record<Provider, string> = { "claude-code": "claude", codex: "codex", opencode: "opencode", grok: "grok", cursor: "cursor-agent" };
function ago(ms: number, t: ReturnType<typeof useT>): string {
  const m = Math.round((Date.now() - ms) / 60_000);
  if (m < 1) return t("achat.ago.now");
  if (m < 60) return t("achat.ago.min", { n: m });
  const h = Math.round(m / 60);
  if (h < 24) return t("achat.ago.hour", { n: h });
  return new Date(ms).toLocaleDateString();
}

export default function ChatPane({ cwd, modeToggle }: { cwd: string; modeToggle: ReactNode }) {
  const t = useT();
  const confirm = useConfirm();
  const activeKey = `nunopi:ws-chat-active:${cwd}`;
  const [chats, setChats] = useState<Meta[] | null>(null);
  const [activeId, setActiveId] = useState<string>(() => { try { return localStorage.getItem(activeKey) ?? ""; } catch { return ""; } });
  const [menu, setMenu] = useState<{ x: number; y: number; id?: string } | null>(null);
  const [installed, setInstalled] = useState<Set<string> | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const plusRef = useRef<HTMLButtonElement>(null);
  const providers = PROVIDERS.filter((p) => !installed || installed.has(p.agent));
  const firstProvider = providers[0]?.id ?? "claude-code";

  const create = useCallback(async (provider: Provider, from?: Meta) => {
    setMenu(null); setHistoryOpen(false);
    // 새 채팅은 지금 탭의 모델·생각 강도·권한 모드를 이어받음(같은 실행 AI일 때)
    const r = await post("/api/chat/sessions", { root: cwd, op: "create", provider, mode: getSetting(CHATKEYS.newChatMode, CHAT_DEFAULTS.newChatMode), ...(from && from.provider === provider ? { model: from.model, effort: from.effort, mode: from.mode } : {}) });
    if (r?.ok) { setChats((p) => [...(p ?? []), r.chat as Meta]); setActiveId(r.chat.id); }
  }, [cwd]);
  useEffect(() => {
    let alive = true;
    void fetch(`/api/chat/sessions?root=${encodeURIComponent(cwd)}`).then((x) => x.json()).then((r) => { if (alive && r?.ok) setChats(r.chats as Meta[]); }).catch(() => {});
    return () => { alive = false; };
  }, [cwd]);
  useEffect(() => { void window.nunopiDesktop?.detectAgents?.(false).then((r) => { if (r.ok) setInstalled(new Set(r.list.filter((a) => a.status === "ok" && agentEnabled(a.id)).map((a) => a.id))); }).catch(() => {}); }, []);
  const autoMade = useRef(false); // 하나도 없으면 바로 하나(한 번만 — 개발 모드 이펙트 두 번·느린 응답에 둘 생기지 않게)
  useEffect(() => { if (chats && !chats.length && !autoMade.current) { autoMade.current = true; void create(firstProvider).finally(() => { autoMade.current = false; }); } }, [chats, create, firstProvider]);
  const list = chats ?? [];
  const active = list.find((c) => c.id === activeId) ?? list[list.length - 1];
  useEffect(() => { try { if (active) localStorage.setItem(activeKey, active.id); } catch { /* 저장 못 해도 동작 */ } }, [active, activeKey]);

  const close = async (id: string) => {
    setMenu(null);
    await post("/api/chat/sessions", { root: cwd, op: "close", id }); // 보관 — 기록 패널에 남음
    setChats((p) => (p ?? []).filter((x) => x.id !== id));
  };
  const patch = (id: string, m: Partial<Meta>) => setChats((p) => (p ?? []).map((x) => (x.id === id ? { ...x, ...m, count: Math.max(x.count, m.count ?? 0) } : x)));
  const open = (c: Meta) => {
    setHistoryOpen(false);
    if (!list.some((x) => x.id === c.id)) { void post("/api/chat/sessions", { root: cwd, op: "reopen", id: c.id }); setChats((p) => [...(p ?? []), { ...c, archived: false }]); }
    setActiveId(c.id);
  };
  // 터미널에서 이어 하기 — 채팅 에이전트를 끄고(두 프로세스가 한 대화를 쓰지 않게) 터미널 모드 새 탭에서 resume
  const handoff = async (id: string) => {
    setMenu(null);
    const r = await post("/api/chat/sessions", { root: cwd, op: "handoff", id });
    if (!r?.ok) return;
    const p = r.provider as Provider;
    window.dispatchEvent(new CustomEvent(CHAT_HANDOFF_EVENT, { detail: { root: cwd, agent: P(p).agent, args: r.cc && RESUME[p] ? RESUME[p]!(r.cc) : "" } }));
  };
  const copyResume = (c: Meta) => { setMenu(null); if (c.cc && RESUME[c.provider]) void navigator.clipboard?.writeText(`${CLI[c.provider]} ${RESUME[c.provider]!(c.cc)}`); };
  const appCommand = (c: AppCommand) => {
    if (c === "new") void create(active?.provider ?? firstProvider, active);
    else if (c === "history") setHistoryOpen(true);
    else if (c === "terminal" && active) void handoff(active.id);
  };
  const menuChat = menu?.id ? list.find((x) => x.id === menu.id) : undefined;
  const item = "flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] text-zinc-700 transition hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800";

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-stretch border-b border-zinc-200 bg-zinc-100/70 pr-[17px] dark:border-zinc-800 dark:bg-[var(--s-bar)]">
        <div className="nunopi-scroll flex min-w-0 flex-1 items-stretch overflow-x-auto">
          {list.map((c) => {
            const on = c.id === active?.id && !historyOpen;
            return (
              <div key={c.id} onClick={() => { setActiveId(c.id); setHistoryOpen(false); }} onContextMenu={(e) => { e.preventDefault(); setMenu({ x: Math.min(e.clientX, window.innerWidth - MENU_W - 4), y: e.clientY, id: c.id }); }}
                className={`group relative flex shrink-0 cursor-pointer items-center gap-1.5 border-r border-zinc-200 px-3 py-1.5 text-[12px] transition dark:border-zinc-800 ${on ? "bg-white text-zinc-800 dark:bg-[var(--s-pane)] dark:text-zinc-100" : "text-zinc-500 hover:bg-white/50 dark:text-zinc-400 dark:hover:bg-zinc-800/50"}`}>
                {on && <span className="absolute inset-x-0 top-0 h-0.5 bg-mustard-500" aria-hidden />}
                {c.busy ? <IconLoader2 size={13} stroke={2} className="shrink-0 animate-spin text-mustard-600 dark:text-mustard-400" aria-hidden /> : <span className="shrink-0"><AgentLogo agent={P(c.provider).agent} size={13} /></span>}
                <span className="max-w-[200px] truncate whitespace-nowrap" title={c.title || t("achat.new")}>{c.title || t("achat.new")}</span>
                {list.length > 1 && (
                  <button type="button" onClick={(e) => { e.stopPropagation(); void close(c.id); }}
                    className={`ml-1 shrink-0 rounded p-0.5 text-zinc-400 transition hover:bg-zinc-200 hover:text-zinc-700 dark:hover:bg-zinc-700 dark:hover:text-zinc-200 ${on ? "" : "opacity-0 group-hover:opacity-100"}`} aria-label={t("achat.close")}>
                    <IconX size={12} stroke={2.5} aria-hidden />
                  </button>
                )}
              </div>
            );
          })}
          <button ref={plusRef} type="button" onClick={() => { const r = plusRef.current?.getBoundingClientRect(); if (r) setMenu(menu ? null : { x: Math.max(4, Math.min(r.left, window.innerWidth - MENU_W - 4)), y: r.bottom + 4 }); }} aria-label={t("achat.new")}
            className="flex shrink-0 items-center px-2.5 text-zinc-400 transition hover:bg-white hover:text-mustard-600 dark:hover:bg-zinc-800 dark:hover:text-mustard-400">
            <IconPlus size={15} stroke={2.5} aria-hidden />
          </button>
        </div>
        <button type="button" onClick={() => setHistoryOpen((v) => !v)} aria-label={t("achat.history")} title={t("achat.history")}
          className={`flex shrink-0 items-center px-2.5 transition hover:bg-white hover:text-mustard-600 dark:hover:bg-zinc-800 dark:hover:text-mustard-400 ${historyOpen ? "text-mustard-600 dark:text-mustard-400" : "text-zinc-400"}`}>
          <IconHistory size={15} stroke={2} aria-hidden />
        </button>
        {modeToggle}
      </div>
      {menu && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setMenu(null)} onContextMenu={(e) => { e.preventDefault(); setMenu(null); }} aria-hidden />
          <div style={{ position: "fixed", left: menu.x, top: menu.y }}
            className="z-50 min-w-[200px] rounded-md border border-zinc-200 bg-white py-1 shadow-lg dark:border-zinc-700 dark:bg-[var(--s-pane)]">
            {menuChat ? (
              <>
                <button type="button" onClick={() => void handoff(menuChat.id)} className={item}><IconTerminal2 size={14} stroke={2} aria-hidden /><span className="whitespace-nowrap">{t("achat.toTerminalTab")}</span></button>
                {menuChat.cc && RESUME[menuChat.provider] && (
                  <button type="button" onClick={() => copyResume(menuChat)} className={item}><span className="w-3.5" aria-hidden /><span className="whitespace-nowrap">{t("achat.copyResume")}</span></button>
                )}
                <div className="my-1 border-t border-zinc-200 dark:border-zinc-800" />
                <button type="button" onClick={() => void close(menuChat.id)} className={item}><IconX size={14} stroke={2} aria-hidden /><span className="whitespace-nowrap">{t("achat.close")}</span></button>
              </>
            ) : providers.map((p) => (
              <button key={p.id} type="button" onClick={() => void create(p.id, active)} className={item}>
                <AgentLogo agent={p.agent} size={14} /><span className="whitespace-nowrap">{p.label}</span>
              </button>
            ))}
          </div>
        </>
      )}
      <div className="relative min-h-0 flex-1 bg-white dark:bg-[var(--s-pane)]">
        {active && <ChatSession key={active.id} root={cwd} meta={active} providers={providers} onMeta={(m) => patch(active.id, m)} onAppCommand={appCommand} />}
        {historyOpen && <HistoryPanel root={cwd} openIds={new Set(list.map((c) => c.id))} onOpen={open} onClose={() => setHistoryOpen(false)}
          onImported={(c) => { setChats((p) => [...(p ?? []), c]); setActiveId(c.id); setHistoryOpen(false); }}
          onDeleted={(id) => setChats((p) => (p ?? []).filter((x) => x.id !== id))} confirmDelete={() => confirm({ message: t("achat.confirmDelete") })} />}
      </div>
    </div>
  );
}

// 기록 패널 — 채팅 칸 안에 덮어 엶. 위: 이 레포의 지난 채팅(검색), 아래: 터미널에서 했던 Claude 대화(가져와서 채팅으로 이어 하기)
function HistoryPanel({ root, openIds, onOpen, onClose, onImported, onDeleted, confirmDelete }: {
  root: string; openIds: Set<string>; onOpen: (c: Meta) => void; onClose: () => void; onImported: (c: Meta) => void; onDeleted: (id: string) => void; confirmDelete: () => Promise<boolean>;
}) {
  const t = useT();
  const [q, setQ] = useState("");
  const [chats, setChats] = useState<Meta[] | null>(null);
  const [cli, setCli] = useState<{ id: string; title: string; mtime: number }[] | null>(null);
  useEffect(() => {
    void fetch(`/api/chat/sessions?root=${encodeURIComponent(root)}&history=1`).then((r) => r.json()).then((j) => setChats(j.chats ?? [])).catch(() => setChats([]));
    void fetch(`/api/chat/sessions?root=${encodeURIComponent(root)}&cli=1`).then((r) => r.json()).then((j) => setCli(j.sessions ?? [])).catch(() => setCli([]));
  }, [root]);
  const s = q.trim().toLowerCase();
  const shown = (chats ?? []).filter((c) => !s || c.title.toLowerCase().includes(s));
  const shownCli = (cli ?? []).filter((c) => !s || c.title.toLowerCase().includes(s));
  const del = async (c: Meta) => {
    if (!(await confirmDelete())) return;
    await post("/api/chat/sessions", { root, op: "delete", id: c.id });
    setChats((p) => (p ?? []).filter((x) => x.id !== c.id)); onDeleted(c.id);
  };
  const imp = async (cc: string) => {
    const r = await post("/api/chat/sessions", { root, op: "import", cc });
    if (r?.ok && r.chat) onImported(r.chat as Meta);
  };
  const row = "group/h flex w-full cursor-pointer items-center gap-2.5 rounded-xl px-3 py-2 text-left transition hover:bg-black/[.04] dark:hover:bg-white/[.06]";
  return (
    <div className="absolute inset-0 z-20 flex flex-col bg-white dark:bg-[var(--s-pane)]" onKeyDown={(e) => { if (e.key === "Escape") onClose(); }}>
      <div className="mx-auto flex w-full max-w-3xl items-center gap-2 px-5 pb-2 pt-4">
        <div className="flex flex-1 items-center gap-2 rounded-full bg-black/[.04] px-3.5 py-1.5 dark:bg-white/[.06]">
          <IconSearch size={14} stroke={2} className="shrink-0 text-zinc-400" aria-hidden />
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("achat.historySearch")}
            className="min-w-0 flex-1 bg-transparent text-[13.5px] text-zinc-800 outline-none placeholder:text-zinc-400 dark:text-zinc-100" />
        </div>
        <button type="button" onClick={onClose} aria-label={t("achat.close")} className="flex size-8 items-center justify-center rounded-full text-zinc-400 transition hover:bg-black/[.05] hover:text-zinc-700 dark:hover:bg-white/[.08] dark:hover:text-zinc-200"><IconX size={16} stroke={2} /></button>
      </div>
      <div className="nunopi-scroll min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl px-5 pb-6">
          <p className="px-3 pb-1 pt-3 text-[11.5px] font-medium text-zinc-400 dark:text-zinc-500">{t("achat.historyChats")}</p>
          {chats === null ? <p className="px-3 py-2 text-[12.5px] text-zinc-400">…</p> : !shown.length ? <p className="px-3 py-2 text-[12.5px] text-zinc-400 dark:text-zinc-500">{t("achat.historyEmpty")}</p> : shown.map((c) => (
            <div key={c.id} role="button" tabIndex={0} onClick={() => onOpen(c)} onKeyDown={(e) => { if (e.key === "Enter") onOpen(c); }} className={row}>
              <AgentLogo agent={P(c.provider).agent} size={14} />
              <span className="min-w-0 flex-1 truncate text-[13.5px] text-zinc-800 dark:text-zinc-100">{c.title || t("achat.new")}</span>
              {openIds.has(c.id) && <span className="shrink-0 rounded-full bg-black/[.05] px-1.5 text-[11px] text-zinc-500 dark:bg-white/[.08] dark:text-zinc-400">{t("achat.historyOpen")}</span>}
              <span className="shrink-0 text-[12px] tabular-nums text-zinc-400 dark:text-zinc-500">{t("achat.historyCount", { n: c.count })} · {ago(c.updatedAt, t)}</span>
              <button type="button" onClick={(e) => { e.stopPropagation(); void del(c); }} aria-label={t("achat.delete")} title={t("achat.delete")}
                className="flex size-7 shrink-0 items-center justify-center rounded-lg text-zinc-400 opacity-0 transition hover:bg-black/[.05] hover:text-red-600 group-hover/h:opacity-100 dark:hover:bg-white/[.08]"><IconTrash size={14} stroke={1.8} /></button>
            </div>
          ))}
          <p className="px-3 pb-1 pt-5 text-[11.5px] font-medium text-zinc-400 dark:text-zinc-500">{t("achat.historyCli")}</p>
          {cli === null ? <p className="px-3 py-2 text-[12.5px] text-zinc-400">…</p> : !shownCli.length ? <p className="px-3 py-2 text-[12.5px] text-zinc-400 dark:text-zinc-500">{t("achat.historyCliEmpty")}</p> : shownCli.map((c) => (
            <div key={c.id} role="button" tabIndex={0} onClick={() => void imp(c.id)} onKeyDown={(e) => { if (e.key === "Enter") void imp(c.id); }} className={row}>
              <AgentLogo agent="claude" size={14} />
              <span className="min-w-0 flex-1 truncate text-[13.5px] text-zinc-700 dark:text-zinc-200">{c.title}</span>
              <span className="shrink-0 text-[12px] tabular-nums text-zinc-400 dark:text-zinc-500">{ago(c.mtime, t)}</span>
              <span className="flex shrink-0 items-center gap-1 text-[12px] text-zinc-400 opacity-0 transition group-hover/h:opacity-100"><IconDownload size={13} stroke={1.8} aria-hidden />{t("achat.import")}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
