// trackers 점검 — node electron/trackers.test.cjs (가짜 fetch)
const assert = require("node:assert");
const { linear, jira, pickState, run, adfText } = require("./trackers.cjs");

const res = (status, body, headers = {}) => ({ status, ok: status >= 200 && status < 300, headers: { get: (k) => headers[k.toLowerCase()] ?? null }, text: async () => (typeof body === "string" ? body : JSON.stringify(body)) });
function fakeFetch(routes) {
  const calls = [];
  const f = async (url, init) => { calls.push({ url, init }); const r = routes.shift(); return typeof r === "function" ? r(url, init) : r; };
  f.calls = calls;
  return f;
}

(async () => {
  // Linear — 헤더(Bearer 없음·UA), 내 이슈, 모양
  const node = { id: "u1", identifier: "ENG-12", title: "고치기", url: "https://linear.app/x/issue/ENG-12", updatedAt: "2026-10-26", branchName: "hong/eng-12-fix", description: "본문", state: { id: "s1", name: "Todo", type: "unstarted" }, team: { id: "t1", key: "ENG" }, assignee: { name: "Hong" } };
  let f = fakeFetch([res(200, { data: { viewer: { assignedIssues: { nodes: [node] } } } })]);
  const L = linear({ token: "lin_api_x", fetch: f });
  const list = await L.list();
  assert.strictEqual(f.calls[0].init.headers.Authorization, "lin_api_x", "Linear 키는 Bearer 없이");
  assert.strictEqual(f.calls[0].init.headers["User-Agent"], "Mustard");
  assert.match(JSON.parse(f.calls[0].init.body).query, /assignedIssues/);
  assert.deepStrictEqual([list[0].key, list[0].branchName, list[0].stateType], ["ENG-12", "hong/eng-12-fix", "unstarted"]);
  // 검색어면 searchIssues
  f = fakeFetch([res(200, { data: { searchIssues: { nodes: [node] } } })]);
  await linear({ token: "k", fetch: f }).list({ query: "fix" });
  assert.match(JSON.parse(f.calls[0].init.body).query, /searchIssues/);
  // GraphQL 오류 분류 — 인증·속도 제한
  f = fakeFetch([res(200, { errors: [{ message: "Authentication required", extensions: { code: "AUTHENTICATION_ERROR" } }] })]);
  assert.strictEqual((await run(() => linear({ token: "bad", fetch: f }).check())).state, "not-authed");
  f = fakeFetch([res(200, { errors: [{ message: "slow down", extensions: { code: "RATELIMITED" } }] })]);
  assert.strictEqual((await run(() => linear({ token: "k", fetch: f }).check())).state, "rate-limited");
  // 상태 고르기 — 위치 순, started 첫 번째
  f = fakeFetch([res(200, { data: { team: { states: { nodes: [{ id: "c", name: "Done", type: "completed", position: 3 }, { id: "b", name: "In Progress", type: "started", position: 2 }, { id: "a", name: "Todo", type: "unstarted", position: 1 }] } } } })]);
  const st = await linear({ token: "k", fetch: f }).states(list[0]);
  assert.deepStrictEqual(st.map((s) => s.id), ["a", "b", "c"]);
  assert.strictEqual(pickState(st, "started").id, "b");
  assert.strictEqual(pickState(st, "done").id, "c");

  // Jira Cloud — Basic·v3·search/jql·ADF
  f = fakeFetch([res(200, { issues: [{ id: "1", key: "PROJ-7", fields: { summary: "로그인", status: { name: "To Do", statusCategory: { key: "new" } }, updated: "2026-10-26", assignee: { displayName: "Hong" } } }] })]);
  const J = jira({ site: "acme.atlassian.net/", email: "a@b.c", token: "t", fetch: f });
  const jl = await J.list();
  assert.ok(J.cloud);
  assert.strictEqual(f.calls[0].url, "https://acme.atlassian.net/rest/api/3/search/jql");
  assert.strictEqual(f.calls[0].init.headers.Authorization, `Basic ${Buffer.from("a@b.c:t").toString("base64")}`);
  assert.match(JSON.parse(f.calls[0].init.body).jql, /assignee = currentUser\(\) AND statusCategory != Done/);
  assert.deepStrictEqual([jl[0].key, jl[0].url, jl[0].stateType], ["PROJ-7", "https://acme.atlassian.net/browse/PROJ-7", "new"]);
  // 검색: KEY 꼴 → key =, 글 → text ~ (따옴표 이스케이프)
  f = fakeFetch([res(200, { issues: [] }), res(200, { issues: [] })]);
  const J2 = jira({ site: "https://acme.atlassian.net", email: "a@b.c", token: "t", fetch: f });
  await J2.list({ query: "proj-7" }); await J2.list({ query: 'say "hi"' });
  assert.strictEqual(JSON.parse(f.calls[0].init.body).jql, "key = PROJ-7");
  assert.strictEqual(JSON.parse(f.calls[1].init.body).jql, 'text ~ "say \\"hi\\"" ORDER BY updated DESC');
  // 댓글 — Cloud는 ADF
  f = fakeFetch([res(201, {})]);
  await jira({ site: "acme.atlassian.net", email: "a@b.c", token: "t", fetch: f }).comment({ key: "PROJ-7" }, "PR: https://x");
  assert.strictEqual(JSON.parse(f.calls[0].init.body).body.type, "doc");
  // Jira Server/DC — 이메일 없으면 Bearer·v2·search·글 댓글
  f = fakeFetch([res(200, { issues: [] }), res(201, {})]);
  const S = jira({ site: "https://jira.corp.local", token: "pat", fetch: f });
  await S.list(); await S.comment({ key: "OPS-1" }, "hi");
  assert.ok(!S.cloud);
  assert.strictEqual(f.calls[0].url, "https://jira.corp.local/rest/api/2/search");
  assert.strictEqual(f.calls[0].init.headers.Authorization, "Bearer pat");
  assert.deepStrictEqual(JSON.parse(f.calls[1].init.body), { body: "hi" });
  // 상세 — ADF 본문·댓글을 글로
  f = fakeFetch([res(200, { id: "1", key: "PROJ-7", fields: { summary: "s", status: { name: "In Progress", statusCategory: { key: "indeterminate" } }, description: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "첫 줄" }, { type: "hardBreak" }, { type: "text", text: "둘째" }] }] }, comment: { comments: [{ author: { displayName: "K" }, body: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "ok" }] }] }, created: "t" }] } } })]);
  const d = await jira({ site: "acme.atlassian.net", email: "a@b.c", token: "t", fetch: f }).view("PROJ-7");
  assert.strictEqual(d.body, "첫 줄\n둘째");
  assert.deepStrictEqual(d.comments[0], { author: "K", body: "ok", at: "t" });
  // 전환 → 상태 후보
  f = fakeFetch([res(200, { transitions: [{ id: "21", name: "Start", to: { name: "In Progress", statusCategory: { key: "indeterminate" } } }, { id: "31", name: "Done", to: { name: "Done", statusCategory: { key: "done" } } }] })]);
  const jt = await jira({ site: "acme.atlassian.net", email: "a@b.c", token: "t", fetch: f }).states({ key: "PROJ-7" });
  assert.strictEqual(pickState(jt, "started").id, "21");
  // HTTP 오류 분류 + 429 한 번 다시
  f = fakeFetch([res(401, "nope")]);
  assert.strictEqual((await run(() => jira({ site: "a.atlassian.net", email: "e", token: "t", fetch: f }).check())).state, "not-authed");
  f = fakeFetch([res(403, "no")]);
  assert.strictEqual((await run(() => jira({ site: "a.atlassian.net", email: "e", token: "t", fetch: f }).check())).state, "forbidden");
  f = fakeFetch([res(429, "", { "retry-after": "0" }), res(200, { displayName: "Hong" })]);
  assert.deepStrictEqual((await run(() => jira({ site: "a.atlassian.net", email: "e", token: "t", fetch: f }).check())).data, { name: "Hong", account: "a.atlassian.net" });
  f = fakeFetch([() => { throw new Error("ENOTFOUND"); }]);
  assert.strictEqual((await run(() => linear({ token: "k", fetch: f }).check())).state, "offline");
  assert.strictEqual(adfText(null), "");
  assert.throws(() => require("./trackers.cjs").siteOf("http://jira.corp"), /https only/, "http 사이트 거부(토큰 평문 방지)");
  console.log("trackers.test ok");
})().catch((e) => { console.error(e); process.exit(1); });
