export interface ConceptDescription {
  short: string;
  level: "beginner" | "intermediate";
}

export const CONCEPT_DESCRIPTIONS: Record<string, ConceptDescription> = {
  "arrow-function": {
    short: "화살표 함수. `() => {}` 형태의 간결한 함수 표현식으로, 기존 function 키워드보다 짧게 함수를 만든다.",
    level: "beginner",
  },
  function: {
    short: "함수. 특정 작업을 수행하는 코드 블록. 이름을 붙여 반복 사용할 수 있다.",
    level: "beginner",
  },
  jsx: {
    short: "JSX. 자바스크립트 안에서 HTML처럼 UI를 작성하는 React 문법. 브라우저에서 실행되기 전에 자바스크립트로 변환된다.",
    level: "beginner",
  },
  "jsx-rendering": {
    short: "JSX 렌더링. 컴포넌트가 화면에 무엇을 그릴지 반환하는 부분. return 키워드로 JSX를 돌려준다.",
    level: "beginner",
  },
  "react-hook": {
    short: "React Hook. useState, useEffect처럼 함수 컴포넌트에서 React 기능을 사용하는 특별한 함수. 이름이 always use로 시작한다.",
    level: "beginner",
  },
  return: {
    short: "Return. 함수가 결과값이나 JSX를 반환하는 키워드. return 이후의 코드는 실행되지 않는다.",
    level: "beginner",
  },
  "state-or-reference": {
    short: "State / Reference. 컴포넌트가 기억해야 할 값. State가 바뀌면 화면이 다시 그려지고, ref는 화면 갱신 없이 값을 유지한다.",
    level: "beginner",
  },
  styling: {
    short: "스타일링. 요소의 색상, 크기, 위치, 여백 등 외형을 설정하는 부분. CSS 클래스나 인라인 스타일로 적용한다.",
    level: "beginner",
  },
  "ui-structure": {
    short: "UI 구조. 화면을 구성하는 요소들의 계층 관계. 어떤 요소가 다른 요소 안에 들어가는지를 나타낸다.",
    level: "beginner",
  },
  variable: {
    short: "변수. 값을 저장하는 이름표. const는 재할당 불가, let은 재할당 가능, var는 구식 방식이다.",
    level: "beginner",
  },
};

// #1095 짧은 설명은 한국어만 내장 — 다른 언어면 없음 → 화면이 AI 설명(설정 언어)으로 채움.
export const conceptShort = (id: string, locale: string): string | undefined => (locale === "ko" ? CONCEPT_DESCRIPTIONS[id]?.short : undefined);
