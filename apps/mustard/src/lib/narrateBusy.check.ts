// narrateBusy 점검 — node --experimental-strip-types src/lib/narrateBusy.check.ts
import assert from "node:assert";
import { beginNarrate, narratingFor } from "./narrateBusy.ts";

const a = beginNarrate("/repo"), b = beginNarrate("/repo/src");
assert.strictEqual(narratingFor("/repo"), 2, "하위 폴더 cwd도 그 레포로");
assert.strictEqual(narratingFor("/repo/src"), 2, "상위도");
assert.strictEqual(narratingFor("/repo2"), 0, "이름만 비슷한 레포는 아님");
a(); a();
assert.strictEqual(narratingFor("/repo"), 1, "두 번 끝내도 한 번");
b();
assert.strictEqual(narratingFor("/repo"), 0);
console.log("narrateBusy ok");
