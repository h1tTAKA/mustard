// crewSettings 점검 — MUSTARD_CREW_DIR=<임시> node --experimental-strip-types src/lib/crew/crewSettings.check.ts
import assert from "node:assert";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { createHash } from "node:crypto";
import { readSettings, writeSettings } from "./crewSettings.ts";

assert.ok(process.env.MUSTARD_CREW_DIR, "임시 디렉터리 필수(실 설정 보호)");
const root = "/tmp/repo-set";
assert.deepStrictEqual(readSettings(root), { auto: false }, "없으면 꺼짐");
assert.deepStrictEqual(writeSettings(root, { auto: true }), { auto: true });
assert.deepStrictEqual(readSettings(root + "/"), { auto: true }, "끝 / 무시(같은 레포)");
assert.deepStrictEqual(readSettings("/tmp/other"), { auto: false }, "레포별");
assert.deepStrictEqual(writeSettings(root, { auto: "yes" }), { auto: true }, "타입 틀리면 무시");
assert.deepStrictEqual(writeSettings(root, { auto: false }), { auto: false });
// 깨진 파일 = 꺼짐(안전 쪽)
const f = join(process.env.MUSTARD_CREW_DIR!, createHash("sha256").update(root).digest("hex").slice(0, 32), "settings.json");
mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, "{oops"); assert.deepStrictEqual(readSettings(root), { auto: false }, "깨지면 꺼짐");
writeFileSync(f, JSON.stringify({ auto: "true" })); assert.deepStrictEqual(readSettings(root), { auto: false }, "true(불리언)만 켜짐");
console.log("crewSettings.check ok");
