import { translate } from "@mustard/core/messages";
// #1095 서버 문구 언어 — narrationConfig가 globalThis에 둔 앱 언어(이 파일은 클라도 import → node:fs 못 씀, 그래서 전역만 읽음)
const actLocale = () => (globalThis as unknown as { __mustardNarrationLocale?: string }).__mustardNarrationLocale ?? "ko";
// MCP 툴콜 활동 버스(#855) — 에이전트가 부른 코드그래프 툴을 앱으로 push(실시간 학습 브릿지).
// agentStatus.ts 패턴 미러: globalThis 싱글턴(dev 라우트 리로드 생존) + emit/subscribe fan-out + 최근 링버퍼.
export type ConceptKind = "symbol" | "file" | "query" | "repo" | "edit" | "narration";
export interface ActivityEvent {
  root: string;
  tool: string;      // katchup_find_code / Edit / Bash 등, narration은 "narration"
  kind: ConceptKind;
  target: string;    // 심볼명/파일/쿼리/편집대상 — 에이전트가 지금 다루는 것(narration은 짧은 제목/행동)
  isError: boolean;
  ts: number;
  note?: string;     // #870 narration 전용 — 서버서 생성한 실시간 설명 텍스트(클라가 그대로 렌더)
}

const RING_MAX = 200; // 최근 이벤트 상한(메모리 누수 방지)
const g = globalThis as unknown as { __nunopiMcpActivity?: ActivityEvent[]; __nunopiMcpActListeners?: Set<(e: ActivityEvent) => void>; __nunopiLastEdit?: Map<string, string>; __nunopiLastNarr?: Map<string, string> };
const ring: ActivityEvent[] = g.__nunopiMcpActivity ?? (g.__nunopiMcpActivity = []);
const listeners: Set<(e: ActivityEvent) => void> = g.__nunopiMcpActListeners ?? (g.__nunopiMcpActListeners = new Set());
const lastEdit: Map<string, string> = g.__nunopiLastEdit ?? (g.__nunopiLastEdit = new Map()); // root → 직전 편집 "tool|target"(dedup)
const lastNarr: Map<string, string> = g.__nunopiLastNarr ?? (g.__nunopiLastNarr = new Map()); // root → 직전 내레이션 제목(연속 중복 dedup)

const normPath = (p: string) => p.replace(/\/+$/, "");
// root 매칭 — 워크스페이스 root와 에이전트 cwd가 상하위여도 커버(양방향 접두).
export function matchesRoot(eventRoot: string, queryRoot: string): boolean {
  const a = normPath(eventRoot), b = normPath(queryRoot);
  return a === b || a.startsWith(b + "/") || b.startsWith(a + "/");
}

// 공통 push + fan-out.
function pushEvent(ev: ActivityEvent): void {
  ring.push(ev);
  if (ring.length > RING_MAX) ring.splice(0, ring.length - RING_MAX); // 한계: 200번째마다 O(n) splice, 처리량 커지면 Ring 클래스로
  for (const fn of listeners) { try { fn(ev); } catch { /* 개별 리스너 실패 무시 */ } }
}

// 툴+인자 → 관심 개념. check_freshness 등 개념 아닌 툴/빈 인자는 null(스킵).
export function extractConcept(tool: string, args: Record<string, unknown>): { kind: ConceptKind; target: string } | null {
  const s = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  switch (tool) {
    case "katchup_find_code":
    case "katchup_find_all": { const t = s(args.name); return t ? { kind: "symbol", target: t } : null; }
    case "katchup_trace_calls": { const t = s(args.symbol); return t ? { kind: "symbol", target: t } : null; }
    case "katchup_file_api": { const t = s(args.file); return t ? { kind: "file", target: t } : null; }
    case "katchup_search": { const t = s(args.query); return t ? { kind: "query", target: t } : null; }
    case "katchup_repo_map": return { kind: "repo", target: translate(actLocale(), "stream.repoStructure") };
    default: return null; // check_freshness 등
  }
}

// 툴콜 방출(라우트 seam이 호출). 개념 추출 실패면 무시.
export function emitToolCall(root: string, tool: string, args: Record<string, unknown>, isError: boolean, now: number): void {
  const c = extractConcept(tool, args);
  if (!c) return;
  pushEvent({ root: normPath(root), tool, kind: c.kind, target: c.target, isError, ts: now });
}

// 문서 파일(#1049) — .md 학습정리·작업일지 같은 문서 편집은 코드가 아니라 캐치업 카드에서 뺌(내레이션의 문서 SKIP과 맞춤).
// 명령(Bash)의 target은 명령 문자열이라 대상 아님. 클라도 지난 기록 숨김에 같은 함수를 씀.
export const isDocEdit = (tool: string, target: string) => tool !== "Bash" && /\.(md|mdx|markdown|txt|rst|adoc)$/i.test(target.trim());

// 편집 활동 방출(#857) — agentStatus의 편집 툴을 학습 신호로. 직전 편집과 동일하면 스킵(스크레이퍼 반복 POST 대비).
export function emitEdit(root: string, tool: string, target: string, isError: boolean, now: number): void {
  const t = (target ?? "").trim();
  if (!t || isDocEdit(tool, t)) return;
  const r = normPath(root);
  const sig = `${tool}|${t}|${isError ? 1 : 0}`; // isError 포함(성공→실패 전환은 새 이벤트, 리뷰 🟡)
  if (lastEdit.get(r) === sig) return; // dedup(연속 동일만)
  lastEdit.set(r, sig);
  pushEvent({ root: r, tool, kind: "edit", target: t, isError, ts: now });
}

// 실시간 내레이션 방출(#870) — main이 관찰한 터미널 델타를 서버가 analyze해 만든 설명을 학습스트림으로.
// note(설명 텍스트)를 실어 클라가 재분석 없이 바로 렌더. title=짧은 행동 요약("코드 편집"/"명령 실행" 등).
// 방출 여부 반환(#994) — 호출부(observe 라우트)가 방출된 것만 날짜별 저장. 이 모듈은 fs 의존 없이 유지(check 스크립트 안전).
// #1135 tool = 출처 표시(Crew 보고는 "crew|<카드 id>" — 캐치업이 어느 Crew 카드인지 앎). 주면 제목 중복 스킵 안 함(같은 역할·카드가 연달아 보고해도 둘 다).
export function emitNarration(root: string, title: string, note: string, now: number, tool?: string): { target: string; note: string } | null {
  const n = (note ?? "").trim();
  if (!n) return null;
  const r = normPath(root);
  const t = (title || translate(actLocale(), "stream.live")).trim();
  if (!tool && lastNarr.get(r) === t) return null; // 연속 동일 제목 = 중복(같은 활동 재내레이션) → 스킵
  if (!tool) lastNarr.set(r, t);
  pushEvent({ root: r, tool: tool || "narration", kind: "narration", target: t, isError: false, ts: now, note: n });
  return { target: t, note: n };
}

// SSE 구독(해제 함수 반환).
export function subscribe(fn: (e: ActivityEvent) => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

// 최근 이벤트(초기 표시용) — root 필터.
export function recent(root: string, limit = 50): ActivityEvent[] {
  return ring.filter((e) => matchesRoot(e.root, root)).slice(-limit).map((e) => ({ ...e })); // 방어 복사(호출부 변이로 링 오염 방지)
}
