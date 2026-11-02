// crew-control 점검 — node electron/crew-control.test.cjs (가짜 fetch, 임시 레포)
const assert = require("node:assert");
const { mkdtempSync, mkdirSync, realpathSync } = require("node:fs");
const { join } = require("node:path");
const { tmpdir } = require("node:os");

const tmp = realpathSync(mkdtempSync(join(tmpdir(), "crewctl-")));
const repo = join(tmp, "repo"), sub = join(repo, "app"), wt = join(tmp, "wt", "abc", "id8");
mkdirSync(join(repo, ".git"), { recursive: true }); mkdirSync(sub, { recursive: true }); mkdirSync(wt, { recursive: true });
process.env.MUSTARD_WORKTREE_DIR = join(tmp, "wt");
const { createCrewControl, repoOf } = require("./crew-control.cjs");

(async () => {
  // 진짜 fetch가 기본으로 연결돼 있는지
  assert.strictEqual(typeof globalThis.fetch, "function");
  assert.strictEqual(repoOf(sub), repo);
  assert.strictEqual(repoOf(tmp), null);

  const calls = [];
  const board = { tasks: [{ id: "t1", title: "로그인", status: "backlog", createdAt: 1, gate: { kind: "spec", text: "확인", stage: 0 } }] };
  const fakeFetch = async (url, init) => {
    calls.push({ url, method: init.method, cookie: init.headers.Cookie, body: init.body && JSON.parse(init.body) });
    if (init.method === "POST" && url.includes("/board")) board.tasks.push({ id: `t${board.tasks.length + 1}`, title: JSON.parse(init.body).title, status: "backlog", createdAt: 1 }); // 같은 시각·같은 제목도 새 id로 구분
    const body = url.includes("/board") ? { ok: true, board } : url.includes("/run") ? { ok: true, runs: [{ taskId: "t1", state: "running", role: "app-builder" }] } : { ok: true, msgs: [] };
    return { ok: true, status: 200, json: async () => body };
  };
  let base = "http://127.0.0.1:1";
  const cc = createCrewControl({ appBase: () => base, uiToken: "SECRET", fetch: fakeFetch });

  // 보드 읽기 — 레포 루트로, 쿠키 붙음, 관문은 사람 대기로 보임
  let r = await cc.call("crew_board", {}, sub);
  assert.ok(!r.isError, r.content[0].text);
  const out = JSON.parse(r.content[0].text);
  assert.strictEqual(out.tasks[0].run.state, "running");
  assert.match(out.tasks[0].waitingForUser, /^spec/);
  assert.ok(calls.every((c) => c.cookie === "mustard_ui=SECRET" && c.url.includes(`root=${encodeURIComponent(repo)}`)));
  assert.ok(calls.find((c) => c.url.includes("/api/crew/run")).url.endsWith("&peek=1")); // 읽기는 자동 실행 대상 등록 안 함

  // 카드 만들고 바로 시작
  calls.length = 0;
  board.tasks.push({ id: "t2", title: "새 일", status: "backlog", createdAt: 9 }); // 같은 제목 옛 카드 — 이걸 시작하면 안 됨
  r = await cc.call("crew_add_task", { title: "새 일", role: "app-builder", start: true }, repo);
  assert.ok(!r.isError);
  assert.deepStrictEqual(calls.filter((c) => c.method === "POST").map((c) => c.body), [{ root: repo, op: "create", title: "새 일", role: "app-builder" }, { root: repo, taskId: "t3", action: "start" }]);

  // 200자 넘는 제목 — 저장소처럼 잘려도 새 카드를 찾음
  calls.length = 0;
  const long = "가".repeat(250);
  const fakeTrunc = async (url, init) => { if (init.method === "POST") board.tasks.push({ id: "tLong", title: JSON.parse(init.body).title.slice(0, 200), status: "backlog", createdAt: 1 }); return { ok: true, status: 200, json: async () => ({ ok: true, board }) }; };
  r = JSON.parse((await createCrewControl({ appBase: () => base, uiToken: "x", fetch: fakeTrunc }).call("crew_add_task", { title: long }, repo)).content[0].text);
  assert.strictEqual(r.id, "tLong");
  const spaced = "a".repeat(199) + " " + "b".repeat(10); // 200번째 글자가 공백 — 저장소(crewStore create)는 trim 후 자르기만, 끝 공백 남음
  const fakeTrim = async (url, init) => { if (init.method === "POST") board.tasks.push({ id: "tSp", title: String(JSON.parse(init.body).title).trim().slice(0, 200), status: "backlog", createdAt: 1 }); return { ok: true, status: 200, json: async () => ({ ok: true, board }) }; };
  r = JSON.parse((await createCrewControl({ appBase: () => base, uiToken: "x", fetch: fakeTrim }).call("crew_add_task", { title: spaced }, repo)).content[0].text);
  assert.strictEqual(r.id, "tSp");

  // 멈춤·대화
  calls.length = 0;
  await cc.call("crew_stop", { taskId: "t2" }, repo);
  await cc.call("crew_chat", { text: "@test-engineer 테스트 보강", replyTo: "m1" }, repo); // 답글(관문 결정이 됨)은 안 보냄
  assert.deepStrictEqual(calls.map((c) => [c.url.replace(base, ""), c.body.action ?? c.body.text]), [["/api/crew/run", "stop"], ["/api/crew/chat", "@test-engineer 테스트 보강"]]);
  assert.strictEqual(calls[1].body.replyTo, undefined);

  // 승인·관문·삭제 같은 건 도구가 없음 — 어떤 호출도 permission/gate/pr/takeover/delete를 보내지 않음
  for (const t of ["crew_permission", "crew_gate", "crew_delete", "crew_approve"]) assert.ok((await cc.call(t, { taskId: "t1", approved: true }, repo)).isError);
  calls.length = 0;
  await cc.call("crew_start", { taskId: "t2", action: "permission", approved: true }, repo); // 인자로 action을 넣어도 무시
  assert.deepStrictEqual(calls.find((c) => c.method === "POST").body, { root: repo, taskId: "t2", action: "start" });
  // 관문 걸린 카드(t1 spec)는 시작 안 함 — 막힘 다시 실행도 사람 몫
  calls.length = 0;
  assert.match((await cc.call("crew_start", { taskId: "t1" }, repo)).content[0].text, /waiting for the user/);
  assert.ok(!calls.some((c) => c.method === "POST"));

  // 크루 작업 폴더에서는 거부, 레포 밖도 거부
  calls.length = 0;
  assert.ok((await cc.call("crew_board", {}, wt)).isError);
  assert.ok((await cc.call("crew_board", {}, tmp)).isError);
  assert.strictEqual(calls.length, 0);

  // 부팅 중(앱 주소 없음)·API 실패는 오류로
  base = null;
  assert.match((await cc.call("crew_board", {}, repo)).content[0].text, /starting up/);
  base = "http://127.0.0.1:1";
  const bad = createCrewControl({ appBase: () => base, uiToken: "x", fetch: async () => ({ ok: false, status: 400, json: async () => ({ ok: false, error: "gate pending" }) }) });
  assert.match((await bad.call("crew_start", { taskId: "t1" }, repo)).content[0].text, /gate pending/);
  // 시작만 실패 — 만든 카드 id는 돌려줌(다시 부를 때 중복 카드 방지)
  const half = createCrewControl({ appBase: () => base, uiToken: "x", fetch: async (url, init) => {
    if (url.includes("/run")) return { ok: false, status: 400, json: async () => ({ ok: false, error: "concurrency limit (3)" }) };
    if (init.method === "POST") board.tasks.push({ id: "tNew", title: "x", status: "backlog", createdAt: 1 });
    return { ok: true, status: 200, json: async () => ({ ok: true, board }) };
  } });
  r = JSON.parse((await half.call("crew_add_task", { title: "x", start: true }, repo)).content[0].text);
  assert.deepStrictEqual([r.id, r.started, r.startError], ["tNew", false, "concurrency limit (3)"]);

  console.log("crew-control ok");
})().catch((e) => { console.error(e); process.exit(1); });
