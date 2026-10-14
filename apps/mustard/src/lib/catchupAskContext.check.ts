// catchupAskContext 점검 — node --experimental-strip-types src/lib/catchupAskContext.check.ts
import assert from "node:assert";
import { buildCatchupContext, buildWorkHistory } from "./catchupAskContext.ts";

const item = { key: "n|1|게이트", target: "머지 전 게이트", expl: "74단계 게이트 설명", ts: new Date(2026, 9, 6, 1, 13).getTime(), kind: "narration" };
const other = { key: "n|2|플레이키", target: "플레이키 테스트", expl: "REAP_GRACE ".repeat(50), ts: new Date(2026, 9, 5, 14, 50).getTime(), kind: "narration" };
const ctx = buildCatchupContext({ repo: "cooing", item, recent: [item, other], digest: null });
assert.ok(ctx.indexOf("FOCUSED ITEM") < ctx.indexOf("CATCH-UP HISTORY") && ctx.indexOf("CATCH-UP HISTORY") < ctx.indexOf("REPO MAP"), "우선순위 순서");
assert.ok(ctx.includes("## FOCUSED ITEM — 머지 전 게이트 (2026-10-06 01:13)"), "항목 제목·시각");
assert.ok(!ctx.includes("- [2026-10-06 01:13] 머지 전 게이트"), "이력에서 대상 항목 중복 제외");
assert.ok(ctx.includes("- [2026-10-05 14:50] 플레이키 테스트:"), "이력 포함");
assert.ok(ctx.split("REAP_GRACE").length - 1 < 50, "이력 항목 길이 자름");
assert.ok(ctx.includes("(not built yet)"), "지도 없음 표시");
assert.ok(buildCatchupContext({ repo: "r", item: { ...item, expl: "x".repeat(20000) }, recent: [], digest: null }).length < 12000, "항목 해설 상한");
// #1078 레포 질문 작업 기록
assert.strictEqual(buildWorkHistory([]), "", "기록 없으면 빈 문자열");
const wh = buildWorkHistory([{ key: "diff|abc1234|src/x.ts", kind: "diff", target: "src/x.ts @abc1234", expl: "버튼 색\n바꿈", ts: 0 }], 0, "Asia/Seoul");
assert.ok(wh.includes("WORK HISTORY") && wh.includes("(diff) src/x.ts @abc1234: 버튼 색 바꿈") && wh.includes("YYYY-MM-DD.jsonl"));
assert.ok(wh.includes("ref: catchup:diff|abc1234|src/x.ts") && wh.includes("[short label](<catchup:KEY>)"), "#1081 카드 ref + 링크 규칙");
assert.ok(/Now: \d{4}-\d{2}-\d{2} \d{2}:\d{2} \(Asia\/Seoul, UTC[+-]\d{2}:\d{2}\)/.test(wh), "#1081 지금 시각·시간대");
console.log("catchupAskContext ok");
