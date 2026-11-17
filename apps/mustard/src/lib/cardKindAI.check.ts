// cardKindAI 점검 — node --experimental-strip-types src/lib/cardKindAI.check.ts
import assert from "node:assert";
import { classifyPrompt, parseKinds } from "./cardKindAI.ts";
import { takeKind, parseNarrationTerms, splitCardSection } from "./catchupTerms.ts";

assert.deepEqual(parseKinds("1 코드\n2. 개념\n3: IT\n**4** 개념\n9 코드", 5), ["token", "concept", "term", undefined, undefined]);
assert.deepEqual(parseKinds("1 [코드]\n2 code\n3 it", 3), ["token", "token", "term"]);
assert.match(classifyPrompt([{ name: "dispose", def: "자원 정리\n메서드" }]), /1\. dispose — 자원 정리 메서드/);
assert.deepEqual(takeKind("자원을 정리하는 메서드 [코드]"), { def: "자원을 정리하는 메서드", kind: "token" });
assert.deepEqual(takeKind("함수가 자기를 부르는 구조 [개념]"), { def: "함수가 자기를 부르는 구조", kind: "concept" });
assert.deepEqual(takeKind("음성 합성 기술 ［IT］"), { def: "음성 합성 기술", kind: "term" });
assert.deepEqual(takeKind("배열 [0]번 값"), { def: "배열 [0]번 값" }); // 표시 아닌 대괄호는 그대로
const t = parseNarrationTerms("### 용어\n- **`dispose`** — 자원을 정리하는 메서드 [코드]\n- **재귀** — 자기를 부르는 구조 [개념]");
assert.deepEqual(t.map((x) => [x.def, x.kind]), [["자원을 정리하는 메서드", "token"], ["자기를 부르는 구조", "concept"]]);
assert.deepEqual(splitCardSection("본문\n### 카드로 남길 개념\n- **TTS** — 글을 소리로 [IT]").items, [{ term: "TTS", def: "글을 소리로", kind: "term" }]);
console.log("cardKindAI ok");
