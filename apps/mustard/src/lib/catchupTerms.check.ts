// catchupTerms 점검 — node --experimental-strip-types src/lib/catchupTerms.check.ts
import assert from "node:assert";
import { mergeTerms, parseNarrationTerms, splitCardSection, isCardWorthy } from "./catchupTerms.ts";

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
// #1359 '카드로 남길 개념' 칸 — 본문에서 떼어 칩 이름으로
const cs = splitCardSection("첫 문단\n### 나온 말·용어 풀이\n- **PageController** — 페이지 리모컨\n### 카드로 남길 개념\n- PageController\n- **`setState`**\n");
assert.deepStrictEqual(cs, { body: "첫 문단\n### 나온 말·용어 풀이\n- **PageController** — 페이지 리모컨", names: ["PageController", "setState"] });
assert.deepStrictEqual(splitCardSection("본문만"), { body: "본문만", names: [] }, "옛 카드는 그대로");
assert.deepStrictEqual(splitCardSection("a\n## Concepts to keep\n- Hook\n## 다음\nb").names, ["Hook"], "다음 소제목에서 끝, 영어 칸 이름");
assert.deepStrictEqual(splitCardSection("a\n**카드로 남길 개념**:\n- Hook: 설명\n> 팁"), { body: "a\n> 팁", names: ["Hook"] }, "굵게·콜론 소제목, 이름 뒤 콜론, 뒤따르는 글은 본문에(리뷰)");
assert.deepStrictEqual(["localhost:8797", "#68 브랜치", "src/a.ts", "narrate.ts", "a1b2c3d", "fix/catchup-x", "package.json", "RepoLearnStream.tsx", "README.md", "8797", "next.config.js"].map(isCardWorthy), Array(11).fill(false), "이 작업만의 값은 칩 아님");
assert.deepStrictEqual(["localhost", "브랜치", "React Hook", "tsconfig", "Node.js", "Next.js", "CI/CD", "HTTP/2", "HTTP 404", "AES-256", "ISO 8601"].map(isCardWorthy), Array(11).fill(true), "일반 개념은 칩(리뷰)");
console.log("catchupTerms ok");
