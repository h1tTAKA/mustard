"use client";
/* eslint-disable @next/next/no-img-element -- 로컬 API 이미지(최적화 불필요, 데스크톱 오프라인) */
// 채팅 한 세션 화면(#1341) — 타임라인(SSE) + 입력 카드(ChatComposer).
// 도구는 카드 없이 흐린 한 줄(연달으면 한 문장 요약으로 묶음), 진행은 글자 위 빛(mustard-shimmer), 실패만 빨간 배지.
// 끝난 턴은 '내 말 · N초 동안 작업 › · 마지막 답'으로 접힘(펼치기 가능). 일하는 중 보낸 말은 대기열(쉬면 하나씩 보냄).
// ⌘F 찾기(CSS 하이라이트), 내 말 hover = 복사·다시 보내기·고쳐 쓰기, 답 hover = 복사, 코드 블록 hover = 복사.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { IconX, IconChevronRight, IconChevronDown, IconChevronUp, IconShieldQuestion, IconAlertTriangle, IconCopy, IconRefresh, IconPencil, IconCheck, IconSend } from "@tabler/icons-react";
import { useT, Markdown } from "@mustard/core";
import type { ChatItem } from "@/lib/chat/chatTimeline";
import ChatComposer, { post, type AppCommand, type Img, type Meta, type PROVIDERS } from "@/components/workspace/ChatComposer";

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
const COL = "mx-auto w-full max-w-3xl px-5";
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

  const sendNow = useCallback(async (text: string, images: Img[]) => {
    stick.current = true; setNote("");
    const r = await post("/api/chat/send", { root, id, text, images: images.map(({ base64, mime }) => ({ base64, mime })) });
    if (!r?.ok && r?.error) setNote(String(r.error));
  }, [root, id]);
  // 일하는 중이면 대기열(⌘Enter면 바로) — 쉬게 되면 맨 앞 하나를 보냄
  const onSend = (text: string, images: Img[], immediate: boolean) => {
    if (busy && !immediate) { setQueue((q) => [...q, { id: ++qid.current, text, images }]); return; }
    void sendNow(text, images);
  };
  useEffect(() => {
    if (busy || !queue.length || items === null) return;
    const [head, ...rest] = queue;
    setQueue(rest); // eslint-disable-line react-hooks/set-state-in-effect -- 쉬게 되면 대기열 맨 앞을 보냄
    void sendNow(head.text, head.images);
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

  const iconBtn = "flex size-7 items-center justify-center rounded-lg text-zinc-400 transition hover:bg-black/[.05] hover:text-zinc-700 dark:text-zinc-500 dark:hover:bg-white/[.08] dark:hover:text-zinc-200";
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
          className="group/row flex min-w-0 items-center gap-1.5 py-0.5 text-left text-[13.5px] text-zinc-500 transition hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-100">
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
          {it.images?.length ? <div className="flex flex-wrap justify-end gap-2">{it.images.map((n) => <img key={n} src={imgUrl(n)} alt="" className="max-h-48 rounded-[20px] ring-1 ring-inset ring-black/[.08] dark:ring-white/[.08]" />)}</div> : null}
          {it.text && <div className="max-w-[77%] whitespace-pre-wrap break-words rounded-[20px] bg-black/[.05] px-3.5 py-2 text-[14px] leading-relaxed text-zinc-800 dark:bg-white/[.08] dark:text-zinc-100">{it.text}</div>}
          <div className="flex gap-0.5 opacity-0 transition group-hover/msg:opacity-100 focus-within:opacity-100">
            <button type="button" className={iconBtn} title={t("achat.copy")} aria-label={t("achat.copy")} onClick={() => copy(`u${i}`, it.text)}>{copied === `u${i}` ? <IconCheck size={14} stroke={2} /> : <IconCopy size={14} stroke={1.8} />}</button>
            <button type="button" className={iconBtn} title={t("achat.edit")} aria-label={t("achat.edit")} onClick={() => setDraft(it.text)}><IconPencil size={14} stroke={1.8} /></button>
            <button type="button" className={iconBtn} title={t("achat.retry")} aria-label={t("achat.retry")} onClick={() => onSend(it.text, [], false)}><IconRefresh size={14} stroke={1.8} /></button>
          </div>
        </div>);
      case "text": return (
        <div key={i} className="group/msg flex flex-col gap-0.5">
          <div className="max-w-full text-[14px] leading-relaxed text-zinc-800 dark:text-zinc-100"><Markdown copyCode>{it.text}</Markdown></div>
          <div className="-ml-1.5 flex opacity-0 transition group-hover/msg:opacity-100 focus-within:opacity-100">
            <button type="button" className={iconBtn} title={t("achat.copy")} aria-label={t("achat.copy")} onClick={() => copy(`a${i}`, it.text)}>{copied === `a${i}` ? <IconCheck size={14} stroke={2} /> : <IconCopy size={14} stroke={1.8} />}</button>
          </div>
        </div>);
      case "tool": return null;
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

  const composer = (
    <ChatComposer root={root} meta={meta} providers={providers} busy={busy} empty={empty} history={history} ctx={ctx}
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
      {empty ? (
        <div className="flex h-full flex-col items-center justify-center pb-[14vh]">
          <div className="mx-auto w-full max-w-[790px] px-5">
            <h2 className="mb-7 text-center text-[26px] font-normal tracking-tight text-zinc-800 dark:text-zinc-100">{t("achat.emptySession")}</h2>
            {composer}
            {note && <p className="mt-2 text-center text-[12.5px] text-red-600 dark:text-red-400">{note}</p>}
          </div>
        </div>
      ) : (
        <>
          <div ref={scrollRef} onScroll={(e) => { const el = e.currentTarget; const b = el.scrollHeight - el.scrollTop - el.clientHeight < 40; stick.current = b; setAtBottom(b); }}
            className="nunopi-scroll min-h-0 flex-1 overflow-y-auto">
            <div className={`${COL} flex flex-col gap-4 pb-8 pt-6`}>
              {rows.map((r) => r.k === "tools" ? toolGroup(r.ids)
                : r.k === "fold" ? (
                  <button key={r.key} type="button" onClick={() => toggle(r.key)}
                    className="group/row flex items-center gap-1.5 self-start py-0.5 text-[13.5px] text-zinc-400 transition hover:text-zinc-700 dark:text-zinc-500 dark:hover:text-zinc-200">
                    {r.ms != null ? t("achat.workedFor", { t: secs(r.ms) }) : t("achat.done")}{r.tools ? ` · ${t("achat.sum.other", { n: r.tools })}` : ""}
                    <IconChevronRight size={12} stroke={2} className="opacity-0 transition group-hover/row:opacity-100" aria-hidden />
                  </button>)
                : render(items[r.i], r.i))}
              {streaming && <div className="max-w-full text-[14px] leading-relaxed text-zinc-800 dark:text-zinc-100"><Markdown>{streaming}</Markdown></div>}
              {busy && !streaming && <span className="mustard-shimmer self-start text-[13.5px] tabular-nums text-zinc-500 dark:text-zinc-400">{t("achat.working")} {busySince ? secs(Math.max(0, (now || busySince) - busySince)) : ""}</span>}
            </div>
          </div>
          <div className="relative mx-auto w-full max-w-[790px] shrink-0 px-5 pb-4">
            <div className="pointer-events-none absolute inset-x-0 -top-12 h-12 bg-gradient-to-t from-white to-transparent dark:from-[var(--s-pane)]" aria-hidden />
            {!atBottom && (
              <button type="button" onClick={toBottom} aria-label={t("achat.toBottom")}
                className="absolute -top-11 left-1/2 z-10 flex size-8 -translate-x-1/2 items-center justify-center rounded-full border border-black/[.08] bg-white text-zinc-600 transition hover:text-zinc-900 dark:border-white/[.1] dark:bg-zinc-800 dark:text-zinc-300 dark:hover:text-white">
                <IconChevronDown size={16} stroke={2} aria-hidden />
              </button>
            )}
            {/* 대기열 — 쉬면 위에서부터 하나씩 보냄. [고쳐 쓰기]는 입력창으로, [지금 보내기]는 일하는 중에도 바로 */}
            {queue.length > 0 && (
              <div className="mb-2 flex flex-col gap-1">
                {queue.map((q) => (
                  <div key={q.id} className="flex items-center gap-2 rounded-2xl bg-black/[.04] py-1 pl-3.5 pr-1 text-[13px] text-zinc-600 dark:bg-white/[.06] dark:text-zinc-300">
                    <span className="shrink-0 text-[11.5px] text-zinc-400 dark:text-zinc-500">{t("achat.queued")}</span>
                    <span className="min-w-0 flex-1 truncate">{q.text || "🖼"}</span>
                    <button type="button" className={iconBtn} title={t("achat.edit")} aria-label={t("achat.edit")} onClick={() => { setQueue((x) => x.filter((y) => y.id !== q.id)); setDraft(q.text); }}><IconPencil size={13} stroke={1.8} /></button>
                    <button type="button" className={iconBtn} title={t("achat.sendNow")} aria-label={t("achat.sendNow")} onClick={() => { setQueue((x) => x.filter((y) => y.id !== q.id)); void sendNow(q.text, q.images); }}><IconSend size={13} stroke={1.8} /></button>
                    <button type="button" className={iconBtn} title={t("achat.removeQueued")} aria-label={t("achat.removeQueued")} onClick={() => setQueue((x) => x.filter((y) => y.id !== q.id))}><IconX size={13} stroke={2} /></button>
                  </div>
                ))}
              </div>
            )}
            {note && <p className="mb-1.5 text-[12.5px] text-red-600 dark:text-red-400">{note}</p>}
            {composer}
          </div>
        </>
      )}
    </div>
  );
}
