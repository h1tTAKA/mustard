"use client";
/* eslint-disable @next/next/no-img-element -- 로컬 API 이미지·붙여넣기 data URL(최적화 불필요, 데스크톱 오프라인) */
// 채팅 모드(#1341) — 터미널 칸의 채팅 탭 바 + 활성 채팅. 탭 하나 = 서버 채팅 세션 하나(lib/chat/chatSessions, SNA).
// 탭 바 모양·＋ 메뉴는 터미널 탭 바 그대로(같은 className), 오른쪽 끝 모드 전환 버튼은 부모(TerminalPane)가 넘겨줌.
// 활성 탭은 레포별 localStorage. 타임라인은 /api/chat/stream(SSE)로 받아 그림.
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { IconPlus, IconX, IconMessageCircle, IconArrowUp, IconPlayerStopFilled, IconLoader2, IconChevronRight, IconTool, IconShieldQuestion, IconCheck, IconAlertTriangle } from "@tabler/icons-react";
import { useT, Markdown, useConfirm, agentEnabled } from "@mustard/core";
import { AgentLogo, type AgentId } from "@/components/workspace/AgentLogo";
import type { ChatItem } from "@/lib/chat/chatTimeline";

type Provider = "claude-code" | "codex";
interface Meta { id: string; title: string; provider: Provider; createdAt: number; busy: boolean }
const LOGO: Record<Provider, AgentId> = { "claude-code": "claude", codex: "codex" };
const PROVIDERS: { id: Provider; agent: AgentId; label: string }[] = [{ id: "claude-code", agent: "claude", label: "Claude Code" }, { id: "codex", agent: "codex", label: "Codex" }];
const MENU_W = 180;

const post = (url: string, body: unknown) => fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json()).catch(() => ({ ok: false }));

export default function ChatPane({ cwd, modeToggle }: { cwd: string; modeToggle: ReactNode }) {
  const t = useT();
  const confirm = useConfirm();
  const activeKey = `nunopi:ws-chat-active:${cwd}`;
  const [chats, setChats] = useState<Meta[]>([]);
  const [activeId, setActiveId] = useState<string>(() => { try { return localStorage.getItem(activeKey) ?? ""; } catch { return ""; } });
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPos, setMenuPos] = useState({ x: 0, y: 0 });
  const [installed, setInstalled] = useState<Set<string> | null>(null);
  const plusRef = useRef<HTMLButtonElement>(null);

  const reload = useCallback(async () => {
    const r = await fetch(`/api/chat/sessions?root=${encodeURIComponent(cwd)}`).then((x) => x.json()).catch(() => null);
    if (r?.ok) setChats(r.chats as Meta[]);
  }, [cwd]);
  useEffect(() => { void reload(); }, [reload]); // eslint-disable-line react-hooks/set-state-in-effect -- 레포 바뀌면 그 레포 채팅 목록
  useEffect(() => { void window.nunopiDesktop?.detectAgents?.(false).then((r) => { if (r.ok) setInstalled(new Set(r.list.filter((a) => a.status === "ok" && agentEnabled(a.id)).map((a) => a.id))); }).catch(() => {}); }, []);
  const active = chats.find((c) => c.id === activeId) ?? chats[chats.length - 1];
  useEffect(() => { try { if (active) localStorage.setItem(activeKey, active.id); } catch { /* 저장 못 해도 동작 */ } }, [active, activeKey]);

  const toggleMenu = () => {
    if (menuOpen) { setMenuOpen(false); return; }
    const r = plusRef.current?.getBoundingClientRect();
    if (r) setMenuPos({ x: Math.max(4, Math.min(r.left, window.innerWidth - MENU_W - 4)), y: r.bottom + 4 });
    setMenuOpen(true);
  };
  const create = async (provider: Provider) => {
    setMenuOpen(false);
    const r = await post("/api/chat/sessions", { root: cwd, op: "create", provider });
    if (r?.ok) { setChats((p) => [...p, r.chat as Meta]); setActiveId(r.chat.id); }
  };
  const close = async (id: string) => {
    const c = chats.find((x) => x.id === id);
    if (c && c.title && !(await confirm({ message: t("achat.confirmClose") }))) return;
    await post("/api/chat/sessions", { root: cwd, op: "close", id });
    setChats((p) => p.filter((x) => x.id !== id));
  };
  const providers = PROVIDERS.filter((p) => !installed || installed.has(p.agent));

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-stretch border-b border-zinc-200 bg-zinc-100/70 pr-[17px] dark:border-zinc-800 dark:bg-[var(--s-bar)]">
        <div className="nunopi-scroll flex min-w-0 flex-1 items-stretch overflow-x-auto">
          {chats.map((c) => {
            const on = c.id === active?.id;
            return (
              <div key={c.id} onClick={() => setActiveId(c.id)}
                className={`group relative flex shrink-0 cursor-pointer items-center gap-1.5 border-r border-zinc-200 px-3 py-1.5 text-[12px] transition dark:border-zinc-800 ${on ? "bg-white text-zinc-800 dark:bg-[var(--s-pane)] dark:text-zinc-100" : "text-zinc-500 hover:bg-white/50 dark:text-zinc-400 dark:hover:bg-zinc-800/50"}`}>
                {on && <span className="absolute inset-x-0 top-0 h-0.5 bg-mustard-500" aria-hidden />}
                {c.busy && <IconLoader2 size={11} stroke={2} className="shrink-0 animate-spin text-mustard-600 dark:text-mustard-400" aria-hidden />}
                <span className="shrink-0"><AgentLogo agent={LOGO[c.provider]} size={13} /></span>
                <span className="max-w-[200px] truncate whitespace-nowrap" title={c.title || t("achat.new")}>{c.title || t("achat.new")}</span>
                <button type="button" onClick={(e) => { e.stopPropagation(); void close(c.id); }}
                  className={`ml-1 shrink-0 rounded p-0.5 text-zinc-400 transition hover:bg-zinc-200 hover:text-zinc-700 dark:hover:bg-zinc-700 dark:hover:text-zinc-200 ${on ? "" : "opacity-0 group-hover:opacity-100"}`} aria-label={t("achat.close")}>
                  <IconX size={12} stroke={2.5} aria-hidden />
                </button>
              </div>
            );
          })}
          <button ref={plusRef} type="button" onClick={toggleMenu} aria-label={t("achat.new")}
            className="flex shrink-0 items-center px-2.5 text-zinc-400 transition hover:bg-white hover:text-mustard-600 dark:hover:bg-zinc-800 dark:hover:text-mustard-400">
            <IconPlus size={15} stroke={2.5} aria-hidden />
          </button>
        </div>
        {modeToggle}
      </div>
      {menuOpen && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} aria-hidden />
          <div style={{ position: "fixed", left: menuPos.x, top: menuPos.y }}
            className="z-50 min-w-[180px] rounded-md border border-zinc-200 bg-white py-1 shadow-lg dark:border-zinc-700 dark:bg-[var(--s-pane)]">
            {providers.map((p) => (
              <button key={p.id} type="button" onClick={() => void create(p.id)}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] text-zinc-700 transition hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800">
                <AgentLogo agent={p.agent} size={14} /><span className="whitespace-nowrap">{p.label}</span>
              </button>
            ))}
          </div>
        </>
      )}
      <div className="min-h-0 flex-1">
        {active
          ? <ChatSession key={active.id} root={cwd} id={active.id} onMeta={(m) => setChats((p) => p.map((x) => (x.id === active.id ? { ...x, ...m } : x)))} />
          : <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center text-[12px] text-zinc-400 dark:text-zinc-500">
              <IconMessageCircle size={22} stroke={1.5} aria-hidden />{t("achat.empty")}
            </div>}
      </div>
    </div>
  );
}

// 도구 입력 한 줄 요약 — 명령·파일·검색어·주소 순
function toolSummary(input?: string): string {
  if (!input) return "";
  try {
    const o = JSON.parse(input) as Record<string, unknown>;
    const v = o.command ?? o.file_path ?? o.path ?? o.pattern ?? o.url ?? o.query ?? o.description;
    return typeof v === "string" ? v.replace(/\s+/g, " ") : "";
  } catch { return input.slice(0, 120); }
}
const imgUrl = (name: string) => `/api/chat/image?name=${encodeURIComponent(name)}`;

function ChatSession({ root, id, onMeta }: { root: string; id: string; onMeta: (m: Partial<Meta>) => void }) {
  const t = useT();
  const [items, setItems] = useState<ChatItem[]>([]);
  const [streaming, setStreaming] = useState("");
  const [busy, setBusy] = useState(false);
  const [input, setInput] = useState("");
  const [images, setImages] = useState<{ base64: string; mime: string; url: string }[]>([]);
  const [note, setNote] = useState("");
  const [open, setOpen] = useState<Set<number>>(new Set());
  const scrollRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const onMetaRef = useRef(onMeta);
  useEffect(() => { onMetaRef.current = onMeta; });

  useEffect(() => {
    const es = new EventSource(`/api/chat/stream?root=${encodeURIComponent(root)}&id=${encodeURIComponent(id)}`);
    es.onmessage = (e) => {
      let p: { type: string; items?: ChatItem[]; i?: number; item?: ChatItem; streaming?: string; busy?: boolean; title?: string };
      try { p = JSON.parse(e.data); } catch { return; }
      if (p.type === "snapshot") { setItems(p.items ?? []); setStreaming(p.streaming ?? ""); setBusy(!!p.busy); }
      else if (p.type === "item" && typeof p.i === "number" && p.item) {
        const { i, item } = p;
        setItems((prev) => { const next = prev.slice(); next[i] = item; return next; });
        if (item.k === "user" && i === 0) onMetaRef.current({ title: item.text.replace(/\s+/g, " ").trim().slice(0, 40) });
      }
      else if (p.type === "delta") setStreaming(p.streaming ?? "");
      else if (p.type === "busy") { setBusy(!!p.busy); onMetaRef.current({ busy: !!p.busy }); }
      else if (p.type === "gone") es.close();
    };
    return () => es.close();
  }, [root, id]);
  // 아래에 붙어 있을 때만 따라 내려감(위로 올려 읽는 중이면 그대로)
  useEffect(() => { const el = scrollRef.current; if (el && stick.current) el.scrollTop = el.scrollHeight; }, [items, streaming, busy]);

  const send = async () => {
    const text = input.trim();
    if (!text && !images.length) return;
    setInput(""); const imgs = images; setImages([]); stick.current = true;
    const r = await post("/api/chat/send", { root, id, text, images: imgs.map(({ base64, mime }) => ({ base64, mime })) });
    if (!r?.ok && r?.error) setNote(String(r.error));
  };
  const stop = () => void post("/api/chat/stop", { root, id });
  const answer = (permId: string, allow: boolean) => void post("/api/chat/answer", { root, id, permId, allow });
  const onPaste = (e: React.ClipboardEvent) => {
    const files = [...e.clipboardData.files].filter((f) => f.type.startsWith("image/"));
    if (!files.length) return;
    e.preventDefault();
    for (const f of files) {
      if (f.size > 5 * 1024 * 1024) { setNote(t("achat.imageTooBig")); continue; }
      const rd = new FileReader();
      rd.onload = () => { const url = String(rd.result); setImages((p) => [...p, { url, mime: f.type, base64: url.slice(url.indexOf(",") + 1) }]); };
      rd.readAsDataURL(f);
    }
  };
  const toggle = (i: number) => setOpen((s) => { const n = new Set(s); if (n.has(i)) n.delete(i); else n.add(i); return n; });

  const render = (it: ChatItem, i: number) => {
    switch (it.k) {
      case "user": return (
        <div key={i} className="flex flex-col items-end gap-1">
          {it.images?.length ? <div className="flex flex-wrap justify-end gap-1">{it.images.map((n) => <img key={n} src={imgUrl(n)} alt="" className="max-h-40 rounded-lg border border-zinc-200 dark:border-zinc-700" />)}</div> : null}
          {it.text && <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl bg-zinc-100 px-3 py-1.5 text-[13px] leading-relaxed text-zinc-800 dark:bg-zinc-700 dark:text-zinc-100">{it.text}</div>}
        </div>);
      case "text": return <div key={i} className="max-w-full text-[13px] leading-relaxed text-zinc-700 dark:text-zinc-200"><Markdown>{it.text}</Markdown></div>;
      case "tool": {
        const on = open.has(i), sum = toolSummary(it.input), pending = it.result === undefined && busy;
        return (
          <div key={i} className="flex flex-col gap-1">
            <button type="button" onClick={() => toggle(i)} aria-expanded={on}
              className="flex min-w-0 items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-[12px] text-zinc-500 transition hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800/60">
              <IconChevronRight size={12} stroke={2} className={`shrink-0 transition-transform ${on ? "rotate-90" : ""}`} aria-hidden />
              {pending ? <IconLoader2 size={12} stroke={2} className="shrink-0 animate-spin" aria-hidden /> : it.error ? <IconAlertTriangle size={12} stroke={2} className="shrink-0 text-red-500" aria-hidden /> : <IconTool size={12} stroke={2} className="shrink-0" aria-hidden />}
              <span className="shrink-0 font-medium text-zinc-600 dark:text-zinc-300">{it.name}</span>
              {sum && <span className="min-w-0 truncate font-mono text-[11px]">{sum}</span>}
            </button>
            {on && (
              <div className="ml-5 flex flex-col gap-1 rounded-md border border-zinc-200 bg-zinc-50 p-2 font-mono text-[11px] text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300">
                {it.input && <pre className="nunopi-scroll max-h-40 overflow-auto whitespace-pre-wrap break-all">{it.input}</pre>}
                {it.result !== undefined && <pre className={`nunopi-scroll max-h-60 overflow-auto whitespace-pre-wrap break-all border-t border-zinc-200 pt-1 dark:border-zinc-800 ${it.error ? "text-red-600 dark:text-red-400" : ""}`}>{it.result}</pre>}
              </div>
            )}
            {it.images?.length ? <div className="ml-5 flex flex-wrap gap-1">{it.images.map((n) => <a key={n} href={imgUrl(n)} target="_blank" rel="noreferrer"><img src={imgUrl(n)} alt="" className="max-h-56 rounded-lg border border-zinc-200 dark:border-zinc-700" /></a>)}</div> : null}
          </div>);
      }
      case "perm": return (
        <div key={i} className="flex flex-col gap-1.5 rounded-lg border border-mustard-300 bg-mustard-50 p-2.5 text-[12px] dark:border-mustard-700/60 dark:bg-mustard-900/20">
          <div className="flex items-center gap-1.5 font-medium text-zinc-700 dark:text-zinc-200"><IconShieldQuestion size={14} stroke={2} className="text-mustard-600 dark:text-mustard-400" aria-hidden />{t("achat.permAsk", { tool: it.tool })}</div>
          <code className="nunopi-scroll max-h-24 overflow-auto whitespace-pre-wrap break-all font-mono text-[11px] text-zinc-600 dark:text-zinc-300">{toolSummary(it.input) || it.input}</code>
          {it.state === "pending"
            ? <div className="flex gap-1.5">
                <button type="button" onClick={() => answer(it.id, true)} className="rounded-md bg-mustard-500 px-3 py-1 text-[12px] font-medium text-white transition hover:bg-mustard-600">{t("achat.allow")}</button>
                <button type="button" onClick={() => answer(it.id, false)} className="rounded-md border border-zinc-300 px-3 py-1 text-[12px] text-zinc-600 transition hover:bg-zinc-100 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-800">{t("achat.deny")}</button>
              </div>
            : <span className="text-[11px] text-zinc-500 dark:text-zinc-400">{t(it.state === "allowed" ? "achat.allowed" : "achat.denied")}</span>}
        </div>);
      case "done": return (
        <div key={i} className="flex items-center gap-1 text-[11px] text-zinc-400 dark:text-zinc-500">
          <IconCheck size={12} stroke={2} aria-hidden />{t("achat.done")}
          {it.ms != null && <span>· {(it.ms / 1000).toFixed(1)}s</span>}
          {it.outTok != null && <span>· {it.outTok.toLocaleString()} tok</span>}
          {it.cost != null && <span>· ${it.cost.toFixed(3)}</span>}
        </div>);
      case "error": return <div key={i} className="flex items-start gap-1.5 text-[12px] text-red-600 dark:text-red-400"><IconAlertTriangle size={13} stroke={2} className="mt-0.5 shrink-0" aria-hidden /><span className="whitespace-pre-wrap break-all">{it.text}</span></div>;
      case "stopped": return <div key={i} className="text-[11px] text-zinc-400 dark:text-zinc-500">{t("achat.stopped")}</div>;
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-white dark:bg-[var(--s-pane)]">
      <div ref={scrollRef} onScroll={(e) => { const el = e.currentTarget; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40; }}
        className="nunopi-scroll flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto px-4 py-3">
        {!items.length && !busy && <p className="m-auto text-center text-[12px] text-zinc-400 dark:text-zinc-500">{t("achat.emptySession")}</p>}
        {items.map(render)}
        {streaming && <div className="max-w-full text-[13px] leading-relaxed text-zinc-700 dark:text-zinc-200"><Markdown>{streaming}</Markdown></div>}
        {busy && !streaming && <span className="flex items-center gap-1.5 text-[11px] text-zinc-400 dark:text-zinc-500"><IconLoader2 size={13} stroke={2} className="animate-spin" aria-hidden />{t("achat.working")}</span>}
      </div>
      <div className="shrink-0 border-t border-zinc-200 p-2 dark:border-zinc-800">
        {note && <p className="mb-1 text-[11px] text-red-600 dark:text-red-400" onClick={() => setNote("")}>{note}</p>}
        {images.length > 0 && (
          <div className="mb-1.5 flex flex-wrap gap-1.5">
            {images.map((im, k) => (
              <div key={k} className="relative">
                <img src={im.url} alt="" className="h-14 rounded-md border border-zinc-200 dark:border-zinc-700" />
                <button type="button" onClick={() => setImages((p) => p.filter((_, j) => j !== k))} aria-label={t("achat.removeImage")}
                  className="absolute -right-1.5 -top-1.5 rounded-full bg-zinc-700 p-0.5 text-white hover:bg-zinc-900"><IconX size={10} stroke={2.5} aria-hidden /></button>
              </div>
            ))}
          </div>
        )}
        <form onSubmit={(e) => { e.preventDefault(); void send(); }} className="flex items-end gap-1.5">
          <textarea value={input} onChange={(e) => setInput(e.target.value)} onPaste={onPaste} rows={1} placeholder={t("achat.placeholder")}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(); } }}
            className="max-h-40 min-h-[34px] flex-1 resize-none rounded-lg border border-zinc-200 bg-zinc-50 px-2.5 py-1.5 text-[13px] text-zinc-800 outline-none [field-sizing:content] focus:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:focus:border-zinc-500" />
          {busy && (
            <button type="button" onClick={stop} aria-label={t("achat.stop")} title={t("achat.stop")}
              className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-lg border border-zinc-300 text-zinc-600 transition hover:bg-zinc-100 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-800">
              <IconPlayerStopFilled size={13} aria-hidden />
            </button>
          )}
          <button type="submit" disabled={!input.trim() && !images.length} aria-label={t("achat.send")}
            className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-lg bg-mustard-500 text-white transition hover:bg-mustard-600 disabled:opacity-40">
            <IconArrowUp size={15} stroke={2.5} aria-hidden />
          </button>
        </form>
      </div>
    </div>
  );
}
