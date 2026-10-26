// catchupStore 점검 — MUSTARD_STREAM_DIR=<임시> node --experimental-strip-types src/lib/catchupStore.check.ts
import assert from "node:assert";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendItems, replaceItems, askCounts, catchupRoots, dayKey, findItem, itemsForHashes, listDays, mainOf, readAsk, readDay, readRecent, readSession, searchItems, sanitize, writeAsk, writeSession } from "./catchupStore.ts";

assert.ok(process.env.MUSTARD_STREAM_DIR, "임시 디렉터리 필수(실 기록 보호)");
const root = "/tmp/repo-a";
const d1 = new Date(2026, 9, 5, 10).getTime(), d2 = new Date(2026, 9, 6, 9).getTime();
const it = (key: string, ts: number) => ({ key, kind: "narration" as const, target: key, tool: "narration", ts, expl: `설명 ${key}` });

assert.strictEqual(dayKey(d1), "2026-10-05");
assert.strictEqual(appendItems(root, [it("a", d1), it("b", d2), it("c", d2 + 1000)]), 3, "3개 추가");
assert.strictEqual(appendItems(root + "/", [it("a", d1), it("c", d2 + 1000)]), 0, "같은 날 같은 key 스킵(멱등), 끝 슬래시 정규화");
assert.deepStrictEqual(listDays(root), ["2026-10-06", "2026-10-05"], "날짜 최신순");
assert.deepStrictEqual(readDay(root, "2026-10-06").map((x) => x.key), ["c", "b"], "하루 최신순");
assert.deepStrictEqual(readRecent(root, 2).map((x) => x.key), ["c", "b"], "최근 limit");
assert.deepStrictEqual(readRecent(root, 10).map((x) => x.key), ["c", "b", "a"], "여러 날 이어서");
assert.deepStrictEqual(readDay(root, "../etc"), [], "날짜 형식 아니면 빈 배열(경로 탈출 차단)");
assert.strictEqual(sanitize({ key: "x", kind: "evil", target: "t", ts: 1, expl: "e" }), null, "모르는 kind 거부");
assert.strictEqual(sanitize({ key: "x", kind: "file", target: "t", ts: 1, expl: "  " }), null, "빈 설명 거부");
assert.deepStrictEqual(listDays("/tmp/none"), [], "없는 레포");
// 파일에 중복 줄이 생겨도(다중 프로세스 등) 읽을 때 key로 걸러냄
const dir = join(process.env.MUSTARD_STREAM_DIR!, readdirSync(process.env.MUSTARD_STREAM_DIR!)[0]);
appendFileSync(join(dir, "2026-10-06.jsonl"), JSON.stringify(it("b", d2)) + "\n");
assert.deepStrictEqual(readDay(root, "2026-10-06").map((x) => x.key), ["c", "b"], "중복 줄 읽기 dedupe");
// #1049 검색 — 전체 날짜, 최신순, 대소문자 무시, 빈 검색어는 빈 배열
assert.deepStrictEqual(searchItems(root, "", 10), [], "빈 검색어");
assert.ok(searchItems(root, readDay(root, "2026-10-05")[0].target.toUpperCase(), 10).some((x) => x.key === "a"), "지난 날짜도·대소문자 무시");
assert.strictEqual(searchItems(root, "없는검색어zzz", 10).length, 0);
// #998 질문 대화 저장·복원·배지
assert.strictEqual(readAsk(root, "narration|1|x"), null, "없는 대화 null");
const saved = writeAsk(root, { key: "narration|1|x", target: "x", messages: [{ role: "user", content: "q1" }, { role: "assistant", content: "a1" }, { role: "evil", content: "z" }, { role: "user", content: "q2" }] }, 99);
assert.strictEqual(saved?.messages.length, 3, "모르는 role 버림");
assert.deepStrictEqual(readAsk(root, "narration|1|x")?.messages.map((m) => m.content), ["q1", "a1", "q2"], "복원");
assert.deepStrictEqual(askCounts(root), { "narration|1|x": 2 }, "유저 질문 수 배지");
assert.strictEqual(writeAsk(root, { key: "", messages: [] }, 1), null, "빈 key 거부");
assert.deepStrictEqual(listDays(root), ["2026-10-06", "2026-10-05"], "ask 폴더가 날짜 목록에 안 섞임");
console.log("catchupStore ok");

// #1093 replaceItems — 같은 key 교체(복구), 다른 줄 보존, 실패 해설 카드는 읽을 때 숨김
{
  const r = "/tmp/repo-replace"; const t = new Date(2026, 9, 7, 9).getTime();
  appendItems(r, [{ ...it("diff|a|x.ts", t), kind: "diff" as never, expl: "런타임 실패: Max" }, it("keep", t)]);
  replaceItems(r, [{ ...it("diff|a|x.ts", t), kind: "diff" as never, expl: "정상 설명" }]);
  const day = readDay(r, "2026-10-07");
  assert.strictEqual(day.length, 2, "교체 후 줄 수 그대로");
  assert.strictEqual(day.find((x) => x.key === "diff|a|x.ts")?.expl, "정상 설명", "새 내용으로 교체");
  appendItems(r, [{ ...it("nar-fail", t), expl: "런타임 실패: Max active sessions" }]);
  assert.ok(!readDay(r, "2026-10-07").some((x) => x.key === "nar-fail"), "실패 해설 카드 숨김");
}
// #1181 worktree에서 쌓인 것도 메인 레포 한 곳에 — 화면은 작업 폴더별, all이면 전부
{
  const tmp = realpathSync(mkdtempSync(join(tmpdir(), "cs-wt-")));
  const g = (cwd: string, ...a: string[]) => execFileSync("git", a, { cwd, encoding: "utf8" }).trim();
  const main = join(tmp, "repo"), wt = join(tmp, "repo-wt");
  mkdirSync(main); g(main, "init", "-q", "-b", "main"); g(main, "config", "user.email", "t@t"); g(main, "config", "user.name", "t");
  writeFileSync(join(main, "a"), "1"); g(main, "add", "."); g(main, "commit", "-qm", "c1");
  // 옛 기록: worktree 경로로 따로 쌓인 폴더(#1170 직후 버전) — 만들어 두고 옮겨지는지
  g(main, "worktree", "add", "-q", "-b", "feat/x", wt);
  const legacy = join(process.env.MUSTARD_STREAM_DIR!, createHash("sha256").update(wt).digest("hex").slice(0, 32));
  mkdirSync(join(legacy, "sessions"), { recursive: true });
  writeFileSync(join(legacy, "2026-10-08.jsonl"), JSON.stringify(it("old-wt", new Date(2026, 9, 8, 9).getTime())) + "\n");
  writeFileSync(join(legacy, "sessions", "abcdef1.json"), JSON.stringify({ s: 1 }));
  assert.strictEqual(mainOf(wt), main, "worktree의 메인 = 공용 .git의 부모");
  assert.strictEqual(mainOf(main), main);
  assert.strictEqual(mainOf("/tmp/not-a-repo-xyz"), "/tmp/not-a-repo-xyz", "git 아니면 그대로");
  const t = new Date(2026, 9, 9, 10).getTime();
  appendItems(main, [it("same", t), it("m-only", t + 1)]);
  appendItems(wt, [it("same", t), { ...it("w-only", t + 2), wt: "/evil", br: "x" }, { ...it("diff|1234567abc|x.ts", t + 3), kind: "diff" as const }]);
  const mineMain = readDay(main, "2026-10-09"), mineWt = readDay(wt, "2026-10-09"), all = readDay(main, "2026-10-09", true);
  assert.deepStrictEqual(mineMain.map((x) => x.key).sort(), ["m-only", "same"], "메인 화면 = 메인 것만");
  assert.deepStrictEqual(mineWt.map((x) => x.key).sort(), ["diff|1234567abc|x.ts", "same", "w-only"], "worktree 화면 = 그 폴더 것만(같은 key도 따로)");
  assert.strictEqual(all.length, 5, "all = 레포 전체");
  assert.ok(mineWt.every((x) => x.wt === wt && x.br === "feat/x"), "클라가 보낸 wt·br 무시, 서버가 폴더·브랜치 붙임");
  assert.ok(mineMain.every((x) => x.wt === undefined), "메인 항목엔 표시 없음");
  assert.ok(!existsSync(join(process.env.MUSTARD_STREAM_DIR!, createHash("sha256").update(wt).digest("hex").slice(0, 32))), "옛 폴더는 .migrated로");
  assert.ok(readDay(wt, "2026-10-08").some((x) => x.key === "old-wt"), "옛 기록이 메인으로 옮겨져 그 폴더 화면에 보임");
  assert.ok(readSession(main, "abcdef1"), "옛 세션도 메인 폴더로");
  assert.ok(listDays(main).includes("2026-10-09") && !listDays(main).includes("2026-10-08"), "메인 날짜 목록 = 메인 항목 있는 날만");
  assert.ok(listDays(main, true).includes("2026-10-08"), "all 날짜 목록엔 worktree 날도");
  assert.strictEqual(itemsForHashes(main, ["1234567"]).length, 1, "worktree에서 만든 커밋 카드를 메인에서도 찾음(머지 뒤)");
  assert.strictEqual(findItem(main, "w-only")?.wt, wt, "키 찾기는 지금 폴더에 없으면 레포 전체");
  writeSession(wt, "fedcba9", { s: 2 });
  assert.ok(readSession(main, "fedcba9"), "커밋 ↔ 대화 세션은 레포 한 벌 — 메인에서도 이어짐");
  // 리뷰: 심볼릭 링크로 연 메인도 같은 자리, 레포 안 하위 폴더는 worktree가 아님(예전처럼 그 경로 그대로)
  const link = join(tmp, "link"); symlinkSync(main, link);
  assert.strictEqual(mainOf(link), main, "심볼릭 링크 = 실제 경로");
  mkdirSync(join(main, "sub"));
  appendItems(join(main, "sub"), [it("sub-item", t)]);
  assert.ok(readDay(join(main, "sub"), "2026-10-09").every((x) => x.wt === undefined), "하위 폴더는 worktree 표시 없음");
  assert.ok(!catchupRoots().some((r) => r === wt), "옮기고 남은 옛 폴더(.migrated)는 레포 목록에서 뺌");
  // 리뷰: 심볼릭 경로로 쌓인 옛 메인 기록 + 실제 경로 기록이 둘 다 있으면 합침
  const link2 = join(tmp, "link2"); symlinkSync(main, link2);
  const oldMain = join(process.env.MUSTARD_STREAM_DIR!, createHash("sha256").update(link2).digest("hex").slice(0, 32));
  mkdirSync(oldMain, { recursive: true });
  writeFileSync(join(oldMain, "2026-10-07.jsonl"), JSON.stringify(it("via-link", new Date(2026, 9, 7, 9).getTime())) + "\n");
  assert.ok(readDay(link2, "2026-10-07").some((x) => x.key === "via-link"), "심볼릭 경로 옛 기록이 실제 경로 기록과 합쳐짐");
  assert.ok(!existsSync(oldMain), "합친 옛 폴더는 .migrated");
  g(main, "worktree", "remove", "--force", wt);
  assert.strictEqual(readDay(main, "2026-10-09", true).filter((x) => x.br === "feat/x").length, 3, "worktree를 지워도 기록과 브랜치 이름은 남음");
}
console.log("catchupStore.check ok");
