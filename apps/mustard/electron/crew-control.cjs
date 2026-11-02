// 터미널 에이전트용 Crew 지시(#1277) — mustard-mcp.cjs의 crew_* → main /call → 여기서 Next Crew API를 앱 창 비밀값 쿠키로 대신 부름.
// 일반 프록시 아님: 도구 하나 = 정해진 API 호출 하나. 권한 승인·관문·PR·넘겨받기·삭제·역할/트리거 변경은 일부러 없음(사람이 앱 화면에서만, #1161).
// 크루 작업 폴더(cwd)에서 부르면 거부 — 크루가 크루를 부르는 연쇄 방지.
//  한계: cwd는 요청이 보내는 값이라 속일 수 있음 — 그래도 열린 건 아래 허용 동작뿐.
//  한계: 레포 = cwd 실경로. 앱이 심볼릭 링크 경로로 연 레포면 보드 키가 달라 다른(빈) 보드를 봄.
// 대화방 답글(replyTo)은 안 엶 — 서버가 답글을 관문 결정(질문 답·막힘 재시작·반려)으로 처리해서(리뷰).
const { existsSync, realpathSync } = require("node:fs");
const { dirname, join } = require("node:path");
const { homedir } = require("node:os");

const text = (t) => ({ content: [{ type: "text", text: typeof t === "string" ? t : JSON.stringify(t, null, 2) }] });
const fail = (t) => ({ content: [{ type: "text", text: t }], isError: true });
const real = (p) => { try { return realpathSync(p); } catch { return p; } };

// 레포 = cwd에서 위로 처음 .git(worktree는 파일)이 나오는 곳 — mustard-mcp.cjs repoRoot와 같은 규칙. 없으면 null.
function repoOf(cwd) {
  for (let d = real(cwd); d; d = dirname(d)) {
    if (existsSync(join(d, ".git"))) return d;
    if (dirname(d) === d) return null;
  }
  return null;
}
// 크루 작업 폴더 — crewWorktree.ts baseDir와 같은 값(서버가 main env를 물려받음)
const worktreeBase = () => real(process.env.MUSTARD_WORKTREE_DIR || join(homedir(), ".nunopi", "worktrees"));
const inCrewWorktree = (cwd) => { const c = real(cwd), b = worktreeBase(); return c === b || c.startsWith(b + "/"); };

// deps: appBase() → Next 주소 | null, uiToken → 앱 창 비밀값, fetch(점검용 주입)
function createCrewControl({ appBase, uiToken, fetch = globalThis.fetch }) {
  const api = async (method, path, body) => {
    const base = appBase();
    if (!base) throw new Error("Mustard is still starting up. Try again in a few seconds.");
    const r = await fetch(base + path, {
      method,
      headers: { Cookie: `mustard_ui=${uiToken}`, ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(20_000),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.ok === false) throw new Error(j.error || `HTTP ${r.status}`);
    return j;
  };
  const q = (root) => `root=${encodeURIComponent(root)}`;

  async function call(tool, args, cwd) {
    args = args || {};
    if (inCrewWorktree(cwd)) return fail("Crew tools are not available inside a Crew run (a crew member cannot direct other crew members).");
    const root = repoOf(cwd);
    if (!root) return fail("Run this from inside a git repo opened in Mustard.");
    try {
      if (tool === "crew_board") {
        const [{ board }, { runs }, { msgs }] = await Promise.all([api("GET", `/api/crew/board?${q(root)}`), api("GET", `/api/crew/run?${q(root)}&peek=1`), api("GET", `/api/crew/chat?${q(root)}&peek=1`)]);
        const last = new Map(); for (const r of runs) last.set(r.taskId, r); // 카드마다 마지막 실행
        return text({
          repo: root,
          tasks: board.tasks.map((t) => { const r = last.get(t.id); return { id: t.id, title: t.title, status: t.status, role: t.role, waitingForUser: t.gate ? `${t.gate.kind}${t.gate.text ? `: ${t.gate.text}` : ""}` : undefined, run: r && { state: r.state, role: r.role, lastActivity: r.lastActivity, summary: r.summary, error: r.error } }; }),
          recentChat: msgs.slice(-10),
        });
      }
      if (tool === "crew_add_task") {
        const title = String(args.title || "").trim();
        if (!title) return fail("title is required.");
        const before = new Set((await api("GET", `/api/crew/board?${q(root)}`)).board.tasks.map((t) => t.id)); // 새로 생긴 카드 = 전후 차이(같은 제목 오인 방지, 리뷰)
        const { board } = await api("POST", "/api/crew/board", { root, op: "create", title, ...(args.body ? { body: String(args.body) } : {}), ...(args.role ? { role: String(args.role) } : {}) });
        const id = board.tasks.find((x) => !before.has(x.id) && x.title === title)?.id; // 그 사이 사람이 만든 카드 제외(재리뷰)
        if (!id) return fail("Card was not created.");
        // 시작 실패해도 만든 카드 id는 돌려줌 — 다시 부를 때 중복 카드 대신 crew_start로(리뷰)
        let started = false, startError;
        if (args.start) { try { await api("POST", "/api/crew/run", { root, taskId: id, action: "start" }); started = true; } catch (e) { startError = String(e?.message || e); } }
        return text({ id, title, started, ...(startError ? { startError, hint: "Card exists; retry with crew_start instead of adding it again." } : {}), note: "Permission requests and gates are approved by the user in the Mustard app." });
      }
      if (tool === "crew_start" || tool === "crew_stop") {
        const taskId = String(args.taskId || "");
        if (!taskId) return fail("taskId is required (see crew_board).");
        // 관문에 걸린 카드는 시작 안 함 — 막힘(blocked) 다시 실행도 사람 몫(실패 반복 루프 방지, 재리뷰). 서버는 막힘 다시 실행을 허용함
        if (tool === "crew_start") {
          const t = (await api("GET", `/api/crew/board?${q(root)}`)).board.tasks.find((x) => x.id === taskId);
          if (t?.gate) return fail(`This card is waiting for the user in Mustard (${t.gate.kind}). Ask the user to decide it there.`);
        }
        await api("POST", "/api/crew/run", { root, taskId, action: tool === "crew_start" ? "start" : "stop" });
        return text(`${tool === "crew_start" ? "Started" : "Stopped"} ${taskId}.`);
      }
      if (tool === "crew_chat") {
        const t = String(args.text || "").trim();
        if (!t) return fail("text is required.");
        await api("POST", "/api/crew/chat", { root, text: t }); // replyTo 없음 — 위 주석
        return text("Posted to the Crew chat. Read replies with crew_board.");
      }
      return fail(`Unknown tool: ${tool}`);
    } catch (e) { return fail(`Crew error: ${String(e?.message || e)}`); }
  }
  return { call };
}

module.exports = { createCrewControl, repoOf, inCrewWorktree };
