"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { IconFolder, IconTrash, IconLoader2, IconSparkles, IconAlertTriangle, IconX, IconBookmarkFilled } from "@tabler/icons-react";
import { StarIcon } from "./icons";
import type { AgentAnalyzeResponse, AgentProviderKind, AnalyzeMode } from "../../lib/agent";
import type { HistoryEntry } from "../../lib/historyDB";
import type { Collection } from "../../lib/collections";
import {
  type BookmarkedTokenDetail,
  type BookmarkedTermDetail,
  type BookmarkedConceptDetail,
  saveTokenDetail,
  removeTokenDetail,
  loadTokenDetails,
  clearTokenDetails,
  saveTermDetail,
  removeTermDetail,
  loadTermDetails,
  clearTermDetails,
  saveConceptDetail,
  removeConceptDetail,
  loadConceptDetails,
  backfillTokenSource,
  backfillTermSource,
  backfillConceptSource,
  bookmarkedTermExists,
} from "@mustard/core";
import type { CodeToken, ConceptOccurrence, ItConcept, ItTerm } from "@mustard/core";
import AnalysisHistory from "../translator/AnalysisHistory";
import TokenDictionary from "./TokenDictionary";
import ItTermDictionary from "./ItTermDictionary";
import ConceptDictionary from "./ConceptDictionary";
import ConceptSection from "./ConceptSection";
import { conceptShort } from "./conceptDescriptions";
import LineExplanationList from "./LineExplanationList";
import ResizableBody from "./ResizableBody";
import { useConfirm, CKEYS } from "@mustard/core";
import { useToast } from "@mustard/core";
import { CARDS_CHANGED_EVENT } from "@mustard/core";
import { useT, useLocale } from "@mustard/core";
import TokenSection from "./TokenSection";
import ItTermSection from "./ItTermSection";
import ItConceptSection from "./ItConceptSection";
import { dedupeConcepts, dedupeTokens } from "../../lib/agent/dedupe";
import { formatResultAsHtml } from "../../lib/exportHtml";
import { reanchorLineNumbers, remapLines } from "../../lib/reanchorLines";
import { isCommentOnlyLine } from "../../lib/isCommentLine";
import { formatDuration } from "../../lib/formatDuration";

const BOOKMARKS_KEY = "nunopi:bookmark-tokens";
const TERM_BOOKMARKS_KEY = "nunopi:bookmark-terms";
const CONCEPT_BOOKMARKS_KEY = "nunopi:bookmark-concepts";

type TFn = (key: string, vars?: Record<string, string | number>) => string;

function formatResultAsMarkdown(result: AgentAnalyzeResponse, t: TFn): string {
  const heading = result.mode === "text" ? t("export.headingText") : t("export.headingCode");
  const lines = [
    `# ${heading} (provider: ${result.providerId})`,
    `${t("export.metaLanguage")}: ${result.language}`,
    "",
    `## ${t("export.summary")}`,
    result.summary,
  ];

  if (result.lineExplanations.length > 0) {
    lines.push("", `## ${t("export.lineExplanations")}`);
    for (const item of result.lineExplanations) {
      const escapedCode = item.code.replaceAll("`", "\\`");
      lines.push("", `### ${t("panel.lineN", { n: item.line })}`, `\`${escapedCode}\``, item.explanation);
    }
  }

  if (result.warnings.length > 0) {
    lines.push("", `## ${t("export.warnings")}`);
    for (const w of result.warnings) {
      lines.push(`- [${w.code}] ${w.message}`);
    }
  }

  return lines.join("\n");
}

interface LearningPanelProps {
  providerId: AgentProviderKind;
  mode?: AnalyzeMode;
  isLoading: boolean;
  // PARTIAL_PARSE 경고에서 "빠진 구간만 다시 분석"(resume) 트리거. 없으면 버튼 미표시.
  onResumePartial?: () => void;
  progressLine?: string;
  analysisStartedAt?: number | null; // 진행 중 실시간 경과 타이머용 시작 시각(ms).
  elapsedMs?: number | null; // 직전 분석 총 소요시간(ms) — 완료 메타 표시용.
  chunkProgress?: { done: number; total: number } | null; // 청크 진행률(막대바). 단일 호출이면 null.
  errorMessage: string | null;
  result: AgentAnalyzeResponse | null;
  activeLine?: number | null;
  activeLineSource?: "editor" | "panel";
  onLineFocus?: (line: number) => void;
  // 누락 줄 채우기(#633) — 설명 없는 줄 클릭 시 그 줄만 타겟 분석.
  onFillLine?: (line: number) => void;
  fillModalLine?: number | null;   // page 소유 — 열린 모달 대상 줄(null=닫힘)
  onCloseFillModal?: () => void;
  fillErrorLine?: number | null;
  // 책갈피(#639) — 핀 줄 + 토글.
  pinnedLine?: number | null;
  onPinLine?: (line: number) => void;
  // 글 원문에서 클릭한 IT 용어 id — 그 용어 카드로 스크롤(글 모드).
  activeTermId?: string | null;
  // 토큰 호버/클릭으로 에디터에서 강조할 코드 줄들을 상위(page)에 올린다.
  onMarkLines?: (lines: number[]) => void;
  // 제외(차단) 목록 — 표시에서 숨길 토큰/용어 텍스트. page에서 관리.
  excludedTerms?: string[];
  onExclude?: (mode: AnalyzeMode, text: string) => void;
  // 토큰 사전은 분석 시 범용 토큰(token/category/lines)으로 자동 채워지고, 뜻은 카드 클릭 시
  // on-demand로 받는다(#505). explainingTokens는 로딩 표시용(토큰 텍스트). 삭제는 카드 제거용.
  explainingTokens?: string[];
  // 반환: 받아온 뜻(label/description/example). 북마크 시 설명 붙여 저장하는 데 쓴다(#509).
  onTokenExplain?: (text: string) => void | Promise<{ label: string; description: string; example?: string } | null>;
  onDeleteToken?: (text: string) => void;
  // lazy 개념 설명 — 설명 없는 개념 클릭 시 on-demand 설명 요청.
  // 반환: 받아온 설명 문자열. 북마크 시 설명 붙여 저장하는 데 쓴다(#533, 토큰과 동일).
  explainingConcepts?: string[];
  onConceptExplain?: (conceptId: string, title: string) => void | Promise<string | null>;
  onDeleteConcept?: (conceptId: string) => void;
  code: string;
  historyEntries?: HistoryEntry[];
  onRestoreHistory?: (entry: HistoryEntry) => void;
  onDeleteHistory?: (id: string) => void;
  onClearHistory?: () => void;
  onUpdateHistory?: (id: string, changes: Partial<Pick<HistoryEntry, "isPinned" | "title">>) => void;
  currentHistoryId?: string | null;
  currentHistoryTitle?: string;
  currentHistoryIsPinned?: boolean;
  onSetCurrentTitle?: (title: string) => void;
  onToggleCurrentPin?: () => void;
  // 사용자 목록(카테고리)
  collections?: Collection[];
  activeCollectionId?: string | null;
  onSelectCollection?: (id: string | null) => void;
  onCreateCollection?: (name: string) => string;
  onDeleteCollection?: (id: string) => void;
  onToggleEntryCollection?: (entryId: string, collectionId: string) => void;
}

export default function LearningPanel({
  providerId,
  mode = "code",
  isLoading,
  onResumePartial,
  progressLine = "",
  analysisStartedAt = null,
  elapsedMs = null,
  chunkProgress = null,
  errorMessage,
  result,
  code,
  activeLine = null,
  activeLineSource,
  onLineFocus,
  onFillLine,
  fillModalLine = null,
  onCloseFillModal,
  fillErrorLine = null,
  pinnedLine = null,
  onPinLine,
  activeTermId = null,
  onMarkLines,
  excludedTerms = [],
  onExclude,
  explainingTokens = [],
  onTokenExplain,
  onDeleteToken,
  explainingConcepts = [],
  onConceptExplain,
  onDeleteConcept,
  historyEntries = [],
  onRestoreHistory,
  onDeleteHistory,
  onClearHistory,
  onUpdateHistory,
  currentHistoryId,
  currentHistoryTitle,
  currentHistoryIsPinned = false,
  onSetCurrentTitle,
  onToggleCurrentPin,
  collections,
  activeCollectionId,
  onSelectCollection,
  onCreateCollection,
  onDeleteCollection,
  onToggleEntryCollection,
}: LearningPanelProps) {
  const confirm = useConfirm();
  const toast = useToast();
  const t = useT();
  const { locale } = useLocale();
  const dateLocale = locale === "ja" ? "ja-JP" : locale === "en" ? "en-US" : "ko-KR";
  const nonEmptyLineCount = code.trim().split(/\r?\n/).filter(Boolean).length;

  // 분석 중 실시간 경과 타이머 — 1초마다 갱신. interval 콜백 setState라 set-state-in-effect 무관.
  const [nowTick, setNowTick] = useState(0);
  useEffect(() => {
    if (!isLoading || analysisStartedAt == null) return;
    const id = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(id);
  }, [isLoading, analysisStartedAt]);
  // 첫 tick(1s) 전엔 nowTick=0이거나 이전 분석값 → startedAt보다 작아 max(0,..)로 0초 표시.
  // 이후 1초마다 실제 경과. 음수만 클램프하면 충분(nowTick은 늘 startedAt 이후 시각으로 갱신).
  const liveElapsedMs =
    isLoading && analysisStartedAt != null ? Math.max(0, nowTick - analysisStartedAt) : 0;
  // 히스토리는 현재 모드 항목만 보여 코드/글이 섞이지 않게 한다.
  const modeHistoryEntries = historyEntries.filter((e) => (e.mode ?? "code") === mode);
  // 히스토리(IndexedDB)에서 복원한 옛 결과는 dedupe 이전 데이터라 중복
  // 토큰/개념을 담고 있을 수 있다 → 렌더 시점에도 방어적으로 중복 제거한다.
  const dedupedTokens = useMemo(() => dedupeTokens(result?.tokens ?? []), [result]);
  const dedupedConcepts = useMemo(() => dedupeConcepts(result?.concepts ?? []), [result]);
  // LLM이 매긴 줄번호는 부정확 → code 텍스트로 실제 행번호에 재앵커. lineMap으로
  // 토큰/개념의 lines도 같이 보정해, 줄 링크·토큰 하이라이트가 실제 코드와 일치하게 한다.
  const reanchor = useMemo(
    () => reanchorLineNumbers(code, result?.lineExplanations ?? []),
    [code, result],
  );
  const anchoredLineExplanations = reanchor.lineExplanations;

  // 누락 줄 채우기(#635) — 설명 없는 코드 줄을 에디터서 클릭하면 모달 띄우고 자동 분석.
  // 모달 상태(fillModalLine)는 page가 소유 — 채우기 성공/실패를 아는 곳이 직접 열고 닫아야
  // 결정적(reanchor 재배치로 대상 줄번호가 어긋나도 무한 스피너 안 됨, #637).
  const autoFiredRef = useRef<number | null>(null); // 이 줄 자동 발동 1회 가드
  // 에디터 클릭 → 채울 수 있는(빈줄·주석·기존설명 아님) 줄이면 fillLine 자동 발동(page가 모달 연다).
  useEffect(() => {
    if (!onFillLine || activeLine == null || isLoading || activeLineSource !== "editor") return;
    const codeLine = code.split(/\r?\n/)[activeLine - 1] ?? "";
    if (!codeLine.trim() || isCommentOnlyLine(codeLine)) return;      // 빈줄·주석은 원래 설명 없음
    if (anchoredLineExplanations.some((le) => le.line === activeLine)) return; // 이미 설명 있음
    if (autoFiredRef.current === activeLine) return;                  // 이 줄 이미 발동
    autoFiredRef.current = activeLine;
    onFillLine(activeLine);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 클릭(activeLine/source) 변화에만 발동
  }, [activeLine, activeLineSource, isLoading]);
  // 모달 닫히면(page가 성공/취소로 fillModalLine=null) 자동발동 가드 리셋 → 재클릭 가능.
  useEffect(() => { if (fillModalLine == null) autoFiredRef.current = null; }, [fillModalLine]);
  const safeTokens = useMemo(
    () => dedupedTokens.map((t) => ({ ...t, lines: remapLines(t.lines, reanchor.lineMap) })),
    [dedupedTokens, reanchor],
  );
  const safeConcepts = useMemo(
    () => dedupedConcepts.map((c) => ({ ...c, lines: remapLines(c.lines ?? [], reanchor.lineMap) })),
    [dedupedConcepts, reanchor],
  );
  const [activeTab, setActiveTab] = useState<"analysis" | "history" | "dictionary" | "concept-dictionary">("analysis");
  const [activeTokenIds, setActiveTokenIds] = useState<string[]>([]);
  // 토큰 호버 시 임시 강조 줄(떼면 null). 에디터 하이라이트는 hover ?? 클릭고정.
  const [hoverLines, setHoverLines] = useState<number[] | null>(null);
  // 클릭으로 고정된 토큰(activeTokenIds)의 줄들.
  const pinnedLines = useMemo(
    () =>
      safeTokens
        .filter((t) => activeTokenIds.includes(t.id))
        .flatMap((t) => t.lines),
    [safeTokens, activeTokenIds],
  );
  // 에디터에 강조할 줄: 호버 중엔 호버 우선, 떼면 클릭 고정으로 복귀.
  const markedLines = hoverLines ?? pinnedLines;
  const markedKey = markedLines.join(",");
  useEffect(() => {
    onMarkLines?.(markedKey ? markedKey.split(",").map(Number) : []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [markedKey]);
  // 활성(강조) 개념 id들 — 코드 모드는 1개([conceptId]), 글 모드는 용어의 관련 개념 전부.
  const [activeConceptIds, setActiveConceptIds] = useState<string[]>([]);
  const [bookmarkedTokenTexts, setBookmarkedTokenTexts] = useState<string[]>([]);
  const [bookmarkedTokenDetails, setBookmarkedTokenDetails] = useState<Record<string, BookmarkedTokenDetail>>({});
  // 글 모드 IT 용어 북마크 — detail(카드)과 별(즐겨찾기 flag)을 분리(#519, 토큰과 동일).
  // texts = 별 flag(localStorage TERM_BOOKMARKS_KEY). 별 꺼도 detail(카드)은 유지.
  const [bookmarkedTermDetails, setBookmarkedTermDetails] = useState<Record<string, BookmarkedTermDetail>>({});
  const [bookmarkedTermTexts, setBookmarkedTermTexts] = useState<string[]>([]);
  // 개념 북마크 — 키 = 개념 title. detail/별 분리.
  const [bookmarkedConceptDetails, setBookmarkedConceptDetails] = useState<Record<string, BookmarkedConceptDetail>>({});
  const [bookmarkedConceptTitles, setBookmarkedConceptTitles] = useState<string[]>([]);
  const [filterBookmarked, setFilterBookmarked] = useState(false);
  const [copied, setCopied] = useState(false);
  const [headerEditing, setHeaderEditing] = useState(false);
  const [headerTitle, setHeaderTitle] = useState(currentHistoryTitle ?? "");
  // 제목 헤더의 "목록에 담기" 인라인 패널 열림 여부 + 새 목록 이름 입력.
  const [headerCollMenu, setHeaderCollMenu] = useState(false);
  const [headerNewColl, setHeaderNewColl] = useState("");

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  // 에디터에서 줄 클릭(source "editor") 시 그 줄 설명 카드로 스크롤.
  // 패널 자체 스크롤(source "panel")로 생긴 변경엔 재스크롤하지 않는다(루프 차단).
  useEffect(() => {
    if (activeLine == null || activeLineSource !== "editor") return;
    const el = document.getElementById(`nunopi-line-${activeLine}`);
    el?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [activeLine, activeLineSource]);

  // 글 원문에서 용어를 클릭하면(activeTermId) 분석 탭으로 전환 — ItTermSection이
  // 거기 있어야 그 카드로 스크롤된다(다른 탭이면 안 보임).
  useEffect(() => {
    // 다른 탭에 있으면 분석 탭으로 전환해야 용어 카드가 보인다. effect 내 동기 setState라
    // set-state-in-effect 룰에 걸리지만, prop(activeTermId) 변화에 반응하는 의도된 전환이다.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (activeTermId) setActiveTab("analysis");
  }, [activeTermId]);

  // 글 모드로 바뀌면 코드 전용 '개념 사전' 탭에서 빠져나온다(글 모드엔 그 탭이 없음).
  useEffect(() => {
    if (mode === "text" && activeTab === "concept-dictionary") {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setActiveTab("analysis");
    }
  }, [mode, activeTab]);


  async function handleCopyResult() {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(formatResultAsMarkdown(result, t));
      setCopied(true);
    } catch { /* ignore — clipboard may be unavailable */ }
  }

  async function handleExportHtml() {
    if (!result) return;
    const html = await formatResultAsHtml(result, code, currentHistoryTitle, t, dateLocale);
    const datePart = new Date(result.createdAt).toISOString().slice(0, 10).replaceAll("-", "");
    const titlePart = (currentHistoryTitle?.trim() || t("export.fileDefault"))
      .replaceAll(/[\\/:*?"<>|]/g, "")
      .slice(0, 40);
    const filename = `nunopi-${titlePart}-${datePart}.html`;
    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  useEffect(() => {
    // 별 flag 로드. term/concept은 flag store가 없던 시절 카드가 있을 수 있어(마이그레이션),
    // 저장된 flag가 없으면(null) 기존 detail 키로 시드한다(기존 카드는 별 켜진 채 시작).
    const loadFlags = (key: string, detailKeys: string[]): string[] => {
      try {
        const raw = localStorage.getItem(key);
        if (raw) return JSON.parse(raw) as string[];
      } catch { /* ignore */ }
      return detailKeys;
    };
    try {
      const raw = localStorage.getItem(BOOKMARKS_KEY);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (raw) setBookmarkedTokenTexts(JSON.parse(raw) as string[]);
    } catch { /* ignore */ }
    const td = loadTokenDetails();
    const rd = loadTermDetails();
    const cd = loadConceptDetails();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setBookmarkedTokenDetails(td);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setBookmarkedTermDetails(rd);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setBookmarkedConceptDetails(cd);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setBookmarkedTermTexts(loadFlags(TERM_BOOKMARKS_KEY, Object.keys(rd)));
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setBookmarkedConceptTitles(loadFlags(CONCEPT_BOOKMARKS_KEY, Object.keys(cd)));
  }, []);

  useEffect(() => {
    // 카드가 밖에서 바뀌면 detail(카드) 표시만 갱신한다. 별(북마크)은 건드리지 않는다 — 별과
    // 카드는 양방향으로 완전 분리(#519): 별을 꺼도 카드 유지, 카드를 지워도 별 유지.
    const refresh = () => {
      setBookmarkedTokenDetails(loadTokenDetails());
      setBookmarkedTermDetails(loadTermDetails());
      setBookmarkedConceptDetails(loadConceptDetails());
    };
    window.addEventListener(CARDS_CHANGED_EVENT, refresh);
    return () => window.removeEventListener(CARDS_CHANGED_EVENT, refresh);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setActiveTokenIds([]);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setActiveConceptIds([]);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setFilterBookmarked(false);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setHoverLines(null);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (result) setActiveTab("analysis");
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCopied(false);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setHeaderTitle(currentHistoryTitle ?? "");
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setHeaderEditing(false);
    // result.createdAt 기준 — on-demand 토큰 append(같은 createdAt)엔 리셋 안 함(활성/스크롤 보존).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result?.createdAt]);

  // 현재 항목이 바뀌면(복원/저장 등) 목록 메뉴를 닫는다 — createdAt 안 바뀌는 경로(첫 저장
  // null→id)까지 커버. result.createdAt 효과의 다른 리셋엔 영향 안 주려 별도 effect로 분리.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setHeaderCollMenu(false);
    // 입력도 비운다 — 안 그러면 다른 항목 메뉴 열 때 이전 입력 텍스트가 남는다.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setHeaderNewColl("");
  }, [currentHistoryId]);

  // 북마크에 담을 "출처"(분석 제목) — 저장된 히스토리 제목 우선, 없으면 결과 자체 제목.
  function bookmarkSourceTitle(): string | undefined {
    return currentHistoryTitle?.trim() || result?.title?.trim() || undefined;
  }

  // 북마크에 담을 "출처 id"(분석 히스토리 id) — 나중에 카드에서 그 분석으로 이동할 때 쓴다.
  function bookmarkSourceId(): string | undefined {
    return currentHistoryId ?? undefined;
  }

  // 출처 소급 채움 — 이 분석에 등장한 북마크 중 sourceTitle이 없는 것(예전에 담은 것)을
  // 현재 분석 제목으로 채운다. 최초 출처 보존(이미 값 있으면 유지).
  useEffect(() => {
    const title = currentHistoryTitle?.trim() || result?.title?.trim();
    if (!title || !result) return;
    let changed = false;
    const id = currentHistoryId ?? undefined;
    for (const tk of result.tokens ?? []) if (backfillTokenSource(tk.token, title, id)) changed = true;
    for (const c of result.concepts ?? []) if (backfillConceptSource(c.title, title, id)) changed = true;
    for (const tm of result.terms ?? []) if (backfillTermSource(tm.term, title, id)) changed = true;
    for (const ic of result.itConcepts ?? []) if (backfillTermSource(ic.title, title, id)) changed = true;
    if (changed) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setBookmarkedTokenDetails(loadTokenDetails());
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setBookmarkedConceptDetails(loadConceptDetails());
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setBookmarkedTermDetails(loadTermDetails());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result, currentHistoryTitle, currentHistoryId]);

  // 별(즐겨찾기) 토글. 별과 카드는 분리한다(#509): 별을 켜면 카드가 없을 때만 새로 만들고,
  // 별을 끄면 카드는 그대로 두고 별 flag만 뗀다(카드 삭제는 갤러리에서만). 별↔카드 완전 분리(#519).
  async function handleBookmarkToggle(token: CodeToken) {
    const tokenText = token.token;
    const isStarred = bookmarkedTokenTexts.includes(tokenText);
    const setStar = (on: boolean) =>
      setBookmarkedTokenTexts((prev) => {
        const next = on
          ? (prev.includes(tokenText) ? prev : [...prev, tokenText])
          : prev.filter((tk) => tk !== tokenText);
        try { localStorage.setItem(BOOKMARKS_KEY, JSON.stringify(next)); } catch { /* ignore */ }
        if (next.length === 0) setFilterBookmarked(false);
        return next;
      });

    if (isStarred) {
      // 별 끄기 — 카드는 유지, 별 flag만 제거.
      setStar(false);
      return;
    }
    // 별 켜기 — 카드가 이미 있으면(자기/크로스소스 #511) 생성은 안 하되 북마크(별)는 켜고 안내(#519).
    if (bookmarkedTermExists(tokenText)) {
      setStar(true);
      toast(t("card.existsBookmarked"));
      return;
    }
    // 카드 없음 → 새로 만든다(설명 없으면 먼저 받아 붙임) + 별.
    let toSave = token;
    if (!token.description && onTokenExplain) {
      const meaning = await onTokenExplain(tokenText);
      if (meaning) toSave = { ...token, label: meaning.label, description: meaning.description, example: meaning.example };
    }
    saveTokenDetail(toSave, bookmarkSourceTitle(), bookmarkSourceId());
    setBookmarkedTokenDetails(loadTokenDetails());
    if (typeof window !== "undefined") window.dispatchEvent(new Event(CARDS_CHANGED_EVENT));
    toast(t("card.added", { term: tokenText }));
    setStar(true);
  }

  // 용어 별 flag 토글. 별 OFF는 flag만, 카드(detail) 유지(별↔카드 분리). term/it-concept 공유.
  const setTermStar = (key: string, on: boolean) =>
    setBookmarkedTermTexts((prev) => {
      const next = on ? (prev.includes(key) ? prev : [...prev, key]) : prev.filter((k) => k !== key);
      try { localStorage.setItem(TERM_BOOKMARKS_KEY, JSON.stringify(next)); } catch { /* ignore */ }
      if (next.length === 0) setFilterBookmarked(false);
      return next;
    });

  // 글 모드 IT 용어 북마크 토글 — 토큰과 동일 디커플링(#519): 별 켜면 카드 없을 때만 생성(토스트),
  // 별 끄면 카드 유지·flag만 제거. 크로스소스 중복이면 스킵(#511).
  function handleTermBookmarkToggle(term: ItTerm) {
    const key = term.term;
    if (bookmarkedTermTexts.includes(key)) { setTermStar(key, false); return; }
    if (bookmarkedTermExists(key)) { setTermStar(key, true); toast(t("card.existsBookmarked")); return; }
    saveTermDetail(term, bookmarkSourceTitle(), bookmarkSourceId());
    setBookmarkedTermDetails(loadTermDetails());
    if (typeof window !== "undefined") window.dispatchEvent(new Event(CARDS_CHANGED_EVENT));
    toast(t("card.added", { term: key }));
    setTermStar(key, true);
  }

  // 글 모드 관련 개념 북마크 — 개념을 용어로 변환해 IT 용어 사전에 같이 저장(title 기준). term store 공유.
  function handleItConceptBookmarkToggle(concept: ItConcept) {
    const key = concept.title;
    if (bookmarkedTermTexts.includes(key)) { setTermStar(key, false); return; }
    if (bookmarkedTermExists(key)) { setTermStar(key, true); toast(t("card.existsBookmarked")); return; }
    const asTerm: ItTerm = { id: concept.conceptId, term: concept.title, explanation: concept.explanation, conceptIds: [], bookmarkable: true };
    saveTermDetail(asTerm, bookmarkSourceTitle(), bookmarkSourceId());
    setBookmarkedTermDetails(loadTermDetails());
    if (typeof window !== "undefined") window.dispatchEvent(new Event(CARDS_CHANGED_EVENT));
    toast(t("card.added", { term: key }));
    setTermStar(key, true);
  }

  function handleTokenClick(tokenId: string, conceptId: string | undefined) {
    if (activeTokenIds.length === 1 && activeTokenIds[0] === tokenId) {
      setActiveTokenIds([]);
      setActiveConceptIds([]);
    } else {
      setActiveTokenIds([tokenId]);
      setActiveConceptIds(conceptId ? [conceptId] : []);
    }
  }

  // 개념 북마크 토글(코드 모드) — 토큰과 동일 디커플링(#519). 키=title.
  async function handleConceptBookmarkToggle(concept: ConceptOccurrence) {
    const key = concept.title;
    const setStar = (on: boolean) =>
      setBookmarkedConceptTitles((prev) => {
        const next = on ? (prev.includes(key) ? prev : [...prev, key]) : prev.filter((k) => k !== key);
        try { localStorage.setItem(CONCEPT_BOOKMARKS_KEY, JSON.stringify(next)); } catch { /* ignore */ }
        if (next.length === 0) setFilterBookmarked(false);
        return next;
      });
    if (bookmarkedConceptTitles.includes(key)) { setStar(false); return; } // 별 끄기 — 카드 유지
    if (bookmarkedTermExists(key)) { setStar(true); toast(t("card.existsBookmarked")); return; } // 카드 이미 존재 → 별만
    // 카드 없음 → 새로 만든다. 설명 없으면 정적 사전/에이전트에서 받아 붙여 "설명없음" 방지(#533, 토큰과 동일).
    let toSave = concept;
    if (!concept.description) {
      const desc = conceptShort(concept.conceptId, locale) ?? (onConceptExplain ? await onConceptExplain(concept.conceptId, concept.title) : null);
      if (desc) toSave = { ...concept, description: desc };
    }
    saveConceptDetail(toSave, bookmarkSourceTitle(), bookmarkSourceId());
    setBookmarkedConceptDetails(loadConceptDetails());
    if (typeof window !== "undefined") window.dispatchEvent(new Event(CARDS_CHANGED_EVENT));
    toast(t("card.added", { term: key }));
    setStar(true);
  }

  function handleConceptClick(conceptId: string) {
    // 설명은 상시 노출(#535)이라 열닫 토글 없음. 클릭 = 관련 토큰 하이라이트 + 설명 없으면 on-demand 요청.
    const relatedTokenIds = (result?.tokens ?? [])
      .filter((t) => t.conceptId === conceptId)
      .map((t) => t.id);
    setActiveConceptIds([conceptId]);
    setActiveTokenIds(relatedTokenIds);
    const concept = safeConcepts.find((c) => c.conceptId === conceptId);
    if (concept && !concept.description && !conceptShort(conceptId, locale)) {
      void onConceptExplain?.(conceptId, concept.title); // 반환 Promise 의도적 무시(클릭 = 설명 로드만)
    }
  }

  // 글 모드: 용어 클릭 → 관련 개념 전부 강조 + 첫 개로 스크롤. 같은 세트 재클릭이면 해제(토글).
  function handleTermClick(conceptIds: string[]) {
    if (conceptIds.length === 0) return;
    setActiveConceptIds((prev) => {
      const sameSet =
        prev.length === conceptIds.length && prev.every((id) => conceptIds.includes(id));
      return sameSet ? [] : conceptIds;
    });
  }

  function saveHeaderTitle() {
    setHeaderEditing(false);
    onSetCurrentTitle?.(headerTitle);
  }

  // 헤더 목록 패널: 새 목록 만들어 현재 분석을 거기에 담는다(AnalysisHistory와 동일).
  function submitHeaderCreateCollection() {
    const name = headerNewColl.trim();
    if (!name || !currentHistoryId) return;
    const id = onCreateCollection?.(name);
    setHeaderNewColl("");
    if (id) onToggleEntryCollection?.(currentHistoryId, id);
  }

  const currentEntry = currentHistoryId
    ? historyEntries.find((e) => e.id === currentHistoryId)
    : undefined;

  const entryHeader = currentHistoryId ? (
    <div className="min-w-0">
    <div className="flex items-center gap-2 min-w-0">
      {/* 고정 버튼: 로고 라임 반짝임. 핀=채움, 비핀=외곽선. */}
      <button
        type="button"
        onClick={onToggleCurrentPin}
        className={`shrink-0 leading-none transition ${
          currentHistoryIsPinned
            ? "text-lime-600 dark:text-lime-400"
            : "text-zinc-400 hover:text-lime-600 dark:text-zinc-500 dark:hover:text-lime-400"
        }`}
        title={currentHistoryIsPinned ? t("analysis.unpin") : t("analysis.pin")}
        aria-label={currentHistoryIsPinned ? t("analysis.unpin") : t("analysis.pinThis")}
      >
        <StarIcon filled={currentHistoryIsPinned} className="h-[18px] w-[18px]" />
      </button>
      {/* 제목 — 클릭 시 인라인 편집 */}
      {headerEditing ? (
        <input
          type="text"
          autoFocus
          value={headerTitle}
          onChange={(e) => setHeaderTitle(e.target.value)}
          onBlur={saveHeaderTitle}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); saveHeaderTitle(); }
            if (e.key === "Escape") { setHeaderEditing(false); setHeaderTitle(currentHistoryTitle ?? ""); }
          }}
          className="flex-1 min-w-0 rounded-lg border border-blue-300 bg-white px-2 py-1 text-sm font-medium text-zinc-800 outline-none dark:border-blue-600 dark:bg-zinc-900 dark:text-zinc-100"
          aria-label={t("analysis.editTitle")}
        />
      ) : (
        <button
          type="button"
          onClick={() => { setHeaderTitle(currentHistoryTitle ?? ""); setHeaderEditing(true); }}
          className="flex-1 min-w-0 truncate text-left text-sm font-semibold text-zinc-800 hover:text-blue-600 dark:text-zinc-100 dark:hover:text-blue-400"
          title={t("analysis.clickToEditTitle")}
        >
          {currentHistoryTitle || t("panel.titleNone")}
        </button>
      )}
      {/* 목록에 담기 */}
      {onToggleEntryCollection && (
        <button
          type="button"
          onClick={() => setHeaderCollMenu((v) => !v)}
          className={`shrink-0 rounded-lg px-1.5 py-1 text-xs transition ${
            headerCollMenu || (currentEntry?.collectionIds?.length ?? 0) > 0
              ? "bg-blue-100 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300"
              : "text-zinc-400 hover:bg-zinc-200 hover:text-zinc-600 dark:text-zinc-500 dark:hover:bg-zinc-700 dark:hover:text-zinc-300"
          }`}
          title={t("analysis.addToList")}
          aria-label={t("analysis.addThisToList")}
        >
          <IconFolder size={15} stroke={2} aria-hidden />
        </button>
      )}
      {/* 현재 분석 삭제 */}
      {onDeleteHistory && (
        <button
          type="button"
          onClick={async () => {
            if (await confirm({ skipKey: CKEYS.skipDelete, message: t("confirm.deleteAnalysis"), confirmText: t("common.delete"), danger: true })) onDeleteHistory(currentHistoryId);
          }}
          className="shrink-0 rounded-lg px-1.5 py-1 text-xs text-zinc-400 transition hover:bg-red-100 hover:text-red-600 dark:text-zinc-500 dark:hover:bg-red-950/40 dark:hover:text-red-400"
          title={t("analysis.deleteThis")}
          aria-label={t("analysis.deleteThis")}
        >
          <IconTrash size={15} stroke={2} aria-hidden />
        </button>
      )}
    </div>
    {/* 목록 멤버십 인라인 패널 (AnalysisHistory와 동일 패턴) */}
    {headerCollMenu && onToggleEntryCollection && (
      <div className="mt-2 space-y-1.5 rounded-lg border border-zinc-200 bg-white p-2 dark:border-zinc-700 dark:bg-zinc-950">
        <p className="text-xs text-zinc-400 dark:text-zinc-500">{t("panel.addToCollection")}</p>
        {(collections?.length ?? 0) === 0 && (
          <p className="text-xs text-zinc-400 dark:text-zinc-500">{t("panel.noCollectionsHint")}</p>
        )}
        <div className="flex flex-wrap gap-1.5">
          {(collections ?? []).map((c) => {
            const inIt = (currentEntry?.collectionIds ?? []).includes(c.id);
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => onToggleEntryCollection(currentHistoryId, c.id)}
                className={`rounded-lg px-2 py-0.5 text-xs transition ${
                  inIt
                    ? "bg-blue-500 text-white"
                    : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
                }`}
              >
                {inIt ? "✓ " : ""}{c.name}
              </button>
            );
          })}
        </div>
        {onCreateCollection && (
          <input
            type="text"
            value={headerNewColl}
            onChange={(e) => setHeaderNewColl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.nativeEvent.isComposing) { e.preventDefault(); submitHeaderCreateCollection(); }
              if (e.key === "Escape") { setHeaderNewColl(""); setHeaderCollMenu(false); }
            }}
            placeholder={t("history.createAndAdd")}
            className="w-full rounded-lg border border-zinc-200 bg-zinc-50 px-2 py-1 text-xs text-zinc-700 outline-none focus:border-blue-300 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200"
          />
        )}
      </div>
    )}
    </div>
  ) : null;

  const tabBar = (
    <div className="flex gap-1 rounded-xl border border-zinc-200 bg-zinc-100 p-1 dark:border-zinc-800 dark:bg-zinc-900">
      <button
        type="button"
        onClick={() => setActiveTab("analysis")}
        className={`flex-1 rounded-lg py-1.5 text-xs font-medium transition ${
          activeTab === "analysis"
            ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-800 dark:text-zinc-50"
            : "text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
        }`}
      >
        {t("panel.tabLearning")}
      </button>
      <button
        type="button"
        onClick={() => setActiveTab("history")}
        className={`flex-1 rounded-lg py-1.5 text-xs font-medium transition ${
          activeTab === "history"
            ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-800 dark:text-zinc-50"
            : "text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
        }`}
      >
        {t("panel.tabHistory")}{modeHistoryEntries.length > 0 ? ` ${modeHistoryEntries.length}` : ""}
      </button>
      <button
        type="button"
        onClick={() => setActiveTab("dictionary")}
        className={`flex-1 rounded-lg py-1.5 text-xs font-medium transition ${
          activeTab === "dictionary"
            ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-800 dark:text-zinc-50"
            : "text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
        }`}
      >
        {mode === "text" ? t("panel.itTermDict") : t("panel.tokenDict")}
        {(() => {
          const n = mode === "text" ? bookmarkedTermTexts.length : Object.keys(bookmarkedTokenDetails).length;
          return n > 0 ? ` ${n}` : "";
        })()}
      </button>
      {mode !== "text" && (
        <button
          type="button"
          onClick={() => setActiveTab("concept-dictionary")}
          className={`flex-1 rounded-lg py-1.5 text-xs font-medium transition ${
            activeTab === "concept-dictionary"
              ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-800 dark:text-zinc-50"
              : "text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
          }`}
        >
          {t("panel.tabConceptDict")}{bookmarkedConceptTitles.length > 0 ? ` ${bookmarkedConceptTitles.length}` : ""}
        </button>
      )}
    </div>
  );

  if (activeTab === "concept-dictionary" && mode !== "text") {
    return (
      <div className="nunopi-scroll h-full p-6 space-y-4 overflow-y-scroll">
        {entryHeader}
        {tabBar}
        <ConceptDictionary
          details={bookmarkedConceptDetails}
          onUnbookmark={(title) => {
            // 사전 X = 카드 삭제. 별은 유지(별↔카드 분리). detail 제거 + 이벤트(갤러리/배지 갱신).
            removeConceptDetail(title);
            setBookmarkedConceptDetails(loadConceptDetails());
            if (typeof window !== "undefined") window.dispatchEvent(new Event(CARDS_CHANGED_EVENT));
          }}
        />
      </div>
    );
  }

  if (activeTab === "dictionary") {
    return (
      <div className="nunopi-scroll h-full p-6 space-y-4 overflow-y-scroll">
        {entryHeader}
        {tabBar}
        {mode === "text" ? (
          <ItTermDictionary
            details={bookmarkedTermDetails}
            onUnbookmark={(termText) => {
              // 사전 X = 카드 삭제. 별은 유지(별↔카드 분리). detail 제거 + 이벤트(갤러리/배지 갱신).
              removeTermDetail(termText);
              setBookmarkedTermDetails(loadTermDetails());
              if (typeof window !== "undefined") window.dispatchEvent(new Event(CARDS_CHANGED_EVENT));
            }}
          />
        ) : (
          <TokenDictionary
            details={bookmarkedTokenDetails}
            onUnbookmark={(tokenText) => {
              // 사전의 X = 카드 삭제. 별(북마크)은 유지(카드⊥별 완전 분리 #519). detail 제거 + 이벤트.
              removeTokenDetail(tokenText);
              setBookmarkedTokenDetails(loadTokenDetails());
              if (typeof window !== "undefined") window.dispatchEvent(new Event(CARDS_CHANGED_EVENT));
            }}
          />
        )}
      </div>
    );
  }

  if (activeTab === "history") {
    return (
      <div className="nunopi-scroll h-full p-6 space-y-4 overflow-y-scroll">
        {entryHeader}
        {tabBar}
        {onRestoreHistory && onDeleteHistory && onClearHistory ? (
          <AnalysisHistory
            entries={modeHistoryEntries}
            onRestore={onRestoreHistory}
            onDelete={onDeleteHistory}
            onClear={onClearHistory}
            onUpdate={onUpdateHistory}
            alwaysOpen
            collections={collections}
            activeCollectionId={activeCollectionId}
            onSelectCollection={onSelectCollection}
            onCreateCollection={onCreateCollection}
            onDeleteCollection={onDeleteCollection}
            onToggleEntryCollection={onToggleEntryCollection}
          />
        ) : (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">{t("panel.historyEmpty")}</p>
        )}
      </div>
    );
  }

  return (
    <div className="h-full p-6 space-y-4">
      {entryHeader}
      {tabBar}
      <div className="space-y-1">
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          {t("panel.currentProvider")}: <span className="font-medium text-zinc-700 dark:text-zinc-200">{t(`provider.${providerId}`)}</span>
        </p>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4 text-sm text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300">
          {mode === "text"
            ? t("panel.inputText", { n: code.trim().length })
            : t("panel.inputCode", { n: nonEmptyLineCount })}
        </div>
        <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4 text-sm text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300">
          {t("panel.status")}: {isLoading ? t("panel.stAnalyzing") : result ? t("panel.stResult") : errorMessage ? t("panel.stError") : t("panel.stIdle")}
        </div>
      </div>

      {isLoading ? (
        <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <div className="flex items-center gap-3">
            <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-zinc-300 border-t-zinc-600 dark:border-zinc-600 dark:border-t-zinc-200" />
            <span className="text-sm text-zinc-600 dark:text-zinc-300">
              {t("panel.spinAnalyzing")}{analysisStartedAt != null ? ` ${formatDuration(liveElapsedMs, locale)}` : ""}
              {chunkProgress && chunkProgress.total > 0
                ? t("panel.chunk", { done: chunkProgress.done, total: chunkProgress.total })
                : ""}
              {mode === "text" && result
                ? ` · ${
                    result.summary.trim()
                      ? t("panel.progSummary")
                      : (result.itConcepts?.length ?? 0) > 0
                        ? t("panel.progConcept", { n: result.itConcepts!.length })
                        : (result.terms?.length ?? 0) > 0
                          ? t("panel.progTerm", { n: result.terms!.length })
                          : t("panel.progTermExtract")
                  }`
                : ""}
            </span>
          </div>
          {chunkProgress && chunkProgress.total > 0 ? (
            <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-700">
              <div
                className="h-full rounded-full bg-blue-500 transition-all duration-300 dark:bg-blue-400"
                style={{ width: `${Math.round((chunkProgress.done / chunkProgress.total) * 100)}%` }}
              />
            </div>
          ) : mode === "text" ? (
            // 글 모드는 용어/개념 총 개수를 미리 모른다(% 막대 불가) → 미확정(움직이는) 막대로
            // "멈춘 게 아니라 진행 중"만 시각화.
            <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-700">
              <div className="h-full w-2/5 animate-pulse rounded-full bg-blue-500 dark:bg-blue-400" />
            </div>
          ) : progressLine ? (
            <p className="mt-2 truncate font-mono text-xs text-zinc-400 dark:text-zinc-500">
              {progressLine}
            </p>
          ) : null}
        </div>
      ) : null}

      {errorMessage ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-950 dark:bg-red-950/30 dark:text-red-300">
          {errorMessage}
        </div>
      ) : null}

      {result ? (
        <div className="space-y-4">
          <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-900">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex shrink-0 items-center gap-2">
                <span className="inline-flex shrink-0 items-center whitespace-nowrap rounded-lg bg-zinc-200 px-2 py-0.5 text-xs font-medium text-zinc-700 dark:bg-zinc-700 dark:text-zinc-200">
                  {result.mode === "text" ? t("panel.textLabel") : result.language}
                </span>
                <p className="whitespace-nowrap text-sm font-medium text-zinc-900 dark:text-zinc-50">
                  {t("panel.summary")}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  onClick={() => { void handleCopyResult(); }}
                  className="rounded-lg px-2 py-1 text-xs text-zinc-500 transition hover:bg-zinc-200 hover:text-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-700 dark:hover:text-zinc-200"
                  aria-label={t("analysis.copyResult")}
                >
                  {copied ? t("panel.copied") : t("panel.copyResult")}
                </button>
                <button
                  type="button"
                  onClick={() => { void handleExportHtml(); }}
                  className="rounded-lg px-2 py-1 text-xs text-zinc-500 transition hover:bg-zinc-200 hover:text-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-700 dark:hover:text-zinc-200"
                  aria-label={t("analysis.exportHtml")}
                  title={t("analysis.exportHtmlHint")}
                >
                  {t("panel.saveHtml")}
                </button>
              </div>
            </div>
            {result.summary.trim() ? (
              <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-300">
                {result.summary}
              </p>
            ) : isLoading ? (
              <p className="mt-2 text-sm italic text-zinc-400 dark:text-zinc-500">
                {t("panel.summaryPending")}
              </p>
            ) : (
              <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-300">
                {result.summary}
              </p>
            )}
            <div className="mt-3 flex flex-wrap gap-3 text-xs text-zinc-400 dark:text-zinc-500">
              <span>{new Date(result.createdAt).toLocaleString(dateLocale)}</span>
              {result.usage?.inputTokens != null && (
                <span>{t("panel.tokensInput", { n: result.usage.inputTokens })}</span>
              )}
              {result.usage?.outputTokens != null && (
                <span>{t("panel.tokensOutput", { n: result.usage.outputTokens })}</span>
              )}
              {elapsedMs != null && <span>{t("panel.elapsed", { d: formatDuration(elapsedMs, locale) })}</span>}
              {result.usage?.estimatedCostUsd != null && (
                <span>${result.usage.estimatedCostUsd.toFixed(4)}</span>
              )}
            </div>
          </div>

          {result.warnings.length > 0 && (
            <div className="space-y-2">
              {result.warnings.map((warning, i) => {
                const colorClass =
                  warning.code === "PARSE_FAILED"
                    ? "border-red-200 bg-red-50 text-red-700 dark:border-red-950 dark:bg-red-950/30 dark:text-red-300"
                    : warning.code === "TOO_LONG"
                      ? "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-950 dark:bg-blue-950/30 dark:text-blue-300"
                      : "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-950 dark:bg-amber-950/30 dark:text-amber-300";
                // PARTIAL_PARSE는 빠진 구간만 다시 채울 수 있다(resume) — 전체 재분석 대신
                // 그 구간만. 메시지에서 구간 수를 뽑아 버튼 라벨에 쓴다(숫자만 파싱 → 언어 무관).
                const isPartial = warning.code === "PARTIAL_PARSE";
                const missingCount = isPartial ? Number(warning.message.match(/\d+/)?.[0] ?? 0) : 0;
                return (
                  <div
                    key={i}
                    className={`rounded-2xl border p-4 text-sm ${colorClass}`}
                  >
                    <span className="font-medium">[{warning.code}]</span>{" "}
                    {warning.message}
                    {isPartial && onResumePartial && (
                      <button
                        type="button"
                        onClick={onResumePartial}
                        disabled={isLoading}
                        className="ml-2 inline-flex items-center rounded-lg border border-amber-300 bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 transition hover:bg-amber-200 disabled:cursor-not-allowed disabled:opacity-50 dark:border-amber-800 dark:bg-amber-900/40 dark:text-amber-200 dark:hover:bg-amber-900/60"
                      >
                        {t("panel.partialRefill", { n: missingCount })}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {result.mode === "text" ? (
            <>
              <section className="rounded-2xl border border-zinc-200 bg-zinc-50/60 p-2 dark:border-zinc-800 dark:bg-zinc-900/40">
                {(() => {
                  // 제외된 용어는 표시에서 제거한 뒤, 그 위에서 북마크 카운트/필터를 계산.
                  const availableTerms = (result.terms ?? []).filter((t) => !excludedTerms.includes(t.term));
                  const bookmarkedCount = availableTerms.filter((t) => bookmarkedTermTexts.includes(t.term)).length;
                  const displayTerms = filterBookmarked
                    ? availableTerms.filter((t) => bookmarkedTermTexts.includes(t.term))
                    : availableTerms;
                  return (
                    <>
                      <div className="mb-2 flex items-center gap-2 px-1">
                        <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                          {t("panel.itTermDict")}
                        </p>
                        {bookmarkedCount > 0 && (
                          <>
                            <button
                              type="button"
                              onClick={() => setFilterBookmarked((v) => !v)}
                              className={`inline-flex items-center rounded-lg px-1.5 py-0.5 text-xs font-medium transition ${
                                filterBookmarked
                                  ? "bg-lime-600 text-white dark:bg-lime-600"
                                  : "bg-lime-100 text-lime-700 hover:bg-lime-200 dark:bg-lime-900/40 dark:text-lime-300 dark:hover:bg-lime-800/40"
                              }`}
                            >
                              {t("panel.bookmarkN", { n: bookmarkedCount })}
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setBookmarkedTermDetails({});
                                setFilterBookmarked(false);
                                clearTermDetails();
                              }}
                              className="text-xs text-zinc-400 hover:text-zinc-600 dark:text-zinc-500 dark:hover:text-zinc-300"
                            >
                              {t("panel.clearAll")}
                            </button>
                          </>
                        )}
                      </div>
                      <ResizableBody id="it-terms" defaultHeight={360}>
                        <ItTermSection
                          key={result.createdAt}
                          terms={displayTerms}
                          activeTermId={activeTermId}
                          onTermClick={handleTermClick}
                          bookmarkedTermTexts={bookmarkedTermTexts}
                          onBookmarkToggle={handleTermBookmarkToggle}
                          onExclude={(term) => onExclude?.("text", term.term)}
                        />
                      </ResizableBody>
                    </>
                  );
                })()}
              </section>
              <section className="rounded-2xl border border-zinc-200 bg-zinc-50/60 p-2 dark:border-zinc-800 dark:bg-zinc-900/40">
                <p className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                  {t("panel.relatedConcept")}
                </p>
                {/* 내부 스크롤 캡(max-h+overscroll) 금지 — 박스가 뷰포트 하단에 걸치면
                    내부 바닥에서 패널 스크롤 전파가 막혀 꼬리가 영영 안 보인다(#356).
                    마지막 섹션이므로 패널(aside) 단일 스크롤로 흐르게 둔다. */}
                <div className="pr-1">
                  <ItConceptSection
                    concepts={result.itConcepts ?? []}
                    activeConceptIds={activeConceptIds}
                    onBookmarkToggle={handleItConceptBookmarkToggle}
                    bookmarkedTitles={bookmarkedTermTexts}
                    isStreaming={isLoading}
                  />
                </div>
              </section>
            </>
          ) : (
            <>
          <section className="rounded-2xl border border-zinc-200 bg-zinc-50/60 p-2 dark:border-zinc-800 dark:bg-zinc-900/40">
            <div className="mb-2 flex items-center justify-between gap-2 px-1">
              <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                {t("panel.lineExplain")}
              </p>
              {/* 책갈피 있으면 어디 있는지 배지(#639) — 클릭 시 그 줄로 스크롤. 밑에 있어도 놓치지 않게. */}
              {pinnedLine != null && (
                <button
                  type="button"
                  onClick={() => document.getElementById(`nunopi-line-${pinnedLine}`)?.scrollIntoView({ behavior: "smooth", block: "center" })}
                  className="inline-flex shrink-0 items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-700 transition hover:bg-amber-200 dark:bg-amber-950/40 dark:text-amber-400 dark:hover:bg-amber-950/70"
                >
                  <IconBookmarkFilled size={12} stroke={2} aria-hidden />
                  {t("line.goToPin", { n: String(pinnedLine) })}
                </button>
              )}
            </div>
            {/* 누락 줄 채우기(#635) — 클릭한 줄이 설명 없으면 모달 띄우고 자동 분석. 성공 시 자동 닫힘. */}
            {fillModalLine != null && (() => {
              const failed = fillErrorLine === fillModalLine;
              return (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true">
                  <div className="w-full max-w-sm rounded-2xl border border-zinc-200 bg-white p-5 shadow-xl dark:border-zinc-800 dark:bg-[var(--s-bar)]">
                    <div className="mb-3 flex items-start gap-2.5">
                      {failed
                        ? <IconAlertTriangle size={18} stroke={2} className="mt-0.5 shrink-0 text-amber-500" aria-hidden />
                        : <IconSparkles size={18} stroke={2} className="mt-0.5 shrink-0 text-[#3B34E2] dark:text-[#8b86f5]" aria-hidden />}
                      <div className="min-w-0 flex-1">
                        <p className="text-[13px] font-semibold text-zinc-800 dark:text-zinc-100">
                          {t("line.fillMissingTitle", { n: String(fillModalLine) })}
                        </p>
                        <p className="mt-1 text-[12px] text-zinc-500 dark:text-zinc-400">
                          {failed ? t("line.fillMissingFailed") : t("line.fillMissingBody", { n: String(fillModalLine) })}
                        </p>
                      </div>
                      <button type="button" onClick={onCloseFillModal} aria-label={t("line.fillClose")} className="shrink-0 rounded p-1 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200">
                        <IconX size={15} stroke={2} aria-hidden />
                      </button>
                    </div>
                    {failed ? (
                      <div className="flex justify-end gap-1.5">
                        <button type="button" onClick={onCloseFillModal} className="rounded-lg px-3 py-1.5 text-[12px] font-medium text-zinc-500 transition hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800">
                          {t("line.fillClose")}
                        </button>
                        <button type="button" onClick={() => { if (onFillLine) onFillLine(fillModalLine); }} className="inline-flex items-center gap-1 rounded-lg bg-[#3B34E2] px-3 py-1.5 text-[12px] font-semibold text-white transition hover:bg-[#322bc9] dark:bg-[#8b86f5] dark:text-zinc-900 dark:hover:bg-[#a5a0f8]">
                          <IconSparkles size={13} stroke={2} aria-hidden /> {t("line.fillRetry")}
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1.5 text-[12px] text-zinc-400 dark:text-zinc-500">
                        <IconLoader2 size={14} stroke={2} className="animate-spin" aria-hidden /> {t("line.adding")}
                      </div>
                    )}
                  </div>
                </div>
              );
            })()}
            <ResizableBody id="lines" defaultHeight={440}>
              <LineExplanationList
                key={result.createdAt}
                lineExplanations={anchoredLineExplanations}
                concepts={safeConcepts}
                onConceptClick={handleConceptClick}
                language={result.language}
                activeLine={activeLine}
                onLineFocus={onLineFocus}
                isStreaming={isLoading}
                chunkProgress={chunkProgress}
                pinnedLine={pinnedLine}
                onPinLine={onPinLine}
              />
            </ResizableBody>
          </section>

          <section className="rounded-2xl border border-zinc-200 bg-zinc-50/60 p-2 dark:border-zinc-800 dark:bg-zinc-900/40">
            {(() => {
              // 코드 토큰은 제외 없이, 북마크 카운트/필터만 적용.
              const visibleBookmarkCount = safeTokens.filter((t) =>
                bookmarkedTokenTexts.includes(t.token),
              ).length;
              const displayTokens = filterBookmarked
                ? safeTokens.filter((t) => bookmarkedTokenTexts.includes(t.token))
                : safeTokens;
              return (
                <>
                  <div className="mb-2 flex items-center gap-2 px-1">
                    <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                      {t("panel.tokenDict")}
                    </p>
                    {visibleBookmarkCount > 0 && (
                      <>
                        <button
                          type="button"
                          onClick={() => setFilterBookmarked((v) => !v)}
                          className={`inline-flex items-center rounded-lg px-1.5 py-0.5 text-xs font-medium transition ${
                            filterBookmarked
                              ? "bg-lime-600 text-white dark:bg-lime-600"
                              : "bg-lime-100 text-lime-700 hover:bg-lime-200 dark:bg-lime-900/40 dark:text-lime-300 dark:hover:bg-lime-800/40"
                          }`}
                        >
                          {t("panel.bookmarkN", { n: visibleBookmarkCount })}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setBookmarkedTokenTexts([]);
                            setBookmarkedTokenDetails({});
                            setFilterBookmarked(false);
                            try { localStorage.removeItem(BOOKMARKS_KEY); } catch { /* ignore */ }
                            clearTokenDetails();
                          }}
                          className="text-xs text-zinc-400 hover:text-zinc-600 dark:text-zinc-500 dark:hover:text-zinc-300"
                        >
                          {t("panel.clearBookmarks")}
                        </button>
                      </>
                    )}
                  </div>
                  <ResizableBody id="tokens" defaultHeight={360}>
                    <TokenSection
                      key={result.createdAt}
                      tokens={displayTokens}
                      activeTokenIds={activeTokenIds}
                      onTokenClick={handleTokenClick}
                      explainingTokenTexts={explainingTokens}
                      onTokenExplain={(token) => onTokenExplain?.(token.token)}
                      bookmarkedTokenTexts={bookmarkedTokenTexts}
                      onBookmarkToggle={handleBookmarkToggle}
                      onTokenHover={setHoverLines}
                      onDelete={(token) => onDeleteToken?.(token.token)}
                      emptyHint={t("panel.tokenEmptyHint")}
                    />
                  </ResizableBody>
                </>
              );
            })()}
          </section>

          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
              {t("panel.concept")}
            </p>
            <ConceptSection
              concepts={safeConcepts}
              activeConceptId={activeConceptIds[0] ?? null}
              onConceptClick={handleConceptClick}
              explainingConcepts={explainingConcepts}
              bookmarkedConceptTitles={bookmarkedConceptTitles}
              onBookmarkToggle={handleConceptBookmarkToggle}
              onDelete={onDeleteConcept}
            />
          </div>
            </>
          )}
        </div>
      ) : (
        <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4 text-sm text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300">
          {t("panel.noResult")}
        </div>
      )}
    </div>
  );
}
