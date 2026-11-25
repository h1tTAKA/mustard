// crewRooms 점검 — MUSTARD_CREW_DIR=<임시> node --experimental-strip-types src/lib/crew/crewRooms.check.ts
import assert from "node:assert";
import { applyRoomOp, cleanRoom, dmRole, dmRoom, pickModerator, readRooms, roomMembers } from "./crewRooms.ts";

assert.ok(process.env.MUSTARD_CREW_DIR, "임시 디렉터리 필수");
const root = "/tmp/repo-rooms";
const known = new Set(["app-builder", "test-engineer", "bug-fixer", "scope-planner"]);
const all = [...known];

// 방 id
assert.strictEqual(dmRoom("app-builder"), "dm-app-builder");
assert.strictEqual(dmRole("dm-app-builder"), "app-builder");
assert.strictEqual(dmRole("g-1234abcd"), null);
assert.strictEqual(cleanRoom("dm-app-builder"), "dm-app-builder");
assert.strictEqual(cleanRoom("g-1234abcd"), "g-1234abcd");
for (const bad of ["app-builder", "g-xyz", "../x", "dm-", 3]) assert.strictEqual(cleanRoom(bad), undefined, `이상한 방 id 버림: ${bad}`);

// 그룹 만들기 — 2명 이상, 없는 봇은 빠짐, 같은 멤버 구성이면 기존 방
assert.throws(() => applyRoomOp(root, { op: "create", members: ["app-builder", "nobody"] }, known), /2\+/);
const a = applyRoomOp(root, { op: "create", members: ["app-builder", "test-engineer", "nobody"], name: "  빌드 팀 " }, known, 100).room!;
assert.deepStrictEqual([a.members, a.name], [["app-builder", "test-engineer"], "빌드 팀"]);
assert.match(a.id, /^g-[a-f0-9]{8}$/);
const again = applyRoomOp(root, { op: "create", members: ["test-engineer", "app-builder"] }, known);
assert.deepStrictEqual([again.room?.id, again.existing], [a.id, true], "같은 구성 = 기존 방");

// 초대·내보내기·이름·지우기
applyRoomOp(root, { op: "invite", id: a.id, members: ["bug-fixer", "app-builder", "nobody"] }, known);
assert.deepStrictEqual(readRooms(root)[0].members, ["app-builder", "test-engineer", "bug-fixer"], "초대 — 중복·없는 봇 빼고");
applyRoomOp(root, { op: "remove", id: a.id, member: "test-engineer" }, known);
applyRoomOp(root, { op: "remove", id: a.id, member: "bug-fixer" }, known);
assert.throws(() => applyRoomOp(root, { op: "remove", id: a.id, member: "app-builder" }, known), /last member/, "마지막 멤버는 못 내보냄");
applyRoomOp(root, { op: "rename", id: a.id, name: "" }, known);
assert.strictEqual(readRooms(root)[0].name, undefined, "빈 이름 = 이름 지움");
assert.throws(() => applyRoomOp(root, { op: "invite", id: "g-00000000", members: ["bug-fixer"] }, known), /not found/);
{ // 초대 상한 — 넘치면 자르지 않고 거절
  const many = new Set(Array.from({ length: 14 }, (_, i) => `r${i}`));
  const big = applyRoomOp(root, { op: "create", members: ["r0", "r1"] }, many).room!;
  assert.throws(() => applyRoomOp(root, { op: "invite", id: big.id, members: [...many] }, many), /max 12/);
  applyRoomOp(root, { op: "delete", id: big.id }, many);
}

// 방 멤버 — 팀방 = 전부, 1:1 = 그 봇, 그룹 = 멤버(지금 있는 봇만), 없는 방 = null
assert.deepStrictEqual(roomMembers(root, undefined, all), all);
assert.deepStrictEqual(roomMembers(root, "dm-bug-fixer", all), ["bug-fixer"]);
assert.strictEqual(roomMembers(root, "dm-nobody", all), null);
assert.deepStrictEqual(roomMembers(root, a.id, all.filter((x) => x !== "app-builder")), [], "지워진 봇은 빠짐");
assert.strictEqual(roomMembers(root, "g-00000000", all), null);
applyRoomOp(root, { op: "delete", id: a.id }, known);
assert.deepStrictEqual(readRooms(root), []);
// 진행자 — 기본 진행자가 멤버면 그 역할, 아니면 받은 역할·첫 멤버
assert.strictEqual(pickModerator(["app-builder", "scope-planner"], "scope-planner", "app-builder"), "scope-planner");
assert.strictEqual(pickModerator(["app-builder", "test-engineer"], "scope-planner", "test-engineer"), "test-engineer");
assert.strictEqual(pickModerator(["app-builder", "test-engineer"], "scope-planner", "bug-fixer"), "app-builder", "받은 역할이 멤버 아니면 첫 멤버");
assert.strictEqual(pickModerator([], "scope-planner"), "scope-planner");
console.log("crewRooms.check ok");
