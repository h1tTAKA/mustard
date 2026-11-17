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
assert.deepStrictEqual(["`PageController`", "`dispose`", "PageView.builder", "onPageChanged", "find.widgetWithText()", "integration_test"].map((x) => cardKindOf(x)), Array(6).fill("token"), "코드 이름은 토큰");
assert.deepStrictEqual([["viewport", "화면에서 보이는 영역"], ["iOS 시뮬레이터", ""], ["Node.js", ""], ["iOS", "애플 스마트폰 운영체제"], ["JavaScript", "웹에서 쓰는 프로그래밍 언어"], ["위젯 트리", ""]].map(([x, d]) => cardKindOf(x, d)), Array(6).fill("term"), "일반 말은 IT용어");
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
assert.deepStrictEqual(["fix/catchup-x", "feature/a/b", "Widget의 key", "fix/login", "feat/cart"].map(isCardWorthy), [false, false, false, false, false]);
assert.deepStrictEqual(splitTermsSection("### 용어\n- **`grep`** 같은 검색 — 결과\n- **diff** — 차이")!.terms.map((x) => x.term), ["diff"], "굵은 이름 뒤에 바로 구분자일 때만 칩");
console.log("catchupTerms ok");

// #1369 백틱 없이 온 실제 카드(앱 저장소에서 IT용어로 잘못 들어간 것) — 이름 생김새 + 뜻 낱말로 토큰
const realToken: [string, string][] = [
  ["dispose", "화면이 사라질 때 쓰던 자원을 정리하는 메서드. `_pages`를 여기서 해제해요."],
  ["PageController", "`PageView`가 지금 몇 번째 페이지인지 읽고 옮기는 리모컨. 여기서는 칩을 누르면 해당 페이지로 이동시켜요."],
  ["ScrollView", "내용이 길 때 스크롤되게 감싸는 React Native 컨테이너"],
  ["AsyncStorage", "앱을 껐다 켜도 데이터가 남도록 기기에 값을 저장하는 React Native의 간단한 저장소"],
  ["git log", "커밋(저장 기록)의 시간, 작성자, 제목을 시간순으로 보여 주는 명령어"],
  ["tsc --noEmit", "결과 파일 없이 타입 오류만 검사하는 명령"],
  ["flex: 1", "부모의 남는 공간을 비율로 나눠 차지하는 설정"],
  ["Record<K, V>", "키 타입 K와 값 타입 V를 가진 객체를 표현하는 TypeScript 타입"],
  ["Promise / setTimeout", "비동기 결과를 다루는 객체 / 일정 시간 뒤 실행하는 타이머"],
  ["children", "컴포넌트 태그 사이에 넣은 내용이 전달되는 특별한 prop"],
  ["`useCallback`", "함수를 렌더 간에 같은 참조로 유지하는 훅"],
];
assert.deepStrictEqual(realToken.map(([x, d]) => cardKindOf(x, d)), Array(realToken.length).fill("token"), "코드 이름은 토큰");
const realTerm: [string, string][] = [
  ["viewport", "브라우저 화면 크기예요. 390×844는 스마트폰 화면 크기예요."],
  ["timeout", "정해진 시간이 지나면 작업을 강제로 끊는 장치"],
  ["Prettier", "코드 스타일을 자동으로 정리해주는 포맷터"],
  ["HLS(.m3u8)", "영상을 작은 조각으로 나눠 스트리밍하는 방식과 그 재생목록 파일"],
  ["`정적 파일(static file)`", "서버가 계산 없이 그대로 전달하는 이미지·폰트 같은 고정 파일"],
  ["재귀(recursion)", "함수가 자기 자신을 다시 호출하는 구조"],
  ["429 Too Many Requests", "짧은 시간에 요청을 너무 많이 보냈다는 HTTP 상태 코드(속도 제한)"],
  ["TTS", "글자로 된 문장을 컴퓨터가 사람 목소리처럼 읽어 주는 음성으로 바꾸는 기술"],
  ["honeypot", "사람에겐 안 보이고 봇만 채우는 함정 입력칸으로 스팸을 걸러내는 기법"],
  ["GitHub", "코드를 올려 두고 함께 작업하는 서비스"],
];
assert.deepStrictEqual(realTerm.map(([x, d]) => cardKindOf(x, d)), Array(realTerm.length).fill("term"), "일반 개념·제품 이름은 IT용어");
// #1369 리뷰: 라이브러리·제품 이름은 생김새가 코드여도 IT용어(뜻에 코드 낱말 없을 때)
assert.deepStrictEqual([["socket.io", "실시간 양방향 통신 라이브러리"], ["PyTorch", "파이썬 머신러닝 라이브러리"]].map(([x, d]) => cardKindOf(x, d)), ["term", "term"]);
assert.equal(cardKindOf("ScrollBehavior", "Flutter에서 스크롤 방식을 정하는 설정"), "token");
assert.deepStrictEqual([["Stripe", "결제 API 서비스"], ["Java", "객체지향 프로그래밍 언어"]].map(([x, d]) => cardKindOf(x, d)), ["term", "term"], "제품 이름은 뜻에 코드 낱말이 있어도 IT용어");
assert.equal(cardKindOf("StreamBuilder", "스트림 상태를 보고 화면을 그리는 패턴"), "token");
assert.deepStrictEqual([["lang", "문서의 언어를 지정하는 HTML 속성"], ["ServiceWorker", "브라우저 뒤에서 도는 서비스 워커 객체"], ["Object.keys", "JavaScript 언어의 내장 함수"]].map(([x, d]) => cardKindOf(x, d)), ["token", "token", "token"], "뜻 중간의 언어·서비스는 제품 아님");
assert.equal(cardKindOf("`Java`", "객체지향 프로그래밍 언어"), "term");
assert.deepStrictEqual([["Java", "객체지향 프로그래밍 언어(JVM 위에서 돌아가요)예요."], ["PostgreSQL", "오픈소스 관계형 데이터베이스예요 (RDBMS)."]].map(([x, d]) => cardKindOf(x, d)), ["term", "term"], "괄호 풀이가 붙어도 제품");
// 5차 리뷰: 한 단어 개념(뜻이 "…함수"·"…것"으로 끝남)은 IT용어. 한계 — split("…만드는 함수.")도 IT용어가 됨(백틱이 오면 토큰)
assert.deepStrictEqual([["callback", "다른 함수에 넘기는 함수"], ["closure", "함수와 그 바깥 변수를 묶은 것"], ["middleware", "요청과 응답 사이에 실행되는 함수"], ["state", "컴포넌트가 가진 값"], ["split", "문자열을 구분자 기준으로 잘라 배열로 만드는 함수."]].map(([x, d]) => cardKindOf(x, d)), Array(5).fill("term"));
assert.equal(cardKindOf("`split`", "문자열을 나누는 함수"), "token");
assert.equal(cardKindOf("Java", "객체지향 언어(JVM (v8) 위에서)예요."), "term", "중첩 괄호");
assert.deepStrictEqual([["Pressable", "터치(누름)에 반응하는 React Native 컴포넌트"], ["ffmpeg", "영상·오디오를 변환·중계하는 명령줄 도구"], ["some / every", "배열에서 \"하나라도\" / \"전부\" 조건을 만족하는지 검사하는 메서드"]].map(([x, d]) => cardKindOf(x, d)), ["token", "token", "token"]);
