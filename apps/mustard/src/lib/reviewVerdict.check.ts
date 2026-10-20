// reviewVerdict 점검 — node --experimental-strip-types src/lib/reviewVerdict.check.ts
import assert from "node:assert";
import { latestReviews } from "./reviewVerdict.ts";

const r = (login: string, state: string, at: string, body = "") => ({ author: { login }, state, body, submittedAt: at });
const out = latestReviews([
  r("a", "APPROVED", "2026-01-01"), r("a", "COMMENTED", "2026-01-02", "nit"), // 나중 코멘트가 승인을 안 덮음
  r("b", "CHANGES_REQUESTED", "2026-01-01"), r("b", "DISMISSED", "2026-01-03"),   // 철회되면 판정 없음
  r("c", "COMMENTED", "2026-01-01", "looks ok"),                                   // 코멘트만
  r("d", "COMMENTED", "2026-01-01"),                                               // 빈 코멘트(줄 댓글 묶음) 제외
  r("e", "APPROVED", "2026-01-01"), r("e", "CHANGES_REQUESTED", "2026-01-02"),     // 최근 판정
] as never);
assert.deepStrictEqual(out.map((x) => [x.author.login, x.state]).sort(), [["a", "APPROVED"], ["c", "COMMENTED"], ["e", "CHANGES_REQUESTED"]]);
console.log("reviewVerdict ok");
