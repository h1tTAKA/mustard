"use client";
/* eslint-disable @next/next/no-img-element -- 붙여넣기 data URL 미리보기(최적화 불필요) */
// 채팅 입력 카드(#1341) — 겹 그림자 카드 안에 글·첨부, 아래 줄 = [+첨부][실행 AI·모델·생각 강도][권한 모드] … [컨텍스트][보내기/멈춤].
// `/` 로 시작하면 명령 메뉴(앱 명령 + 내 커맨드·스킬), `@` 뒤엔 레포 파일 자동완성, 빈 입력에서 ↑↓ = 보낸 말 다시 불러오기.
// Enter 보내기(일하는 중이면 대기열), ⌘Enter = 일하는 중에도 바로 보내기, Shift+Enter 줄바꿈, Shift+Tab 권한 모드 바꾸기, Esc 멈춤.
// 받아쓰기(macOS 음성 인식, main 도우미): 마이크 버튼·⌘D. 누르면 켜고 끄기, 0.5초 넘게 누르고 있으면 누르고 말하기(떼면 확정).
// 받아쓰는 동안 아래 줄은 [파형][✕][✓], 글은 커서 자리에 실시간으로 들어감(자동 전송 안 함). Enter·✓ = 확정, Esc·✕ = 받아쓴 글만 되돌림.
import { useEffect, useMemo, useRef, useState } from "react";
import { IconPlus, IconX, IconArrowUp, IconPlayerStopFilled, IconChevronDown, IconCheck, IconShield, IconShieldCheck, IconListCheck, IconMicrophone } from "@tabler/icons-react";
import { useT, useLocale } from "@mustard/core";
import { AgentLogo, type AgentId } from "@/components/workspace/AgentLogo";

export type Provider = "claude-code" | "codex" | "opencode" | "grok" | "cursor";
export type Mode = "plan" | "default" | "full";
export interface Meta { id: string; title: string; provider: Provider; model: string; effort?: number; mode: Mode; createdAt: number; updatedAt: number; busy: boolean; archived: boolean; count: number; cc?: string }
export const PROVIDERS: { id: Provider; agent: AgentId; label: string }[] = [
  { id: "claude-code", agent: "claude", label: "Claude Code" }, { id: "codex", agent: "codex", label: "Codex" },
  { id: "opencode", agent: "opencode", label: "OpenCode" }, { id: "grok", agent: "grok", label: "Grok" }, { id: "cursor", agent: "cursor", label: "Cursor" },
];
export const P = (id: Provider) => PROVIDERS.find((p) => p.id === id) ?? PROVIDERS[0];
export const post = (url: string, body: unknown) => fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json()).catch(() => ({ ok: false }));
export type Img = { base64: string; mime: string; url: string };
// 앱이 직접 처리하는 명령(에이전트에 안 보냄)
export const APP_COMMANDS = ["new", "model", "mode", "history", "terminal", "find"] as const;
export type AppCommand = (typeof APP_COMMANDS)[number];
// 생각 강도·권한 모드 이름은 어느 언어든 영어 그대로(CLI 용어와 같게, 유저 결정 11-14). SNA reasoningLevel 1~5 = low·medium·high·xhigh·max
const EFFORTS: { v: number | undefined; label: string }[] = [{ v: undefined, label: "Auto" }, { v: 1, label: "Low" }, { v: 2, label: "Medium" }, { v: 3, label: "High" }, { v: 4, label: "XHigh" }, { v: 5, label: "Max" }];
const MODE_LABEL: Record<Mode, string> = { default: "Default", plan: "Plan", full: "Full access" };
const MODE_ICON = { plan: IconListCheck, default: IconShield, full: IconShieldCheck };

type Menu = { kind: "slash"; q: string } | { kind: "file"; q: string; at: number } | null;
type Dict = { phase: "starting" | "listening"; before: string; after: string; text: string };
const nowMs = () => Date.now(); // 이벤트 처리기 안에서만 부름
const DICT_LOCALE: Record<string, string> = { ko: "ko-KR", ja: "ja-JP", en: "en-US" };
// 받아쓴 글 끼우기 — 중국어·일본어 글자 사이와 구두점 앞엔 띄어쓰기 안 넣음(한국어·영어는 넣음)
const NO_SPACE = /[\u3040-\u30ff\u3400-\u9fff\uff00-\uffef]/;
export function joinDictation(before: string, text: string, after: string): string {
  if (!text) return before + after;
  const a = before && !/\s$/.test(before) && !NO_SPACE.test(before.slice(-1)) && !NO_SPACE.test(text[0]) ? " " : "";
  const b = after && !/^[\s.,!?;:)\]}]/.test(after) && !NO_SPACE.test(after[0]) && !NO_SPACE.test(text.slice(-1)) ? " " : "";
  return before + a + text + b + after;
}
// 파형 — 최근 소리 크기 막대(오른쪽이 지금), 양 끝은 흐리게
function Wave({ levels }: { levels: number[] }) {
  const N = 40, bars = [...Array(Math.max(0, N - levels.length)).fill(0), ...levels.slice(-N)];
  return (
    <svg viewBox={`0 0 ${N * 7} 20`} className="h-5 min-w-[min(7rem,20vw)] flex-1 text-zinc-400 dark:text-zinc-500" preserveAspectRatio="xMaxYMid meet" aria-hidden
      style={{ maskImage: "linear-gradient(90deg, transparent, #000 15%, #000 90%, transparent)" }}>
      {bars.map((v, i) => { const h = Math.max(2, Math.min(20, v * 20)); return <rect key={i} x={i * 7 + 2.5} y={(20 - h) / 2} width={2} height={h} rx={1} fill="currentColor" />; })}
    </svg>
  );
}

export default function ChatComposer({ root, meta, providers, busy, empty, history, ctx, onSend, onStop, onOptions, onAppCommand, draft, onDraftTaken }: {
  root: string; meta: Meta; providers: typeof PROVIDERS; busy: boolean; empty: boolean; history: string[]; ctx?: { used: number; win: number };
  onSend: (text: string, images: Img[], now: boolean) => void; onStop: () => void; onOptions: (o: Partial<Pick<Meta, "provider" | "model" | "effort" | "mode">>) => void; onAppCommand: (c: AppCommand) => void;
  draft?: string; onDraftTaken?: () => void;
}) {
  const t = useT();
  const [input, setInput] = useState("");
  const [images, setImages] = useState<Img[]>([]);
  const [note, setNote] = useState("");
  const [picker, setPicker] = useState(false);
  const [models, setModels] = useState<{ id: string; label: string }[] | null>(null);
  const [menu, setMenu] = useState<Menu>(null);
  const [sel, setSel] = useState(0);
  const [commands, setCommands] = useState<{ name: string; description: string; source: string }[]>([]);
  const [files, setFiles] = useState<string[]>([]);
  const recall = useRef(-1);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const locked = meta.count > 0;
  const cur = P(meta.provider);
  const { locale } = useLocale();
  const [canDictate, setCanDictate] = useState(false);
  const [dict, setDict] = useState<Dict | null>(null);
  const [levels, setLevels] = useState<number[]>([]);
  const [noteAction, setNoteAction] = useState<null | (() => void)>(null);
  const dictRef = useRef<Dict | null>(null);
  const pressAt = useRef(0);
  const stoppingRef = useRef(false); // 확정·취소를 눌러서 끝난 건 오류로 안 보여 줌
  const heardAt = useRef(0);
  const startedAt = useRef(0);
  useEffect(() => { void window.nunopiDesktop?.dictation?.available().then(setCanDictate).catch(() => {}); }, []);
  const endDict = (finalText: string | null) => {
    const d = dictRef.current;
    dictRef.current = null; setDict(null); setLevels([]);
    if (d) setInput(joinDictation(d.before, finalText ?? "", d.after));
    taRef.current?.focus();
  };
  // 도우미 이벤트 — 받아쓰는 중인 입력 카드만 반응(다른 레포 칸의 카드는 dictRef가 비어 있음)
  useEffect(() => {
    const api = window.nunopiDesktop?.dictation;
    if (!api) return;
    return api.onEvent((e) => {
      const d = dictRef.current;
      if (!d) return;
      if (e.type === "ready") { const n = { ...d, phase: "listening" as const }; dictRef.current = n; setDict(n); }
      else if (e.type === "level") setLevels((l) => [...l.slice(-60), e.v ?? 0]);
      else if (e.type === "partial") { const n = { ...d, text: e.text ?? "" }; dictRef.current = n; setDict(n); heardAt.current = Date.now(); }
      else if (e.type === "final") endDict(e.text ?? d.text);
      else if (e.type === "end") { endDict(d.text); if (e.code !== 0 && !stoppingRef.current) setNote(t("achat.dictFail", { m: `helper exited (${e.code}${e.signal ? ` ${e.signal}` : ""})` })); }
      else if (e.type === "error") {
        endDict(d.text);
        const denied = String(e.code).startsWith("denied");
        setNote(denied ? t("achat.dictDenied") : t("achat.dictFail", { m: e.message ?? String(e.code ?? "") }));
        setNoteAction(denied ? () => () => void window.nunopiDesktop?.dictation?.openSettings(e.code === "denied-speech" ? "speech" : "mic") : null);
      }
    });
  }, [t]);
  // 60초 동안 말이 없거나 10분이 차면 확정하고 멈춤
  useEffect(() => {
    if (!dict) return;
    const iv = setInterval(() => { const now = Date.now(); if (now - heardAt.current > 60_000 || now - startedAt.current > 600_000) void window.nunopiDesktop?.dictation?.stop(); }, 1000);
    return () => clearInterval(iv);
  }, [dict]);
  useEffect(() => () => { if (dictRef.current) void window.nunopiDesktop?.dictation?.cancel(); }, []); // 탭을 떠나면 버림
  const startDict = async () => {
    const api = window.nunopiDesktop?.dictation;
    if (!api || dictRef.current) return;
    const caret = taRef.current?.selectionStart ?? input.length;
    const d: Dict = { phase: "starting", before: input.slice(0, caret), after: input.slice(caret), text: "" };
    dictRef.current = d; setDict(d); setLevels([]); setNote(""); setNoteAction(null); setMenu(null); stoppingRef.current = false;
    heardAt.current = startedAt.current = nowMs();
    const r = await api.start(DICT_LOCALE[locale] ?? "en-US");
    if (!r.ok) { endDict(null); setNote(t("achat.dictFail", { m: r.error ?? "" })); }
  };
  const stopDict = () => { stoppingRef.current = true; void window.nunopiDesktop?.dictation?.stop(); };
  const cancelDict = () => { if (!dictRef.current) return; stoppingRef.current = true; endDict(null); void window.nunopiDesktop?.dictation?.cancel(); };

  useEffect(() => { taRef.current?.focus(); }, [meta.id]);
  // 편집(내 말 다시 쓰기)·대기열 편집으로 넘어온 글
  useEffect(() => { if (draft != null) { setInput(draft); onDraftTaken?.(); taRef.current?.focus(); } }, [draft, onDraftTaken]); // eslint-disable-line react-hooks/set-state-in-effect -- 바깥에서 넘긴 글을 입력창으로
  // 실행 AI가 바뀌면 그 모델 목록·커맨드
  useEffect(() => {
    let alive = true;
    setModels(null); // eslint-disable-line react-hooks/set-state-in-effect -- 실행 AI 바뀌면 목록 다시
    void fetch(`/api/chat/models?provider=${meta.provider}`).then((r) => r.json()).then((j) => { if (alive) setModels(j.models ?? []); }).catch(() => { if (alive) setModels([]); });
    void fetch(`/api/chat/commands?root=${encodeURIComponent(root)}&provider=${meta.provider}`).then((r) => r.json()).then((j) => { if (alive) setCommands(j.commands ?? []); }).catch(() => {});
    return () => { alive = false; };
  }, [meta.provider, root]);
  // @파일 — 입력이 멈추면 찾기
  useEffect(() => {
    if (menu?.kind !== "file") return;
    const q = menu.q;
    const tm = setTimeout(() => { void fetch(`/api/chat/files?root=${encodeURIComponent(root)}&q=${encodeURIComponent(q)}`).then((r) => r.json()).then((j) => setFiles(j.files ?? [])).catch(() => {}); }, 120);
    return () => clearTimeout(tm);
  }, [menu, root]);

  const appCmd = useMemo(() => APP_COMMANDS.map((c) => ({ name: c, description: t(`achat.cmd.${c}`), source: "app" })), [t]);
  const options = menu?.kind === "slash"
    ? [...appCmd, ...commands].filter((c) => c.name.toLowerCase().includes(menu.q.toLowerCase())).slice(0, 50)
    : menu?.kind === "file" ? files.map((f) => ({ name: f, description: "", source: "file" })) : [];

  // 입력이 바뀔 때 메뉴 판단 — 맨 앞 `/단어` 또는 커서 앞 `@단어`
  const onChange = (v: string, caret: number) => {
    setInput(v); recall.current = -1;
    const slash = /^\/([\w:.-]*)$/.exec(v);
    const at = /(^|\s)@([^\s@]*)$/.exec(v.slice(0, caret));
    if (slash) { setMenu({ kind: "slash", q: slash[1] }); setSel(0); }
    else if (at) { setMenu({ kind: "file", q: at[2], at: caret - at[2].length - 1 }); setSel(0); }
    else setMenu(null);
  };
  const pick = (name: string, source: string) => {
    if (menu?.kind === "slash") {
      setMenu(null);
      if (source === "app") { setInput(""); if (name === "model") setPicker(true); else if (name === "mode") cycleMode(); else onAppCommand(name as AppCommand); return; }
      setInput(`/${name} `);
    } else if (menu?.kind === "file") {
      const before = input.slice(0, menu.at), after = input.slice(menu.at).replace(/^@[^\s@]*/, "");
      setInput(`${before}@${name} ${after.trimStart()}`); setMenu(null);
    }
    taRef.current?.focus();
  };
  const send = (now: boolean) => {
    const text = input.trim();
    if (!text && !images.length) return;
    onSend(text, images, now);
    setInput(""); setImages([]); setNote(""); setMenu(null); recall.current = -1;
  };
  const cycleMode = () => {
    const modes: Mode[] = meta.provider === "claude-code" ? ["default", "plan", "full"] : ["default", "full"];
    onOptions({ mode: modes[(modes.indexOf(meta.mode) + 1) % modes.length] });
  };
  const addFiles = (fs: File[]) => {
    for (const f of fs.filter((x) => x.type.startsWith("image/"))) {
      if (f.size > 5 * 1024 * 1024) { setNote(t("achat.imageTooBig")); continue; }
      const rd = new FileReader();
      rd.onload = () => { const url = String(rd.result); setImages((p) => [...p, { url, mime: f.type, base64: url.slice(url.indexOf(",") + 1) }]); };
      rd.readAsDataURL(f);
    }
  };
  const onKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing) return;
    const modD = (e.metaKey || e.ctrlKey) && e.code === "KeyD";
    if (dict) { // 받아쓰는 중 — Enter·⌘D 확정, Esc 취소, 나머지 키는 막음(글은 도우미가 씀)
      if (e.key === "Enter" || modD) { e.preventDefault(); stopDict(); }
      else if (e.key === "Escape") { e.preventDefault(); cancelDict(); }
      else if (!e.metaKey) e.preventDefault();
      return;
    }
    if (modD && canDictate) { e.preventDefault(); void startDict(); return; }
    if (menu && options.length) {
      if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => (s + 1) % options.length); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => (s - 1 + options.length) % options.length); return; }
      if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); const o = options[Math.min(sel, options.length - 1)]; pick(o.name, o.source); return; }
      if (e.key === "Escape") { e.preventDefault(); setMenu(null); return; }
    }
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(e.metaKey || e.ctrlKey); return; }
    if (e.key === "Tab" && e.shiftKey) { e.preventDefault(); cycleMode(); return; }
    if (e.key === "Escape" && busy) { e.preventDefault(); onStop(); return; }
    // 빈 입력(또는 불러온 말 그대로)에서 ↑↓ = 보낸 말 회상
    if ((e.key === "ArrowUp" || e.key === "ArrowDown") && history.length && (!input || recall.current >= 0)) {
      e.preventDefault();
      const n = e.key === "ArrowUp" ? Math.min(history.length - 1, recall.current + 1) : recall.current - 1;
      recall.current = n;
      setInput(n < 0 ? "" : history[history.length - 1 - n]);
    }
  };

  const ghost = "flex h-7 items-center gap-1.5 rounded-full px-2 text-[13px] leading-[18px] text-zinc-500 transition hover:bg-black/[.06] hover:text-zinc-800 dark:text-zinc-400 dark:hover:bg-white/[.08] dark:hover:text-zinc-100";
  const pop = "absolute z-50 rounded-2xl bg-white p-1 shadow-[0_0_0_1px_rgba(0,0,0,0.06),0_8px_24px_rgba(0,0,0,0.12)] dark:bg-zinc-800 dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08),0_8px_24px_rgba(0,0,0,0.4)]";
  const where = empty ? "top-full mt-1.5" : "bottom-full mb-1.5";
  const modelLabel = models?.find((m) => m.id === meta.model)?.label ?? meta.model;
  const effortLabel = EFFORTS.find((e) => e.v === meta.effort)?.label ?? "Auto";
  const ModeIcon = MODE_ICON[meta.mode];
  const pct = ctx && ctx.win ? Math.min(100, Math.round((ctx.used / ctx.win) * 100)) : null;

  return (
    <div className="relative">
      {note && (
        <p className="mb-1.5 flex items-center gap-2 text-[12.5px] text-red-600 dark:text-red-400">
          <span onClick={() => { setNote(""); setNoteAction(null); }}>{note}</span>
          {noteAction && <button type="button" onClick={() => { noteAction(); setNote(""); setNoteAction(null); }} className="shrink-0 rounded-full bg-black/[.05] px-2 py-0.5 text-[12px] text-zinc-700 hover:bg-black/[.08] dark:bg-white/[.08] dark:text-zinc-200 dark:hover:bg-white/[.12]">{t("achat.openSettings")}</button>}
        </p>
      )}
      {/* `/`·`@` 메뉴 — 입력 카드 위(빈 채팅은 아래) */}
      {menu && options.length > 0 && (
        <div className={`${pop} inset-x-0 ${empty ? "top-full mt-1.5" : "bottom-full mb-1.5"} nunopi-scroll max-h-72 overflow-y-auto`}>
          {options.map((o, k) => (
            <button key={`${o.source}:${o.name}`} type="button" onMouseDown={(e) => { e.preventDefault(); pick(o.name, o.source); }} onMouseEnter={() => setSel(k)}
              className={`flex w-full items-baseline gap-2 rounded-xl px-3 py-1.5 text-left text-[13px] ${k === sel ? "bg-black/[.05] dark:bg-white/[.08]" : ""}`}>
              <span className="shrink-0 font-medium text-zinc-800 dark:text-zinc-100">{menu.kind === "slash" ? `/${o.name}` : o.name}</span>
              {o.description && <span className="min-w-0 truncate text-[12px] text-zinc-400 dark:text-zinc-500">{o.description}</span>}
              {o.source !== "app" && o.source !== "file" && <span className="ml-auto shrink-0 text-[11px] text-zinc-400 dark:text-zinc-500">{t(`achat.src.${o.source}`)}</span>}
            </button>
          ))}
        </div>
      )}
      <div className="rounded-[22px] bg-white shadow-[0_0_0_1px_rgba(0,0,0,0.06),0_2px_8px_rgba(0,0,0,0.05),0_4px_40px_4px_rgba(0,0,0,0.03)] dark:bg-zinc-800 dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08),0_4px_24px_rgba(0,0,0,0.3)]"
        onDragOver={(e) => { if ([...e.dataTransfer.items].some((i) => i.type.startsWith("image/"))) e.preventDefault(); }}
        onDrop={(e) => { const fs = [...e.dataTransfer.files]; if (fs.some((f) => f.type.startsWith("image/"))) { e.preventDefault(); addFiles(fs); } }}>
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
        <textarea ref={taRef} value={dict ? joinDictation(dict.before, dict.text, dict.after) : input} readOnly={!!dict} rows={1}
          placeholder={t(dict ? (dict.phase === "starting" ? "achat.connecting" : "achat.listening") : busy ? "achat.placeholderBusy" : "achat.placeholder")}
          onChange={(e) => onChange(e.target.value, e.target.selectionStart ?? e.target.value.length)}
          onPaste={(e) => { const fs = [...e.clipboardData.files]; if (fs.some((f) => f.type.startsWith("image/"))) { e.preventDefault(); addFiles(fs); } }}
          onKeyDown={onKey} onBlur={() => setTimeout(() => setMenu(null), 150)}
          className={`block max-h-[max(160px,40vh)] w-full resize-none bg-transparent px-4 pt-3.5 text-[14px] leading-5 text-zinc-800 outline-none [field-sizing:content] placeholder:text-zinc-400 dark:text-zinc-100 dark:placeholder:text-zinc-500 ${empty ? "min-h-[64px]" : "min-h-[40px]"}`} />
        {dict ? (
          <div className="flex w-full min-w-0 items-center justify-end gap-2 pb-2.5 pl-3.5 pr-3">
            <Wave levels={levels} />
            <button type="button" onClick={cancelDict} aria-label={t("achat.dictCancel")} title={`${t("achat.dictCancel")} (Esc)`} className={`${ghost} w-7 shrink-0 justify-center px-0`}><IconX size={15} stroke={2} aria-hidden /></button>
            <button type="button" onClick={stopDict} aria-label={t("achat.dictDone")} title={`${t("achat.dictDone")} (Enter)`}
              className="flex size-7 shrink-0 items-center justify-center rounded-full bg-mustard-500 text-white transition hover:bg-mustard-600 active:opacity-70"><IconCheck size={15} stroke={2.5} aria-hidden /></button>
          </div>
        ) : (
        <div className="flex items-center gap-0.5 pb-2.5 pl-2 pr-3">
          <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => { addFiles([...(e.target.files ?? [])]); e.target.value = ""; }} />
          <button type="button" onClick={() => fileRef.current?.click()} aria-label={t("achat.attach")} title={t("achat.attach")} className={`${ghost} w-7 justify-center px-0`}>
            <IconPlus size={16} stroke={1.8} aria-hidden />
          </button>
          {/* 실행 AI · 모델 · 생각 강도 — 한 알약, 누르면 고르기 */}
          <div className="relative min-w-0">
            <button type="button" onClick={() => setPicker((v) => !v)} className={`${ghost} min-w-0`} data-chat-picker>
              <AgentLogo agent={cur.agent} size={13} />
              <span className="min-w-0 truncate">{modelLabel}</span>
              {meta.effort !== undefined && <span className="shrink-0 text-zinc-400 dark:text-zinc-500">· {effortLabel}</span>}
              <IconChevronDown size={12} stroke={2} className="shrink-0" aria-hidden />
            </button>
            {picker && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setPicker(false)} aria-hidden />
                <div className={`${pop} left-0 ${where} nunopi-scroll max-h-[min(70vh,520px)] w-[260px] overflow-y-auto`}>
                  <p className="px-3 pb-1 pt-1.5 text-[11px] font-medium text-zinc-400 dark:text-zinc-500">{t("achat.pickAgent")}{locked && ` · ${t("achat.agentLocked")}`}</p>
                  {providers.map((p) => (
                    <button key={p.id} type="button" disabled={locked && p.id !== meta.provider} onClick={() => onOptions({ provider: p.id })}
                      className="flex w-full items-center gap-2 rounded-xl px-3 py-1.5 text-left text-[13px] text-zinc-700 transition hover:bg-black/[.05] disabled:opacity-35 disabled:hover:bg-transparent dark:text-zinc-200 dark:hover:bg-white/[.08]">
                      <AgentLogo agent={p.agent} size={14} />{p.label}
                      {p.id === meta.provider && <IconCheck size={14} stroke={2} className="ml-auto text-mustard-600 dark:text-mustard-400" aria-hidden />}
                    </button>
                  ))}
                  <div className="mx-2 my-1 border-t border-black/[.06] dark:border-white/[.08]" />
                  <p className="px-3 pb-1 pt-1 text-[11px] font-medium text-zinc-400 dark:text-zinc-500">{t("achat.pickModel")}</p>
                  {models === null ? <p className="px-3 py-1.5 text-[12px] text-zinc-400">…</p> : models.map((m) => (
                    <button key={m.id} type="button" onClick={() => { onOptions({ model: m.id }); setPicker(false); }}
                      className="flex w-full items-center gap-2 rounded-xl px-3 py-1.5 text-left text-[13px] text-zinc-700 transition hover:bg-black/[.05] dark:text-zinc-200 dark:hover:bg-white/[.08]">
                      <span className="min-w-0 truncate">{m.label}</span>
                      {m.id === meta.model && <IconCheck size={14} stroke={2} className="ml-auto shrink-0 text-mustard-600 dark:text-mustard-400" aria-hidden />}
                    </button>
                  ))}
                  <div className="mx-2 my-1 border-t border-black/[.06] dark:border-white/[.08]" />
                  <p className="px-3 pb-1 pt-1 text-[11px] font-medium text-zinc-400 dark:text-zinc-500">{t("achat.pickEffort")}</p>
                  <div className="flex gap-1 px-2 pb-1.5">
                    {EFFORTS.map((e) => (
                      <button key={e.label} type="button" onClick={() => onOptions({ effort: e.v })}
                        className={`flex-1 rounded-full px-1 py-1 text-[11.5px] transition ${meta.effort === e.v ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900" : "text-zinc-600 hover:bg-black/[.05] dark:text-zinc-300 dark:hover:bg-white/[.08]"}`}>{e.label}</button>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
          {/* 권한 모드 — 누르거나 Shift+Tab으로 바꿈 */}
          <button type="button" onClick={cycleMode} title={`${t(`achat.modeHint.${meta.mode}`)} (Shift+Tab)`}
            className={`${ghost} shrink-0 ${meta.mode === "full" ? "text-amber-600 dark:text-amber-400" : meta.mode === "plan" ? "text-sky-600 dark:text-sky-400" : ""}`}>
            <ModeIcon size={14} stroke={1.8} aria-hidden />{MODE_LABEL[meta.mode]}
          </button>
          <div className="ml-auto flex shrink-0 items-center gap-1.5">
            {pct !== null && (
              <span title={t("achat.ctx", { pct, used: Math.round(ctx!.used / 1000), win: Math.round(ctx!.win / 1000) })} className="flex items-center">
                <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden><circle cx="8" cy="8" r="6" fill="none" strokeWidth="2" className="stroke-black/[.08] dark:stroke-white/[.12]" /><circle cx="8" cy="8" r="6" fill="none" strokeWidth="2" strokeDasharray={`${(pct / 100) * 37.7} 37.7`} transform="rotate(-90 8 8)" strokeLinecap="round" className={pct > 85 ? "stroke-red-500" : pct > 60 ? "stroke-amber-500" : "stroke-zinc-400 dark:stroke-zinc-500"} /></svg>
              </span>
            )}
            {canDictate && (
              <button type="button" aria-label={t("achat.dictate")} title={`${t("achat.dictate")} (⌘D)`} className={`${ghost} w-7 justify-center px-0`}
                onPointerDown={() => { pressAt.current = Date.now(); void startDict(); }}
                onPointerUp={() => { if (Date.now() - pressAt.current > 500) stopDict(); }}>
                <IconMicrophone size={16} stroke={1.8} aria-hidden />
              </button>
            )}
            {busy && !input.trim() && !images.length
              ? <button type="button" onClick={onStop} aria-label={t("achat.stop")} title={`${t("achat.stop")} (Esc)`}
                  className="flex size-7 items-center justify-center rounded-full bg-zinc-900 text-white transition active:opacity-70 dark:bg-zinc-100 dark:text-zinc-900">
                  <IconPlayerStopFilled size={11} aria-hidden />
                </button>
              : <button type="button" onClick={() => send(false)} disabled={!input.trim() && !images.length} aria-label={t("achat.send")} title={busy ? t("achat.queueHint") : undefined}
                  className="flex size-7 items-center justify-center rounded-full bg-mustard-500 text-white transition hover:bg-mustard-600 active:opacity-70 disabled:bg-black/[.08] disabled:text-zinc-400 dark:disabled:bg-white/[.1] dark:disabled:text-zinc-500">
                  <IconArrowUp size={15} stroke={2.5} aria-hidden />
                </button>}
          </div>
        </div>
        )}
      </div>
    </div>
  );
}
