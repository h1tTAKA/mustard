// narrationMemo 점검 — node --experimental-strip-types src/lib/narrationMemo.check.ts
import assert from "node:assert";
import { conceptsOf, isRepeat, memoLines } from "./narrationMemo.ts";

const hook = "### 이해하려면\n**훅(hook)** 은 도구 전후에 자동으로 도는 코드예요.\n## 용어\n- **MCP** — 외부 도구 규격";
assert.deepStrictEqual([...conceptsOf(hook)], ["훅", "mcp"]);
const past = [{ ts: 1, title: "도구 실행 전후에 걸리는 훅", expl: hook }];
// 실측(11-16): 제목만 바꿔 같은 '훅'을 또 설명 → 반복
assert.strictEqual(isRepeat("Hook과 MCP 도구 호출 흐름", "**훅(hook)** 은 … **MCP** …", past, false), true);
// 새 개념이 하나라도 있으면 통과
assert.strictEqual(isRepeat("웹 빌드 결과 확인", "**빌드(build)** 는 …", past, false), false);
// 같은 제목은 띄어쓰기·기호가 달라도 같은 제목 — 새 개념 없으면 반복, 새 개념 있으면 통과(기본 제목끼리 겹치는 경우)
assert.strictEqual(isRepeat("도구 실행 전후에 걸리는 훅!", "**훅** 얘기만", past, false), true);
assert.strictEqual(isRepeat("도구 실행 전후에 걸리는 훅!", "**새것** …", past, false), false);
// 같은 제목·굵은 말 없음이어도 코드가 바뀌었으면 통과(재리뷰)
assert.strictEqual(isRepeat("작업 중", "그냥 설명", [{ ts: 1, title: "작업 중", expl: "설명" }], true), false);
// 코드가 바뀌었으면 개념이 겹쳐도 통과
assert.strictEqual(isRepeat("훅 설정 파일 고침", "**훅** …", past, true), false);
assert.deepStrictEqual(memoLines(past, () => "00:43"), ["- [00:43] 도구 실행 전후에 걸리는 훅 — 설명한 개념: 훅, mcp"]);
assert.deepStrictEqual([...conceptsOf("- **훅** — a\n### 이 작업의 이름들\n- **fix/x** — 브랜치\n### 카드로 남길 개념\n- **위젯** — b")], ["훅", "위젯"], "이름들 칸은 개념 아님(리뷰)");
assert.deepStrictEqual([...conceptsOf("**이 작업의 이름들**\n- **fix/x** — 브랜치\n**카드로 남길 개념**\n- **위젯** — b")], ["카드로 남길 개념", "위젯"], "굵은 소제목에서도 끝(리뷰)");
console.log("narrationMemo.check ok");
