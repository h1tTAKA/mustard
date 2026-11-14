"use client";
// 질문 세션 저장소(#653 → #1326 공용) — 캐치업 질문 화면(WorkspaceChat)과 코드 그래프 노드 질문이 같은 localStorage를 씀.
// 키: nunopi:ws-chat:<root>. 질문 이력은 이 세션들의 서브 대화에서 만들어짐 → 여기 쓰면 이력에 남음.
// 화면 밖에서 쓴 뒤 WS_CHAT_EVENT(detail.root) → 열린 WorkspaceChat이 다시 읽음(안 그러면 자기 상태로 덮어씀).
import type { ChatMessage, QuizSession } from "@mustard/core";

export type SessionKind = "repo" | "file" | "diff" | "branch" | "worktree" | "arch";
export interface Sub { id: string; messages: ChatMessage[]; createdAt?: number; quizzes?: QuizSession[]; activeQuizId?: string; } // 세션 안의 한 대화 스레드. createdAt=생성 시각(ms, 히스토리 날짜 그룹용 #691). quizzes=이 스레드의 테스트 세션들·activeQuizId=활성 테스트(#760). 레거시 저장분은 undefined.
// baseHead: worktree 세션 생성 시점 HEAD sha — 커밋 승계 판별용(#689, 커밋3에서 채움).
export interface Session { key: string; kind: SessionKind; label: string; subs: Sub[]; activeSubId: string; baseHead?: string; }

export const REPO_KEY = "repo";
export const MAX_SESSIONS = 40; // 닫힌 세션 포함 저장 상한 — 초과 시 가장 오래된 "닫힌" 세션부터 정리.

export const genId = () => globalThis.crypto?.randomUUID?.() ?? String(Math.random()).slice(2);
export const freshSub = (): Sub => ({ id: genId(), messages: [], createdAt: Date.now() });
export const mkSession = (key: string, kind: SessionKind, label: string): Session => { const s = freshSub(); return { key, kind, label, subs: [s], activeSubId: s.id }; };

// localStorage에서 세션 복원(마이그레이션 포함). SSR/미저장 시 기본(repo 세션 1개).
// 마운트 시 동기 호출 → 하이드레이션 이펙트 레이스(빈 상태 덮어쓰기) 원천 제거.
export function loadStore(store: string, repoLabel: string): { sessions: Record<string, Session>; openKeys: string[]; activeKey: string } {
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
export function persistChat(store: string, sessions: Record<string, Session>, openKeys: string[], activeKey: string, keep?: string): void { // keep: 쿼터 정리에서 지킬 세션(방금 쓴 것, 리뷰)
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
    .filter((k) => k !== REPO_KEY && k !== activeKey && k !== keep)
    .sort((a, b) => recency(work[a]) - recency(work[b]));
  for (const k of removable) { delete work[k]; if (write(work)) return; }
  // 최후 — repo + 활성 세션만. 그래도 실패면 포기(이전 성공 저장분은 그대로 남음).
  const minimal: Record<string, Session> = {};
  if (work[REPO_KEY]) minimal[REPO_KEY] = work[REPO_KEY];
  if (work[activeKey]) minimal[activeKey] = work[activeKey];
  if (keep && work[keep]) minimal[keep] = work[keep];
  write(minimal);
}

// 질문 화면 상태(mine)와 저장소에서 다시 읽은 것(disk)을 합침 — 통째 바꾸면 아직 저장 안 된 내 질문·답이 사라짐(리뷰).
// 세션·서브는 합집합, 같은 서브는 메시지가 더 많은 쪽(둘 다 덧붙이기만 하므로 긴 쪽이 최신).
// 한계: 양쪽이 같은 서브에 동시에 덧붙이면 짧은 쪽 새 메시지는 빠짐(그래프 쪽은 저장소에 남아 다음 읽기에 다시 보임).
export function mergeSessions(mine: Record<string, Session>, disk: Record<string, Session>): Record<string, Session> {
  const out: Record<string, Session> = { ...disk, ...mine };
  for (const [k, d] of Object.entries(disk)) {
    const m = mine[k];
    if (!m) continue;
    const subs = m.subs.map((ms) => { const ds = d.subs.find((x) => x.id === ms.id); return ds && ds.messages.length > ms.messages.length ? { ...ms, messages: ds.messages } : ms; });
    for (const ds of d.subs) if (!subs.some((x) => x.id === ds.id)) subs.push(ds);
    out[k] = { ...m, subs };
  }
  return out;
}

export const chatStoreKey = (root: string) => `nunopi:ws-chat:${root}`;
export const WS_CHAT_EVENT = "mustard:ws-chat";

// 바깥(그래프 노드 질문 등)에서 한 세션의 서브 대화 끝에 메시지를 덧붙임 — 매번 저장소의 최신을 읽고 붙여서,
// 그사이 질문 화면이 같은 세션에 쓴 것을 지우지 않음(리뷰: 통째 덮어쓰기 금지). 세션이 없으면 만듦(탭은 안 엶).
// 새 세션이면 MAX_SESSIONS를 넘는 만큼 오래된 닫힌 세션을 정리(질문 화면 openSession과 같은 규칙).
// 반환: 쓴 서브 id(다음 덧붙임 목적지 고정용).
export function appendSessionMessages(root: string, key: string, kind: SessionKind, label: string, add: ChatMessage[], repoLabel: string, subId?: string): string {
  const store = chatStoreKey(root);
  const d = loadStore(store, repoLabel);
  const isNew = !d.sessions[key];
  const s = d.sessions[key] ?? mkSession(key, kind, label);
  const id = subId && s.subs.some((x) => x.id === subId) ? subId : s.activeSubId;
  const sessions: Record<string, Session> = { ...d.sessions, [key]: { ...s, subs: s.subs.map((x) => (x.id === id ? { ...x, messages: [...x.messages, ...add] } : x)), activeSubId: id } };
  if (isNew && Object.keys(sessions).length > MAX_SESSIONS) {
    const recency = (v: Session) => v.subs.reduce((m, sub) => Math.max(m, sub.createdAt ?? 0), 0);
    const closed = Object.keys(sessions).filter((k) => k !== REPO_KEY && k !== key && k !== d.activeKey && !d.openKeys.includes(k)).sort((a, b) => recency(sessions[a]) - recency(sessions[b]));
    for (const k of closed) { if (Object.keys(sessions).length <= MAX_SESSIONS) break; delete sessions[k]; }
  }
  persistChat(store, sessions, d.openKeys, d.activeKey, key);
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(WS_CHAT_EVENT, { detail: { root } }));
  return id;
}
// 한 세션의 지금 서브 대화(없으면 빈 배열) + 서브 id.
export function readSessionThread(root: string, key: string, repoLabel: string): { messages: ChatMessage[]; subId?: string } {
  const s = loadStore(chatStoreKey(root), repoLabel).sessions[key];
  if (!s) return { messages: [] };
  const sub = s.subs.find((x) => x.id === s.activeSubId) ?? s.subs[0];
  return { messages: sub?.messages ?? [], subId: sub?.id };
}
