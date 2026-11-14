"use client";
/* eslint-disable @next/next/no-img-element -- 로컬 API 이미지·붙여넣기 data URL(최적화 불필요, 데스크톱 오프라인) */
// 채팅 모드(#1341) — 터미널 칸의 채팅 탭 바 + 활성 채팅. 탭 하나 = 서버 채팅 세션 하나(lib/chat/chatSessions, SNA).
// 탭 바는 터미널 탭 바와 같은 className, 오른쪽 끝 모드 전환 버튼은 부모(TerminalPane)가 넘겨줌.
// 화면: 가운데 칼럼(최대 768px, 입력 카드는 조금 넓게). 빈 채팅 = 가운데 인사 + 입력 카드, 대화 중 = 아래 입력 카드.
// 도구는 카드 없이 흐린 한 줄(연달으면 한 문장 요약으로 묶음), 진행은 색 배지 대신 글자 위 빛(mustard-shimmer)으로.
// 터미널처럼 채팅이 하나도 없으면 하나를 바로 엶(빈 안내 화면 없음). 활성 탭은 레포별 localStorage.
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { IconPlus, IconX, IconArrowUp, IconPlayerStopFilled, IconLoader2, IconChevronRight, IconChevronDown, IconShieldQuestion, IconAlertTriangle } from "@tabler/icons-react";
import { useT, Markdown, useConfirm, agentEnabled } from "@mustard/core";
import { AgentLogo, type AgentId } from "@/components/workspace/AgentLogo";
import type { ChatItem } from "@/lib/chat/chatTimeline";

type Provider = "claude-code" | "codex";
interface Meta { id: string; title: string; provider: Provider; createdAt: number; busy: boolean }
const PROVIDERS: { id: Provider; agent: AgentId; label: string }[] = [{ id: "claude-code", agent: "claude", label: "Claude Code" }, { id: "codex", agent: "codex", label: "Codex" }];
const P = (id: Provider) => PROVIDERS.find((p) => p.id === id) ?? PROVIDERS[0];
const MENU_W = 180;

const post = (url: string, body: unknown) => fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json()).catch(() => ({ ok: false }));

export default function ChatPane({ cwd, modeToggle }: { cwd: string; modeToggle: ReactNode }) {
  const t = useT();
  const confirm = useConfirm();
  const activeKey = `nunopi:ws-chat-active:${cwd}`;
  const [chats, setChats] = useState<Meta[] | null>(null);
  const [activeId, setActiveId] = useState<string>(() => { try { return localStorage.getItem(activeKey) ?? ""; } catch { return ""; } });
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPos, setMenuPos] = useState({ x: 0, y: 0 });
  const [installed, setInstalled] = useState<Set<string> | null>(null);
  const plusRef = useRef<HTMLButtonElement>(null);
  const providers = PROVIDERS.filter((p) => !installed || installed.has(p.agent));
  const firstProvider = providers[0]?.id ?? "claude-code";

  const create = useCallback(async (provider: Provider) => {
    setMenuOpen(false);
    const r = await post("/api/chat/sessions", { root: cwd, op: "create", provider });
    if (r?.ok) { setChats((p) => [...(p ?? []), r.chat as Meta]); setActiveId(r.chat.id); }
  }, [cwd]);
  useEffect(() => {
    let alive = true;
    void fetch(`/api/chat/sessions?root=${encodeURIComponent(cwd)}`).then((x) => x.json()).then((r) => { if (alive && r?.ok) setChats(r.chats as Meta[]); }).catch(() => {});
    return () => { alive = false; };
  }, [cwd]);
  useEffect(() => { void window.nunopiDesktop?.detectAgents?.(false).then((r) => { if (r.ok) setInstalled(new Set(r.list.filter((a) => a.status === "ok" && agentEnabled(a.id)).map((a) => a.id))); }).catch(() => {}); }, []);
  // 하나도 없으면 바로 하나(터미널 칸이 늘 터미널 하나를 갖는 것과 같게)
  const autoMade = useRef(false); // 한 번만(개발 모드 이펙트 두 번 실행·느린 응답에 둘 생기지 않게)
  useEffect(() => { if (chats && !chats.length && !autoMade.current) { autoMade.current = true; void create(firstProvider).finally(() => { autoMade.current = false; }); } }, [chats, create, firstProvider]);
  const list = chats ?? [];
  const active = list.find((c) => c.id === activeId) ?? list[list.length - 1];
  useEffect(() => { try { if (active) localStorage.setItem(activeKey, active.id); } catch { /* 저장 못 해도 동작 */ } }, [active, activeKey]);

  const toggleMenu = () => {
    if (menuOpen) { setMenuOpen(false); return; }
    const r = plusRef.current?.getBoundingClientRect();
    if (r) setMenuPos({ x: Math.max(4, Math.min(r.left, window.innerWidth - MENU_W - 4)), y: r.bottom + 4 });
    setMenuOpen(true);
  };
  const close = async (id: string) => {
    const c = list.find((x) => x.id === id);
    if (c && c.title && !(await confirm({ message: t("achat.confirmClose") }))) return;
    await post("/api/chat/sessions", { root: cwd, op: "close", id });
    setChats((p) => (p ?? []).filter((x) => x.id !== id));
  };
  const patch = (id: string, m: Partial<Meta>) => setChats((p) => (p ?? []).map((x) => (x.id === id ? { ...x, ...m } : x)));

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-stretch border-b border-zinc-200 bg-zinc-100/70 pr-[17px] dark:border-zinc-800 dark:bg-[var(--s-bar)]">
        <div className="nunopi-scroll flex min-w-0 flex-1 items-stretch overflow-x-auto">
          {list.map((c) => {
            const on = c.id === active?.id;
            return (
              <div key={c.id} onClick={() => setActiveId(c.id)}
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
      <div className="min-h-0 flex-1 bg-white dark:bg-[var(--s-pane)]">
        {active && <ChatSession key={active.id} root={cwd} meta={active} providers={providers} onMeta={(m) => patch(active.id, m)} />}
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
// 도구 종류 — 묶음 요약 문장용("명령 3개 실행 · 파일 2개 수정")
type Kind = "run" | "edit" | "read" | "web" | "other";
const kindOf = (name: string): Kind =>
  /^(Bash|shell|exec_command|local_shell|BashOutput)$/i.test(name) ? "run"
  : /^(Edit|Write|MultiEdit|NotebookEdit|apply_patch)$/i.test(name) ? "edit"
  : /^(Read|Grep|Glob|LS|NotebookRead)$/i.test(name) ? "read"
  : /^(WebFetch|WebSearch)$/i.test(name) || /browser_/.test(name) ? "web" : "other";
const imgUrl = (name: string) => `/api/chat/image?name=${encodeURIComponent(name)}`;
const COL = "mx-auto w-full max-w-3xl px-5";
type ToolItem = Extract<ChatItem, { k: "tool" }>;
// 화면 줄 — 연달은 도구는 한 묶음으로
type Row = { k: "item"; i: number } | { k: "tools"; ids: number[] };

function ChatSession({ root, meta, providers, onMeta }: { root: string; meta: Meta; providers: typeof PROVIDERS; onMeta: (m: Partial<Meta>) => void }) {
  const t = useT();
  const id = meta.id;
  const [items, setItems] = useState<ChatItem[] | null>(null);
  const [streaming, setStreaming] = useState("");
  const [busy, setBusy] = useState(false);
  const [busySince, setBusySince] = useState(0);
  const [now, setNow] = useState(0);
  const [input, setInput] = useState("");
  const [images, setImages] = useState<{ base64: string; mime: string; url: string }[]>([]);
  const [note, setNote] = useState("");
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [agentMenu, setAgentMenu] = useState(false);
  const [atBottom, setAtBottom] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const stick = useRef(true);
  const onMetaRef = useRef(onMeta);
  useEffect(() => { onMetaRef.current = onMeta; });

  useEffect(() => {
    const es = new EventSource(`/api/chat/stream?root=${encodeURIComponent(root)}&id=${encodeURIComponent(id)}`);
    es.onmessage = (e) => {
      let p: { type: string; items?: ChatItem[]; i?: number; item?: ChatItem; streaming?: string; busy?: boolean };
      try { p = JSON.parse(e.data); } catch { return; }
      if (p.type === "snapshot") { setItems(p.items ?? []); setStreaming(p.streaming ?? ""); setBusy(!!p.busy); if (p.busy) setBusySince(Date.now()); }
      else if (p.type === "item" && typeof p.i === "number" && p.item) {
        const { i, item } = p;
        setItems((prev) => { const next = (prev ?? []).slice(); next[i] = item; return next; });
        if (item.k === "user" && i === 0) onMetaRef.current({ title: item.text.replace(/\s+/g, " ").trim().slice(0, 40) });
      }
      else if (p.type === "delta") setStreaming(p.streaming ?? "");
      else if (p.type === "busy") { setBusy(!!p.busy); if (p.busy) setBusySince(Date.now()); onMetaRef.current({ busy: !!p.busy }); }
      else if (p.type === "gone") es.close();
    };
    return () => es.close();
  }, [root, id]);
  useEffect(() => { taRef.current?.focus(); }, [id]);
  // 일하는 중 경과 시간(1초마다)
  useEffect(() => { if (!busy) return; const iv = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(iv); }, [busy]);
  // 아래에 붙어 있을 때만 따라 내려감(위로 올려 읽는 중이면 그대로)
  useEffect(() => { const el = scrollRef.current; if (el && stick.current) el.scrollTop = el.scrollHeight; }, [items, streaming, busy]);
  const toBottom = () => { const el = scrollRef.current; if (el) { stick.current = true; el.scrollTo({ top: el.scrollHeight, behavior: "smooth" }); } };

  const send = async () => {
    const text = input.trim();
    if (!text && !images.length) return;
    setInput(""); const imgs = images; setImages([]); stick.current = true; setNote("");
    const r = await post("/api/chat/send", { root, id, text, images: imgs.map(({ base64, mime }) => ({ base64, mime })) });
    if (!r?.ok && r?.error) setNote(String(r.error));
  };
  const stop = () => void post("/api/chat/stop", { root, id });
  const answer = (permId: string, allow: boolean) => void post("/api/chat/answer", { root, id, permId, allow });
  const addFiles = (files: File[]) => {
    for (const f of files.filter((x) => x.type.startsWith("image/"))) {
      if (f.size > 5 * 1024 * 1024) { setNote(t("achat.imageTooBig")); continue; }
      const rd = new FileReader();
      rd.onload = () => { const url = String(rd.result); setImages((p) => [...p, { url, mime: f.type, base64: url.slice(url.indexOf(",") + 1) }]); };
      rd.readAsDataURL(f);
    }
  };
  const onPaste = (e: React.ClipboardEvent) => { const fs = [...e.clipboardData.files]; if (fs.some((f) => f.type.startsWith("image/"))) { e.preventDefault(); addFiles(fs); } };
  const switchAgent = async (p: Provider) => { setAgentMenu(false); const r = await post("/api/chat/sessions", { root, op: "provider", id, provider: p }); if (r?.ok) onMeta({ provider: p }); };
  const toggle = (k: string) => setOpen((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });

  const empty = items !== null && !items.length && !busy;
  const locked = !!items?.length;
  const cur = P(meta.provider);
  const secs = (ms: number) => (ms < 60_000 ? `${Math.max(1, Math.round(ms / 1000))}s` : `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`);

  const rows: Row[] = [];
  (items ?? []).forEach((it, i) => {
    const last = rows[rows.length - 1];
    if (it.k === "tool") { if (last?.k === "tools") last.ids.push(i); else rows.push({ k: "tools", ids: [i] }); }
    else rows.push({ k: "item", i });
  });

  // 도구 한 줄 — 카드·배경 없이 흐린 글자, 실행 중이면 빛이 지나감, 실패만 빨간 표시. 누르면 입력·결과.
  const toolRow = (it: ToolItem, key: string) => {
    const on = open.has(key), sum = toolSummary(it.input), running = it.result === undefined && busy;
    return (
      <div key={key} className="flex flex-col">
        <button type="button" onClick={() => toggle(key)} aria-expanded={on}
          className="group/row flex min-w-0 items-center gap-1.5 py-0.5 text-left text-[13.5px] text-zinc-500 transition hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-100">
          <span className={`shrink-0 ${running ? "mustard-shimmer" : ""}`}>{it.name}</span>
          {sum && <span className={`min-w-0 truncate font-mono text-[12px] text-zinc-400 dark:text-zinc-500 ${running ? "mustard-shimmer" : ""}`}>{sum}</span>}
          {it.error && <span className="shrink-0 rounded-full bg-red-500/10 px-1.5 text-[11px] text-red-600 dark:text-red-400">{t("achat.failed")}</span>}
          <IconChevronRight size={12} stroke={2} className={`shrink-0 transition ${on ? "rotate-90 opacity-100" : "opacity-0 group-hover/row:opacity-100"}`} aria-hidden />
        </button>
        {on && (
          <div className="mb-1 mt-1 flex flex-col overflow-hidden rounded-xl border border-black/[.08] font-mono text-[12px] leading-[18px] text-zinc-600 dark:border-white/[.08] dark:text-zinc-300">
            {it.input && <pre className="nunopi-scroll max-h-40 overflow-auto whitespace-pre-wrap break-all bg-black/[.03] px-3 py-2 dark:bg-white/[.03]">{it.input}</pre>}
            {it.result !== undefined && <pre className={`nunopi-scroll max-h-[400px] overflow-auto whitespace-pre-wrap break-all border-t border-black/[.08] px-3 py-2 dark:border-white/[.08] ${it.error ? "text-red-600 dark:text-red-400" : ""}`}>{it.result || "—"}</pre>}
          </div>
        )}
        {it.images?.length ? <div className="mb-1 mt-1.5 flex flex-wrap gap-2">{it.images.map((n) => <a key={n} href={imgUrl(n)} target="_blank" rel="noreferrer"><img src={imgUrl(n)} alt="" className="max-h-72 rounded-xl ring-1 ring-inset ring-black/[.08] dark:ring-white/[.08]" /></a>)}</div> : null}
      </div>
    );
  };
  // 연달은 도구 묶음 — 한 문장 요약(펼치면 각 줄, 왼쪽 선으로 들여씀). 하나면 그 줄 그대로.
  const toolGroup = (ids: number[]) => {
    const tools = ids.map((i) => items![i] as ToolItem);
    if (tools.length === 1) return toolRow(tools[0], `t${ids[0]}`);
    const key = `g${ids[0]}`, on = open.has(key);
    const running = busy && tools.some((x) => x.result === undefined);
    const cnt: Record<Kind, number> = { run: 0, edit: 0, read: 0, web: 0, other: 0 };
    for (const x of tools) cnt[kindOf(x.name)]++;
    const parts = (["edit", "run", "read", "web", "other"] as Kind[]).filter((k) => cnt[k]).map((k) => t(`achat.sum.${k}`, { n: cnt[k] }));
    const failed = tools.some((x) => x.error);
    const live = running ? tools.find((x) => x.result === undefined) : undefined;
    return (
      <div key={key} className="flex flex-col">
        <button type="button" onClick={() => toggle(key)} aria-expanded={on}
          className="group/row flex min-w-0 items-center gap-1.5 py-0.5 text-left text-[13.5px] text-zinc-500 transition hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-100">
          <span className={`min-w-0 truncate ${running ? "mustard-shimmer" : ""}`}>{parts.join(" · ")}{live ? ` · ${live.name}` : ""}</span>
          {failed && <span className="shrink-0 rounded-full bg-red-500/10 px-1.5 text-[11px] text-red-600 dark:text-red-400">{t("achat.failed")}</span>}
          <IconChevronRight size={12} stroke={2} className={`shrink-0 transition ${on ? "rotate-90 opacity-100" : "opacity-0 group-hover/row:opacity-100"}`} aria-hidden />
        </button>
        {on && <div className="ml-1 mt-0.5 flex flex-col border-l border-black/[.08] pl-4 dark:border-white/[.08]">{tools.map((x, k) => toolRow(x, `t${ids[k]}`))}</div>}
        {!on && tools.some((x) => x.images?.length) && (
          <div className="mt-1.5 flex flex-wrap gap-2">{tools.flatMap((x) => x.images ?? []).map((n) => <a key={n} href={imgUrl(n)} target="_blank" rel="noreferrer"><img src={imgUrl(n)} alt="" className="max-h-72 rounded-xl ring-1 ring-inset ring-black/[.08] dark:ring-white/[.08]" /></a>)}</div>
        )}
      </div>
    );
  };

  const render = (it: ChatItem, i: number) => {
    switch (it.k) {
      case "user": return (
        <div key={i} className={`flex flex-col items-end gap-2 ${i ? "mt-2" : ""}`}>
          {it.images?.length ? <div className="flex flex-wrap justify-end gap-2">{it.images.map((n) => <img key={n} src={imgUrl(n)} alt="" className="max-h-48 rounded-[20px] ring-1 ring-inset ring-black/[.08] dark:ring-white/[.08]" />)}</div> : null}
          {it.text && <div className="max-w-[77%] whitespace-pre-wrap break-words rounded-[20px] bg-black/[.05] px-3.5 py-2 text-[14px] leading-relaxed text-zinc-800 dark:bg-white/[.08] dark:text-zinc-100">{it.text}</div>}
        </div>);
      case "text": return <div key={i} className="max-w-full text-[14px] leading-relaxed text-zinc-800 dark:text-zinc-100"><Markdown>{it.text}</Markdown></div>;
      case "tool": return null; // 묶음으로 그림
      case "perm": return (
        <div key={i} className="flex flex-col gap-3 rounded-[22px] border border-black/[.08] bg-zinc-50 p-4 dark:border-white/[.08] dark:bg-zinc-800/60">
          <div className="flex items-center gap-2 text-[13.5px] font-medium text-zinc-800 dark:text-zinc-100"><IconShieldQuestion size={16} stroke={1.6} className="text-mustard-600 dark:text-mustard-400" aria-hidden />{t("achat.permAsk", { tool: it.tool })}</div>
          <code className="nunopi-scroll max-h-28 overflow-auto whitespace-pre-wrap break-all rounded-xl bg-black/[.04] px-3 py-2 font-mono text-[12px] text-zinc-600 dark:bg-white/[.05] dark:text-zinc-300">{toolSummary(it.input) || it.input}</code>
          {it.state === "pending"
            ? <div className="flex justify-end gap-1.5">
                <button type="button" onClick={() => answer(it.id, false)} className="h-8 rounded-full px-3.5 text-[13px] text-zinc-600 transition hover:bg-black/[.06] dark:text-zinc-300 dark:hover:bg-white/[.08]">{t("achat.deny")}</button>
                <button type="button" onClick={() => answer(it.id, true)} className="h-8 rounded-full bg-zinc-900 px-3.5 text-[13px] font-medium text-white transition hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white">{t("achat.allow")}</button>
              </div>
            : <span className="text-[12.5px] text-zinc-500 dark:text-zinc-400">{t(it.state === "allowed" ? "achat.allowed" : "achat.denied")}</span>}
        </div>);
      case "done": return (
        <div key={i} className="-mt-2 text-[12.5px] tabular-nums text-zinc-400 dark:text-zinc-500">
          {it.ms != null ? t("achat.workedFor", { t: secs(it.ms) }) : t("achat.done")}
          {it.outTok != null && ` · ${it.outTok.toLocaleString()} tok`}
          {it.cost != null && ` · $${it.cost.toFixed(3)}`}
        </div>);
      case "error": return <div key={i} className="flex items-start gap-2.5 rounded-[20px] border border-red-500/20 bg-red-500/5 p-3.5 text-[13px] font-medium text-red-600 dark:text-red-400"><IconAlertTriangle size={15} stroke={1.8} className="mt-0.5 shrink-0" aria-hidden /><span className="whitespace-pre-wrap break-all">{it.text}</span></div>;
      case "stopped": return <div key={i} className="text-[12.5px] text-zinc-400 dark:text-zinc-500">{t("achat.stopped")}</div>;
    }
  };

  const ghost = "flex h-7 items-center gap-1.5 rounded-full px-2 text-[13px] leading-[18px] text-zinc-500 transition hover:bg-black/[.06] hover:text-zinc-800 dark:text-zinc-400 dark:hover:bg-white/[.08] dark:hover:text-zinc-100";
  // 입력 카드 — 테두리 대신 겹 그림자. 빈 채팅은 가운데, 대화 중엔 아래
  const composer = (
    <div className="rounded-[22px] bg-white shadow-[0_0_0_1px_rgba(0,0,0,0.06),0_2px_8px_rgba(0,0,0,0.05),0_4px_40px_4px_rgba(0,0,0,0.03)] dark:bg-zinc-800 dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08),0_4px_24px_rgba(0,0,0,0.3)]">
      {images.length > 0 && (
        <div className="flex flex-wrap gap-2 px-2.5 pb-1 pt-2.5">
          {images.map((im, k) => (
            <div key={k} className="group/img relative">
              <img src={im.url} alt="" className="h-20 w-20 rounded-[16px] object-cover ring-1 ring-inset ring-black/[.08] dark:ring-white/[.1]" />
              <button type="button" onClick={() => setImages((p) => p.filter((_, j) => j !== k))} aria-label={t("achat.removeImage")}
                className="absolute -right-1 -top-1 rounded-full bg-zinc-900 p-0.5 text-white opacity-0 shadow transition group-hover/img:opacity-100 dark:bg-zinc-100 dark:text-zinc-900"><IconX size={11} stroke={2.5} aria-hidden /></button>
            </div>
          ))}
        </div>
      )}
      <textarea ref={taRef} value={input} onChange={(e) => setInput(e.target.value)} onPaste={onPaste} rows={1} placeholder={t("achat.placeholder")}
        onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(); } else if (e.key === "Escape" && busy) { e.preventDefault(); stop(); } }}
        className={`block max-h-[max(160px,40vh)] w-full resize-none bg-transparent px-4 pt-3 text-[14px] leading-5 text-zinc-800 outline-none [field-sizing:content] placeholder:text-zinc-400 dark:text-zinc-100 dark:placeholder:text-zinc-500 ${empty ? "min-h-[64px]" : "min-h-[40px]"}`} />
      <div className="flex items-center gap-1 px-2 pb-2">
        <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => { addFiles([...(e.target.files ?? [])]); e.target.value = ""; }} />
        <button type="button" onClick={() => fileRef.current?.click()} aria-label={t("achat.attach")} title={t("achat.attach")} className={`${ghost} w-7 justify-center px-0`}>
          <IconPlus size={16} stroke={1.8} aria-hidden />
        </button>
        <div className="relative">
          <button type="button" onClick={() => !locked && providers.length > 1 && setAgentMenu((v) => !v)} title={locked ? t("achat.agentLocked") : undefined}
            className={locked || providers.length < 2 ? "flex h-7 cursor-default items-center gap-1.5 px-2 text-[13px] leading-[18px] text-zinc-500 dark:text-zinc-400" : ghost}>
            <AgentLogo agent={cur.agent} size={13} />{cur.label}
            {!locked && providers.length > 1 && <IconChevronDown size={12} stroke={2} aria-hidden />}
          </button>
          {agentMenu && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setAgentMenu(false)} aria-hidden />
              <div className={`absolute left-0 z-50 min-w-[180px] rounded-2xl bg-white p-1 shadow-[0_0_0_1px_rgba(0,0,0,0.06),0_8px_24px_rgba(0,0,0,0.12)] dark:bg-zinc-800 dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08),0_8px_24px_rgba(0,0,0,0.4)] ${empty ? "top-full mt-1.5" : "bottom-full mb-1.5"}`}>
                {providers.map((p) => (
                  <button key={p.id} type="button" onClick={() => void switchAgent(p.id)}
                    className={`flex w-full items-center gap-2 rounded-xl px-2.5 py-1.5 text-left text-[13px] transition hover:bg-black/[.05] dark:hover:bg-white/[.08] ${p.id === meta.provider ? "text-zinc-900 dark:text-white" : "text-zinc-600 dark:text-zinc-300"}`}>
                    <AgentLogo agent={p.agent} size={14} />{p.label}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          {busy && !input.trim() && !images.length
            ? <button type="button" onClick={stop} aria-label={t("achat.stop")} title={`${t("achat.stop")} (Esc)`}
                className="flex size-7 items-center justify-center rounded-full bg-zinc-900 text-white transition active:opacity-70 dark:bg-zinc-100 dark:text-zinc-900">
                <IconPlayerStopFilled size={11} aria-hidden />
              </button>
            : <button type="button" onClick={() => void send()} disabled={!input.trim() && !images.length} aria-label={t("achat.send")}
                className="flex size-7 items-center justify-center rounded-full bg-mustard-500 text-white transition hover:bg-mustard-600 active:opacity-70 disabled:bg-black/[.08] disabled:text-zinc-400 dark:disabled:bg-white/[.1] dark:disabled:text-zinc-500">
                <IconArrowUp size={15} stroke={2.5} aria-hidden />
              </button>}
        </div>
      </div>
    </div>
  );

  if (items === null) return null;
  if (empty) return (
    <div className="flex h-full flex-col items-center justify-center pb-[14vh]">
      <div className="mx-auto w-full max-w-[790px] px-5">
        <h2 className="mb-7 text-center text-[26px] font-normal tracking-tight text-zinc-800 dark:text-zinc-100">{t("achat.emptySession")}</h2>
        {composer}
        {note && <p className="mt-2 text-center text-[12.5px] text-red-600 dark:text-red-400">{note}</p>}
      </div>
    </div>
  );

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      <div ref={scrollRef} onScroll={(e) => { const el = e.currentTarget; const b = el.scrollHeight - el.scrollTop - el.clientHeight < 40; stick.current = b; setAtBottom(b); }}
        className="nunopi-scroll min-h-0 flex-1 overflow-y-auto">
        <div className={`${COL} flex flex-col gap-4 pb-8 pt-6`}>
          {rows.map((r) => (r.k === "tools" ? toolGroup(r.ids) : render(items[r.i], r.i)))}
          {streaming && <div className="max-w-full text-[14px] leading-relaxed text-zinc-800 dark:text-zinc-100"><Markdown>{streaming}</Markdown></div>}
          {busy && !streaming && <span className="mustard-shimmer self-start text-[13.5px] tabular-nums text-zinc-500 dark:text-zinc-400">{t("achat.working")} {busySince ? secs(Math.max(0, (now || busySince) - busySince)) : ""}</span>}
        </div>
      </div>
      <div className="relative mx-auto w-full max-w-[790px] shrink-0 px-5 pb-4">
        <div className="pointer-events-none absolute inset-x-0 -top-12 h-12 bg-gradient-to-t from-white to-transparent dark:from-[var(--s-pane)]" aria-hidden />
        {!atBottom && (
          <button type="button" onClick={toBottom} aria-label={t("achat.toBottom")}
            className="absolute -top-11 left-1/2 flex size-8 -translate-x-1/2 items-center justify-center rounded-full border border-black/[.08] bg-white text-zinc-600 transition hover:text-zinc-900 dark:border-white/[.1] dark:bg-zinc-800 dark:text-zinc-300 dark:hover:text-white">
            <IconChevronDown size={16} stroke={2} aria-hidden />
          </button>
        )}
        {note && <p className="mb-1.5 text-[12.5px] text-red-600 dark:text-red-400">{note}</p>}
        {composer}
      </div>
    </div>
  );
}
