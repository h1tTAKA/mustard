// crewPermStore 점검 — MUSTARD_CREW_DIR=<임시> node --experimental-strip-types src/lib/crew/crewPermStore.check.ts
import assert from "node:assert";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

process.env.MUSTARD_CREW_DIR ||= mkdtempSync(join(tmpdir(), "crewperm-"));
const { readPerms, writePerms } = await import("./crewPermStore.ts");

// 파일 없음 = 기본값
assert.deepStrictEqual(readPerms(), { unknownCmd: true, git: true, code: true, network: false, system: false, publish: false, mcp: false });
// 바꾼 것만 바뀜, 모르는 키·불리언 아닌 값은 무시
assert.deepStrictEqual(writePerms({ network: true, code: "yes", evil: true }), { unknownCmd: true, git: true, code: true, network: true, system: false, publish: false, mcp: false });
assert.strictEqual(readPerms().network, true);
assert.ok(!("evil" in readPerms()));
// 깨진 파일 = 기본값
writeFileSync(join(process.env.MUSTARD_CREW_DIR!, "permissions.json"), "{oops");
assert.strictEqual(readPerms().network, false);
console.log("crewPermStore.check ok");
