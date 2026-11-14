// 내부 /api 보호(#1340) — proxy.ts가 모든 /api/* 앞에서 부름. 순수 함수(점검 쉬움).
//  1. Host가 루프백(127.0.0.1·localhost·[::1])이 아니면 막음 — DNS 리바인딩(공격자 도메인을 127.0.0.1로 돌려 앱 API를 부르는 것) 차단.
//  2. 브라우저가 다른 출처에서 보낸 요청이면 막음 — Sec-Fetch-Site가 cross-site·same-site(다른 포트의 localhost 페이지, 인앱 브라우저로 연
//     개발 중인 웹앱 등)이거나, 그 헤더 없이 Origin이 Host와 다르면. 앱 화면(같은 출처)·출처 헤더 없는 로컬 프로세스(Electron main·
//     에이전트 훅·MCP·CLI)는 그대로 통과(로컬 프로세스는 이미 사용자 권한이라 위협 범위 밖).
// 한계: 일부 라우트(Crew 승인 등)는 crossSite()로 앱 창 쿠키까지 확인 — 그건 그대로 둠(에이전트가 스크립트로 자기 승인 못 하게).
// 한계: 두 헤더를 다 안 보내는 아주 옛 브라우저의 GET(<img> 등)은 로컬 프로세스와 구분이 안 돼 통과 — 상태를 바꾸는 GET(crew run·triggers·chat)은
//  패키지 앱에선 crossSite() 앱 창 쿠키 검사로 막히고, dev(쿠키 값 없음)에서만 열림.
// same-site(다른 포트 localhost 페이지)도 막음 — 인앱 브라우저로 연 개발 앱이 머스타드 API를 부르는 경로는 없음(리뷰 확인).
const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);

export type GuardResult = { ok: true } | { ok: false; reason: "host" | "cross-origin" };

export function guardApi(h: { host?: string | null; secFetchSite?: string | null; origin?: string | null }): GuardResult {
  const host = (h.host ?? "").toLowerCase();
  const name = host.startsWith("[") ? host.slice(0, host.indexOf("]") + 1) : host.split(":")[0];
  if (!LOOPBACK.has(name)) return { ok: false, reason: "host" };
  const s = h.secFetchSite?.toLowerCase();
  if (s && s !== "same-origin" && s !== "none") return { ok: false, reason: "cross-origin" };
  const o = h.origin;
  if (!s && o) {
    if (o === "null") return { ok: false, reason: "cross-origin" }; // 샌드박스 iframe·file:// 등 출처를 숨긴 요청
    try { if (new URL(o).host.toLowerCase() !== host) return { ok: false, reason: "cross-origin" }; } catch { return { ok: false, reason: "cross-origin" }; }
  }
  return { ok: true };
}
