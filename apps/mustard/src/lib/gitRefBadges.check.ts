// gitRefBadges 점검 — node --experimental-strip-types src/lib/gitRefBadges.check.ts
import assert from "node:assert/strict";
import { badgeRefs } from "./gitRefBadges.ts";

assert.deepEqual(badgeRefs(["fix/87-case", "origin/fix/87-case"], "main"), { shown: [{ ref: "fix/87-case", synced: true }], hidden: [] }, "로컬+원격 같은 이름은 하나로");
assert.deepEqual(badgeRefs(["origin/main", "v1.2", "dev", "main"], "main").shown.map((x) => x.ref), ["main", "v1.2"], "현재 브랜치 먼저, 최대 2개");
assert.deepEqual(badgeRefs(["origin/main", "v1.2", "dev", "main"], "main").hidden, ["dev"], "나머지는 +N");
assert.deepEqual(badgeRefs(["origin/feature/x"], "main"), { shown: [{ ref: "origin/feature/x", synced: false }], hidden: [] }, "원격만 있으면 그대로");
assert.deepEqual(badgeRefs(["feature/x", "x"], "main").shown.map((x) => x.ref), ["feature/x", "x"], "로컬 이름의 /는 원격 아님");
assert.deepEqual(badgeRefs([], "main"), { shown: [], hidden: [] });
console.log("gitRefBadges ok");
