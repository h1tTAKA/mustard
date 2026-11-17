// #1358 채팅 Claude 권한 훅 소스(Crew 훅 HOOK_SRC를 받아 바꿈) — 순수 함수라 점검에서 실제로 돌려 봄.
// 채팅 Claude 훅 — Crew 훅과 같되, 앱(Next)에 못 닿으면 바로 거절하지 않고 훅 제한 시간(900초) 안에서 다시 시도(#1358):
// 앱을 닫아도 채팅은 계속 도는데, 그동안 물어볼 도구가 오면 앱이 다시 열릴 때까지 기다렸다가 평소처럼 카드로. 끝내 안 열리면 이유를 달아 거절.
export const chatHookSrc = (base: string) => base
  .replace("/api/crew/permission", "/api/chat/permission")
  .replace("Mustard Crew PreToolUse", "Mustard chat PreToolUse")
  .replace(/const r = await fetch\(([\s\S]*?)\);\n/, (_m: string, a: string) => `const end = Date.now() + 870000; let r;
    for (;;) { try { r = await fetch(${a.replace("AbortSignal.timeout(900000)", "AbortSignal.timeout(Math.max(1000, end - Date.now()))")}); break; }
      catch (e) { if (Date.now() > end - 3000 || (e && e.name === "TimeoutError")) throw new Error("Mustard app was closed — no one to approve"); await new Promise((s) => setTimeout(s, 3000)); } }
`);
