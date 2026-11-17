// #1369 카드 종류를 AI가 정함 — 해설 용어 줄 끝 표시와, 이미 저장된 카드 다시 나누기에 같은 기준.
// 토큰·개념은 '프로그래밍/개념' 덱, IT는 'IT용어/개념' 덱(packages/core DECK_SOURCES).
import type { CardKind } from "./catchupTerms.ts";

export const KIND_GUIDE = `[코드] = 코드에 그대로 쓰는 이름(클래스·함수·메서드·위젯·속성·명령·파일·문법 키워드). [개념] = 프로그래밍·개발과 관련된 개념·용어(언어 문법·설계·자료구조·비동기·상태·테스트·git·빌드·배포·HTTP·웹/앱 화면 개발 등 — 개발하며 쓰는 말이면 여기). [IT] = 프로그래밍이라고 보기 애매한 넓은 IT 말(제품·서비스·회사 이름, 하드웨어, 개발자 아니어도 쓰는 일반 디지털 용어).`;

export function classifyPrompt(items: { name: string; def: string }[]): string {
  return `아래 카드마다 종류를 하나씩 골라.\n${KIND_GUIDE}\n답은 한 줄에 하나, "번호 종류"만(예: "1 코드"). 설명·다른 말 금지.\n\n${items.map((x, i) => `${i + 1}. ${x.name.replace(/\s+/g, " ")} — ${x.def.replace(/\s+/g, " ").slice(0, 200)}`).join("\n")}`;
}

// "1 코드" / "2. 개념" / "3: IT" … → 번호별 종류. 빠진 번호는 undefined(호출부가 그 카드는 그대로 둠).
export function parseKinds(text: string, n: number): (CardKind | undefined)[] {
  const out: (CardKind | undefined)[] = Array(n).fill(undefined);
  for (const m of String(text || "").matchAll(/^\s*\[?(\d+)\]?[.):\s-]*\s*\[?(코드|개념|IT|code|concept)\]?/gim)) {
    const i = Number(m[1]) - 1, k = m[2].toLowerCase();
    if (i >= 0 && i < n) out[i] = k === "코드" || k === "code" ? "token" : k === "it" ? "term" : "concept";
  }
  return out;
}
