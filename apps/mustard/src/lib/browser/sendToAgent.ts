// 인앱 브라우저 피드백을 이 레포 에이전트 터미널로(#1037).
// 대상 고르기·셸 여부 판단·붙여넣기+Enter는 main(browser:send-to-agent)이 함 — 페이지 글이 셸로 가면 명령이 실행되니까
// 렌더러의 2초 폴링 정보로 판단하지 않음(#1037 리뷰). 여기선 "지금 보던 터미널 탭"만 우선순위로 넘김.
export async function sendToAgent(repo: string, text: string): Promise<{ ok: true; id: string } | { ok: false; reason: string }> {
  const api = typeof window !== "undefined" ? window.nunopiDesktop?.browser : undefined;
  if (!api) return { ok: false, reason: "no-api" };
  let preferId: string | undefined;
  try { preferId = JSON.parse(localStorage.getItem(`nunopi:ws-terms:${repo}`) || "null")?.activeId; } catch { /* ignore */ } // TerminalPane과 같은 키
  return api.sendToAgent({ cwd: repo, preferId, text });
}
