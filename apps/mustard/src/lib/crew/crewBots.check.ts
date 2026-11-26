// crewBots 점검 — MUSTARD_CREW_DIR=<임시> MUSTARD_BOTS_DIR=<임시> node --experimental-strip-types src/lib/crew/crewBots.check.ts
import assert from "node:assert";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { applyBotOp, botHome, listBots } from "./crewBots.ts";
import { applyRoleOp, listRoles, readStored } from "./crewRoleStore.ts";
import { CATALOG } from "./crewCatalog.ts";
import { CATALOG_AGENTS } from "./crewCatalogAgents.ts";

const crew = process.env.MUSTARD_CREW_DIR, home = process.env.MUSTARD_BOTS_DIR;
assert.ok(crew && home, "임시 디렉터리 둘 다 필수(실 데이터 보호)");

// 옛 사용자: 커스텀 역할 1 + 레포 하나의 보드에 app-builder, 대화에 test-engineer 등장
applyRoleOp({ op: "save", role: { name: "Security Reviewer", instructions: "check" } }); // 카탈로그 id 예약 → security-reviewer-2
applyRoleOp({ op: "save", role: { id: "scope-planner", provider: "codex" } });            // 고쳐 둔 기본 역할도 옮김
mkdirSync(join(crew, "abc123"), { recursive: true });
writeFileSync(join(crew, "abc123", "board.json"), JSON.stringify({ tasks: [{ id: "t1", roles: ["app-builder"] }] }));
writeFileSync(join(crew, "abc123", "chat.jsonl"), JSON.stringify({ from: "test-engineer", text: "ok" }) + "\n");
assert.strictEqual(readStored().bots, undefined, "옛 파일엔 bots 칸 없음");

let bots = listBots();
assert.deepStrictEqual(bots.map((b) => b.id).sort(), ["app-builder", "scope-planner", "security-reviewer-2", "test-engineer"], "쓰던 역할만 이전(8개 다 아님)");
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
// 카탈로그: 기본 8 + 외부 54, id 겹침 없음, 외부 항목은 지시문·3언어 이름이 다 있음, 원문 저장소 이름 없음
const ext = CATALOG.filter((c) => !c.builtin);
assert.strictEqual(CATALOG.length, 62);
assert.strictEqual(new Set(CATALOG.map((c) => c.id)).size, CATALOG.length, "id 겹침");
assert.deepStrictEqual(ext.map((c) => c.id).sort(), Object.keys(CATALOG_AGENTS).sort(), "목록 ↔ 생성물 일치");
for (const c of ext) assert.ok(c.name?.ko && c.name.ja && c.name.en && c.desc?.ko && c.desc.ja && c.desc.en, `3언어: ${c.id}`);
// 원문 저장소 주인·이름(고지 파일의 Source 줄에서 읽음 — 이름은 고지에만 둔다)이 지시문에 없어야 함
const notice = readFileSync(join(import.meta.dirname, "../../../../../THIRD_PARTY_NOTICES.md"), "utf8");
const src = notice.split("crewCatalogAgents.ts")[1]?.match(/Source: https:\/\/github\.com\/([^/\s]+)\/([^/\s]+)/);
assert.ok(src, "고지 파일에 카탈로그 출처");
const agentsText = JSON.stringify(CATALOG_AGENTS);
for (const w of [src[1], src[2]]) assert.ok(!new RegExp(`\\b${w}\\b`, "i").test(agentsText), "원문 저장소 이름 금지");

// 외부 항목 설치 = 그 언어 이름으로 커스텀 역할 복사 + 봇 폴더
bots = applyBotOp({ op: "install", catalog: "go-reviewer", locale: "ko" });
const go = bots.find((b) => b.id === "go-reviewer")!;
assert.ok(go && go.name === "Go 리뷰어" && go.access === "read" && go.catalog === "go-reviewer" && go.instructions === CATALOG_AGENTS["go-reviewer"].instructions, "외부 설치");
assert.match(readFileSync(join(go.home, "ABOUT.md"), "utf8"), /# Go 리뷰어\n\n관용구/);
// 고친 지시문은 지웠다 다시 설치해도 남음(새로 복사 안 함)
applyRoleOp({ op: "save", role: { id: "go-reviewer", instructions: "mine" } });
applyBotOp({ op: "uninstall", id: "go-reviewer" });
bots = applyBotOp({ op: "install", catalog: "go-reviewer", locale: "ja" });
assert.ok(bots.find((b) => b.id === "go-reviewer")?.instructions === "mine", "재설치는 기존 역할 되살림");
assert.strictEqual(listRoles().filter((r) => r.id.startsWith("go-reviewer")).length, 1, "복사본 안 늘어남");
assert.strictEqual(applyBotOp({ op: "install", catalog: "build-error-resolver" }).find((b) => b.id === "build-error-resolver")?.name, "Build Error Resolver", "언어 없으면 영어");
// 직접 만들기: 봇 폴더를 못 만들면 역할도 남기지 않음(자리에 파일을 두어 실패시킴)
mkdirSync(home, { recursive: true });
writeFileSync(join(home, "broken-bot"), "x");
assert.throws(() => applyBotOp({ op: "create", name: "Broken Bot", mission: "m" }));
assert.ok(!listRoles().some((r) => r.id.startsWith("broken-bot")), "실패하면 역할 되돌림");

// 상속 이름(__proto__ 등)은 봇이 아님, 이상한 언어는 영어로
assert.throws(() => applyBotOp({ op: "update", id: "__proto__", name: "x" }), /not a bot/);
assert.strictEqual(({} as Record<string, unknown>).name, undefined, "Object.prototype 안 건드림");
assert.strictEqual(applyBotOp({ op: "install", catalog: "planner", locale: "constructor" as never }).find((b) => b.id === "planner")?.name, "Planner");

// 커스텀 역할을 지우면 봇 정보도 지움(같은 이름으로 다시 만들 때 옛 봇이 안 되살아남)
applyRoleOp({ op: "delete", id: "security-reviewer-2" });
assert.ok(!readStored().bots?.["security-reviewer-2"]);

// 깨진 roles.json은 덮기 전에 옆에 백업
writeFileSync(join(crew, "roles.json"), "{broken");
listBots();
assert.ok(readdirSync(crew).some((f) => f.startsWith("roles.json.bad-")), "깨진 파일 백업");
writeFileSync(join(crew, "roles.json"), JSON.stringify({ overrides: {}, custom: [null, { id: "ok-role", name: "Ok" }] }));
assert.doesNotThrow(() => listBots(), "custom 안의 null 칸은 버림");
console.log("crewBots OK");
