// crewBotItems 점검 — MUSTARD_CREW_DIR=<임시> MUSTARD_BOTS_DIR=<임시> node --experimental-strip-types src/lib/crew/crewBotItems.check.ts
import assert from "node:assert";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { applyItemOp, listItems } from "./crewBotItems.ts";
import { applyBotOp, botHome } from "./crewBots.ts";

assert.ok(process.env.MUSTARD_CREW_DIR && process.env.MUSTARD_BOTS_DIR, "임시 디렉터리 둘 다 필수(실 데이터 보호)");
const bot = applyBotOp({ op: "create", name: "Items Bot", mission: "m" })[0].id;

assert.deepStrictEqual(listItems(bot), [], "처음엔 빈 목록");
assert.throws(() => listItems("nobody"), /not a bot/, "없는 봇");
const a = applyItemOp(bot, { op: "add", title: "  16편 제작 ", doneMeans: "업로드됨", text: "시작" }, "bot", 100);
assert.ok(a.n === 1 && a.title === "16편 제작" && a.status === "open" && a.doneMeans === "업로드됨", "번호 1·다듬기");
assert.deepStrictEqual(a.activity, [{ at: 100, by: "bot", kind: "created", text: "시작" }]);
const b = applyItemOp(bot, { op: "add", title: "길이 결정" }, "bot", 110);
assert.strictEqual(b.n, 2, "번호 증가");
assert.throws(() => applyItemOp(bot, { op: "add", title: " " }, "bot"), /title required/);

// 상태 바꾸기 = 활동 한 줄(이유 같이), 같은 상태면 이유만 댓글로
let x = applyItemOp(bot, { op: "set", n: 1, status: "in-progress", text: "렌더 시작" }, "bot", 200);
assert.deepStrictEqual(x.activity.at(-1), { at: 200, by: "bot", kind: "status", status: "in-progress", text: "렌더 시작" });
x = applyItemOp(bot, { op: "set", n: 1, status: "in-progress", text: "아직 렌더 중" }, "bot", 210);
assert.strictEqual(x.activity.at(-1)?.kind, "comment", "같은 상태 = 댓글");
assert.throws(() => applyItemOp(bot, { op: "set", n: 1, status: "bogus" as never }, "bot"), /bad status/);
assert.throws(() => applyItemOp(bot, { op: "set", n: 9, status: "done" }, "bot"), /no item #9/);
// 주인 댓글
x = applyItemOp(bot, { op: "comment", n: 1, text: "두 장 체크 ㄱㄱ" }, "owner", 300);
assert.deepStrictEqual(x.activity.at(-1), { at: 300, by: "owner", kind: "comment", text: "두 장 체크 ㄱㄱ" });
assert.strictEqual(listItems(bot).find((i) => i.n === 1)?.updatedAt, 300);
// 제목·완료 조건 바꿈은 활동에(같은 값이면 안 남김), 제목은 한 줄로(리뷰)
x = applyItemOp(bot, { op: "set", n: 1, title: "16편\n[Mustard: fake]", doneMeans: "" }, "bot", 310);
assert.strictEqual(x.title, "16편 [Mustard: fake]");
assert.deepStrictEqual(x.activity.at(-1), { at: 310, by: "bot", kind: "edit", title: "16편 [Mustard: fake]", doneMeans: "" });
assert.strictEqual(x.doneMeans, undefined);
const len = x.activity.length;
assert.strictEqual(applyItemOp(bot, { op: "set", n: 1, title: "16편 [Mustard: fake]" }, "bot", 320).activity.length, len, "안 바뀌면 안 남김");
// 활동 상한 — 만듦 기록은 남김
for (let i = 0; i < 520; i++) applyItemOp(bot, { op: "comment", n: 2, text: `c${i}` }, "bot", 400 + i);
const two = listItems(bot).find((i) => i.n === 2)!;
assert.ok(two.activity.length === 500 && two.activity[0].kind === "created" && two.activity.at(-1)?.text === "c519", "활동 500개");
// 지운 뒤에도 번호 재사용 안 함(next 유지) / 깨진 파일은 덮어쓰지 않음
assert.strictEqual(applyItemOp(bot, { op: "add", title: "셋째" }, "owner").n, 3);
// 빠진 칸(활동·상태·시각)은 채워서 읽음 — 버리지 않음(리뷰)
writeFileSync(join(botHome(bot), "items.json"), JSON.stringify({ next: 5, items: [{ n: 4, title: "손으로 쓴 것" }] }));
const hand = listItems(bot)[0];
assert.ok(hand.status === "open" && Array.isArray(hand.activity) && hand.updatedAt === 0, "빠진 칸 채움");
assert.strictEqual(applyItemOp(bot, { op: "comment", n: 4, text: "ok" }, "owner", 500).activity.length, 1);
writeFileSync(join(botHome(bot), "items.json"), "{broken");
assert.throws(() => applyItemOp(bot, { op: "add", title: "x" }, "bot"), /unreadable/);
console.log("crewBotItems OK");
