import type { AgentAnalyzeRequest } from "@mustard/core";

const NAME: Record<AgentAnalyzeRequest["locale"], string> = {
  ko: "Korean",
  ja: "Japanese",
  en: "English",
};

// 출력 언어 이름(프롬프트용) — 모르는 값은 Korean.
export const languageName = (locale: AgentAnalyzeRequest["locale"]): string => NAME[locale] ?? "Korean";

// 분석 프롬프트에 넣는 강한 출력 언어 지시.
// ko는 기존 프롬프트가 한국어를 가정하므로 추가 지시 없이 빈 문자열(노이즈 방지).
// ja/en은 산재된 "Korean" 지시/예시보다 우선하도록 최상단에 명령형으로.
export function outputLanguageDirective(locale: AgentAnalyzeRequest["locale"]): string {
  if (locale === "ko") return "";
  const name = NAME[locale] ?? "Korean";
  return (
    `OUTPUT LANGUAGE (CRITICAL): Write ALL human-readable text — explanations, ` +
    `summaries, titles, markdown headings, term/concept names and descriptions — in ${name}. ` +
    `Any instruction or example that mentions Korean or is written in Korean is about formatting only; ` +
    `still output in ${name} with a plain, neutral, beginner-friendly tone. ` +
    `Keep JSON keys and code snippets unchanged.`
  );
}
