// crewBots 점검 — MUSTARD_CREW_DIR=<임시> MUSTARD_BOTS_DIR=<임시> node --experimental-strip-types src/lib/crew/crewBots.check.ts
import assert from "node:assert";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { applyBotOp, botHome, listBots } from "./crewBots.ts";
import { applyRoleOp, readStored } from "./crewRoleStore.ts";

const crew = process.env.MUSTARD_CREW_DIR, home = process.env.MUSTARD_BOTS_DIR;
assert.ok(crew && home, "임시 디렉터리 둘 다 필수(실 데이터 보호)");

// 옛 사용자: 커스텀 역할 1 + 레포 하나의 보드에 app-builder, 대화에 test-engineer 등장
applyRoleOp({ op: "save", role: { name: "Security Reviewer", instructions: "check" } });
mkdirSync(join(crew, "abc123"), { recursive: true });
writeFileSync(join(crew, "abc123", "board.json"), JSON.stringify({ tasks: [{ id: "t1", roles: ["app-builder"] }] }));
writeFileSync(join(crew, "abc123", "chat.jsonl"), JSON.stringify({ from: "test-engineer", text: "ok" }) + "\n");
assert.strictEqual(readStored().bots, undefined, "옛 파일엔 bots 칸 없음");

let bots = listBots();
assert.deepStrictEqual(bots.map((b) => b.id).sort(), ["app-builder", "security-reviewer", "test-engineer"], "쓰던 역할만 이전(8개 다 아님)");
assert.ok(readStored().bots, "이전 결과 기록 — 다음엔 다시 안 훑음");

// 역할 저장이 bots 칸을 지우지 않음
applyRoleOp({ op: "save", role: { id: "app-builder", provider: "codex" } });
assert.ok(readStored().bots?.["app-builder"], "역할 저장 후에도 bots 보존");

// 기본 역할 설치 + 봇 폴더
bots = applyBotOp({ op: "install", catalog: "doc-writer" });
assert.ok(bots.some((b) => b.id === "doc-writer" && b.catalog === "doc-writer"), "설치");
assert.ok(existsSync(join(botHome("doc-writer"), "ABOUT.md")) && existsSync(join(botHome("doc-writer"), "MEMORY.md")), "봇 폴더");
assert.throws(() => applyBotOp({ op: "install", catalog: "nope" }), /unknown catalog/);

// 직접 만들기 — 임무가 지시문·ABOUT 첫 문단
bots = applyBotOp({ op: "create", name: "일정 비서", mission: "매일 아침 일정 정리\n회의 전 링크 모으기", color: "#93C5FD" });
const sec = bots[0];
assert.ok(sec.name === "일정 비서" && sec.instructions.startsWith("매일 아침") && sec.color === "#93c5fd" && sec.mission, "만들기(새 봇이 위)");
assert.match(readFileSync(join(sec.home, "ABOUT.md"), "utf8"), /# 일정 비서\n\n매일 아침 일정 정리/);
assert.throws(() => applyBotOp({ op: "create", name: "x", mission: " " }), /mission required/);

// 이름·색 바꾸기, 지우기(폴더 남음)
bots = applyBotOp({ op: "update", id: "app-builder", name: "앱 담당", color: "bad" });
assert.ok(bots.some((b) => b.id === "app-builder" && b.name === "앱 담당"), "기본 역할도 봇 이름 바꾸기");
assert.throws(() => applyBotOp({ op: "update", id: "app-builder", name: " " }), /name required/);
bots = applyBotOp({ op: "uninstall", id: "doc-writer" });
assert.ok(!bots.some((b) => b.id === "doc-writer") && existsSync(botHome("doc-writer")), "목록에서만 빠짐, 폴더 유지");
assert.throws(() => applyBotOp({ op: "uninstall", id: "doc-writer" }), /not a bot/);
console.log("crewBots OK");
