import { getAllHistory } from "../historyDB";
import { loadAskStore } from "@mustard/core";
import { loadAllCardSessions } from "../cardChat";
import { loadTokenDetails, loadTermDetails, loadConceptDetails } from "@mustard/core";
import { loadActivity } from "../srs/activityLog";
import { collectCards } from "../srs/collect";
import type { UnifiedHistoryEvent } from "./types";
import { translate, relocalizeCardSource, allLocaleValues } from "@mustard/core/messages";

// 첫 유저 메시지 요약(제목용). 없으면 폴백.
function firstQuestion(messages: { role: string; content: string }[], fallback: string): string {
  const q = messages.find((m) => m.role === "user")?.content?.trim();
  if (!q) return fallback;
  return q.length > 60 ? q.slice(0, 60) + "…" : q;
}

// 모든 저장소를 읽어 통일 히스토리 이벤트로(읽기 전용). 시간 내림차순 정렬.
// 출처별 try/catch — 하나가 실패해도 나머지는 수집.
// #1095 locale = 이벤트 제목·설명 언어(화면 설정)
export async function collectHistory(locale = "ko"): Promise<UnifiedHistoryEvent[]> {
  const tr = (key: string, vars?: Record<string, string | number>) => translate(locale, key, vars);
  const out: UnifiedHistoryEvent[] = [];

  // 1) 코드/글 분석 이력 + 그 안 챗룸
  try {
    const entries = await getAllHistory();
    for (const e of entries) {
      const mode = e.mode === "text" ? "text" : "code";
      const modeLabel = mode === "text" ? tr("history.evt.textAnalysis") : tr("history.evt.codeAnalysis");
      const aTitle = e.title || modeLabel;
      out.push({
        type: "analysis",
        id: e.id,
        createdAt: e.createdAt,
        title: aTitle,
        description: modeLabel,
        nav: { mode, sourceId: e.id },
      });
      for (const cs of e.chatSessions ?? []) {
        if (!cs.messages || cs.messages.length === 0) continue;
        out.push({
          type: "chat",
          id: cs.id,
          createdAt: e.createdAt, // 챗 세션 개별 시각 없어 분석 항목 시각으로 근사
          title: firstQuestion(cs.messages, tr("history.evt.analysisChat")),
          description: tr("history.evt.chatRoom", { mode: modeLabel, title: aTitle }),
          nav: { mode, sourceId: e.id, sessionId: cs.id },
        });
      }
    }
  } catch { /* ignore */ }

  // 2) 질문(질문모드) + 퀴즈
  try {
    const store = loadAskStore("");
    const untitled = new Set(allLocaleValues("ask.untitled")); // 옛 기본 제목(만든 때 언어) = 이름 없음 취급(AskView와 같음, #1125)
    for (const s of store.sessions) {
      const sessLabel = tr("history.evt.askSession", { title: (s.title && !untitled.has(s.title) ? s.title : "") || tr("history.evt.session") });
      for (const sub of s.subs) {
        if (sub.messages.length > 0) {
          out.push({
            type: "ask",
            id: sub.id,
            createdAt: sub.createdAt ?? s.createdAt,
            title: firstQuestion(sub.messages, tr("history.evt.question")),
            description: sessLabel,
            nav: { mode: "ask", sessionId: s.id, subId: sub.id },
          });
        }
        for (const qs of sub.quizzes ?? []) {
          out.push({
            type: "quiz",
            id: qs.id,
            createdAt: qs.createdAt,
            title: tr("history.evt.quizN", { n: qs.quiz.questions.length }),
            description: sessLabel,
            nav: { mode: "ask", sessionId: s.id, subId: sub.id, quizId: qs.id },
          });
        }
      }
    }
  } catch { /* ignore */ }

  // 3) 카드 챗룸. createdAt 없는 옛 세션은 그 카드의 북마크 시각으로 근사(now 금지 — 전부 '지금'처럼 보임).
  try {
    const cardTime = new Map<string, string>();
    for (const c of collectCards(["token", "concept", "term"], new Date())) {
      if (c.bookmarkedAt) cardTime.set(c.key, c.bookmarkedAt);
    }
    const all = loadAllCardSessions();
    for (const [cardKey, sessions] of Object.entries(all)) {
      for (const cs of sessions) {
        if (!cs.messages || cs.messages.length === 0) continue;
        out.push({
          type: "chat",
          id: cs.id,
          createdAt: cs.createdAt ?? cardTime.get(cardKey) ?? new Date().toISOString(),
          title: firstQuestion(cs.messages, tr("history.evt.cardChat")),
          description: tr("history.evt.cardChatRoom", { card: cardKey }),
          nav: { mode: "memorize", cardKey },
        });
      }
    }
  } catch { /* ignore */ }

  // 4) 카드 생성(북마크) — 3개 맵. 키가 표시 텍스트.
  try {
    const maps = [loadTokenDetails(), loadTermDetails(), loadConceptDetails()];
    for (const map of maps) {
      for (const [text, d] of Object.entries(map)) {
        if (!d?.bookmarkedAt) continue;
        // 출처 경로: 어디서 이 카드를 저장했나.
        const from = d.sourceTitle
          ? tr("history.evt.savedFrom", { title: relocalizeCardSource(d.sourceTitle, tr) }) // #1125 저장 언어로 굳은 출처를 지금 언어로
          : d.sourceKind === "ask"
            ? tr("history.evt.savedFromAsk")
            : d.sourceKind === "card"
              ? tr("history.evt.savedFromCard")
              : d.sourceKind === "workspace"
                ? tr("history.evt.savedFromWorkspace")
                : tr("history.evt.savedFromAnalysis");
        out.push({
          type: "bookmark",
          id: `bm-${text}-${d.bookmarkedAt}`,
          createdAt: d.bookmarkedAt,
          title: tr("history.evt.cardCreated", { text }),
          description: from,
          // workspace 카드는 이동 대상(특정 챗 세션 복원)이 없어 비클릭(#750). 그 외만 nav 부여.
          ...(d.sourceKind === "workspace" ? {} : { nav: { mode: d.sourceKind === "ask" ? "ask" : "code", sourceId: d.sourceId, sessionId: d.sourceSessionId, subId: d.sourceSubId } as const }),
        });
      }
    }
  } catch { /* ignore */ }

  // 5) 플래시카드 복습 — 일별 집계(개별 시각 없어 그날 자정 기준).
  try {
    const activity = loadActivity();
    for (const [day, log] of Object.entries(activity)) {
      if (!log || log.n <= 0) continue;
      out.push({
        type: "review",
        id: `review-${day}`,
        createdAt: `${day}T00:00:00`, // 로컬 자정
        title: tr("history.evt.reviewN", { n: log.n }),
        nav: { mode: "memorize" },
      });
    }
  } catch { /* ignore */ }

  // 시간 내림차순(최신 위). ISO 사전식 비교.
  out.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
  return out;
}
