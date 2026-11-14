// archJobs 점검 — node --experimental-strip-types apps/mustard/src/lib/repo/archJobs.check.ts
import assert from "node:assert/strict";
import { archJobKey, startJob, stopJob, jobOf, runningFeatures, clearJob } from "./archJobs.ts";

const k = archJobKey("/r", "tour", "login");
const a = startJob(k, "build")!;
assert.ok(a);
assert.equal(startJob(k), null); // 돌고 있으면 중복 시작 안 함
a.progress(2, 5, { done: ["x"] });
assert.equal(jobOf(k)!.done, 2);
assert.deepEqual([...runningFeatures("/r")], ["login"]);
stopJob(k);
assert.equal(jobOf(k)!.status, "stopped");
assert.ok(a.signal.aborted);
a.finish(false); // 끊긴 뒤 늦게 온 끝남은 stopped를 덮지 않음
assert.equal(jobOf(k)!.status, "stopped");
const b = startJob(k)!; // 이어하기 — 부분 결과 이어받음
assert.deepEqual(b.partial, { done: ["x"] });
a.progress(9, 9); // 옛 잡의 진행은 무시
assert.equal(jobOf(k)!.done, undefined);
b.finish(true);
assert.equal(jobOf(k)!.status, "done");
assert.equal(jobOf(k)!.partial, undefined);
clearJob(k);
assert.equal(jobOf(k), undefined);
console.log("archJobs ok");
