// Next.js가 서버 부팅 시 1회 호출하는 훅. 에이전트 런타임 서버를 미리 띄워
// 첫 분석 지연을 없앤다. 부팅 실패해도 앱은 정상 기동(런타임 사용 시점 에러는 별도 처리).
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return; // edge/브라우저 런타임 제외
  // 외부 런타임 서버(일렉트론 main 소유)면 임베드 스킵 — SnaClient가 SNA_BASE_URL로 연결.
  if (process.env.SNA_BASE_URL) { console.log("[sna] external runtime — skip embed"); await killIdleDefault(); return; }
  try {
    const { getSnaServer } = await import("@mustard/core/sna/server");
    const sna = await getSnaServer();
    console.log("[sna] embedded runtime ready on", sna.port);
    await killIdleDefault();
  } catch (e) {
    console.error("[sna] embedded runtime boot failed:", e);
  }
}

// #1228 SNA 서버는 켜질 때 "default" 세션 claude(약 300MB, MCP 자식 포함)를 무조건 띄우는데 우리는 안 씀
// (해설·질문 = runOnce 새 세션, Crew = sessions.create) → 부팅 때 끔. 세션은 남고 자동 재시작 없음.
// default 세션을 쓰는 기능을 만들면 이 끄기를 빼야 함.
async function killIdleDefault() {
  try {
    const { getSnaClient } = await import("@mustard/core/sna");
    const r = await (await getSnaClient()).agent.kill("default");
    console.log("[sna] idle default session:", r.status);
  } catch (e) {
    console.warn("[sna] idle default kill failed:", e instanceof Error ? e.message : e);
  }
}
