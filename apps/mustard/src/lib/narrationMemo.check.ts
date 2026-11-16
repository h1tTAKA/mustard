// narrationMemo 점검 — node --experimental-strip-types src/lib/narrationMemo.check.ts
import assert from "node:assert";
import { isRepeat, leadOf, memoLines, similarity } from "./narrationMemo.ts";

const hook = "Claude가 도구를 쓰기 전에 훅이 먼저 돌아 권한을 확인하고 있어요.\n### 나온 말·용어 풀이\n- **훅(hook)** — 도구 전후에 자동으로 도는 코드\n- **MCP** — 외부 도구 규격";
assert.strictEqual(leadOf(hook), "Claude가 도구를 쓰기 전에 훅이 먼저 돌아 권한을 확인하고 있어요.");
const past = [{ ts: 1, title: "도구 실행 전후에 걸리는 훅", expl: hook }];
// 실측(11-16): 제목만 바꿔 같은 작업 이야기를 또 → 반복
assert.strictEqual(isRepeat("Hook과 MCP 도구 호출 흐름", "Claude가 도구를 쓰기 전에 훅이 먼저 돌면서 권한을 확인하고 있어요.\n### 나온 말·용어 풀이\n- **훅** — …", past, false), true);
// 용어가 겹쳐도 작업 이야기가 다르면 통과(유저: 같은 용어 여러 번 접하며 익힘)
assert.strictEqual(isRepeat("웹 빌드 결과 확인", "이제 웹으로 빌드해서 화면이 제대로 뜨는지 브라우저에서 확인하고 있어요.\n### 나온 말·용어 풀이\n- **훅(hook)** — …\n- **MCP** — …", past, false), false);
// 같은 제목(띄어쓰기·기호 무시)이면 반복
assert.strictEqual(isRepeat("도구 실행 전후에 걸리는 훅!", "전혀 다른 이야기를 하고 있는 첫 문단입니다 아주 길게", past, false), true);
// 코드가 바뀌었으면 제목이 같아도 통과
assert.strictEqual(isRepeat("도구 실행 전후에 걸리는 훅", hook, past, true), false);
assert.ok(similarity("abc def", "abc def") === 1 && similarity("", "x") === 0);
assert.deepStrictEqual(memoLines(past, () => "00:43"), ["- [00:43] 도구 실행 전후에 걸리는 훅 — Claude가 도구를 쓰기 전에 훅이 먼저 돌아 권한을 확인하고 있어요."]);
// 리뷰: 소제목으로 시작해도 첫 문단을 잡음, 짧은 문장끼리는 비교 안 함, 기본 제목끼리 내용이 다르면 통과
assert.strictEqual(leadOf("### 지금 하는 일\n본문 첫 줄"), "본문 첫 줄");
assert.strictEqual(isRepeat("다른 제목", "지금 로그 파일을 읽고 있어요.", [{ ts: 1, title: "x", expl: "지금 설정 파일을 읽고 있어요." }], false), false);
assert.strictEqual(isRepeat("작업 중", "웹 빌드를 돌려서 화면이 제대로 뜨는지 브라우저에서 확인하는 중이에요. 결과를 보고 다음 단계로 갑니다.", [{ ts: 1, title: "작업 중", expl: "테스트 파일을 새로 만들고 조사 빈칸 퀴즈 함수가 맞게 동작하는지 점검하는 단계예요. 실패하면 고칩니다." }], false), false);
console.log("narrationMemo.check ok");
