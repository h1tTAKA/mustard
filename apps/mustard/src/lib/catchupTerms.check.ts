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

const k = (s: string) => s.trim().toLowerCase();
const prev = [{ term: "Git", def: "a" }];
assert.deepStrictEqual(mergeTerms(prev, [{ term: "git ", def: "b" }, { term: "npm", def: "c" }, { term: "NPM", def: "d" }], k).map((x) => x.term), ["npm", "Git"], "기존·새 목록 안 중복 제거, 새 것 위");
assert.strictEqual(mergeTerms(prev, [{ term: "GIT", def: "z" }], k), prev, "추가 없으면 같은 배열");
console.log("catchupTerms ok");
