"use client";
/* eslint-disable @next/next/no-img-element -- 로컬 API 이미지(최적화 불필요, 데스크톱 오프라인) */
// 채팅 한 세션 화면(#1341) — 타임라인(SSE) + 입력 카드(ChatComposer).
// 도구는 카드 없이 흐린 한 줄(연달으면 한 문장 요약으로 묶음), 진행은 글자 위 빛(mustard-shimmer), 실패만 빨간 배지.
// 끝난 턴은 '내 말 · N초 동안 작업 › · 마지막 답'으로 접힘(펼치기 가능). 일하는 중 보낸 말은 대기열(쉬면 하나씩 보냄).
// ⌘F 찾기(CSS 하이라이트), 내 말 hover = 복사·다시 보내기·고쳐 쓰기, 답 hover = 복사, 코드 블록 hover = 복사.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { IconX, IconChevronRight, IconChevronDown, IconChevronUp, IconShieldQuestion, IconAlertTriangle, IconCopy, IconRefresh, IconPencil, IconCheck, IconSend, IconMessageCircle, IconTerminal2, IconFileText, IconPencilCode, IconWorld, IconTool, IconServer, IconFolder, IconGitBranch } from "@tabler/icons-react";
import { useT, Markdown, useSetting, CHATKEYS, CHAT_DEFAULTS } from "@mustard/core";
import type { ChatItem } from "@/lib/chat/chatTimeline";
import ChatComposer, { P, post, type AppCommand, type Img, type Meta, type PROVIDERS } from "@/components/workspace/ChatComposer";

function toolSummary(input?: string): string {
  if (!input) return "";
  try {
    const o = JSON.parse(input) as Record<string, unknown>;
    const v = o.command ?? o.file_path ?? o.path ?? o.pattern ?? o.url ?? o.query ?? o.description;
    return typeof v === "string" ? v.replace(/\s+/g, " ") : "";
  } catch { return input.slice(0, 120); }
}
type Kind = "run" | "edit" | "read" | "web" | "other";
const kindOf = (name: string): Kind =>
  /^(Bash|shell|exec_command|local_shell|BashOutput)$/i.test(name) ? "run"
  : /^(Edit|Write|MultiEdit|NotebookEdit|apply_patch)$/i.test(name) ? "edit"
  : /^(Read|Grep|Glob|LS|NotebookRead)$/i.test(name) ? "read"
  : /^(WebFetch|WebSearch)$/i.test(name) || /browser_/.test(name) ? "web" : "other";
const imgUrl = (name: string) => `/api/chat/image?name=${encodeURIComponent(name)}`;
const COL = "mx-auto w-full max-w-[46rem] px-3 sm:px-4";
const KIND_ICON = { run: IconTerminal2, edit: IconPencilCode, read: IconFileText, web: IconWorld, other: IconTool };
type ToolItem = Extract<ChatItem, { k: "tool" }>;
type Row = { k: "item"; i: number } | { k: "tools"; ids: number[] } | { k: "fold"; key: string; ms?: number; tools: number };
type Queued = { id: number; text: string; images: Img[] };
const secs = (ms: number) => (ms < 60_000 ? `${Math.max(1, Math.round(ms / 1000))}s` : `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`);

// 화면 줄 만들기 — 턴(내 말부터 다음 내 말 전까지)마다, 끝난 옛 턴은 접고, 연달은 도구는 묶음
function buildRows(items: ChatItem[], open: Set<string>, unfoldAll: boolean): Row[] {
  const starts: number[] = [];
  items.forEach((it, i) => { if (it.k === "user" && (i === 0 || items[i - 1].k !== "user")) starts.push(i); });
  if (!starts.length || starts[0] !== 0) starts.unshift(0);
  const rows: Row[] = [];
  const pushRange = (ids: number[]) => {
    for (const i of ids) {
      const last = rows[rows.length - 1];
      if (items[i].k === "tool") { if (last?.k === "tools" && last.ids[last.ids.length - 1] === i - 1) last.ids.push(i); else rows.push({ k: "tools", ids: [i] }); }
      else rows.push({ k: "item", i });
    }
  };
  starts.forEach((s, n) => {
    const e = n + 1 < starts.length ? starts[n + 1] : items.length;
    const ids = Array.from({ length: e - s }, (_, k) => s + k);
    const ended = ids.some((i) => ["done", "stopped", "error"].includes(items[i].k));
    const key = `f${s}`;
    const lastText = [...ids].reverse().find((i) => items[i].k === "text");
    const users = ids.filter((i) => items[i].k === "user");
    const hidden = ids.filter((i) => items[i].k !== "user" && i !== lastText && items[i].k !== "done" && items[i].k !== "perm");
    if (n + 1 < starts.length && ended && hidden.length > 0 && !open.has(key) && !unfoldAll) {
      const done = ids.map((i) => items[i]).find((it) => it.k === "done") as Extract<ChatItem, { k: "done" }> | undefined;
      pushRange(users);
      rows.push({ k: "fold", key, ms: done?.ms, tools: hidden.filter((i) => items[i].k === "tool").length });
      if (lastText !== undefined) rows.push({ k: "item", i: lastText });
    } else pushRange(ids);
  });
  return rows;
}

export default function ChatSession({ root, meta, providers, onMeta, onAppCommand }: {
  root: string; meta: Meta; providers: typeof PROVIDERS; onMeta: (m: Partial<Meta>) => void; onAppCommand: (c: AppCommand) => void;
}) {
  const t = useT();
  const id = meta.id;
  const [items, setItems] = useState<ChatItem[] | null>(null);
  const [streaming, setStreaming] = useState("");
  const [busy, setBusy] = useState(false);
  const [busySince, setBusySince] = useState(0);
  const [now, setNow] = useState(0);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [atBottom, setAtBottom] = useState(true);
  const [queue, setQueue] = useState<Queued[]>([]);
  const [draft, setDraft] = useState<string | undefined>(undefined);
  const [note, setNote] = useState("");
  const [copied, setCopied] = useState<string | null>(null);
  const [find, setFind] = useState<{ q: string; idx: number; n: number } | null>(null);
  const [where, setWhere] = useState<{ host: string; folder: string; worktree: boolean; branch: string } | null>(null);
  useEffect(() => { void fetch(`/api/chat/context?root=${encodeURIComponent(root)}`).then((r) => r.json()).then((j) => { if (j?.ok) setWhere(j); }).catch(() => {}); }, [root, busy]); // 일이 끝날 때 브랜치가 바뀌었을 수 있어 다시
  const scrollRef = useRef<HTMLDivElement>(null);
  const findRef = useRef<HTMLInputElement>(null);
  const stick = useRef(true);
  const qid = useRef(0);
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
        if (item.k === "user") onMetaRef.current({ ...(i === 0 ? { title: item.text.replace(/\s+/g, " ").trim().slice(0, 40) } : {}), count: 1 + i });
      }
      else if (p.type === "delta") setStreaming(p.streaming ?? "");
      else if (p.type === "busy") { setBusy(!!p.busy); if (p.busy) setBusySince(Date.now()); onMetaRef.current({ busy: !!p.busy }); }
      else if (p.type === "gone") es.close();
    };
    return () => es.close();
  }, [root, id]);
  useEffect(() => { if (!busy) return; const iv = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(iv); }, [busy]);
  useEffect(() => { const el = scrollRef.current; if (el && stick.current && !find) el.scrollTop = el.scrollHeight; }, [items, streaming, busy, find]);
  const toBottom = () => { const el = scrollRef.current; if (el) { stick.current = true; el.scrollTo({ top: el.scrollHeight, behavior: "smooth" }); } };

  const queueOn = useSetting<boolean>(CHATKEYS.queueWhileBusy, CHAT_DEFAULTS.queueWhileBusy); // 설정 > 채팅
  const scrollOn = useSetting<boolean>(CHATKEYS.scrollOnSend, CHAT_DEFAULTS.scrollOnSend);
  const sendNow = useCallback(async (text: string, images: Img[]) => {
    if (scrollOn) stick.current = true;
    setNote("");
    const r = await post("/api/chat/send", { root, id, text, images: images.map(({ base64, mime }) => ({ base64, mime })) });
    if (!r?.ok && r?.error) setNote(r.error === "handed-off" ? t("achat.handedOff") : String(r.error));
  }, [root, id, scrollOn, t]);
  // 일하는 중이면 대기열(⌘Enter면 바로) — 쉬게 되면 맨 앞 하나를 보냄
  const onSend = (text: string, images: Img[], immediate: boolean) => {
    if (busy && !immediate && queueOn) { setQueue((q) => [...q, { id: ++qid.current, text, images }]); return; }
    void sendNow(text, images);
  };
  const flushing = useRef(false); // 대기열에서 하나 보냄 → 일 시작(busy)이 올 때까지 다음 것은 기다림(리뷰: 둘이 한 턴에 붙던 문제)
  useEffect(() => { if (busy) flushing.current = false; }, [busy]);
  useEffect(() => {
    if (busy || flushing.current || !queue.length || items === null) return;
    const [head, ...rest] = queue;
    flushing.current = true;
    setQueue(rest); // 쉬게 되면 대기열 맨 앞을 보냄
    void sendNow(head.text, head.images).then(() => { setTimeout(() => { flushing.current = false; }, 15_000); }); // busy가 끝내 안 오면(보내기 실패) 15초 뒤 풀림
  }, [busy, queue, items, sendNow]);
  const stop = () => void post("/api/chat/stop", { root, id });
  const answer = (permId: string, allow: boolean) => void post("/api/chat/answer", { root, id, permId, allow });
  const setOptions = async (o: Partial<Pick<Meta, "provider" | "model" | "effort" | "mode">>) => {
    const r = await post("/api/chat/sessions", { root, op: "options", id, ...o, ...("effort" in o && o.effort === undefined ? { effort: null } : {}) });
    if (r?.ok && r.chat) onMeta(r.chat as Meta);
  };
  const copy = (key: string, text: string) => { void navigator.clipboard?.writeText(text).then(() => { setCopied(key); setTimeout(() => setCopied((c) => (c === key ? null : c)), 1200); }).catch(() => {}); };
  const toggle = (k: string) => setOpen((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const appCommand = (c: AppCommand) => { if (c === "find") { setFind({ q: "", idx: 0, n: 0 }); setTimeout(() => findRef.current?.focus(), 0); } else onAppCommand(c); };

  // ⌘F 찾기 — 타임라인 글에서 맞는 곳을 CSS 하이라이트로(접힌 턴은 찾는 동안 펼침)
  useEffect(() => {
    const H = (globalThis as unknown as { CSS?: { highlights?: Map<string, unknown> } }).CSS?.highlights;
    const HL = (globalThis as unknown as { Highlight?: new (...r: Range[]) => unknown }).Highlight;
    if (!H || !HL) return;
    H.delete("mustard-find"); H.delete("mustard-find-cur");
    const el = scrollRef.current;
    if (!find?.q || !el) return;
    const q = find.q.toLowerCase(), ranges: Range[] = [];
    const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n = walk.nextNode(); n && ranges.length < 500; n = walk.nextNode()) {
      const s = (n.textContent ?? "").toLowerCase();
      for (let k = s.indexOf(q); k >= 0 && ranges.length < 500; k = s.indexOf(q, k + q.length)) { const r = document.createRange(); r.setStart(n, k); r.setEnd(n, k + q.length); ranges.push(r); }
    }
    if (ranges.length) {
      const cur = ranges[Math.min(find.idx, ranges.length - 1)];
      H.set("mustard-find", new HL(...ranges)); H.set("mustard-find-cur", new HL(cur));
      cur.startContainer.parentElement?.scrollIntoView({ block: "center" });
    }
    if (ranges.length !== find.n) setFind((f) => (f ? { ...f, n: ranges.length } : f)); // eslint-disable-line react-hooks/set-state-in-effect -- 찾은 개수 표시
    return () => { H.delete("mustard-find"); H.delete("mustard-find-cur"); };
  }, [find, items]);

  const history = useMemo(() => (items ?? []).flatMap((it) => (it.k === "user" && it.text ? [it.text] : [])), [items]);
  const ctx = useMemo(() => {
    const d = (items ?? []).findLast((it) => it.k === "done" && !!it.ctx && !!it.win) as Extract<ChatItem, { k: "done" }> | undefined;
    return d ? { used: d.ctx!, win: d.win! } : undefined;
  }, [items]);
  const finding = !!find?.q;
  const rows = useMemo(() => buildRows(items ?? [], open, finding), [items, open, finding]);
  const empty = items !== null && !items.length && !busy;
  const lastText = useMemo(() => (items ?? []).findLastIndex((it) => it.k === "text"), [items]);
  const pendingPerm = useMemo(() => { const l = items ?? []; const i = l.findLastIndex((it) => it.k === "perm" && it.state === "pending"); return i >= 0 ? (l[i] as Extract<ChatItem, { k: "perm" }>) : null; }, [items]);

  const iconBtn = "flex size-7 items-center justify-center rounded-lg text-zinc-400 transition hover:bg-black/[.05] hover:text-zinc-700 dark:text-zinc-500 dark:hover:bg-white/[.08] dark:hover:text-zinc-200";
  const toolRow = (it: ToolItem, key: string) => {
    const on = open.has(key), sum = toolSummary(it.input), running = it.result === undefined && busy;
    return (
      <div key={key} className="flex flex-col">
        <button type="button" onClick={() => toggle(key)} aria-expanded={on}
          className="group/row flex min-h-[26px] min-w-0 items-center gap-2 text-left text-[13px] text-zinc-500 transition hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-100">
          {(() => { const I = KIND_ICON[kindOf(it.name)]; return <I size={16} stroke={1.6} className="shrink-0" aria-hidden />; })()}
          <span className={`shrink-0 ${running ? "mustard-shimmer" : ""}`}>{it.name}</span>
          {sum && <span className={`min-w-0 truncate font-mono text-[12px] text-zinc-400 dark:text-zinc-500 ${running ? "mustard-shimmer" : ""}`}>{sum}</span>}
          {it.error && <span className="shrink-0 rounded-full bg-red-500/10 px-1.5 text-[11px] text-red-600 dark:text-red-400">{t("achat.failed")}</span>}
          <IconChevronRight size={12} stroke={2} className={`shrink-0 transition ${on ? "rotate-90 opacity-100" : "opacity-0 group-hover/row:opacity-100"}`} aria-hidden />
        </button>
        {on && (
          <div className="mb-1 ml-6 mt-1 flex max-h-64 flex-col overflow-hidden rounded-lg border border-black/[.08] font-mono text-[12px] leading-[18px] text-zinc-600 dark:border-white/[.08] dark:text-zinc-300">
            {it.input && <pre className="nunopi-scroll max-h-40 overflow-auto whitespace-pre-wrap break-all bg-black/[.03] px-3 py-2 dark:bg-white/[.03]">{kindOf(it.name) === "run" && sum ? `$ ${sum}` : it.input}</pre>}
            {it.result !== undefined && <pre className={`nunopi-scroll max-h-[400px] overflow-auto whitespace-pre-wrap break-all border-t border-black/[.08] px-3 py-2 dark:border-white/[.08] ${it.error ? "text-red-600 dark:text-red-400" : ""}`}>{it.result || "—"}</pre>}
          </div>
        )}
        {it.images?.length ? <div className="mb-1 mt-1.5 flex flex-wrap gap-2">{it.images.map((n) => <a key={n} href={imgUrl(n)} target="_blank" rel="noreferrer"><img src={imgUrl(n)} alt="" className="max-h-72 rounded-xl ring-1 ring-inset ring-black/[.08] dark:ring-white/[.08]" /></a>)}</div> : null}
      </div>
    );
  };
  const toolGroup = (ids: number[]) => {
    const tools = ids.map((i) => items![i] as ToolItem);
    if (tools.length === 1) return toolRow(tools[0], `t${ids[0]}`);
    const key = `g${ids[0]}`, on = open.has(key);
    const running = busy && tools.some((x) => x.result === undefined);
    const cnt: Record<Kind, number> = { run: 0, edit: 0, read: 0, web: 0, other: 0 };
    for (const x of tools) cnt[kindOf(x.name)]++;
    const parts = (["edit", "run", "read", "web", "other"] as Kind[]).filter((k) => cnt[k]).map((k) => t(`achat.sum.${k}`, { n: cnt[k] }));
    const live = running ? tools.find((x) => x.result === undefined) : undefined;
    return (
      <div key={key} className="flex flex-col">
        <button type="button" onClick={() => toggle(key)} aria-expanded={on}
          className="group/row flex min-h-[26px] min-w-0 items-center gap-2 text-left text-[13px] text-zinc-500 transition hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-100">
          {running ? <IconTool size={16} stroke={1.6} className="shrink-0" aria-hidden /> : <IconCheck size={16} stroke={1.8} className="shrink-0" aria-hidden />}
          <span className={`min-w-0 truncate ${running ? "mustard-shimmer" : ""}`}>{parts.join(" · ")}{live ? ` · ${live.name}` : ""}</span>
          {tools.some((x) => x.error) && <span className="shrink-0 rounded-full bg-red-500/10 px-1.5 text-[11px] text-red-600 dark:text-red-400">{t("achat.failed")}</span>}
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
        <div key={i} className={`group/msg flex flex-col items-end gap-1 ${i ? "mt-2" : ""}`}>
          {it.images?.length ? <div className="flex flex-wrap justify-end gap-2">{it.images.map((n) => <img key={n} src={imgUrl(n)} alt="" className="max-h-48 rounded-xl border border-black/[.08] dark:border-white/[.08]" />)}</div> : null}
          {it.text && <div className="max-w-[80%] whitespace-pre-wrap break-words rounded-xl border border-black/[.07] bg-black/[.04] px-3.5 py-2.5 text-sm leading-relaxed text-zinc-800 dark:border-white/[.08] dark:bg-white/[.06] dark:text-zinc-100">{it.text}</div>}
          <div className="flex gap-0.5 opacity-0 transition group-hover/msg:opacity-100 focus-within:opacity-100">
            <button type="button" className={iconBtn} title={t("achat.copy")} aria-label={t("achat.copy")} onClick={() => copy(`u${i}`, it.text)}>{copied === `u${i}` ? <IconCheck size={14} stroke={2} /> : <IconCopy size={14} stroke={1.8} />}</button>
            <button type="button" className={iconBtn} title={t("achat.edit")} aria-label={t("achat.edit")} onClick={() => setDraft(it.text)}><IconPencil size={14} stroke={1.8} /></button>
            <button type="button" className={iconBtn} title={t("achat.retry")} aria-label={t("achat.retry")} onClick={() => onSend(it.text, [], false)}><IconRefresh size={14} stroke={1.8} /></button>
          </div>
        </div>);
      case "text": return (
        <div key={i} className="group/msg flex flex-col gap-0.5">
          <div className="max-w-full text-sm leading-relaxed text-zinc-800 dark:text-zinc-100"><Markdown copyCode>{it.text}</Markdown></div>
          <div className={`-ml-1.5 flex transition ${i === lastText && !busy ? "" : "opacity-0 group-hover/msg:opacity-100 focus-within:opacity-100"}`}>
            <button type="button" className={iconBtn} title={t("achat.copy")} aria-label={t("achat.copy")} onClick={() => copy(`a${i}`, it.text)}>{copied === `a${i}` ? <IconCheck size={14} stroke={2} /> : <IconCopy size={14} stroke={1.8} />}</button>
          </div>
        </div>);
      case "tool": return null;
      case "perm": return it.state === "pending" ? null : ( // 묻는 카드는 입력 카드 자리에, 답한 뒤엔 한 줄 기록만
        <div key={i} className="flex min-h-[26px] items-center gap-2 text-[13px] text-zinc-500 dark:text-zinc-400">
          <IconShieldQuestion size={16} stroke={1.6} className="shrink-0" aria-hidden />
          <span className="shrink-0">{t(it.state === "allowed" ? "achat.allowed" : "achat.denied")}</span>
          <span className="min-w-0 truncate font-mono text-[12px] text-zinc-400 dark:text-zinc-500">{it.tool} {toolSummary(it.input)}</span>
        </div>);
      case "done": return (
        <div key={i} className="-mt-2 text-[12.5px] tabular-nums text-zinc-400 dark:text-zinc-500">
          {it.ms != null ? t("achat.workedFor", { t: secs(it.ms) }) : t("achat.done")}
          {it.outTok != null && ` · ${it.outTok.toLocaleString()} tok`}
        </div>);
      case "error": return <div key={i} className="flex items-start gap-2.5 rounded-md border border-black/[.08] bg-zinc-100/20 p-3 text-[13px] text-zinc-700 dark:border-white/[.08] dark:bg-white/[.02] dark:text-zinc-300"><IconAlertTriangle size={15} stroke={1.8} className="mt-0.5 shrink-0 text-red-500" aria-hidden /><span className="whitespace-pre-wrap break-all">{it.text}</span></div>;
      case "stopped": return <div key={i} className="text-[12.5px] text-zinc-400 dark:text-zinc-500">{t("achat.stopped")}</div>;
      case "bg": return <div key={i} className="truncate text-[12.5px] text-zinc-400 dark:text-zinc-500">{t(it.failed ? "achat.bgFailed" : "achat.bgDone")}{it.text && ` · ${it.text}`}</div>;
    }
  };

  const composer = (
    <ChatComposer root={root} meta={meta} providers={providers} busy={busy} history={history} ctx={ctx}
      onSend={onSend} onStop={stop} onOptions={(o) => void setOptions(o)} onAppCommand={appCommand} draft={draft} onDraftTaken={() => setDraft(undefined)} />
  );

  if (items === null) return null;
  return (
    <div className="relative flex h-full min-h-0 flex-col"
      onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "f") { e.preventDefault(); appCommand("find"); } }}>
      {find && (
        <div className="absolute right-4 top-2 z-30 flex items-center gap-1 rounded-full bg-white py-1 pl-3 pr-1 shadow-[0_0_0_1px_rgba(0,0,0,0.06),0_4px_16px_rgba(0,0,0,0.1)] dark:bg-zinc-800 dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08),0_4px_16px_rgba(0,0,0,0.4)]">
          <input ref={findRef} value={find.q} placeholder={t("achat.find")} onChange={(e) => setFind({ q: e.target.value, idx: 0, n: find.n })}
            onKeyDown={(e) => { if (e.key === "Enter") setFind({ ...find, idx: find.n ? (find.idx + (e.shiftKey ? find.n - 1 : 1)) % find.n : 0 }); else if (e.key === "Escape") setFind(null); }}
            className="w-40 bg-transparent text-[13px] text-zinc-800 outline-none placeholder:text-zinc-400 dark:text-zinc-100" />
          <span className="min-w-[36px] text-right text-[11.5px] tabular-nums text-zinc-400">{find.q ? `${find.n ? find.idx + 1 : 0}/${find.n}` : ""}</span>
          <button type="button" className={iconBtn} aria-label="prev" onClick={() => setFind({ ...find, idx: find.n ? (find.idx + find.n - 1) % find.n : 0 })}><IconChevronUp size={14} /></button>
          <button type="button" className={iconBtn} aria-label="next" onClick={() => setFind({ ...find, idx: find.n ? (find.idx + 1) % find.n : 0 })}><IconChevronDown size={14} /></button>
          <button type="button" className={iconBtn} aria-label={t("achat.close")} onClick={() => setFind(null)}><IconX size={14} /></button>
        </div>
      )}
      <div ref={scrollRef} onScroll={(e) => { const el = e.currentTarget; const b = el.scrollHeight - el.scrollTop - el.clientHeight < 40; stick.current = b; setAtBottom(b); }}
        className="nunopi-scroll min-h-0 flex-1 overflow-y-auto">
        {empty ? (
          // 빈 채팅 — 입력 카드는 늘 아래, 가운데엔 아이콘 원 + 제목 + 부제
          <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
            <span className="flex size-12 items-center justify-center rounded-full bg-mustard-500/10 text-mustard-600 dark:bg-mustard-400/10 dark:text-mustard-400"><IconMessageCircle size={24} stroke={1.6} aria-hidden /></span>
            <p className="text-sm font-medium text-zinc-800 dark:text-zinc-100">{t("achat.emptyTitle", { agent: P(meta.provider).label })}</p>
            <p className="max-w-sm text-balance text-xs text-zinc-500 dark:text-zinc-400">{t("achat.emptySub", { agent: P(meta.provider).label })}</p>
          </div>
        ) : (
          <div className={`${COL} flex flex-col gap-5 pb-5 pt-10`}>
            {rows.map((r) => r.k === "tools" ? toolGroup(r.ids)
              : r.k === "fold" ? (
                <button key={r.key} type="button" onClick={() => toggle(r.key)}
                  className="flex min-h-8 items-center gap-1.5 border-b border-black/[.07] text-[13px] text-zinc-500 transition hover:text-zinc-800 dark:border-white/[.07] dark:text-zinc-400 dark:hover:text-zinc-200">
                  <IconChevronRight size={13} stroke={2} className="shrink-0" aria-hidden />
                  {r.ms != null ? t("achat.workedFor", { t: secs(r.ms) }) : t("achat.done")}{r.tools ? ` · ${t("achat.sum.other", { n: r.tools })}` : ""}
                </button>)
              : render(items[r.i], r.i))}
            {streaming && <div className="max-w-full text-sm leading-relaxed text-zinc-800 dark:text-zinc-100"><Markdown>{streaming}</Markdown></div>}
            {busy && !streaming && <span className="mustard-shimmer self-start text-[13px] tabular-nums text-zinc-500 dark:text-zinc-400">{t("achat.working")} {busySince ? secs(Math.max(0, (now || busySince) - busySince)) : ""}</span>}
          </div>
        )}
      </div>
      <div className={`relative ${COL} shrink-0 pb-4 pt-2`}>
        <div className="pointer-events-none absolute inset-x-0 -top-10 h-10 bg-gradient-to-t from-white to-transparent dark:from-[var(--s-pane)]" aria-hidden />
        {!atBottom && !empty && (
          <button type="button" onClick={toBottom} aria-label={t("achat.toBottom")}
            className="absolute -top-10 left-1/2 z-10 flex size-8 -translate-x-1/2 items-center justify-center rounded-full border border-black/[.08] bg-white text-zinc-600 transition hover:text-zinc-900 dark:border-white/[.1] dark:bg-zinc-800 dark:text-zinc-300 dark:hover:text-white">
            <IconChevronDown size={16} stroke={2} aria-hidden />
          </button>
        )}
        {/* 대기열 — 카드 하나(머리: 대기 N개·모두 지우기), 쉬면 위에서부터 하나씩 보냄 */}
        {queue.length > 0 && (
          <div className="mb-2 divide-y divide-black/[.06] overflow-hidden rounded-lg border border-black/[.09] bg-white text-[13px] dark:divide-white/[.06] dark:border-white/[.09] dark:bg-white/[.03]">
            <div className="flex items-center px-3 py-1.5 text-xs text-zinc-500 dark:text-zinc-400">
              <span className="mr-auto">{t("achat.queuedN", { n: queue.length })}</span>
              <button type="button" onClick={() => setQueue([])} className="rounded px-1.5 py-0.5 hover:bg-black/[.05] hover:text-zinc-800 dark:hover:bg-white/[.08] dark:hover:text-zinc-200">{t("achat.clearQueue")}</button>
            </div>
            {queue.map((q) => (
              <div key={q.id} className="flex items-center gap-2 py-1 pl-3 pr-1 text-zinc-700 dark:text-zinc-300">
                <span className="min-w-0 flex-1 truncate">{q.text || "🖼"}</span>
                <button type="button" className={iconBtn} title={t("achat.edit")} aria-label={t("achat.edit")} onClick={() => { setQueue((x) => x.filter((y) => y.id !== q.id)); setDraft(q.text); }}><IconPencil size={13} stroke={1.8} /></button>
                <button type="button" onClick={() => { setQueue((x) => x.filter((y) => y.id !== q.id)); void sendNow(q.text, q.images); }}
                  className="flex h-6 items-center gap-1 rounded-md px-2 text-xs text-zinc-600 hover:bg-black/[.05] dark:text-zinc-300 dark:hover:bg-white/[.08]"><IconSend size={12} stroke={1.8} aria-hidden />{t("achat.sendNow")}</button>
                <button type="button" className={iconBtn} title={t("achat.removeQueued")} aria-label={t("achat.removeQueued")} onClick={() => setQueue((x) => x.filter((y) => y.id !== q.id))}><IconX size={13} stroke={2} /></button>
              </div>
            ))}
          </div>
        )}
        {note && <p className="mb-1.5 px-1 text-xs text-red-600 dark:text-red-400">{note}</p>}
        {meta.handedOff && (
          <div className="mb-2 flex items-center gap-2 rounded-lg border border-mustard-400/40 bg-mustard-500/[.06] px-3 py-2 text-xs text-zinc-700 dark:text-zinc-300">
            <IconTerminal2 size={14} stroke={1.8} className="shrink-0 text-mustard-600 dark:text-mustard-400" aria-hidden />
            <span className="min-w-0 flex-1">{t("achat.handedOffBanner")}</span>
            <button type="button" onClick={async () => { const r = await post("/api/chat/sessions", { root, op: "resume-here", id }); if (r?.ok && r.chat) onMeta(r.chat as Meta); }}
              className="shrink-0 rounded-md px-2 py-0.5 font-medium text-mustard-700 hover:bg-mustard-500/10 dark:text-mustard-300">{t("achat.resumeHere")}</button>
          </div>
        )}
        {/* 권한 묻기 — 입력 카드 자리에 카드로(답하면 타임라인엔 한 줄 기록). Esc = 거절 */}
        {pendingPerm ? (
          <div className="rounded-lg border border-black/[.11] bg-white px-4 py-3 shadow-xs dark:border-white/[.09] dark:bg-white/[.04]" tabIndex={-1}
            onKeyDown={(e) => { if (e.key === "Escape") answer(pendingPerm.id, false); }}>
            <div className="flex items-center gap-2 text-sm font-medium text-zinc-800 dark:text-zinc-100"><IconShieldQuestion size={16} stroke={1.6} className="text-mustard-600 dark:text-mustard-400" aria-hidden />{t("achat.permAsk", { tool: pendingPerm.tool })}</div>
            <code className="nunopi-scroll mt-2 block max-h-28 overflow-auto whitespace-pre-wrap break-all rounded-md bg-black/[.04] px-2.5 py-1.5 font-mono text-xs text-zinc-600 dark:bg-white/[.05] dark:text-zinc-300">{toolSummary(pendingPerm.input) || pendingPerm.input}</code>
            <div className="mt-3 flex gap-2">
              <button type="button" autoFocus onClick={() => answer(pendingPerm.id, true)} className="rounded-md bg-zinc-900 px-4 py-1.5 text-sm font-semibold text-white transition hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white">{t("achat.allow")}</button>
              <button type="button" onClick={() => answer(pendingPerm.id, false)} className="rounded-md border border-black/[.11] px-4 py-1.5 text-sm font-semibold text-zinc-700 transition hover:bg-black/[.04] dark:border-white/[.12] dark:text-zinc-200 dark:hover:bg-white/[.06]">{t("achat.deny")} <span className="ml-1 text-xs font-normal text-zinc-400">Esc</span></button>
            </div>
          </div>
        ) : composer}
        {/* 상태 줄 — 기기 · 폴더(워크트리) · 브랜치, 누르면 복사, 좁으면 기기부터 숨김 */}
        {where && (
          <div className="mt-1 flex h-[22px] min-w-0 items-center gap-3 px-3 text-[11px] text-zinc-500 dark:text-zinc-400">
            {where.host && <button type="button" onClick={() => copy("host", where.host)} title={where.host} className="hidden min-w-0 items-center gap-1 hover:text-zinc-800 sm:flex dark:hover:text-zinc-200"><IconServer size={12} stroke={1.8} className="shrink-0" aria-hidden /><span className="truncate">{copied === "host" ? t("achat.copied") : where.host}</span></button>}
            <button type="button" onClick={() => copy("folder", root)} title={root} className="flex min-w-0 items-center gap-1 hover:text-zinc-800 dark:hover:text-zinc-200"><IconFolder size={12} stroke={1.8} className="shrink-0" aria-hidden /><span className="truncate">{copied === "folder" ? t("achat.copied") : where.folder}</span><span className="shrink-0 text-zinc-400 dark:text-zinc-500">· {t(where.worktree ? "achat.whereWorktree" : "achat.whereFolder")}</span></button>
            {where.branch && <button type="button" onClick={() => copy("branch", where.branch)} title={where.branch} className="flex min-w-0 items-center gap-1 hover:text-zinc-800 dark:hover:text-zinc-200"><IconGitBranch size={12} stroke={1.8} className="shrink-0" aria-hidden /><span className="truncate font-mono">{copied === "branch" ? t("achat.copied") : where.branch}</span></button>}
          </div>
        )}
      </div>
    </div>
  );
}
