// 이슈 트래커(#1172) — Linear·Jira를 같은 모양으로. main 전용(토큰은 화면으로 안 내려감).
// 이슈 모양 = { provider, id, key, title, state, stateType, url, updatedAt, branchName, assignee, team?, body?, comments? }
//   stateType = backlog·unstarted·started·completed·canceled(Linear 타입) / new·indeterminate·done(Jira 상태 묶음)
// 오류 = { ok:false, state: "not-authed"(401 — 다시 연결) | "forbidden"(403 권한) | "rate-limited" | "offline" | "error", detail }
// 429는 Retry-After만큼(최대 30초) 한 번 기다렸다 다시. 동시 요청 4개까지.
const UA = "Mustard"; // 브라우저 UA로 보내면 Atlassian이 토큰 쓰기 요청을 거부함

let running = 0; const queue = [];
const slot = () => (running < 4 ? (running++, Promise.resolve()) : new Promise((r) => queue.push(r)));
const release = () => { const n = queue.shift(); if (n) n(); else running--; };

class TrackerError extends Error { constructor(state, detail) { super(detail || state); this.state = state; this.detail = detail || ""; } }
const fail = (e) => ({ ok: false, state: e instanceof TrackerError ? e.state : "error", detail: String(e?.detail || e?.message || e).slice(0, 300) });

async function request(fetchFn, url, init, tries = 2) {
  await slot();
  let res;
  try { res = await fetchFn(url, { ...init, headers: { "User-Agent": UA, Accept: "application/json", ...(init.headers || {}) } }); }
  catch (e) { throw new TrackerError("offline", String(e?.message || e)); }
  finally { release(); }
  if (res.status === 429 && tries > 1) {
    const wait = Math.min(30, Number(res.headers?.get?.("retry-after")) || 2) * 1000;
    await new Promise((r) => setTimeout(r, wait));
    return request(fetchFn, url, init, tries - 1);
  }
  const text = await res.text();
  let json = null; try { json = text ? JSON.parse(text) : null; } catch { /* 글 응답 */ }
  if (res.status === 401) throw new TrackerError("not-authed", text.slice(0, 200));
  if (res.status === 403) throw new TrackerError("forbidden", text.slice(0, 200));
  if (res.status === 429) throw new TrackerError("rate-limited", text.slice(0, 200));
  if (!res.ok) throw new TrackerError("error", `${res.status} ${text.slice(0, 200)}`);
  return json;
}

// ── Linear(GraphQL 한 엔드포인트, 개인 API 키 — Bearer 없이) ─────────────────────
const LINEAR = "https://api.linear.app/graphql";
const F = "id identifier title url updatedAt branchName description state { id name type } team { id key name } assignee { name }";
function linear({ token, fetch: fetchFn = globalThis.fetch }) {
  const gql = async (query, variables = {}) => {
    const j = await request(fetchFn, LINEAR, { method: "POST", headers: { Authorization: token, "Content-Type": "application/json" }, body: JSON.stringify({ query, variables }) });
    const err = j?.errors?.[0];
    if (err) {
      const code = String(err.extensions?.code || err.extensions?.type || "");
      throw new TrackerError(/RATELIMIT/i.test(code) ? "rate-limited" : /authenticat/i.test(code + err.message) ? "not-authed" : /forbidden|permission/i.test(code + err.message) ? "forbidden" : "error", err.message);
    }
    return j?.data;
  };
  const shape = (n, withBody) => ({
    provider: "linear", id: n.id, key: n.identifier, title: n.title, state: n.state?.name ?? "", stateType: n.state?.type ?? "", url: n.url, updatedAt: n.updatedAt,
    branchName: n.branchName || "", assignee: n.assignee?.name ?? "", team: n.team ? { id: n.team.id, key: n.team.key } : undefined,
    ...(withBody ? { body: n.description ?? "", comments: (n.comments?.nodes ?? []).map((c) => ({ author: c.user?.name ?? "", body: c.body, at: c.createdAt })) } : {}),
  });
  return {
    async check() { const d = await gql("{ viewer { id name email organization { name } } }"); return { name: d.viewer.name, account: d.viewer.organization?.name ?? d.viewer.email ?? "" }; },
    async list({ query = "", first = 50 } = {}) {
      const q = query.trim();
      const d = q
        ? await gql(`query($t:String!,$n:Int!){ searchIssues(term:$t, first:$n){ nodes { ${F} } } }`, { t: q, n: first })
        : await gql(`query($n:Int!){ viewer { assignedIssues(first:$n, filter:{ state:{ type:{ nin:["completed","canceled"] } } }, orderBy: updatedAt){ nodes { ${F} } } } }`, { n: first });
      return (q ? d.searchIssues.nodes : d.viewer.assignedIssues.nodes).map((n) => shape(n));
    },
    async view(id) { const d = await gql(`query($id:String!){ issue(id:$id){ ${F} comments(first:50){ nodes { body createdAt user { name } } } } }`, { id }); return shape(d.issue, true); },
    // 상태 후보 — 팀의 상태(위치 순), id = 바꿀 때 쓰는 값
    async states(issue) {
      const d = await gql(`query($id:String!){ team(id:$id){ states { nodes { id name type position } } } }`, { id: issue.team?.id });
      return d.team.states.nodes.sort((a, b) => a.position - b.position).map((s) => ({ id: s.id, name: s.name, type: s.type }));
    },
    async setState(issue, stateId) { const d = await gql("mutation($id:String!,$s:String!){ issueUpdate(id:$id, input:{ stateId:$s }){ success } }", { id: issue.id, s: stateId }); return !!d.issueUpdate?.success; },
    async comment(issue, body) { const d = await gql("mutation($id:String!,$b:String!){ commentCreate(input:{ issueId:$id, body:$b }){ success } }", { id: issue.id, b: body }); return !!d.commentCreate?.success; },
  };
}

// ── Jira(Cloud = /rest/api/3 + ADF, Server/DC = /rest/api/2 + 글) ─────────────────
// 이메일 있으면 Basic(email:token — Cloud API 토큰), 없으면 Bearer(Server/DC 개인 토큰).
const JIRA_FIELDS = ["summary", "status", "updated", "assignee"];
const KEY_RE = /^[A-Z][A-Z0-9_]+-\d+$/;
function siteOf(site) { const s = String(site || "").trim().replace(/\/+$/, ""); return /^https?:\/\//.test(s) ? s : `https://${s}`; }
// ADF(문서 트리) → 글. 문단·줄바꿈·목록만 대충(본문 읽기용)
function adfText(node) {
  if (!node || typeof node !== "object") return typeof node === "string" ? node : "";
  if (node.type === "text") return node.text || "";
  if (node.type === "hardBreak") return "\n";
  const inner = (node.content || []).map(adfText).join("");
  return ["paragraph", "heading", "listItem", "codeBlock", "blockquote"].includes(node.type) ? `${inner}\n` : inner;
}
const jqlStr = (s) => `"${String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
function jira({ site, email, token, fetch: fetchFn = globalThis.fetch }) {
  const base = siteOf(site);
  const cloud = /\.atlassian\.net$/i.test(new URL(base).hostname);
  const v = cloud ? 3 : 2;
  const auth = email ? `Basic ${Buffer.from(`${email}:${token}`).toString("base64")}` : `Bearer ${token}`;
  const api = (path, init = {}) => request(fetchFn, `${base}/rest/api/${v}${path}`, { ...init, headers: { Authorization: auth, "Content-Type": "application/json", ...(init.headers || {}) } });
  const shape = (i, withBody) => {
    const f = i.fields || {};
    const desc = f.description;
    return {
      provider: "jira", id: i.id, key: i.key, title: f.summary ?? "", state: f.status?.name ?? "", stateType: f.status?.statusCategory?.key ?? "", url: `${base}/browse/${i.key}`, updatedAt: f.updated,
      branchName: "", assignee: f.assignee?.displayName ?? "",
      ...(withBody ? { body: (typeof desc === "string" ? desc : adfText(desc)).trim(), comments: (f.comment?.comments ?? []).map((c) => ({ author: c.author?.displayName ?? "", body: (typeof c.body === "string" ? c.body : adfText(c.body)).trim(), at: c.created })) } : {}),
    };
  };
  return {
    cloud,
    async check() { const m = await api("/myself"); return { name: m.displayName ?? "", account: new URL(base).hostname }; },
    // 기본 = 나에게 배정 + 안 끝난 것. 검색어가 KEY-123 꼴이면 그 이슈, 아니면 글 검색
    async list({ query = "", max = 50 } = {}) {
      const q = query.trim();
      const jql = !q ? "assignee = currentUser() AND statusCategory != Done ORDER BY updated DESC"
        : KEY_RE.test(q.toUpperCase()) ? `key = ${q.toUpperCase()}` : `text ~ ${jqlStr(q)} ORDER BY updated DESC`;
      const r = cloud ? await api("/search/jql", { method: "POST", body: JSON.stringify({ jql, maxResults: max, fields: JIRA_FIELDS }) })
        : await api("/search", { method: "POST", body: JSON.stringify({ jql, maxResults: max, fields: JIRA_FIELDS }) });
      return (r?.issues ?? []).map((i) => shape(i));
    },
    async view(key) { return shape(await api(`/issue/${encodeURIComponent(key)}?fields=${[...JIRA_FIELDS, "description", "comment"].join(",")}`), true); },
    // 상태 후보 = 지금 할 수 있는 전환(id = 전환 id, type = 도착 상태 묶음)
    async states(issue) { const r = await api(`/issue/${encodeURIComponent(issue.key)}/transitions`); return (r?.transitions ?? []).map((t) => ({ id: t.id, name: t.to?.name || t.name, type: t.to?.statusCategory?.key ?? "" })); },
    async setState(issue, transitionId) { await api(`/issue/${encodeURIComponent(issue.key)}/transitions`, { method: "POST", body: JSON.stringify({ transition: { id: transitionId } }) }); return true; },
    async comment(issue, body) {
      const payload = cloud ? { body: { type: "doc", version: 1, content: [{ type: "paragraph", content: [{ type: "text", text: body }] }] } } : { body };
      await api(`/issue/${encodeURIComponent(issue.key)}/comment`, { method: "POST", body: JSON.stringify(payload) });
      return true;
    },
  };
}

// 상태 동기화용 — 시작하면 "진행 중"류(Linear started / Jira indeterminate), 끝나면 "완료"류(completed / done) 첫 후보
const TARGET = { started: ["started", "indeterminate"], done: ["completed", "done"] };
const pickState = (states, kind) => states.find((s) => TARGET[kind].includes(s.type)) || null;

// 실행 감싸기 — 결과 {ok:true, data} | 오류 모양
async function run(fn) { try { return { ok: true, data: await fn() }; } catch (e) { return fail(e); } }

module.exports = { linear, jira, pickState, run, adfText, siteOf, TrackerError };
