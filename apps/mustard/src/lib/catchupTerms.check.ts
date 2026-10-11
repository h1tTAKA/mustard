// catchupTerms 점검 — node --experimental-strip-types src/lib/catchupTerms.check.ts
import assert from "node:assert";
import { mergeTerms, parseNarrationTerms } from "./catchupTerms.ts";

const note = `순수 함수와 리듀서
## 무엇이 바뀌었나
- **before**: 상태를 직접 바꿈
## 용어
- **리듀서(reducer)** — 상태와 동작으로 새 상태를 돌려주는 함수
- **불변성** – 원본을 바꾸지 않는 성질
* **Date.now()**: 현재 시각(ms)
> 💡 팁`;
assert.deepStrictEqual(parseNarrationTerms(note).map((x) => x.term), ["리듀서(reducer)", "불변성", "Date.now()"], "용어 섹션만, 대시 종류 무관");
assert.deepStrictEqual(parseNarrationTerms("**용어**\n- **diff** — 차이"), [{ term: "diff", def: "차이" }]);
assert.deepStrictEqual(parseNarrationTerms("- **x** — 용어 섹션 밖"), [], "섹션 없으면 없음");
// 리뷰: 표기 흔들림 — 소제목 변형, 통째 굵게, 굵게 없음
assert.deepStrictEqual(parseNarrationTerms("### 핵심 용어\n- **useMemo — 계산 결과 기억**\n- props — 부모가 주는 값\n## 다음\n- **x** — y"),
  [{ term: "useMemo", def: "계산 결과 기억" }, { term: "props", def: "부모가 주는 값" }], "변형 허용 + 다음 소제목에서 끝");
assert.deepStrictEqual(parseNarrationTerms("용어:\n- **API**: 프로그램끼리 대화하는 약속"), [{ term: "API", def: "프로그램끼리 대화하는 약속" }]);

const k = (s: string) => s.trim().toLowerCase();
const prev = [{ term: "Git", def: "a" }];
assert.deepStrictEqual(mergeTerms(prev, [{ term: "git ", def: "b" }, { term: "npm", def: "c" }, { term: "NPM", def: "d" }], k).map((x) => x.term), ["npm", "Git"], "기존·새 목록 안 중복 제거, 새 것 위");
assert.strictEqual(mergeTerms(prev, [{ term: "GIT", def: "z" }], k), prev, "추가 없으면 같은 배열");
assert.deepStrictEqual(mergeTerms([], [{ term: "`tsconfig.json`", def: " 설정 " }], k), [{ term: "tsconfig.json", def: "설정" }], "백틱·공백 정리");
console.log("catchupTerms ok");
