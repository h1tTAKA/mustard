"use client";
// 캐치업(#992, 구 학습 스트림 #855·#857) — MCP 연결 에이전트가 뭘 하든(그래프 탐색+파일 편집) 실시간 관찰(SSE) +
// 등장한 "개념"을 중복 없이 1회씩 설명하고, 이해에 필요한 "용어"를 별도 용어집으로 누적. 반복 없이 정리.
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { IconCode, IconFile, IconSearch, IconSitemap, IconActivity, IconPointFilled, IconLoader2, IconPencil, IconChevronDown, IconBook2, IconBroadcast, IconCalendar, IconArrowBarToUp, IconMessageCircle, IconPlus, IconCheck, IconGitCompare, IconExternalLink } from "@tabler/icons-react";
import CatchupCalendar from "@/components/workspace/CatchupCalendar";
import CatchupAskPanel from "@/components/workspace/CatchupAskPanel";
import CatchupDiffCode from "@/components/workspace/CatchupDiffCode";
import { isDocEdit } from "@/lib/mcpActivity";
import { isNunopiEnabled } from "@/lib/product";
import { mergeTerms, parseNarrationTerms, type Term } from "@/lib/catchupTerms";
import { CATCHUP_ITEM_EVENT, parseDiffItemKey } from "@/lib/useAutoCommitExplain";
import { useT, useLocale, useToast, useSetting, CUKEYS, CATCHUP_DEFAULTS, createChatCard, normalizeCardFront, CARDS_CHANGED_EVENT } from "@mustard/core";
import { useFlyCard, collectCards } from "@mustard/nunopi";
import type { AgentProviderKind, ProviderSettings } from "@mustard/core";
import { Markdown } from "@mustard/core";
import { stripCardBlock } from "@mustard/core";
type ConceptKind = "symbol" | "file" | "query" | "repo" | "edit" | "narration" | "diff";
interface ActivityEvent { root: string; tool: string; kind: ConceptKind; target: string; isError: boolean; ts: number; note?: string }
interface Concept { key: string; kind: ConceptKind; target: string; tool: string; status: "idle" | "loading" | "done" | "error"; expl?: string; ts: number }
type StreamEvent = { type: string; message?: string; response?: { summary?: string } };

const KIND_ICON: Record<ConceptKind, typeof IconCode> = { symbol: IconCode, file: IconFile, query: IconSearch, repo: IconSitemap, edit: IconPencil, narration: IconBroadcast, diff: IconGitCompare };
const KIND_VERB: Record<ConceptKind, string> = { symbol: "심볼", file: "파일", query: "주제", repo: "레포 구조", edit: "편집 중인 파일", narration: "실시간", diff: "커밋 변경" };
const basename = (p: string) => p.split("/").filter(Boolean).pop() ?? p;
const ago = (ts: number, now: number) => { const s = Math.max(0, Math.round((now - ts) / 1000)); return s < 60 ? `${s}s` : s < 3600 ? `${Math.round(s / 60)}m` : `${Math.round(s / 3600)}h`; };
// 생성 시점 "MM-DD HH:MM" — 구분선이 있어도 카드 단독으로 날짜가 보이게(유저 요청, #994).
const fmtDateTime = (ts: number) => { const d = new Date(ts); const p = (n: number) => String(n).padStart(2, "0"); return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`; };
// 로컬 날짜 키(서버 파일명과 같은 규칙) — 구분선 그룹 기준.
const dayOf = (ts: number) => { const d = new Date(ts); return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`; };
// 카톡式 구분선 표기 — locale별 자동(ko "2026년 10월 6일 화요일", ja "2026年10月6日火曜日", en "Tuesday, October 6, 2026").
const fmtDay = (ts: number, locale: string) => { try { return new Intl.DateTimeFormat(locale, { year: "numeric", month: "long", day: "numeric", weekday: "long" }).format(ts); } catch { return new Date(ts).toDateString(); } };
// nunopi 브랜드 그라데이션(시안→블루→바이올렛) — 카드로 등록된 용어를 머스타드 일반 용어와 구분(#1051).
const NUNOPI_GRADIENT = "linear-gradient(90deg, #22d3ee 0%, #3b82f6 55%, #8b5cf6 100%)";
const MAX_ITEMS = 200; // #994 화면 메모리 상한(서버 로드 100 + 실시간 여유). 전체 기록은 서버 날짜별 파일.
const cKey = (root: string) => `nunopi:ws:${root}:learn-concepts`; // #994 이전 저장소(1회 이관 후 삭제)
const gKey = (root: string) => `nunopi:ws:${root}:learn-terms`;
function load<T>(key: string): T[] { try { const r = typeof localStorage !== "undefined" && localStorage.getItem(key); return r ? (JSON.parse(r) as T[]) : []; } catch { return []; } }

// 개념 1개 설명 프롬프트 — 설명 2문장 + (용어집 켜짐이면) [용어] term :: 뜻. 카드·JSON·코드 금지.
// 용어는 프로그래밍·개발 것만(#1049) — 앱이 다루는 주제(언어학·문자 표준·업무 용어 등)가 섞이던 문제.
function conceptPrompt(repo: string, kind: ConceptKind, target: string, withTerms: boolean): string {
  return `레포 "${repo}"에서 AI 코딩 에이전트가 지금 ${KIND_VERB[kind]} "${target}"을(를) 다루고 있어.\n`
    + `이게 뭐고 에이전트가 왜 이걸 보는지 개발 초보에게 자연스러운 한국어 2문장으로.\n`
    + (withTerms
      ? `그 다음 줄에 "[용어]"만 쓰고, 이 설명을 이해하는 데 필요한 **프로그래밍·개발 용어**(언어 문법·함수·라이브러리·도구·명령어·개발 개념) 2~3개를 "용어 :: 한 줄 뜻" 형식으로 한 줄씩. `
        + `이 앱이 다루는 주제의 도메인 지식(언어학·문자 표준·업무 용어 등)은 넣지 마. 해당 용어가 없으면 "[용어]" 줄 자체를 생략.\n`
      : "")
    + `코드·카드·JSON·메타 발언 금지. 설명은 흐르는 문장으로(사전식 나열 말고).`;
}

// 명령어 카드(#1049) — 에이전트가 왜 했는지 말고 명령 자체를 풀이. 첫 줄 한 문장 요약 + 명령·옵션별 목록.
const isCommand = (c: { kind: ConceptKind; tool: string }) => c.kind === "edit" && c.tool === "Bash";
function commandPrompt(command: string): string {
  return `터미널 명령어 하나를 개발 초보에게 풀이해줘:\n${command}\n\n`
    + `첫 줄: 이 명령 전체가 무슨 일을 하는지 한국어 한 문장.\n`
    + `그 다음: 쓰인 명령·옵션을 나온 순서대로 "- \`cd\` — 폴더 이동"처럼 한 줄씩(이름은 백틱, 뜻은 짧게). 같은 명령이 반복되면 한 번만.\n`
    + `에이전트가 왜 실행했는지·결과 추측·메타 발언 금지. 코드블록·JSON 금지.`;
}

// 응답 → {설명, 용어[]}. "[용어]" 기준 분리, 카드/펜스 제거.
function parseConcept(raw: string): { expl: string; terms: Term[] } {
  let s = stripCardBlock(raw);
  const cardCut = s.search(/```|nunopi-cards|(^|\n)\s*\[\s*\{\s*"(term|word|title)"/i);
  if (cardCut >= 0) s = s.slice(0, cardCut);
  // "[용어]" 마커(앞 개행 없어도) 기준 분리 — 앞=설명, 뒤=용어 목록.
  const m = s.split(/\[\s*용어\s*\]\s*/i);
  const expl = (m[0] ?? "").trim();
  const terms: Term[] = [];
  if (m[1]) for (const line of m.slice(1).join("\n").split("\n")) { // 용어는 한 줄에 하나(term :: 뜻)
    const t = line.replace(/^[-*•\s]+/, "").split(/\s*::\s*/);
    if (t.length >= 2 && t[0].trim() && t.slice(1).join("::").trim()) terms.push({ term: t[0].trim(), def: t.slice(1).join("::").trim() });
  }
  return { expl: expl || "—", terms };
}

// #994 서버 날짜별 저장 — 성공 여부 반환(이관 시 로컬 삭제 판단). 실패해도 화면 흐름은 안 막음.
async function saveItems(root: string, items: { key: string; kind: ConceptKind; target: string; tool: string; ts: number; expl: string }[]): Promise<boolean> {
  try {
    const r = await fetch("/api/repo/stream", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ root, items }) });
    return r.ok && (await r.json())?.ok === true;
  } catch { return false; }
}

export default function RepoLearnStream({ root, providerId, providerSettings, active = true, agentWorking = false, onOpenDiff }: {
  root: string;
  active?: boolean;       // #1043 보이는 레포
  agentWorking?: boolean; // #1043 이 레포 에이전트가 작업 중(숨어 있어도 실시간 해설·설명 큐를 놓치지 않게)
  providerId?: AgentProviderKind;
  providerSettings?: ProviderSettings;
  onOpenDiff?: (hash: string, file: string) => void; // #1056 diff 카드 → 그 커밋·파일 diff 탭
}) {
  const t = useT();
  const { locale } = useLocale();
  // #994 기록은 서버 날짜별 저장소(~/.nunopi/stream)에서 — 마운트 시 최근 100개 로드(loaded 전엔 빈 안내 숨김).
  const [concepts, setConcepts] = useState<Concept[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [terms, setTerms] = useState<Term[]>(() => load<Term>(gKey(root)));
  const [live, setLive] = useState(false);
  const [now, setNow] = useState(() => 0);
  const [autoExplain, setAutoExplain] = useState(true);
  const [termsOpen, setTermsOpen] = useState(true);
  const showCommands = useSetting<boolean>(CUKEYS.commands, CATCHUP_DEFAULTS.commands); // #1049 설정 > 캐치업
  const showTerms = useSetting<boolean>(CUKEYS.terms, CATCHUP_DEFAULTS.terms);
  // #1051 용어 → nunopi 카드 추가. 카드(암기)는 nunopi 학습모듈 기능이라 꺼져 있으면 버튼 없음.
  // 추가는 한 방향(카드 삭제는 갤러리에서) → 토글 아이콘 대신 "+ 추가" / "✓ 카드" 표시, 추가된 건 누르면 카드 확대.
  const { throwCard } = useFlyCard();
  const toast = useToast();
  const cardsOn = isNunopiEnabled();
  const [cardTick, setCardTick] = useState(0); // 다른 곳(질문 패널·챗)에서 카드가 생겨도 표시 갱신
  useEffect(() => {
    const on = () => setCardTick((n) => n + 1);
    window.addEventListener(CARDS_CHANGED_EVENT, on);
    return () => window.removeEventListener(CARDS_CHANGED_EVENT, on);
  }, []);
  // 카드 앞면(정규화) → 카드 — 매초 리렌더(상대시간)마다 저장소를 읽지 않게 카드 변경 때만 계산.
  const cardByFront = useMemo(() => new Map(cardsOn ? collectCards(["token", "concept", "term"], new Date()).map((c) => [normalizeCardFront(c.front), c] as const) : []), [cardTick, cardsOn]); // eslint-disable-line react-hooks/exhaustive-deps -- cardTick = 저장소 변경 신호
  const cardOf = (term: string) => cardByFront.get(normalizeCardFront(term));
  const addTerm = useCallback((x: Term) => {
    const ok = createChatCard("term", x.term, x.def, t("card.workspaceSource", { repo: basename(root) }), undefined, { kind: "workspace", sessionId: "catchup:terms", root });
    toast(ok ? t("card.added", { term: x.term }) : t("card.exists"));
  }, [root, t, toast]);
  // #1049 카테고리 필터 — 해설(실시간 해설·파일/심볼 설명) / 명령어 / 용어. 꺼진 카테고리는 칩도 숨김.
  const [filterSel, setFilter] = useState<"all" | "explain" | "commands" | "diff" | "terms">("all");
  // #1049 검색 — 서버가 전체 날짜에서 제목·설명을 찾음(입력 멈춘 뒤 250ms). 용어집은 화면에서 거름.
  const [q, setQ] = useState("");
  const [found, setFound] = useState<Concept[] | null>(null); // null = 검색 중
  const query = q.trim();
  useEffect(() => {
    if (!query) return;
    let alive = true;
    const tm = setTimeout(() => {
      setFound(null);
      fetch(`/api/repo/stream?root=${encodeURIComponent(root)}&q=${encodeURIComponent(query)}`).then((r) => r.json())
        .then((j) => { if (alive) setFound(j?.ok && Array.isArray(j.items) ? (j.items as Omit<Concept, "status">[]).map((x) => ({ ...x, status: "done" as const })) : []); })
        .catch(() => { if (alive) setFound([]); });
    }, 250);
    return () => { alive = false; clearTimeout(tm); };
  }, [query, root]);
  const filter = (filterSel === "commands" && !showCommands) || (filterSel === "terms" && !showTerms) ? "all" : filterSel;

  const seenRef = useRef(new Set<string>());                          // 이미 설명한 개념(dedup) — 서버 로드 시 채움
  const queueRef = useRef<string[]>([]);
  const busyRef = useRef(false);
  const metaRef = useRef(new Map<string, { kind: ConceptKind; target: string; tool: string }>());
  const cfgRef = useRef({ providerId, providerSettings, locale, autoExplain, showCommands, showTerms });
  useEffect(() => { cfgRef.current = { providerId, providerSettings, locale, autoExplain, showCommands, showTerms }; }, [providerId, providerSettings, locale, autoExplain, showCommands, showTerms]);

  const explainOne = useCallback(async (key: string) => {
    const meta = metaRef.current.get(key); const { providerId: pid, providerSettings: ps, locale: loc } = cfgRef.current;
    if (!meta || !pid) return;
    setConcepts((p) => p.map((c) => (c.key === key ? { ...c, status: "loading" } : c)));
    try {
      const res = await fetch("/api/agent/analyze", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerId: pid, request: { code: `레포: ${basename(root)}`, locale: loc, providerId: pid, mode: "chat", messages: [{ role: "user", content: isCommand(meta) ? commandPrompt(meta.target) : conceptPrompt(basename(root), meta.kind, meta.target, cfgRef.current.showTerms) }], providerSettings: ps } }),
      });
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
      const reader = res.body.getReader(); const dec = new TextDecoder();
      let buf = "", answer = "", streamErr = "";
      for (;;) { const { done, value } = await reader.read(); if (done) break; buf += dec.decode(value, { stream: true }); const ls = buf.split("\n"); buf = ls.pop() ?? ""; for (const l of ls) { if (!l.trim()) continue; let ev: StreamEvent; try { ev = JSON.parse(l) as StreamEvent; } catch { continue; } if (ev.type === "result") answer = ev.response?.summary ?? ""; else if (ev.type === "error") streamErr = ev.message ?? "error"; } }
      if (streamErr) throw new Error(streamErr);
      const { expl, terms: newTerms } = parseConcept(answer);
      setConcepts((p) => p.map((c) => (c.key === key ? { ...c, status: "done", expl } : c)));
      saveItems(root, [{ key, kind: meta.kind, target: meta.target, tool: meta.tool, ts: Date.now(), expl }]); // #994 날짜별 저장(내레이션은 서버가 직접)
      if (newTerms.length && cfgRef.current.showTerms) setTerms((prev) => mergeTerms(prev, newTerms, normalizeCardFront)); // 상한 없음, 표기 변형까지 중복 제거(#1051)
    } catch { setConcepts((p) => p.map((c) => (c.key === key ? { ...c, status: "error" } : c))); }
  }, [root]);

  const pump = useCallback(async () => {
    if (busyRef.current) return; busyRef.current = true;
    while (queueRef.current.length) { const key = queueRef.current.shift()!; await explainOne(key); }
    busyRef.current = false;
  }, [explainOne]);

  const enqueue = useCallback((key: string) => { if (seenRef.current.has(key)) return; seenRef.current.add(key); queueRef.current.push(key); void pump(); }, [pump]);

  // 실시간 연결은 "보고 있거나 에이전트가 작업 중"일 때만(#1043) — 같은 주소 동시 연결은 6개까지라, 방문한 레포마다
  // 열어두면 늦게 연 연결이 대기열에 멈춤(레포 5개 + 상태 스트림 = 6 → "패널 갔다 와야 뜸").
  // 둘 다 아니게 된 뒤 2분 지나면 끊고, 다시 보거나 에이전트가 돌면 바로 다시 연결(+ 아래 로드가 놓친 기록 채움).
  const want = active || agentWorking;
  const [connected, setConnected] = useState(want);
  useEffect(() => {
    if (want) { setConnected(true); return; } // eslint-disable-line react-hooks/set-state-in-effect -- 조건 바뀌면 즉시 연결
    const t = setTimeout(() => setConnected(false), 2 * 60_000);
    return () => clearTimeout(t);
  }, [want]);

  // #1056 커밋 자동 설명 → diff 카드(같은 창 이벤트로 즉시, 서버 기록은 훅이 따로 저장). 이미 설명된 카드라 설명 큐 안 탐.
  useEffect(() => {
    const on = (e: Event) => {
      const d = (e as CustomEvent<{ root: string; item: Omit<Concept, "status"> }>).detail;
      if (!d || d.root !== root) return;
      seenRef.current.add(d.item.key);
      setConcepts((prev) => [{ ...d.item, status: "done" as const }, ...prev.filter((c) => c.key !== d.item.key)].slice(0, MAX_ITEMS));
    };
    window.addEventListener(CATCHUP_ITEM_EVENT, on);
    return () => window.removeEventListener(CATCHUP_ITEM_EVENT, on);
  }, [root]);

  // SSE — 이벤트 → 개념 upsert(중복은 ts/tool만 갱신) + 새 개념이면 설명 큐.
  useEffect(() => {
    if (!root || !connected) return;
    const es = new EventSource(`/api/repo/mcp/activity/stream?root=${encodeURIComponent(root)}`);
    es.onopen = () => setLive(true); es.onerror = () => setLive(false);
    es.onmessage = (m) => {
      let ev: ActivityEvent; try { ev = JSON.parse(m.data) as ActivityEvent; } catch { return; }
      if (!ev?.target) return;
      // #870 실시간 내레이션 — 서버가 이미 설명(note)을 생성해 실었으므로 클라 재분석 없이 done 카드로 바로.
      if (ev.kind === "narration") {
        if (!ev.note) return;
        const nkey = `narration|${ev.ts}|${ev.target}`;                 // ts+제목 = 고유 키(같은 ms 충돌 방지)
        setConcepts((prev) => (prev.some((c) => c.key === nkey) ? prev  // 이미 있으면 스킵(SSE 재연결 replay 중복 방지)
          : [{ key: nkey, kind: "narration" as const, target: ev.target, tool: "narration", status: "done" as const, ts: ev.ts, expl: ev.note }, ...prev].slice(0, MAX_ITEMS)));
        // #1051 실시간 해설 본문의 "용어" 목록도 용어집으로(서버 프롬프트가 개발·IT 용어만 쓰게 함)
        const nt = cfgRef.current.showTerms ? parseNarrationTerms(ev.note) : [];
        if (nt.length) setTerms((prev) => mergeTerms(prev, nt, normalizeCardFront));
        return;
      }
      if (isCommand(ev) && !cfgRef.current.showCommands) return; // 명령어 해설 끔 → 카드 자체 안 띄움
      const key = `${ev.kind}|${ev.target}`;
      metaRef.current.set(key, { kind: ev.kind, target: ev.target, tool: ev.tool });
      setConcepts((prev) => { const found = prev.find((c) => c.key === key); if (found) return [{ ...found, tool: ev.tool, ts: ev.ts }, ...prev.filter((c) => c.key !== key)]; return [{ key, kind: ev.kind, target: ev.target, tool: ev.tool, status: "idle" as const, ts: ev.ts }, ...prev].slice(0, MAX_ITEMS); });
      const cfg = cfgRef.current; if (cfg.autoExplain && cfg.providerId) enqueue(key);
    };
    return () => es.close();
  }, [root, enqueue, connected]);

  // #994 서버 기록 로드 — ① 옛 localStorage 기록 있으면 1회 이관(서버가 key로 멱등) 후 삭제 ② 최근 100개 로드해
  // SSE로 먼저 들어온 항목과 key 병합(최신순). 이관 실패하면 로컬 키를 남겨 다음 마운트에 재시도.
  useEffect(() => {
    if (!root || !connected) return; // 다시 연결될 때마다 최근 기록 재로드(끊겨 있던 동안 놓친 것)
    let alive = true;
    (async () => {
      const legacy = load<Concept>(cKey(root)).filter((c) => c.status === "done" && c.expl);
      if (legacy.length) {
        const ok = await saveItems(root, legacy.map((c) => ({ key: c.key, kind: c.kind, target: c.target, tool: c.tool, ts: c.ts, expl: c.expl ?? "" })));
        if (ok) { try { localStorage.removeItem(cKey(root)); } catch { /* 무시 */ } }
      }
      let items: Concept[] = [];
      try {
        const j = await (await fetch(`/api/repo/stream?root=${encodeURIComponent(root)}&limit=100`)).json();
        if (j?.ok && Array.isArray(j.items)) items = (j.items as Omit<Concept, "status">[]).map((x) => ({ ...x, status: "done" as const }));
      } catch { /* 서버 미준비 — 실시간만 */ }
      if (!alive) return;
      for (const c of items) seenRef.current.add(c.key);
      setConcepts((prev) => { const have = new Set(prev.map((c) => c.key)); return [...prev, ...items.filter((c) => !have.has(c.key))].sort((a, b) => b.ts - a.ts); });
      setLoaded(true);
    })();
    return () => { alive = false; };
  }, [root, connected]);
  // 용어집은 그대로 localStorage(작고 레포별 누적).
  useEffect(() => { try { if (typeof localStorage !== "undefined") localStorage.setItem(gKey(root), JSON.stringify(terms)); } catch { /* 무시 */ } }, [terms, root]);

  useEffect(() => {
    if (!concepts.length) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 상대시간 초기 스냅
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(id);
  }, [concepts.length]);

  const toggleExpand = useCallback((key: string) => { if (!seenRef.current.has(key) && cfgRef.current.providerId) enqueue(key); }, [enqueue]);

  // #996 캘린더 되돌아보기 — 달력 열 때 기록 있는 날짜 로드, 지난 날 고르면 그날 파일만. 실시간(concepts)은 뒤에서 계속 갱신.
  const [calOpen, setCalOpen] = useState(false);
  const [days, setDays] = useState<Set<string>>(() => new Set());
  const [viewDay, setViewDay] = useState<string | null>(null);
  const [dayItems, setDayItems] = useState<Concept[] | null>(null); // null = 로딩 중
  const closeCal = useCallback(() => setCalOpen(false), []);
  const openCal = useCallback(() => {
    if (calOpen) { setCalOpen(false); return; }
    setCalOpen(true);
    fetch(`/api/repo/stream?root=${encodeURIComponent(root)}&days=1`).then((r) => r.json())
      .then((j) => { if (j?.ok && Array.isArray(j.days)) setDays(new Set(j.days as string[])); }).catch(() => { /* 오늘만 */ });
  }, [root, calOpen]);
  const listRef = useRef<HTMLDivElement>(null);
  const daySeqRef = useRef(0); // 요청 번호표(#996 리뷰) — 날짜를 빠르게 바꾸면 늦게 온 옛 응답이 새 선택을 덮지 않게
  const pickDay = useCallback((day: string | null) => {
    const seq = ++daySeqRef.current;
    setCalOpen(false);
    setViewDay(day);
    requestAnimationFrame(() => listRef.current?.scrollTo({ top: 0 })); // 날짜 전환·맨 위로 → 최신(맨 위)부터(유저 요청)
    if (!day) return;
    setDayItems(null);
    fetch(`/api/repo/stream?root=${encodeURIComponent(root)}&day=${day}`).then((r) => r.json())
      .then((j) => { if (seq === daySeqRef.current) setDayItems(j?.ok && Array.isArray(j.items) ? (j.items as Omit<Concept, "status">[]).map((x) => ({ ...x, status: "done" as const })) : []); })
      .catch(() => { if (seq === daySeqRef.current) setDayItems([]); });
  }, [root]);
  // #998 항목 질문 — 💬로 고른 항목 + 항목별 질문 수(배지) + 패널 높이(드래그, 기억).
  const [askItem, setAskItem] = useState<Concept | null>(null);
  const [askCounts, setAskCounts] = useState<Record<string, number>>({});
  const [askH, setAskH] = useState(() => { try { const v = Number(localStorage.getItem("nunopi:catchup-ask-h")); return v >= 140 ? v : 300; } catch { return 300; } });
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!root) return;
    fetch(`/api/repo/stream/ask?root=${encodeURIComponent(root)}&counts=1`).then((r) => r.json())
      .then((j) => { if (j?.ok && j.counts) setAskCounts(j.counts as Record<string, number>); }).catch(() => { /* 배지 없이 */ });
  }, [root]);
  const onAskCount = useCallback((key: string, n: number) => setAskCounts((p) => (p[key] === n ? p : { ...p, [key]: n })), []);
  // 경계선 드래그 — 패널 높이 = 컴포넌트 바닥 - 포인터 y. 목록·패널 최소 높이 보장.
  const dragCleanup = useRef<(() => void) | null>(null);
  useEffect(() => () => dragCleanup.current?.(), []); // 드래그 중 언마운트돼도 리스너 정리(#998 리뷰)
  const startResize = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    const box = rootRef.current?.getBoundingClientRect(); if (!box) return;
    let h = askH;
    const move = (ev: PointerEvent) => { h = Math.round(Math.min(box.height - 120, Math.max(140, box.bottom - ev.clientY))); setAskH(h); };
    const stop = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); dragCleanup.current = null; };
    const up = () => { stop(); try { localStorage.setItem("nunopi:catchup-ask-h", String(h)); } catch { /* 무시 */ } };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", up);
    dragCleanup.current = stop;
  }, [askH]);
  const shown = (query ? (found ?? []) : viewDay ? (dayItems ?? []) : concepts).filter((c) => (showCommands || !isCommand(c)) && !(c.kind === "edit" && isDocEdit(c.tool, c.target)) // 끄면 지난 명령 카드도 숨김, 문서 편집 카드는 항상 숨김(#1049)
    && (filter === "all" || (filter === "commands" ? isCommand(c) : filter === "diff" ? c.kind === "diff" : filter === "explain" && !isCommand(c) && c.kind !== "diff")));
  const shownTerms = query ? terms.filter((x) => `${x.term}\n${x.def}`.toLowerCase().includes(query.toLowerCase())) : terms;
  const viewLabel = viewDay ? (() => { try { return new Intl.DateTimeFormat(locale, { month: "long", day: "numeric" }).format(new Date(`${viewDay}T00:00:00`)); } catch { return viewDay; } })() : "";

  // 용어집(#1049·#1051) — 전체 필터에선 목록 위에 고정(해설·명령어 목록과 스크롤 따로), 용어 필터에선 목록 자리에서 전부.
  // 날짜 무관 누적이라 지난 날 보기에선 숨김(#996, 검색·용어 필터는 예외).
  const glossary = showTerms && shownTerms.length > 0 && (filter === "terms" || (filter === "all" && (!viewDay || !!query))) ? (
              <div className="border-b border-zinc-100 dark:border-zinc-800/70">
                <button type="button" onClick={() => setTermsOpen((v) => !v)} className="flex w-full items-center gap-1.5 px-3 py-2 text-left">
                  <IconBook2 size={13} stroke={2} className="shrink-0 text-mustard-600 dark:text-mustard-400" aria-hidden />
                  <span className="text-[11px] font-semibold text-zinc-600 dark:text-zinc-300">{t("learn.terms")} ({shownTerms.length})</span>
                  <IconChevronDown size={13} stroke={2} className={`ml-auto shrink-0 text-zinc-400 transition ${termsOpen ? "" : "-rotate-90"}`} aria-hidden />
                </button>
                {/* #1049 용어 = 작은 카드(용어 배지 + 뜻 아래 줄) — 텍스트 나열보다 훑기 쉽게 */}
                {/* 전체 필터에선 해설·명령어가 묻히지 않게 최신 3개만 + "모두 보기"(→ 용어 필터), 용어 필터면 전부(#1051) */}
                {(termsOpen || filter === "terms") && <ul className="flex flex-col gap-1.5 px-2.5 pb-2.5">
                  {(filter === "terms" ? shownTerms : shownTerms.slice(0, 3)).map((x) => (
                    <li key={x.term}>{(() => { const card = cardOf(x.term); const body = (<>
                      <span className="inline-block rounded-md bg-mustard-500/10 px-1.5 py-0.5 text-[11px] font-semibold text-mustard-700 dark:text-mustard-400">{x.term}</span>
                      <p className="mt-1 text-[11px] leading-snug text-zinc-500 dark:text-zinc-400">{x.def}</p>
                    </>); return card ? ( /* 추가됨 — nunopi 그라데이션 테두리·배지·용어, 카드 전체를 누르면 카드 확대 */
                      <button type="button" onClick={(e) => throwCard(card, e.currentTarget.getBoundingClientRect())} title={t("learn.openCard")}
                        className="block w-full rounded-lg p-px text-left transition hover:brightness-110" style={{ backgroundImage: NUNOPI_GRADIENT }}>
                        <span className="relative block rounded-[7px] bg-white px-2.5 py-1.5 pr-14 dark:bg-[var(--s-pane)]">
                          <span className="absolute right-1.5 top-1.5 inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold text-white" style={{ backgroundImage: NUNOPI_GRADIENT }}><IconCheck size={10} stroke={2.5} aria-hidden />{t("learn.inCards")}</span>
                          <span className="inline-block rounded-md bg-blue-500/10 px-1.5 py-0.5 text-[11px] font-semibold"><span className="bg-clip-text text-transparent" style={{ backgroundImage: NUNOPI_GRADIENT }}>{x.term}</span></span>
                          <span className="mt-1 block text-[11px] leading-snug text-zinc-500 dark:text-zinc-400">{x.def}</span>
                        </span>
                      </button>
                    ) : (
                      <div className={`relative rounded-lg border border-zinc-200 bg-zinc-50/70 px-2.5 py-1.5 dark:border-zinc-800 dark:bg-zinc-800/40 ${cardsOn ? "pr-8" : ""}`}>
                        {cardsOn && ( /* 오른쪽 위 + → nunopi 카드로 추가 */
                          <button type="button" onClick={() => addTerm(x)} title={t("chat.saveAsCard")} aria-label={t("chat.saveAsCard")}
                            className="absolute right-1.5 top-1.5 rounded-md p-0.5 text-zinc-400 transition hover:bg-zinc-100 hover:text-mustard-600 dark:text-zinc-500 dark:hover:bg-zinc-800 dark:hover:text-mustard-400">
                            <IconPlus size={13} stroke={2.2} aria-hidden />
                          </button>
                        )}
                        {body}
                      </div>
                    ); })()}</li>
                  ))}
                  {filter !== "terms" && shownTerms.length > 3 && (
                    <li><button type="button" onClick={() => setFilter("terms")}
                      className="w-full rounded-lg py-1 text-center text-[11px] font-medium text-zinc-500 transition hover:bg-zinc-100 hover:text-mustard-700 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-mustard-400">
                      {t("learn.allTerms", { n: shownTerms.length })} →
                    </button></li>
                  )}
                </ul>}
              </div>
  ) : null;

  return (
    <div ref={rootRef} className="flex h-full min-h-0 w-full flex-col bg-white dark:bg-[var(--s-pane)]">
      <div className="relative flex shrink-0 items-center gap-1.5 border-b border-zinc-200 px-3 py-2 dark:border-zinc-800">
        <IconActivity size={14} stroke={2} className="shrink-0 text-mustard-600 dark:text-mustard-400" aria-hidden />
        <span className="mr-auto truncate text-[13px] font-semibold text-zinc-700 dark:text-zinc-200" title={t("learn.mode")}>{t("learn.title")}</span>
        <button type="button" data-cal-toggle onClick={openCal} aria-expanded={calOpen} title={t("learn.calendar")} aria-label={t("learn.calendar")}
          className={`rounded-md p-1 transition ${calOpen || viewDay ? "text-mustard-600 dark:text-mustard-400" : "text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:text-zinc-500 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"}`}>
          <IconCalendar size={14} stroke={2} aria-hidden />
        </button>
        <label className="flex cursor-pointer items-center gap-1 text-[10px] text-zinc-500 dark:text-zinc-400" title={t("learn.autoExplain")}>
          <input type="checkbox" checked={autoExplain} onChange={(e) => setAutoExplain(e.target.checked)} /> {t("learn.autoExplain")}
        </label>
        <span className={`flex items-center gap-1 text-[10px] ${live ? "text-emerald-500" : "text-zinc-400 dark:text-zinc-500"}`}><IconPointFilled size={10} stroke={2} aria-hidden /> {live ? t("learn.live") : t("learn.idle")}</span>
        {calOpen && <CatchupCalendar days={days} selected={viewDay} locale={locale} onPick={pickDay} onClose={closeCal} />}
      </div>
      {/* #1049 카테고리 필터 칩 */}
      <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-zinc-200 px-3 py-1.5 dark:border-zinc-800">
        {([["all", t("learn.filterAll")], ["explain", t("learn.filterExplain")], ...(showCommands ? [["commands", t("learn.filterCommands")]] : []), ["diff", t("learn.filterDiff")], ...(showTerms ? [["terms", t("learn.filterTerms")]] : [])] as [typeof filterSel, string][]).map(([id, label]) => (
          <button key={id} type="button" onClick={() => setFilter(id)} aria-pressed={filter === id}
            className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium transition ${filter === id ? "bg-mustard-500/15 text-mustard-700 dark:text-mustard-400" : "text-zinc-500 hover:bg-zinc-100 hover:text-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"}`}>
            {label}
          </button>
        ))}
        <label className="ml-auto flex min-w-[8rem] flex-1 items-center gap-1 rounded-full border border-zinc-200 px-2 py-0.5 focus-within:border-mustard-500/60 dark:border-zinc-700">
          <IconSearch size={11} stroke={2} className="shrink-0 text-zinc-400" aria-hidden />
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("learn.search")} aria-label={t("learn.search")}
            className="min-w-0 flex-1 bg-transparent text-[11px] text-zinc-700 outline-none placeholder:text-zinc-400 dark:text-zinc-200" />
        </label>
      </div>
      {/* 지난 날 보는 중 안내 바 — 오늘로 복귀(그사이 실시간 항목 바로 보임) */}
      {viewDay && (
        <div className="flex shrink-0 items-center gap-1.5 border-b border-mustard-500/30 bg-mustard-500/10 px-3 py-1.5 text-[11px] text-mustard-700 dark:text-mustard-400">
          <IconCalendar size={12} stroke={2} className="shrink-0" aria-hidden />
          <span className="mr-auto truncate">{t("learn.viewingDay", { date: viewLabel })}</span>
          <button type="button" onClick={() => pickDay(null)} className="flex items-center gap-0.5 rounded-md px-1.5 py-0.5 font-medium hover:bg-mustard-500/15">
            <IconArrowBarToUp size={11} stroke={2} aria-hidden /> {t("learn.backToToday")}
          </button>
        </div>
      )}
      {filter === "all" && glossary && <div className="shrink-0">{glossary}</div>}
      <div ref={listRef} className="nunopi-scroll min-h-0 flex-1 overflow-y-auto">
        {query && found === null && filter !== "terms" ? (
          <div className="flex justify-center py-6"><IconLoader2 size={14} stroke={2} className="animate-spin text-zinc-400" aria-hidden /></div>
        ) : query && !shown.length && !(showTerms && filter !== "explain" && filter !== "commands" && shownTerms.length) ? (
          <p className="px-4 py-6 text-center text-[11px] leading-relaxed text-zinc-400 dark:text-zinc-500">{t("learn.searchEmpty")}</p>
        ) : viewDay && dayItems === null && filter !== "terms" ? (
          <div className="flex justify-center py-6"><IconLoader2 size={14} stroke={2} className="animate-spin text-zinc-400" aria-hidden /></div>
        ) : viewDay && !shown.length && filter !== "terms" ? ( /* 용어집은 날짜 무관 — 지난 날 보기여도 용어 필터면 용어집 */
          <p className="px-4 py-6 text-center text-[11px] leading-relaxed text-zinc-400 dark:text-zinc-500">{t("learn.dayEmpty")}</p>
        ) : !loaded && !concepts.length ? null : !concepts.length && !(showTerms && terms.length) ? (
          <p className="px-4 py-6 text-center text-[11px] leading-relaxed text-zinc-400 dark:text-zinc-500">{t("learn.empty")}</p>
        ) : (
          <>
            {filter === "terms" && glossary}
            {/* 개념 — 등장한 개념 1회씩(중복 없음), 최근 먼저 */}
            {filter !== "terms" && <ul className="flex flex-col gap-2 p-2.5">
              {shown.map((c, i) => { const Icon = KIND_ICON[c.kind] ?? IconActivity; const today = dayOf(c.ts) === dayOf(now || Date.now()); return ( // 미지 kind(구버전/영속 데이터)여도 크래시 안 나게 fallback
                <Fragment key={c.key}>
                {/* #994 날짜 구분선(카톡式) — 최신순 목록에서 날짜가 바뀌는 첫 항목 위 */}
                {(i === 0 || dayOf(shown[i - 1].ts) !== dayOf(c.ts)) && (
                  <li role="separator" className="flex items-center gap-2 py-1">
                    <span className="h-px flex-1 bg-zinc-200 dark:bg-zinc-800" aria-hidden />
                    <span className="rounded-full bg-zinc-100 px-2.5 py-0.5 text-[10px] font-medium text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">{fmtDay(c.ts, locale)}</span>
                    <span className="h-px flex-1 bg-zinc-200 dark:bg-zinc-800" aria-hidden />
                  </li>
                )}
                <li className={`relative rounded-lg border bg-zinc-50/70 dark:bg-zinc-800/40 ${askItem?.key === c.key ? "border-mustard-500/60" : "border-zinc-200 dark:border-zinc-800"}`}>
                  {/* #1056 diff 카드 — 질문 버튼 왼쪽에 "diff 열기"(키에 담긴 커밋·파일) */}
                  {c.kind === "diff" && onOpenDiff && (() => { const d = parseDiffItemKey(c.key); return d ? (
                    <button type="button" onClick={() => onOpenDiff(d.hash, d.file)} title={t("learn.openDiff")} aria-label={t("learn.openDiff")}
                      className="absolute right-8 top-1.5 z-10 rounded-md p-0.5 text-zinc-400 transition hover:bg-zinc-100 hover:text-mustard-600 dark:text-zinc-500 dark:hover:bg-zinc-800 dark:hover:text-mustard-400">
                      <IconExternalLink size={13} stroke={2} aria-hidden />
                    </button>
                  ) : null; })()}
                  {/* #998 이 항목에 질문 — 오른쪽 위, 대화 있으면 질문 수 배지 */}
                  {c.status === "done" && c.expl && (
                    <button type="button" onClick={() => setAskItem(c)} title={t("learn.ask")} aria-label={t("learn.ask")}
                      className={`absolute right-1.5 top-1.5 z-10 flex items-center gap-0.5 rounded-md px-1 py-0.5 text-[10px] transition ${askCounts[c.key] || askItem?.key === c.key ? "text-mustard-600 dark:text-mustard-400" : "text-zinc-300 hover:bg-zinc-100 hover:text-zinc-600 dark:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"}`}>
                      <IconMessageCircle size={13} stroke={2} aria-hidden />{askCounts[c.key] ? <span className="font-semibold">{askCounts[c.key]}</span> : null}
                    </button>
                  )}
                  <button type="button" onClick={() => toggleExpand(c.key)} className={`flex w-full items-start gap-2 py-2 pl-3 text-left ${c.kind === "diff" && onOpenDiff ? "pr-16" : "pr-9"}`}>
                    <Icon size={14} stroke={2} className="mt-0.5 shrink-0 text-mustard-600 dark:text-mustard-400" aria-hidden />
                    <span className="min-w-0 flex-1">
                      <span className="block break-all text-[12px] font-medium text-zinc-700 dark:text-zinc-100">{c.target}</span>
                      <span className="block text-[10px] text-zinc-400 dark:text-zinc-500">{c.kind === "narration" ? fmtDateTime(c.ts) : `${c.tool.replace(/^katchup_/, "")} · ${today ? ago(c.ts, now || c.ts) : fmtDateTime(c.ts)}`}</span>
                    </span>
                    {c.status === "loading" && <IconLoader2 size={12} stroke={2} className="mt-0.5 shrink-0 animate-spin text-zinc-400" aria-hidden />}
                  </button>
                  {(c.status === "done" || c.status === "error") && (
                    <div className="border-t border-zinc-200/70 px-3 py-2 text-[11.5px] leading-relaxed text-zinc-600 dark:border-zinc-800 dark:text-zinc-300">
                      {/* #1060 변경 코드는 제목 바로 밑·설명 위 */}
                      {c.kind === "diff" && (() => { const d = parseDiffItemKey(c.key); return d ? <CatchupDiffCode root={root} hash={d.hash} file={d.file} /> : null; })()}
                      {c.status === "done" ? <Markdown>{c.expl ?? ""}</Markdown> : <span className="text-[10px] text-rose-500">{t("learn.explainError")}</span>}
                    </div>
                  )}
                </li>
                </Fragment>
              ); })}
            </ul>}
          </>
        )}
      </div>
      {/* #998 하단 질문 패널 — 경계선 드래그로 높이 조절 */}
      {askItem && (
        <>
          <div role="separator" aria-orientation="horizontal" aria-label={t("learn.askResize")} onPointerDown={startResize}
            className="h-1.5 shrink-0 cursor-row-resize border-t border-zinc-200 bg-zinc-100 hover:bg-mustard-500/30 dark:border-zinc-800 dark:bg-zinc-900" />
          <div className="flex shrink-0 flex-col" style={{ height: askH }}>
            <CatchupAskPanel root={root} item={{ key: askItem.key, target: askItem.target, expl: askItem.expl ?? "", ts: askItem.ts, kind: askItem.kind }}
              providerId={providerId} providerSettings={providerSettings} onClose={() => setAskItem(null)} onCount={onAskCount} />
          </div>
        </>
      )}
    </div>
  );
}
