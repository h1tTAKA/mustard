// 인앱 브라우저 피드백을 이 레포 에이전트 터미널로(#1037).
// 대상 고르기·셸 여부 판단·붙여넣기+Enter는 main(browser:send-to-agent)이 함 — 페이지 글이 셸로 가면 명령이 실행되니까
// 렌더러의 2초 폴링 정보로 판단하지 않음(#1037 리뷰). 여기선 "지금 보던 터미널 탭"만 우선순위로 넘김.
export async function sendToAgent(repo: string, text: string): Promise<{ ok: true; id: string } | { ok: false; reason: string }> {
  const api = typeof window !== "undefined" ? window.nunopiDesktop?.browser : undefined;
  if (!api) return { ok: false, reason: "no-api" };
  let preferId: string | undefined, ids: string[] = []; // 기록을 못 읽으면 빈 목록 = 아무 세션도 안 고름(fail-closed, 리뷰)
  try {
    const d = JSON.parse(localStorage.getItem(`nunopi:ws-terms:${repo}`) || "null"); // TerminalPane과 같은 키
    preferId = d?.activeId;
    if (Array.isArray(d?.tabs)) ids = d.tabs.map((x: { id?: unknown }) => x?.id).filter((x: unknown): x is string => typeof x === "string");
  } catch { /* ignore */ }
  // #1211 이 레포 터미널 탭의 세션만 — 레포 탭을 닫아도 세션이 살아 있어서, 닫힌 하위 레포의 에이전트로 가지 않게(리뷰).
  // 열린 하위 레포 탭의 에이전트도 대상 아님 — 각 레포는 자기 탭의 에이전트에게 보냄.
  return api.sendToAgent({ cwd: repo, preferId, ids, text });
}
