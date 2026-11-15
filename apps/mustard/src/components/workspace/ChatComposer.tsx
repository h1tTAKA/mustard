"use client";
/* eslint-disable @next/next/no-img-element -- 붙여넣기 data URL 미리보기(최적화 불필요) */
// 채팅 입력 카드(#1341) — 겹 그림자 카드 안에 글·첨부, 아래 줄 = [+첨부][실행 AI·모델·생각 강도][권한 모드] … [컨텍스트][보내기/멈춤].
// `/` 로 시작하면 명령 메뉴(앱 명령 + 내 커맨드·스킬), `@` 뒤엔 레포 파일 자동완성, 빈 입력에서 ↑↓ = 보낸 말 다시 불러오기.
// Enter 보내기(일하는 중이면 대기열), ⌘Enter = 일하는 중에도 바로 보내기, Shift+Enter 줄바꿈, Shift+Tab 권한 모드 바꾸기, Esc 멈춤.
// 받아쓰기(macOS 음성 인식, main 도우미): 마이크 버튼·⌘D. 누르면 켜고 끄기, 0.5초 넘게 누르고 있으면 누르고 말하기(떼면 확정).
// 받아쓰는 동안 아래 줄은 [파형][✕][✓], 글은 커서 자리에 실시간으로 들어감(자동 전송 안 함). Enter·✓ = 확정, Esc·✕ = 받아쓴 글만 되돌림.
import { useEffect, useMemo, useRef, useState } from "react";
import { IconPlus, IconX, IconArrowUp, IconPlayerStopFilled, IconChevronDown, IconCheck, IconShield, IconShieldExclamation, IconListCheck, IconMicrophone, IconSearch, IconChevronRight } from "@tabler/icons-react";
import { useT, useLocale, useSetting, useShortcut, useShortcutHint, VOICEKEYS, VOICE_DEFAULTS } from "@mustard/core";
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
const MODE_LABEL: Record<"default" | "full", string> = { default: "Default", full: "Full access" };

type ModelInfo = { id: string; label: string; description?: string; legacy?: boolean };
type Menu = { kind: "slash"; q: string } | { kind: "file"; q: string; at: number } | null;
type Dict = { phase: "starting" | "listening"; before: string; after: string; text: string };
const nowMs = () => Date.now(); // 이벤트 처리기 안에서만 부름
const DICT_LOCALE: Record<string, string> = { ko: "ko-KR", ja: "ja-JP", en: "en-US", zh: "zh-CN", de: "de-DE", es: "es-ES", fr: "fr-FR" };
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

export default function ChatComposer({ root, meta, providers, busy, history, ctx, onSend, onStop, onOptions, onAppCommand, draft, onDraftTaken }: {
  root: string; meta: Meta; providers: typeof PROVIDERS; busy: boolean; history: string[]; ctx?: { used: number; win: number };
  onSend: (text: string, images: Img[], now: boolean) => void; onStop: () => void; onOptions: (o: Partial<Pick<Meta, "provider" | "model" | "effort" | "mode">>) => void; onAppCommand: (c: AppCommand) => void;
  draft?: string; onDraftTaken?: () => void;
}) {
  const t = useT();
  const [input, setInput] = useState("");
  const [images, setImages] = useState<Img[]>([]);
  const [note, setNote] = useState("");
  const [picker, setPicker] = useState(false);
  const [models, setModels] = useState<ModelInfo[] | null>(null);
  const [modelQ, setModelQ] = useState("");
  const [showOld, setShowOld] = useState(false);
  const [modeMenu, setModeMenu] = useState(false);
  const [menu, setMenu] = useState<Menu>(null);
  const [sel, setSel] = useState(0);
  const [commands, setCommands] = useState<{ name: string; description: string; source: string }[]>([]);
  const [files, setFiles] = useState<string[]>([]);
  const recall = useRef(-1);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const locked = meta.count > 0;
  const { locale } = useLocale();
  const [canDictate, setCanDictate] = useState(false);
  const [dict, setDict] = useState<Dict | null>(null);
  const [levels, setLevels] = useState<number[]>([]);
  const [noteAction, setNoteAction] = useState<null | (() => void)>(null);
  const dictRef = useRef<Dict | null>(null);
  const pressAt = useRef(0);
  const keyHeld = useRef(false);
  const stoppingRef = useRef(false); // 확정·취소를 눌러서 끝난 건 오류로 안 보여 줌
  const heardAt = useRef(0);
  const startedAt = useRef(0);
  useEffect(() => { void window.nunopiDesktop?.dictation?.available().then(setCanDictate).catch(() => {}); }, []);
  // 설정 > 음성 — 켜기·누르는 방식·엔진(로컬 모델)·언어·마이크
  const voiceOn = useSetting<boolean>(VOICEKEYS.enabled, VOICE_DEFAULTS.enabled);
  const voiceMode = useSetting<"auto" | "hold" | "toggle">(VOICEKEYS.mode, VOICE_DEFAULTS.mode);
  const voiceEngine = useSetting<"system" | "local">(VOICEKEYS.engine, VOICE_DEFAULTS.engine);
  const voiceModel = useSetting<string>(VOICEKEYS.modelId, VOICE_DEFAULTS.modelId);
  const voiceLang = useSetting<string>(VOICEKEYS.language, VOICE_DEFAULTS.language);
  const voiceDevice = useSetting<string>(VOICEKEYS.device, VOICE_DEFAULTS.device);
  const dictateHint = useShortcutHint("chat.dictate");
  const dictateOk = canDictate && voiceOn;
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
    const lc = voiceLang ? (DICT_LOCALE[voiceLang] ?? voiceLang) : (DICT_LOCALE[locale] ?? "en-US");
    const r = await api.start({ locale: lc, language: voiceLang || locale, engine: voiceEngine, modelId: voiceModel, ...(voiceDevice ? { device: voiceDevice } : {}) });
    if (!r.ok) { endDict(null); setNote(t("achat.dictFail", { m: r.error ?? "" })); }
  };
  const stopDict = () => { stoppingRef.current = true; void window.nunopiDesktop?.dictation?.stop(); };
  const cancelDict = () => { if (!dictRef.current) return; stoppingRef.current = true; endDict(null); void window.nunopiDesktop?.dictation?.cancel(); };
  // 받아쓰기 단축키(설정 > 단축키 chat.dictate, 기본 ⌘D) — 이 입력창에 커서가 있거나 받아쓰는 중일 때만. 길게 누르기 모드는 키를 떼면 넣음
  useShortcut(["chat.dictate"], () => {
    if (!dictateOk || (document.activeElement !== taRef.current && !dictRef.current)) return false;
    if (keyHeld.current) return; // 누르고 있는 동안 오는 키 반복은 무시(리뷰)
    keyHeld.current = true;
    const wasOn = !!dictRef.current;
    const up = () => { window.removeEventListener("keyup", up, true); keyHeld.current = false; if (!wasOn && voiceMode === "hold") stopDict(); };
    window.addEventListener("keyup", up, true);
    if (wasOn) stopDict(); else void startDict();
  });

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
  const cycleMode = () => { onOptions({ mode: meta.mode === "full" ? "default" : "full" }); }; // Shift+Tab — 기본 ↔ 전체 액세스(계획은 칩)
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
    if (dict) { // 받아쓰는 중 — Enter 확정(단축키도), Esc 취소, 나머지 키는 막음(글은 도우미가 씀)
      if (e.key === "Enter") { e.preventDefault(); stopDict(); }
      else if (e.key === "Escape") { e.preventDefault(); cancelDict(); }
      else if (!e.metaKey) e.preventDefault();
      return;
    }
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

  // 툴바 — 알약(h-6 rounded-md text-xs)·아이콘 버튼(size-8 rounded-md)·보내기(size-8 rounded-full, 강조색은 여기만)
  const pill = "flex h-6 min-w-0 items-center gap-1 rounded-md px-2 text-xs text-zinc-600 transition hover:bg-black/[.06] hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-white/[.08] dark:hover:text-zinc-100";
  const iconBtn = "flex size-8 shrink-0 items-center justify-center rounded-md text-zinc-500 transition hover:bg-black/[.06] hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-white/[.08] dark:hover:text-zinc-100";
  const pop = "absolute bottom-full z-50 mb-1.5 rounded-xl border border-black/[.14] bg-white/90 p-1 shadow-lg backdrop-blur-2xl dark:border-white/[.12] dark:bg-zinc-800/90";
  const model = models?.find((m) => m.id === meta.model);
  const modelLabel = (model?.label ?? meta.model).replace(/^Claude /, "");
  const effortLabel = EFFORTS.find((e) => e.v === meta.effort && e.v !== undefined)?.label;
  const pct = ctx && ctx.win ? Math.min(100, Math.round((ctx.used / ctx.win) * 100)) : null;
  const q = modelQ.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const shownModels = (models ?? []).filter((m) => q.every((w) => `${m.label} ${m.id} ${m.description ?? ""}`.toLowerCase().includes(w)));
  const latest = shownModels.filter((m) => !m.legacy), older = shownModels.filter((m) => m.legacy);
  const plan = meta.mode === "plan";
  const permMode: "default" | "full" = meta.mode === "full" ? "full" : "default";
  const modelRow = (m: ModelInfo) => (
    <button key={m.id} type="button" onClick={() => { onOptions({ model: m.id }); setPicker(false); setModelQ(""); }}
      className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left transition hover:bg-black/[.05] dark:hover:bg-white/[.08] ${m.id === meta.model ? "bg-black/[.04] dark:bg-white/[.06]" : ""}`}>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] text-zinc-800 dark:text-zinc-100">{m.label}</span>
        {m.description && <span className="block truncate text-xs text-zinc-500 dark:text-zinc-400">{m.description}</span>}
      </span>
      {m.id === meta.model && <IconCheck size={14} stroke={2} className="shrink-0 text-mustard-600 dark:text-mustard-400" aria-hidden />}
    </button>
  );

  return (
    <div className="relative">
      {note && (
        <p className="mb-1.5 flex items-center gap-2 px-1 text-xs text-red-600 dark:text-red-400">
          <span onClick={() => { setNote(""); setNoteAction(null); }}>{note}</span>
          {noteAction && <button type="button" onClick={() => { noteAction(); setNote(""); setNoteAction(null); }} className="shrink-0 rounded-md bg-black/[.05] px-2 py-0.5 text-xs text-zinc-700 hover:bg-black/[.08] dark:bg-white/[.08] dark:text-zinc-200 dark:hover:bg-white/[.12]">{t("achat.openSettings")}</button>}
        </p>
      )}
      {/* `/`·`@` 메뉴 — 입력 카드 위. 명령/스킬 묶음 머리, 행은 이름(고정폭)·설명 두 줄 */}
      {menu && options.length > 0 && (
        <div className={`${pop} inset-x-0 nunopi-scroll max-h-72 overflow-y-auto`}>
          {options.map((o, k) => (
            <div key={`${o.source}:${o.name}`}>
              {menu.kind === "slash" && (k === 0 || (options[k - 1].source === "skill") !== (o.source === "skill")) && (
                <p className="px-2.5 pb-0.5 pt-1.5 text-[11px] font-medium text-zinc-400 dark:text-zinc-500">{t(o.source === "skill" ? "achat.menuSkills" : "achat.menuCommands")}</p>
              )}
              <button type="button" onMouseDown={(e) => { e.preventDefault(); pick(o.name, o.source); }} onMouseEnter={() => setSel(k)}
                className={`flex w-full flex-col rounded-lg px-2.5 py-1 text-left ${k === sel ? "bg-black/[.06] dark:bg-white/[.08]" : ""}`}>
                <span className="flex items-center gap-2 font-mono text-[12.5px] text-zinc-800 dark:text-zinc-100">
                  {menu.kind === "slash" ? `/${o.name}` : o.name}
                  {o.source !== "app" && o.source !== "file" && <span className="ml-auto font-sans text-[11px] text-zinc-400 dark:text-zinc-500">{t(`achat.src.${o.source}`)}</span>}
                </span>
                {o.description && <span className="truncate text-xs text-zinc-500 dark:text-zinc-400">{o.description}</span>}
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="rounded-2xl border border-zinc-200 bg-white p-1.5 shadow-sm transition focus-within:border-mustard-400/70 focus-within:ring-4 focus-within:ring-mustard-400/10 dark:border-zinc-700/80 dark:bg-zinc-900/60 dark:focus-within:border-mustard-400/50 dark:focus-within:ring-mustard-400/10"
        onDragOver={(e) => { if ([...e.dataTransfer.items].some((i) => i.type.startsWith("image/"))) e.preventDefault(); }}
        onDrop={(e) => { const fs = [...e.dataTransfer.files]; if (fs.some((f) => f.type.startsWith("image/"))) { e.preventDefault(); addFiles(fs); } }}>
        {images.length > 0 && (
          <div className="flex flex-wrap gap-2 px-1 pb-1 pt-1">
            {images.map((im, k) => (
              <div key={k} className="group/img relative">
                <img src={im.url} alt="" className="h-16 w-16 rounded-lg border border-black/[.1] object-cover dark:border-white/[.1]" />
                <button type="button" onClick={() => setImages((p) => p.filter((_, j) => j !== k))} aria-label={t("achat.removeImage")}
                  className="absolute -right-1.5 -top-1.5 rounded-full bg-zinc-900 p-0.5 text-white opacity-0 shadow transition group-hover/img:opacity-100 dark:bg-zinc-100 dark:text-zinc-900"><IconX size={11} stroke={2.5} aria-hidden /></button>
              </div>
            ))}
          </div>
        )}
        <textarea ref={taRef} value={dict ? joinDictation(dict.before, dict.text, dict.after) : input} readOnly={!!dict} rows={1}
          placeholder={t(dict ? (dict.phase === "starting" ? "achat.connecting" : "achat.listening") : busy ? "achat.placeholderBusy" : "achat.placeholder")}
          onChange={(e) => onChange(e.target.value, e.target.selectionStart ?? e.target.value.length)}
          onPaste={(e) => { const fs = [...e.clipboardData.files]; if (fs.some((f) => f.type.startsWith("image/"))) { e.preventDefault(); addFiles(fs); } }}
          onKeyDown={onKey} onBlur={() => setTimeout(() => setMenu(null), 150)}
          className="block max-h-[calc(8lh+0.5rem)] min-h-12 w-full resize-none bg-transparent px-2 py-1 text-sm leading-6 text-zinc-800 outline-none [field-sizing:content] placeholder:text-zinc-400 dark:text-zinc-100 dark:placeholder:text-zinc-500" />
        {dict ? (
          <div className="flex w-full min-w-0 items-center justify-end gap-2 pl-2 pt-0.5">
            <Wave levels={levels} />
            <button type="button" onClick={cancelDict} aria-label={t("achat.dictCancel")} title={`${t("achat.dictCancel")} (Esc)`} className={iconBtn}><IconX size={15} stroke={2} aria-hidden /></button>
            <button type="button" onClick={stopDict} aria-label={t("achat.dictDone")} title={`${t("achat.dictDone")} (Enter)`}
              className="flex size-8 shrink-0 items-center justify-center rounded-full bg-mustard-500 text-white transition hover:bg-mustard-600 active:opacity-70"><IconCheck size={15} stroke={2.5} aria-hidden /></button>
          </div>
        ) : (
        <div className="flex items-center gap-2 pt-0.5">
          <div className="flex min-w-0 items-center gap-0.5">
            <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => { addFiles([...(e.target.files ?? [])]); e.target.value = ""; }} />
            <button type="button" onClick={() => fileRef.current?.click()} aria-label={t("achat.attach")} title={t("achat.attach")} className={iconBtn}>
              <IconPlus size={16} stroke={1.8} aria-hidden />
            </button>
            {/* 권한 모드 — 위로 열리는 목록, 행마다 한 줄 설명. 전체 액세스는 노란 경고 방패 */}
            <div className="relative">
              <button type="button" onClick={() => setModeMenu((v) => !v)} title={`${t(`achat.modeHint.${permMode}`)} (Shift+Tab)`}
                className={`${pill} ${permMode === "full" ? "text-yellow-600 hover:text-yellow-700 dark:text-yellow-500 dark:hover:text-yellow-400" : ""}`}>
                {permMode === "full" ? <IconShieldExclamation size={14} stroke={1.8} aria-hidden /> : <IconShield size={14} stroke={1.8} aria-hidden />}
                {MODE_LABEL[permMode]}<IconChevronDown size={12} stroke={2} className="opacity-60" aria-hidden />
              </button>
              {modeMenu && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setModeMenu(false)} aria-hidden />
                  <div className={`${pop} left-0 w-72`}>
                    {(["default", "full"] as const).map((m) => (
                      <button key={m} type="button" onClick={() => { onOptions({ mode: m }); setModeMenu(false); }}
                        className="flex w-full items-start gap-2 rounded-lg px-2.5 py-1.5 text-left transition hover:bg-black/[.05] dark:hover:bg-white/[.08]">
                        {m === "full" ? <IconShieldExclamation size={15} stroke={1.8} className="mt-0.5 shrink-0 text-yellow-600 dark:text-yellow-500" aria-hidden /> : <IconShield size={15} stroke={1.8} className="mt-0.5 shrink-0 text-zinc-500" aria-hidden />}
                        <span className="min-w-0 flex-1">
                          <span className="block text-[13px] text-zinc-800 dark:text-zinc-100">{MODE_LABEL[m]}</span>
                          <span className="block text-xs text-zinc-500 dark:text-zinc-400">{t(`achat.modeHint.${m}`)}</span>
                        </span>
                        {permMode === m && !plan && <IconCheck size={14} stroke={2} className="mt-0.5 shrink-0 text-mustard-600 dark:text-mustard-400" aria-hidden />}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
            {/* 계획 — 권한과 따로 켜고 끄는 칩(Claude만) */}
            {meta.provider === "claude-code" && (
              <button type="button" onClick={() => onOptions({ mode: plan ? "default" : "plan" })} title={t("achat.modeHint.plan")}
                aria-pressed={plan} className={`${pill} ${plan ? "bg-mustard-500/15 font-medium text-mustard-700 hover:bg-mustard-500/20 hover:text-mustard-800 dark:text-mustard-300 dark:hover:text-mustard-200" : ""}`}>
                <IconListCheck size={14} stroke={1.8} aria-hidden />Plan
              </button>
            )}
          </div>
          <div className="ml-auto flex min-w-0 items-center gap-1.5">
            {/* 모델 · 추론 수준 — 한 알약, 팝업: 검색·모델(설명)·이전 모델 접기·추론 수준 */}
            <div className="relative min-w-0">
              <button type="button" onClick={() => setPicker((v) => !v)} className={pill} data-chat-picker>
                <AgentLogo agent={P(meta.provider).agent} size={13} />
                <span className="truncate">{modelLabel}</span>
                {effortLabel && <span className="shrink-0 text-zinc-400 dark:text-zinc-500">{effortLabel}</span>}
                <IconChevronDown size={12} stroke={2} className="shrink-0 opacity-60" aria-hidden />
              </button>
              {picker && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => { setPicker(false); setModelQ(""); }} aria-hidden />
                  <div className={`${pop} right-0 w-96 max-w-[calc(100vw-2rem)] p-0`}>
                    <div className="flex items-center gap-2 border-b border-black/[.08] px-3 py-2 dark:border-white/[.08]">
                      <IconSearch size={14} stroke={2} className="shrink-0 text-zinc-400" aria-hidden />
                      <input autoFocus value={modelQ} onChange={(e) => setModelQ(e.target.value)} placeholder={t("achat.modelSearch")}
                        className="min-w-0 flex-1 bg-transparent text-[13px] text-zinc-800 outline-none placeholder:text-zinc-400 dark:text-zinc-100" />
                    </div>
                    {!locked && providers.length > 1 && (
                      <div className="flex flex-wrap gap-1 border-b border-black/[.08] px-2 py-1.5 dark:border-white/[.08]">
                        {providers.map((p) => (
                          <button key={p.id} type="button" onClick={() => onOptions({ provider: p.id })}
                            className={`flex h-6 items-center gap-1.5 rounded-md px-2 text-xs transition ${p.id === meta.provider ? "bg-black/[.08] text-zinc-900 dark:bg-white/[.12] dark:text-white" : "text-zinc-600 hover:bg-black/[.05] dark:text-zinc-300 dark:hover:bg-white/[.08]"}`}>
                            <AgentLogo agent={p.agent} size={12} />{p.label}
                          </button>
                        ))}
                      </div>
                    )}
                    <div className="nunopi-scroll max-h-[min(233px,60vh)] overflow-y-auto p-1">
                      {models === null ? <p className="px-3 py-2 text-xs text-zinc-400">…</p> : (
                        <>
                          {latest.map(modelRow)}
                          {older.length > 0 && (
                            <>
                              <button type="button" onClick={() => setShowOld((v) => !v)} className="flex w-full items-center gap-1 px-2.5 py-1 text-xs text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200">
                                <IconChevronRight size={12} stroke={2} className={`transition ${showOld || q.length ? "rotate-90" : ""}`} aria-hidden />{t("achat.olderModels", { n: older.length })}
                              </button>
                              {(showOld || q.length > 0) && older.map(modelRow)}
                            </>
                          )}
                        </>
                      )}
                    </div>
                    <div className="flex items-center gap-2 border-t border-black/[.08] px-3 py-2 dark:border-white/[.08]">
                      <span className="mr-auto text-xs text-zinc-500 dark:text-zinc-400">{t("achat.pickEffort")}</span>
                      {EFFORTS.filter((e) => e.v !== undefined).map((e) => (
                        <button key={e.label} type="button" onClick={() => { onOptions({ effort: meta.effort === e.v ? undefined : e.v }); setPicker(false); }}
                          className={`h-6 rounded-md px-2 text-xs transition ${meta.effort === e.v ? "bg-mustard-500/15 font-medium text-mustard-700 dark:text-mustard-300" : "text-zinc-600 hover:bg-black/[.05] dark:text-zinc-300 dark:hover:bg-white/[.08]"}`}>{e.label}</button>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </div>
            {pct !== null && (
              <span title={t("achat.ctx", { pct, used: Math.round(ctx!.used / 1000), win: Math.round(ctx!.win / 1000) })} className="flex shrink-0 items-center">
                <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden><circle cx="8" cy="8" r="6" fill="none" strokeWidth="2" className="stroke-black/[.08] dark:stroke-white/[.12]" /><circle cx="8" cy="8" r="6" fill="none" strokeWidth="2" strokeDasharray={`${(pct / 100) * 37.7} 37.7`} transform="rotate(-90 8 8)" strokeLinecap="round" className={pct > 85 ? "stroke-red-500" : pct > 60 ? "stroke-amber-500" : "stroke-zinc-400 dark:stroke-zinc-500"} /></svg>
              </span>
            )}
            {dictateOk && (
              <button type="button" aria-label={t("achat.dictate")} title={dictateHint ? `${t("achat.dictate")} (${dictateHint})` : t("achat.dictate")} className={iconBtn}
                onPointerDown={() => { pressAt.current = Date.now(); void startDict(); }}
                onPointerUp={() => { if (voiceMode === "hold" || (voiceMode === "auto" && Date.now() - pressAt.current > 500)) stopDict(); }}>
                <IconMicrophone size={16} stroke={1.8} aria-hidden />
              </button>
            )}
            {busy && !input.trim() && !images.length
              ? <button type="button" onClick={onStop} aria-label={t("achat.stop")} title={`${t("achat.stop")} (Esc)`}
                  className="flex size-8 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-zinc-700 transition hover:bg-zinc-200 active:opacity-70 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700">
                  <IconPlayerStopFilled size={12} aria-hidden />
                </button>
              : <button type="button" onClick={() => send(false)} disabled={!input.trim() && !images.length} aria-label={t("achat.send")} title={busy ? t("achat.queueHint") : undefined}
                  className="flex size-8 shrink-0 items-center justify-center rounded-full bg-mustard-500 text-white transition hover:bg-mustard-600 active:opacity-70 disabled:bg-black/[.08] disabled:text-zinc-400 dark:disabled:bg-white/[.1] dark:disabled:text-zinc-500">
                  <IconArrowUp size={16} stroke={2.5} aria-hidden />
                </button>}
          </div>
        </div>
        )}
      </div>
    </div>
  );
}
