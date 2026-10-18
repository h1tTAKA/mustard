"use client";
// 워크스페이스 우측 챗룸(#647, #653) — 코딩하다 바로 질문. 워크스페이스 전용 슬림 UI.
// #653: 단일 스레드 → "무엇에 대한 대화인가"별 키드 세션 맵.
//   repo(기본, 레포 전체) / file:<path>(그 파일) / diff:<hash>:<file>(커밋 변경) / branch:<name>(브랜치 작업)
//   / wt:<file>(커밋 전 워킹트리 변경 — 커밋되면 diff:<hash>:<file>로 승계, #689).
// 각 세션 = kind별 컨텍스트 + 그 안에 여러 서브 대화(sub) 스레드. 질문 쌓여도 새 대화로 분리(스크롤 지옥 방지).
// 데이터(sessions)와 열린 탭(openKeys) 분리: 탭 닫아도 대화 보존, 다시 열면 복원. localStorage 영속.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { IconMessageCircle, IconArrowUp, IconLoader2, IconFileCode, IconFileText, IconEraser, IconStack2, IconGitBranch, IconGitCommit, IconPencil, IconX, IconPlus, IconCheck, IconHistory, IconSitemap, IconCards, IconListCheck } from "@tabler/icons-react";
import { Markdown } from "@mustard/core";
import WorkspaceQuizPanel from "@/components/workspace/WorkspaceQuizPanel";
import { formatChatAsMarkdown } from "@mustard/nunopi";
import { parseCardSuggestions, stripStreamingCardBlock, stripCardBlock, removeSuggestedCard, type SuggestedCard } from "@mustard/core";
import { createChatCard, CARDS_CHANGED_EVENT } from "@mustard/core";
import { bookmarkedTermExists } from "@mustard/core";
import { collectCards } from "@mustard/nunopi";
import type { Card } from "@mustard/core";
import { useFlyCard } from "@mustard/nunopi";
import { useLocale, useT } from "@mustard/core";
import { useConfirm, CKEYS } from "@mustard/core";
import { useToast } from "@mustard/core";
import type { AgentProviderKind, ChatMessage, ProviderSettings } from "@mustard/core";
import type { QuizSession } from "@mustard/core";
import { isNunopiEnabled } from "@/lib/product";
import { isCardWorthy } from "@/lib/cardWorthy";
import { buildWorkHistory, type AskItem } from "@/lib/catchupAskContext";
import { commitHashesIn, withRelatedCards } from "@/lib/catchupMarkdown";
type StreamEvent = { type: "progress"; line: string } | { type: "result"; response: { summary: string } } | { type: "error"; message: string };

type SessionKind = "repo" | "file" | "diff" | "branch" | "worktree" | "arch";
// 아키텍처(flow) 캐시 shape — #743이 저장한 것을 컨텍스트로 읽기 위한 최소 타입.
type ArchNode = { name: string; file?: string; line?: number; role?: string; next?: string[] };
type ArchSection = { layer: string; nodes: ArchNode[] };
interface Sub { id: string; messages: ChatMessage[]; createdAt?: number; quizzes?: QuizSession[]; activeQuizId?: string; } // 세션 안의 한 대화 스레드. createdAt=생성 시각(ms, 히스토리 날짜 그룹용 #691). quizzes=이 스레드의 테스트 세션들·activeQuizId=활성 테스트(#760). 레거시 저장분은 undefined.
// baseHead: worktree 세션 생성 시점 HEAD sha — 커밋 승계 판별용(#689, 커밋3에서 채움).
interface Session { key: string; kind: SessionKind; label: string; subs: Sub[]; activeSubId: string; baseHead?: string; }
// WorkspaceView가 주는 포커스 신호 — n(nonce)로 같은 대상 재클릭도 매번 발화.
export interface ChatFocus { key: string; kind: SessionKind; label: string; n: number; }

const REPO_KEY = "repo";
const MAX_SESSIONS = 40; // 닫힌 세션 포함 저장 상한 — 초과 시 가장 오래된 "닫힌" 세션부터 정리.

const genId = () => globalThis.crypto?.randomUUID?.() ?? String(Math.random()).slice(2);
const freshSub = (): Sub => ({ id: genId(), messages: [], createdAt: Date.now() });
const mkSession = (key: string, kind: SessionKind, label: string): Session => { const s = freshSub(); return { key, kind, label, subs: [s], activeSubId: s.id }; };

// DiffPane hunk 노트 버킷을 워킹트리→커밋 해시로 승계(#689). 키 스킴은 DiffPane.noteStore와 동일:
//   nunopi:hunk-notes:<root>:<hash | "wt:"+kind>:<file>. hunk는 diffText로 키잉돼 내용 같으면 재부착.
// 워킹트리 kind 3종(unstaged/staged/untracked)을 커밋 해시 버킷에 병합 후 원본 정리(중복 방지).
function carryHunkNotes(root: string, file: string, hash: string): void {
  if (typeof localStorage === "undefined") return;
  try {
    const dstKey = `nunopi:hunk-notes:${root}:${hash}:${file}`;
    const dst: Record<string, string> = JSON.parse(localStorage.getItem(dstKey) || "{}");
    let touched = false;
    for (const kind of ["unstaged", "staged", "untracked"] as const) {
      const srcKey = `nunopi:hunk-notes:${root}:wt:${kind}:${file}`;
      const raw = localStorage.getItem(srcKey);
      if (!raw) continue;
      const src = JSON.parse(raw) as Record<string, string>;
      for (const k in src) if (!(k in dst)) dst[k] = src[k]; // 기존 커밋 노트 보존, 없는 것만 채움
      localStorage.removeItem(srcKey);
      touched = true;
    }
    if (touched) localStorage.setItem(dstKey, JSON.stringify(dst));
  } catch { /* ignore */ }
}

// localStorage에서 세션 복원(마이그레이션 포함). SSR/미저장 시 기본(repo 세션 1개).
// 마운트 시 동기 호출 → 하이드레이션 이펙트 레이스(빈 상태 덮어쓰기) 원천 제거.
function loadStore(store: string, repoLabel: string): { sessions: Record<string, Session>; openKeys: string[]; activeKey: string } {
  const fresh = () => ({ sessions: { [REPO_KEY]: mkSession(REPO_KEY, "repo", repoLabel) } as Record<string, Session>, openKeys: [REPO_KEY], activeKey: REPO_KEY });
  if (typeof localStorage === "undefined") return fresh();
  try {
    const raw = localStorage.getItem(store);
    if (!raw) return fresh();
    const p = JSON.parse(raw) as { sessions?: Record<string, Partial<Session> & { messages?: ChatMessage[] }>; openKeys?: string[]; activeKey?: string };
    if (!p.sessions) return fresh(); // 데이터 자체가 없을 때만 완전 초기화
    const sessions: Record<string, Session> = {};
    for (const [k, s] of Object.entries(p.sessions)) {
      const subs = Array.isArray(s.subs) && s.subs.length ? s.subs : [{ id: genId(), messages: Array.isArray(s.messages) ? s.messages : [] }];
      sessions[k] = { key: k, kind: (s.kind ?? "file") as SessionKind, label: s.label ?? k, subs, activeSubId: s.activeSubId && subs.some((x) => x.id === s.activeSubId) ? s.activeSubId : subs[0].id };
    }
    // repo 세션이 없으면 나머지(file/diff/arch…)를 버리지 말고 repo만 보강(관용, #754).
    if (!sessions[REPO_KEY]) sessions[REPO_KEY] = mkSession(REPO_KEY, "repo", repoLabel);
    let openKeys = Array.isArray(p.openKeys) && p.openKeys.length ? p.openKeys.filter((k) => sessions[k]) : Object.keys(sessions);
    openKeys = [REPO_KEY, ...openKeys.filter((k) => k !== REPO_KEY)]; // repo 항상 맨 앞
    const activeKey = p.activeKey && sessions[p.activeKey] && openKeys.includes(p.activeKey) ? p.activeKey : REPO_KEY;
    return { sessions, openKeys, activeKey };
  } catch { return fresh(); }
}

// 챗 영속 — 조용한 쿼터 실패로 새 내용이 안 남던 것(#754) 방지.
// setItem이 던지면(QuotaExceededError 등) 비활성(=repo·활성 세션 아닌) 세션을 오래된 것부터
// 잘라내며 재시도한다. repo·현재 활성 세션은 최대한 보존. 그래도 안 되면 최후로 둘만 저장.
function persistChat(store: string, sessions: Record<string, Session>, openKeys: string[], activeKey: string): void {
  if (typeof localStorage === "undefined") return;
  const write = (s: Record<string, Session>): boolean => {
    const ok = openKeys.filter((k) => s[k]);
    try {
      localStorage.setItem(store, JSON.stringify({ sessions: s, openKeys: ok.length ? ok : [REPO_KEY], activeKey: s[activeKey] ? activeKey : REPO_KEY }));
      return true;
    } catch { return false; }
  };
  if (write(sessions)) return;
  // 쿼터 초과 → 비보호 세션을 오래된 것(서브 createdAt 최대값 기준)부터 제거하며 재시도.
  const work: Record<string, Session> = { ...sessions };
  const recency = (v: Session) => v.subs.reduce((m, sub) => Math.max(m, sub.createdAt ?? 0), 0);
  const removable = Object.keys(work)
    .filter((k) => k !== REPO_KEY && k !== activeKey)
    .sort((a, b) => recency(work[a]) - recency(work[b]));
  for (const k of removable) { delete work[k]; if (write(work)) return; }
  // 최후 — repo + 활성 세션만. 그래도 실패면 포기(이전 성공 저장분은 그대로 남음).
  const minimal: Record<string, Session> = {};
  if (work[REPO_KEY]) minimal[REPO_KEY] = work[REPO_KEY];
  if (work[activeKey]) minimal[activeKey] = work[activeKey];
  write(minimal);
}

// 세션 kind별 아이콘 — JSX 직접 반환(렌더 중 컴포넌트 변수 생성 회피: react-hooks/static-components).
function kindGlyph(k: SessionKind, size: number, className?: string) {
  const p = { size, stroke: 2, className, "aria-hidden": true } as const;
  return k === "repo" ? <IconStack2 {...p} /> : k === "branch" ? <IconGitBranch {...p} /> : k === "diff" ? <IconGitCommit {...p} /> : k === "worktree" ? <IconPencil {...p} /> : k === "arch" ? <IconSitemap {...p} /> : <IconFileCode {...p} />;
}

export default function WorkspaceChat({ root, files, focus, prefill, changedFiles, providerId, providerSettings, onOpenCard, cardsEnabled = true }: {
  root: string;
  files: string[];
  focus: ChatFocus | null;
  prefill?: { text: string; n: number } | null; // 입력창에 넣을 텍스트(카드→arch 질문 좌표, #746). n=신호 카운터.
  changedFiles?: Set<string>; // 현재 워킹트리 변경 파일 경로(#689 승계 트리거)
  providerId: AgentProviderKind;
  providerSettings: ProviderSettings;
  cardsEnabled?: boolean; // #1081 설정 > 캐치업 > 질문 > 카드 칩
  onOpenCard?: (key: string) => void; // #1081 답변의 catchup: 링크 → 그 캐치업 카드로
}) {
  const t = useT();
  const { locale } = useLocale();
  // #1081 catchup:KEY 링크 클릭 → 캐치업 카드로 이동(앱 안). 그 밖 링크는 기본 동작.
  const onLink = useCallback((href: string) => {
    if (!/^catchup:/i.test(href) || !onOpenCard) return false;
    let key = href.slice("catchup:".length); try { key = decodeURIComponent(key); } catch { /* 이미 평문 */ }
    onOpenCard(key); return true;
  }, [onOpenCard]);
  const confirm = useConfirm();
  const toast = useToast();
  const store = `nunopi:ws-chat:${root}`;
  // #1125 레포 세션 이름은 저장값(만들 때 언어로 굳음) 대신 보여 줄 때 번역
  const labelOf = (kind: SessionKind, label: string) => (kind === "repo" ? t("workspace.chatRepo") : label);

  // 마운트 시 저장소에서 동기 복원(lazy init) — 새로고침/모드전환/재오픈 즉시 올바른 데이터로 시작.
  const initial = useMemo(() => loadStore(store, t("workspace.chatRepo")), []); // eslint-disable-line react-hooks/exhaustive-deps -- 마운트 1회 복원(store 변경은 아래 이펙트가 처리)
  const [sessions, setSessions] = useState<Record<string, Session>>(initial.sessions);
  const [openKeys, setOpenKeys] = useState<string[]>(initial.openKeys); // 탭바에 보이는 세션들(닫으면 여기서만 빠짐, 데이터는 유지)
  const [activeKey, setActiveKey] = useState<string>(initial.activeKey);
  const [streaming, setStreaming] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [input, setInput] = useState("");
  const taRef = useRef<HTMLTextAreaElement>(null); // 입력창 — prefill 시 포커스·캐럿 이동
  const focusPendingRef = useRef(false);           // prefill 후 input 반영되면 포커스+캐럿 처리 대기 플래그
  const [historyOpen, setHistoryOpen] = useState(false); // 질문 이력 오버레이
  const [cardsOpen, setCardsOpen] = useState(false);      // 이 세션에서 추가된 카드 오버레이(#750)
  const [testOpen, setTestOpen] = useState(false);        // 테스트(퀴즈) 오버레이(#760)
  const [testCtx, setTestCtx] = useState<string | null>(null); // 테스트 대상 자료(비동기 조립). null=로딩 중(#760)
  const [sessionCards, setSessionCards] = useState<Card[]>([]); // 현재 세션에서 만든 카드(최신순)
  const [seenCards, setSeenCards] = useState<Record<string, number>>({}); // 세션별 목록 확인 시점 카드 수(배지 소거용, #750)
  const { throwCard } = useFlyCard(); // 카드 클릭 시 확대·상세(#750)
  const ctxCache = useRef<Map<string, string>>(new Map()); // 세션키별 컨텍스트 캐시(재fetch 회피)
  const scrollRef = useRef<HTMLDivElement>(null);
  const curStore = useRef(store); // 현재 로드된 store(폴더 변경 감지용)

  const active = sessions[activeKey] ?? sessions[REPO_KEY];
  const activeSub = active.subs.find((s) => s.id === active.activeSubId) ?? active.subs[0];

  // 레포 파일 basename·stem 집합 — 카드 제안에서 파일/심볼 항목 걸러내기용(#746).
  const fileStems = useMemo(() => {
    const set = new Set<string>();
    for (const f of files) { const base = (f.split("/").pop() ?? f).toLowerCase(); set.add(base); set.add(base.replace(/\.[^.]+$/, "")); }
    return set;
  }, [files]);
  // 카드로 만들 만한가? 파일명·경로·레포 파일 stem·코드 식별자 제외(공용 isCardWorthy, #998).
  // 카드(암기) = nunopi 학습모듈 기능 → 꺼져 있으면 칩 전부 숨김 + 요청에 noCards(#998).
  const cardsOn = isNunopiEnabled() && cardsEnabled; // #1081 질문 설정에서 카드 칩 끄면 제안 자체를 안 받음(noCards)
  const keepCard = useCallback((c: SuggestedCard) => cardsOn && isCardWorthy(c.term, fileStems), [fileStems, cardsOn]);
  const messages = activeSub.messages;

  // 이 세션에서 추가된 카드(#750) — 전역 카드 풀에서 workspace + 현재 세션 것만. 최신순.
  const reloadCards = useCallback(() => {
    const all = collectCards(["token", "concept", "term"], new Date());
    // 레포별 격리(#762) — 세션 키("repo"/"file:…")는 레포 간 겹치므로 root까지 일치해야 이 레포 카드.
    const mine = all.filter((c) => c.sourceKind === "workspace" && c.sourceRoot === root && c.sourceSessionId === activeKey);
    mine.sort((a, b) => (b.bookmarkedAt ?? "").localeCompare(a.bookmarkedAt ?? ""));
    setSessionCards(mine);
  }, [activeKey, root]);
  // 세션 전환/카드 생성(CARDS_CHANGED_EVENT) 시 재수집.
  useEffect(() => {
    reloadCards();
    window.addEventListener(CARDS_CHANGED_EVENT, reloadCards);
    return () => window.removeEventListener(CARDS_CHANGED_EVENT, reloadCards);
  }, [reloadCards]);
  // 목록을 열어 본 동안엔 그 세션의 카드 수를 "확인함"으로 기록 → 배지 소거(다음에 카드 늘면 다시 뜸).
  useEffect(() => {
    if (cardsOpen) setSeenCards((p) => (p[activeKey] === sessionCards.length ? p : { ...p, [activeKey]: sessionCards.length }));
  }, [cardsOpen, sessionCards.length, activeKey]);

  // 폴더(store) 변경 시에만 재로드. 첫 마운트는 lazy init이 이미 처리했으므로 스킵.
  useEffect(() => {
    if (curStore.current === store) return;
    curStore.current = store;
    const d = loadStore(store, t("workspace.chatRepo"));
    setSessions(d.sessions); setOpenKeys(d.openKeys); setActiveKey(d.activeKey);
    ctxCache.current.clear();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- store 변경만 감지(t는 안정)
  }, [store]);

  // 세션 변경 영속. deps에서 store 제외 — store 바뀐 렌더에 옛 sessions를 새 store 키에 쓰는 오염 방지.
  // (store는 클로저 현재값으로 씀. 첫 실행은 loaded===loaded라 idempotent.)
  useEffect(() => {
    persistChat(store, sessions, openKeys, activeKey); // 쿼터 초과 시 잘라내며 재시도(#754)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 데이터 변경 시에만 저장(store 변경엔 반응 안 함)
  }, [sessions, openKeys, activeKey]);

  // 새 메시지·스트리밍·세션/서브 전환 시 하단으로.
  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight }); }, [messages, streaming, activeKey, activeSub.id]);

  // 세션 ensure(기존 데이터 보존) + 탭 열기 + 활성화.
  function openSession(key: string, kind: SessionKind, label: string) {
    const dropped: string[] = [];
    setSessions((prev) => {
      if (prev[key]) return prev; // 이미 있으면 대화 그대로 보존
      const next = { ...prev, [key]: mkSession(key, kind, label) };
      // 상한 정리 — 닫힌 것 먼저, 그래도 넘치면 오래된 열린 것까지(활성·repo·방금 것 제외).
      const closed = Object.keys(next).filter((k) => k !== REPO_KEY && k !== key && k !== activeKey && !openKeys.includes(k));
      const open = Object.keys(next).filter((k) => k !== REPO_KEY && k !== key && k !== activeKey && openKeys.includes(k));
      for (const k of [...closed, ...open]) { if (Object.keys(next).length <= MAX_SESSIONS) break; delete next[k]; dropped.push(k); }
      return next;
    });
    setOpenKeys((prev) => { const p = prev.filter((k) => !dropped.includes(k)); return p.includes(key) ? p : [...p, key]; });
    setActiveKey(key);
  }

  // 포커스 신호(WorkspaceView) → 해당 세션 열기·활성. n(nonce) 덕에 같은 대상 재클릭도 발화.
  useEffect(() => {
    if (!focus) return;
    openSession(focus.key, focus.kind, focus.label);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- focus만 감시(openSession 넣으면 매 렌더 재실행)
  }, [focus]);

  // 카드→arch 질문 좌표 삽입(#746) — 입력창에 텍스트 넣고(기존 입력 뒤 이어붙임). 포커스·캐럿은 아래 이펙트가 input 반영 후 처리.
  useEffect(() => {
    if (!prefill?.text) return;
    setInput((prev) => (prev.trim() ? prev.replace(/\s+$/, "") + " " + prefill.text : prefill.text));
    focusPendingRef.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- prefill.n 신호만 감시
  }, [prefill?.n]);
  // input 반영(DOM 갱신) 후 포커스 + 캐럿 끝으로 — setInput 직후 캐럿은 옛 길이라 별도 이펙트로 분리.
  useEffect(() => {
    if (!focusPendingRef.current) return;
    focusPendingRef.current = false;
    const el = taRef.current;
    if (el) { el.focus(); const end = el.value.length; try { el.setSelectionRange(end, end); } catch { /* ignore */ } }
  }, [input]);

  // ── 워킹트리 챗 커밋 승계(#689) ──
  // carryOver가 await 사이 최신 sessions를 읽도록 ref 미러(클로저 stale 방지) + 언마운트 가드.
  const sessionsRef = useRef(sessions);
  useEffect(() => { sessionsRef.current = sessions; });
  const aliveRef = useRef(true);
  useEffect(() => () => { aliveRef.current = false; }, []);

  // worktree 세션 생성 시점 HEAD를 baseHead로 백필(커밋 vs 되돌림 판별 기준).
  useEffect(() => {
    const pending = Object.values(sessions).filter((s) => s.kind === "worktree" && !s.baseHead);
    if (!pending.length || !root) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch("/api/repo/file-commit", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: root }) });
        const d = await r.json();
        const head = r.ok && d.ok ? String(d.head ?? "") : "";
        if (!head || cancelled) return;
        setSessions((prev) => {
          let changed = false; const next = { ...prev };
          for (const s of pending) { const cur = next[s.key]; if (cur && cur.kind === "worktree" && !cur.baseHead) { next[s.key] = { ...cur, baseHead: head }; changed = true; } }
          return changed ? next : prev;
        });
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, [sessions, root]);

  // 세션 완전 삭제(승계 시 빈 중복 wt 정리용). repo는 불가.
  const dropSession = useCallback((key: string) => {
    if (key === REPO_KEY) return;
    setSessions((prev) => { if (!prev[key]) return prev; const rest = { ...prev }; delete rest[key]; return rest; });
    setOpenKeys((prev) => prev.filter((k) => k !== key));
    setActiveKey((cur) => (cur === key ? REPO_KEY : cur));
    ctxCache.current.delete(key);
  }, []);

  // worktree 세션 → 커밋 diff 세션으로 리키(대화 보존). 타겟 이미 있으면 호출측서 스킵.
  // 세 setState는 React 19 자동 배칭으로 단일 커밋 → activeKey가 없는 세션 가리키는 중간 렌더 없음.
  const rekeySession = useCallback((oldKey: string, newKey: string, kind: SessionKind, label: string) => {
    setSessions((prev) => {
      if (!prev[oldKey] || prev[newKey]) return prev;
      const { [oldKey]: old, ...rest } = prev;
      return { ...rest, [newKey]: { ...old, key: newKey, kind, label, baseHead: undefined } };
    });
    setOpenKeys((prev) => prev.map((k) => (k === oldKey ? newKey : k)));
    setActiveKey((cur) => (cur === oldKey ? newKey : cur));
    ctxCache.current.delete(oldKey);
  }, []);

  // 변경목록서 사라진 worktree 세션이 커밋됐으면(baseHead..HEAD에 그 파일 담은 커밋 존재) 승계.
  const carryOver = useCallback(async (changed: Set<string>) => {
    const wt = Object.values(sessionsRef.current).filter((s) => s.kind === "worktree" && s.baseHead);
    for (const s of wt) {
      const file = s.key.slice("wt:".length);
      if (changed.has(file)) continue; // 아직 변경 중 → 유지
      try {
        const r = await fetch("/api/repo/file-commit", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: root, file, baseHead: s.baseHead }) });
        const d = await r.json();
        if (!aliveRef.current) return; // 언마운트됨 → setState 중단
        const hash = r.ok && d.ok && d.hash ? String(d.hash) : "";
        if (!hash) continue; // 커밋 아님(되돌림) → 방치
        carryHunkNotes(root, file, hash); // DiffPane 에이전트 설명 노트도 커밋 diff로 승계(챗 세션과 무관하게)
        const newKey = `diff:${hash}:${file}`;
        const cur = sessionsRef.current[s.key]; // await 뒤 최신 스냅샷으로 재판정(stale 방지)
        if (!cur || cur.kind !== "worktree") continue; // 이미 승계/변경됨
        if (sessionsRef.current[newKey]) {
          // 타겟 커밋 세션이 이미 있음 — 대화 없는 빈 wt만 정리(대화 있으면 병합 위험이라 방치).
          if (cur.subs.every((sub) => sub.messages.length === 0)) dropSession(s.key);
          continue;
        }
        rekeySession(s.key, newKey, "diff", `${file.split("/").pop() ?? file} @${hash.slice(0, 7)}`);
      } catch { /* ignore */ }
    }
  }, [root, rekeySession, dropSession]);

  // 변경 파일 집합이 갱신될 때(git-status refetch)만 승계 점검 — 채팅 등 잦은 렌더엔 안 돎.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- changedFiles 변경 시에만(carryOver는 그 시점 최신)
  useEffect(() => { if (changedFiles) void carryOver(changedFiles); }, [changedFiles]);

  // 탭 닫기 — 탭바에서만 제거, 대화 데이터는 sessions에 보존(다시 열면 복원).
  function closeSession(key: string) {
    if (key === REPO_KEY) return;
    setOpenKeys((prev) => prev.filter((k) => k !== key));
    setActiveKey((cur) => cur === key ? REPO_KEY : cur);
  }

  // 특정 세션·서브의 메시지 갱신(키·subId 명시 — send 도중 탭/서브 전환돼도 원래 대화에 기록).
  function writeSub(key: string, subId: string, msgs: ChatMessage[]) {
    setSessions((prev) => {
      const s = prev[key]; if (!s) return prev;
      // createdAt 없으면(레거시 서브 or 재사용) 첫 쓰기 시각으로 스탬프 — 새 질문이 '이전 기록'으로 빠지는 것 방지(#691).
      return { ...prev, [key]: { ...s, subs: s.subs.map((su) => su.id === subId ? { ...su, messages: msgs, createdAt: su.createdAt ?? Date.now() } : su) } };
    });
  }

  // 특정 세션·서브의 테스트(퀴즈) 세션들 저장(#760) — WorkspaceQuizPanel의 onQuizzesChange가 호출.
  function setSubQuizzes(key: string, subId: string, quizzes: QuizSession[], activeQuizId: string | undefined) {
    setSessions((prev) => {
      const s = prev[key]; if (!s) return prev;
      return { ...prev, [key]: { ...s, subs: s.subs.map((su) => su.id === subId ? { ...su, quizzes, activeQuizId } : su) } };
    });
  }

  // 서브 대화: 새로 / 전환 / 닫기.
  function newSub() {
    setSessions((prev) => { const s = prev[activeKey]; if (!s) return prev; const su = freshSub(); return { ...prev, [activeKey]: { ...s, subs: [...s.subs, su], activeSubId: su.id } }; });
  }
  function switchSub(id: string) {
    setSessions((prev) => { const s = prev[activeKey]; if (!s) return prev; return { ...prev, [activeKey]: { ...s, activeSubId: id } }; });
  }
  async function closeSub(id: string) {
    // 항상 삭제 확인(실수 방지) — Ask 챗룸과 동일.
    if (!(await confirm({ skipKey: CKEYS.skipDelete, title: t("workspace.chatDeleteThreadTitle"), message: t("workspace.chatDeleteThread"), confirmText: t("common.delete"), danger: true }))) return;
    setSessions((prev) => {
      const s = prev[activeKey]; if (!s) return prev;
      let subs = s.subs.filter((su) => su.id !== id);
      if (!subs.length) subs = [freshSub()]; // 최소 1개 유지
      const activeSubId = s.activeSubId === id ? subs[subs.length - 1].id : s.activeSubId;
      return { ...prev, [activeKey]: { ...s, subs, activeSubId } };
    });
  }

  // kind별 컨텍스트 빌드(세션키 캐시).
  // 아키텍처 세션 컨텍스트 — #743이 저장한 flow 캐시(설명 overview + 레이어별 노드)를 사람이 읽는 문자열로.
  // 캐시 없으면(아직 미생성) feature명 + 안내만. localStorage 동기 읽기(전송 시점).
  function archContext(feature: string): string {
    let sections: ArchSection[] = [], overview = "";
    try {
      const raw = localStorage.getItem(`nunopi:ws:${root}:flow:${encodeURIComponent(feature)}`);
      if (raw) {
        const j = JSON.parse(raw);
        if (Array.isArray(j)) sections = j as ArchSection[];
        else { sections = Array.isArray(j?.sections) ? j.sections : []; overview = typeof j?.overview === "string" ? j.overview : ""; }
      }
    } catch { /* 캐시 손상 → 폴백 */ }
    const lines: string[] = [`# 기능(아키텍처): ${feature}`];
    if (overview) lines.push(`\n## 설명\n${overview}`);
    if (sections.length) {
      lines.push(`\n## 구성 요소 (레이어별, "→"는 흐름상 다음으로 이어지는 노드)`);
      for (const s of sections) {
        lines.push(`\n### ${s.layer}`);
        for (const n of s.nodes ?? []) {
          const parts = [n.name];
          if (n.file) parts.push(n.file + (n.line ? `:${n.line}` : ""));
          if (n.role) parts.push(n.role);
          if (n.next?.length) parts.push(`→ ${n.next.join(", ")}`);
          lines.push(`- ${parts.join(" · ")}`);
        }
      }
      // 답변 지침 — 질문에 나온 구성요소는 역할뿐 아니라 연결된 노드와의 관계·흐름까지 설명하도록.
      lines.push(`\n---\n(답변 지침) 질문에 특정 구성요소(예: [이름])가 나오면, 그것의 역할만이 아니라 위 구조에서 그것과 연결된(→) 노드들과의 관계·데이터 흐름·왜 그렇게 이어지는지를 개발 초보도 이해할 수 있게 함께 설명해줘.`);
    }
    if (!overview && !sections.length) lines.push(`\n(아직 이 기능의 아키텍처 흐름이 생성되지 않았어요. 좌측 "아키텍처"에서 이 기능을 열면 흐름이 만들어져요.)`);
    return lines.join("\n") + "\n";
  }

  async function buildContext(s: Session): Promise<string> {
    const cached = ctxCache.current.get(s.key);
    if (s.kind !== "worktree" && s.kind !== "arch" && cached != null) return cached; // worktree=편집 시 변함, arch=flow 재생성 시 변함 → 캐시 무시
    let ctx = "";
    try {
      if (s.kind === "file") {
        const f = s.key.slice("file:".length);
        const r = await fetch("/api/repo/file", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ root, file: f }) });
        const d = await r.json();
        const src = r.ok ? String(d.content ?? "") : "";
        ctx = src ? `# 지금 열린 파일: ${f}\n\`\`\`\n${src}\n\`\`\`\n` : "";
      } else if (s.kind === "diff") {
        // 키: diff:<hash>:<file> — hash 뒤 첫 ':' 기준 분리(파일 경로 안전).
        const rest = s.key.slice("diff:".length);
        const ci = rest.indexOf(":");
        if (ci < 0) return ""; // 방어: 정상 키는 항상 hash:file
        const hash = rest.slice(0, ci), file = rest.slice(ci + 1);
        const r = await fetch("/api/repo/git-show", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: root, hash, file }) });
        const d = await r.json();
        const diff = r.ok && d.ok ? String(d.diff ?? "") : "";
        ctx = diff ? `# 커밋 ${hash.slice(0, 7)}에서 ${file}의 변경(diff, before/after)\n\`\`\`diff\n${diff}\n\`\`\`\n` : "";
      } else if (s.kind === "worktree") {
        // wt:<file> — 그 파일의 커밋 전 diff. unstaged+staged 우선(둘 다 비면 untracked 새 파일).
        // 추적 파일에 untracked(--no-index)를 헛돌리면 전체를 신규로 오인하므로 마지막에만.
        const file = s.key.slice("wt:".length);
        const getDiff = async (kind: "unstaged" | "staged" | "untracked") => {
          try {
            const r = await fetch("/api/repo/git-diff", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: root, file, kind }) });
            const d = await r.json();
            return r.ok && d.ok ? String(d.diff ?? "") : "";
          } catch { return ""; }
        };
        let diff = [await getDiff("unstaged"), await getDiff("staged")].filter(Boolean).join("\n");
        if (!diff) diff = await getDiff("untracked");
        ctx = diff ? `# ${file}의 커밋 전 변경(워킹트리 diff, before/after)\n\`\`\`diff\n${diff}\n\`\`\`\n` : `# ${file}: 현재 커밋 전 변경 없음\n`;
      } else if (s.kind === "branch") {
        const branch = s.key.slice("branch:".length);
        const r = await fetch("/api/repo/git-branch", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: root, branch }) });
        const d = await r.json();
        if (r.ok && d.ok) {
          const parts = [`# 브랜치: ${branch}`];
          if (d.commits) parts.push(`## 최근 커밋\n${d.commits}`);
          if (d.stat) parts.push(`## ${d.base} 대비 변경 요약\n\`\`\`\n${d.stat}\n\`\`\``);
          ctx = parts.join("\n\n") + "\n";
        }
      } else if (s.kind === "arch") {
        ctx = archContext(s.key.slice("arch:".length));
      } else if (s.kind === "repo") {
        ctx = await repoContext();
      }
    } catch { ctx = ""; }
    if (s.kind !== "worktree" && s.kind !== "arch") ctxCache.current.set(s.key, ctx); // worktree·arch는 캐시 안 함(항상 최신 diff/flow)
    if (s.kind === "repo") ctx += "\n" + await workHistory(); // #1078 작업 기록은 매번 새로(캐시 X — 질문 사이에도 쌓임)
    return ctx;
  }

  // #1078 캐치업 작업 기록(최근 100개) — 레포 전체 질문에 붙임. 실패하면 빈 문자열.
  async function workHistory(): Promise<string> {
    try {
      const j = await fetch(`/api/repo/stream?root=${encodeURIComponent(root)}&limit=100`).then((r) => r.json());
      return j?.ok && Array.isArray(j.items) ? buildWorkHistory(j.items as AskItem[]) : "";
    } catch { return ""; }
  }

  // 레포 전체 컨텍스트 — 구조 요약 + package.json/README + 현재 브랜치.
  async function repoContext(): Promise<string> {
    const parts: string[] = [];
    // 폴더별 파일 수 요약(상위 디렉터리 기준).
    const byTop = new Map<string, number>();
    for (const f of files) { const top = f.includes("/") ? f.slice(0, f.indexOf("/")) : "(root)"; byTop.set(top, (byTop.get(top) ?? 0) + 1); }
    const summary = [...byTop.entries()].sort((a, b) => b[1] - a[1]).map(([d, n]) => `${d}/ (${n})`).join(", ");
    parts.push(`# 레포 구조 (총 ${files.length}개 파일)\n${summary}`);
    // 핵심 파일 소스.
    for (const key of ["package.json", "README.md", "readme.md"]) {
      const f = files.find((x) => x.toLowerCase() === key.toLowerCase());
      if (!f) continue;
      try {
        const r = await fetch("/api/repo/file", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ root, file: f }) });
        const d = await r.json();
        const src = r.ok ? String(d.content ?? "").slice(0, 4000) : "";
        if (src) parts.push(`# ${f}\n\`\`\`\n${src}\n\`\`\``);
      } catch { /* ignore */ }
    }
    // 현재 브랜치(git-log 라우트가 branch 반환).
    try {
      const r = await fetch("/api/repo/git-log", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: root }) });
      const d = await r.json();
      if (r.ok && d.branch) parts.push(`# 현재 브랜치: ${d.branch}`);
    } catch { /* ignore */ }
    return parts.join("\n\n") + "\n";
  }

  // 테스트 오버레이 열림(또는 세션 전환) 시 대상 자료를 조립해 QuizRunner에 넘긴다(#760).
  // 자료 = 챗 답변과 같은 buildContext(레포/파일/diff/아키텍처). 대화 기억은 QuizRunner가 messages로 따로 받음.
  useEffect(() => {
    if (!testOpen) return;
    let cancelled = false;
    setTestCtx(null); // 열림/전환 시 로딩 표시 후 async 자료 반영
    void buildContext(active).then((c) => { if (!cancelled) setTestCtx(c); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- activeKey로 세션 식별(active는 매 렌더 새 객체 → 무한 재실행 방지)
  }, [testOpen, activeKey]);

  // 특정 세션·서브의 한 어시스턴트 메시지 본문만 함수형 갱신(prev 기준 — 클로저 배열 클로버 방지).
  function editMessage(key: string, subId: string, msgIndex: number, mapContent: (c: string) => string) {
    setSessions((prev) => {
      const s = prev[key]; if (!s) return prev;
      return { ...prev, [key]: { ...s, subs: s.subs.map((su) => su.id !== subId ? su : { ...su, messages: su.messages.map((m, i) => i === msgIndex && m.role === "assistant" ? { ...m, content: mapContent(m.content) } : m) }) } };
    });
  }

  // 카드 제안 칩 액션 — 추가(저장) 또는 거절. 처리 후 해당 메시지에서 그 카드 블록 제거.
  function cardAction(msgIndex: number, action: { add?: SuggestedCard; dismiss?: boolean }) {
    const key = active.key, subId = active.activeSubId;
    if (action.add) {
      const c = action.add;
      // 출처 = 세션 무관 레포 이름으로 통일: 워크스페이스 "<레포>" 레포지트리.
      const repoName = root.split("/").filter(Boolean).pop() ?? root;
      // 이 챗 세션에 태깅(#750) — 세션별 "추가된 카드" 목록 필터 기준.
      const ok = createChatCard(c.kind ?? "term", c.term, c.definition, t("card.workspaceSource", { repo: repoName }), undefined, { kind: "workspace", sessionId: key, subId, root });
      toast(ok ? t("card.added", { term: c.term }) : t("card.exists"));
      editMessage(key, subId, msgIndex, (content) => removeSuggestedCard(content, c.term));
    } else if (action.dismiss) {
      editMessage(key, subId, msgIndex, stripCardBlock);
    }
  }

  // 현재 대화를 마크다운으로 클립보드 복사(카드 블록 JSON 제외 — 사람이 읽을 본문만).
  async function copyMd() {
    const clean = messages.map((m) => m.role === "assistant" ? { ...m, content: stripCardBlock(m.content) } : m);
    try { await navigator.clipboard.writeText(formatChatAsMarkdown(clean, t)); toast(t("chat.mdCopied")); } catch { /* clipboard 불가 — 무시 */ }
  }
  // 현재 대화 초기화(확인 모달 후). 목적지를 모달 전에 고정(모달 중 탭 전환 대비).
  async function clearThread() {
    const sk = active.key, subId = active.activeSubId;
    if (!(await confirm({ skipKey: CKEYS.skipDelete, title: t("chat.clear"), message: t("chat.confirmClear"), confirmText: t("chat.clear"), danger: true }))) return;
    writeSub(sk, subId, []);
  }

  async function send() {
    const text = input.trim();
    if (!text || loading) return;
    setInput("");
    const s = active;
    const sk = s.key, subId = s.activeSubId; // 이 대화의 목적지 고정(응답 대기 중 전환 대비)
    const thread: ChatMessage[] = [...messages, { role: "user", content: text }];
    writeSub(sk, subId, thread);
    setLoading(true); setStreaming("");
    try {
      const ctx = await buildContext(s);
      const res = await fetch("/api/agent/analyze", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerId, request: { code: ctx, locale, providerId, mode: "chat", messages: thread, providerSettings, noCards: !cardsOn, workspaceRoot: root } }), // #998 레포 읽기 전용 도구(Read/Grep/Glob) — 서버가 검증
      });
      if (!res.ok || !res.body) { writeSub(sk, subId, [...thread, { role: "assistant", content: t("fallback.requestFailed") }]); return; }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "", answer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const ls = buf.split("\n"); buf = ls.pop() ?? "";
        for (const l of ls) {
          if (!l.trim()) continue;
          let ev: StreamEvent; try { ev = JSON.parse(l) as StreamEvent; } catch { continue; }
          if (ev.type === "progress" && providerId !== "codex-agent") setStreaming(ev.line);
          else if (ev.type === "result") answer = ev.response.summary;
        }
      }
      // raw 저장(nunopi-cards 블록 보존) — 렌더 시 parseCardSuggestions로 본문/칩 분리.
      // #1081 답변에 커밋 해시만 나오고 카드 링크가 빠졌으면 앱이 "관련 카드"를 붙임(시간대 질문에서 자주 빠짐)
      if (answer && onOpenCard) {
        const hs = commitHashesIn(answer);
        if (hs.length) {
          const j = await fetch(`/api/repo/stream?root=${encodeURIComponent(root)}&hashes=${hs.join(",")}`).then((r) => r.json()).catch(() => null);
          if (Array.isArray(j?.items)) answer = withRelatedCards(answer, j.items as { key: string; kind: string; target: string }[], t("learn.relatedCards"));
        }
      }
      writeSub(sk, subId, [...thread, { role: "assistant", content: answer || t("fallback.emptyResponse") }]);
    } catch {
      writeSub(sk, subId, [...thread, { role: "assistant", content: t("fallback.error") }]);
    } finally {
      setLoading(false); setStreaming(null);
    }
  }

  // 탭 = openKeys 순서(repo 맨 앞).
  const tabs = useMemo(() => openKeys.filter((k) => sessions[k]).map((k) => sessions[k]), [openKeys, sessions]);

  // 서브 대화 제목 — "질문 N"(세션 내 순번). 단순·예측가능.
  const subTitle = (i: number) => `${t("workspace.chatThread")} ${i + 1}`;

  // 질문 이력 — 전 세션 × 서브 중 유저 질문이 있는 것만. 첫 유저 메시지 = 미리보기. 최신순 정렬(#691).
  const history = useMemo(() => Object.values(sessions).flatMap((s) =>
    s.subs.flatMap((sub) => {
      const q = sub.messages.find((m) => m.role === "user")?.content?.trim();
      return q ? [{ sessionKey: s.key, kind: s.kind, label: s.label, subId: sub.id, question: q, count: sub.messages.length, createdAt: sub.createdAt }] : [];
    })
  ).sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0)), [sessions]); // 최신 먼저(시각 없는 레거시는 0=뒤)

  // 히스토리를 날짜 버킷으로 그룹(#691). 이미 최신순 정렬돼 있어 그룹도 최신 날짜 먼저,
  // 시각 없는 레거시("이전 기록")는 맨 뒤로 모임.
  // todayStart를 메모 밖에서(매 렌더 계산, 값은 로컬 자정에만 변함) → deps에 넣어 페이지 열어둔 채
  // 자정 넘어가도 다음 렌더에 재그룹(어제 것이 '오늘'로 stuck 방지, 리뷰 🔴).
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const historyGroups = useMemo(() => {
    const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const DAY = 86_400_000;
    const groups: { key: string; label: string; items: typeof history }[] = [];
    for (const h of history) {
      let key: string, label: string;
      if (!h.createdAt) { key = "older"; label = t("workspace.chatHistoryOlder"); }
      else {
        const ds = startOfDay(new Date(h.createdAt));
        const diff = Math.round((todayStart - ds) / DAY);
        key = String(ds);
        label = diff === 0 ? t("workspace.chatToday") : diff === 1 ? t("workspace.chatYesterday")
          : new Date(h.createdAt).toLocaleDateString(locale, { year: "numeric", month: "long", day: "numeric" });
      }
      const last = groups[groups.length - 1];
      if (last && last.key === key) last.items.push(h); else groups.push({ key, label, items: [h] });
    }
    return groups;
  }, [history, locale, t, todayStart]);

  // 이력 항목 → 그 세션·서브 챗으로 이동(탭 없으면 열기 + 활성 서브 지정).
  function goToSub(sessionKey: string, subId: string) {
    if (!sessions[sessionKey]) { setHistoryOpen(false); return; } // 상한으로 사라진 세션이면 무시
    setOpenKeys((prev) => prev.includes(sessionKey) ? prev : [...prev, sessionKey]);
    setSessions((prev) => prev[sessionKey] ? { ...prev, [sessionKey]: { ...prev[sessionKey], activeSubId: subId } } : prev);
    setActiveKey(sessionKey);
    setHistoryOpen(false);
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* 세션 탭바 — 열린 세션들(repo/file/diff/branch) */}
      <div className="nunopi-scroll flex shrink-0 items-center gap-1 overflow-x-auto border-b border-zinc-200 px-1.5 py-1 dark:border-zinc-800">
        {tabs.map((s) => {
          const on = s.key === activeKey;
          return (
            <button key={s.key} type="button" onClick={() => setActiveKey(s.key)} title={s.key}
              className={`group inline-flex min-w-0 shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium transition ${on ? "bg-mustard-500/15 text-mustard-700 dark:text-mustard-400" /* #1078 캐치업 필터 칩과 같은 강조색 */ : "bg-zinc-100 text-zinc-500 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700"}`}>
              {kindGlyph(s.kind, 11, "shrink-0")}
              <span className="max-w-[92px] truncate">{labelOf(s.kind, s.label)}</span>
              {s.key !== REPO_KEY && (
                <span role="button" tabIndex={-1} onClick={(e) => { e.stopPropagation(); closeSession(s.key); }}
                  className={`ml-0.5 shrink-0 rounded ${on ? "hover:bg-white/25" : "hover:bg-zinc-300 dark:hover:bg-zinc-600"}`} aria-label={t("mem.close")}>
                  <IconX size={10} stroke={2.5} aria-hidden />
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* 헤더 — 현재 세션 표시 */}
      <div className="flex items-center gap-1.5 border-b border-zinc-200 px-3 py-1.5 dark:border-zinc-800">
        {kindGlyph(active.kind, 14, "shrink-0 text-mustard-600 dark:text-mustard-400")}
        <span className="min-w-0 truncate text-[12px] font-semibold text-zinc-700 dark:text-zinc-200" title={active.key}>{labelOf(active.kind, active.label)}</span>
        <div className="ml-auto flex shrink-0 items-center gap-0.5">
          {/* 테스트(퀴즈, #760) — 대화 없어도 세션 자료로 출제 가능하므로 상시 노출. 카드/히스토리와 배타. */}
          <button type="button" onClick={() => { setHistoryOpen(false); setCardsOpen(false); setTestOpen((v) => !v); }} className={`rounded p-1 transition hover:bg-zinc-100 dark:hover:bg-zinc-800 ${testOpen ? "text-mustard-600 dark:text-mustard-400" : "text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200"}`} title={t("quiz.title")} aria-label={t("quiz.title")} aria-pressed={testOpen}>
            <IconListCheck size={13} stroke={2} aria-hidden />
          </button>
          {messages.length > 0 && (
            <button type="button" onClick={() => { setHistoryOpen(false); setTestOpen(false); setCardsOpen((v) => !v); }} className={`relative rounded p-1 transition hover:bg-zinc-100 dark:hover:bg-zinc-800 ${cardsOpen ? "text-mustard-600 dark:text-mustard-400" : "text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200"}`} title={t("ask.sessionCards")} aria-label={t("ask.sessionCards")} aria-pressed={cardsOpen}>
              <IconCards size={13} stroke={2} aria-hidden />
              {sessionCards.length > (seenCards[activeKey] ?? 0) && <span className="absolute -right-0.5 -top-0.5 flex h-3 min-w-3 items-center justify-center rounded-full bg-mustard-500 px-0.5 text-[8px] font-bold leading-none text-brown-900 dark:bg-mustard-500 dark:text-brown-900">{sessionCards.length}</span>}
            </button>
          )}
          {history.length > 0 && (
            <button type="button" onClick={() => { setCardsOpen(false); setTestOpen(false); setHistoryOpen((v) => !v); }} className={`rounded p-1 transition hover:bg-zinc-100 dark:hover:bg-zinc-800 ${historyOpen ? "text-mustard-600 dark:text-mustard-400" : "text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200"}`} title={t("workspace.chatHistory")} aria-label={t("workspace.chatHistory")} aria-pressed={historyOpen}>
              <IconHistory size={13} stroke={2} aria-hidden />
            </button>
          )}
          {messages.length > 0 && (
            <>
              <button type="button" onClick={() => void copyMd()} className="rounded p-1 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-200" title={t("chat.copyMd")} aria-label={t("chat.copyMd")}>
                <IconFileText size={13} stroke={2} aria-hidden />
              </button>
              <button type="button" onClick={() => void clearThread()} className="rounded p-1 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-200" title={t("chat.clear")} aria-label={t("chat.clear")}>
                <IconEraser size={13} stroke={2} aria-hidden />
              </button>
            </>
          )}
        </div>
      </div>

      {/* 서브 대화 탭바 — 이 세션 안의 여러 대화 스레드. 탭은 가로 스크롤, +는 우측 고정 */}
      <div className="flex shrink-0 items-center border-b border-zinc-100 bg-zinc-50/60 dark:border-zinc-800/60 dark:bg-zinc-900/40">
        <div className="nunopi-scroll flex min-w-0 flex-1 items-center gap-1 overflow-x-auto px-1.5 py-1">
          {active.subs.map((sub, i) => {
            const on = sub.id === active.activeSubId;
            return (
              <button key={sub.id} type="button" onClick={() => switchSub(sub.id)} title={subTitle(i)}
                className={`group inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[10px] transition ${on ? "bg-white font-semibold text-zinc-700 shadow-sm dark:bg-zinc-700 dark:text-zinc-100" : "text-zinc-400 hover:bg-white/70 dark:text-zinc-500 dark:hover:bg-zinc-800"}`}>
                <IconMessageCircle size={10} stroke={2} className="shrink-0" aria-hidden />
                <span className="whitespace-nowrap">{subTitle(i)}</span>
                {active.subs.length > 1 && (
                  <span role="button" tabIndex={-1} onClick={(e) => { e.stopPropagation(); void closeSub(sub.id); }}
                    className="ml-0.5 shrink-0 rounded text-zinc-400 hover:bg-zinc-200 hover:text-zinc-600 dark:hover:bg-zinc-600" aria-label="close thread">
                    <IconX size={9} stroke={2.5} aria-hidden />
                  </span>
                )}
              </button>
            );
          })}
        </div>
        <button type="button" onClick={newSub} title={t("workspace.chatNewThread")}
          className="shrink-0 border-l border-zinc-200 px-2 py-1.5 text-zinc-400 transition hover:bg-white hover:text-mustard-600 dark:border-zinc-800 dark:hover:bg-zinc-700 dark:hover:text-mustard-400">
          <IconPlus size={12} stroke={2.5} aria-hidden />
        </button>
      </div>

      {/* 메시지 + (이력 오버레이) */}
      <div className="relative min-h-0 flex-1">
      <div ref={scrollRef} className="nunopi-scroll h-full overflow-y-auto px-3 py-3">
        {messages.length === 0 && !loading ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-zinc-300 dark:text-zinc-600">
            {/* #1078 활용 도움말 — 첫 줄 제목 + "· " 항목 목록(내어쓰기로 줄바꿈 정렬) */}
            {(() => { const [title, ...items] = t("workspace.chatEmpty").split("\n"); return (
              <div className="w-full max-w-[17rem] text-left text-zinc-400 dark:text-zinc-500">
                {/* 흔한 빈 화면 패턴 — 둥근 배지 아이콘 + 가운데 제목, 그 아래 예시 목록 */}
                <span className="mx-auto mb-2.5 flex h-10 w-10 items-center justify-center rounded-xl bg-zinc-100 text-zinc-400 dark:bg-zinc-800 dark:text-zinc-500" aria-hidden>
                  <IconMessageCircle size={20} stroke={1.75} />
                </span>
                <p className="mb-3 text-center text-[12px] font-semibold text-zinc-500 dark:text-zinc-400">{title}</p>
                <ul className="flex flex-col gap-1.5 text-[11px] leading-snug">
                  {items.map((x, i) => <li key={i} className="flex gap-1.5"><span className="shrink-0 text-zinc-300 dark:text-zinc-600" aria-hidden>•</span><span>{x.replace(/^·\s*/, "")}</span></li>)}
                </ul>
              </div>
            ); })()}
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {messages.map((m, i) => {
              if (m.role === "user") return (
                <div key={i} className="self-end max-w-[85%] whitespace-pre-wrap rounded-2xl bg-zinc-100 px-3 py-1.5 text-[12px] leading-relaxed text-zinc-800 dark:bg-zinc-700 dark:text-zinc-100">{m.content}</div>
              );
              // 어시스턴트 — 본문 + nunopi-cards 칩(다른 챗룸과 동일). 파일/심볼 카드는 제외(#746).
              const parsedCards = parseCardSuggestions(m.content);
              const text = parsedCards.text;
              const cards = parsedCards.cards.filter(keepCard);
              return (
                <div key={i} className="flex max-w-full flex-col items-start gap-1.5 text-[12px] leading-relaxed text-zinc-700 dark:text-zinc-200">
                  <div className="max-w-full"><Markdown onLink={onLink}>{text}</Markdown></div>
                  {cards.length > 0 && (
                    <div className="flex flex-wrap items-center gap-1.5">
                      {cards.map((c) => bookmarkedTermExists(c.term) ? (
                        <button key={c.term} type="button" onClick={() => toast(t("card.exists"))}
                          className="inline-flex items-center gap-1 rounded-full bg-zinc-200 px-2.5 py-1 text-[11px] font-medium text-zinc-500 transition hover:bg-zinc-300 dark:bg-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-600">
                          <IconCheck size={12} stroke={2.5} aria-hidden />{c.term} {t("chat.cardExists")}
                        </button>
                      ) : (
                        <button key={c.term} type="button" onClick={() => cardAction(i, { add: c })}
                          className="inline-flex items-center gap-1 rounded-full bg-mustard-500/12 px-2.5 py-1 text-[11px] font-medium text-mustard-700 ring-1 ring-inset ring-mustard-500/35 transition hover:bg-mustard-500/20 dark:bg-mustard-400/12 dark:text-mustard-400 dark:ring-mustard-400/30 dark:hover:bg-mustard-400/20">
                          <IconPlus size={12} stroke={2.5} aria-hidden />{c.term} {t("chat.saveAsCard")}
                        </button>
                      ))}
                      <button type="button" onClick={() => cardAction(i, { dismiss: true })}
                        className="rounded-full bg-zinc-200 px-2.5 py-1 text-[11px] font-medium text-zinc-500 transition hover:bg-zinc-300 dark:bg-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-600">
                        {t("chat.noThanks")}
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
            {/* 스트리밍 답변 — 어시스턴트 자리에 Markdown 진행(Ask 챗룸과 통일). 첫 토큰 전엔 "답변 작성 중…". */}
            {streaming != null && (
              <div className="max-w-full text-[12px] leading-relaxed text-zinc-700 dark:text-zinc-200">
                {streaming
                  ? <div className="max-w-full"><Markdown onLink={onLink}>{stripStreamingCardBlock(streaming)}</Markdown></div>
                  : <span className="flex items-center gap-1.5 text-[11px] text-zinc-400 dark:text-zinc-500"><IconLoader2 size={13} stroke={2} className="animate-spin" aria-hidden /> {t("chat.replying")}</span>}
              </div>
            )}
          </div>
        )}
      </div>

      {/* 질문 이력 오버레이 — 이 레포에서 한 모든 질문. 클릭 시 그 챗으로 이동. */}
      {historyOpen && (
        <div className="absolute inset-0 z-10 flex flex-col bg-white dark:bg-[var(--s-pane)]">
          <div className="flex shrink-0 items-center gap-1.5 border-b border-zinc-200 px-3 py-1.5 dark:border-zinc-800">
            <IconHistory size={13} stroke={2} className="shrink-0 text-mustard-600 dark:text-mustard-400" aria-hidden />
            <span className="text-[12px] font-semibold text-zinc-700 dark:text-zinc-200">{t("workspace.chatHistory")}</span>
            <span className="rounded bg-zinc-200 px-1 text-[9px] font-bold text-zinc-500 dark:bg-zinc-700 dark:text-zinc-300">{history.length}</span>
            <button type="button" onClick={() => setHistoryOpen(false)} className="ml-auto shrink-0 rounded p-1 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800" aria-label={t("mem.close")}>
              <IconX size={13} stroke={2} aria-hidden />
            </button>
          </div>
          <div className="nunopi-scroll min-h-0 flex-1 overflow-y-auto py-1">
            {history.length === 0 ? (
              <div className="flex h-full items-center justify-center text-[11px] text-zinc-400 dark:text-zinc-500">{t("workspace.chatHistoryEmpty")}</div>
            ) : historyGroups.map((group) => (
              <div key={group.key}>
                {/* 날짜 헤더 — 스크롤 시 상단 고정 */}
                <div className="sticky top-0 z-[1] bg-white/95 px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-zinc-400 backdrop-blur dark:bg-[var(--s-pane)]/95 dark:text-zinc-500">{group.label}</div>
                {group.items.map((h) => (
                  <button key={`${h.sessionKey}:${h.subId}`} type="button" onClick={() => goToSub(h.sessionKey, h.subId)}
                    className="flex w-full items-start gap-2 px-3 py-2 text-left transition hover:bg-zinc-100 dark:hover:bg-zinc-800">
                    <span className="mt-0.5 shrink-0">{kindGlyph(h.kind, 13, "text-zinc-400")}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[10px] text-zinc-400 dark:text-zinc-500">{labelOf(h.kind, h.label)}</span>
                      <span className="line-clamp-2 text-[12px] leading-snug text-zinc-700 dark:text-zinc-200">{h.question}</span>
                    </span>
                    <span className="mt-0.5 shrink-0 rounded bg-zinc-100 px-1 text-[9px] font-medium text-zinc-400 dark:bg-zinc-800 dark:text-zinc-500">{h.count}</span>
                  </button>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
      {/* 이 세션에서 추가된 카드 목록(#750) — 히스토리 오버레이와 동형. */}
      {cardsOpen && (
        <div className="absolute inset-0 z-10 flex flex-col bg-white dark:bg-[var(--s-pane)]">
          <div className="flex shrink-0 items-center gap-1.5 border-b border-zinc-200 px-3 py-1.5 dark:border-zinc-800">
            <IconCards size={13} stroke={2} className="shrink-0 text-mustard-600 dark:text-mustard-400" aria-hidden />
            <span className="text-[12px] font-semibold text-zinc-700 dark:text-zinc-200">{t("ask.sessionCards")}</span>
            <span className="rounded bg-zinc-200 px-1 text-[9px] font-bold text-zinc-500 dark:bg-zinc-700 dark:text-zinc-300">{sessionCards.length}</span>
            <button type="button" onClick={() => setCardsOpen(false)} className="ml-auto shrink-0 rounded p-1 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800" aria-label={t("mem.close")}>
              <IconX size={13} stroke={2} aria-hidden />
            </button>
          </div>
          <div className="nunopi-scroll min-h-0 flex-1 overflow-y-auto p-2">
            {sessionCards.length === 0 ? (
              <div className="flex h-full items-center justify-center text-[11px] text-zinc-400 dark:text-zinc-500">{t("ask.noSessionCards")}</div>
            ) : sessionCards.map((c) => (
              <button key={c.key} type="button"
                onClick={(e) => throwCard(c, e.currentTarget.getBoundingClientRect())}
                className="mb-1 flex w-full flex-col items-start gap-0.5 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-left transition hover:border-mustard-500 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-mustard-400">
                <span className="w-full truncate text-[12px] font-medium text-zinc-800 dark:text-zinc-100">{c.front}</span>
                {c.back && <span className="line-clamp-2 text-[11px] text-zinc-500 dark:text-zinc-400">{c.back}</span>}
                {c.bookmarkedAt && <span className="mt-0.5 text-[9px] text-zinc-400 dark:text-zinc-500">{new Date(c.bookmarkedAt).toLocaleString(locale === "ja" ? "ja-JP" : locale === "en" ? "en-US" : "ko-KR", { dateStyle: "medium", timeStyle: "short" })}</span>}
              </button>
            ))}
          </div>
        </div>
      )}
      {/* 테스트(퀴즈) 오버레이(#760) — 히스토리/카드와 동형. 대상 자료 + 대화로 QuizRunner가 출제·채점. */}
      {testOpen && (
        <div className="absolute inset-0 z-10 flex flex-col bg-white dark:bg-[var(--s-pane)]">
          <div className="flex shrink-0 items-center gap-1.5 border-b border-zinc-200 px-3 py-1.5 dark:border-zinc-800">
            <IconListCheck size={13} stroke={2} className="shrink-0 text-mustard-600 dark:text-mustard-400" aria-hidden />
            <span className="text-[12px] font-semibold text-zinc-700 dark:text-zinc-200">{t("quiz.title")}</span>
            <button type="button" onClick={() => setTestOpen(false)} className="ml-auto shrink-0 rounded p-1 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800" aria-label={t("mem.close")}>
              <IconX size={13} stroke={2} aria-hidden />
            </button>
          </div>
          <div className="min-h-0 flex-1">
            {testCtx === null ? (
              <div className="flex h-full items-center justify-center text-zinc-300 dark:text-zinc-600"><IconLoader2 size={20} stroke={2} className="animate-spin" aria-hidden /></div>
            ) : (
              <WorkspaceQuizPanel
                key={activeSub.id}
                messages={activeSub.messages}
                sourceContext={testCtx}
                providerId={providerId}
                providerSettings={providerSettings}
                quizzes={activeSub.quizzes ?? []}
                activeQuizId={activeSub.activeQuizId}
                onQuizzesChange={(qs, aid) => setSubQuizzes(activeKey, activeSub.id, qs, aid)}
              />
            )}
          </div>
        </div>
      )}
      </div>

      {/* 입력 */}
      <div className="border-t border-zinc-200 p-2 dark:border-zinc-800">
        <div className="flex items-end gap-1.5 rounded-xl border border-zinc-200 bg-white px-2.5 py-1.5 focus-within:border-mustard-500 dark:border-zinc-700 dark:bg-[var(--s-raise)] dark:focus-within:border-mustard-400">
          <textarea
            ref={taRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(); } }} // 한글 조합 중 Enter는 조합 확정용 — 보내면 마지막 글자가 입력창에 남음
            rows={1}
            placeholder={t("workspace.chatPlaceholder")}
            className="nunopi-scroll max-h-28 min-h-0 flex-1 resize-none bg-transparent py-0.5 text-[12px] leading-5 text-zinc-800 outline-none placeholder:text-zinc-400 dark:text-zinc-100 dark:placeholder:text-zinc-500"
          />
          <button type="button" onClick={() => void send()} disabled={!input.trim() || loading}
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-mustard-500 text-brown-900 transition hover:bg-mustard-400 disabled:opacity-40 dark:bg-mustard-500 dark:text-brown-900">
            {loading ? <IconLoader2 size={13} stroke={2.5} className="animate-spin" aria-hidden /> : <IconArrowUp size={14} stroke={2.5} aria-hidden />}
          </button>
        </div>
      </div>
    </div>
  );
}
