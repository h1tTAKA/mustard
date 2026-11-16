// catchupTerms 점검 — node --experimental-strip-types src/lib/catchupTerms.check.ts
import assert from "node:assert";
import { mergeTerms, parseNarrationTerms, splitCardSection, splitTermsSection, splitNames, isCardWorthy, cardKindOf } from "./catchupTerms.ts";

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
assert.deepStrictEqual(mergeTerms([], [{ term: "`tsconfig.json`", def: " 설정 " }], k), [{ term: "tsconfig.json", def: "설정", code: true }], "백틱·공백 정리, 코드 이름 표시");
// #1359 '카드로 남길 개념' 칸 — 본문에서 떼어 칩 이름으로
const cs = splitCardSection("첫 문단\n### 나온 말·용어 풀이\n- **PageController** — 페이지 리모컨\n### 카드로 남길 개념\n- PageController\n- **`setState`**\n");
assert.deepStrictEqual(cs, { body: "첫 문단\n### 나온 말·용어 풀이\n- **PageController** — 페이지 리모컨", items: [{ term: "PageController", def: "" }, { term: "`setState`", def: "" }] });
assert.deepStrictEqual(splitCardSection("a\n### 카드로 남길 개념\n- **위젯 트리** — 화면 부품의 계층").items, [{ term: "위젯 트리", def: "화면 부품의 계층" }], "뜻 같이");
assert.deepStrictEqual(splitCardSection("본문만"), { body: "본문만", items: [] }, "옛 카드는 그대로");
assert.deepStrictEqual(splitCardSection("a\n## Concepts to keep\n- Hook\n## 다음\nb").items.map((x) => x.term), ["Hook"], "다음 소제목에서 끝, 영어 칸 이름");
assert.deepStrictEqual(splitCardSection("a\n**카드로 남길 개념**:\n- Hook: 설명\n> 팁"), { body: "a\n> 팁", items: [{ term: "Hook", def: "설명" }] }, "굵게·콜론 소제목, 이름 뒤 콜론, 뒤따르는 글은 본문에(리뷰)");
assert.deepStrictEqual(splitCardSection("**카드로 남길 개념** 얘기\n### 카드로 남길 개념\n- Hook — 함수\n  이어진 줄\n- Ref:\n- Memo").items.map((x) => x.term), ["Hook", "Ref", "Memo"], "마지막 칸, 들여쓴 이어짐 줄, 끝 콜론(리뷰)");
assert.deepStrictEqual(["localhost:8797", "#68 브랜치", "src/a.ts", "narrate.ts", "a1b2c3d", "fix/catchup-x", "package.json", "RepoLearnStream.tsx", "README.md", "8797", "next.config.js"].map(isCardWorthy), Array(11).fill(false), "이 작업만의 값은 칩 아님");
assert.deepStrictEqual(["localhost", "브랜치", "React Hook", "tsconfig", "Node.js", "Next.js", "CI/CD", "HTTP/2", "HTTP 404", "AES-256", "ISO 8601"].map(isCardWorthy), Array(11).fill(true), "일반 개념은 칩(리뷰)");
const sp = splitTermsSection("첫 문단\n### 나온 말·용어 풀이\n- **diff** — 차이\n\n- **npm** — 패키지 관리자\n### 이 작업의 이름들\n- **fix/x** — 브랜치");
assert.deepStrictEqual(sp, { before: "첫 문단\n### 나온 말·용어 풀이", terms: [{ term: "diff", def: "차이" }, { term: "npm", def: "패키지 관리자" }], after: "### 이 작업의 이름들\n- **fix/x** — 브랜치", rest: [] }, "용어 칸만 떼고, 이름 칸은 뒤에");
assert.strictEqual(splitTermsSection("### 용어\n- **a** — b\n설명 문장"), null, "목록 아닌 줄 섞이면 마크다운 그대로");
assert.deepStrictEqual(["`PageController`", "`dispose`", "PageView.builder", "onPageChanged", "find.widgetWithText()", "integration_test"].map(cardKindOf), Array(6).fill("token"), "코드 이름은 토큰");
assert.deepStrictEqual(["viewport", "iOS 시뮬레이터", "Node.js", "iOS", "JavaScript", "위젯 트리"].map(cardKindOf), Array(6).fill("term"), "일반 말은 IT용어");
// #1364 실제 카드(11-17): 사족 줄 하나 때문에 칸 전체가 칩 없이 글자로 나오던 것
const real = "작업 얘기\n### 나온 말·용어 풀이\n- **`Offset`** — 가로·세로 이동량\n- **`drag` / `fling`** — 끌기와 튕기기\n- **하드코딩(hardcoding)** — 값을 직접 적기\n- **`grep`** 같은 검색은 이미 아시니 생략하고, 결과를 `head`로 앞부분만 본 점만 참고하세요.\n\n### 카드로 남길 개념\n- **회귀(regression)** — 다시 망가짐";
const rs = splitTermsSection(splitCardSection(real).body);
assert.ok(rs, "사족 줄이 있어도 칸은 칩으로");
assert.deepStrictEqual(rs!.terms.map((x) => x.term), ["`Offset`", "`drag` / `fling`", "하드코딩(hardcoding)"]);
assert.strictEqual(rs!.rest.length, 1); assert.ok(rs!.rest[0].includes("grep"), "읽히지 않는 목록 줄은 rest로");
assert.deepStrictEqual(splitNames("`drag` / `fling`"), ["`drag`", "`fling`"], "이름 둘은 칩 둘");
assert.deepStrictEqual(splitNames("CI/CD"), ["CI/CD"], "띄어쓰기 없는 /는 한 이름");
assert.deepStrictEqual(["Icon의 size", "sed -n 282,400p", "head -n 20", "git log -n 5"].map(isCardWorthy), [false, false, false, false], "속성·값 붙은 명령은 칩 아님");
assert.deepStrictEqual(["sed -n", "git rebase -i", "의존성 주입", "HTTP 404"].map(isCardWorthy), [true, true, true, true], "일반형 명령·개념은 칩");
// 재리뷰 케이스
const rr = splitTermsSection("### 용어\n- **diff** — 차이\n- 결과: 성공\n- 이건 A — B\n- npm — 패키지");
assert.deepStrictEqual(rr!.terms.map((x) => x.term), ["diff", "npm"], "굵은 이름·한 단어 이름만 칩");
assert.deepStrictEqual(rr!.rest, ["결과: 성공", "이건 A — B"], "나머지 글은 rest");
assert.deepStrictEqual(splitNames("`git add -p / --patch`"), ["`git add -p / --patch`"], "백틱 안 /는 안 나눔");
assert.deepStrictEqual(["client/server", "request/response", "데이터의 흐름", "상태의 불변성"].map(isCardWorthy), [true, true, true, true], "일반 개념 쌍·한글 '의' 개념은 칩");
assert.deepStrictEqual(["fix/catchup-x", "feature/a/b", "Widget의 key"].map(isCardWorthy), [false, false, false]);
console.log("catchupTerms ok");
