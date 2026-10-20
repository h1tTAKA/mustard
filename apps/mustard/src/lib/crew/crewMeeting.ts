// Crew 대화방 팀 회의(#1139) — AI 답(JSON) 읽기·참여 역할 고르기·회의 결과 → 카드 값 다듬기. 순수 모듈(점검 가능).
// 흐름: @ 없는 글 → 받은 역할이 {intent, reply} → work면 진행자(범위 기획자)가 참여 역할을 고르고, 차례로 발언, 마무리로 카드.

export type Intent = "question" | "work";
export interface MeetingPlan { title: string; body: string; pipeline: string[] }

// AI 답에서 첫 JSON 객체 꺼내기 — 앞뒤 설명·```json 울타리가 붙어도. { 마다 짝 맞는 } 까지(문자열 안 괄호 무시) 잘라 읽어 봄(리뷰: 앞뒤 글의 {} ). 못 읽으면 null.
export function readJson(text: string): Record<string, unknown> | null {
  const s = text.replace(/```(?:json)?/gi, "");
  for (let a = s.indexOf("{"); a >= 0; a = s.indexOf("{", a + 1)) {
    let depth = 0, inStr = false;
    for (let i = a; i < s.length; i++) {
      const c = s[i];
      if (inStr) { if (c === "\\") i++; else if (c === '"') inStr = false; continue; }
      if (c === '"') inStr = true;
      else if (c === "{") depth++;
      else if (c === "}" && --depth === 0) {
        try { const v = JSON.parse(s.slice(a, i + 1)); if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>; } catch { /* 다음 { 부터 */ }
        break;
      }
    }
  }
  return null;
}

// 받은 역할의 첫 답 → {intent, reply}. JSON이 아니면 글 전체가 답(질문으로).
export function readAnswer(text: string): { intent: Intent; reply: string } {
  const j = readJson(text);
  const reply = typeof j?.reply === "string" && j.reply.trim() ? j.reply.trim() : text.trim();
  return { intent: j?.intent === "work" ? "work" : "question", reply };
}

// 참여 역할 — 아는 역할만, 중복 없이, 진행자 빼고, 최대 max. 하나도 없으면 기본(앱 개발자·테스트 엔지니어).
export function pickParticipants(wanted: unknown, known: Set<string>, moderator: string, max = 5): string[] {
  const list = (Array.isArray(wanted) ? wanted : []).map((x) => String(x).replace(/^@/, "").trim().toLowerCase())
    .filter((r, i, a) => known.has(r) && r !== moderator && a.indexOf(r) === i).slice(0, max);
  return list.length ? list : ["app-builder", "test-engineer"].filter((r) => known.has(r));
}

// 진행자 마무리 → 카드 값. 제목 없으면 사람 글 첫 줄, 역할 순서는 아는 역할만(없으면 자동 배정 = 범위 기획자부터).
export function planFromWrapUp(j: Record<string, unknown> | null, request: string, known: Set<string>): MeetingPlan {
  const title = (typeof j?.title === "string" && j.title.trim() ? j.title : request.split("\n").map((l) => l.trim()).find(Boolean) ?? "Task").replace(/\s+/g, " ").trim().slice(0, 80);
  const body = (typeof j?.body === "string" ? j.body.trim() : "").slice(0, 4000) || request.slice(0, 4000);
  const pipeline = (Array.isArray(j?.pipeline) ? j.pipeline : []).map((x) => String(x).replace(/^@/, "").trim().toLowerCase())
    .filter((r, i, a) => known.has(r) && a.indexOf(r) === i).slice(0, 8);
  return { title, body, pipeline };
}

// @all·@everyone — 모든 역할 부르기
export const callsEveryone = (text: string) => /(^|\s)@(all|everyone)\b/i.test(text);
