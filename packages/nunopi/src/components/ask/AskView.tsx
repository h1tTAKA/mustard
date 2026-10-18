"use client";

import { useEffect, useRef, useState } from "react";
import { IconMessage2, IconPlus, IconPencil, IconTrash, IconChevronRight, IconChevronDown, IconX, IconFolder, IconFolderPlus, IconSparkles, IconCards } from "@tabler/icons-react";
import { useLocale, useT } from "@mustard/core";
import { useConfirm, CKEYS } from "@mustard/core";
import { useToast } from "@mustard/core";
import AskChat from "./AskChat";
import AskSessionCards from "./AskSessionCards";
import AskSessionQuiz from "./AskSessionQuiz";
import { FlyCardProvider } from "../memorize/FlyCard";
import { collectCards } from "../../lib/srs/collect";
import { CARDS_CHANGED_EVENT } from "@mustard/core";
import { MESSAGES } from "@mustard/core";
import { reassignAskSubSession } from "@mustard/core";
import type { Card } from "@mustard/core";
import {
  loadAskStore,
  saveAskStore,
  createSession,
  createFolder,
  newAskId,
  type AskStore,
  type AskSession,
  type AskFolder,
  type QuizSession,
} from "@mustard/core";
import { createChatCard } from "@mustard/core";
import { removeSuggestedCard, stripCardBlock, type SuggestedCard } from "@mustard/core";
import { stripLoneSurrogates } from "../../lib/safeText";
import type { AgentProviderKind, ChatMessage, ProviderSettings } from "../../lib/agent";

type StreamEvent =
  | { type: "progress"; line: string }
  | { type: "thinking"; line: string }
  | { type: "result"; response: { summary: string } }
  | { type: "error"; message: string };

// 맥락 없는 순수 질문임을 에이전트에 알리는 placeholder(chat 모드 code 슬롯).
const NO_CONTEXT = "(일반 질문 — 특정 코드/글 맥락 없음)";

const EMPTY_STORE: AskStore = { folders: [], sessions: [], activeSessionId: "" };
// ask 카드는 sourceSessionId로 출처 이동 판별 — analysis용 sourceIds는 빈 Set.
const EMPTY_SOURCE_IDS: Set<string> = new Set();

// 좌측 세션 패널 폭(px) — 기본/최소/최대 + 영속 키.
const PANEL_DEFAULT = 240;
const PANEL_MIN = 220;
const PANEL_MAX = 460;
const PANEL_WIDTH_KEY = "nunopi:ask-panel-width";
const clampPanel = (w: number) => Math.min(PANEL_MAX, Math.max(PANEL_MIN, w));

// 에이전트 질문(Ask) 모드 — 좌측 세션 히스토리 + 활성 세션 챗(이슈2).
// 서브세션 탭/분할은 후속 이슈. 지금은 세션당 단일 챗(subs[0]).
// 모든 언어의 "제목 없음" — 저장된 기본 제목 판별용(#1125)
const UNTITLED_ANY = new Set(Object.values(MESSAGES).map((d) => d["ask.untitled"]).filter(Boolean));

export default function AskView({ active = true, providerId, providerSettings, goToTarget, collapsed = false }: {
  active?: boolean;
  providerId: AgentProviderKind;
  providerSettings: ProviderSettings;
  // 외부(암기 갤러리 등)에서 특정 세션·질문으로 이동 요청. nonce 변경 시 네비.
  goToTarget?: { sessionId: string; subId?: string; quizId?: string; nonce: number };
  // 세션 패널 접힘(#783) — 헤더 토글이 상위(page·WorkspaceModePane)서 제어. true면 aside·핸들 숨김.
  collapsed?: boolean;
}) {
  const t = useT();
  const { locale } = useLocale();
  const confirm = useConfirm();
  const toast = useToast();
  const [store, setStore] = useState<AskStore>(EMPTY_STORE);
  // 스트리밍/로딩은 질문(서브세션)별로 관리 — 분할 타일 동시 답변 지원(이슈4).
  const [streamingMap, setStreamingMap] = useState<Record<string, string | null>>({});
  const [loadingMap, setLoadingMap] = useState<Record<string, boolean>>({});
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  // 좌측 트리에서 펼쳐진(서브세션 노출) 세션 id 집합.
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  // 좌측 세션 패널 폭(px) — 드래그로 조절, localStorage 영속.
  const [panelWidth, setPanelWidth] = useState(PANEL_DEFAULT);
  const [resizing, setResizing] = useState(false);
  const panelWidthRef = useRef(PANEL_DEFAULT);
  const rootRef = useRef<HTMLDivElement>(null);
  const resizingRef = useRef(false);
  // 접힘(#783) 시 리사이즈 핸들이 언마운트돼 pointerUp이 안 올 수 있으므로 resize 상태를
  // 강제 리셋(select-none 고착 방지). 정상 입력으론 드래그 중 접기가 거의 불가하나 방어.
  useEffect(() => {
    if (collapsed && resizingRef.current) {
      resizingRef.current = false;
      setResizing(false);
    }
  }, [collapsed]);
  // 분할 타일 드래그 재배치 상태(방향 분할).
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [overDir, setOverDir] = useState<"row" | "col" | null>(null);
  const [overAfter, setOverAfter] = useState(false);
  // 세션→폴더 드래그 이동 상태. dropFolder: 폴더 id 또는 "root"(그룹 해제).
  const [sessDragId, setSessDragId] = useState<string | null>(null);
  const [dropFolder, setDropFolder] = useState<string | null>(null);
  // 질문(서브) → 다른 세션 드래그 이동 상태(#556). dropSess: 드롭 대상 세션 id.
  const [subDrag, setSubDrag] = useState<{ fromSessionId: string; subId: string } | null>(null);
  const [dropSess, setDropSess] = useState<string | null>(null);
  // 우측 카드 목록 패널 열림.
  const [cardsOpen, setCardsOpen] = useState(false);
  // 우측 퀴즈 패널 열림(카드와 자리 공유·배타).
  const [quizOpen, setQuizOpen] = useState(false);
  // 퀴즈 푸는 중 왼쪽 질문 가리기(블러) ON 여부. 기본 ON, 유저 토글. 새/전환 퀴즈마다 재블러(아래 effect).
  const [quizBlurOn, setQuizBlurOn] = useState(true);
  // 세션별 ask 카드 수(좌측 배지). 전역 카드 store에서 파생.
  const [cardCounts, setCardCounts] = useState<Record<string, number>>({});
  // storeRef — async 완료 시 stale 클로저 없이 최신 store를 읽고 커밋하기 위함.
  const storeRef = useRef<AskStore>(EMPTY_STORE);
  // 질문별 진행 요청 — 타일마다 독립 abort.
  const abortMap = useRef<Map<string, AbortController>>(new Map());
  // Escape 취소 플래그 — Escape가 input을 blur시키므로, 뒤따르는 onBlur 커밋을 건너뛴다.
  const renameCancelRef = useRef(false);

  // 마운트 시 세션 로드(항상 활성 세션 1개 보장). 언마운트 시 진행 요청 취소.
  useEffect(() => {
    const loaded = loadAskStore(t("ask.untitled"));
    storeRef.current = loaded;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setStore(loaded);
    // 활성 세션은 펼친 상태로 시작(그 하위 대화 노출).
    setExpanded(new Set([loaded.activeSessionId]));
    const storedWidth = Number(localStorage.getItem(PANEL_WIDTH_KEY));
    if (Number.isFinite(storedWidth) && storedWidth > 0) {
      const w = clampPanel(storedWidth);
      panelWidthRef.current = w;
      setPanelWidth(w);
    }
    const aborts = abortMap.current;
    return () => aborts.forEach((a) => a.abort());
    // t는 로케일 변경 시 바뀌지만 초기 제목에만 쓰여 재로드 불필요.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Cmd/Ctrl+D — 활성 모드에서 분할(현재 질문 옆 새 질문 타일). 브라우저 북마크 가로채기 방지.
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === "d" || e.key === "D")) {
        e.preventDefault();
        handleSplitNew();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // handleSplit은 storeRef만 읽어 안정적 — active만 의존.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  // 외부 출처 이동 요청 — nonce 바뀌면 그 세션·질문으로.
  useEffect(() => {
    if (goToTarget) navigateToAskSource(goToTarget.sessionId, goToTarget.subId, goToTarget.quizId);
    // navigateToAskSource는 storeRef만 읽어 안정적 — nonce만 트리거.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [goToTarget?.nonce]);

  // 세션별 카드 수 — 마운트 + 카드 변경 시 갱신(전역 카드 store 파생).
  useEffect(() => {
    const recount = () => {
      const counts: Record<string, number> = {};
      for (const c of collectCards(["token", "concept", "term"], new Date())) {
        if (c.sourceKind === "ask" && c.sourceSessionId) counts[c.sourceSessionId] = (counts[c.sourceSessionId] ?? 0) + 1;
      }
      setCardCounts(counts);
    };
    recount();
    window.addEventListener(CARDS_CHANGED_EVENT, recount);
    return () => window.removeEventListener(CARDS_CHANGED_EVENT, recount);
  }, []);

  // 최신 store를 ref+state+localStorage에 한 번에 반영.
  function commit(next: AskStore) {
    storeRef.current = next;
    setStore(next);
    saveAskStore(next);
  }

  const activeSession = store.sessions.find((s) => s.id === store.activeSessionId) ?? store.sessions[0] ?? null;

  // 활성 서브의 활성 퀴즈 세션 id — 바뀌면(새 퀴즈/전환) 블러 다시 ON.
  const activeSubForQuiz = activeSession?.subs.find((x) => x.id === activeSession.activeSubId);
  const activeQuizId = activeSubForQuiz?.activeQuizId;
  useEffect(() => { setQuizBlurOn(true); }, [activeQuizId]); // eslint-disable-line react-hooks/set-state-in-effect
  // 퀴즈 풀이 중(활성 퀴즈 phase==="solving")이고 패널 열림 → 활성 서브 질문 블러 대상.
  const activeQuizPhase = activeSubForQuiz?.quizzes?.find((q) => q.id === activeQuizId)?.quiz.phase;
  const quizSolving = quizOpen && activeQuizPhase === "solving";
  const quizBlurred = quizSolving && quizBlurOn;

  // 질문(서브세션) 표시 라벨 — 유저 지정 이름 우선, 없으면 "질문 N"(세션 내 순번).
  function subDisplayLabel(session: AskSession, subId: string): string {
    const idx = session.subs.findIndex((sub) => sub.id === subId);
    const sub = session.subs[idx];
    return sub?.title || t("ask.thread", { n: Math.max(0, idx) + 1 });
  }

  // 세션 표시 라벨 — 이름 없으면 "세션 N"(같은 폴더 스코프 내 순번). 스코프별 1부터.
  function sessionLabel(s: AskSession): string {
    // #1125 예전 마이그레이션이 저장한 기본 제목("제목 없음" 등, 어느 언어든)은 이름 없는 것으로
    if (s.title && !UNTITLED_ANY.has(s.title)) return s.title;
    const scope = (s.folderId ?? null);
    const siblings = store.sessions.filter((x) => (x.folderId ?? null) === scope);
    return t("ask.sessionN", { n: Math.max(0, siblings.findIndex((x) => x.id === s.id)) + 1 });
  }

  // 폴더 표시 라벨 — 이름 없으면 "제목 없음 N"(같은 부모 스코프 내 순번). 스코프별 1부터.
  function folderLabel(f: AskFolder): string {
    if (f.name) return f.name;
    const scope = (f.parentId ?? null);
    const siblings = store.folders.filter((x) => (x.parentId ?? null) === scope);
    return t("ask.folderN", { n: Math.max(0, siblings.findIndex((x) => x.id === f.id)) + 1 });
  }

  // 카드 출처 브레드크럼 문자열 — "폴더/…/세션/질문"(저장 시점 스냅샷). 표시용.
  function cardSourceLabel(session: AskSession, subId: string): string {
    const parts: string[] = [];
    const seen = new Set<string>();
    let cur = session.folderId ? store.folders.find((f) => f.id === session.folderId) : undefined;
    while (cur && !seen.has(cur.id)) {
      seen.add(cur.id);
      parts.unshift(folderLabel(cur));
      cur = cur.parentId ? store.folders.find((f) => f.id === cur!.parentId) : undefined;
    }
    parts.push(sessionLabel(session));
    parts.push(subDisplayLabel(session, subId));
    return parts.join(" / ");
  }

  // 카드 출처 브레드크럼 — id로 현재 store에서 재계산(폴더/세션/질문 rename 즉시 반영).
  function cardSourceLabelById(sessionId?: string, subId?: string): string {
    if (!sessionId) return "";
    const session = store.sessions.find((s) => s.id === sessionId);
    if (!session) return "";
    return cardSourceLabel(session, subId ?? session.activeSubId);
  }

  // 카드 출처로 이동 — 그 세션 활성 + 생성 질문(sub) 활성 + 폴더 펼침.
  // 출처(세션 또는 그 질문)가 삭제됐으면 이동 대신 안내 토스트.
  function navigateToAskSource(sessionId: string, subId?: string, quizId?: string) {
    const prev = storeRef.current;
    const session = prev.sessions.find((s) => s.id === sessionId);
    const subOk = !subId || !!session?.subs.some((x) => x.id === subId);
    if (!session || !subOk) { toast(t("ask.sourceDeleted"), "error"); return; }
    resetStream();
    const activeSubId = subId && session.subs.some((x) => x.id === subId) ? subId : session.activeSubId;
    commit({
      ...prev,
      activeSessionId: sessionId,
      sessions: prev.sessions.map((s) =>
        s.id !== sessionId
          ? s
          : {
              ...s,
              activeSubId,
              layout: [activeSubId],
              // 퀴즈 이동이면 그 서브의 활성 퀴즈 지정 — 단 그 퀴즈가 실존할 때만(삭제됐으면 기존 활성 유지).
              subs: quizId
                ? s.subs.map((sub) => (sub.id === activeSubId && (sub.quizzes ?? []).some((q) => q.id === quizId) ? { ...sub, activeQuizId: quizId } : sub))
                : s.subs,
            },
      ),
    });
    expand(sessionId);
    // 퀴즈 이동이면 우측 퀴즈 패널 열기(카드 패널과 배타).
    if (quizId) { setQuizOpen(true); setCardsOpen(false); }
  }

  function handleCardGoToSource(card: Card) {
    if (card.sourceKind === "ask" && card.sourceSessionId) navigateToAskSource(card.sourceSessionId, card.sourceSubId);
  }

  // 특정 세션·서브의 messages를 mapper로 갱신하고 커밋(async 완료 대비 id로 지목).
  function updateSubMessages(sessionId: string, subId: string, mapper: (msgs: ChatMessage[]) => ChatMessage[]) {
    const prev = storeRef.current;
    const next: AskStore = {
      ...prev,
      sessions: prev.sessions.map((s) =>
        s.id !== sessionId
          ? s
          : { ...s, subs: s.subs.map((sub) => (sub.id !== subId ? sub : { ...sub, messages: mapper(sub.messages) })) },
      ),
    };
    commit(next);
  }

  // 특정 세션·서브의 퀴즈 세션 목록·활성 id를 갱신하고 커밋(패널이 변경 시 호출 — 탭 전환/재진입 유지).
  function updateSubQuizzes(sessionId: string, subId: string, quizzes: QuizSession[], activeQuizId: string | undefined) {
    const prev = storeRef.current;
    const next: AskStore = {
      ...prev,
      sessions: prev.sessions.map((s) =>
        s.id !== sessionId
          ? s
          : { ...s, subs: s.subs.map((sub) => (sub.id !== subId ? sub : { ...sub, quizzes, activeQuizId })) },
      ),
    };
    commit(next);
  }

  // 특정 세션 하나를 mapper로 갱신하고 커밋(서브세션 조작용).
  function updateSession(sessionId: string, mapper: (s: AskSession) => AskSession) {
    const prev = storeRef.current;
    commit({ ...prev, sessions: prev.sessions.map((s) => (s.id !== sessionId ? s : mapper(s))) });
  }

  // 특정 질문의 진행 요청만 취소.
  function abortSub(subId: string) {
    abortMap.current.get(subId)?.abort();
    abortMap.current.delete(subId);
  }

  // 모든 진행 요청 취소 + 스트림 상태 초기화(세션/질문 네비게이션 시).
  function resetStream() {
    abortMap.current.forEach((a) => a.abort());
    abortMap.current.clear();
    setStreamingMap({});
    setLoadingMap({});
  }

  function expand(id: string) {
    setExpanded((prev) => (prev.has(id) ? prev : new Set(prev).add(id)));
  }

  function toggleExpand(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // ── 세션 조작 ──────────────────────────────────────────
  function handleNewSession() {
    resetStream();
    const session = createSession(""); // 이름 미지정(표시는 "세션 N")
    commit({ ...store, sessions: [...store.sessions, session], activeSessionId: session.id });
    expand(session.id);
  }

  function handleSelectSession(id: string) {
    expand(id);
    if (id === store.activeSessionId) return;
    resetStream();
    commit({ ...store, activeSessionId: id });
  }

  function handleDeleteSession(id: string) {
    resetStream();
    const remaining = store.sessions.filter((s) => s.id !== id);
    // 0개 허용 — 마지막 세션도 삭제 가능(우측은 빈 상태 CTA).
    const activeSessionId = store.activeSessionId === id ? (remaining[remaining.length - 1]?.id ?? "") : store.activeSessionId;
    commit({ ...store, sessions: remaining, activeSessionId });
  }
  async function confirmDeleteSession(id: string) {
    if (await confirm({ skipKey: CKEYS.skipDelete, title: t("ask.confirmDeleteSessionTitle"), message: t("ask.confirmDeleteSession"), confirmText: t("common.delete"), danger: true })) {
      handleDeleteSession(id);
    }
  }

  // rename 커밋은 항상 onBlur 한 경로로만 일어난다(Enter/Escape는 blur를 유발).
  function commitRename(id: string) {
    setRenamingId(null);
    if (renameCancelRef.current) {
      renameCancelRef.current = false; // Escape 취소 — 커밋 안 함.
      return;
    }
    const title = renameDraft.trim();
    if (title) {
      commit({ ...store, sessions: store.sessions.map((s) => (s.id === id ? { ...s, title } : s)) });
    }
  }

  // ── 폴더 조작 ──────────────────────────────────────────
  // 폴더 id의 모든 하위 폴더 id(자신 포함) 재귀 수집.
  function descendantFolderIds(rootId: string, folders: { id: string; parentId?: string | null }[]): Set<string> {
    const out = new Set<string>([rootId]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const f of folders) {
        if (f.parentId && out.has(f.parentId) && !out.has(f.id)) { out.add(f.id); grew = true; }
      }
    }
    return out;
  }

  // 폴더의 최상위 조상 id(parentId 체인 위로, 사이클·고아 가드).
  function rootAncestorFolderId(folderId: string, folders: { id: string; parentId?: string | null }[]): string {
    const seen = new Set<string>();
    let cur = folders.find((f) => f.id === folderId);
    while (cur?.parentId && !seen.has(cur.id)) {
      seen.add(cur.id);
      const parent = folders.find((f) => f.id === cur!.parentId);
      if (!parent) break; // 고아 부모 → 현재가 실질 루트
      cur = parent;
    }
    return cur?.id ?? folderId;
  }

  function handleNewFolder(parentId: string | null = null) {
    const prev = storeRef.current;
    const folder = createFolder("", parentId); // 빈 폴더·이름 미지정(표시는 "제목 없음 N")
    // 부모 폴더가 접혀 있으면 펼쳐 새 하위 폴더가 보이게.
    const folders = prev.folders.map((f) => (f.id === parentId ? { ...f, collapsed: false } : f));
    const nextFolders = [...folders, folder];
    commit({ ...prev, folders: nextFolders });
    // rename 프리필 = 실제 표시 번호(커밋 후 형제 스코프 기준). store는 아직 stale이라 직접 계산.
    const siblings = nextFolders.filter((f) => (f.parentId ?? null) === (folder.parentId ?? null));
    setRenamingId(folder.id);
    setRenameDraft(t("ask.folderN", { n: siblings.findIndex((f) => f.id === folder.id) + 1 }));
  }

  function commitRenameFolder(id: string) {
    setRenamingId(null);
    if (renameCancelRef.current) { renameCancelRef.current = false; return; }
    const name = renameDraft.trim();
    if (name) {
      commit({ ...store, folders: store.folders.map((f) => (f.id === id ? { ...f, name } : f)) });
    }
  }

  // 폴더 삭제. 기본: 이 폴더의 직속 세션·하위폴더를 상위로 승격(보존). deleteSessions=true:
  // 이 폴더 + 모든 하위폴더(재귀) 제거 + 그 안의 세션 전부 삭제.
  // 폴더 삭제 = 안의 세션·질문·하위 폴더까지 재귀로 전부 삭제(파일 폴더 개념).
  function handleDeleteFolder(id: string) {
    resetStream();
    const prev = storeRef.current;
    const doomed = descendantFolderIds(id, prev.folders); // 자신 + 하위폴더 전부
    const folders = prev.folders.filter((f) => !doomed.has(f.id));
    const sessions = prev.sessions.filter((s) => !(s.folderId && doomed.has(s.folderId)));
    const activeSessionId = sessions.some((s) => s.id === prev.activeSessionId)
      ? prev.activeSessionId
      : (sessions[sessions.length - 1]?.id ?? "");
    commit({ folders, sessions, activeSessionId });
  }
  async function confirmDeleteFolder(id: string) {
    if (await confirm({ skipKey: CKEYS.skipDelete,
      title: t("ask.confirmDeleteFolderTitle"),
      message: t("ask.confirmDeleteFolder"),
      confirmText: t("common.delete"),
      danger: true,
    })) {
      handleDeleteFolder(id);
    }
  }

  function toggleFolderCollapse(id: string) {
    commit({ ...storeRef.current, folders: storeRef.current.folders.map((f) => (f.id === id ? { ...f, collapsed: !f.collapsed } : f)) });
  }

  function handleNewSessionInFolder(folderId: string) {
    resetStream();
    const prev = storeRef.current;
    const session = createSession("", folderId); // 이름 미지정(표시는 "세션 N")
    // 폴더 펼쳐서 새 세션이 보이게(접혀 있으면 만든 게 안 보이던 문제).
    const folders = prev.folders.map((f) => (f.id === folderId ? { ...f, collapsed: false } : f));
    commit({ ...prev, folders, sessions: [...prev.sessions, session], activeSessionId: session.id });
    expand(session.id);
  }

  // 세션을 폴더로(또는 null=루트로) 이동.
  function moveSessionToFolder(sessionId: string, folderId: string | null) {
    const prev = storeRef.current;
    const target = prev.sessions.find((s) => s.id === sessionId);
    if (!target || (target.folderId ?? null) === folderId) return;
    commit({ ...prev, sessions: prev.sessions.map((s) => (s.id === sessionId ? { ...s, folderId } : s)) });
  }

  // 질문(서브)을 다른 세션으로 이동 + 그 질문 카드도 대상 세션으로 재지정(#556).
  function moveSubToSession(fromSessionId: string, subId: string, toSessionId: string) {
    if (fromSessionId === toSessionId) return;
    const prev = storeRef.current;
    const from = prev.sessions.find((s) => s.id === fromSessionId);
    const sub = from?.subs.find((x) => x.id === subId);
    if (!from || !sub || !prev.sessions.some((s) => s.id === toSessionId)) return;
    const remaining = from.subs.filter((x) => x.id !== subId);
    let sessions = prev.sessions.map((s) => {
      if (s.id === toSessionId) return { ...s, subs: [...s.subs, sub] };
      if (s.id === fromSessionId && remaining.length > 0) {
        // 옮긴 게 활성이었거나 기존 활성이 remaining에 없으면 남은 마지막으로.
        const activeSubId = remaining.some((x) => x.id === s.activeSubId) ? s.activeSubId : remaining[remaining.length - 1].id;
        const layout = s.layout.filter((id) => id !== subId && remaining.some((x) => x.id === id));
        return { ...s, subs: remaining, activeSubId, layout: layout.length ? layout : [activeSubId] };
      }
      return s;
    });
    let activeSessionId = prev.activeSessionId;
    // 원본 세션이 비면 삭제(질문 완전 이전). 활성이었으면 대상 세션으로.
    if (remaining.length === 0) {
      sessions = sessions.filter((s) => s.id !== fromSessionId);
      if (activeSessionId === fromSessionId) activeSessionId = toSessionId;
    }
    commit({ ...prev, sessions, activeSessionId });
    expand(toSessionId);
    // 그 질문에서 만든 카드의 sourceSessionId를 대상 세션으로 → 옮긴 세션 카드로 표시.
    reassignAskSubSession(subId, toSessionId);
    try { window.dispatchEvent(new Event(CARDS_CHANGED_EVENT)); } catch { /* ignore */ }
  }

  // ── 서브세션(대화) 조작 — 좌측 트리에서 세션 지목 ──────
  function handleNewSub(sessionId: string) {
    resetStream();
    const sub = { id: newAskId(), createdAt: new Date().toISOString(), messages: [] };
    const prev = storeRef.current;
    commit({
      ...prev,
      activeSessionId: sessionId,
      sessions: prev.sessions.map((s) =>
        s.id !== sessionId ? s : { ...s, subs: [...s.subs, sub], activeSubId: sub.id, layout: [sub.id] },
      ),
    });
    expand(sessionId);
  }

  function handleSelectSub(sessionId: string, subId: string) {
    const prev = storeRef.current;
    // 다른 세션의 질문 클릭 → 그 세션으로 이동 + 그 질문 단일 뷰.
    if (sessionId !== prev.activeSessionId) {
      resetStream();
      commit({
        ...prev,
        activeSessionId: sessionId,
        sessions: prev.sessions.map((s) => (s.id !== sessionId ? s : { ...s, activeSubId: subId, layout: [subId] })),
      });
      return;
    }
    const session = prev.sessions.find((s) => s.id === sessionId);
    if (!session) return;
    // 이미 타일로 열려 있으면 포커스만.
    if (session.layout.includes(subId)) {
      focusTile(subId);
      return;
    }
    // 분할 상태면 기존 질문을 타일로 추가. 단일 뷰면 교체.
    if (session.layout.length > 1) {
      openInTile(subId);
      return;
    }
    commit({
      ...prev,
      sessions: prev.sessions.map((s) => (s.id !== sessionId ? s : { ...s, activeSubId: subId, layout: [subId] })),
    });
  }

  function handleDeleteSub(sessionId: string, subId: string) {
    abortSub(subId);
    updateSession(sessionId, (s) => {
      const subs = s.subs.filter((sub) => sub.id !== subId);
      if (subs.length === 0) return s; // 최소 1 보장(트리가 >1일 때만 삭제 노출)
      const activeSubId = s.activeSubId === subId ? subs[subs.length - 1].id : s.activeSubId;
      const layoutLeft = s.layout.filter((id) => id !== subId && subs.some((x) => x.id === id));
      return { ...s, subs, activeSubId, layout: layoutLeft.length ? layoutLeft : [activeSubId] };
    });
  }

  // ── 분할 타일 조작 ─────────────────────────────────────
  // Cmd+D / "새 질문" — 항상 새 질문 타일 추가(추측 없음).
  function handleSplitNew() {
    const prev = storeRef.current;
    const session = prev.sessions.find((s) => s.id === prev.activeSessionId);
    if (!session || session.layout.length >= 4) return; // 상한 4(그리드 안정)
    const sub = { id: newAskId(), title: undefined, createdAt: new Date().toISOString(), messages: [] };
    commit({
      ...prev,
      sessions: prev.sessions.map((s) =>
        s.id !== session.id ? s : { ...s, subs: [...s.subs, sub], activeSubId: sub.id, layout: [...s.layout, sub.id] },
      ),
    });
    expand(session.id);
  }

  // 기존 질문을 타일로 추가(단일 뷰에서도 분할로 확장). 상한이면 포커스 타일 교체.
  function openInTile(subId: string) {
    const prev = storeRef.current;
    const session = prev.sessions.find((s) => s.id === prev.activeSessionId);
    if (!session) return;
    updateSession(session.id, (s) => {
      if (s.layout.includes(subId)) return { ...s, activeSubId: subId };
      const layout = s.layout.length >= 4
        ? s.layout.map((id) => (id === s.activeSubId ? subId : id))
        : [...s.layout, subId];
      return { ...s, activeSubId: subId, layout };
    });
  }

  function closeTile(subId: string) {
    abortSub(subId);
    const sessionId = storeRef.current.activeSessionId;
    updateSession(sessionId, (s) => {
      const layout = s.layout.filter((id) => id !== subId);
      // 전부 닫히면 닫은 질문 말고 다른 질문으로 폴백(재표시 방지).
      const fallback = s.subs.find((x) => x.id !== subId)?.id ?? s.subs[0].id;
      const nextLayout = layout.length ? layout : [fallback];
      const activeSubId = s.activeSubId === subId ? nextLayout[nextLayout.length - 1] : s.activeSubId;
      return { ...s, layout: nextLayout, activeSubId };
    });
  }

  function focusTile(subId: string) {
    const prev = storeRef.current;
    const session = prev.sessions.find((s) => s.id === prev.activeSessionId);
    if (!session || session.activeSubId === subId) return;
    updateSession(session.id, (s) => ({ ...s, activeSubId: subId }));
  }

  // 타일 방향 이동(드래그 재배치) — 대상 타일의 어느 쪽에 놓느냐로 방향/순서 결정.
  // dir "col"=위아래, "row"=좌우. after=대상 뒤(아래/오른쪽)에 배치.
  function moveTile(fromId: string, toId: string, dir: "row" | "col", after: boolean) {
    if (fromId === toId) return;
    updateSession(storeRef.current.activeSessionId, (s) => {
      const layout = s.layout.filter((id) => id !== fromId);
      let idx = layout.indexOf(toId);
      if (idx < 0) return s;
      if (after) idx += 1;
      layout.splice(idx, 0, fromId);
      return { ...s, layout, splitDir: dir };
    });
  }

  // 드래그 오버 지점(타일 내 비율)으로 방향·전후 판정 — 상하 가장자리=col, 좌우=row.
  function dropZone(e: React.DragEvent<HTMLDivElement>): { dir: "row" | "col"; after: boolean } {
    const r = e.currentTarget.getBoundingClientRect();
    const x = r.width ? (e.clientX - r.left) / r.width : 0.5;
    const y = r.height ? (e.clientY - r.top) / r.height : 0.5;
    const nearV = Math.min(y, 1 - y); // 상/하 가장자리 근접
    const nearH = Math.min(x, 1 - x); // 좌/우 가장자리 근접
    return nearV < nearH ? { dir: "col", after: y > 0.5 } : { dir: "row", after: x > 0.5 };
  }

  // ── 좌측 패널 리사이즈(드래그 핸들) ────────────────────
  function onResizeDown(e: React.PointerEvent<HTMLDivElement>) {
    e.currentTarget.setPointerCapture(e.pointerId);
    resizingRef.current = true;
    setResizing(true);
  }
  function onResizeMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!resizingRef.current || !rootRef.current) return;
    const left = rootRef.current.getBoundingClientRect().left;
    const w = clampPanel(e.clientX - left);
    panelWidthRef.current = w;
    setPanelWidth(w);
  }
  function onResizeUp(e: React.PointerEvent<HTMLDivElement>) {
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* 이미 해제됨(pointercancel) */ }
    if (!resizingRef.current) return;
    resizingRef.current = false;
    setResizing(false);
    try { localStorage.setItem(PANEL_WIDTH_KEY, String(Math.round(panelWidthRef.current))); } catch { /* ignore */ }
  }

  // 질문(서브세션) rename — 세션 rename과 동일 패턴(blur 단일 커밋 + 취소 플래그).
  function commitRenameSub(sessionId: string, subId: string) {
    setRenamingId(null);
    if (renameCancelRef.current) {
      renameCancelRef.current = false;
      return;
    }
    const title = renameDraft.trim();
    updateSession(sessionId, (s) => ({
      ...s,
      subs: s.subs.map((sub) => (sub.id === subId ? { ...sub, title: title || undefined } : sub)),
    }));
  }

  async function confirmDeleteSub(sessionId: string, subId: string) {
    if (await confirm({ skipKey: CKEYS.skipDelete, title: t("ask.confirmDeleteThreadTitle"), message: t("ask.confirmDeleteThread"), confirmText: t("common.delete"), danger: true })) {
      handleDeleteSub(sessionId, subId);
    }
  }

  // ── 챗 조작(질문 subId 지목 — 타일별 독립) ─────────────

  // 카드 제안 칩 — 답에서 나온 용어를 카드로 저장(출처=세션명). 저장 후 해당 블록 제거.
  // 반환: 새로 만들었으면 true, 중복 스킵이면 false(칩 토스트 분기 #511).
  function handleCardActionSub(subId: string, messageIndex: number, action: { add?: SuggestedCard; dismiss?: boolean }): boolean {
    const prev = storeRef.current;
    const session = prev.sessions.find((s) => s.id === prev.activeSessionId);
    if (!session) return false;
    let created = false;
    if (action.add) {
      // 출처 = 폴더/세션/질문 브레드크럼(표시용) + kind/sessionId/subId(출처 이동용).
      const source = cardSourceLabel(session, subId);
      created = createChatCard(action.add.kind ?? "term", action.add.term, action.add.definition, source, undefined, {
        kind: "ask",
        sessionId: session.id,
        subId,
      });
      setCardsOpen(true); // 추가 즉시 우측 카드 패널 펼쳐 체감.
    }
    const addedTerm = action.add?.term;
    updateSubMessages(session.id, subId, (msgs) =>
      msgs.map((m, i) =>
        i === messageIndex && m.role === "assistant"
          ? { ...m, content: addedTerm ? removeSuggestedCard(m.content, addedTerm) : stripCardBlock(m.content) }
          : m,
      ),
    );
    return created;
  }

  // 같은 세션(+폴더 서브트리) 다른 질문 대화를 에이전트 참조용 다이제스트로 조립.
  // 현재 질문 제외, 메시지 있는 것만. 총 길이 상한으로 토큰 폭주 방지.
  function buildSharedContext(store: AskStore, activeSession: AskSession, currentSubId: string): string {
    const CAP = 6000;
    const scope = new Set<string>([activeSession.id]);
    if (activeSession.folderId) {
      // 최상위 조상 폴더의 전체 서브트리 = 하나의 공유 그룹(폴더 깊이 무관 전부 공유).
      const root = rootAncestorFolderId(activeSession.folderId, store.folders);
      const fam = descendantFolderIds(root, store.folders);
      for (const s of store.sessions) if (s.folderId && fam.has(s.folderId)) scope.add(s.id);
    }
    const parts: string[] = [];
    for (const s of store.sessions) {
      if (!scope.has(s.id)) continue;
      s.subs.forEach((sub, i) => {
        if (sub.id === currentSubId || sub.messages.length === 0) return;
        const qname = sub.title || t("ask.thread", { n: i + 1 });
        const transcript = sub.messages.map((m) => `${m.role === "user" ? "Q" : "A"}: ${m.content}`).join("\n");
        parts.push(`### ${s.title || t("ask.title")} / ${qname}\n${transcript}`);
      });
    }
    if (parts.length === 0) return "";
    let ctx = `(참고: 같은 세션/폴더의 다른 질문에서 오간 내용입니다. 필요하면 참고해 일관되게 답하세요.)\n\n${parts.join("\n\n")}`;
    // slice가 이모지(surrogate pair) 중간을 자를 수 있어, 잘린 뒤 외톨이 surrogate를 제거한다
    // (안 그러면 JSON.stringify가 깨진 JSON을 만들어 API 400 — #517).
    if (ctx.length > CAP) ctx = `${stripLoneSurrogates(ctx.slice(0, CAP))}\n…(이하 생략)`;
    return ctx;
  }

  function handleSendTo(subId: string, text: string) {
    if (loadingMap[subId]) return;
    const prev = storeRef.current;
    const session = prev.sessions.find((s) => s.id === prev.activeSessionId);
    const sub = session?.subs.find((x) => x.id === subId);
    if (!session || !sub) return;
    const sessionId = session.id;
    const thread: ChatMessage[] = [...sub.messages, { role: "user", content: text }];
    // 형제 질문 맥락은 code 슬롯(참조 자료)에만 — messages는 현재 질문 thread 유지(역할 오염 방지).
    const shared = buildSharedContext(prev, session, subId);
    const code = shared || NO_CONTEXT;
    updateSubMessages(sessionId, subId, () => thread);
    setStreamingMap((m) => ({ ...m, [subId]: "" }));
    setLoadingMap((m) => ({ ...m, [subId]: true }));
    abortSub(subId);
    const ac = new AbortController();
    abortMap.current.set(subId, ac);
    (async () => {
      let answer = "";
      try {
        const res = await fetch("/api/agent/analyze", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            providerId,
            request: { code, locale, providerId, mode: "chat", messages: thread, providerSettings },
          }),
          signal: ac.signal,
        });
        if (!res.ok || !res.body) {
          if (!ac.signal.aborted) {
            updateSubMessages(sessionId, subId, (m) => [...m, { role: "assistant", content: t("chat.replyFailed") }]);
          }
          return;
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const l of lines) {
            if (!l.trim()) continue;
            let ev: StreamEvent;
            try { ev = JSON.parse(l) as StreamEvent; } catch { continue; }
            if (ev.type === "progress" && providerId !== "codex-agent") setStreamingMap((m) => ({ ...m, [subId]: ev.line }));
            else if (ev.type === "result") answer = ev.response.summary;
          }
        }
        // 개행으로 끝나지 않은 마지막 이벤트(result) 유실 방지 — 남은 버퍼 flush.
        if (buffer.trim()) {
          try {
            const ev = JSON.parse(buffer) as StreamEvent;
            if (ev.type === "result") answer = ev.response.summary;
          } catch { /* 부분 청크 — 무시 */ }
        }
        if (!ac.signal.aborted) {
          updateSubMessages(sessionId, subId, (m) => [...m, { role: "assistant", content: answer || t("fallback.emptyResponse") }]);
        }
      } catch {
        if (!ac.signal.aborted) {
          updateSubMessages(sessionId, subId, (m) => [...m, { role: "assistant", content: t("chat.replyError") }]);
        }
      } finally {
        if (!ac.signal.aborted) {
          setStreamingMap((m) => ({ ...m, [subId]: null }));
          setLoadingMap((m) => ({ ...m, [subId]: false }));
        }
        // 같은 질문에 더 새 요청이 시작됐으면 그 컨트롤러를 지우지 않도록 identity 확인.
        if (abortMap.current.get(subId) === ac) abortMap.current.delete(subId);
      }
    })();
  }

  // 세션 행(+하위 질문 트리) — 폴더 안/루트 공용. 폴더 이동 드래그 소스.
  const renderSessionRow = (s: AskSession) => {
    const isActiveSession = s.id === store.activeSessionId;
    const renaming = s.id === renamingId;
    const isOpen = expanded.has(s.id);
    return (
      <div
        key={s.id}
        className="mb-0.5"
        draggable={!renaming}
        onDragStart={(e) => { if (subDrag) return; setSessDragId(s.id); e.dataTransfer.effectAllowed = "move"; }}
        onDragEnd={() => { setSessDragId(null); setDropFolder(null); }}
      >
        {/* 세션(부모) 행 — 다른 세션 질문(sub) 드래그 시 드롭 타깃(#556). */}
        <div
          onDragOver={(e) => { if (subDrag && subDrag.fromSessionId !== s.id) { e.preventDefault(); e.stopPropagation(); setDropSess(s.id); } }}
          onDragLeave={() => { if (subDrag) setDropSess((d) => (d === s.id ? null : d)); }}
          onDrop={(e) => { if (subDrag && subDrag.fromSessionId !== s.id) { e.preventDefault(); e.stopPropagation(); moveSubToSession(subDrag.fromSessionId, subDrag.subId, s.id); setSubDrag(null); setDropSess(null); } }}
          className={`group flex items-center gap-0.5 rounded-lg pr-1 text-sm transition-colors ${
            subDrag && subDrag.fromSessionId !== s.id && dropSess === s.id ? "ring-2 ring-[#3B34E2] dark:ring-[#8b86f5]" : ""
          } ${
            isActiveSession
              ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-800 dark:text-zinc-50"
              : "text-zinc-600 hover:bg-zinc-200/60 dark:text-zinc-300 dark:hover:bg-zinc-800/60"
          }`}
        >
          <button
            type="button"
            onClick={() => toggleExpand(s.id)}
            aria-label={isOpen ? t("a11y.collapse") : t("a11y.expand")}
            className="flex h-7 w-6 shrink-0 items-center justify-center text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200"
          >
            {isOpen ? <IconChevronDown size={15} stroke={2} aria-hidden /> : <IconChevronRight size={15} stroke={2} aria-hidden />}
          </button>
          {renaming ? (
            <input
              autoFocus
              value={renameDraft}
              onChange={(e) => setRenameDraft(e.target.value)}
              onBlur={() => commitRename(s.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
                else if (e.key === "Escape") { renameCancelRef.current = true; e.currentTarget.blur(); }
              }}
              className="min-w-0 flex-1 rounded border border-zinc-300 bg-white px-1 py-0.5 text-sm outline-none focus:border-[#3B34E2] dark:border-zinc-600 dark:bg-zinc-900"
            />
          ) : (
            <>
              <button
                type="button"
                onClick={() => handleSelectSession(s.id)}
                onDoubleClick={() => { setRenamingId(s.id); setRenameDraft(sessionLabel(s)); }}
                className="min-w-0 flex-1 truncate py-1.5 text-left font-medium"
                title={sessionLabel(s)}
              >
                {sessionLabel(s)}
              </button>
              {cardCounts[s.id] > 0 && (
                <span
                  title={t("ask.sessionCards")}
                  className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-zinc-200/70 px-1.5 py-0.5 text-[10px] font-medium text-zinc-500 dark:bg-zinc-700/60 dark:text-zinc-400"
                >
                  <IconCards size={11} stroke={2} aria-hidden />
                  {cardCounts[s.id]}
                </span>
              )}
              <button
                type="button"
                onClick={() => { setRenamingId(s.id); setRenameDraft(sessionLabel(s)); }}
                aria-label={t("ask.rename")}
                title={t("ask.rename")}
                className="hidden shrink-0 rounded p-0.5 text-zinc-400 hover:text-zinc-700 group-hover:block dark:hover:text-zinc-100"
              >
                <IconPencil size={14} stroke={2} aria-hidden />
              </button>
              <button
                type="button"
                onClick={() => { void confirmDeleteSession(s.id); }}
                aria-label={t("ask.deleteSession")}
                title={t("ask.deleteSession")}
                className="hidden shrink-0 rounded p-0.5 text-zinc-400 hover:text-rose-500 group-hover:block"
              >
                <IconTrash size={14} stroke={2} aria-hidden />
              </button>
            </>
          )}
        </div>

        {/* 서브세션(질문) — 세션 밑 들여쓰기 트리 */}
        {isOpen && (
          <div className="ml-3 mt-0.5 flex flex-col gap-0.5 border-l border-zinc-200 pl-2 dark:border-zinc-700/60">
            {s.subs.map((sub, i) => {
              const isActiveSub = isActiveSession && sub.id === s.activeSubId;
              const subRenaming = sub.id === renamingId;
              const subName = sub.title || t("ask.thread", { n: i + 1 });
              return (
                <div
                  key={sub.id}
                  draggable={!subRenaming}
                  onDragStart={(e) => { e.stopPropagation(); setSubDrag({ fromSessionId: s.id, subId: sub.id }); e.dataTransfer.effectAllowed = "move"; }}
                  onDragEnd={() => { setSubDrag(null); setDropSess(null); }}
                  className={`group/sub flex items-center gap-1 rounded-md px-2 py-1 text-[13px] transition-colors ${
                    isActiveSub
                      ? "bg-[#3B34E2]/10 font-medium text-[#3B34E2] dark:bg-[#8b86f5]/15 dark:text-[#8b86f5]"
                      : "text-zinc-500 hover:bg-zinc-200/60 dark:text-zinc-400 dark:hover:bg-zinc-800/60"
                  }`}
                >
                  {subRenaming ? (
                    <input
                      autoFocus
                      value={renameDraft}
                      onChange={(e) => setRenameDraft(e.target.value)}
                      onBlur={() => commitRenameSub(s.id, sub.id)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") e.currentTarget.blur();
                        else if (e.key === "Escape") { renameCancelRef.current = true; e.currentTarget.blur(); }
                      }}
                      className="min-w-0 flex-1 rounded border border-zinc-300 bg-white px-1 py-0.5 text-[13px] text-zinc-800 outline-none focus:border-[#3B34E2] dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100"
                    />
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => handleSelectSub(s.id, sub.id)}
                        onDoubleClick={() => { setRenamingId(sub.id); setRenameDraft(subName); }}
                        className="min-w-0 flex-1 truncate text-left"
                        title={subName}
                      >
                        {subName}
                      </button>
                      <button
                        type="button"
                        onClick={() => { setRenamingId(sub.id); setRenameDraft(subName); }}
                        aria-label={t("ask.rename")}
                        title={t("ask.rename")}
                        className="hidden shrink-0 rounded p-0.5 text-zinc-400 hover:text-zinc-700 group-hover/sub:block dark:hover:text-zinc-100"
                      >
                        <IconPencil size={12} stroke={2} aria-hidden />
                      </button>
                      {s.subs.length > 1 && (
                        <button
                          type="button"
                          onClick={() => { void confirmDeleteSub(s.id, sub.id); }}
                          aria-label={t("ask.deleteThread")}
                          className="hidden shrink-0 rounded p-0.5 text-zinc-400 hover:text-rose-500 group-hover/sub:block"
                        >
                          <IconX size={12} stroke={2.5} aria-hidden />
                        </button>
                      )}
                    </>
                  )}
                </div>
              );
            })}
            <button
              type="button"
              onClick={() => handleNewSub(s.id)}
              className="flex items-center gap-1 rounded-md px-2 py-1 text-[13px] text-zinc-400 transition-colors hover:bg-zinc-200/60 hover:text-zinc-600 dark:hover:bg-zinc-800/60 dark:hover:text-zinc-200"
            >
              <IconPlus size={13} stroke={2.5} aria-hidden />
              {t("ask.newThread")}
            </button>
          </div>
        )}
      </div>
    );
  };

  const rootSessions = store.sessions.filter((s) => !s.folderId || !store.folders.some((f) => f.id === s.folderId));
  // 루트 폴더 = 부모 없음 또는 부모 고아(삭제됨).
  const rootFolders = store.folders.filter((f) => !f.parentId || !store.folders.some((p) => p.id === f.parentId));

  // 폴더(하위 폴더·세션 포함) 재귀 렌더. 자식 컨테이너의 ml/border-l로 깊이 들여쓰기.
  const renderFolder = (folder: AskFolder, seen: Set<string> = new Set()) => {
    if (seen.has(folder.id)) return null; // 사이클 방어(손상된 store)
    const nextSeen = new Set(seen).add(folder.id);
    const folderRenaming = folder.id === renamingId;
    const subfolders = store.folders.filter((f) => f.parentId === folder.id);
    const inFolder = store.sessions.filter((s) => s.folderId === folder.id);
    const isDropTarget = !!sessDragId && dropFolder === folder.id;
    return (
      <div key={folder.id} className="mb-0.5">
        <div
          onDragOver={(e) => { if (sessDragId) { e.preventDefault(); e.stopPropagation(); setDropFolder(folder.id); } }}
          onDrop={(e) => { e.preventDefault(); e.stopPropagation(); if (sessDragId) moveSessionToFolder(sessDragId, folder.id); setSessDragId(null); setDropFolder(null); }}
          className={`group flex items-center gap-0.5 rounded-lg pr-1 text-sm text-zinc-600 transition-colors hover:bg-zinc-200/60 dark:text-zinc-300 dark:hover:bg-zinc-800/60 ${isDropTarget ? "ring-2 ring-inset ring-[#3B34E2] dark:ring-[#8b86f5]" : ""}`}
        >
          <button
            type="button"
            onClick={() => toggleFolderCollapse(folder.id)}
            aria-label={folder.collapsed ? t("a11y.expand") : t("a11y.collapse")}
            className="flex h-7 w-6 shrink-0 items-center justify-center text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200"
          >
            {folder.collapsed ? <IconChevronRight size={15} stroke={2} aria-hidden /> : <IconChevronDown size={15} stroke={2} aria-hidden />}
          </button>
          <IconFolder size={14} stroke={2} className="shrink-0 text-zinc-400" aria-hidden />
          {folderRenaming ? (
            <input
              autoFocus
              value={renameDraft}
              onChange={(e) => setRenameDraft(e.target.value)}
              onBlur={() => commitRenameFolder(folder.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
                else if (e.key === "Escape") { renameCancelRef.current = true; e.currentTarget.blur(); }
              }}
              className="ml-1 min-w-0 flex-1 rounded border border-zinc-300 bg-white px-1 py-0.5 text-sm outline-none focus:border-[#3B34E2] dark:border-zinc-600 dark:bg-zinc-900"
            />
          ) : (
            <>
              <button
                type="button"
                onClick={() => toggleFolderCollapse(folder.id)}
                onDoubleClick={() => { setRenamingId(folder.id); setRenameDraft(folderLabel(folder)); }}
                className="ml-1 min-w-0 flex-1 truncate py-1.5 text-left font-semibold"
                title={folderLabel(folder)}
              >
                {folderLabel(folder)}
              </button>
              <button
                type="button"
                onClick={() => handleNewFolder(folder.id)}
                aria-label={t("ask.newSubfolder")}
                title={t("ask.newSubfolder")}
                className="hidden shrink-0 rounded p-0.5 text-zinc-400 hover:text-zinc-700 group-hover:block dark:hover:text-zinc-100"
              >
                <IconFolderPlus size={14} stroke={2} aria-hidden />
              </button>
              <button
                type="button"
                onClick={() => handleNewSessionInFolder(folder.id)}
                aria-label={t("ask.newSession")}
                title={t("ask.newSession")}
                className="hidden shrink-0 rounded p-0.5 text-zinc-400 hover:text-zinc-700 group-hover:block dark:hover:text-zinc-100"
              >
                <IconPlus size={14} stroke={2} aria-hidden />
              </button>
              <button
                type="button"
                onClick={() => { setRenamingId(folder.id); setRenameDraft(folderLabel(folder)); }}
                aria-label={t("ask.renameFolder")}
                title={t("ask.renameFolder")}
                className="hidden shrink-0 rounded p-0.5 text-zinc-400 hover:text-zinc-700 group-hover:block dark:hover:text-zinc-100"
              >
                <IconPencil size={14} stroke={2} aria-hidden />
              </button>
              <button
                type="button"
                onClick={() => { void confirmDeleteFolder(folder.id); }}
                aria-label={t("ask.deleteFolder")}
                title={t("ask.deleteFolder")}
                className="hidden shrink-0 rounded p-0.5 text-zinc-400 hover:text-rose-500 group-hover:block"
              >
                <IconTrash size={14} stroke={2} aria-hidden />
              </button>
            </>
          )}
        </div>
        {!folder.collapsed && (
          <div className="ml-3 mt-0.5 flex flex-col gap-0.5 border-l border-zinc-200 pl-1 dark:border-zinc-700/60">
            {subfolders.map((f) => renderFolder(f, nextSeen))}
            {inFolder.map(renderSessionRow)}
          </div>
        )}
      </div>
    );
  };

  return (
    <FlyCardProvider active={active} providerId={providerId} providerSettings={providerSettings} sourceIds={EMPTY_SOURCE_IDS} onGoToSource={handleCardGoToSource}>
    <div ref={rootRef} aria-hidden={!active} className={`flex h-full w-full overflow-hidden ${resizing ? "select-none" : ""}`}>
      {/* 좌측 세션 히스토리 패널 — 접힘(#783)이면 aside·리사이즈 핸들 숨기고 챗이 전폭. */}
      {!collapsed && (
      <aside style={{ width: panelWidth }} className="flex shrink-0 flex-col border-r border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-[var(--ink2)]">
        <div className="flex items-center justify-between px-3 py-3">
          <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            <IconMessage2 size={15} stroke={2} aria-hidden />
            {t("ask.sessions")}
          </span>
          <div className="flex items-center gap-0.5">
            <button
              type="button"
              onClick={() => handleNewFolder()}
              aria-label={t("ask.newFolder")}
              title={t("ask.newFolder")}
              className="flex h-6 w-6 items-center justify-center rounded-md text-zinc-500 transition-colors hover:bg-zinc-200 hover:text-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
            >
              <IconFolderPlus size={16} stroke={2} aria-hidden />
            </button>
            <button
              type="button"
              onClick={handleNewSession}
              aria-label={t("ask.newSession")}
              title={t("ask.newSession")}
              className="flex h-6 w-6 items-center justify-center rounded-md text-zinc-500 transition-colors hover:bg-zinc-200 hover:text-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
            >
              <IconPlus size={16} stroke={2} aria-hidden />
            </button>
          </div>
        </div>
        <div
          className="nunopi-scroll min-h-0 flex-1 overflow-y-auto px-2 pb-2 pt-1"
          onDragOver={(e) => { if (sessDragId) { e.preventDefault(); setDropFolder("__root__"); } }}
          onDrop={(e) => { e.preventDefault(); if (sessDragId) moveSessionToFolder(sessDragId, null); setSessDragId(null); setDropFolder(null); }}
        >
          {rootFolders.map((f) => renderFolder(f))}
          {/* 루트(폴더 밖) 세션 */}
          <div className={`rounded-lg ${sessDragId && dropFolder === "__root__" ? "ring-2 ring-inset ring-[#3B34E2] dark:ring-[#8b86f5]" : ""}`}>
            {rootSessions.map(renderSessionRow)}
          </div>
        </div>
      </aside>
      )}

      {/* 패널 폭 조절 핸들 — 접힘이면 함께 숨김(빈 세로바 방지). */}
      {!collapsed && (
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label={t("layout.splitHandle")}
        onPointerDown={onResizeDown}
        onPointerMove={onResizeMove}
        onPointerUp={onResizeUp}
        onPointerCancel={onResizeUp}
        className={`w-1.5 shrink-0 cursor-col-resize border-x border-zinc-200 transition-colors dark:border-zinc-800 ${
          resizing ? "bg-blue-400/60" : "bg-zinc-100 hover:bg-blue-400/40 dark:bg-zinc-900"
        }`}
      />
      )}

      {/* 우측 활성 세션 작업공간 — layout에 따라 단일 챗 또는 분할 타일 그리드. */}
      <div className="min-h-0 flex-1 overflow-hidden">
        {(() => {
          if (!activeSession) {
            // 세션 0개 — 빈 상태 + 새 세션 CTA.
            return (
              <div className="flex h-full flex-col items-center justify-center gap-4 px-4 text-center">
                <IconSparkles size={40} stroke={1.5} className="text-[#3B34E2] dark:text-[#8b86f5]" aria-hidden />
                <div>
                  <p className="text-xl font-semibold text-zinc-700 dark:text-zinc-200">{t("ask.noSessions")}</p>
                  <p className="mt-1 text-sm text-zinc-400 dark:text-zinc-500">{t("ask.noSessionsHint")}</p>
                </div>
                <button
                  type="button"
                  onClick={handleNewSession}
                  className="inline-flex items-center gap-1.5 rounded-full bg-[#3B34E2] px-4 py-2 text-sm font-medium text-white transition hover:bg-[#322bc9]"
                >
                  <IconPlus size={16} stroke={2.5} aria-hidden />
                  {t("ask.newSession")}
                </button>
              </div>
            );
          }
          // layout의 유효한 질문만(삭제된 id 방어). 비면 활성 서브로 폴백.
          const tileIds = activeSession.layout.filter((id) => activeSession.subs.some((sub) => sub.id === id));
          const ids = tileIds.length ? tileIds : [activeSession.activeSubId];
          const sessionTitle = sessionLabel(activeSession);
          // 폴더 경로(상위→하위) — 브레드크럼 맨 앞. 사이클 가드.
          const folderPath: string[] = [];
          {
            const seen = new Set<string>();
            let cur = activeSession.folderId ? store.folders.find((f) => f.id === activeSession.folderId) : undefined;
            while (cur && !seen.has(cur.id)) {
              seen.add(cur.id);
              folderPath.unshift(folderLabel(cur));
              cur = cur.parentId ? store.folders.find((f) => f.id === cur!.parentId) : undefined;
            }
          }
          // 분할 드롭다운 후보 — 아직 타일로 안 열린 기존 질문들.
          const splitOptions = activeSession.subs
            .filter((sub) => !activeSession.layout.includes(sub.id))
            .map((sub) => ({ id: sub.id, label: subDisplayLabel(activeSession, sub.id) }));
          const canSplit = activeSession.layout.length < 4;

          const renderTile = (subId: string, tiled: boolean) => {
            const sub = activeSession.subs.find((x) => x.id === subId) ?? activeSession.subs[0];
            return (
              <AskChat
                key={sub.id}
                folderPath={folderPath.length ? folderPath : undefined}
                title={sessionTitle}
                subLabel={subDisplayLabel(activeSession, sub.id)}
                messages={sub.messages}
                streaming={streamingMap[sub.id] ?? null}
                isLoading={!!loadingMap[sub.id]}
                onSend={(text) => handleSendTo(sub.id, text)}
                onCardAction={(i, action) => handleCardActionSub(sub.id, i, action)}
                canSplit={canSplit}
                splitOptions={splitOptions}
                onOpenQuestion={openInTile}
                onSplitNew={handleSplitNew}
                tiled={tiled}
                focused={tiled ? sub.id === activeSession.activeSubId : false}
                onFocus={tiled ? () => focusTile(sub.id) : undefined}
                onClose={tiled ? () => closeTile(sub.id) : undefined}
                draggable={tiled}
                onHeaderDragStart={tiled ? () => setDragId(sub.id) : undefined}
                onHeaderDragEnd={tiled ? () => { setDragId(null); setOverId(null); setOverDir(null); } : undefined}
                cardsOpen={cardsOpen}
                onToggleCards={() => { setCardsOpen((v) => !v); setQuizOpen(false); }}
                quizOpen={quizOpen}
                onToggleQuiz={() => { setQuizOpen((v) => !v); setCardsOpen(false); }}
                blurActive={sub.id === activeSession.activeSubId && quizSolving}
                blurred={sub.id === activeSession.activeSubId && quizBlurred}
                onToggleBlur={() => setQuizBlurOn((v) => !v)}
              />
            );
          };

          if (ids.length <= 1) {
            return <div className="h-full">{renderTile(ids[0], false)}</div>;
          }
          const dir = activeSession.splitDir === "col" ? "col" : "row";
          const clearDrag = () => { setDragId(null); setOverId(null); setOverDir(null); };
          // 드롭 미리보기 오버레이 — 놓일 절반 영역을 반투명 박스로 표시.
          const overlayRect = () => {
            if (overDir === "col") return overAfter ? "inset-x-0 bottom-0 top-1/2" : "inset-x-0 top-0 bottom-1/2";
            return overAfter ? "inset-y-0 right-0 left-1/2" : "inset-y-0 left-0 right-1/2";
          };
          return (
            <div className={`flex h-full gap-2 p-2 ${dir === "col" ? "flex-col" : "flex-row"}`}>
              {ids.map((id) => {
                const showHint = !!dragId && overId === id && dragId !== id && !!overDir;
                return (
                  <div
                    key={id}
                    onDragOver={(e) => {
                      if (!dragId) return;
                      e.preventDefault();
                      const z = dropZone(e);
                      setOverId(id);
                      setOverDir(z.dir);
                      setOverAfter(z.after);
                    }}
                    onDragLeave={() => setOverId((o) => (o === id ? null : o))}
                    onDrop={(e) => {
                      e.preventDefault();
                      if (dragId) { const z = dropZone(e); moveTile(dragId, id, z.dir, z.after); }
                      clearDrag();
                    }}
                    className={`relative min-h-0 min-w-0 flex-1 overflow-hidden rounded-xl transition ${dragId === id ? "opacity-50" : ""}`}
                  >
                    {renderTile(id, true)}
                    {showHint && (
                      <div className={`pointer-events-none absolute z-20 rounded-lg border-2 border-[#3B34E2] bg-[#3B34E2]/20 transition-all dark:border-[#8b86f5] dark:bg-[#8b86f5]/20 ${overlayRect()}`} />
                    )}
                  </div>
                );
              })}
            </div>
          );
        })()}
      </div>

      {/* 우측 카드 목록 패널(토글) — 현재 세션에서 추가된 카드. */}
      {cardsOpen && activeSession && <AskSessionCards sessionId={activeSession.id} sourceLabel={cardSourceLabelById} />}

      {/* 우측 퀴즈 패널(토글, 카드와 배타) — 현재 활성 서브의 Q&A로 능동 회상. key로 서브 전환 시 리셋. */}
      {quizOpen && activeSession && (() => {
        const activeSub = activeSession.subs.find((x) => x.id === activeSession.activeSubId) ?? activeSession.subs[0];
        return (
          <AskSessionQuiz
            key={activeSub.id}
            messages={activeSub.messages}
            providerId={providerId}
            providerSettings={providerSettings}
            quizzes={activeSub.quizzes ?? []}
            activeQuizId={activeSub.activeQuizId}
            onQuizzesChange={(qz, aid) => updateSubQuizzes(activeSession.id, activeSub.id, qz, aid)}
          />
        );
      })()}
    </div>
    </FlyCardProvider>
  );
}
