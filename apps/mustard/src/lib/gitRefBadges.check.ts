// gitRefBadges 점검 — node --experimental-strip-types src/lib/gitRefBadges.check.ts
import assert from "node:assert/strict";
import { badgeRefs } from "./gitRefBadges.ts";

assert.deepEqual(badgeRefs(["fix/87-case", "origin/fix/87-case"], "main"), { shown: [{ ref: "fix/87-case", remotes: ["origin/fix/87-case"] }], hidden: [] }, "로컬+원격 같은 이름은 하나로");
assert.deepEqual(badgeRefs(["origin/main", "v1.2", "dev", "main"], "main").shown.map((x) => x.ref), ["main", "v1.2"], "현재 브랜치 먼저, 최대 2개");
assert.deepEqual(badgeRefs(["origin/main", "v1.2", "dev", "main"], "main").hidden, ["dev"], "나머지는 +N");
assert.deepEqual(badgeRefs(["origin/feature/x"], "main"), { shown: [{ ref: "origin/feature/x", remotes: [] }], hidden: [] }, "원격만 있으면 그대로");
assert.deepEqual(badgeRefs(["feature/x", "x"], "main").shown.map((x) => x.ref), ["feature/x", "x"], "로컬 이름의 /는 원격 아님");
assert.deepEqual(badgeRefs(["x", "feature/x", "origin/feature/x"], "main", 5).shown.find((b) => b.ref === "x")?.remotes, [], "x의 원격은 origin/x뿐(feature/x 아님)");
assert.deepEqual(badgeRefs(["v1.2", "origin/v1.2"], "main").shown.map((b) => b.ref), ["v1.2", "origin/v1.2"], "태그 모양은 안 합침");
assert.deepEqual(badgeRefs(["2fa-login", "origin/2fa-login"], "main").shown, [{ ref: "2fa-login", remotes: ["origin/2fa-login"] }], "숫자로 시작하는 브랜치는 합침");
assert.deepEqual(badgeRefs([], "main"), { shown: [], hidden: [] });
console.log("gitRefBadges ok");
