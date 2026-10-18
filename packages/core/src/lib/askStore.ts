// 에이전트 질문(Ask) 모드 — 세션 히스토리 영속(이슈2).
// 세션(좌측 목록 항목) > 서브세션(subs, 탭) > 분할(layout, 타일)의 3층 모델.
// 서브세션 탭·분할은 후속 이슈(#3/#4)에서 활용 — 이번 이슈는 세션 목록만 쓰고
// subs는 항상 길이 1, layout은 활성 서브 1개로 초기화한다.
import type { ChatMessage } from "../agent/schema";

const KEY = "nunopi:ask-sessions";
const LEGACY_THREAD_KEY = "nunopi:ask-thread"; // 이슈1 단일 스레드 — 최초 로드 시 흡수.

// 아웃풋 퀴즈(#540/#542) — 서브별로 생성된 퀴즈·답·채점을 store에 얹어 탭 전환/재진입에도 유지.
export type QuizQType = "mc" | "short" | "reverse";
export interface QuizQuestion {
  type: QuizQType;
  q: string;
  options?: string[]; // mc만
  answer: number | string; // mc=정답 옵션 인덱스(0-based), short/reverse=모범답안
  why?: string;
}
export interface QuizGraded {
  correct: boolean;
  feedback?: string; // short/reverse는 에이전트 피드백
}
export interface AskQuiz {
  phase: "idle" | "solving" | "done"; // 진행 중(loading/grading)은 저장 안 함 — 복원 시 멈춤 방지
  questions: QuizQuestion[];
  answers: Record<number, number | string>; // mc=번호, short/reverse=문자열
  graded: Record<number, QuizGraded>;
}
// 퀴즈 세션 하나(#548) — 챗 세션처럼 여러 번 풀고 각 채점 결과를 따로 보존.
export interface QuizSession {
  id: string;
  createdAt: string; // ISO
  quiz: AskQuiz;
}

export interface AskSub {
  id: string;
  title?: string; // 유저 지정 이름. 없으면 "질문 N"으로 표시.
  createdAt?: string; // ISO — 질문 생성 시각(전역 히스토리 타임라인용, #559). 옵셔널=하위호환.
  messages: ChatMessage[];
  quizzes?: QuizSession[]; // 이 서브에서 만든 퀴즈 세션들(있을 때만).
  activeQuizId?: string; // 활성 퀴즈 세션 id.
}

export interface AskSession {
  id: string;
  title: string;
  createdAt: string; // ISO
  subs: AskSub[]; // ≥1
  activeSubId: string; // 탭 활성(이번 이슈엔 subs[0].id)
  layout: string[]; // 분할 표시 sub id들(이번 이슈엔 [activeSubId])
  splitDir?: "row" | "col"; // 분할 방향 — row=좌우, col=위아래(기본 row).
  folderId?: string | null; // 속한 폴더. null/미지정 = 루트(그룹 안 됨).
}

// 세션 그룹 폴더 — 좌측 패널에서 세션을 묶어 관리. 중첩(하위 폴더) 지원.
export interface AskFolder {
  id: string;
  name: string;
  collapsed?: boolean; // 접힘(하위 세션·폴더 숨김).
  parentId?: string | null; // 상위 폴더. null/미지정 = 루트.
}

export interface AskStore {
  folders: AskFolder[];
  sessions: AskSession[];
  activeSessionId: string;
}

// crypto.randomUUID + 폴백(구형 환경). 다른 세션 모듈과 동일 관례.
export function newAskId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `ask-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  }
}

// 새 세션 하나 생성 — 서브세션 1개(빈 스레드), layout은 그 서브 단일.
export function createSession(title: string, folderId: string | null = null): AskSession {
  const sub: AskSub = { id: newAskId(), createdAt: new Date().toISOString(), messages: [] };
  return {
    id: newAskId(),
    title,
    createdAt: new Date().toISOString(),
    subs: [sub],
    activeSubId: sub.id,
    layout: [sub.id],
    splitDir: "row",
    folderId,
  };
}

// 새 폴더 하나 생성(parentId 지정 시 하위 폴더).
export function createFolder(name: string, parentId: string | null = null): AskFolder {
  return { id: newAskId(), name, collapsed: false, parentId };
}

// 저장된 퀴즈 상태 방어 정규화 — 모양이 어긋나면 undefined(퀴즈 없음으로 취급).
function sanitizeQuiz(raw: unknown): AskQuiz | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const q = raw as Partial<AskQuiz>;
  if (!Array.isArray(q.questions)) return undefined;
  // 진행 중 단계는 저장 안 되지만, 혹시 섞여 들어와도 안정 단계로 눕힌다.
  const phase: AskQuiz["phase"] = q.phase === "done" ? "done" : q.phase === "solving" ? "solving" : "idle";
  const questions = q.questions.filter(
    (x): x is QuizQuestion =>
      !!x && typeof (x as QuizQuestion).q === "string" &&
      ((x as QuizQuestion).type === "mc" || (x as QuizQuestion).type === "short" || (x as QuizQuestion).type === "reverse"),
  );
  if (questions.length === 0) return undefined;
  // 답·채점도 항목별 타입 검증(변조/구버전 대비). 키는 JSON 왕복으로 문자열이지만 조회 시 숫자→문자 강제라 무해.
  const answers: AskQuiz["answers"] = {};
  if (q.answers && typeof q.answers === "object") {
    for (const [k, v] of Object.entries(q.answers)) {
      if (typeof v === "number" || typeof v === "string") answers[Number(k)] = v;
    }
  }
  const graded: AskQuiz["graded"] = {};
  if (q.graded && typeof q.graded === "object") {
    for (const [k, v] of Object.entries(q.graded)) {
      if (v && typeof v === "object" && typeof (v as QuizGraded).correct === "boolean") {
        const g = v as QuizGraded;
        graded[Number(k)] = { correct: g.correct, feedback: typeof g.feedback === "string" ? g.feedback : undefined };
      }
    }
  }
  return { phase, questions, answers, graded };
}

// 서브의 퀴즈 세션 목록 정규화 + 구버전 단일 quiz 마이그레이션(#548).
function sanitizeSubQuizzes(x: AskSub & { quiz?: unknown }): { quizzes?: QuizSession[]; activeQuizId?: string } {
  const raw = Array.isArray(x.quizzes) ? x.quizzes : [];
  let sessions: QuizSession[] = raw
    .filter((s): s is QuizSession => !!s && typeof (s as QuizSession).id === "string")
    .map((s) => ({ id: s.id, createdAt: typeof s.createdAt === "string" ? s.createdAt : new Date().toISOString(), quiz: sanitizeQuiz(s.quiz) }))
    .filter((s): s is QuizSession => s.quiz !== undefined);
  // 구버전 단일 quiz(있으면) → 세션 하나로. quizzes가 이미 있으면 무시.
  if (sessions.length === 0) {
    const legacy = sanitizeQuiz(x.quiz);
    if (legacy) sessions = [{ id: newAskId(), createdAt: new Date().toISOString(), quiz: legacy }];
  }
  if (sessions.length === 0) return {};
  const activeQuizId = sessions.some((s) => s.id === x.activeQuizId) ? x.activeQuizId : sessions[0].id;
  return { quizzes: sessions, activeQuizId };
}

// 저장된 세션 배열이 스키마를 갖추도록 방어적으로 정규화.
function normalizeSession(raw: unknown): AskSession | null {
  if (!raw || typeof raw !== "object") return null;
  const s = raw as Partial<AskSession>;
  if (typeof s.id !== "string") return null;
  const subs = Array.isArray(s.subs)
    ? s.subs
        .filter((x): x is AskSub => !!x && typeof (x as AskSub).id === "string")
        .map((x) => ({ id: x.id, title: typeof x.title === "string" ? x.title : undefined, createdAt: typeof x.createdAt === "string" ? x.createdAt : (typeof s.createdAt === "string" ? s.createdAt : new Date().toISOString()), messages: Array.isArray(x.messages) ? x.messages : [], ...sanitizeSubQuizzes(x as AskSub & { quiz?: unknown }) }))
    : [];
  if (subs.length === 0) subs.push({ id: newAskId(), title: undefined, createdAt: new Date().toISOString(), messages: [] });
  const activeSubId = subs.some((x) => x.id === s.activeSubId) ? s.activeSubId! : subs[0].id;
  const layout = Array.isArray(s.layout) && s.layout.some((id) => subs.some((x) => x.id === id))
    ? s.layout.filter((id) => subs.some((x) => x.id === id))
    : [activeSubId];
  return {
    id: s.id,
    title: typeof s.title === "string" ? s.title : "",
    createdAt: typeof s.createdAt === "string" ? s.createdAt : new Date().toISOString(),
    subs,
    activeSubId,
    layout,
    splitDir: s.splitDir === "col" ? "col" : "row",
    folderId: typeof s.folderId === "string" ? s.folderId : null,
  };
}

// 저장된 폴더 배열 정규화.
function normalizeFolder(raw: unknown): AskFolder | null {
  if (!raw || typeof raw !== "object") return null;
  const f = raw as Partial<AskFolder>;
  if (typeof f.id !== "string") return null;
  return {
    id: f.id,
    name: typeof f.name === "string" ? f.name : "",
    collapsed: f.collapsed === true,
    parentId: typeof f.parentId === "string" ? f.parentId : null,
  };
}

// 이슈1 단일 스레드(ask-thread) → 첫 세션으로 흡수 후 제거.
function migrateLegacyThread(fallbackTitle: string): AskSession | null {
  try {
    const raw = localStorage.getItem(LEGACY_THREAD_KEY);
    if (!raw) return null;
    const arr = JSON.parse(raw) as ChatMessage[];
    localStorage.removeItem(LEGACY_THREAD_KEY);
    if (!Array.isArray(arr) || arr.length === 0) return null;
    const session = createSession(""); // #1125 제목을 저장하지 않음 — 표시할 때 "세션 N"으로 번역(fallbackTitle은 호환용으로만 남김)
    void fallbackTitle;
    session.subs[0].messages = arr;
    return session;
  } catch {
    return null;
  }
}

// 항상 활성 세션이 존재하도록 로드(빈 store면 세션 1개 자동 생성).
// fallbackTitle: 신규/마이그레이션 세션의 기본 제목(호출부에서 i18n으로 전달).
export function loadAskStore(fallbackTitle: string): AskStore {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<AskStore>;
      const sessions = Array.isArray(parsed.sessions)
        ? parsed.sessions.map(normalizeSession).filter((s): s is AskSession => s !== null)
        : [];
      const folders = Array.isArray(parsed.folders)
        ? parsed.folders.map(normalizeFolder).filter((f): f is AskFolder => f !== null)
        : [];
      if (sessions.length > 0) {
        // 세션 스토어가 이미 있으면 레거시 스레드는 흡수 대상 아님 — 고아 방지 위해 정리.
        try { localStorage.removeItem(LEGACY_THREAD_KEY); } catch { /* ignore */ }
        const activeSessionId = sessions.some((s) => s.id === parsed.activeSessionId)
          ? parsed.activeSessionId!
          : sessions[0].id;
        return { folders, sessions, activeSessionId };
      }
    }
    // store 없음 — 레거시 스레드 흡수 시도. 없으면 빈 store(세션 0개 허용).
    const migrated = migrateLegacyThread(fallbackTitle);
    if (migrated) return { folders: [], sessions: [migrated], activeSessionId: migrated.id };
    return { folders: [], sessions: [], activeSessionId: "" };
  } catch {
    return { folders: [], sessions: [], activeSessionId: "" };
  }
}

// 출처(세션 + 선택적 질문)가 아직 존재하는지 — 부수효과 없는 순수 읽기(모드 전환 전 검사용).
export function askSourceExists(sessionId: string, subId?: string): boolean {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw) as Partial<AskStore>;
    const session = (parsed.sessions ?? []).find((s) => s?.id === sessionId);
    if (!session) return false;
    if (!subId) return true;
    return (session.subs ?? []).some((x) => x?.id === subId);
  } catch {
    return false;
  }
}

export function saveAskStore(store: AskStore): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(store));
  } catch {
    /* ignore */
  }
}
