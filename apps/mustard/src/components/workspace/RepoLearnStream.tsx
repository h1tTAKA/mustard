"use client";
// 캐치업(#992, 구 학습 스트림 #855·#857) — MCP 연결 에이전트가 뭘 하든(그래프 탐색+파일 편집) 실시간 관찰(SSE) +
// 등장한 "개념"을 중복 없이 1회씩 설명하고, 이해에 필요한 "용어"를 별도 용어집으로 누적. 반복 없이 정리.
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { IconX, IconGitFork, IconCopy, IconArrowUp, IconCode, IconFile, IconSearch, IconSitemap, IconActivity, IconPointFilled, IconLoader2, IconPencil, IconChevronDown, IconBook2, IconBroadcast, IconCalendar, IconArrowBarToUp, IconMessageCircle, IconPlus, IconCheck, IconGitCompare, IconExternalLink, IconGitBranch, IconMessages, IconSend, IconGitCommit, IconLayoutKanban , IconStar, IconStarFilled } from "@tabler/icons-react";
import CatchupCalendar from "@/components/workspace/CatchupCalendar";
import CatchupAskPanel from "@/components/workspace/CatchupAskPanel";
import CatchupDiffCode from "@/components/workspace/CatchupDiffCode";
import { diffSections, groupHunks, parseDiff } from "@/lib/hunkDiff";
import { diffCardMarkdown, sessionCardMarkdown, sessionRawText } from "@/lib/catchupMarkdown";
import CatchupSessionRaw from "@/components/workspace/CatchupSessionRaw";
import { requestTerminalFocus } from "@/components/workspace/TerminalPane";
import { sendToAgent } from "@/lib/browser/sendToAgent";
import { formatSessionHandoff } from "@/lib/sessionHandoff";
import { isDocEdit } from "@/lib/mcpActivity";
import { isNunopiEnabled } from "@/lib/product";
import { mergeTerms, parseNarrationTerms, type Term } from "@/lib/catchupTerms";
import { CATCHUP_ITEM_EVENT, parseDiffItemKey } from "@/lib/useAutoCommitExplain";
import { useT, relocalize, relocalizeFailure, useLocale, useToast, useSetting, withModel, CUKEYS, CATCHUP_DEFAULTS, createChatCard, normalizeCardFront, CARDS_CHANGED_EVENT } from "@mustard/core";
import { CREW_ROLES } from "@/lib/crew/crewTypes";
import { cardMeta, tagMatches, type Facet, type TagType } from "@/lib/catchupMeta";
import { openCrewTask } from "@/components/workspace/crew/CrewChat";
import { useFlyCard, collectCards } from "@mustard/nunopi";
import type { AgentProviderKind, ProviderSettings } from "@mustard/core";
import { Markdown } from "@mustard/core";
import { stripCardBlock } from "@mustard/core";
type ConceptKind = "symbol" | "file" | "query" | "repo" | "edit" | "narration" | "diff" | "session";
interface ActivityEvent { root: string; tool: string; kind: ConceptKind; target: string; isError: boolean; ts: number; note?: string }
interface Concept { key: string; kind: ConceptKind; target: string; tool: string; status: "idle" | "loading" | "done" | "error"; expl?: string; ts: number; wt?: string; br?: string } // #1181 wt·br = 다른 작업 폴더(worktree)에서 쌓인 기록
type StreamEvent = { type: string; message?: string; response?: { summary?: string } };

const KIND_ICON: Record<ConceptKind, typeof IconCode> = { symbol: IconCode, file: IconFile, query: IconSearch, repo: IconSitemap, edit: IconPencil, narration: IconBroadcast, diff: IconGitCompare, session: IconMessages };
const KIND_VERB: Record<ConceptKind, string> = { symbol: "심볼", file: "파일", query: "주제", repo: "레포 구조", edit: "편집 중인 파일", narration: "실시간", diff: "커밋 변경", session: "에이전트 세션" };
const basename = (p: string) => p.split("/").filter(Boolean).pop() ?? p;
// 생성 시점 "MM-DD HH:MM" — 구분선이 있어도 카드 단독으로 날짜가 보이게(유저 요청, #994).
const fmtDateTime = (ts: number) => { const d = new Date(ts); const p = (n: number) => String(n).padStart(2, "0"); return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`; };
// 로컬 날짜 키(서버 파일명과 같은 규칙) — 구분선 그룹 기준.
// 서버 dayKey와 같은 로컬 "YYYY-MM-DD"(#1181 오늘을 날짜로 고를 때)
const todayKey = () => { const d = new Date(), p = (n: number) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };
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
// #1091 출력 언어 = 앱 언어(프롬프트 본문은 한국어여도 답은 이 언어로). [용어] 마커는 파싱용이라 그대로.
const LANG_NAME: Record<string, string> = { ko: "한국어", ja: "일본어(日本語)", en: "영어(English)" };
function conceptPrompt(repo: string, kind: ConceptKind, target: string, withTerms: boolean, loc: string): string {
  return `레포 "${repo}"에서 AI 코딩 에이전트가 지금 ${KIND_VERB[kind]} "${target}"을(를) 다루고 있어.\n`
    + `이게 뭐고 에이전트가 왜 이걸 보는지 개발 초보에게 자연스러운 ${LANG_NAME[loc] ?? "한국어"} 2문장으로.\n`
    + (withTerms
      ? `그 다음 줄에 "[용어]"만(이 마커는 번역하지 말고 그대로) 쓰고, 이 설명을 이해하는 데 필요한 **프로그래밍·개발 용어**(언어 문법·함수·라이브러리·도구·명령어·개발 개념) 2~3개를 "용어 :: 한 줄 뜻" 형식으로 한 줄씩. `
        + `뜻은 ${LANG_NAME[loc] ?? "한국어"}로. 이 앱이 다루는 주제의 도메인 지식(언어학·문자 표준·업무 용어 등)은 넣지 마. 해당 용어가 없으면 "[용어]" 줄 자체를 생략.\n`
      : "")
    + `코드·카드·JSON·메타 발언 금지. 설명은 흐르는 문장으로(사전식 나열 말고).`;
}

// 명령어 카드(#1049) — 에이전트가 왜 했는지 말고 명령 자체를 풀이. 첫 줄 한 문장 요약 + 명령·옵션별 목록.
const isCommand = (c: { kind: ConceptKind; tool: string }) => c.kind === "edit" && c.tool === "Bash";
function commandPrompt(command: string, loc: string): string {
  return `터미널 명령어 하나를 개발 초보에게 풀이해줘:\n${command}\n\n`
    + `첫 줄: 이 명령 전체가 무슨 일을 하는지 ${LANG_NAME[loc] ?? "한국어"} 한 문장(목록의 뜻도 같은 언어로).\n`
    + `그 다음: 쓰인 명령·옵션을 나온 순서대로 "- \`cd\` — 폴더 이동"처럼 한 줄씩(이름은 백틱, 뜻은 짧게). 같은 명령이 반복되면 한 번만.\n`
    + `에이전트가 왜 실행했는지·결과 추측·메타 발언 금지. 코드블록·JSON 금지.`;
}

// 응답 → {설명, 용어[]}. "[용어]" 기준 분리, 카드/펜스 제거.
function parseConcept(raw: string): { expl: string; terms: Term[] } {
  let s = stripCardBlock(raw);
  const cardCut = s.search(/```|nunopi-cards|(^|\n)\s*\[\s*\{\s*"(term|word|title)"/i);
  if (cardCut >= 0) s = s.slice(0, cardCut);
  // "[용어]" 마커(앞 개행 없어도) 기준 분리 — 앞=설명, 뒤=용어 목록.
  const m = s.split(/\[\s*(?:용어|用語|terms?)\s*\]\s*/i);
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

export default function RepoLearnStream({ root, providerId, providerSettings, active = true, agentWorking = false, onOpenDiff, onFocusCommit, chat, chatOpen = false, onToggleChat, jump }: {
  root: string;
  active?: boolean;       // #1043 보이는 레포
  agentWorking?: boolean; // #1043 이 레포 에이전트가 작업 중(숨어 있어도 실시간 해설·설명 큐를 놓치지 않게)
  providerId?: AgentProviderKind;
  providerSettings?: ProviderSettings;
  onOpenDiff?: (hash: string, file: string) => void; // #1056 diff 카드 → 그 커밋·파일 diff 탭
  onFocusCommit?: (hash: string, file?: string) => void; // #1064 세션 카드 → git 그래프에서 그 커밋 짚기
  jump?: { key: string; n: number } | null; // #1081 질문 답변 링크 → 이 카드로 이동·강조
  chat?: ReactNode; chatOpen?: boolean; onToggleChat?: () => void; // #1078 워크스페이스 질문을 캐치업 안에(헤더 버튼으로 전환)
}) {
  const t = useT();
  // #1125 저장된 항목 제목 중 앱이 만든 것(레포 구조·실시간·Crew 역할 이름)은 지금 언어로. 에이전트가 지은 제목은 그대로.
  const targetLabel = (kind: string, target: string) => {
    if (kind === "repo") return relocalize(target, ["stream.repoStructure"], t);
    if (kind !== "narration") return target;
    const whole = relocalize(target, ["stream.live", "stream.liveWork"], t);
    if (whole !== target) return whole;
    const m = /^(.+?)\(([^()]+)\) · ([\s\S]*)$/.exec(target); // Crew 보고 "역할(AI) · 카드"
    return m ? `${relocalize(m[1], CREW_ROLES.map((r) => `crew.role.${r}`), t)}(${m[2]}) · ${m[3]}` : target;
  };
  const { locale } = useLocale();
  // #994 기록은 서버 날짜별 저장소(~/.nunopi/stream)에서 — 마운트 시 최근 100개 로드(loaded 전엔 빈 안내 숨김).
  const [concepts, setConcepts] = useState<Concept[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [terms, setTerms] = useState<Term[]>(() => load<Term>(gKey(root)));
  const [lost, setLost] = useState(false); // #1078 실시간 연결이 몇 초 넘게 끊김(평소엔 표시 없음)
  const [termsOpen, setTermsOpen] = useState(false); // #1076 기본은 무조건 닫힘(다시 들어와도 펼쳐져 있지 않게)
  // #1062 설정 > 캐치업 — 카테고리별 표시(창에 보이기)·분석(새로 만들기). 표시는 렌더, 분석은 cfgRef(콜백)로.
  const explainShow = useSetting<boolean>(CUKEYS.explainShow, CATCHUP_DEFAULTS.explainShow);
  const explainAnalyze = useSetting<boolean>(CUKEYS.explainAnalyze, CATCHUP_DEFAULTS.explainAnalyze);
  const showCommands = useSetting<boolean>(CUKEYS.commandsShow, CATCHUP_DEFAULTS.commandsShow);
  const commandsAnalyze = useSetting<boolean>(CUKEYS.commandsAnalyze, CATCHUP_DEFAULTS.commandsAnalyze);
  const diffShow = useSetting<boolean>(CUKEYS.diffShow, CATCHUP_DEFAULTS.diffShow);
  const sessionsShow = useSetting<boolean>(CUKEYS.sessionsShow, CATCHUP_DEFAULTS.sessionsShow); // #1064
  const showTerms = useSetting<boolean>(CUKEYS.termsShow, CATCHUP_DEFAULTS.termsShow);
  const termsAnalyze = useSetting<boolean>(CUKEYS.termsAnalyze, CATCHUP_DEFAULTS.termsAnalyze);
  const explainProvider = useSetting<string>(CUKEYS.explainProvider, ""); // #1062 카테고리별 AI("" = 워크스페이스 기본)
  const commandsProvider = useSetting<string>(CUKEYS.commandsProvider, "");
  const explainModel = useSetting<string>(CUKEYS.explainModel, ""); // "" = 그 프로바이더 기본 모델
  const commandsModel = useSetting<string>(CUKEYS.commandsModel, "");
  // (실시간 해설 서버 플래그는 WorkspaceView가 보냄 — 캐치업을 끄면 이 패널이 안 떠도 꺼짐을 알려야 해서)
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
  const [filterSel, setFilter] = useState<"all" | "explain" | "commands" | "diff" | "session" | "terms" | "crew" | "ask" | "star">("all"); // #1238 ask·star = 질문·별표 있는 카드(전체 날짜)
  // #1049 검색 — 서버가 전체 날짜에서 제목·설명을 찾음(입력 멈춘 뒤 250ms). 용어집은 화면에서 거름.
  const [q, setQ] = useState("");
  const [searchOpen, setSearchOpen] = useState(false); // #1088 돋보기 버튼 → 입력칸
  const [found, setFound] = useState<Concept[] | null>(null); // null = 검색 중
  const [allFolders, setAllFolders] = useState(false); // #1181 되돌아보기·검색 — 모든 작업 폴더(worktree·지운 것 포함)
  // #1238 검색 기준 — 글자(서버가 제목·설명) / 브랜치·에이전트·커밋(풀다운 최신순 → 고르면 칩 필터와 같은 tag로 전체 날짜에서 모음)
  const [searchBy, setSearchBy] = useState<"text" | TagType>("text");
  const [facetsGot, setFacets] = useState<{ scope: string; v: Record<TagType, Facet[]> } | null>(null);
  const wantFacets = searchOpen && searchBy !== "text";
  useEffect(() => {
    if (!wantFacets) return;
    let alive = true;
    const none = { branch: [], agent: [], hash: [] }, scope = `${root}|${allFolders ? 1 : 0}`;
    fetch(`/api/repo/stream?root=${encodeURIComponent(root)}&facets=1${allFolders ? "&all=1" : ""}`).then((r) => r.json())
      .then((j) => { if (alive) setFacets({ scope, v: j?.ok && j.facets ? (j.facets as Record<TagType, Facet[]>) : none }); })
      .catch(() => { if (alive) setFacets({ scope, v: none }); });
    return () => { alive = false; };
  }, [wantFacets, root, allFolders]);
  // 레포·모든 폴더를 바꾸면 새 값이 올 때까지 "…"(옛 범위 값을 고르지 않게, 리뷰)
  const facets = facetsGot?.scope === `${root}|${allFolders ? 1 : 0}` ? facetsGot.v : null;
  const query = q.trim();
  useEffect(() => {
    if (!query) return;
    let alive = true;
    const tm = setTimeout(() => {
      setFound(null);
      fetch(`/api/repo/stream?root=${encodeURIComponent(root)}&q=${encodeURIComponent(query)}${allFolders ? "&all=1" : ""}`).then((r) => r.json())
        .then((j) => { if (alive) setFound(j?.ok && Array.isArray(j.items) ? (j.items as Omit<Concept, "status">[]).map((x) => ({ ...x, status: "done" as const })) : []); })
        .catch(() => { if (alive) setFound([]); });
    }, 250);
    return () => { alive = false; clearTimeout(tm); };
  }, [query, root, allFolders]);
  const [askCounts, setAskCounts] = useState<Record<string, number>>({});
  const [stars, setStars] = useState<Record<string, number>>({});
  const hasAsk = Object.values(askCounts).some((n) => n > 0), hasStar = Object.keys(stars).length > 0;
  // #1135 Crew 작업(역할 보고·crew/* 브랜치 diff·세션)이 하나라도 있을 때만 Crew 칩
  // tool: diff = "브랜치 · 커밋 제목", 세션 = "에이전트 · 브랜치" — 브랜치 자리만 봄(커밋 제목에 "crew/"가 있어도 안 걸리게, 리뷰)
  const hasCrew = concepts.some((c) => c.tool.startsWith("crew|") || (c.kind === "diff" && c.tool.startsWith("crew/")) || (c.kind === "session" && c.tool.split(" · ")[1]?.startsWith("crew/")));
  const filter = (filterSel === "explain" && !explainShow) || (filterSel === "commands" && !showCommands) || (filterSel === "diff" && !diffShow) || (filterSel === "session" && !sessionsShow) || (filterSel === "terms" && !showTerms) || (filterSel === "crew" && !hasCrew) || (filterSel === "ask" && !hasAsk) || (filterSel === "star" && !hasStar) ? "all" : filterSel;
  // #1238 질문·별표 칩 — 서버에서 전체 날짜로(별표·질문이 바뀌면 다시). 받는 사이엔 지금 목록에서 거른 것도 합쳐 바로 반영.
  const onlyKind = filter === "ask" || filter === "star" ? filter : null;
  const onlyPred = (c: { key: string }) => (onlyKind === "star" ? !!stars[c.key] : (askCounts[c.key] ?? 0) > 0);
  const onlySig = onlyKind ? `${onlyKind}|${allFolders ? 1 : 0}|${Object.keys(onlyKind === "star" ? stars : askCounts).filter((k) => onlyKind === "star" || askCounts[k] > 0).sort().join(",")}` : "";
  const [onlyFound, setOnlyFound] = useState<{ scope: string; items: Concept[] } | null>(null); // scope = 종류|모든 폴더(바꾸면 옛 범위 안 섞이게)
  useEffect(() => {
    if (!onlySig) return;
    let alive = true;
    const [kind, af] = onlySig.split("|"); const scope = `${kind}|${af}`;
    fetch(`/api/repo/stream?root=${encodeURIComponent(root)}&only=${kind}${allFolders ? "&all=1" : ""}`).then((r) => r.json())
      .then((j) => { if (alive) setOnlyFound({ scope, items: j?.ok && Array.isArray(j.items) ? (j.items as Omit<Concept, "status">[]).map((x) => ({ ...x, status: "done" as const })) : [] }); })
      .catch(() => { /* 지금 목록에서 거른 것만 */ });
    return () => { alive = false; };
  }, [onlySig, root, allFolders]);
  const onlySource = onlyKind ? (() => {
    const got = onlyFound?.scope === `${onlyKind}|${allFolders ? 1 : 0}` ? onlyFound.items.filter(onlyPred) : [];
    const have = new Set(got.map((x) => x.key));
    return [...concepts.filter((c) => !have.has(c.key) && onlyPred(c)), ...got].sort((a, b) => b.ts - a.ts);
  })() : null;

  const seenRef = useRef(new Set<string>());                          // 이미 설명한 개념(dedup) — 서버 로드 시 채움
  const queueRef = useRef<string[]>([]);
  const busyRef = useRef(false);
  const metaRef = useRef(new Map<string, { kind: ConceptKind; target: string; tool: string }>());
  const cfgRef = useRef({ providerId, providerSettings, locale, explainAnalyze, commandsAnalyze, termsAnalyze, explainProvider, commandsProvider, explainModel, commandsModel });
  useEffect(() => { cfgRef.current = { providerId, providerSettings, locale, explainAnalyze, commandsAnalyze, termsAnalyze, explainProvider, commandsProvider, explainModel, commandsModel }; }, [providerId, providerSettings, locale, explainAnalyze, commandsAnalyze, termsAnalyze, explainProvider, commandsProvider, explainModel, commandsModel]);

  const explainOne = useCallback(async (key: string) => {
    const meta = metaRef.current.get(key); const { locale: loc } = cfgRef.current;
    if (!meta) return;
    const c = cfgRef.current; const pid = ((isCommand(meta) ? c.commandsProvider : c.explainProvider) || c.providerId) as AgentProviderKind | undefined; // #1062 카테고리별 AI
    if (!pid) return;
    const ps = withModel(c.providerSettings, pid, isCommand(meta) ? c.commandsModel : c.explainModel); // 카테고리별 모델
    setConcepts((p) => p.map((c) => (c.key === key ? { ...c, status: "loading" } : c)));
    try {
      const res = await fetch("/api/agent/analyze", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerId: pid, request: { code: `레포: ${basename(root)}`, locale: loc, providerId: pid, mode: "chat", messages: [{ role: "user", content: isCommand(meta) ? commandPrompt(meta.target, loc) : conceptPrompt(basename(root), meta.kind, meta.target, cfgRef.current.termsAnalyze, loc) }], providerSettings: ps } }),
      });
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
      const reader = res.body.getReader(); const dec = new TextDecoder();
      let buf = "", answer = "", streamErr = "";
      for (;;) { const { done, value } = await reader.read(); if (done) break; buf += dec.decode(value, { stream: true }); const ls = buf.split("\n"); buf = ls.pop() ?? ""; for (const l of ls) { if (!l.trim()) continue; let ev: StreamEvent; try { ev = JSON.parse(l) as StreamEvent; } catch { continue; } if (ev.type === "result") answer = ev.response?.summary ?? ""; else if (ev.type === "error") streamErr = ev.message ?? "error"; } }
      if (streamErr) throw new Error(streamErr);
      const { expl, terms: newTerms } = parseConcept(answer);
      setConcepts((p) => p.map((c) => (c.key === key ? { ...c, status: "done", expl } : c)));
      saveItems(root, [{ key, kind: meta.kind, target: meta.target, tool: meta.tool, ts: Date.now(), expl }]); // #994 날짜별 저장(내레이션은 서버가 직접)
      if (newTerms.length && cfgRef.current.termsAnalyze) setTerms((prev) => mergeTerms(prev, newTerms, normalizeCardFront)); // 상한 없음, 표기 변형까지 중복 제거(#1051)
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
      setConcepts((prev) => [{ ...d.item, status: "done" as const }, ...prev.filter((c) => c.key !== d.item.key)].sort((a, b) => b.ts - a.ts).slice(0, MAX_ITEMS)); // #1068 카드 시각 = 커밋 시각 → 몰아서 만든 카드도 제자리
    };
    window.addEventListener(CATCHUP_ITEM_EVENT, on);
    return () => window.removeEventListener(CATCHUP_ITEM_EVENT, on);
  }, [root]);

  // SSE — 이벤트 → 개념 upsert(중복은 ts/tool만 갱신) + 새 개념이면 설명 큐.
  useEffect(() => {
    if (!root || !connected) return;
    const es = new EventSource(`/api/repo/mcp/activity/stream?root=${encodeURIComponent(root)}`);
    // #1078 끊김은 5초 넘게 이어질 때만 알림(EventSource 자동 재연결의 잠깐 끊김은 무시)
    let lostTimer: ReturnType<typeof setTimeout> | null = null;
    const arm = () => { if (!lostTimer) lostTimer = setTimeout(() => setLost(true), 5000); };
    arm(); // 처음 연결도 5초 안에 안 되면 알림
    es.onopen = () => { if (lostTimer) clearTimeout(lostTimer); lostTimer = null; setLost(false); };
    es.onerror = arm;
    es.onmessage = (m) => {
      let ev: ActivityEvent; try { ev = JSON.parse(m.data) as ActivityEvent; } catch { return; }
      if (!ev?.target) return;
      // #870 실시간 내레이션 — 서버가 이미 설명(note)을 생성해 실었으므로 클라 재분석 없이 done 카드로 바로.
      if (ev.kind === "narration") {
        if (!ev.note) return;
        const nkey = `narration|${ev.ts}|${ev.target}`;                 // ts+제목 = 고유 키(같은 ms 충돌 방지)
        setConcepts((prev) => (prev.some((c) => c.key === nkey) ? prev  // 이미 있으면 스킵(SSE 재연결 replay 중복 방지)
          : [{ key: nkey, kind: "narration" as const, target: ev.target, tool: ev.tool || "narration", status: "done" as const, ts: ev.ts, expl: ev.note }, ...prev].sort((a, b) => b.ts - a.ts).slice(0, MAX_ITEMS))); // #1068 꺼진 동안 재생분은 원래 시각 자리에
        // #1051 실시간 해설 본문의 "용어" 목록도 용어집으로(서버 프롬프트가 개발·IT 용어만 쓰게 함)
        const nt = cfgRef.current.termsAnalyze ? parseNarrationTerms(ev.note) : [];
        if (nt.length) setTerms((prev) => mergeTerms(prev, nt, normalizeCardFront));
        return;
      }
      if (isCommand(ev) ? !cfgRef.current.commandsAnalyze : !cfgRef.current.explainAnalyze) return; // #1062 분석 끔 → 새 카드·설명 안 만듦
      const key = `${ev.kind}|${ev.target}`;
      metaRef.current.set(key, { kind: ev.kind, target: ev.target, tool: ev.tool });
      setConcepts((prev) => { const found = prev.find((c) => c.key === key); if (found) return ev.ts < found.ts ? prev : [{ ...found, tool: ev.tool, ts: ev.ts }, ...prev.filter((c) => c.key !== key)]; /* 재생분(옛 시각)이 최근 카드를 끌어내리지 않게 */ return [{ key, kind: ev.kind, target: ev.target, tool: ev.tool, status: "idle" as const, ts: ev.ts }, ...prev].sort((a, b) => b.ts - a.ts).slice(0, MAX_ITEMS); });
      const cfg = cfgRef.current; if (cfg.providerId) enqueue(key);
    };
    return () => { es.close(); if (lostTimer) clearTimeout(lostTimer); };
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
    fetch(`/api/repo/stream?root=${encodeURIComponent(root)}&days=1${allFolders ? "&all=1" : ""}`).then((r) => r.json())
      .then((j) => { if (j?.ok && Array.isArray(j.days)) setDays(new Set(j.days as string[])); }).catch(() => { /* 오늘만 */ });
  }, [root, calOpen, allFolders]);
  const listRef = useRef<HTMLDivElement>(null);
  const [farDown, setFarDown] = useState(false); // #1076 많이 내려가면 맨 위로 버튼
  const allRef = useRef(false); // pickDay가 최신 토글 값을 읽게(#1181)
  const daySeqRef = useRef(0); // 요청 번호표(#996 리뷰) — 날짜를 빠르게 바꾸면 늦게 온 옛 응답이 새 선택을 덮지 않게
  const pickDay = useCallback((day: string | null) => {
    const seq = ++daySeqRef.current;
    setCalOpen(false);
    setViewDay(day);
    requestAnimationFrame(() => listRef.current?.scrollTo({ top: 0 })); // 날짜 전환·맨 위로 → 최신(맨 위)부터(유저 요청)
    if (!day) return;
    setDayItems(null);
    fetch(`/api/repo/stream?root=${encodeURIComponent(root)}&day=${day}${allRef.current ? "&all=1" : ""}`).then((r) => r.json())
      .then((j) => { if (seq === daySeqRef.current) setDayItems(j?.ok && Array.isArray(j.items) ? (j.items as Omit<Concept, "status">[]).map((x) => ({ ...x, status: "done" as const })) : []); })
      .catch(() => { if (seq === daySeqRef.current) setDayItems([]); });
  }, [root]);
  // #1181 모든 작업 폴더 토글 — 날짜 목록 다시 받고, 보던 날이 있으면 그날도 다시
  const toggleAll = useCallback((v: boolean) => {
    allRef.current = v; setAllFolders(v);
    fetch(`/api/repo/stream?root=${encodeURIComponent(root)}&days=1${v ? "&all=1" : ""}`).then((r) => r.json())
      .then((j) => { if (j?.ok && Array.isArray(j.days)) setDays(new Set(j.days as string[])); }).catch(() => {});
    if (viewDay) pickDay(!v && viewDay === todayKey() ? null : viewDay); // 오늘 전체 보던 중 끄면 이 폴더 실시간으로
    else if (v) pickDay(todayKey()); // 오늘(실시간) 보던 중 켜면 오늘 하루를 레포 전체로(리뷰)
  }, [root, viewDay, pickDay]);
  // #998 항목 질문 — 💬로 고른 항목 + 항목별 질문 수(배지) + 패널 높이(드래그, 기억).
  const [askItem, setAskItem] = useState<Concept | null>(null);
  const [askH, setAskH] = useState(() => { try { const v = Number(localStorage.getItem("nunopi:catchup-ask-h")); return v >= 140 ? v : 300; } catch { return 300; } });
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!root) return;
    fetch(`/api/repo/stream/ask?root=${encodeURIComponent(root)}&counts=1`).then((r) => r.json())
      .then((j) => { if (j?.ok && j.counts) setAskCounts(j.counts as Record<string, number>); }).catch(() => { /* 배지 없이 */ });
  }, [root]);
  const onAskCount = useCallback((key: string, n: number) => setAskCounts((p) => (p[key] === n ? p : { ...p, [key]: n })), []);
  // #1238 별표 — 레포별 서버 저장(stars.json). 누르면 화면은 바로 바뀜. 리뷰 6회 끝에 정리한 규칙:
  //  · 별표 저장·읽기는 한 줄로 차례대로(starChain) — 응답 순서가 클릭 순서와 같아 옛 읽기가 새 저장을 덮을 수 없음.
  //  · 읽은 서버 값엔 아직 줄에서 차례를 기다리는 클릭(starLocal)을 덮어 보여줌.
  //  · 저장 실패면 그 별을 클릭 전으로 되돌리고 서버 값을 다시 읽음(못 읽으면 3초 뒤 2번, 끝내 못 읽으면 알림).
  //  · 요청마다 8초 제한(응답이 안 오면 줄 전체가 멈추지 않게) — 레포가 바뀌면 이 화면은 새로 만들어져(key=path) 줄도 새로.
  const starLocal = useRef(new Map<string, { on: boolean; n: number }>());
  const starN = useRef(0);
  const starChain = useRef<Promise<unknown>>(Promise.resolve());
  const inLine = useCallback(<T,>(f: () => Promise<T>) => { const p = starChain.current.catch(() => {}).then(f); starChain.current = p; return p; }, []);
  const loadStars = useCallback(() => inLine(() => fetch(`/api/repo/stream/star?root=${encodeURIComponent(root)}`, { signal: AbortSignal.timeout(8000) }).then((r) => r.json())
    .then((j) => (j?.ok && j.stars ? (j.stars as Record<string, number>) : null)).catch(() => null)), [root, inLine]);
  const withLocal = (st: Record<string, number>) => { const n = { ...st }; for (const [k, x] of starLocal.current) { if (x.on) n[k] = n[k] ?? Date.now(); else delete n[k]; } return n; };
  const syncStars = useCallback((left: number) => void loadStars().then((st) => {
    if (st) { setStars(withLocal(st)); return; }
    if (left > 0) setTimeout(() => syncStars(left - 1), 3000); else toast(t("learn.starFailed"));
  }), [loadStars, t, toast]); // withLocal은 ref만 읽음
  useEffect(() => {
    let alive = true;
    void loadStars().then((st) => { if (alive && st) setStars(withLocal(st)); });
    return () => { alive = false; };
  }, [loadStars]); // withLocal은 ref만 읽음
  const toggleStar = useCallback((key: string) => {
    const on = !stars[key], n = ++starN.current;
    starLocal.current.set(key, { on, n });
    const show = (v: boolean) => setStars((p) => { const x = { ...p }; if (v) x[key] = x[key] ?? Date.now(); else delete x[key]; return x; });
    show(on);
    void inLine(() => fetch("/api/repo/stream/star", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ root, key, on }), signal: AbortSignal.timeout(8000) }).then((r) => r.json()).catch(() => null))
      .then((j) => {
        const mine = starLocal.current.get(key)?.n === n;
        if (mine) starLocal.current.delete(key); // 그새 또 눌렀으면 그 클릭이 화면을 맡음
        if (j?.ok) return;
        if (mine) show(!on);
        toast(t("learn.starFailed")); setTimeout(() => syncStars(2), 3000); // 시간 초과로 끊은 저장이 서버에선 끝날 수 있어 잠깐 뒤에 읽음(리뷰)
      });
  }, [stars, root, t, toast, syncStars, inLine]);
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
  // #1088 칩 필터 — diff·세션 카드의 [에이전트][⎇ 브랜치][해시] 칩을 누르면 그 값의 diff·세션 카드만(같은 칩 다시·✕로 해제)
  type Tag = { type: "agent" | "branch" | "hash"; value: string };
  const [tag, setTag] = useState<Tag | null>(null);
  const toggleTag = (t2: Tag) => setTag((cur) => (cur && cur.type === t2.type && cur.value === t2.value ? null : t2));
  // #1135 Crew 작업 카드 → 그 Crew 카드 id. 역할 보고 = tool "crew|<id>", diff·세션 = crew/<id8> 브랜치(보드가 앞 8자로 찾음).
  const crewTask = (c: { kind: string; key: string; tool: string }) => {
    if (c.kind === "narration") return c.tool.startsWith("crew|") ? c.tool.slice(5) : null;
    const b = cardMeta(c)?.branch ?? ""; const m = /^crew\/([0-9a-z]{1,8})(?:-|$)/.exec(b);
    return m ? m[1] : null;
  };
  const crewChip = (id: string) => (
    <span role="button" tabIndex={0} title={t("learn.openCrewCard")} aria-label={t("learn.openCrewCard")}
      onClick={(e) => { e.stopPropagation(); openCrewTask(root, id); }}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); openCrewTask(root, id); } }}
      className="inline-flex cursor-pointer items-center gap-0.5 rounded-md bg-zinc-100 px-1.5 py-0.5 text-[10px] font-medium text-zinc-600 transition hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"><IconLayoutKanban size={10} stroke={2} className="shrink-0" aria-hidden />Crew</span>
  );
  const tagMatch = (c: { kind: string; key: string; tool: string }) => !tag || tagMatches(c, tag.type, tag.value);
  // #1238 칩·풀다운 필터는 서버에서 전체 날짜로(예전엔 불러온 최근 100개 안에서만). 받기 전엔 지금 목록에서 거른 것.
  const [tagFound, setTagFound] = useState<{ k: string; items: Concept[] } | null>(null);
  const tagKey = tag ? JSON.stringify([tag.type, tag.value, allFolders]) : ""; // 브랜치 이름에 | 가 있어도 안 잘리게(리뷰)
  useEffect(() => {
    if (!tagKey) return;
    let alive = true;
    const [type, value] = JSON.parse(tagKey) as [string, string];
    fetch(`/api/repo/stream?root=${encodeURIComponent(root)}&tag=${type}&v=${encodeURIComponent(value)}${allFolders ? "&all=1" : ""}`).then((r) => r.json())
      .then((j) => { if (alive) setTagFound({ k: tagKey, items: j?.ok && Array.isArray(j.items) ? (j.items as Omit<Concept, "status">[]).map((x) => ({ ...x, status: "done" as const })) : [] }); })
      .catch(() => { if (alive) setTagFound({ k: tagKey, items: [] }); });
    return () => { alive = false; };
  }, [tagKey, root, allFolders]);
  // 서버 결과 + 그 뒤 실시간으로 들어온 같은 값 카드(최신순, key 중복 제거)
  const tagSource = useMemo(() => {
    if (!tagKey || tagFound?.k !== tagKey) return null;
    const have = new Set(tagFound.items.map((x) => x.key));
    return [...concepts.filter((c) => !have.has(c.key) && tagMatch(c)), ...tagFound.items].sort((a, b) => b.ts - a.ts);
  }, [tagKey, tagFound, concepts]); // eslint-disable-line react-hooks/exhaustive-deps -- tagMatch는 tag(=tagKey)로만 바뀜
  // 칩을 버튼처럼(카드 헤더 버튼 안이라 span + 전파 막기)
  const chipProps = (t2: Tag) => ({ role: "button" as const, tabIndex: 0, title: t("learn.chipFilter"),
    onClick: (e: React.MouseEvent) => { e.stopPropagation(); toggleTag(t2); },
    onKeyDown: (e: React.KeyboardEvent) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); toggleTag(t2); } } });
  const chipOn = (t2: Tag) => (tag && tag.type === t2.type && tag.value === t2.value ? " ring-1 ring-mustard-500/70" : "");
  // #1238 날짜 보기 중 칩은 그날 안에서만(바 문구와 같게, 리뷰), 아니면 칩·질문·별표는 서버 전체 날짜 결과
  const shown = (query ? (found ?? []) : viewDay ? (dayItems ?? []) : tagSource ?? onlySource ?? concepts).filter((c) => (isCommand(c) ? showCommands : c.kind === "diff" ? diffShow : c.kind === "session" ? sessionsShow : explainShow) && !(c.kind === "edit" && isDocEdit(c.tool, c.target)) // #1062 표시 끔 = 분석된 것도 숨김, 문서 편집 카드는 항상 숨김(#1049)
    && (filter === "all" || (filter === "ask" || filter === "star" ? onlyPred(c) : filter === "crew" ? !!crewTask(c) : filter === "commands" ? isCommand(c) : filter === "diff" ? c.kind === "diff" : filter === "session" ? c.kind === "session" : filter === "explain" && !isCommand(c) && c.kind !== "diff" && c.kind !== "session"))).filter(tagMatch);
  // #1064 세션 → 에이전트로 넘기기(인앱 브라우저 피드백과 같은 경로). 카드 하나에 요청 입력창.
  const [handoffKey, setHandoffKey] = useState<string | null>(null);
  const [handoffText, setHandoffText] = useState("");
  const [handoffBusy, setHandoffBusy] = useState(false);
  const sendHandoff = useCallback(async (c: Concept) => {
    if (handoffBusy) return; // 요청은 선택 — 비워도 세션만 공유
    setHandoffBusy(true);
    try {
      const hash = c.key.slice("session|".length);
      const j = await fetch(`/api/repo/session-link?root=${encodeURIComponent(root)}&hash=${encodeURIComponent(hash)}`).then((r) => r.json()).catch(() => null);
      const m = /^(.*) @[0-9a-f]{4,40}$/i.exec(c.target); const cut = c.tool.indexOf(" · ");
      const md = formatSessionHandoff({ request: handoffText, subject: m ? m[1] : c.target, hash, agent: cut >= 0 ? c.tool.slice(0, cut) : c.tool, branch: cut >= 0 ? c.tool.slice(cut + 3) : "", summary: c.expl ?? "", messages: Array.isArray(j?.session?.messages) ? j.session.messages : [] });
      const r = await sendToAgent(root, md);
      if (!r.ok) { toast(t(r.reason === "no-agent" ? "browser.pickNoAgent" : "github.sendFailed")); return; }
      setHandoffKey(null); setHandoffText("");
      requestTerminalFocus(root, r.id); // 보낸 터미널 탭으로
    } finally { setHandoffBusy(false); }
  }, [handoffText, handoffBusy, root, t, toast]);
  // #998 이 항목에 질문 — 대화 있으면 질문 수 배지. #1078 diff·세션은 다른 버튼들과 한 줄(같은 간격)에, 그 밖엔 오른쪽 위 단독
  const askBtn = (c: Concept, alone: boolean) => c.status === "done" && c.expl ? (
    <button type="button" onClick={() => setAskItem(c)} title={t("learn.ask")} aria-label={t("learn.ask")}
      className={`${alone ? "absolute right-1.5 top-1.5 z-10 " : ""}flex items-center gap-0.5 rounded-md p-0.5 text-[10px] transition ${askCounts[c.key] || askItem?.key === c.key ? "text-mustard-600 dark:text-mustard-400" : "text-zinc-300 hover:bg-zinc-100 hover:text-zinc-600 dark:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"}`}>
      <IconMessageCircle size={13} stroke={2} aria-hidden />{askCounts[c.key] ? <span className="font-semibold">{askCounts[c.key]}</span> : null}
    </button>
  ) : null;
  // #1238 별표 — 질문 버튼 왼쪽. 켜짐 = 머스타드 채운 별
  const starBtn = (c: Concept) => c.status === "done" ? (
    <button type="button" onClick={() => toggleStar(c.key)} title={t(stars[c.key] ? "learn.unstar" : "learn.star")} aria-label={t(stars[c.key] ? "learn.unstar" : "learn.star")} aria-pressed={!!stars[c.key]}
      className={`rounded-md p-0.5 transition hover:bg-zinc-100 dark:hover:bg-zinc-800 ${stars[c.key] ? "text-mustard-600 dark:text-mustard-400" : "text-zinc-400 hover:text-mustard-600 dark:text-zinc-500 dark:hover:text-mustard-400"}`}>
      {stars[c.key] ? <IconStarFilled size={13} aria-hidden /> : <IconStar size={13} stroke={2} aria-hidden />}
    </button>
  ) : null;
  // #1081 카드로 이동 — 전체 필터·검색 해제 → 지금 목록에 있으면 그대로, 없으면 서버에서 키로 찾아 그 날짜를 연 뒤 스크롤·2.5초 강조
  const [flashKey, setFlashKey] = useState<string | null>(null);
  const pendingJump = useRef<string | null>(null);
  const jumpN = jump?.n;
  useEffect(() => {
    if (!jump) return;
    setFilter("all"); setQ(""); setTag(null); // eslint-disable-line react-hooks/set-state-in-effect -- 외부 요청(링크 클릭) 시 보기 초기화(#1238 칩도 — 칩 밖 카드면 못 찾음, 리뷰)
    pendingJump.current = jump.key;
    if (concepts.some((c) => c.key === jump.key)) { pickDay(null); return; }
    const key = jump.key;
    fetch(`/api/repo/stream?root=${encodeURIComponent(root)}&key=${encodeURIComponent(key)}`).then((r) => r.json())
      .then((j) => { if (pendingJump.current !== key) return; // 그새 다른 링크를 눌렀으면 옛 응답 무시(#1081 리뷰)
        const it = j?.item as { ts?: number } | null; if (!it?.ts) { pendingJump.current = null; toast(t("learn.cardMissing")); return; }
        const d = new Date(it.ts); const p = (n: number) => String(n).padStart(2, "0"); pickDay(`${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`); })
      .catch(() => { pendingJump.current = null; });
    // 요청 번호(n)가 바뀔 때만
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jumpN]);
  // 목록에 그 카드가 그려지면 스크롤·강조(날짜 불러오기가 끝난 뒤에도 다시 돎)
  useEffect(() => {
    const key = pendingJump.current; if (!key) return;
    const el = listRef.current?.querySelector(`[data-ckey="${CSS.escape(key)}"]`);
    if (!el) return;
    pendingJump.current = null;
    requestAnimationFrame(() => el.scrollIntoView({ behavior: "smooth", block: "center" }));
    setFlashKey(key);
    setTimeout(() => setFlashKey((k) => (k === key ? null : k)), 2500);
  }, [concepts, dayItems, viewDay, filterSel, q]);

  // #1078 카드 → 마크다운 복사. diff = 구간별 줄 범위·바뀐 코드·설명(코드는 git에서), 세션 = 요약 + 원본 대화 전체.
  const copyCard = useCallback(async (c: Concept) => {
    const m = /^(.*) @([0-9a-f]{4,40})$/i.exec(c.target);
    let md = "";
    if (c.kind === "diff") {
      const d = parseDiffItemKey(c.key); if (!d) return;
      const info = c.tool !== "diff" ? c.tool : ""; const cut = info.indexOf(" · ");
      const j = await fetch("/api/repo/git-show", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: root, hash: d.hash, file: d.file }) }).then((r) => r.json()).catch(() => null);
      const hunks = j?.ok ? groupHunks(parseDiff(String(j.diff ?? ""))) : [];
      const secs = diffSections(c.expl ?? "");
      md = diffCardMarkdown({ path: d.file, hash: d.hash, branch: cut >= 0 ? info.slice(0, cut) : info, subject: cut >= 0 ? info.slice(cut + 3) : "", ts: c.ts, expl: c.expl ?? "",
        sections: secs && secs.map((x) => ({ ...x, code: hunks.find((h) => h.newFrom === x.from && h.newTo === x.to)?.diffText })), codes: hunks.map((h) => h.diffText) });
    } else if (c.kind === "session") {
      const hash = c.key.slice("session|".length);
      const j = await fetch(`/api/repo/session-link?root=${encodeURIComponent(root)}&hash=${encodeURIComponent(hash)}`).then((r) => r.json()).catch(() => null);
      const cut = c.tool.indexOf(" · ");
      md = sessionCardMarkdown({ subject: m ? m[1] : c.target, hash, agent: cut >= 0 ? c.tool.slice(0, cut) : c.tool, branch: cut >= 0 ? c.tool.slice(cut + 3) : "", ts: c.ts, summary: c.expl ?? "", messages: j?.session?.messages ?? [] });
    } else return;
    try { await navigator.clipboard.writeText(md); toast(t("learn.copiedMd")); } catch { toast(t("learn.copyFailed")); }
  }, [root, t, toast]);
  // #1238 세션 카드 원본 대화만(요약·머리말 없이) — 다른 에이전트·문서에 그대로 붙이기
  const copyRaw = useCallback(async (c: Concept) => {
    const hash = c.key.slice("session|".length);
    const j = await fetch(`/api/repo/session-link?root=${encodeURIComponent(root)}&hash=${encodeURIComponent(hash)}`).then((r) => r.json()).catch(() => null);
    const text = sessionRawText(Array.isArray(j?.session?.messages) ? j.session.messages : [], Array.isArray(j?.session?.crew) ? j.session.crew : []);
    if (!text) { toast(t(j?.ok ? "learn.copyRawEmpty" : "learn.copyFailed")); return; }
    try { await navigator.clipboard.writeText(text); toast(t("learn.copiedRaw")); } catch { toast(t("learn.copyFailed")); }
  }, [root, t, toast]);
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
        <span className="truncate text-[13px] font-semibold text-zinc-700 dark:text-zinc-200" title={t("learn.mode")}>{t("learn.title")}</span>
        {/* #1078 캘린더는 제목 바로 옆(유저 피드백) */}
        <button type="button" data-cal-toggle onClick={openCal} aria-expanded={calOpen} title={t("learn.calendar")} aria-label={t("learn.calendar")}
          className={`mr-auto inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md transition ${calOpen || viewDay ? "text-mustard-600 dark:text-mustard-400" : "text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:text-zinc-500 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"}`}>
          <IconCalendar size={14} stroke={2} aria-hidden />
        </button>
        {onToggleChat && ( /* #1078 워크스페이스 질문 — 캐치업 안 질문 화면 ↔ 카드 목록. 헤더 오른쪽 끝, 배경 있는 작은 버튼(켜지면 은은한 머스타드) */
          <button type="button" onClick={onToggleChat} aria-pressed={chatOpen} title={t("learn.chat")}
            className={`inline-flex h-5 shrink-0 items-center gap-1 whitespace-nowrap rounded-md px-1.5 text-[11px] font-medium leading-none transition ${chatOpen ? "bg-mustard-500/15 text-mustard-700 dark:text-mustard-400" : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"}`}>
            <IconMessageCircle size={12} stroke={2} aria-hidden />{t("learn.chat")}
          </button>
        )}
        {lost && <span className="flex items-center gap-1 text-[10px] text-rose-500" title={t("learn.disconnected")}><IconPointFilled size={10} stroke={2} aria-hidden /> {t("learn.disconnected")}</span>}
        {calOpen && <CatchupCalendar days={days} selected={viewDay} locale={locale} onPick={pickDay} onClose={closeCal} all={allFolders} onAll={toggleAll} />}
      </div>
      {/* #1078 질문 화면 — 계속 마운트(답변 스트리밍 중 전환해도 안 끊김), 카드 목록과 배타 표시 */}
      {chat && <div className={chatOpen ? "flex min-h-0 flex-1 flex-col" : "hidden"}>{chat}</div>}
      <div className={chatOpen ? "hidden" : "contents"}>
      {/* #1049 카테고리 필터 칩 */}
      <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-zinc-200 px-3 py-1.5 dark:border-zinc-800">
        {([["all", t("learn.filterAll")], ...(explainShow ? [["explain", t("learn.filterExplain")]] : []), ...(showCommands ? [["commands", t("learn.filterCommands")]] : []), ...(diffShow ? [["diff", t("learn.filterDiff")]] : []), ...(sessionsShow ? [["session", t("learn.filterSessions")]] : []), ...(showTerms ? [["terms", t("learn.filterTerms")]] : []), ...(hasCrew ? [["crew", t("learn.filterCrew")]] : []), ...(hasAsk ? [["ask", t("learn.filterAsk")]] : []), ...(hasStar ? [["star", t("learn.filterStar")]] : [])] as [typeof filterSel, string][]).map(([id, label]) => (
          <button key={id} type="button" onClick={() => setFilter(id)} aria-pressed={filter === id}
            className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium transition ${filter === id ? "bg-mustard-500/15 text-mustard-700 dark:text-mustard-400" : "text-zinc-500 hover:bg-zinc-100 hover:text-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"}`}>
            {label}
          </button>
        ))}
        {/* #1088 검색 — 평소엔 돋보기 버튼만, 누르면 입력칸(검색어가 있으면 계속 열림). 비운 채 포커스 잃거나 Esc면 닫힘 */}
        {searchOpen || q ? (
          // #1238 칸 밖으로 포커스가 나갈 때만 닫힘(기준 고르기 풀다운으로 옮겨도 안 닫히게)
          <label className="ml-auto flex min-w-[8rem] flex-1 items-center gap-1 rounded-full border border-zinc-200 px-2 py-0.5 focus-within:border-mustard-500/60 dark:border-zinc-700"
            onBlur={(e) => { if (!q && !e.currentTarget.contains(e.relatedTarget as Node | null)) { setSearchOpen(false); setSearchBy("text"); } }}
            onKeyDown={(e) => { if (e.key === "Escape") { setQ(""); setSearchOpen(false); setSearchBy("text"); } }}>
            <IconSearch size={11} stroke={2} className="shrink-0 text-zinc-400" aria-hidden />
            <select value={searchBy} onChange={(e) => { const b = e.target.value as "text" | TagType; setSearchBy(b); if (b !== "text") setQ(""); }} aria-label={t("learn.searchBy")} title={t("learn.searchBy")}
              className="shrink-0 bg-transparent text-[11px] text-zinc-500 outline-none dark:text-zinc-400">
              {(["text", "branch", "agent", "hash"] as const).map((b) => <option key={b} value={b}>{t(`learn.searchBy.${b}`)}</option>)}
            </select>
            {searchBy === "text" ? (
              <input type="search" autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("learn.search")} aria-label={t("learn.search")}
                className="min-w-0 flex-1 bg-transparent text-[11px] text-zinc-700 outline-none placeholder:text-zinc-400 dark:text-zinc-200" />
            ) : (
              // 고르면 칩 필터와 같은 표시(아래 "필터 ✕")로 — 검색칸은 닫음
              <select value="" autoFocus aria-label={t("learn.searchPick")} onChange={(e) => { const v = e.target.value; if (!v) return; setTag({ type: searchBy, value: v }); setQ(""); setSearchOpen(false); setSearchBy("text"); }}
                className={`min-w-0 flex-1 bg-transparent text-[11px] text-zinc-700 outline-none dark:text-zinc-200 ${searchBy === "hash" ? "font-mono" : ""}`}>
                <option value="">{facets ? (facets[searchBy].length ? t("learn.searchPick") : t("learn.searchNone")) : "…"}</option>
                {facets?.[searchBy].map((f) => <option key={f.value} value={f.value}>{searchBy === "hash" && f.label ? `${f.value} · ${f.label.slice(0, 60)}` : f.value}</option>)}
              </select>
            )}
          </label>
        ) : (
          <button type="button" onClick={() => setSearchOpen(true)} title={t("learn.search")} aria-label={t("learn.search")}
            className="ml-auto rounded-full p-1 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-600 dark:text-zinc-500 dark:hover:bg-zinc-800 dark:hover:text-zinc-300">
            <IconSearch size={13} stroke={2} aria-hidden />
          </button>
        )}
      </div>
      {/* #1088 칩 필터 표시 — ✕로 해제 */}
      {tag && (
        <div className="flex shrink-0 items-center gap-1.5 border-b border-zinc-200 px-3 py-1.5 text-[11px] dark:border-zinc-800">
          <span className="text-zinc-400 dark:text-zinc-500">{t("learn.chipFilterOn")}</span>
          <button type="button" onClick={() => setTag(null)} aria-label={t("learn.chipFilterClear")}
            className="inline-flex min-w-0 items-center gap-1 rounded-full bg-mustard-500/15 px-2 py-0.5 font-medium text-mustard-700 transition hover:bg-mustard-500/25 dark:text-mustard-400">
            {tag.type === "branch" ? <IconGitBranch size={11} stroke={2} className="shrink-0" aria-hidden /> : null}
            <span className={`truncate ${tag.type === "hash" ? "font-mono" : ""}`}>{tag.value}</span>
            <IconX size={11} stroke={2} className="shrink-0" aria-hidden />
          </button>
        </div>
      )}
      {/* 지난 날 보는 중 안내 바 — 오늘로 복귀(그사이 실시간 항목 바로 보임) */}
      {viewDay && (
        <div className="flex shrink-0 items-center gap-1.5 border-b border-mustard-500/30 bg-mustard-500/10 px-3 py-1.5 text-[11px] text-mustard-700 dark:text-mustard-400">
          <IconCalendar size={12} stroke={2} className="shrink-0" aria-hidden />
          {/* #1181 오늘을 '모든 작업 폴더'로 보는 중이면 "오늘 · 모든 작업 폴더" + 이 폴더만(실시간으로), 지난 날이면 예전 그대로 */}
          <span className="mr-auto truncate">{viewDay === todayKey() && allFolders ? `${t("learn.today")} · ${t("learn.allFoldersShort")}` : `${t("learn.viewingDay", { date: viewLabel })}${allFolders ? ` · ${t("learn.allFoldersShort")}` : ""}`}</span>
          {viewDay === todayKey() && allFolders ? (
            <button type="button" onClick={() => toggleAll(false)} className="flex items-center gap-0.5 rounded-md px-1.5 py-0.5 font-medium hover:bg-mustard-500/15">{t("learn.thisFolderOnly")}</button>
          ) : (
            <button type="button" onClick={() => pickDay(null)} className="flex items-center gap-0.5 rounded-md px-1.5 py-0.5 font-medium hover:bg-mustard-500/15">
              <IconArrowBarToUp size={11} stroke={2} aria-hidden /> {t("learn.backToToday")}
            </button>
          )}
        </div>
      )}
      {filter === "all" && glossary && <div className="shrink-0">{glossary}</div>}
      <div className="relative flex min-h-0 flex-1 flex-col">
      <div ref={listRef} onScroll={(e) => { const far = e.currentTarget.scrollTop > 400; if (far !== farDown) setFarDown(far); }} className="nunopi-scroll min-h-0 flex-1 overflow-y-auto">
        {query && found === null && filter !== "terms" ? (
          <div className="flex justify-center py-6"><IconLoader2 size={14} stroke={2} className="animate-spin text-zinc-400" aria-hidden /></div>
        ) : query && !shown.length && !(showTerms && filter !== "explain" && filter !== "commands" && shownTerms.length) ? (
          <p className="px-4 py-6 text-center text-[11px] leading-relaxed text-zinc-400 dark:text-zinc-500">{t("learn.searchEmpty")}</p>
        ) : viewDay && dayItems === null && filter !== "terms" ? (
          <div className="flex justify-center py-6"><IconLoader2 size={14} stroke={2} className="animate-spin text-zinc-400" aria-hidden /></div>
        ) : viewDay && !shown.length && filter !== "terms" ? ( /* 용어집은 날짜 무관 — 지난 날 보기여도 용어 필터면 용어집 */
          <p className="px-4 py-6 text-center text-[11px] leading-relaxed text-zinc-400 dark:text-zinc-500">{t("learn.dayEmpty")}</p>
        ) : !viewDay && !query && !loaded && !concepts.length ? null : !viewDay && !query && !concepts.length && !(showTerms && terms.length) ? ( /* #1181 지난 날·검색 결과가 있으면 실시간 목록이 비어도 그걸 보여 줌(worktree는 실시간이 자주 비어 있음) */
          <p className="px-4 py-6 text-center text-[11px] leading-relaxed text-zinc-400 dark:text-zinc-500">{t("learn.empty")}</p>
        ) : (
          <>
            {filter === "terms" && glossary}
            {/* 개념 — 등장한 개념 1회씩(중복 없음), 최근 먼저 */}
            {filter !== "terms" && <ul className="flex flex-col gap-2 p-2.5">
              {shown.map((c, i) => { const Icon = KIND_ICON[c.kind] ?? IconActivity; return ( // 미지 kind(구버전/영속 데이터)여도 크래시 안 나게 fallback
                <Fragment key={`${c.wt ?? ""}|${c.key}`}>
                {/* #994 날짜 구분선(카톡式) — 최신순 목록에서 날짜가 바뀌는 첫 항목 위 */}
                {(i === 0 || dayOf(shown[i - 1].ts) !== dayOf(c.ts)) && (
                  <li role="separator" className="flex items-center gap-2 py-1">
                    <span className="h-px flex-1 bg-zinc-200 dark:bg-zinc-800" aria-hidden />
                    <span className="rounded-full bg-zinc-100 px-2.5 py-0.5 text-[10px] font-medium text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">{fmtDay(c.ts, locale)}</span>
                    <span className="h-px flex-1 bg-zinc-200 dark:bg-zinc-800" aria-hidden />
                  </li>
                )}
                <li data-ckey={c.key} className={`relative rounded-lg border bg-zinc-50/70 transition-shadow dark:bg-zinc-800/40 ${flashKey === c.key ? "border-mustard-500 ring-2 ring-mustard-500/40" : askItem?.key === c.key ? "border-mustard-500/60" : "border-zinc-200 dark:border-zinc-800"}`}>
                  {/* #1056 diff 카드 — 질문 버튼 왼쪽에 "diff 열기"(키에 담긴 커밋·파일) */}
                  {/* #1066 + git 그래프에서 그 커밋 짚기(세션 카드와 같은 버튼) */}
                  {c.kind === "diff" && (() => { const d = parseDiffItemKey(c.key); return d ? (
                    <span className="absolute right-1.5 top-1.5 z-10 flex items-center gap-0.5">
                      {onFocusCommit && <button type="button" onClick={() => onFocusCommit(d.hash, d.file)} title={t("learn.focusCommit")} aria-label={t("learn.focusCommit")}
                        className="rounded-md p-0.5 text-zinc-400 transition hover:bg-zinc-100 hover:text-mustard-600 dark:text-zinc-500 dark:hover:bg-zinc-800 dark:hover:text-mustard-400"><IconGitCommit size={13} stroke={2} aria-hidden /></button>}
                      {onOpenDiff && <button type="button" onClick={() => onOpenDiff(d.hash, d.file)} title={t("learn.openDiff")} aria-label={t("learn.openDiff")}
                        className="rounded-md p-0.5 text-zinc-400 transition hover:bg-zinc-100 hover:text-mustard-600 dark:text-zinc-500 dark:hover:bg-zinc-800 dark:hover:text-mustard-400"><IconExternalLink size={13} stroke={2} aria-hidden /></button>}
                      {/* #1078 마크다운 복사 */}
                      <button type="button" onClick={() => void copyCard(c)} title={t("learn.copyMd")} aria-label={t("learn.copyMd")}
                        className="rounded-md p-0.5 text-zinc-400 transition hover:bg-zinc-100 hover:text-mustard-600 dark:text-zinc-500 dark:hover:bg-zinc-800 dark:hover:text-mustard-400"><IconCopy size={13} stroke={2} aria-hidden /></button>
                      {starBtn(c)}
                      {askBtn(c, false)}
                    </span>
                  ) : null; })()}
                  {/* #1064 세션 카드 — 에이전트로 보내기 · 그래프에서 커밋 짚기(질문 버튼 왼쪽) */}
                  {c.kind === "session" && c.status === "done" && (
                    <span className="absolute right-1.5 top-1.5 z-10 flex items-center gap-0.5">
                      {onFocusCommit && <button type="button" onClick={() => onFocusCommit(c.key.slice("session|".length))} title={t("learn.focusCommit")} aria-label={t("learn.focusCommit")}
                        className="rounded-md p-0.5 text-zinc-400 transition hover:bg-zinc-100 hover:text-mustard-600 dark:text-zinc-500 dark:hover:bg-zinc-800 dark:hover:text-mustard-400"><IconGitCommit size={13} stroke={2} aria-hidden /></button>}
                      <button type="button" onClick={() => { setHandoffKey((k) => (k === c.key ? null : c.key)); setHandoffText(""); }} title={t("learn.handoffSend")} aria-label={t("learn.handoffSend")} aria-expanded={handoffKey === c.key}
                        className={`rounded-md p-0.5 transition hover:bg-zinc-100 dark:hover:bg-zinc-800 ${handoffKey === c.key ? "text-mustard-600 dark:text-mustard-400" : "text-zinc-400 hover:text-mustard-600 dark:text-zinc-500 dark:hover:text-mustard-400"}`}><IconSend size={13} stroke={2} aria-hidden /></button>
                      {/* #1078 마크다운 복사(요약 + 원본 대화 전체) */}
                      <button type="button" onClick={() => void copyCard(c)} title={t("learn.copyMd")} aria-label={t("learn.copyMd")}
                        className="rounded-md p-0.5 text-zinc-400 transition hover:bg-zinc-100 hover:text-mustard-600 dark:text-zinc-500 dark:hover:bg-zinc-800 dark:hover:text-mustard-400"><IconCopy size={13} stroke={2} aria-hidden /></button>
                      {/* #1238 원본 대화만 복사 */}
                      <button type="button" onClick={() => void copyRaw(c)} title={t("learn.copyRaw")} aria-label={t("learn.copyRaw")}
                        className="rounded-md p-0.5 text-zinc-400 transition hover:bg-zinc-100 hover:text-mustard-600 dark:text-zinc-500 dark:hover:bg-zinc-800 dark:hover:text-mustard-400"><IconMessages size={13} stroke={2} aria-hidden /></button>
                      {starBtn(c)}
                      {askBtn(c, false)}
                    </span>
                  )}
                  {!(c.kind === "diff" && parseDiffItemKey(c.key)) && !(c.kind === "session" && c.status === "done") && c.status === "done" && <span className="absolute right-1.5 top-1.5 z-10 flex items-center gap-0.5">{starBtn(c)}{askBtn(c, false)}</span>}
                  <button type="button" onClick={() => toggleExpand(c.key)} className={`flex w-full items-start gap-2 py-2 pl-3 text-left ${c.kind === "session" ? "pr-36" : c.kind === "diff" ? "pr-32" : "pr-16"}`}>
                    <Icon size={14} stroke={2} className="mt-0.5 shrink-0 text-mustard-600 dark:text-mustard-400" aria-hidden />
                    <span className="min-w-0 flex-1">
                      {/* #1181 모든 작업 폴더 보기 — 어느 worktree(브랜치)에서 쌓인 건지. 메인 것은 표시 없음 */}
                      {allFolders && c.wt && <span title={c.wt} className="mb-0.5 inline-flex max-w-full items-center gap-0.5 truncate rounded-md bg-mustard-500/10 px-1.5 py-0.5 font-mono text-[10px] text-mustard-700 dark:text-mustard-400"><IconGitFork size={10} stroke={2} aria-hidden />{c.br ?? c.wt.split("/").pop()}</span>}
                      {c.kind === "session" ? (() => {
                        // #1064 세션 카드 — 커밋 제목 + [에이전트][⎇ 브랜치][커밋] 칩 + 시각. tool = "에이전트 · 브랜치"
                        const m = /^(.*) @([0-9a-f]{4,40})$/i.exec(c.target); const subject = m ? m[1] : c.target; const hash = m?.[2];
                        const cut = c.tool.indexOf(" · "); const agent = cut >= 0 ? c.tool.slice(0, cut) : c.tool; const branch = cut >= 0 ? c.tool.slice(cut + 3) : "";
                        return (<>
                          <span className="block break-words text-[12px] font-medium text-zinc-700 dark:text-zinc-100">{subject}</span>
                          <span className="mt-1 flex flex-wrap items-center gap-1">
                            {agent && <span {...chipProps({ type: "agent", value: agent })} className={`cursor-pointer rounded-md bg-blue-500/10 px-1.5 py-0.5 text-[10px] font-medium text-blue-700 transition hover:bg-blue-500/20 dark:text-blue-300${chipOn({ type: "agent", value: agent })}`}>{agent}</span>}
                            {branch && <span {...chipProps({ type: "branch", value: branch })} className={`inline-flex max-w-full cursor-pointer items-center gap-0.5 truncate rounded-md bg-zinc-100 px-1.5 py-0.5 text-[10px] font-medium text-zinc-600 transition hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700${chipOn({ type: "branch", value: branch })}`}><IconGitBranch size={10} stroke={2} className="shrink-0" aria-hidden /><span className="truncate">{branch}</span></span>}
                            {hash && <span {...chipProps({ type: "hash", value: hash })} className={`cursor-pointer rounded-md bg-mustard-500/10 px-1.5 py-0.5 font-mono text-[10px] text-mustard-700 transition hover:bg-mustard-500/20 dark:text-mustard-400${chipOn({ type: "hash", value: hash })}`}>{hash}</span>}
                            {(() => { const id = crewTask(c); return id ? crewChip(id) : null; })()}
                            <span className="text-[10px] text-zinc-400 dark:text-zinc-500">{fmtDateTime(c.ts)}</span>
                          </span>
                        </>);
                      })() : c.kind === "diff" ? (() => {
                        // #1062 diff 카드 — 파일명 강조 + [브랜치][커밋] 칩 + 커밋 제목(2줄) + 시각. tool = "브랜치 · 커밋 제목"(옛 카드는 "diff")
                        const m = /^(.*) @([0-9a-f]{4,40})$/i.exec(c.target); const path = m ? m[1] : c.target; const hash = m?.[2];
                        const info = c.tool !== "diff" ? c.tool : ""; const cut = info.indexOf(" · ");
                        const branch = cut >= 0 ? info.slice(0, cut) : info; const subject = cut >= 0 ? info.slice(cut + 3) : "";
                        const slash = path.lastIndexOf("/");
                        return (<>
                          <span className="block break-all text-[12px] font-medium text-zinc-700 dark:text-zinc-100">
                            {slash >= 0 && <span className="font-normal text-zinc-400 dark:text-zinc-500">{path.slice(0, slash + 1)}</span>}{path.slice(slash + 1)}
                          </span>
                          <span className="mt-1 flex flex-wrap items-center gap-1">
                            {branch && <span {...chipProps({ type: "branch", value: branch })} className={`inline-flex max-w-full cursor-pointer items-center gap-0.5 truncate rounded-md bg-zinc-100 px-1.5 py-0.5 text-[10px] font-medium text-zinc-600 transition hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700${chipOn({ type: "branch", value: branch })}`}><IconGitBranch size={10} stroke={2} className="shrink-0" aria-hidden /><span className="truncate">{branch}</span></span>}
                            {hash && <span {...chipProps({ type: "hash", value: hash })} className={`cursor-pointer rounded-md bg-mustard-500/10 px-1.5 py-0.5 font-mono text-[10px] text-mustard-700 transition hover:bg-mustard-500/20 dark:text-mustard-400${chipOn({ type: "hash", value: hash })}`}>{hash}</span>}
                            {(() => { const id = crewTask(c); return id ? crewChip(id) : null; })()}
                            <span className="text-[10px] text-zinc-400 dark:text-zinc-500">{fmtDateTime(c.ts)}</span>
                          </span>
                          {subject && <span className="mt-1 line-clamp-2 text-[11px] leading-snug text-zinc-500 dark:text-zinc-400">{subject}</span>}
                        </>);
                      })() : (<>
                      <span className="block break-all text-[12px] font-medium text-zinc-700 dark:text-zinc-100">{targetLabel(c.kind, c.target)}</span>
                      {(() => { const id = crewTask(c); return id ? <span className="mt-1 flex flex-wrap items-center gap-1">{crewChip(id)}<span className="text-[10px] text-zinc-400 dark:text-zinc-500">{fmtDateTime(c.ts)}</span></span> : null; })()
                        ?? <span className="block text-[10px] text-zinc-400 dark:text-zinc-500">{/* #1060 모든 카드 = 기록 날짜·시각 */}{c.kind === "narration" ? fmtDateTime(c.ts) : `${c.tool.replace(/^katchup_/, "")} · ${fmtDateTime(c.ts)}`}</span>}
                      </>)}
                    </span>
                    {c.status === "loading" && <IconLoader2 size={12} stroke={2} className="mt-0.5 shrink-0 animate-spin text-zinc-400" aria-hidden />}
                  </button>
                  {(c.status === "done" || c.status === "error") && (
                    <div className="border-t border-zinc-200/70 px-3 py-2 text-[11.5px] leading-relaxed text-zinc-600 dark:border-zinc-800 dark:text-zinc-300">
                      {/* #1060 변경 코드는 제목 바로 밑·설명 위 */}
                      {/* #1066 새 카드(구간 표지 있음)는 구간마다 아래에서 따로 — 여긴 옛 카드만 */}
                      {c.kind === "diff" && !(c.status === "done" && diffSections(c.expl ?? "")) && (() => { const d = parseDiffItemKey(c.key); return d ? <CatchupDiffCode root={root} hash={d.hash} file={d.file} /> : null; })()}
                      {/* #1064 세션 원본 대화도 제목 밑·요약 위 */}
                      {c.kind === "session" && handoffKey === c.key && ( /* 에이전트에게 넘길 요청 — ⌘Enter 보내기 */
                        <div className="mb-2 flex flex-col gap-1.5 rounded-md border border-mustard-500/40 p-1.5">
                          <textarea autoFocus value={handoffText} onChange={(e) => setHandoffText(e.target.value)} rows={3} placeholder={t("learn.handoffPlaceholder")}
                            onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && !e.nativeEvent.isComposing) { e.preventDefault(); void sendHandoff(c); } if (e.key === "Escape") setHandoffKey(null); }}
                            className="w-full resize-none rounded border border-zinc-200 bg-white px-2 py-1 text-[11.5px] text-zinc-800 outline-none focus:border-mustard-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100" />
                          <div className="flex justify-end gap-1.5">
                            <button type="button" onClick={() => setHandoffKey(null)} className="rounded-md px-2 py-0.5 text-[11px] text-zinc-500 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800">{t("common.cancel")}</button>
                            <button type="button" onClick={() => void sendHandoff(c)} disabled={handoffBusy}
                              className="rounded-md bg-mustard-500 px-2 py-0.5 text-[11px] font-medium text-zinc-900 transition hover:bg-mustard-400 disabled:opacity-50">{t("learn.handoffSend")}</button>
                          </div>
                        </div>
                      )}
                      {c.kind === "session" && c.key.startsWith("session|") && <CatchupSessionRaw root={root} hash={c.key.slice(8)} />}
                      {c.status === "done" ? (() => {
                        // #1066 diff 구간별: [N~M번째 줄 ▸ 그 구간 코드 펼치기] + 설명. 한 파일 여러 변경이 한 카드여도 어느 설명이 어느 줄인지 보임
                        const d = c.kind === "diff" ? parseDiffItemKey(c.key) : null; const secs = d ? diffSections(c.expl ?? "") : null;
                        if (!d || !secs) return <Markdown>{relocalizeFailure(c.expl ?? "", t)}</Markdown>;
                        return secs.map((sec, i) => (
                          <div key={i} className={i > 0 ? "mt-3 border-t border-zinc-200/70 pt-2 dark:border-zinc-800" : ""}>
                            <CatchupDiffCode root={root} hash={d.hash} file={d.file} range={sec}
                              label={sec.from === sec.to ? t("learn.diffLine", { n: sec.from }) : t("learn.diffLines", { from: sec.from, to: sec.to })} />
                            <Markdown>{sec.text}</Markdown>
                          </div>
                        ));
                      })() : <span className="text-[10px] text-rose-500">{t("learn.explainError")}</span>}
                    </div>
                  )}
                </li>
                </Fragment>
              ); })}
            </ul>}
          </>
        )}
      </div>
      {farDown && ( /* #1076 맨 위로 — 한참 내려 본 뒤 한 번에 최신(맨 위)으로 */
        <button type="button" onClick={() => listRef.current?.scrollTo({ top: 0, behavior: "smooth" })} title={t("learn.scrollTop")} aria-label={t("learn.scrollTop")}
          className="absolute bottom-3 right-3 z-20 rounded-full border border-zinc-200 bg-white/95 p-1.5 text-zinc-500 shadow-md backdrop-blur transition hover:text-mustard-600 dark:border-zinc-700 dark:bg-zinc-900/95 dark:text-zinc-400 dark:hover:text-mustard-400">
          <IconArrowUp size={15} stroke={2} aria-hidden />
        </button>
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
    </div>
  );
}
