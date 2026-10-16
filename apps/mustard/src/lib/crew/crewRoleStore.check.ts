// crewRoleStore 점검 — MUSTARD_CREW_DIR=<임시> node --experimental-strip-types src/lib/crew/crewRoleStore.check.ts
import assert from "node:assert";
import { applyRoleOp, getRole, listRoles } from "./crewRoleStore.ts";
import { crewProtocol } from "./crewRoleDefaults.ts";

assert.ok(process.env.MUSTARD_CREW_DIR, "임시 디렉터리 필수(실 역할 보호)");

let roles = listRoles();
assert.strictEqual(roles.length, 8, "기본 8");
assert.ok(roles.every((r) => r.builtin && r.instructions.length > 50), "기본 지시문 있음");
assert.strictEqual(getRole("test-engineer")?.provider, "codex", "교차 검증 — 테스트는 Codex 기본");
assert.strictEqual(getRole("scope-planner")?.access, "read");

roles = applyRoleOp({ op: "save", role: { id: "app-builder", provider: "codex", instructions: "custom", name: "무시됨" } });
const ab = roles.find((r) => r.id === "app-builder")!;
assert.deepStrictEqual([ab.provider, ab.instructions, ab.name], ["codex", "custom", ""], "기본 역할 덮어쓰기(이름은 i18n 유지)");
roles = applyRoleOp({ op: "reset", id: "app-builder" });
assert.strictEqual(roles.find((r) => r.id === "app-builder")!.provider, "claude-code", "기본값으로");

assert.throws(() => applyRoleOp({ op: "save", role: { name: "  " } }), /name required/);
roles = applyRoleOp({ op: "save", role: { name: "Security Reviewer", description: "보안 점검", instructions: "check auth", access: "read", provider: "opencode" } });
const sec = roles.find((r) => r.id === "security-reviewer");
assert.ok(sec && !sec.builtin && sec.provider === "opencode" && sec.access === "read", "커스텀 추가(이름에서 id)");
roles = applyRoleOp({ op: "save", role: { name: "Security Reviewer" } });
assert.ok(roles.some((r) => r.id === "security-reviewer-2"), "같은 이름이면 -2");
roles = applyRoleOp({ op: "save", role: { id: "security-reviewer", description: "바꿈" } });
assert.strictEqual(roles.find((r) => r.id === "security-reviewer")!.description, "바꿈", "커스텀 수정");
roles = applyRoleOp({ op: "save", role: { name: "보안 담당" } });
assert.ok(roles.some((r) => r.name === "보안 담당" && /^role(-\d+)?$/.test(r.id)), "한글 이름 → role id");
assert.throws(() => applyRoleOp({ op: "delete", id: "bug-fixer" }), /cannot be deleted/);
roles = applyRoleOp({ op: "delete", id: "security-reviewer-2" });
assert.ok(!roles.some((r) => r.id === "security-reviewer-2"), "커스텀 삭제");
assert.ok(applyRoleOp({ op: "save", role: { id: "x", provider: "evil" as never, name: "X" } }).find((r) => r.name === "X")!.provider === "claude-code", "모르는 AI 무시");

assert.ok(crewProtocol("Japanese").includes("in Japanese") && crewProtocol("Korean").includes("NEVER run git push"), "규약");
console.log("crewRoleStore.check ok");
